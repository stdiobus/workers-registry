/**
 * RPC handlers for SFTP file operations
 * 
 * Implements sftp/readdir, sftp/stat, sftp/readFile, sftp/writeFile methods.
 * Uses ISftpBackend, PathNormalizer, and ErrorMapper.
 */

import { createHash } from 'crypto';
import { SessionManager, Session } from '../session-manager.js';
import { ISftpBackend } from '../sftp-backend.js';
import { PathNormalizer } from '../path-normalizer.js';
import { ErrorMapper } from '../error-mapper.js';
import { AtomicWriter } from '../atomic-writer.js';
import { SftpError } from '../types.js';
import {
  JSONRPC_INVALID_PARAMS,
  PATH_NOT_FOUND,
  ALREADY_EXISTS,
  DIRECTORY_NOT_EMPTY,
} from '../error-codes.js';

/**
 * Get the backend from a session, throwing if not available
 */
function getBackend(session: Session): ISftpBackend {
  if (!session.backend) {
    throw ErrorMapper.createError(-32000, 'No active connection');
  }
  return session.backend as ISftpBackend;
}

/**
 * Handle sftp/readdir RPC method
 * 
 * Uses lstat for symlink detection (Requirement 28.1).
 * Returns entries with name, type, size, mtime, atime.
 * mtime and atime as Unix timestamps (seconds).
 * 
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 28.1
 */
export async function handleReaddir(
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

  try {
    // Get directory listing; backend.readdir() uses lstat internally
    // for symlink detection (Requirement 28.1) — lstat does not follow
    // symlinks, so entries with type 'l' are reported as 'symlink'.
    const entries = await backend.readdir(normalizedPath);
    return { entries };
  } catch (error) {
    throw ErrorMapper.map(error, { path: normalizedPath, method: 'sftp/readdir' });
  }
}

/**
 * Handle sftp/stat RPC method
 * 
 * Uses stat (follow symlinks) per Requirement 28.2.
 * Returns type, size, mtime, atime, mode.
 * 
 * Requirements: 6.1, 6.2, 6.3, 6.4, 28.2
 */
export async function handleStat(
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

  try {
    const result = await backend.stat(normalizedPath);
    return {
      type: result.type,
      size: result.size,
      mtime: result.mtime,
      atime: result.atime,
      mode: result.mode,
    };
  } catch (error) {
    throw ErrorMapper.map(error, { path: normalizedPath, method: 'sftp/stat' });
  }
}


/**
 * Handle sftp/readFile RPC method
 * 
 * Returns base64-encoded file content.
 * Inline for files ≤ maxInlineFileBytes, chunked hint for larger.
 * 
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6
 */
export async function handleReadFile(
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
  const maxInlineFileBytes = session.capabilities.maxInlineFileBytes;

  try {
    const data = await backend.readFile(normalizedPath);
    const size = data.length;

    if (size <= maxInlineFileBytes) {
      // Inline response
      return {
        data: data.toString('base64'),
        size,
        encoding: 'base64',
      };
    } else {
      // Chunked hint — file too large for inline
      const sha256 = createHash('sha256').update(data).digest('hex');
      return {
        data: data.toString('base64'),
        size,
        encoding: 'base64',
        chunked: true,
        chunkIndex: 0,
        totalChunks: Math.ceil(size / maxInlineFileBytes),
        sha256,
      };
    }
  } catch (error) {
    throw ErrorMapper.map(error, { path: normalizedPath, method: 'sftp/readFile' });
  }
}

/**
 * Handle sftp/writeFile RPC method
 * 
 * Decodes base64 data and writes via AtomicWriter or direct.
 * Supports create/overwrite flags and writeStrategy parameter.
 * 
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7
 */
export async function handleWriteFile(
  params: any,
  sessionId: string,
  sessionManager: SessionManager
): Promise<any> {
  if (!params.path || typeof params.path !== 'string') {
    throw ErrorMapper.createError(JSONRPC_INVALID_PARAMS, 'Invalid params: path required');
  }
  if (params.data === undefined || params.data === null || typeof params.data !== 'string') {
    throw ErrorMapper.createError(JSONRPC_INVALID_PARAMS, 'Invalid params: data (base64) required');
  }

  const normalizedPath = PathNormalizer.normalize(params.path);
  const create = params.create !== undefined ? Boolean(params.create) : true;
  const overwrite = params.overwrite !== undefined ? Boolean(params.overwrite) : true;
  const writeStrategy: 'tempRename' | 'direct' = params.writeStrategy === 'direct' ? 'direct' : 'tempRename';

  const session = sessionManager.getSession(sessionId);
  if (!session) {
    throw ErrorMapper.createError(-32000, 'No active session');
  }

  const backend = getBackend(session);

  // Decode base64 data
  let data: Buffer;
  try {
    data = Buffer.from(params.data, 'base64');
  } catch {
    throw ErrorMapper.createError(JSONRPC_INVALID_PARAMS, 'Invalid params: data is not valid base64');
  }

  try {
    // Check existence for create/overwrite flags
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

    // Write using AtomicWriter
    const writer = new AtomicWriter();
    const writeResult = await writer.write(backend, normalizedPath, data, writeStrategy);

    return writeResult;
  } catch (error: any) {
    // If already mapped to RpcError (from inner catch or ErrorMapper.createError), re-throw as-is
    if (error && typeof error.code === 'number' && error.data && error.data.category) {
      throw error;
    }
    throw ErrorMapper.map(error, { path: normalizedPath, method: 'sftp/writeFile' });
  }
}


/**
 * Handle sftp/mkdir RPC method
 *
 * Creates a directory at the given path.
 * Returns {created: true} on success.
 * Throws -32012 if path already exists, -32010/-32011 for common errors.
 *
 * Requirements: 9.1, 9.4, 9.6
 */
export async function handleMkdir(
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

  try {
    await backend.mkdir(normalizedPath);
    return { created: true };
  } catch (error) {
    throw ErrorMapper.map(error, { path: normalizedPath, method: 'sftp/mkdir' });
  }
}

/**
 * Handle sftp/delete RPC method
 *
 * Deletes a file or directory at the given path.
 * Supports recursive deletion via `recursive` param (default false).
 * Returns {deleted: true} on success.
 * Throws -32010 if path not found, -32011 for permission denied.
 *
 * Requirements: 9.2, 9.5, 9.6, 9.7
 */
export async function handleDelete(
  params: any,
  sessionId: string,
  sessionManager: SessionManager
): Promise<any> {
  if (!params.path || typeof params.path !== 'string') {
    throw ErrorMapper.createError(JSONRPC_INVALID_PARAMS, 'Invalid params: path required');
  }

  const normalizedPath = PathNormalizer.normalize(params.path);
  const recursive = params.recursive !== undefined ? Boolean(params.recursive) : false;

  const session = sessionManager.getSession(sessionId);
  if (!session) {
    throw ErrorMapper.createError(-32000, 'No active session');
  }

  const backend = getBackend(session);

  try {
    await backend.delete(normalizedPath, recursive);
    return { deleted: true };
  } catch (error) {
    throw ErrorMapper.map(error, { path: normalizedPath, method: 'sftp/delete' });
  }
}

/**
 * Handle sftp/rename RPC method
 *
 * Renames/moves a file or directory from oldPath to newPath.
 * Returns {renamed: true} on success.
 * Throws -32010 if oldPath not found, -32011 for permission denied.
 *
 * Requirements: 9.3, 9.5, 9.6
 */
export async function handleRename(
  params: any,
  sessionId: string,
  sessionManager: SessionManager
): Promise<any> {
  if (!params.oldPath || typeof params.oldPath !== 'string') {
    throw ErrorMapper.createError(JSONRPC_INVALID_PARAMS, 'Invalid params: oldPath required');
  }
  if (!params.newPath || typeof params.newPath !== 'string') {
    throw ErrorMapper.createError(JSONRPC_INVALID_PARAMS, 'Invalid params: newPath required');
  }

  const normalizedOldPath = PathNormalizer.normalize(params.oldPath);
  const normalizedNewPath = PathNormalizer.normalize(params.newPath);

  const session = sessionManager.getSession(sessionId);
  if (!session) {
    throw ErrorMapper.createError(-32000, 'No active session');
  }

  const backend = getBackend(session);

  try {
    await backend.rename(normalizedOldPath, normalizedNewPath);
    return { renamed: true };
  } catch (error) {
    throw ErrorMapper.map(error, { path: normalizedOldPath, method: 'sftp/rename' });
  }
}
