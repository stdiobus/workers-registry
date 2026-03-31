/**
 * Property-Based Tests for HandleManager and Chunked I/O
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
import { HandleManager } from '../handle-manager.js';
import { FakeSftpBackend } from './fake-sftp-backend.js';
import {
  handleOpenRead,
  handleReadChunk,
  handleCloseRead,
  handleOpenWrite,
  handleWriteChunk,
  handleCommitWrite,
  handleAbortWrite,
} from '../rpc/sftp-chunked-methods.js';

// ============================================================================
// Test Helpers
// ============================================================================

function createTestSession(handleTimeoutMs: number = 60000): {
  sessionManager: SessionManager;
  backend: FakeSftpBackend;
  sessionId: string;
  handleManager: HandleManager;
} {
  const sessionManager = new SessionManager();
  const backend = new FakeSftpBackend();
  const handleManager = new HandleManager(32, handleTimeoutMs);
  const sessionId = 'chunked-io-session';
  const session = sessionManager.createSession(sessionId);
  session.state = 'active';
  session.backend = backend;
  session.handleManager = handleManager;
  backend['connected'] = true;
  return { sessionManager, backend, sessionId, handleManager };
}

// ============================================================================
// Arbitraries
// ============================================================================

const arbFilename = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_-'.split('')),
  { minLength: 1, maxLength: 20 }
);

const arbBinaryContent = fc.uint8Array({ minLength: 1, maxLength: 4096 });

/**
 * Generate a chunk size for reading (between 1 and 2048 bytes)
 */
const arbChunkSize = fc.integer({ min: 1, max: 2048 });

// ============================================================================
// Property-Based Tests
// ============================================================================

describe('HandleManager and Chunked I/O - Property-Based Tests', () => {
  /**
   * Property 29: Chunked I/O read round-trip
   * 
   * For any file, reading via sftp/openRead → series of sftp/readChunk
   * (until eof: true) → sftp/closeRead and concatenating all chunks
   * (base64 decode) must produce a byte sequence identical to the file content.
   * 
   * Feature: sftp-vscode-plugin, Property 29: Chunked I/O read round-trip
   * 
   * **Validates: Requirements 22.2**
   */
  describe('Property 29: Chunked I/O read round-trip', () => {
    it('reading file in chunks should produce identical content', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbFilename,
          arbBinaryContent,
          arbChunkSize,
          async (filename, content, chunkSize) => {
            const { sessionManager, backend, sessionId, handleManager } = createTestSession();
            const path = `/${filename}`;

            // Write file to backend
            await backend.writeFile(path, Buffer.from(content));

            // Open read handle
            const openResult = await handleOpenRead(
              { path },
              sessionId,
              sessionManager
            );
            expect(openResult.handleId).toBeDefined();
            expect(typeof openResult.handleId).toBe('string');
            expect(openResult.fileSize).toBe(content.length);

            // Read all chunks
            const allChunks: Buffer[] = [];
            let offset = 0;
            let eof = false;

            while (!eof) {
              const chunkResult = await handleReadChunk(
                { handleId: openResult.handleId, offset, length: chunkSize },
                sessionId,
                sessionManager
              );

              expect(typeof chunkResult.data).toBe('string');
              expect(typeof chunkResult.offset).toBe('number');
              expect(typeof chunkResult.length).toBe('number');
              expect(typeof chunkResult.eof).toBe('boolean');
              expect(chunkResult.offset).toBe(offset);

              const chunkData = Buffer.from(chunkResult.data, 'base64');
              expect(chunkData.length).toBe(chunkResult.length);

              if (chunkData.length > 0) {
                allChunks.push(chunkData);
              }
              offset += chunkResult.length;
              eof = chunkResult.eof;
            }

            // Close read handle
            const closeResult = await handleCloseRead(
              { handleId: openResult.handleId },
              sessionId,
              sessionManager
            );
            expect(closeResult).toEqual({ closed: true });

            // Concatenate and compare
            const reconstructed = Buffer.concat(allChunks);
            expect(reconstructed).toEqual(Buffer.from(content));

            // Cleanup
            handleManager.closeAll();
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 30: Chunked I/O write round-trip
   * 
   * For any data, writing via sftp/openWrite → series of sftp/writeChunk
   * → sftp/commitWrite, then reading the file via sftp/readFile must
   * produce data identical to the original.
   * 
   * Feature: sftp-vscode-plugin, Property 30: Chunked I/O write round-trip
   * 
   * **Validates: Requirements 22.3**
   */
  describe('Property 30: Chunked I/O write round-trip', () => {
    it('writing file in chunks then reading should produce identical content', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbFilename,
          arbBinaryContent,
          arbChunkSize,
          async (filename, content, chunkSize) => {
            const { sessionManager, backend, sessionId, handleManager } = createTestSession();
            const path = `/${filename}`;

            // Open write handle
            const openResult = await handleOpenWrite(
              { path },
              sessionId,
              sessionManager
            );
            expect(openResult.handleId).toBeDefined();
            expect(typeof openResult.handleId).toBe('string');

            // Write in chunks
            const buf = Buffer.from(content);
            let offset = 0;

            while (offset < buf.length) {
              const end = Math.min(offset + chunkSize, buf.length);
              const chunkData = buf.subarray(offset, end);
              const base64Chunk = chunkData.toString('base64');

              const writeResult = await handleWriteChunk(
                { handleId: openResult.handleId, offset, data: base64Chunk },
                sessionId,
                sessionManager
              );

              expect(writeResult.written).toBe(chunkData.length);
              offset = end;
            }

            // Commit
            const commitResult = await handleCommitWrite(
              { handleId: openResult.handleId },
              sessionId,
              sessionManager
            );
            expect(commitResult.committed).toBe(true);
            expect(commitResult.size).toBe(buf.length);
            expect(typeof commitResult.sha256).toBe('string');
            expect(commitResult.sha256.length).toBe(64); // hex sha256

            // Read back via backend and compare
            const readBack = await backend.readFile(path);
            expect(readBack).toEqual(buf);

            // Cleanup
            handleManager.closeAll();
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 31: Chunk order validation
   * 
   * For any write handle, sending a chunk with offset != expected next offset
   * must be rejected with code -32031 (INVALID_CHUNK).
   * 
   * Feature: sftp-vscode-plugin, Property 31: Chunk order validation
   * 
   * **Validates: Requirements 22.4**
   */
  describe('Property 31: Chunk order validation', () => {
    it('out-of-order chunk offset should be rejected with -32031', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbFilename,
          fc.uint8Array({ minLength: 10, maxLength: 512 }),
          fc.integer({ min: 1, max: 1024 }),
          async (filename, content, badOffset) => {
            const { sessionManager, backend, sessionId, handleManager } = createTestSession();
            const path = `/${filename}`;

            // Open write handle
            const openResult = await handleOpenWrite(
              { path },
              sessionId,
              sessionManager
            );

            // The first expected offset is 0, so any badOffset != 0 should fail
            // Ensure badOffset is not 0
            const actualBadOffset = badOffset === 0 ? 1 : badOffset;

            const base64Data = Buffer.from(content).toString('base64');

            try {
              await handleWriteChunk(
                { handleId: openResult.handleId, offset: actualBadOffset, data: base64Data },
                sessionId,
                sessionManager
              );
              // Should not reach here
              expect(true).toBe(false);
            } catch (error: any) {
              expect(error.code).toBe(-32031);
            }

            // Cleanup
            handleManager.closeAll();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('correct sequential offsets should be accepted', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbFilename,
          fc.array(fc.uint8Array({ minLength: 1, maxLength: 256 }), { minLength: 1, maxLength: 5 }),
          async (filename, chunks) => {
            const { sessionManager, backend, sessionId, handleManager } = createTestSession();
            const path = `/${filename}`;

            const openResult = await handleOpenWrite(
              { path },
              sessionId,
              sessionManager
            );

            let offset = 0;
            for (const chunk of chunks) {
              const base64Data = Buffer.from(chunk).toString('base64');
              const result = await handleWriteChunk(
                { handleId: openResult.handleId, offset, data: base64Data },
                sessionId,
                sessionManager
              );
              expect(result.written).toBe(chunk.length);
              offset += chunk.length;
            }

            // Cleanup
            handleManager.closeAll();
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 32: Handle expiry after timeout
   * 
   * For any handle left idle longer than handleTimeoutMs, subsequent
   * readChunk/writeChunk must return -32032 (INVALID_OR_EXPIRED_HANDLE).
   * 
   * Feature: sftp-vscode-plugin, Property 32: Handle expiry after timeout
   * 
   * **Validates: Requirements 22.7**
   */
  describe('Property 32: Handle expiry after timeout', () => {
    it('expired read handle should return -32032', async () => {
      // Use a very short timeout for testing
      const TIMEOUT_MS = 50;

      await fc.assert(
        fc.asyncProperty(
          arbFilename,
          fc.uint8Array({ minLength: 1, maxLength: 256 }),
          async (filename, content) => {
            const { sessionManager, backend, sessionId, handleManager } = createTestSession(TIMEOUT_MS);
            const path = `/${filename}`;

            // Write file to backend
            await backend.writeFile(path, Buffer.from(content));

            // Open read handle
            const openResult = await handleOpenRead(
              { path },
              sessionId,
              sessionManager
            );

            // Wait for handle to expire
            await new Promise(resolve => setTimeout(resolve, TIMEOUT_MS + 20));

            // Attempt to read — should fail with -32032
            try {
              await handleReadChunk(
                { handleId: openResult.handleId, offset: 0, length: 100 },
                sessionId,
                sessionManager
              );
              // Should not reach here
              expect(true).toBe(false);
            } catch (error: any) {
              expect(error.code).toBe(-32032);
            }

            // Cleanup
            handleManager.closeAll();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('expired write handle should return -32032', async () => {
      const TIMEOUT_MS = 50;

      await fc.assert(
        fc.asyncProperty(
          arbFilename,
          async (filename) => {
            const { sessionManager, backend, sessionId, handleManager } = createTestSession(TIMEOUT_MS);
            const path = `/${filename}`;

            // Open write handle
            const openResult = await handleOpenWrite(
              { path },
              sessionId,
              sessionManager
            );

            // Wait for handle to expire
            await new Promise(resolve => setTimeout(resolve, TIMEOUT_MS + 20));

            // Attempt to write — should fail with -32032
            const base64Data = Buffer.from('test').toString('base64');
            try {
              await handleWriteChunk(
                { handleId: openResult.handleId, offset: 0, data: base64Data },
                sessionId,
                sessionManager
              );
              expect(true).toBe(false);
            } catch (error: any) {
              expect(error.code).toBe(-32032);
            }

            // Cleanup
            handleManager.closeAll();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('handle accessed within timeout should remain valid', async () => {
      const TIMEOUT_MS = 200;

      await fc.assert(
        fc.asyncProperty(
          arbFilename,
          fc.uint8Array({ minLength: 1, maxLength: 256 }),
          async (filename, content) => {
            const { sessionManager, backend, sessionId, handleManager } = createTestSession(TIMEOUT_MS);
            const path = `/${filename}`;

            await backend.writeFile(path, Buffer.from(content));

            const openResult = await handleOpenRead(
              { path },
              sessionId,
              sessionManager
            );

            // Access within timeout — should succeed
            await new Promise(resolve => setTimeout(resolve, TIMEOUT_MS / 3));

            const chunkResult = await handleReadChunk(
              { handleId: openResult.handleId, offset: 0, length: content.length + 10 },
              sessionId,
              sessionManager
            );
            expect(chunkResult.data).toBeDefined();

            // Cleanup
            handleManager.closeAll();
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
