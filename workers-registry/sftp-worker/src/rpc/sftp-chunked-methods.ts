/**
 * RPC handlers for chunked I/O operations
 * 
 * Implements sftp/openRead, sftp/readChunk, sftp/closeRead,
 * sftp/openWrite, sftp/writeChunk, sftp/commitWrite, sftp/abortWrite.
 */

import { createHash } from 'crypto';
import { Readable, Writable } from 'stream';
import { SessionManager, Session } from '../session-manager.js';
import { ISftpBackend } from '../sftp-backend.js';
import { HandleManager } from '../handle-manager.js';
import { PathNormalizer } from '../path-normalizer.js';
import { ErrorMapper } from '../error-mapper.js';
import { SftpError } from '../types.js';
import {
  JSONRPC_INVALID_PARAMS,
  INVALID_OR_EXPIRED_HANDLE,
  PATH_NOT_FOUND,
  ALREADY_EXISTS,
} from '../error-codes.js';

// ============================================================================
// Helpers
// ============================================================================

function getBackend(session: Session): ISftpBackend {
  if (!session.backend) {
    throw ErrorMapper.createError(-32000, 'No active connection');
  }
  return session.backend as ISftpBackend;
}

function getHandleManager(session: Session): HandleManager {
  if (!session.handleManager) {
    throw ErrorMapper.createError(-32000, 'No handle manager for session');
  }
  return session.handleManager as HandleManager;
}

// ============================================================================
// Chunked Read Methods
// ============================================================================

/**
 * Handle sftp/openRead RPC method
 * 
 * Opens a read stream for chunked reading.
 * Returns handleId and fileSize.
 * 
 * Requirements: 22.2
 */
export async function handleOpenRead(
  params: any,
  sessionId: string,
  sessionManager: SessionManager
): Promise<any> {
  if (!params.path || typeof params.path !== 'string') {
    throw ErrorMapper.createError(JSONRPC_INVALID_PARAMS, 'Invalid params: path required');
  }

  const normalizedPath = PathNormalizer.normalize(params.path);

  const session = sessionManager.getSession(sessionId);
  if (!session) {
    throw ErrorMapper.createError(-32000, 'No active session');
  }

  const backend = getBackend(session);
  const handleManager = getHandleManager(session);

  try {
    // Get file size first via stat
    const stat = await backend.stat(normalizedPath);
    const fileSize = stat.size;

    // Open read stream
    const stream = await backend.openReadStream(normalizedPath);

    // Register handle
    const handleId = handleManager.open('read', normalizedPath, stream);

    return { handleId, fileSize };
  } catch (error) {
    if (error instanceof SftpError) throw error;
    throw ErrorMapper.map(error, { path: normalizedPath, method: 'sftp/openRead' });
  }
}

/**
 * Handle sftp/readChunk RPC method
 * 
 * Reads a chunk from an open read handle.
 * The stream is sequential — chunks must be read in order.
 * Returns base64-encoded data, offset, length, and eof flag.
 * 
 * Requirements: 22.2
 */
export async function handleReadChunk(
  params: any,
  sessionId: string,
  sessionManager: SessionManager
): Promise<any> {
  if (!params.handleId || typeof params.handleId !== 'string') {
    throw ErrorMapper.createError(JSONRPC_INVALID_PARAMS, 'Invalid params: handleId required');
  }
  if (typeof params.offset !== 'number' || params.offset < 0) {
    throw ErrorMapper.createError(JSONRPC_INVALID_PARAMS, 'Invalid params: offset required (non-negative number)');
  }
  if (typeof params.length !== 'number' || params.length <= 0) {
    throw ErrorMapper.createError(JSONRPC_INVALID_PARAMS, 'Invalid params: length required (positive number)');
  }

  const session = sessionManager.getSession(sessionId);
  if (!session) {
    throw ErrorMapper.createError(-32000, 'No active session');
  }

  const handleManager = getHandleManager(session);
  const handle = handleManager.get(params.handleId);

  if (handle.type !== 'read') {
    throw ErrorMapper.createError(INVALID_OR_EXPIRED_HANDLE, 'Handle is not a read handle');
  }

  try {
    const stream = handle.stream as Readable;
    const requestedLength = params.length;

    // Read data from the sequential stream
    const data = await readFromStream(stream, requestedLength);
    const eof = data.length < requestedLength || (stream as any).readableEnded === true;

    // Track offset for informational purposes
    handle.nextExpectedOffset = params.offset + data.length;

    return {
      data: data.toString('base64'),
      offset: params.offset,
      length: data.length,
      eof,
    };
  } catch (error) {
    if (error instanceof SftpError) throw error;
    throw ErrorMapper.map(error, { path: handle.path, method: 'sftp/readChunk' });
  }
}

/**
 * Read up to `requestedLength` bytes from a Readable stream.
 * Returns a Buffer with the data read (may be shorter if stream ends).
 * 
 * Handles the case where stream.read(n) returns more than n bytes
 * (e.g. Readable.from) by slicing and pushing the remainder back.
 */
async function readFromStream(stream: Readable, requestedLength: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let bytesRead = 0;

  while (bytesRead < requestedLength) {
    const remaining = requestedLength - bytesRead;
    const chunk: Buffer | null = stream.read(remaining);

    if (chunk !== null) {
      if (chunk.length <= remaining) {
        chunks.push(chunk);
        bytesRead += chunk.length;
      } else {
        // Stream returned more than requested — take what we need, push rest back
        chunks.push(chunk.subarray(0, remaining));
        stream.unshift(chunk.subarray(remaining));
        bytesRead += remaining;
      }
    } else {
      // No data available — wait for readable or end
      const moreData = await waitForStreamData(stream);
      if (!moreData) {
        break; // Stream ended
      }
      // Loop back to try stream.read() again
    }
  }

  return Buffer.concat(chunks);
}

/**
 * Wait for a stream to become readable or end.
 * Returns true if more data may be available, false if stream ended.
 */
function waitForStreamData(stream: Readable): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if ((stream as any).readableEnded) {
      resolve(false);
      return;
    }

    const onReadable = () => { cleanup(); resolve(true); };
    const onEnd = () => { cleanup(); resolve(false); };
    const onError = () => { cleanup(); resolve(false); };

    const cleanup = () => {
      stream.removeListener('readable', onReadable);
      stream.removeListener('end', onEnd);
      stream.removeListener('error', onError);
    };

    stream.once('readable', onReadable);
    stream.once('end', onEnd);
    stream.once('error', onError);
  });
}

/**
 * Handle sftp/closeRead RPC method
 * 
 * Closes a read handle and releases resources.
 * 
 * Requirements: 22.2
 */
export async function handleCloseRead(
  params: any,
  sessionId: string,
  sessionManager: SessionManager
): Promise<any> {
  if (!params.handleId || typeof params.handleId !== 'string') {
    throw ErrorMapper.createError(JSONRPC_INVALID_PARAMS, 'Invalid params: handleId required');
  }

  const session = sessionManager.getSession(sessionId);
  if (!session) {
    throw ErrorMapper.createError(-32000, 'No active session');
  }

  const handleManager = getHandleManager(session);
  handleManager.close(params.handleId);

  return { closed: true };
}

// ============================================================================
// Chunked Write Methods
// ============================================================================

/**
 * Handle sftp/openWrite RPC method
 * 
 * Opens a write stream for chunked writing.
 * Validates create/overwrite flags against file existence.
 * Returns handleId.
 * 
 * Requirements: 22.3
 */
export async function handleOpenWrite(
  params: any,
  sessionId: string,
  sessionManager: SessionManager
): Promise<any> {
  if (!params.path || typeof params.path !== 'string') {
    throw ErrorMapper.createError(JSONRPC_INVALID_PARAMS, 'Invalid params: path required');
  }

  const normalizedPath = PathNormalizer.normalize(params.path);
  const create = params.create !== undefined ? Boolean(params.create) : true;
  const overwrite = params.overwrite !== undefined ? Boolean(params.overwrite) : true;

  const session = sessionManager.getSession(sessionId);
  if (!session) {
    throw ErrorMapper.createError(-32000, 'No active session');
  }

  const backend = getBackend(session);
  const handleManager = getHandleManager(session);

  try {
    // Check file existence for create/overwrite semantics
    let fileExists = false;
    try {
      await backend.stat(normalizedPath);
      fileExists = true;
    } catch (statError) {
      if (statError instanceof SftpError && statError.code === -32010) {
        fileExists = false;
      } else {
        throw statError;
      }
    }

    if (fileExists && !overwrite) {
      throw new SftpError(ALREADY_EXISTS, `File already exists: ${normalizedPath}`, normalizedPath);
    }

    if (!fileExists && !create) {
      throw new SftpError(PATH_NOT_FOUND, `Path not found: ${normalizedPath}`, normalizedPath);
    }

    // Open write stream
    const stream = await backend.openWriteStream(normalizedPath);

    // Register handle
    const handleId = handleManager.open('write', normalizedPath, stream);

    return { handleId };
  } catch (error) {
    if (error instanceof SftpError) throw error;
    throw ErrorMapper.map(error, { path: normalizedPath, method: 'sftp/openWrite' });
  }
}

/**
 * Handle sftp/writeChunk RPC method
 * 
 * Writes a chunk to an open write handle.
 * Validates chunk continuity by offset → -32031 on mismatch.
 * 
 * Requirements: 22.3, 22.4
 */
export async function handleWriteChunk(
  params: any,
  sessionId: string,
  sessionManager: SessionManager
): Promise<any> {
  if (!params.handleId || typeof params.handleId !== 'string') {
    throw ErrorMapper.createError(JSONRPC_INVALID_PARAMS, 'Invalid params: handleId required');
  }
  if (typeof params.offset !== 'number' || params.offset < 0) {
    throw ErrorMapper.createError(JSONRPC_INVALID_PARAMS, 'Invalid params: offset required (non-negative number)');
  }
  if (!params.data || typeof params.data !== 'string') {
    throw ErrorMapper.createError(JSONRPC_INVALID_PARAMS, 'Invalid params: data (base64) required');
  }

  const session = sessionManager.getSession(sessionId);
  if (!session) {
    throw ErrorMapper.createError(-32000, 'No active session');
  }

  const handleManager = getHandleManager(session);
  const handle = handleManager.get(params.handleId);

  if (handle.type !== 'write') {
    throw ErrorMapper.createError(INVALID_OR_EXPIRED_HANDLE, 'Handle is not a write handle');
  }

  // Decode base64 data first
  let data: Buffer;
  try {
    data = Buffer.from(params.data, 'base64');
  } catch {
    throw ErrorMapper.createError(JSONRPC_INVALID_PARAMS, 'Invalid params: data is not valid base64');
  }

  // Validate offset continuity and advance atomically (throws -32031 on mismatch)
  handleManager.validateAndAdvanceOffset(params.handleId, params.offset, data.length);

  try {
    const stream = handle.stream as Writable;

    // Write to stream with backpressure handling
    await new Promise<void>((resolve, reject) => {
      stream.write(data, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    return { written: data.length };
  } catch (error) {
    if (error instanceof SftpError) throw error;
    throw ErrorMapper.map(error, { path: handle.path, method: 'sftp/writeChunk' });
  }
}

/**
 * Handle sftp/commitWrite RPC method
 * 
 * Finalizes a write handle: ends the stream, computes sha256.
 * Closes the handle after commit.
 * 
 * Requirements: 22.5, 22.6
 */
export async function handleCommitWrite(
  params: any,
  sessionId: string,
  sessionManager: SessionManager
): Promise<any> {
  if (!params.handleId || typeof params.handleId !== 'string') {
    throw ErrorMapper.createError(JSONRPC_INVALID_PARAMS, 'Invalid params: handleId required');
  }

  const session = sessionManager.getSession(sessionId);
  if (!session) {
    throw ErrorMapper.createError(-32000, 'No active session');
  }

  const handleManager = getHandleManager(session);
  const handle = handleManager.get(params.handleId);

  if (handle.type !== 'write') {
    throw ErrorMapper.createError(INVALID_OR_EXPIRED_HANDLE, 'Handle is not a write handle');
  }

  const backend = getBackend(session);
  const filePath = handle.path;
  const totalSize = handle.nextExpectedOffset;

  try {
    const stream = handle.stream as Writable;

    // End the write stream
    await new Promise<void>((resolve, reject) => {
      stream.end(() => resolve());
      stream.once('error', reject);
    });

    // Close the handle (releases resources)
    handleManager.close(params.handleId);

    // Read back the file to compute sha256
    const fileData = await backend.readFile(filePath);
    const sha256 = createHash('sha256').update(fileData).digest('hex');

    return {
      committed: true,
      size: totalSize,
      sha256,
    };
  } catch (error) {
    // Ensure handle is closed even on error
    try { handleManager.close(params.handleId); } catch { /* ignore */ }
    if (error instanceof SftpError) throw error;
    throw ErrorMapper.map(error, { path: filePath, method: 'sftp/commitWrite' });
  }
}

/**
 * Handle sftp/abortWrite RPC method
 * 
 * Aborts a write handle: destroys the stream, cleans up.
 * Idempotent — safe to call on already-closed handles.
 * 
 * Requirements: 22.3
 */
export async function handleAbortWrite(
  params: any,
  sessionId: string,
  sessionManager: SessionManager
): Promise<any> {
  if (!params.handleId || typeof params.handleId !== 'string') {
    throw ErrorMapper.createError(JSONRPC_INVALID_PARAMS, 'Invalid params: handleId required');
  }

  const session = sessionManager.getSession(sessionId);
  if (!session) {
    throw ErrorMapper.createError(-32000, 'No active session');
  }

  const handleManager = getHandleManager(session);
  // close() is idempotent — no error if handle doesn't exist
  handleManager.close(params.handleId);

  return { aborted: true };
}
