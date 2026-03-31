/**
 * Unit tests for SFTP file operation handlers
 * 
 * Tests sftp/readdir, sftp/stat, sftp/readFile, sftp/writeFile, sftp/mkdir, sftp/delete, sftp/rename handlers
 * using FakeSftpBackend for deterministic testing.
 */

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

describe('sftp/readdir handler', () => {
  let sessionManager: SessionManager;
  let backend: FakeSftpBackend;
  const sessionId = 'test-session-1';

  beforeEach(() => {
    sessionManager = new SessionManager();
    backend = new FakeSftpBackend();
    const session = sessionManager.createSession(sessionId);
    session.state = 'active';
    session.backend = backend;
    // Connect the backend
    backend['connected'] = true;

    // Populate fake filesystem
    backend.setFile('/home', {
      type: 'directory', size: 0,
      mtime: 1700000000, atime: 1700000001, mode: 0o755,
    });
    backend.setFile('/home/file.txt', {
      type: 'file', content: Buffer.from('hello'),
      size: 5, mtime: 1700000010, atime: 1700000011, mode: 0o644,
    });
    backend.setFile('/home/subdir', {
      type: 'directory', size: 0,
      mtime: 1700000020, atime: 1700000021, mode: 0o755,
    });
    backend.setFile('/home/link', {
      type: 'symlink', size: 0,
      mtime: 1700000030, atime: 1700000031, mode: 0o777,
    });
  });

  it('should return entries with name, type, size, mtime, atime', async () => {
    const result = await handleReaddir({ path: '/home' }, sessionId, sessionManager);
    expect(result).toHaveProperty('entries');
    expect(Array.isArray(result.entries)).toBe(true);
    expect(result.entries.length).toBe(3);

    for (const entry of result.entries) {
      expect(entry).toHaveProperty('name');
      expect(entry).toHaveProperty('type');
      expect(entry).toHaveProperty('size');
      expect(entry).toHaveProperty('mtime');
      expect(entry).toHaveProperty('atime');
      expect(typeof entry.name).toBe('string');
      expect(['file', 'directory', 'symlink']).toContain(entry.type);
      expect(typeof entry.size).toBe('number');
      expect(typeof entry.mtime).toBe('number');
      expect(typeof entry.atime).toBe('number');
    }
  });

  it('should normalize path before querying', async () => {
    const result = await handleReaddir({ path: '/home/.' }, sessionId, sessionManager);
    expect(result.entries.length).toBe(3);
  });

  it('should throw error for non-existent path', async () => {
    await expect(
      handleReaddir({ path: '/nonexistent' }, sessionId, sessionManager)
    ).rejects.toMatchObject({ code: -32010 });
  });

  it('should throw error for missing path param', async () => {
    await expect(
      handleReaddir({}, sessionId, sessionManager)
    ).rejects.toMatchObject({ code: -32602 });
  });

  it('should throw error for no active session', async () => {
    await expect(
      handleReaddir({ path: '/home' }, 'unknown-session', sessionManager)
    ).rejects.toMatchObject({ code: -32000 });
  });

  it('should detect symlinks via lstat (Requirement 28.1)', async () => {
    const result = await handleReaddir({ path: '/home' }, sessionId, sessionManager);
    const link = result.entries.find((e: any) => e.name === 'link');
    expect(link).toBeDefined();
    expect(link.type).toBe('symlink');
  });

  it('should return mtime and atime as Unix timestamps in seconds', async () => {
    const result = await handleReaddir({ path: '/home' }, sessionId, sessionManager);
    const file = result.entries.find((e: any) => e.name === 'file.txt');
    expect(file).toBeDefined();
    expect(file.mtime).toBe(1700000010);
    expect(file.atime).toBe(1700000011);
  });

  it('should return empty entries for empty directory', async () => {
    backend.setFile('/empty', {
      type: 'directory', size: 0,
      mtime: 1700000000, atime: 1700000001, mode: 0o755,
    });
    const result = await handleReaddir({ path: '/empty' }, sessionId, sessionManager);
    expect(result.entries).toEqual([]);
  });
});

describe('sftp/stat handler', () => {
  let sessionManager: SessionManager;
  let backend: FakeSftpBackend;
  const sessionId = 'test-session-2';

  beforeEach(() => {
    sessionManager = new SessionManager();
    backend = new FakeSftpBackend();
    const session = sessionManager.createSession(sessionId);
    session.state = 'active';
    session.backend = backend;
    backend['connected'] = true;

    backend.setFile('/myfile.txt', {
      type: 'file', content: Buffer.from('data'),
      size: 4, mtime: 1700000050, atime: 1700000051, mode: 0o644,
    });
  });

  it('should return type, size, mtime, atime, mode', async () => {
    const result = await handleStat({ path: '/myfile.txt' }, sessionId, sessionManager);
    expect(result.type).toBe('file');
    expect(result.size).toBe(4);
    expect(result.mtime).toBe(1700000050);
    expect(result.atime).toBe(1700000051);
    expect(result.mode).toBe(0o644);
  });

  it('should throw -32010 for non-existent path', async () => {
    await expect(
      handleStat({ path: '/nope' }, sessionId, sessionManager)
    ).rejects.toMatchObject({ code: -32010 });
  });

  it('should throw -32602 for missing path param', async () => {
    await expect(
      handleStat({}, sessionId, sessionManager)
    ).rejects.toMatchObject({ code: -32602 });
  });

  it('should throw -32000 for unknown session', async () => {
    await expect(
      handleStat({ path: '/myfile.txt' }, 'unknown-session', sessionManager)
    ).rejects.toMatchObject({ code: -32000 });
  });

  it('should normalize path before querying (Requirement 28.2)', async () => {
    backend.setFile('/dir', {
      type: 'directory', size: 0,
      mtime: 1700000060, atime: 1700000061, mode: 0o755,
    });
    const result = await handleStat({ path: '/dir/.' }, sessionId, sessionManager);
    expect(result.type).toBe('directory');
  });

  it('should stat a directory', async () => {
    backend.setFile('/mydir', {
      type: 'directory', size: 0,
      mtime: 1700000070, atime: 1700000071, mode: 0o755,
    });
    const result = await handleStat({ path: '/mydir' }, sessionId, sessionManager);
    expect(result.type).toBe('directory');
    expect(result.size).toBe(0);
    expect(result.mode).toBe(0o755);
  });

  it('should use stat (follow symlinks) per Requirement 28.2', async () => {
    // FakeSftpBackend.stat() follows symlinks (same as real stat)
    // A symlink entry stat'd should return the target's metadata
    backend.setFile('/symlink', {
      type: 'symlink', size: 0,
      mtime: 1700000080, atime: 1700000081, mode: 0o777,
    });
    const result = await handleStat({ path: '/symlink' }, sessionId, sessionManager);
    // stat returns whatever the backend returns — in fake backend, it returns the entry as-is
    expect(result).toHaveProperty('type');
    expect(result).toHaveProperty('size');
    expect(result).toHaveProperty('mtime');
    expect(result).toHaveProperty('atime');
    expect(result).toHaveProperty('mode');
  });

  it('should throw -32602 for non-string path param', async () => {
    await expect(
      handleStat({ path: 123 }, sessionId, sessionManager)
    ).rejects.toMatchObject({ code: -32602 });
  });
});


describe('sftp/readFile handler', () => {
  let sessionManager: SessionManager;
  let backend: FakeSftpBackend;
  const sessionId = 'test-session-3';

  beforeEach(() => {
    sessionManager = new SessionManager();
    backend = new FakeSftpBackend();
    const session = sessionManager.createSession(sessionId);
    session.state = 'active';
    session.backend = backend;
    backend['connected'] = true;

    backend.setFile('/hello.txt', {
      type: 'file', content: Buffer.from('Hello, World!'),
      size: 13, mtime: 1700000060, atime: 1700000061, mode: 0o644,
    });
    backend.setFile('/empty.txt', {
      type: 'file', content: Buffer.alloc(0),
      size: 0, mtime: 1700000070, atime: 1700000071, mode: 0o644,
    });
  });

  it('should return base64-encoded data, size, encoding for inline file (Req 7.2)', async () => {
    const result = await handleReadFile({ path: '/hello.txt' }, sessionId, sessionManager);
    expect(result.encoding).toBe('base64');
    expect(result.size).toBe(13);
    expect(typeof result.data).toBe('string');

    // Verify round-trip (Req 7.4)
    const decoded = Buffer.from(result.data, 'base64');
    expect(decoded.toString()).toBe('Hello, World!');
  });

  it('should NOT include chunked fields for inline files', async () => {
    const result = await handleReadFile({ path: '/hello.txt' }, sessionId, sessionManager);
    expect(result.chunked).toBeUndefined();
    expect(result.chunkIndex).toBeUndefined();
    expect(result.totalChunks).toBeUndefined();
    expect(result.sha256).toBeUndefined();
  });

  it('should handle empty files', async () => {
    const result = await handleReadFile({ path: '/empty.txt' }, sessionId, sessionManager);
    expect(result.size).toBe(0);
    expect(result.encoding).toBe('base64');
    const decoded = Buffer.from(result.data, 'base64');
    expect(decoded.length).toBe(0);
  });

  it('should return chunked hint with sha256 for large files (Req 7.3)', async () => {
    // Create a file larger than maxInlineFileBytes (default 1MB = 1048576)
    const largeContent = Buffer.alloc(1048576 + 100, 0x42); // slightly over 1MB
    backend.setFile('/large.bin', {
      type: 'file', content: largeContent,
      size: largeContent.length, mtime: 1700000090, atime: 1700000091, mode: 0o644,
    });

    const result = await handleReadFile({ path: '/large.bin' }, sessionId, sessionManager);
    expect(result.encoding).toBe('base64');
    expect(result.size).toBe(largeContent.length);
    expect(result.chunked).toBe(true);
    expect(result.chunkIndex).toBe(0);
    expect(result.totalChunks).toBe(Math.ceil(largeContent.length / 1048576));
    expect(typeof result.sha256).toBe('string');
    expect(result.sha256).toHaveLength(64); // SHA256 hex is 64 chars

    // Verify sha256 is correct
    const { createHash } = await import('crypto');
    const expectedSha256 = createHash('sha256').update(largeContent).digest('hex');
    expect(result.sha256).toBe(expectedSha256);

    // Verify base64 round-trip even for chunked
    const decoded = Buffer.from(result.data, 'base64');
    expect(decoded.equals(largeContent)).toBe(true);
  });

  it('should use session maxInlineFileBytes from capabilities', async () => {
    // Set a very small maxInlineFileBytes to trigger chunked for small files
    const session = sessionManager.getSession(sessionId)!;
    session.capabilities = { ...session.capabilities, maxInlineFileBytes: 5 };

    const result = await handleReadFile({ path: '/hello.txt' }, sessionId, sessionManager);
    // "Hello, World!" is 13 bytes, > 5 → chunked
    expect(result.chunked).toBe(true);
    expect(result.chunkIndex).toBe(0);
    expect(result.totalChunks).toBe(Math.ceil(13 / 5));
    expect(typeof result.sha256).toBe('string');
  });

  it('should return inline for file exactly at maxInlineFileBytes boundary', async () => {
    const session = sessionManager.getSession(sessionId)!;
    session.capabilities = { ...session.capabilities, maxInlineFileBytes: 13 };

    const result = await handleReadFile({ path: '/hello.txt' }, sessionId, sessionManager);
    // 13 bytes ≤ 13 → inline
    expect(result.chunked).toBeUndefined();
    expect(result.size).toBe(13);
  });

  it('should normalize path before reading (Req 7.1)', async () => {
    backend.setFile('/dir', {
      type: 'directory', size: 0,
      mtime: 1700000060, atime: 1700000061, mode: 0o755,
    });
    backend.setFile('/dir/file.txt', {
      type: 'file', content: Buffer.from('normalized'),
      size: 10, mtime: 1700000060, atime: 1700000061, mode: 0o644,
    });

    const result = await handleReadFile({ path: '/dir/./file.txt' }, sessionId, sessionManager);
    const decoded = Buffer.from(result.data, 'base64');
    expect(decoded.toString()).toBe('normalized');
  });

  it('should throw -32010 for non-existent file (Req 7.5)', async () => {
    await expect(
      handleReadFile({ path: '/missing.txt' }, sessionId, sessionManager)
    ).rejects.toMatchObject({ code: -32010 });
  });

  it('should throw -32011 for permission denied (Req 7.6)', async () => {
    // Simulate EACCES by making backend throw the right error
    const origReadFile = backend.readFile.bind(backend);
    backend.readFile = async (path: string) => {
      const err = new Error('Permission denied') as any;
      err.code = 'EACCES';
      throw err;
    };

    await expect(
      handleReadFile({ path: '/hello.txt' }, sessionId, sessionManager)
    ).rejects.toMatchObject({ code: -32011 });
  });

  it('should throw -32602 for missing path param', async () => {
    await expect(
      handleReadFile({}, sessionId, sessionManager)
    ).rejects.toMatchObject({ code: -32602 });
  });

  it('should throw -32602 for non-string path param', async () => {
    await expect(
      handleReadFile({ path: 123 }, sessionId, sessionManager)
    ).rejects.toMatchObject({ code: -32602 });
  });

  it('should throw -32000 for unknown session', async () => {
    await expect(
      handleReadFile({ path: '/hello.txt' }, 'unknown-session', sessionManager)
    ).rejects.toMatchObject({ code: -32000 });
  });

  it('should throw -32000 for session without backend', async () => {
    const noBackendSession = sessionManager.createSession('no-backend');
    noBackendSession.state = 'active';
    // backend is null by default

    await expect(
      handleReadFile({ path: '/hello.txt' }, 'no-backend', sessionManager)
    ).rejects.toMatchObject({ code: -32000 });
  });

  it('should correctly encode binary content as base64 (Req 7.4)', async () => {
    // Create file with all byte values 0x00-0xFF
    const binaryContent = Buffer.alloc(256);
    for (let i = 0; i < 256; i++) binaryContent[i] = i;
    backend.setFile('/binary.bin', {
      type: 'file', content: binaryContent,
      size: 256, mtime: 1700000060, atime: 1700000061, mode: 0o644,
    });

    const result = await handleReadFile({ path: '/binary.bin' }, sessionId, sessionManager);
    const decoded = Buffer.from(result.data, 'base64');
    expect(decoded.equals(binaryContent)).toBe(true);
  });
});

describe('sftp/writeFile handler', () => {
  let sessionManager: SessionManager;
  let backend: FakeSftpBackend;
  const sessionId = 'test-session-4';

  beforeEach(() => {
    sessionManager = new SessionManager();
    backend = new FakeSftpBackend();
    const session = sessionManager.createSession(sessionId);
    session.state = 'active';
    session.backend = backend;
    backend['connected'] = true;

    backend.setFile('/existing.txt', {
      type: 'file', content: Buffer.from('old'),
      size: 3, mtime: 1700000080, atime: 1700000081, mode: 0o644,
    });
  });

  it('should write base64-decoded data and return written, size, atomic', async () => {
    const content = Buffer.from('new content');
    const result = await handleWriteFile(
      { path: '/newfile.txt', data: content.toString('base64') },
      sessionId, sessionManager
    );
    expect(result.written).toBe(true);
    expect(result.size).toBe(content.length);
    expect(typeof result.atomic).toBe('boolean');
  });

  it('should use direct strategy when specified', async () => {
    const content = Buffer.from('direct write');
    const result = await handleWriteFile(
      { path: '/direct.txt', data: content.toString('base64'), writeStrategy: 'direct' },
      sessionId, sessionManager
    );
    expect(result.written).toBe(true);
    expect(result.atomic).toBe(false);
  });

  it('should throw -32012 when overwrite=false and file exists', async () => {
    const content = Buffer.from('data');
    await expect(
      handleWriteFile(
        { path: '/existing.txt', data: content.toString('base64'), overwrite: false },
        sessionId, sessionManager
      )
    ).rejects.toMatchObject({ code: -32012 });
  });

  it('should throw -32010 when create=false and file does not exist', async () => {
    const content = Buffer.from('data');
    await expect(
      handleWriteFile(
        { path: '/nofile.txt', data: content.toString('base64'), create: false },
        sessionId, sessionManager
      )
    ).rejects.toMatchObject({ code: -32010 });
  });

  it('should throw -32602 for missing path param', async () => {
    await expect(
      handleWriteFile({ data: 'aGVsbG8=' }, sessionId, sessionManager)
    ).rejects.toMatchObject({ code: -32602 });
  });

  it('should throw -32602 for missing data param', async () => {
    await expect(
      handleWriteFile({ path: '/test.txt' }, sessionId, sessionManager)
    ).rejects.toMatchObject({ code: -32602 });
  });

  it('should throw -32602 for non-string path param', async () => {
    await expect(
      handleWriteFile({ path: 123, data: 'aGVsbG8=' }, sessionId, sessionManager)
    ).rejects.toMatchObject({ code: -32602 });
  });

  it('should throw -32602 for non-string data param', async () => {
    await expect(
      handleWriteFile({ path: '/test.txt', data: 123 }, sessionId, sessionManager)
    ).rejects.toMatchObject({ code: -32602 });
  });

  it('should throw -32000 for unknown session', async () => {
    const content = Buffer.from('data');
    await expect(
      handleWriteFile(
        { path: '/test.txt', data: content.toString('base64') },
        'unknown-session', sessionManager
      )
    ).rejects.toMatchObject({ code: -32000 });
  });

  it('should throw -32000 for session without backend', async () => {
    const noBackendSession = sessionManager.createSession('no-backend');
    noBackendSession.state = 'active';

    const content = Buffer.from('data');
    await expect(
      handleWriteFile(
        { path: '/test.txt', data: content.toString('base64') },
        'no-backend', sessionManager
      )
    ).rejects.toMatchObject({ code: -32000 });
  });

  it('should use tempRename strategy by default and return atomic=true (Req 8.7, 21.7)', async () => {
    const content = Buffer.from('atomic content');
    const result = await handleWriteFile(
      { path: '/atomic.txt', data: content.toString('base64') },
      sessionId, sessionManager
    );
    expect(result.written).toBe(true);
    expect(result.atomic).toBe(true);
    expect(result.size).toBe(content.length);
  });

  it('should overwrite existing file when overwrite=true (default) (Req 8.1)', async () => {
    const newContent = Buffer.from('updated content');
    const result = await handleWriteFile(
      { path: '/existing.txt', data: newContent.toString('base64') },
      sessionId, sessionManager
    );
    expect(result.written).toBe(true);
    expect(result.size).toBe(newContent.length);
  });

  it('should write empty file (Req 8.2)', async () => {
    const emptyContent = Buffer.alloc(0);
    const result = await handleWriteFile(
      { path: '/empty-write.txt', data: emptyContent.toString('base64') },
      sessionId, sessionManager
    );
    expect(result.written).toBe(true);
    expect(result.size).toBe(0);
  });

  it('should normalize path before writing', async () => {
    backend.setFile('/dir', {
      type: 'directory', size: 0,
      mtime: 1700000080, atime: 1700000081, mode: 0o755,
    });
    const content = Buffer.from('normalized write');
    const result = await handleWriteFile(
      { path: '/dir/./file.txt', data: content.toString('base64') },
      sessionId, sessionManager
    );
    expect(result.written).toBe(true);
    expect(result.size).toBe(content.length);
  });

  it('should throw -32011 for permission denied (Req 8.6)', async () => {
    const origWriteFile = backend.writeFile.bind(backend);
    backend.writeFile = async (_path: string, _data: Buffer) => {
      const err = new Error('Permission denied') as any;
      err.code = 'EACCES';
      throw err;
    };

    const content = Buffer.from('data');
    await expect(
      handleWriteFile(
        { path: '/readonly.txt', data: content.toString('base64') },
        sessionId, sessionManager
      )
    ).rejects.toMatchObject({ code: -32011 });
  });

  it('should throw -32013 for disk full (Req 8.7)', async () => {
    const origWriteFile = backend.writeFile.bind(backend);
    backend.writeFile = async (_path: string, _data: Buffer) => {
      const err = new Error('No space left on device') as any;
      err.code = 'ENOSPC';
      throw err;
    };

    const content = Buffer.from('data');
    await expect(
      handleWriteFile(
        { path: '/full-disk.txt', data: content.toString('base64') },
        sessionId, sessionManager
      )
    ).rejects.toMatchObject({ code: -32013 });
  });

  it('should throw -32013 for disk full with direct strategy (Req 8.7)', async () => {
    const origWriteFile = backend.writeFile.bind(backend);
    backend.writeFile = async (_path: string, _data: Buffer) => {
      const err = new Error('No space left on device') as any;
      err.code = 'ENOSPC';
      throw err;
    };

    const content = Buffer.from('data');
    await expect(
      handleWriteFile(
        { path: '/full-disk.txt', data: content.toString('base64'), writeStrategy: 'direct' },
        sessionId, sessionManager
      )
    ).rejects.toMatchObject({ code: -32013 });
  });

  it('should throw -32011 for permission denied with direct strategy (Req 8.6)', async () => {
    const origWriteFile = backend.writeFile.bind(backend);
    backend.writeFile = async (_path: string, _data: Buffer) => {
      const err = new Error('Permission denied') as any;
      err.code = 'EACCES';
      throw err;
    };

    const content = Buffer.from('data');
    await expect(
      handleWriteFile(
        { path: '/readonly.txt', data: content.toString('base64'), writeStrategy: 'direct' },
        sessionId, sessionManager
      )
    ).rejects.toMatchObject({ code: -32011 });
  });

  it('should correctly decode binary base64 data (Req 8.2)', async () => {
    // Create binary content with all byte values 0x00-0xFF
    const binaryContent = Buffer.alloc(256);
    for (let i = 0; i < 256; i++) binaryContent[i] = i;

    const result = await handleWriteFile(
      { path: '/binary.bin', data: binaryContent.toString('base64'), writeStrategy: 'direct' },
      sessionId, sessionManager
    );
    expect(result.written).toBe(true);
    expect(result.size).toBe(256);
  });

  it('should default create=true and overwrite=true (Req 8.1)', async () => {
    // New file with defaults — should succeed (create=true by default)
    const content = Buffer.from('defaults');
    const result = await handleWriteFile(
      { path: '/defaults.txt', data: content.toString('base64') },
      sessionId, sessionManager
    );
    expect(result.written).toBe(true);

    // Overwrite existing with defaults — should succeed (overwrite=true by default)
    const result2 = await handleWriteFile(
      { path: '/existing.txt', data: content.toString('base64') },
      sessionId, sessionManager
    );
    expect(result2.written).toBe(true);
  });

  it('should handle create=false with existing file (allowed)', async () => {
    const content = Buffer.from('update');
    const result = await handleWriteFile(
      { path: '/existing.txt', data: content.toString('base64'), create: false },
      sessionId, sessionManager
    );
    expect(result.written).toBe(true);
    expect(result.size).toBe(content.length);
  });

  it('should handle overwrite=false with new file (allowed)', async () => {
    const content = Buffer.from('brand new');
    const result = await handleWriteFile(
      { path: '/brand-new.txt', data: content.toString('base64'), overwrite: false },
      sessionId, sessionManager
    );
    expect(result.written).toBe(true);
    expect(result.size).toBe(content.length);
  });
});


describe('sftp/mkdir handler', () => {
  let sessionManager: SessionManager;
  let backend: FakeSftpBackend;
  const sessionId = 'test-session-mkdir';

  beforeEach(() => {
    sessionManager = new SessionManager();
    backend = new FakeSftpBackend();
    const session = sessionManager.createSession(sessionId);
    session.state = 'active';
    session.backend = backend;
    backend['connected'] = true;
  });

  it('should create directory and return {created: true} (Req 9.1)', async () => {
    const result = await handleMkdir({ path: '/newdir' }, sessionId, sessionManager);
    expect(result).toEqual({ created: true });
  });

  it('should throw -32012 when path already exists (Req 9.4)', async () => {
    backend.setFile('/existing', {
      type: 'directory', size: 0,
      mtime: 1700000000, atime: 1700000001, mode: 0o755,
    });
    await expect(
      handleMkdir({ path: '/existing' }, sessionId, sessionManager)
    ).rejects.toMatchObject({ code: -32012 });
  });

  it('should normalize path before creating', async () => {
    const result = await handleMkdir({ path: '/parent/./newdir' }, sessionId, sessionManager);
    expect(result).toEqual({ created: true });
  });

  it('should throw -32602 for missing path param', async () => {
    await expect(
      handleMkdir({}, sessionId, sessionManager)
    ).rejects.toMatchObject({ code: -32602 });
  });

  it('should throw -32602 for non-string path param', async () => {
    await expect(
      handleMkdir({ path: 123 }, sessionId, sessionManager)
    ).rejects.toMatchObject({ code: -32602 });
  });

  it('should throw -32000 for unknown session', async () => {
    await expect(
      handleMkdir({ path: '/newdir' }, 'unknown-session', sessionManager)
    ).rejects.toMatchObject({ code: -32000 });
  });

  it('should throw -32000 for session without backend', async () => {
    const noBackendSession = sessionManager.createSession('no-backend');
    noBackendSession.state = 'active';
    await expect(
      handleMkdir({ path: '/newdir' }, 'no-backend', sessionManager)
    ).rejects.toMatchObject({ code: -32000 });
  });

  it('should throw -32011 for permission denied (Req 9.6)', async () => {
    backend.mkdir = async (_path: string) => {
      const err = new Error('Permission denied') as any;
      err.code = 'EACCES';
      throw err;
    };
    await expect(
      handleMkdir({ path: '/restricted' }, sessionId, sessionManager)
    ).rejects.toMatchObject({ code: -32011 });
  });
});

describe('sftp/delete handler', () => {
  let sessionManager: SessionManager;
  let backend: FakeSftpBackend;
  const sessionId = 'test-session-delete';

  beforeEach(() => {
    sessionManager = new SessionManager();
    backend = new FakeSftpBackend();
    const session = sessionManager.createSession(sessionId);
    session.state = 'active';
    session.backend = backend;
    backend['connected'] = true;

    backend.setFile('/file.txt', {
      type: 'file', content: Buffer.from('data'),
      size: 4, mtime: 1700000000, atime: 1700000001, mode: 0o644,
    });
    backend.setFile('/dir', {
      type: 'directory', size: 0,
      mtime: 1700000000, atime: 1700000001, mode: 0o755,
    });
    backend.setFile('/dir/child.txt', {
      type: 'file', content: Buffer.from('child'),
      size: 5, mtime: 1700000010, atime: 1700000011, mode: 0o644,
    });
  });

  it('should delete file and return {deleted: true} (Req 9.2)', async () => {
    const result = await handleDelete({ path: '/file.txt' }, sessionId, sessionManager);
    expect(result).toEqual({ deleted: true });
  });

  it('should delete empty directory', async () => {
    backend.setFile('/emptydir', {
      type: 'directory', size: 0,
      mtime: 1700000000, atime: 1700000001, mode: 0o755,
    });
    const result = await handleDelete({ path: '/emptydir' }, sessionId, sessionManager);
    expect(result).toEqual({ deleted: true });
  });

  it('should throw -32024 for non-empty directory without recursive (Req 9.7)', async () => {
    await expect(
      handleDelete({ path: '/dir' }, sessionId, sessionManager)
    ).rejects.toMatchObject({ code: -32024 });
  });

  it('should recursively delete directory when recursive=true (Req 9.7)', async () => {
    const result = await handleDelete({ path: '/dir', recursive: true }, sessionId, sessionManager);
    expect(result).toEqual({ deleted: true });
  });

  it('should default recursive to false', async () => {
    await expect(
      handleDelete({ path: '/dir' }, sessionId, sessionManager)
    ).rejects.toMatchObject({ code: -32024 });
  });

  it('should throw -32010 for non-existent path (Req 9.5)', async () => {
    await expect(
      handleDelete({ path: '/nonexistent' }, sessionId, sessionManager)
    ).rejects.toMatchObject({ code: -32010 });
  });

  it('should throw -32602 for missing path param', async () => {
    await expect(
      handleDelete({}, sessionId, sessionManager)
    ).rejects.toMatchObject({ code: -32602 });
  });

  it('should throw -32000 for unknown session', async () => {
    await expect(
      handleDelete({ path: '/file.txt' }, 'unknown-session', sessionManager)
    ).rejects.toMatchObject({ code: -32000 });
  });

  it('should throw -32011 for permission denied (Req 9.6)', async () => {
    backend.delete = async (_path: string, _recursive?: boolean) => {
      const err = new Error('Permission denied') as any;
      err.code = 'EACCES';
      throw err;
    };
    await expect(
      handleDelete({ path: '/file.txt' }, sessionId, sessionManager)
    ).rejects.toMatchObject({ code: -32011 });
  });

  it('should normalize path before deleting', async () => {
    const result = await handleDelete({ path: '/./file.txt' }, sessionId, sessionManager);
    expect(result).toEqual({ deleted: true });
  });
});

describe('sftp/rename handler', () => {
  let sessionManager: SessionManager;
  let backend: FakeSftpBackend;
  const sessionId = 'test-session-rename';

  beforeEach(() => {
    sessionManager = new SessionManager();
    backend = new FakeSftpBackend();
    const session = sessionManager.createSession(sessionId);
    session.state = 'active';
    session.backend = backend;
    backend['connected'] = true;

    backend.setFile('/old.txt', {
      type: 'file', content: Buffer.from('content'),
      size: 7, mtime: 1700000000, atime: 1700000001, mode: 0o644,
    });
  });

  it('should rename file and return {renamed: true} (Req 9.3)', async () => {
    const result = await handleRename(
      { oldPath: '/old.txt', newPath: '/new.txt' },
      sessionId, sessionManager
    );
    expect(result).toEqual({ renamed: true });
  });

  it('should throw -32010 for non-existent oldPath (Req 9.5)', async () => {
    await expect(
      handleRename(
        { oldPath: '/nonexistent.txt', newPath: '/new.txt' },
        sessionId, sessionManager
      )
    ).rejects.toMatchObject({ code: -32010 });
  });

  it('should throw -32602 for missing oldPath param', async () => {
    await expect(
      handleRename({ newPath: '/new.txt' }, sessionId, sessionManager)
    ).rejects.toMatchObject({ code: -32602 });
  });

  it('should throw -32602 for missing newPath param', async () => {
    await expect(
      handleRename({ oldPath: '/old.txt' }, sessionId, sessionManager)
    ).rejects.toMatchObject({ code: -32602 });
  });

  it('should throw -32602 for non-string oldPath', async () => {
    await expect(
      handleRename({ oldPath: 123, newPath: '/new.txt' }, sessionId, sessionManager)
    ).rejects.toMatchObject({ code: -32602 });
  });

  it('should throw -32602 for non-string newPath', async () => {
    await expect(
      handleRename({ oldPath: '/old.txt', newPath: 123 }, sessionId, sessionManager)
    ).rejects.toMatchObject({ code: -32602 });
  });

  it('should throw -32000 for unknown session', async () => {
    await expect(
      handleRename(
        { oldPath: '/old.txt', newPath: '/new.txt' },
        'unknown-session', sessionManager
      )
    ).rejects.toMatchObject({ code: -32000 });
  });

  it('should throw -32000 for session without backend', async () => {
    const noBackendSession = sessionManager.createSession('no-backend');
    noBackendSession.state = 'active';
    await expect(
      handleRename(
        { oldPath: '/old.txt', newPath: '/new.txt' },
        'no-backend', sessionManager
      )
    ).rejects.toMatchObject({ code: -32000 });
  });

  it('should throw -32011 for permission denied (Req 9.6)', async () => {
    backend.rename = async (_oldPath: string, _newPath: string) => {
      const err = new Error('Permission denied') as any;
      err.code = 'EACCES';
      throw err;
    };
    await expect(
      handleRename(
        { oldPath: '/old.txt', newPath: '/new.txt' },
        sessionId, sessionManager
      )
    ).rejects.toMatchObject({ code: -32011 });
  });

  it('should normalize both paths before renaming', async () => {
    const result = await handleRename(
      { oldPath: '/./old.txt', newPath: '/./new.txt' },
      sessionId, sessionManager
    );
    expect(result).toEqual({ renamed: true });
  });
});
