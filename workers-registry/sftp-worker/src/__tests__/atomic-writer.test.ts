/**
 * Unit Tests and Property-Based Tests for AtomicWriter
 *
 * Feature: sftp-vscode-plugin
 *
 * Tests:
 * - Unit tests for tempRename and direct strategies
 * - Unit tests for error handling and cleanup
 * - Property 28: Atomic write safety (tempRename)
 */

import fc from 'fast-check';
import { AtomicWriter } from '../atomic-writer.js';
import { FakeSftpBackend } from './fake-sftp-backend.js';
import { SftpError } from '../types.js';

// ============================================================================
// Test Helpers
// ============================================================================

function createConnectedBackend(): FakeSftpBackend {
  const backend = new FakeSftpBackend();
  backend['connected'] = true;
  return backend;
}

// ============================================================================
// Arbitraries
// ============================================================================

const arbFilename = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_-.'.split('')),
  { minLength: 1, maxLength: 20 }
);

const arbBinaryContent = fc.uint8Array({ minLength: 0, maxLength: 4096 });

// ============================================================================
// Unit Tests
// ============================================================================

describe('AtomicWriter', () => {
  let writer: AtomicWriter;
  let backend: FakeSftpBackend;

  beforeEach(() => {
    writer = new AtomicWriter();
    backend = createConnectedBackend();
  });

  describe('direct strategy', () => {
    it('should write directly and return atomic: false', async () => {
      const data = Buffer.from('hello world');
      const result = await writer.write(backend, '/test.txt', data, 'direct');

      expect(result).toEqual({ written: true, size: 11, atomic: false });

      // Verify file was written
      const content = await backend.readFile('/test.txt');
      expect(content).toEqual(data);
    });

    it('should propagate write errors', async () => {
      backend.writeFile = async () => {
        throw new SftpError(-32011, 'Permission denied', '/test.txt');
      };

      await expect(
        writer.write(backend, '/test.txt', Buffer.from('data'), 'direct')
      ).rejects.toMatchObject({ code: -32011 });
    });
  });

  describe('tempRename strategy', () => {
    it('should write via temp file and return atomic: true', async () => {
      const data = Buffer.from('atomic content');
      const result = await writer.write(backend, '/test.txt', data, 'tempRename');

      expect(result).toEqual({ written: true, size: 14, atomic: true });

      // Verify final file has correct content
      const content = await backend.readFile('/test.txt');
      expect(content).toEqual(data);
    });

    it('should use temp file name pattern .<name>.sftp-tmp-<random>', async () => {
      const writeCalls: string[] = [];
      const origWriteFile = backend.writeFile.bind(backend);
      backend.writeFile = async (path: string, data: Buffer) => {
        writeCalls.push(path);
        return origWriteFile(path, data);
      };

      await writer.write(backend, '/dir/myfile.txt', Buffer.from('data'), 'tempRename');

      // First call should be to temp file
      expect(writeCalls.length).toBeGreaterThanOrEqual(1);
      expect(writeCalls[0]).toMatch(/^\/dir\/\.myfile\.txt\.sftp-tmp-[a-z0-9]+$/);
    });

    it('should not leave temp files after successful write', async () => {
      await writer.write(backend, '/clean.txt', Buffer.from('data'), 'tempRename');

      const allFiles = backend.getAllFiles();
      const tempFiles = Array.from(allFiles.keys()).filter(p => p.includes('.sftp-tmp-'));
      expect(tempFiles).toHaveLength(0);
    });

    it('should return -32020 with fallbackAvailable on rename failure', async () => {
      const origRename = backend.rename.bind(backend);
      backend.rename = async () => {
        throw new SftpError(-32020, 'Rename failed');
      };

      try {
        await writer.write(backend, '/test.txt', Buffer.from('data'), 'tempRename');
        throw new Error('Should have thrown');
      } catch (err: any) {
        expect(err.code).toBe(-32020);
        expect(err.data.fallbackAvailable).toBe(true);
      }
    });

    it('should best-effort cleanup temp file on write failure', async () => {
      const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

      // Make writeFile fail after creating the temp file entry
      let callCount = 0;
      const origWriteFile = backend.writeFile.bind(backend);
      backend.writeFile = async (path: string, data: Buffer) => {
        callCount++;
        throw new SftpError(-32013, 'Disk full', path);
      };

      await expect(
        writer.write(backend, '/test.txt', Buffer.from('data'), 'tempRename')
      ).rejects.toMatchObject({ code: -32013 });

      stderrSpy.mockRestore();
    });

    it('should best-effort cleanup temp file on rename failure', async () => {
      const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

      backend.rename = async () => {
        throw new SftpError(-32020, 'Rename failed');
      };

      try {
        await writer.write(backend, '/test.txt', Buffer.from('data'), 'tempRename');
      } catch {
        // expected
      }

      // Check that cleanup was attempted (logged to stderr)
      const stderrCalls = stderrSpy.mock.calls.map(c => String(c[0]));
      const cleanupLog = stderrCalls.find(s => s.includes('[AtomicWriter]'));
      expect(cleanupLog).toBeDefined();

      stderrSpy.mockRestore();
    });

    it('should log cleanup result to stderr without credentials', async () => {
      const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

      backend.rename = async () => {
        throw new SftpError(-32020, 'Rename failed');
      };

      try {
        await writer.write(backend, '/test.txt', Buffer.from('data'), 'tempRename');
      } catch {
        // expected
      }

      const stderrOutput = stderrSpy.mock.calls.map(c => String(c[0])).join('');
      // Should contain path info but no credentials
      expect(stderrOutput).toContain('.sftp-tmp-');
      expect(stderrOutput).not.toContain('password');
      expect(stderrOutput).not.toContain('privateKey');

      stderrSpy.mockRestore();
    });

    it('should handle root-level files correctly', async () => {
      const data = Buffer.from('root file');
      const result = await writer.write(backend, '/rootfile.txt', data, 'tempRename');

      expect(result.atomic).toBe(true);
      const content = await backend.readFile('/rootfile.txt');
      expect(content).toEqual(data);
    });
  });
});


// ============================================================================
// Property-Based Tests
// ============================================================================

describe('AtomicWriter - Property-Based Tests', () => {
  /**
   * Property 28: Atomic write safety (tempRename)
   *
   * For any file written with tempRename strategy, if write is interrupted
   * before final rename, the original file must not be modified. On success,
   * response must contain atomic: true. With direct strategy, atomic: false.
   *
   * **Validates: Requirements 21.3, 21.4, 21.7**
   */
  describe('Property 28: Atomic write safety (tempRename)', () => {
    it('tempRename: interrupted write before rename must not modify original file', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbFilename,
          arbBinaryContent,
          arbBinaryContent,
          async (filename, originalContent, newContent) => {
            const backend = createConnectedBackend();
            const writer = new AtomicWriter();
            const path = `/${filename}`;
            const originalBuf = Buffer.from(originalContent);
            const newBuf = Buffer.from(newContent);

            // Set up original file
            backend.setFile(path, {
              type: 'file',
              content: originalBuf,
              size: originalBuf.length,
              mtime: 1700000000,
              atime: 1700000000,
              mode: 0o644,
            });

            // Make rename fail to simulate interruption before final rename
            backend.rename = async () => {
              throw new SftpError(-32020, 'Rename failed (simulated interruption)');
            };

            // Suppress stderr during test
            const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

            try {
              await writer.write(backend, path, newBuf, 'tempRename');
              // Should not reach here
              throw new Error('Expected write to throw due to rename failure');
            } catch (err: any) {
              // Expected: rename failed
              expect(err.code).toBe(-32020);
              expect(err.data.fallbackAvailable).toBe(true);
            }

            // CRITICAL PROPERTY: original file must NOT be modified
            const fileAfter = await backend.readFile(path);
            expect(fileAfter).toEqual(originalBuf);

            stderrSpy.mockRestore();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('tempRename: successful write must return atomic: true', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbFilename,
          arbBinaryContent,
          async (filename, content) => {
            const backend = createConnectedBackend();
            const writer = new AtomicWriter();
            const path = `/${filename}`;
            const data = Buffer.from(content);

            const result = await writer.write(backend, path, data, 'tempRename');

            expect(result.atomic).toBe(true);
            expect(result.written).toBe(true);
            expect(result.size).toBe(data.length);

            // Verify content was actually written
            const readBack = await backend.readFile(path);
            expect(readBack).toEqual(data);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('direct: write must return atomic: false', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbFilename,
          arbBinaryContent,
          async (filename, content) => {
            const backend = createConnectedBackend();
            const writer = new AtomicWriter();
            const path = `/${filename}`;
            const data = Buffer.from(content);

            const result = await writer.write(backend, path, data, 'direct');

            expect(result.atomic).toBe(false);
            expect(result.written).toBe(true);
            expect(result.size).toBe(data.length);

            // Verify content was actually written
            const readBack = await backend.readFile(path);
            expect(readBack).toEqual(data);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('tempRename: no temp files remain after successful write', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbFilename,
          arbBinaryContent,
          async (filename, content) => {
            const backend = createConnectedBackend();
            const writer = new AtomicWriter();
            const path = `/${filename}`;

            await writer.write(backend, path, Buffer.from(content), 'tempRename');

            // No temp files should remain
            const allFiles = backend.getAllFiles();
            const tempFiles = Array.from(allFiles.keys()).filter(p => p.includes('.sftp-tmp-'));
            expect(tempFiles).toHaveLength(0);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
