/**
 * Tests for SftpBackend
 * 
 * Tests ISftpBackend contract using FakeSftpBackend.
 * These tests validate the backend interface and error handling.
 */


import fc from 'fast-check';
import { FakeSftpBackend } from './fake-sftp-backend.js';
import { ISftpBackend } from '../sftp-backend.js';
import { SftpError } from '../types.js';

describe('SftpBackend', () => {
  let backend: ISftpBackend;

  beforeEach(() => {
    backend = new FakeSftpBackend();
  });

  // ==========================================================================
  // Connection Lifecycle
  // ==========================================================================

  describe('Connection lifecycle', () => {
    it('should connect with password authentication', async () => {
      const result = await backend.connect({
        host: 'localhost',
        port: 22,
        username: 'testuser',
        authType: 'password',
        password: 'testpass',
      });

      expect(result.connected).toBe(true);
      expect(result.serverBanner).toBeDefined();
      expect(result.hostKeyFingerprint).toBeDefined();
      expect(backend.isConnected()).toBe(true);
    });

    it('should connect with private key authentication', async () => {
      const result = await backend.connect({
        host: 'localhost',
        port: 22,
        username: 'testuser',
        authType: 'privateKey',
        privateKey: '-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----',
      });

      expect(result.connected).toBe(true);
      expect(backend.isConnected()).toBe(true);
    });

    it('should disconnect idempotently', async () => {
      await backend.connect({
        host: 'localhost',
        port: 22,
        username: 'testuser',
        authType: 'password',
        password: 'testpass',
      });

      await backend.disconnect();
      expect(backend.isConnected()).toBe(false);

      // Second disconnect should not throw
      await backend.disconnect();
      expect(backend.isConnected()).toBe(false);
    });

    it('should throw error when password is missing', async () => {
      await expect(
        backend.connect({
          host: 'localhost',
          port: 22,
          username: 'testuser',
          authType: 'password',
        })
      ).rejects.toThrow();
    });

    it('should throw error when private key is missing', async () => {
      await expect(
        backend.connect({
          host: 'localhost',
          port: 22,
          username: 'testuser',
          authType: 'privateKey',
        })
      ).rejects.toThrow();
    });
  });

  // ==========================================================================
  // File Operations
  // ==========================================================================

  describe('File operations', () => {
    beforeEach(async () => {
      await backend.connect({
        host: 'localhost',
        port: 22,
        username: 'testuser',
        authType: 'password',
        password: 'testpass',
      });
    });

    it('should write and read file', async () => {
      const path = '/test.txt';
      const content = Buffer.from('Hello, World!');

      await backend.writeFile(path, content);
      const result = await backend.readFile(path);

      expect(result).toEqual(content);
    });

    it('should stat file', async () => {
      const path = '/test.txt';
      const content = Buffer.from('Hello');

      await backend.writeFile(path, content);
      const stats = await backend.stat(path);

      expect(stats.type).toBe('file');
      expect(stats.size).toBe(content.length);
      expect(stats.mtime).toBeGreaterThan(0);
      expect(stats.atime).toBeGreaterThan(0);
    });

    it('should throw PATH_NOT_FOUND for non-existent file', async () => {
      await expect(backend.stat('/nonexistent.txt')).rejects.toThrow(SftpError);

      try {
        await backend.stat('/nonexistent.txt');
      } catch (error) {
        expect((error as SftpError).code).toBe(-32010);
      }
    });

    it('should delete file', async () => {
      const path = '/test.txt';
      await backend.writeFile(path, Buffer.from('test'));

      await backend.delete(path);

      await expect(backend.stat(path)).rejects.toThrow();
    });

    it('should rename file', async () => {
      const oldPath = '/old.txt';
      const newPath = '/new.txt';
      const content = Buffer.from('test');

      await backend.writeFile(oldPath, content);
      await backend.rename(oldPath, newPath);

      const result = await backend.readFile(newPath);
      expect(result).toEqual(content);

      await expect(backend.stat(oldPath)).rejects.toThrow();
    });
  });

  // ==========================================================================
  // Directory Operations
  // ==========================================================================

  describe('Directory operations', () => {
    beforeEach(async () => {
      await backend.connect({
        host: 'localhost',
        port: 22,
        username: 'testuser',
        authType: 'password',
        password: 'testpass',
      });
    });

    it('should create directory', async () => {
      const path = '/testdir';

      await backend.mkdir(path);
      const stats = await backend.stat(path);

      expect(stats.type).toBe('directory');
    });

    it('should throw ALREADY_EXISTS when creating existing directory', async () => {
      const path = '/testdir';
      await backend.mkdir(path);

      try {
        await backend.mkdir(path);
        throw new Error('Should have thrown');
      } catch (error) {
        expect((error as SftpError).code).toBe(-32012);
      }
    });

    it('should list directory contents', async () => {
      await backend.mkdir('/testdir');
      await backend.writeFile('/testdir/file1.txt', Buffer.from('test1'));
      await backend.writeFile('/testdir/file2.txt', Buffer.from('test2'));

      const entries = await backend.readdir('/testdir');

      expect(entries).toHaveLength(2);
      expect(entries.map((e) => e.name).sort()).toEqual(['file1.txt', 'file2.txt']);
      expect(entries[0].type).toBe('file');
      expect(entries[0].size).toBeGreaterThan(0);
    });

    it('should throw NOT_A_DIRECTORY when reading file as directory', async () => {
      await backend.writeFile('/test.txt', Buffer.from('test'));

      try {
        await backend.readdir('/test.txt');
        throw new Error('Should have thrown');
      } catch (error) {
        expect((error as SftpError).code).toBe(-32022);
      }
    });

    it('should delete empty directory', async () => {
      await backend.mkdir('/testdir');
      await backend.delete('/testdir');

      await expect(backend.stat('/testdir')).rejects.toThrow();
    });

    it('should throw DIRECTORY_NOT_EMPTY when deleting non-empty directory without recursive', async () => {
      await backend.mkdir('/testdir');
      await backend.writeFile('/testdir/file.txt', Buffer.from('test'));

      try {
        await backend.delete('/testdir', false);
        throw new Error('Should have thrown');
      } catch (error) {
        expect((error as SftpError).code).toBe(-32024);
      }
    });

    it('should delete directory recursively', async () => {
      await backend.mkdir('/testdir');
      await backend.writeFile('/testdir/file1.txt', Buffer.from('test1'));
      await backend.writeFile('/testdir/file2.txt', Buffer.from('test2'));

      await backend.delete('/testdir', true);

      await expect(backend.stat('/testdir')).rejects.toThrow();
    });
  });

  // ==========================================================================
  // Property-Based Tests
  // ==========================================================================

  describe('Property 7: File content base64 round-trip', () => {
    it('writeFile then readFile preserves content', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uint8Array({ minLength: 0, maxLength: 1024 }),
          async (bytes) => {
            // Create fresh backend for each iteration
            const testBackend = new FakeSftpBackend();
            await testBackend.connect({
              host: 'localhost',
              port: 22,
              username: 'testuser',
              authType: 'password',
              password: 'testpass',
            });

            const path = '/test-' + Math.random() + '.bin';
            const content = Buffer.from(bytes);

            await testBackend.writeFile(path, content);
            const result = await testBackend.readFile(path);

            await testBackend.disconnect();

            return result.equals(content);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 8: Metadata completeness', () => {
    it('stat returns complete metadata', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uint8Array({ minLength: 0, maxLength: 256 }),
          async (bytes) => {
            const testBackend = new FakeSftpBackend();
            await testBackend.connect({
              host: 'localhost',
              port: 22,
              username: 'testuser',
              authType: 'password',
              password: 'testpass',
            });

            const path = '/test-' + Math.random() + '.bin';
            await testBackend.writeFile(path, Buffer.from(bytes));

            const stats = await testBackend.stat(path);

            await testBackend.disconnect();

            return (
              stats.type === 'file' &&
              stats.size === bytes.length &&
              stats.mtime > 0 &&
              stats.atime > 0 &&
              typeof stats.mode === 'number'
            );
          }
        ),
        { numRuns: 100 }
      );
    });

    it('readdir returns complete entry metadata', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.tuple(fc.stringOf(fc.constantFrom('a', 'b', 'c'), { minLength: 1, maxLength: 5 }), fc.uint8Array({ maxLength: 64 })), { minLength: 1, maxLength: 10 }),
          async (files) => {
            const testBackend = new FakeSftpBackend();
            await testBackend.connect({
              host: 'localhost',
              port: 22,
              username: 'testuser',
              authType: 'password',
              password: 'testpass',
            });

            const dirPath = '/testdir-' + Math.random();
            await testBackend.mkdir(dirPath);

            for (const [name, content] of files) {
              await testBackend.writeFile(`${dirPath}/${name}`, Buffer.from(content));
            }

            const entries = await testBackend.readdir(dirPath);

            await testBackend.disconnect();

            return entries.every(
              (entry) =>
                typeof entry.name === 'string' &&
                (entry.type === 'file' || entry.type === 'directory' || entry.type === 'symlink') &&
                typeof entry.size === 'number' &&
                entry.mtime > 0 &&
                entry.atime > 0
            );
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  describe('Property 9: mkdir then readdir contains new entry', () => {
    it('created directory appears in parent readdir', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.stringOf(fc.constantFrom('a', 'b', 'c'), { minLength: 1, maxLength: 8 }),
          async (dirName) => {
            const testBackend = new FakeSftpBackend();
            await testBackend.connect({
              host: 'localhost',
              port: 22,
              username: 'testuser',
              authType: 'password',
              password: 'testpass',
            });

            const parentPath = '/parent-' + Math.random();
            await testBackend.mkdir(parentPath);

            const childPath = `${parentPath}/${dirName}`;
            await testBackend.mkdir(childPath);

            const entries = await testBackend.readdir(parentPath);
            const found = entries.find((e) => e.name === dirName);

            await testBackend.disconnect();

            return found !== undefined && found.type === 'directory';
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 10: delete then stat returns PATH_NOT_FOUND', () => {
    it('deleted file cannot be stat-ed', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uint8Array({ maxLength: 128 }),
          async (content) => {
            const testBackend = new FakeSftpBackend();
            await testBackend.connect({
              host: 'localhost',
              port: 22,
              username: 'testuser',
              authType: 'password',
              password: 'testpass',
            });

            const path = '/test-' + Math.random() + '.bin';
            await testBackend.writeFile(path, Buffer.from(content));

            await testBackend.delete(path);

            try {
              await testBackend.stat(path);
              await testBackend.disconnect();
              return false; // Should have thrown
            } catch (error) {
              await testBackend.disconnect();
              return (error as SftpError).code === -32010;
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 11: rename preserves content', () => {
    it('renamed file has same content', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uint8Array({ maxLength: 256 }),
          async (bytes) => {
            const testBackend = new FakeSftpBackend();
            await testBackend.connect({
              host: 'localhost',
              port: 22,
              username: 'testuser',
              authType: 'password',
              password: 'testpass',
            });

            const oldPath = '/old-' + Math.random() + '.bin';
            const newPath = '/new-' + Math.random() + '.bin';
            const content = Buffer.from(bytes);

            await testBackend.writeFile(oldPath, content);
            await testBackend.rename(oldPath, newPath);

            const result = await testBackend.readFile(newPath);

            // Old path should not exist
            let oldExists = true;
            try {
              await testBackend.stat(oldPath);
            } catch {
              oldExists = false;
            }

            await testBackend.disconnect();

            return !oldExists && result.equals(content);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 12: Recursive delete removes all contents', () => {
    it('recursive delete removes directory tree', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.stringOf(fc.constantFrom('a', 'b', 'c'), { minLength: 1, maxLength: 5 }), { minLength: 1, maxLength: 5 }),
          async (fileNames) => {
            const testBackend = new FakeSftpBackend();
            await testBackend.connect({
              host: 'localhost',
              port: 22,
              username: 'testuser',
              authType: 'password',
              password: 'testpass',
            });

            const dirPath = '/testdir-' + Math.random();
            await testBackend.mkdir(dirPath);

            for (const name of fileNames) {
              await testBackend.writeFile(`${dirPath}/${name}`, Buffer.from('test'));
            }

            await testBackend.delete(dirPath, true);

            try {
              await testBackend.stat(dirPath);
              await testBackend.disconnect();
              return false; // Should have thrown
            } catch (error) {
              await testBackend.disconnect();
              return (error as SftpError).code === -32010;
            }
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  // ==========================================================================
  // Atomic Write
  // ==========================================================================

  describe('Atomic write', () => {
    beforeEach(async () => {
      await backend.connect({
        host: 'localhost',
        port: 22,
        username: 'testuser',
        authType: 'password',
        password: 'testpass',
      });
    });

    it('should write file atomically', async () => {
      const path = '/test.txt';
      const content = Buffer.from('atomic content');

      await backend.writeFileAtomic(path, content, '.tmp');

      const result = await backend.readFile(path);
      expect(result).toEqual(content);
    });

    it('should not leave temp file after successful atomic write', async () => {
      const path = '/test.txt';
      const tmpPath = path + '.tmp';
      const content = Buffer.from('atomic content');

      await backend.writeFileAtomic(path, content, '.tmp');

      // Temp file should not exist
      await expect(backend.stat(tmpPath)).rejects.toThrow();
    });
  });

  // ==========================================================================
  // Error Handling
  // ==========================================================================

  describe('Error handling', () => {
    it('should throw NO_ACTIVE_CONNECTION when not connected', async () => {
      try {
        await backend.stat('/test.txt');
        throw new Error('Should have thrown');
      } catch (error) {
        expect((error as SftpError).code).toBe(-32000);
      }
    });

    it('should throw error for operations after disconnect', async () => {
      await backend.connect({
        host: 'localhost',
        port: 22,
        username: 'testuser',
        authType: 'password',
        password: 'testpass',
      });

      await backend.disconnect();

      try {
        await backend.stat('/test.txt');
        throw new Error('Should have thrown');
      } catch (error) {
        expect((error as SftpError).code).toBe(-32000);
      }
    });
  });
});
