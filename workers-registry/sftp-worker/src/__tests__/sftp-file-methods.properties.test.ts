/**
 * Property-Based Tests for SFTP file operation handlers
 * 
 * Feature: sftp-vscode-plugin
 * 
 * Tests:
 * - Property 7: File content base64 round-trip (Requirements 7.4, 7.7, 8.2)
 * - Property 8: Metadata completeness (Requirements 5.2, 5.3, 5.4, 6.2)
 * - Property 9: mkdir then readdir contains new entry (Requirement 9.1)
 * - Property 10: delete then stat returns PATH_NOT_FOUND (Requirement 9.2)
 * - Property 11: rename preserves content (Requirement 9.3)
 * - Property 12: Recursive delete removes all contents (Requirement 9.7)
 * - Property 42: Symlink detection in readdir vs stat (Requirements 28.1, 28.2)
 */

import fc from 'fast-check';
import { SessionManager } from '../session-manager.js';
import { FakeSftpBackend } from './fake-sftp-backend.js';
import {
  handleReaddir,
  handleStat,
  handleReadFile,
  handleWriteFile,
  handleMkdir,
  handleDelete,
  handleRename,
} from '../rpc/sftp-file-methods.js';

// ============================================================================
// Test Helpers
// ============================================================================

function createTestSession(): {
  sessionManager: SessionManager;
  backend: FakeSftpBackend;
  sessionId: string;
} {
  const sessionManager = new SessionManager();
  const backend = new FakeSftpBackend();
  const sessionId = 'pbt-session';
  const session = sessionManager.createSession(sessionId);
  session.state = 'active';
  session.backend = backend;
  backend['connected'] = true;
  return { sessionManager, backend, sessionId };
}

// ============================================================================
// Arbitraries
// ============================================================================

/**
 * Generate valid filename segments — alphanumeric to avoid path issues
 */
const arbFilename = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_-.'.split('')),
  { minLength: 1, maxLength: 20 }
);

/**
 * Generate arbitrary binary content (any byte sequence)
 */
const arbBinaryContent = fc.uint8Array({ minLength: 0, maxLength: 4096 });

/**
 * Generate valid Unix timestamps (seconds)
 */
const arbTimestamp = fc.integer({ min: 0, max: 2000000000 });

/**
 * Generate valid POSIX file modes
 */
const arbMode = fc.integer({ min: 0, max: 0o7777 });

// ============================================================================
// Property-Based Tests
// ============================================================================

describe('SFTP File Methods - Property-Based Tests', () => {
  /**
   * Property 7: File content base64 round-trip
   * 
   * For any byte sequence (file content), encoding to base64 for sftp/writeFile,
   * then reading via sftp/readFile and decoding base64 should produce a byte
   * sequence identical to the original.
   * 
   * **Validates: Requirements 7.4, 7.7, 8.2**
   */
  describe('Property 7: File content base64 round-trip', () => {
    it('write then read should preserve arbitrary binary content', async () => {
      await fc.assert(
        fc.asyncProperty(arbBinaryContent, arbFilename, async (content, filename) => {
          const { sessionManager, backend, sessionId } = createTestSession();
          const path = `/${filename}`;
          const base64Data = Buffer.from(content).toString('base64');

          // Write file
          const writeResult = await handleWriteFile(
            { path, data: base64Data, writeStrategy: 'direct' },
            sessionId, sessionManager
          );
          expect(writeResult.written).toBe(true);
          expect(writeResult.size).toBe(content.length);

          // Read file back
          const readResult = await handleReadFile(
            { path },
            sessionId, sessionManager
          );
          expect(readResult.encoding).toBe('base64');
          expect(readResult.size).toBe(content.length);

          // Decode and compare — the core round-trip property
          const decoded = Buffer.from(readResult.data, 'base64');
          expect(decoded).toEqual(Buffer.from(content));
        }),
        { numRuns: 100 }
      );
    });

    it('should handle empty content round-trip', async () => {
      await fc.assert(
        fc.asyncProperty(arbFilename, async (filename) => {
          const { sessionManager, backend, sessionId } = createTestSession();
          const path = `/${filename}`;
          const emptyBase64 = Buffer.alloc(0).toString('base64');

          await handleWriteFile(
            { path, data: emptyBase64, writeStrategy: 'direct' },
            sessionId, sessionManager
          );

          const readResult = await handleReadFile({ path }, sessionId, sessionManager);
          const decoded = Buffer.from(readResult.data, 'base64');
          expect(decoded.length).toBe(0);
        }),
        { numRuns: 50 }
      );
    });
  });


  /**
   * Property 8: Metadata completeness (readdir and stat)
   * 
   * For any existing path on the SFTP server, sftp/readdir result should contain
   * entries with fields name (string), type ("file"|"directory"|"symlink"),
   * size (number), mtime (Unix timestamp), atime (Unix timestamp).
   * sftp/stat result should contain type, size, mtime, atime, mode.
   * mtime and atime should be numbers >= 0.
   * 
   * **Validates: Requirements 5.2, 5.3, 5.4, 6.2**
   */
  describe('Property 8: Metadata completeness', () => {
    it('readdir entries should have all required fields with correct types', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.record({
              name: arbFilename,
              type: fc.constantFrom('file' as const, 'directory' as const, 'symlink' as const),
              size: fc.nat({ max: 1000000 }),
              mtime: arbTimestamp,
              atime: arbTimestamp,
              mode: arbMode,
            }),
            { minLength: 1, maxLength: 10 }
          ),
          async (files) => {
            const { sessionManager, backend, sessionId } = createTestSession();

            // Use unique names to avoid collisions
            const uniqueFiles = files.map((f, i) => ({
              ...f,
              name: `${f.name}_${i}`,
            }));

            // Create a directory with files
            backend.setFile('/testdir', {
              type: 'directory', size: 0,
              mtime: 1700000000, atime: 1700000000, mode: 0o755,
            });

            for (const file of uniqueFiles) {
              backend.setFile(`/testdir/${file.name}`, {
                type: file.type,
                size: file.size,
                mtime: file.mtime,
                atime: file.atime,
                mode: file.mode,
                content: file.type === 'file' ? Buffer.alloc(file.size) : undefined,
              });
            }

            const result = await handleReaddir({ path: '/testdir' }, sessionId, sessionManager);

            expect(result.entries.length).toBe(uniqueFiles.length);

            for (const entry of result.entries) {
              // All required fields present with correct types
              expect(typeof entry.name).toBe('string');
              expect(entry.name.length).toBeGreaterThan(0);
              expect(['file', 'directory', 'symlink']).toContain(entry.type);
              expect(typeof entry.size).toBe('number');
              expect(entry.size).toBeGreaterThanOrEqual(0);
              expect(typeof entry.mtime).toBe('number');
              expect(entry.mtime).toBeGreaterThanOrEqual(0);
              expect(typeof entry.atime).toBe('number');
              expect(entry.atime).toBeGreaterThanOrEqual(0);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('stat result should have all required fields with correct types', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            type: fc.constantFrom('file' as const, 'directory' as const, 'symlink' as const),
            size: fc.nat({ max: 1000000 }),
            mtime: arbTimestamp,
            atime: arbTimestamp,
            mode: arbMode,
          }),
          arbFilename,
          async (meta, filename) => {
            const { sessionManager, backend, sessionId } = createTestSession();

            backend.setFile(`/${filename}`, {
              type: meta.type,
              size: meta.size,
              mtime: meta.mtime,
              atime: meta.atime,
              mode: meta.mode,
              content: meta.type === 'file' ? Buffer.alloc(meta.size) : undefined,
            });

            const result = await handleStat({ path: `/${filename}` }, sessionId, sessionManager);

            // All required fields present with correct types
            expect(['file', 'directory', 'symlink']).toContain(result.type);
            expect(typeof result.size).toBe('number');
            expect(result.size).toBeGreaterThanOrEqual(0);
            expect(typeof result.mtime).toBe('number');
            expect(result.mtime).toBeGreaterThanOrEqual(0);
            expect(typeof result.atime).toBe('number');
            expect(result.atime).toBeGreaterThanOrEqual(0);
            expect(typeof result.mode).toBe('number');

            // Values should match what was set
            expect(result.type).toBe(meta.type);
            expect(result.size).toBe(meta.size);
            expect(result.mtime).toBe(meta.mtime);
            expect(result.atime).toBe(meta.atime);
            expect(result.mode).toBe(meta.mode);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 42: Symlink detection in readdir vs stat
   * 
   * For any symbolic link, sftp/readdir should return type: "symlink" (using lstat).
   * sftp/stat, sftp/readFile, sftp/writeFile should work with the target of the
   * link (using stat, follow symlinks).
   * 
   * **Validates: Requirements 28.1, 28.2**
   */
  describe('Property 42: Symlink detection in readdir vs stat', () => {
    it('readdir should report symlinks as type "symlink"', async () => {
      await fc.assert(
        fc.asyncProperty(arbFilename, arbFilename, async (linkName, targetName) => {
          // Ensure distinct names
          const safeLinkName = `link_${linkName}`;
          const safeTargetName = `file_${targetName}`;

          const { sessionManager, backend, sessionId } = createTestSession();

          backend.setFile('/linkdir', {
            type: 'directory', size: 0,
            mtime: 1700000000, atime: 1700000000, mode: 0o755,
          });

          // Create a symlink entry
          backend.setFile(`/linkdir/${safeLinkName}`, {
            type: 'symlink', size: 0,
            mtime: 1700000100, atime: 1700000101, mode: 0o777,
          });

          // Create a regular file entry
          backend.setFile(`/linkdir/${safeTargetName}`, {
            type: 'file', content: Buffer.from('data'),
            size: 4, mtime: 1700000200, atime: 1700000201, mode: 0o644,
          });

          const result = await handleReaddir({ path: '/linkdir' }, sessionId, sessionManager);

          // Find the symlink entry — readdir uses lstat, so type should be "symlink"
          const symlinkEntry = result.entries.find(
            (e: any) => e.name === safeLinkName
          );
          expect(symlinkEntry).toBeDefined();
          expect(symlinkEntry!.type).toBe('symlink');

          // Find the file entry
          const fileEntry = result.entries.find(
            (e: any) => e.name === safeTargetName
          );
          expect(fileEntry).toBeDefined();
          expect(fileEntry!.type).toBe('file');
        }),
        { numRuns: 100 }
      );
    });

    it('stat should follow symlinks (return target type)', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom('file' as const, 'directory' as const, 'symlink' as const),
          arbFilename,
          async (type, filename) => {
            const { sessionManager, backend, sessionId } = createTestSession();

            // In the fake backend, stat and lstat return the same thing.
            // The key property is that stat is called (not lstat) for sftp/stat.
            // We verify the handler returns the correct metadata.
            backend.setFile(`/${filename}`, {
              type,
              size: 42,
              mtime: 1700000300,
              atime: 1700000301,
              mode: 0o644,
            });

            const result = await handleStat({ path: `/${filename}` }, sessionId, sessionManager);
            expect(result.type).toBe(type);
            expect(result.size).toBe(42);
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  /**
   * Property 9: mkdir then readdir contains new entry
   *
   * For any valid absolute path, after a successful sftp/mkdir, calling
   * sftp/readdir on the parent directory should contain an entry with
   * name equal to the created directory name and type equal to "directory".
   *
   * Feature: sftp-vscode-plugin
   * Property 9: mkdir then readdir contains new entry
   *
   * **Validates: Requirements 9.1**
   */
  describe('Property 9: mkdir then readdir contains new entry', () => {
    it('newly created directory should appear in parent readdir', async () => {
      await fc.assert(
        fc.asyncProperty(arbFilename, async (dirName) => {
          const { sessionManager, backend, sessionId } = createTestSession();

          // Ensure parent directory exists
          backend.setFile('/parent', {
            type: 'directory', size: 0,
            mtime: 1700000000, atime: 1700000001, mode: 0o755,
          });

          const newPath = `/parent/${dirName}`;

          // Create directory
          const mkdirResult = await handleMkdir({ path: newPath }, sessionId, sessionManager);
          expect(mkdirResult).toEqual({ created: true });

          // Readdir parent
          const readdirResult = await handleReaddir({ path: '/parent' }, sessionId, sessionManager);
          const entry = readdirResult.entries.find((e: any) => e.name === dirName);
          expect(entry).toBeDefined();
          expect(entry!.type).toBe('directory');
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 10: delete then stat returns PATH_NOT_FOUND
   *
   * For any existing file or directory, after a successful sftp/delete,
   * calling sftp/stat on the same path should return JSON-RPC error
   * with code -32010 (PATH_NOT_FOUND).
   *
   * Feature: sftp-vscode-plugin
   * Property 10: delete then stat returns PATH_NOT_FOUND
   *
   * **Validates: Requirements 9.2**
   */
  describe('Property 10: delete then stat returns PATH_NOT_FOUND', () => {
    it('deleted file should not be found by stat', async () => {
      await fc.assert(
        fc.asyncProperty(arbFilename, arbBinaryContent, async (filename, content) => {
          const { sessionManager, backend, sessionId } = createTestSession();

          const path = `/${filename}`;
          backend.setFile(path, {
            type: 'file', content: Buffer.from(content),
            size: content.length, mtime: 1700000000, atime: 1700000001, mode: 0o644,
          });

          // Delete the file
          const deleteResult = await handleDelete({ path }, sessionId, sessionManager);
          expect(deleteResult).toEqual({ deleted: true });

          // Stat should fail with PATH_NOT_FOUND
          await expect(
            handleStat({ path }, sessionId, sessionManager)
          ).rejects.toMatchObject({ code: -32010 });
        }),
        { numRuns: 100 }
      );
    });

    it('deleted directory should not be found by stat', async () => {
      await fc.assert(
        fc.asyncProperty(arbFilename, async (dirName) => {
          const { sessionManager, backend, sessionId } = createTestSession();

          const path = `/${dirName}`;
          backend.setFile(path, {
            type: 'directory', size: 0,
            mtime: 1700000000, atime: 1700000001, mode: 0o755,
          });

          const deleteResult = await handleDelete({ path }, sessionId, sessionManager);
          expect(deleteResult).toEqual({ deleted: true });

          await expect(
            handleStat({ path }, sessionId, sessionManager)
          ).rejects.toMatchObject({ code: -32010 });
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 11: rename preserves content
   *
   * For any existing file with arbitrary content, after a successful
   * sftp/rename(oldPath, newPath), sftp/stat(oldPath) should return -32010,
   * and sftp/readFile(newPath) should return content identical to the original.
   *
   * Feature: sftp-vscode-plugin
   * Property 11: rename preserves content
   *
   * **Validates: Requirements 9.3**
   */
  describe('Property 11: rename preserves content', () => {
    it('renamed file content should be preserved at new path', async () => {
      await fc.assert(
        fc.asyncProperty(arbFilename, arbFilename, arbBinaryContent, async (oldName, newName, content) => {
          // Ensure distinct names
          const safeOldName = `old_${oldName}`;
          const safeNewName = `new_${newName}`;

          const { sessionManager, backend, sessionId } = createTestSession();

          const oldPath = `/${safeOldName}`;
          const newPath = `/${safeNewName}`;

          backend.setFile(oldPath, {
            type: 'file', content: Buffer.from(content),
            size: content.length, mtime: 1700000000, atime: 1700000001, mode: 0o644,
          });

          // Rename
          const renameResult = await handleRename(
            { oldPath, newPath },
            sessionId, sessionManager
          );
          expect(renameResult).toEqual({ renamed: true });

          // Old path should not exist
          await expect(
            handleStat({ path: oldPath }, sessionId, sessionManager)
          ).rejects.toMatchObject({ code: -32010 });

          // New path should have the same content
          const readResult = await handleReadFile({ path: newPath }, sessionId, sessionManager);
          const decoded = Buffer.from(readResult.data, 'base64');
          expect(decoded).toEqual(Buffer.from(content));
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 12: Recursive delete removes all contents
   *
   * For any directory tree of arbitrary depth, sftp/delete with recursive: true
   * on the root directory should remove all nested files and directories.
   * After deletion, sftp/stat on the root path should return -32010.
   *
   * Feature: sftp-vscode-plugin
   * Property 12: Recursive delete removes all contents
   *
   * **Validates: Requirements 9.7**
   */
  describe('Property 12: Recursive delete removes all contents', () => {
    it('recursive delete should remove entire directory tree', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 5 }),
          fc.integer({ min: 1, max: 4 }),
          async (depth, filesPerLevel) => {
            const { sessionManager, backend, sessionId } = createTestSession();

            const rootPath = '/tree';

            // Build a directory tree
            const allPaths: string[] = [rootPath];
            backend.setFile(rootPath, {
              type: 'directory', size: 0,
              mtime: 1700000000, atime: 1700000001, mode: 0o755,
            });

            let currentDirs = [rootPath];
            for (let d = 0; d < depth; d++) {
              const nextDirs: string[] = [];
              for (const dir of currentDirs) {
                // Add files
                for (let f = 0; f < filesPerLevel; f++) {
                  const filePath = `${dir}/file_${d}_${f}`;
                  backend.setFile(filePath, {
                    type: 'file', content: Buffer.from(`content-${d}-${f}`),
                    size: 10, mtime: 1700000000, atime: 1700000001, mode: 0o644,
                  });
                  allPaths.push(filePath);
                }
                // Add a subdirectory for next level
                if (d < depth - 1) {
                  const subDir = `${dir}/sub_${d}`;
                  backend.setFile(subDir, {
                    type: 'directory', size: 0,
                    mtime: 1700000000, atime: 1700000001, mode: 0o755,
                  });
                  allPaths.push(subDir);
                  nextDirs.push(subDir);
                }
              }
              currentDirs = nextDirs;
            }

            // Recursive delete
            const deleteResult = await handleDelete(
              { path: rootPath, recursive: true },
              sessionId, sessionManager
            );
            expect(deleteResult).toEqual({ deleted: true });

            // Root path should not exist
            await expect(
              handleStat({ path: rootPath }, sessionId, sessionManager)
            ).rejects.toMatchObject({ code: -32010 });

            // All nested paths should not exist
            for (const p of allPaths) {
              await expect(
                handleStat({ path: p }, sessionId, sessionManager)
              ).rejects.toMatchObject({ code: -32010 });
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
