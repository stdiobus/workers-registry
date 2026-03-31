/**
 * Property-Based Tests for Chunked I/O operations
 * 
 * Feature: sftp-vscode-plugin
 * 
 * Tests:
 * - Property 29: Chunked I/O read round-trip (Requirement 22.2)
 * - Property 30: Chunked I/O write round-trip (Requirement 22.3)
 * - Property 31: Chunk order validation (Requirement 22.4)
 * - Property 32: Handle expiry after timeout (Requirement 22.7)
 */

import fc from 'fast-check';
import { SessionManager } from '../session-manager.js';
import { FakeSftpBackend } from './fake-sftp-backend.js';
import { HandleManager } from '../handle-manager.js';
import {
  handleOpenRead,
  handleReadChunk,
  handleCloseRead,
  handleOpenWrite,
  handleWriteChunk,
  handleCommitWrite,
} from '../rpc/sftp-chunked-methods.js';

// ============================================================================
// Test Helpers
// ============================================================================

function createTestSession(handleTimeoutMs: number = 60000) {
  const sessionManager = new SessionManager();
  const backend = new FakeSftpBackend();
  const handleManager = new HandleManager(32, handleTimeoutMs);
  const sessionId = 'chunked-pbt-session';

  const session = sessionManager.createSession(sessionId);
  session.state = 'active';
  session.backend = backend;
  session.handleManager = handleManager;
  backend['connected'] = true;

  return { sessionManager, backend, handleManager, sessionId };
}

// ============================================================================
// Arbitraries
// ============================================================================

/** Arbitrary binary content up to 16KB to keep tests fast */
const arbBinaryContent = fc.uint8Array({ minLength: 0, maxLength: 16384 });

/** Arbitrary chunk size for reading (1 byte to 4KB) */
const arbChunkSize = fc.integer({ min: 1, max: 4096 });

/** Arbitrary filename segment */
const arbFilename = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')),
  { minLength: 1, maxLength: 16 }
);

// ============================================================================
// Property 29: Chunked I/O read round-trip
// ============================================================================

describe('Chunked I/O - Property-Based Tests', () => {

  /**
   * Property 29: Chunked I/O read round-trip
   * 
   * For any file content, reading via sftp/openRead → series of sftp/readChunk
   * (until eof: true) → sftp/closeRead and concatenating all chunks (base64 decode)
   * must produce content identical to the original.
   * 
   * **Validates: Requirements 22.2**
   */
  it('Property 29: read round-trip — chunked read reproduces original content', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbBinaryContent,
        arbChunkSize,
        arbFilename,
        async (content, chunkSize, filename) => {
          const { sessionManager, backend, sessionId, handleManager } = createTestSession();
          const path = `/${filename}.bin`;
          const buf = Buffer.from(content);

          // Seed file into fake backend
          backend.setFile(path, {
            type: 'file',
            content: buf,
            size: buf.length,
            mtime: 1700000000,
            atime: 1700000000,
            mode: 0o644,
          });

          let handleId: string | undefined;
          try {
            // Open read
            const openResult = await handleOpenRead({ path }, sessionId, sessionManager);
            handleId = openResult.handleId;
            expect(openResult.fileSize).toBe(buf.length);

            // Read all chunks
            const chunks: Buffer[] = [];
            let offset = 0;
            let eof = false;

            while (!eof) {
              const chunk = await handleReadChunk(
                { handleId, offset, length: chunkSize },
                sessionId, sessionManager
              );
              const decoded = Buffer.from(chunk.data, 'base64');
              // Decoded chunk length must not exceed requested length
              expect(decoded.length).toBeLessThanOrEqual(chunkSize);
              chunks.push(decoded);
              offset += chunk.length;
              eof = chunk.eof;
            }

            // Close read
            await handleCloseRead({ handleId }, sessionId, sessionManager);
            handleId = undefined;

            // Concatenated chunks must equal original
            const reconstructed = Buffer.concat(chunks);
            expect(reconstructed.equals(buf)).toBe(true);
          } finally {
            if (handleId) {
              try { await handleCloseRead({ handleId }, sessionId, sessionManager); } catch { /* cleanup */ }
            }
            handleManager.closeAll();
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // ==========================================================================
  // Property 30: Chunked I/O write round-trip
  // ==========================================================================

  /**
   * Property 30: Chunked I/O write round-trip
   * 
   * For any byte sequence, writing via sftp/openWrite → series of sftp/writeChunk
   * → sftp/commitWrite, then reading back must produce identical content.
   * 
   * **Validates: Requirements 22.3**
   */
  it('Property 30: write round-trip — chunked write then read produces identical content', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbBinaryContent,
        fc.integer({ min: 1, max: 4096 }),
        arbFilename,
        async (content, maxChunkSize, filename) => {
          const { sessionManager, backend, sessionId, handleManager } = createTestSession();
          const path = `/${filename}.dat`;
          const buf = Buffer.from(content);

          let handleId: string | undefined;
          try {
            // Open write
            const openResult = await handleOpenWrite({ path }, sessionId, sessionManager);
            handleId = openResult.handleId;

            // Write in chunks with variable boundaries
            let offset = 0;
            while (offset < buf.length) {
              const end = Math.min(offset + maxChunkSize, buf.length);
              const chunk = buf.subarray(offset, end);
              const result = await handleWriteChunk(
                { handleId, offset, data: chunk.toString('base64') },
                sessionId, sessionManager
              );
              expect(result.written).toBe(chunk.length);
              offset = end;
            }

            // Commit
            const commitResult = await handleCommitWrite({ handleId }, sessionId, sessionManager);
            handleId = undefined;
            expect(commitResult.committed).toBe(true);
            expect(commitResult.size).toBe(buf.length);
            expect(typeof commitResult.sha256).toBe('string');
            expect(commitResult.sha256).toHaveLength(64);

            // Read back from backend and verify
            const readBack = await backend.readFile(path);
            expect(readBack.equals(buf)).toBe(true);

            // Verify sha256
            const { createHash } = await import('crypto');
            const expectedSha256 = createHash('sha256').update(buf).digest('hex');
            expect(commitResult.sha256).toBe(expectedSha256);
          } finally {
            handleManager.closeAll();
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // ==========================================================================
  // Property 31: Chunk order validation
  // ==========================================================================

  /**
   * Property 31: Chunk order validation
   * 
   * For any write handle, sending chunks with non-sequential offsets must
   * produce error -32031 (INVALID_CHUNK).
   * 
   * **Validates: Requirements 22.4**
   */
  it('Property 31: non-sequential offsets produce INVALID_CHUNK error', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 1, maxLength: 256 }),
        fc.uint8Array({ minLength: 1, maxLength: 256 }),
        fc.constantFrom('smaller', 'larger') as fc.Arbitrary<'smaller' | 'larger'>,
        arbFilename,
        async (firstChunk, secondChunk, offsetType, filename) => {
          const { sessionManager, sessionId, handleManager } = createTestSession();
          const path = `/${filename}.tmp`;
          const firstBuf = Buffer.from(firstChunk);
          const secondBuf = Buffer.from(secondChunk);

          let handleId: string | undefined;
          try {
            // Open write
            const openResult = await handleOpenWrite({ path }, sessionId, sessionManager);
            handleId = openResult.handleId;

            // Write first chunk at offset 0
            await handleWriteChunk(
              { handleId, offset: 0, data: firstBuf.toString('base64') },
              sessionId, sessionManager
            );

            // Expected next offset is firstBuf.length
            const expectedOffset = firstBuf.length;
            // Compute a wrong offset
            let wrongOffset: number;
            if (offsetType === 'smaller') {
              wrongOffset = Math.max(0, expectedOffset - 1);
            } else {
              wrongOffset = expectedOffset + 1;
            }

            // Skip if wrongOffset accidentally equals expectedOffset
            if (wrongOffset === expectedOffset) {
              return;
            }

            // Attempt to write at wrong offset — must fail with -32031
            try {
              await handleWriteChunk(
                { handleId, offset: wrongOffset, data: secondBuf.toString('base64') },
                sessionId, sessionManager
              );
              // Should not reach here
              throw new Error('Expected INVALID_CHUNK error but writeChunk succeeded');
            } catch (err: any) {
              expect(err.code).toBe(-32031);
            }
          } finally {
            handleManager.closeAll();
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // ==========================================================================
  // Property 32: Handle expiry after timeout
  // ==========================================================================

  /**
   * Property 32: Handle expiry after timeout
   * 
   * For any handle, after the TTL expires, get() must throw -32032
   * (INVALID_OR_EXPIRED_HANDLE).
   * 
   * **Validates: Requirements 22.7**
   */
  it('Property 32: expired handles throw INVALID_OR_EXPIRED_HANDLE', () => {
    jest.useFakeTimers();

    try {
      fc.assert(
        fc.property(
          fc.constantFrom('read', 'write') as fc.Arbitrary<'read' | 'write'>,
          fc.integer({ min: 100, max: 5000 }),
          arbFilename,
          (handleType, ttlMs, filename) => {
            const handleManager = new HandleManager(32, ttlMs);
            const path = `/${filename}.bin`;

            // Create a dummy stream
            const { Readable, Writable } = require('stream');
            const stream = handleType === 'read'
              ? Readable.from([Buffer.from('test')])
              : new Writable({ write(_c: any, _e: any, cb: any) { cb(); } });

            // Open handle
            const handleId = handleManager.open(handleType, path, stream);

            // Handle should be accessible before TTL
            const handle = handleManager.get(handleId);
            expect(handle.handleId).toBe(handleId);

            // Advance time past TTL
            jest.advanceTimersByTime(ttlMs + 1);

            // Handle should now be expired
            try {
              handleManager.get(handleId);
              throw new Error('Expected INVALID_OR_EXPIRED_HANDLE but get() succeeded');
            } catch (err: any) {
              expect(err.code).toBe(-32032);
            }

            // Cleanup
            handleManager.closeAll();
          }
        ),
        { numRuns: 100 }
      );
    } finally {
      jest.useRealTimers();
    }
  });
});
