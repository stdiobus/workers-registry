/**
 * Unit tests for SFTP chunked I/O handlers
 * 
 * Tests sftp/openRead, sftp/readChunk, sftp/closeRead,
 * sftp/openWrite, sftp/writeChunk, sftp/commitWrite, sftp/abortWrite
 * using FakeSftpBackend and HandleManager for deterministic testing.
 */

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
  handleAbortWrite,
} from '../rpc/sftp-chunked-methods.js';

// ============================================================================
// Test helpers
// ============================================================================

function createTestSession() {
  const sessionManager = new SessionManager();
  const backend = new FakeSftpBackend();
  const handleManager = new HandleManager(32, 60000);
  const sessionId = 'chunked-test-session';

  const session = sessionManager.createSession(sessionId);
  session.state = 'active';
  session.backend = backend;
  session.handleManager = handleManager;
  backend['connected'] = true;

  return { sessionManager, backend, handleManager, sessionId, session };
}

// ============================================================================
// sftp/openRead
// ============================================================================

describe('sftp/openRead handler', () => {
  it('should return handleId and fileSize for existing file', async () => {
    const { sessionManager, backend, sessionId } = createTestSession();
    backend.setFile('/test.txt', {
      type: 'file', content: Buffer.from('hello world'),
      size: 11, mtime: 1700000000, atime: 1700000001, mode: 0o644,
    });

    const result = await handleOpenRead({ path: '/test.txt' }, sessionId, sessionManager);
    expect(result).toHaveProperty('handleId');
    expect(typeof result.handleId).toBe('string');
    expect(result.fileSize).toBe(11);
  });

  it('should normalize path before opening', async () => {
    const { sessionManager, backend, sessionId } = createTestSession();
    backend.setFile('/dir', {
      type: 'directory', size: 0, mtime: 1700000000, atime: 1700000001, mode: 0o755,
    });
    backend.setFile('/dir/file.txt', {
      type: 'file', content: Buffer.from('data'),
      size: 4, mtime: 1700000000, atime: 1700000001, mode: 0o644,
    });

    const result = await handleOpenRead({ path: '/dir/./file.txt' }, sessionId, sessionManager);
    expect(result.handleId).toBeDefined();
    expect(result.fileSize).toBe(4);
  });

  it('should throw -32010 for non-existent file', async () => {
    const { sessionManager, sessionId } = createTestSession();
    await expect(
      handleOpenRead({ path: '/missing.txt' }, sessionId, sessionManager)
    ).rejects.toMatchObject({ code: -32010 });
  });

  it('should throw -32602 for missing path param', async () => {
    const { sessionManager, sessionId } = createTestSession();
    await expect(
      handleOpenRead({}, sessionId, sessionManager)
    ).rejects.toMatchObject({ code: -32602 });
  });

  it('should throw -32602 for non-string path param', async () => {
    const { sessionManager, sessionId } = createTestSession();
    await expect(
      handleOpenRead({ path: 123 }, sessionId, sessionManager)
    ).rejects.toMatchObject({ code: -32602 });
  });

  it('should throw -32000 for unknown session', async () => {
    const { sessionManager } = createTestSession();
    await expect(
      handleOpenRead({ path: '/test.txt' }, 'unknown-session', sessionManager)
    ).rejects.toMatchObject({ code: -32000 });
  });

  it('should throw -32000 for session without backend', async () => {
    const sessionManager = new SessionManager();
    const session = sessionManager.createSession('no-backend');
    session.state = 'active';
    session.handleManager = new HandleManager();

    await expect(
      handleOpenRead({ path: '/test.txt' }, 'no-backend', sessionManager)
    ).rejects.toMatchObject({ code: -32000 });
  });

  it('should throw -32000 for session without handleManager', async () => {
    const sessionManager = new SessionManager();
    const backend = new FakeSftpBackend();
    backend['connected'] = true;
    const session = sessionManager.createSession('no-hm');
    session.state = 'active';
    session.backend = backend;
    // handleManager is null

    backend.setFile('/test.txt', {
      type: 'file', content: Buffer.from('data'),
      size: 4, mtime: 1700000000, atime: 1700000001, mode: 0o644,
    });

    await expect(
      handleOpenRead({ path: '/test.txt' }, 'no-hm', sessionManager)
    ).rejects.toMatchObject({ code: -32000 });
  });
});

// ============================================================================
// sftp/readChunk
// ============================================================================

describe('sftp/readChunk handler', () => {
  it('should read a chunk and return base64 data', async () => {
    const { sessionManager, backend, sessionId } = createTestSession();
    const content = Buffer.from('Hello, chunked world!');
    backend.setFile('/chunked.txt', {
      type: 'file', content,
      size: content.length, mtime: 1700000000, atime: 1700000001, mode: 0o644,
    });

    const openResult = await handleOpenRead({ path: '/chunked.txt' }, sessionId, sessionManager);
    const result = await handleReadChunk(
      { handleId: openResult.handleId, offset: 0, length: 10 },
      sessionId, sessionManager
    );

    expect(result.offset).toBe(0);
    expect(result.length).toBe(10);
    expect(result.eof).toBe(false);
    const decoded = Buffer.from(result.data, 'base64');
    expect(decoded.toString()).toBe('Hello, chu');
  });

  it('should return eof=true when stream ends', async () => {
    const { sessionManager, backend, sessionId } = createTestSession();
    const content = Buffer.from('short');
    backend.setFile('/short.txt', {
      type: 'file', content,
      size: content.length, mtime: 1700000000, atime: 1700000001, mode: 0o644,
    });

    const openResult = await handleOpenRead({ path: '/short.txt' }, sessionId, sessionManager);
    const result = await handleReadChunk(
      { handleId: openResult.handleId, offset: 0, length: 100 },
      sessionId, sessionManager
    );

    expect(result.length).toBe(5);
    expect(result.eof).toBe(true);
    const decoded = Buffer.from(result.data, 'base64');
    expect(decoded.toString()).toBe('short');
  });

  it('should read multiple sequential chunks', async () => {
    const { sessionManager, backend, sessionId } = createTestSession();
    const content = Buffer.from('ABCDEFGHIJ');
    backend.setFile('/multi.txt', {
      type: 'file', content,
      size: content.length, mtime: 1700000000, atime: 1700000001, mode: 0o644,
    });

    const openResult = await handleOpenRead({ path: '/multi.txt' }, sessionId, sessionManager);

    const chunk1 = await handleReadChunk(
      { handleId: openResult.handleId, offset: 0, length: 5 },
      sessionId, sessionManager
    );
    expect(Buffer.from(chunk1.data, 'base64').toString()).toBe('ABCDE');
    expect(chunk1.eof).toBe(false);

    const chunk2 = await handleReadChunk(
      { handleId: openResult.handleId, offset: 5, length: 5 },
      sessionId, sessionManager
    );
    expect(Buffer.from(chunk2.data, 'base64').toString()).toBe('FGHIJ');
    // eof may or may not be true here depending on stream internals.
    // If not eof yet, the next read should return eof.
    if (!chunk2.eof) {
      const chunk3 = await handleReadChunk(
        { handleId: openResult.handleId, offset: 10, length: 5 },
        sessionId, sessionManager
      );
      expect(chunk3.length).toBe(0);
      expect(chunk3.eof).toBe(true);
    }
  });

  it('should throw -32602 for missing handleId', async () => {
    const { sessionManager, sessionId } = createTestSession();
    await expect(
      handleReadChunk({ offset: 0, length: 10 }, sessionId, sessionManager)
    ).rejects.toMatchObject({ code: -32602 });
  });

  it('should throw -32602 for missing offset', async () => {
    const { sessionManager, sessionId } = createTestSession();
    await expect(
      handleReadChunk({ handleId: 'abc', length: 10 }, sessionId, sessionManager)
    ).rejects.toMatchObject({ code: -32602 });
  });

  it('should throw -32602 for negative offset', async () => {
    const { sessionManager, sessionId } = createTestSession();
    await expect(
      handleReadChunk({ handleId: 'abc', offset: -1, length: 10 }, sessionId, sessionManager)
    ).rejects.toMatchObject({ code: -32602 });
  });

  it('should throw -32602 for missing length', async () => {
    const { sessionManager, sessionId } = createTestSession();
    await expect(
      handleReadChunk({ handleId: 'abc', offset: 0 }, sessionId, sessionManager)
    ).rejects.toMatchObject({ code: -32602 });
  });

  it('should throw -32602 for zero length', async () => {
    const { sessionManager, sessionId } = createTestSession();
    await expect(
      handleReadChunk({ handleId: 'abc', offset: 0, length: 0 }, sessionId, sessionManager)
    ).rejects.toMatchObject({ code: -32602 });
  });

  it('should throw -32032 for invalid handleId', async () => {
    const { sessionManager, sessionId } = createTestSession();
    await expect(
      handleReadChunk({ handleId: 'nonexistent', offset: 0, length: 10 }, sessionId, sessionManager)
    ).rejects.toMatchObject({ code: -32032 });
  });

  it('should throw -32032 when using a write handle for readChunk', async () => {
    const { sessionManager, backend, sessionId } = createTestSession();
    backend.setFile('/write-target.txt', {
      type: 'file', content: Buffer.from('data'),
      size: 4, mtime: 1700000000, atime: 1700000001, mode: 0o644,
    });

    const openResult = await handleOpenWrite({ path: '/write-target.txt' }, sessionId, sessionManager);
    await expect(
      handleReadChunk({ handleId: openResult.handleId, offset: 0, length: 10 }, sessionId, sessionManager)
    ).rejects.toMatchObject({ code: -32032 });
  });

  it('should handle empty file (eof immediately)', async () => {
    const { sessionManager, backend, sessionId } = createTestSession();
    backend.setFile('/empty.txt', {
      type: 'file', content: Buffer.alloc(0),
      size: 0, mtime: 1700000000, atime: 1700000001, mode: 0o644,
    });

    const openResult = await handleOpenRead({ path: '/empty.txt' }, sessionId, sessionManager);
    const result = await handleReadChunk(
      { handleId: openResult.handleId, offset: 0, length: 100 },
      sessionId, sessionManager
    );

    expect(result.length).toBe(0);
    expect(result.eof).toBe(true);
  });
});

// ============================================================================
// sftp/closeRead
// ============================================================================

describe('sftp/closeRead handler', () => {
  it('should close a read handle and return {closed: true}', async () => {
    const { sessionManager, backend, sessionId, handleManager } = createTestSession();
    backend.setFile('/test.txt', {
      type: 'file', content: Buffer.from('data'),
      size: 4, mtime: 1700000000, atime: 1700000001, mode: 0o644,
    });

    const openResult = await handleOpenRead({ path: '/test.txt' }, sessionId, sessionManager);
    expect(handleManager.openCount).toBe(1);

    const result = await handleCloseRead({ handleId: openResult.handleId }, sessionId, sessionManager);
    expect(result).toEqual({ closed: true });
    expect(handleManager.openCount).toBe(0);
  });

  it('should be idempotent (closing already-closed handle)', async () => {
    const { sessionManager, backend, sessionId } = createTestSession();
    backend.setFile('/test.txt', {
      type: 'file', content: Buffer.from('data'),
      size: 4, mtime: 1700000000, atime: 1700000001, mode: 0o644,
    });

    const openResult = await handleOpenRead({ path: '/test.txt' }, sessionId, sessionManager);
    await handleCloseRead({ handleId: openResult.handleId }, sessionId, sessionManager);
    // Second close should not throw
    const result = await handleCloseRead({ handleId: openResult.handleId }, sessionId, sessionManager);
    expect(result).toEqual({ closed: true });
  });

  it('should throw -32602 for missing handleId', async () => {
    const { sessionManager, sessionId } = createTestSession();
    await expect(
      handleCloseRead({}, sessionId, sessionManager)
    ).rejects.toMatchObject({ code: -32602 });
  });

  it('should throw -32000 for unknown session', async () => {
    const { sessionManager } = createTestSession();
    await expect(
      handleCloseRead({ handleId: 'abc' }, 'unknown-session', sessionManager)
    ).rejects.toMatchObject({ code: -32000 });
  });
});


// ============================================================================
// sftp/openWrite
// ============================================================================

describe('sftp/openWrite handler', () => {
  it('should return handleId for new file (create=true default)', async () => {
    const { sessionManager, sessionId } = createTestSession();
    const result = await handleOpenWrite({ path: '/newfile.txt' }, sessionId, sessionManager);
    expect(result).toHaveProperty('handleId');
    expect(typeof result.handleId).toBe('string');
  });

  it('should return handleId for existing file (overwrite=true default)', async () => {
    const { sessionManager, backend, sessionId } = createTestSession();
    backend.setFile('/existing.txt', {
      type: 'file', content: Buffer.from('old'),
      size: 3, mtime: 1700000000, atime: 1700000001, mode: 0o644,
    });

    const result = await handleOpenWrite({ path: '/existing.txt' }, sessionId, sessionManager);
    expect(result.handleId).toBeDefined();
  });

  it('should throw -32012 when overwrite=false and file exists', async () => {
    const { sessionManager, backend, sessionId } = createTestSession();
    backend.setFile('/existing.txt', {
      type: 'file', content: Buffer.from('old'),
      size: 3, mtime: 1700000000, atime: 1700000001, mode: 0o644,
    });

    await expect(
      handleOpenWrite({ path: '/existing.txt', overwrite: false }, sessionId, sessionManager)
    ).rejects.toMatchObject({ code: -32012 });
  });

  it('should throw -32010 when create=false and file does not exist', async () => {
    const { sessionManager, sessionId } = createTestSession();
    await expect(
      handleOpenWrite({ path: '/missing.txt', create: false }, sessionId, sessionManager)
    ).rejects.toMatchObject({ code: -32010 });
  });

  it('should allow create=false with existing file', async () => {
    const { sessionManager, backend, sessionId } = createTestSession();
    backend.setFile('/existing.txt', {
      type: 'file', content: Buffer.from('old'),
      size: 3, mtime: 1700000000, atime: 1700000001, mode: 0o644,
    });

    const result = await handleOpenWrite(
      { path: '/existing.txt', create: false },
      sessionId, sessionManager
    );
    expect(result.handleId).toBeDefined();
  });

  it('should allow overwrite=false with new file', async () => {
    const { sessionManager, sessionId } = createTestSession();
    const result = await handleOpenWrite(
      { path: '/brand-new.txt', overwrite: false },
      sessionId, sessionManager
    );
    expect(result.handleId).toBeDefined();
  });

  it('should normalize path before opening', async () => {
    const { sessionManager, sessionId } = createTestSession();
    const result = await handleOpenWrite({ path: '/dir/./file.txt' }, sessionId, sessionManager);
    expect(result.handleId).toBeDefined();
  });

  it('should throw -32602 for missing path param', async () => {
    const { sessionManager, sessionId } = createTestSession();
    await expect(
      handleOpenWrite({}, sessionId, sessionManager)
    ).rejects.toMatchObject({ code: -32602 });
  });

  it('should throw -32602 for non-string path param', async () => {
    const { sessionManager, sessionId } = createTestSession();
    await expect(
      handleOpenWrite({ path: 42 }, sessionId, sessionManager)
    ).rejects.toMatchObject({ code: -32602 });
  });

  it('should throw -32000 for unknown session', async () => {
    const { sessionManager } = createTestSession();
    await expect(
      handleOpenWrite({ path: '/test.txt' }, 'unknown-session', sessionManager)
    ).rejects.toMatchObject({ code: -32000 });
  });

  it('should throw -32000 for session without backend', async () => {
    const sessionManager = new SessionManager();
    const session = sessionManager.createSession('no-backend');
    session.state = 'active';
    session.handleManager = new HandleManager();

    await expect(
      handleOpenWrite({ path: '/test.txt' }, 'no-backend', sessionManager)
    ).rejects.toMatchObject({ code: -32000 });
  });
});

// ============================================================================
// sftp/writeChunk
// ============================================================================

describe('sftp/writeChunk handler', () => {
  it('should write a chunk and return written byte count', async () => {
    const { sessionManager, backend, sessionId } = createTestSession();
    const openResult = await handleOpenWrite({ path: '/write.txt' }, sessionId, sessionManager);

    const data = Buffer.from('Hello');
    const result = await handleWriteChunk(
      { handleId: openResult.handleId, offset: 0, data: data.toString('base64') },
      sessionId, sessionManager
    );

    expect(result.written).toBe(5);
  });

  it('should write multiple sequential chunks', async () => {
    const { sessionManager, sessionId } = createTestSession();
    const openResult = await handleOpenWrite({ path: '/multi.txt' }, sessionId, sessionManager);

    const chunk1 = Buffer.from('ABC');
    const result1 = await handleWriteChunk(
      { handleId: openResult.handleId, offset: 0, data: chunk1.toString('base64') },
      sessionId, sessionManager
    );
    expect(result1.written).toBe(3);

    const chunk2 = Buffer.from('DEF');
    const result2 = await handleWriteChunk(
      { handleId: openResult.handleId, offset: 3, data: chunk2.toString('base64') },
      sessionId, sessionManager
    );
    expect(result2.written).toBe(3);
  });

  it('should throw -32031 for non-sequential offset', async () => {
    const { sessionManager, sessionId } = createTestSession();
    const openResult = await handleOpenWrite({ path: '/bad-offset.txt' }, sessionId, sessionManager);

    const chunk1 = Buffer.from('ABC');
    await handleWriteChunk(
      { handleId: openResult.handleId, offset: 0, data: chunk1.toString('base64') },
      sessionId, sessionManager
    );

    // Next expected offset is 3, but we send 10
    const chunk2 = Buffer.from('DEF');
    await expect(
      handleWriteChunk(
        { handleId: openResult.handleId, offset: 10, data: chunk2.toString('base64') },
        sessionId, sessionManager
      )
    ).rejects.toMatchObject({ code: -32031 });
  });

  it('should throw -32031 for first chunk with non-zero offset', async () => {
    const { sessionManager, sessionId } = createTestSession();
    const openResult = await handleOpenWrite({ path: '/bad-start.txt' }, sessionId, sessionManager);

    const data = Buffer.from('data');
    await expect(
      handleWriteChunk(
        { handleId: openResult.handleId, offset: 5, data: data.toString('base64') },
        sessionId, sessionManager
      )
    ).rejects.toMatchObject({ code: -32031 });
  });

  it('should throw -32602 for missing handleId', async () => {
    const { sessionManager, sessionId } = createTestSession();
    await expect(
      handleWriteChunk({ offset: 0, data: 'aGVsbG8=' }, sessionId, sessionManager)
    ).rejects.toMatchObject({ code: -32602 });
  });

  it('should throw -32602 for missing offset', async () => {
    const { sessionManager, sessionId } = createTestSession();
    await expect(
      handleWriteChunk({ handleId: 'abc', data: 'aGVsbG8=' }, sessionId, sessionManager)
    ).rejects.toMatchObject({ code: -32602 });
  });

  it('should throw -32602 for missing data', async () => {
    const { sessionManager, sessionId } = createTestSession();
    await expect(
      handleWriteChunk({ handleId: 'abc', offset: 0 }, sessionId, sessionManager)
    ).rejects.toMatchObject({ code: -32602 });
  });

  it('should throw -32032 for invalid handleId', async () => {
    const { sessionManager, sessionId } = createTestSession();
    await expect(
      handleWriteChunk(
        { handleId: 'nonexistent', offset: 0, data: 'aGVsbG8=' },
        sessionId, sessionManager
      )
    ).rejects.toMatchObject({ code: -32032 });
  });

  it('should throw -32032 when using a read handle for writeChunk', async () => {
    const { sessionManager, backend, sessionId } = createTestSession();
    backend.setFile('/read-target.txt', {
      type: 'file', content: Buffer.from('data'),
      size: 4, mtime: 1700000000, atime: 1700000001, mode: 0o644,
    });

    const openResult = await handleOpenRead({ path: '/read-target.txt' }, sessionId, sessionManager);
    await expect(
      handleWriteChunk(
        { handleId: openResult.handleId, offset: 0, data: 'aGVsbG8=' },
        sessionId, sessionManager
      )
    ).rejects.toMatchObject({ code: -32032 });
  });
});

// ============================================================================
// sftp/commitWrite
// ============================================================================

describe('sftp/commitWrite handler', () => {
  it('should commit write and return committed, size, sha256', async () => {
    const { sessionManager, backend, sessionId, handleManager } = createTestSession();
    const openResult = await handleOpenWrite({ path: '/commit.txt' }, sessionId, sessionManager);

    const data = Buffer.from('committed data');
    await handleWriteChunk(
      { handleId: openResult.handleId, offset: 0, data: data.toString('base64') },
      sessionId, sessionManager
    );

    const result = await handleCommitWrite(
      { handleId: openResult.handleId },
      sessionId, sessionManager
    );

    expect(result.committed).toBe(true);
    expect(result.size).toBe(data.length);
    expect(typeof result.sha256).toBe('string');
    expect(result.sha256).toHaveLength(64); // SHA256 hex

    // Verify sha256 is correct
    const { createHash } = await import('crypto');
    const expectedSha256 = createHash('sha256').update(data).digest('hex');
    expect(result.sha256).toBe(expectedSha256);

    // Handle should be closed after commit
    expect(handleManager.openCount).toBe(0);
  });

  it('should commit empty file', async () => {
    const { sessionManager, sessionId } = createTestSession();
    const openResult = await handleOpenWrite({ path: '/empty-commit.txt' }, sessionId, sessionManager);

    const result = await handleCommitWrite(
      { handleId: openResult.handleId },
      sessionId, sessionManager
    );

    expect(result.committed).toBe(true);
    expect(result.size).toBe(0);
    expect(typeof result.sha256).toBe('string');
  });

  it('should throw -32602 for missing handleId', async () => {
    const { sessionManager, sessionId } = createTestSession();
    await expect(
      handleCommitWrite({}, sessionId, sessionManager)
    ).rejects.toMatchObject({ code: -32602 });
  });

  it('should throw -32032 for invalid handleId', async () => {
    const { sessionManager, sessionId } = createTestSession();
    await expect(
      handleCommitWrite({ handleId: 'nonexistent' }, sessionId, sessionManager)
    ).rejects.toMatchObject({ code: -32032 });
  });

  it('should throw -32032 when using a read handle for commitWrite', async () => {
    const { sessionManager, backend, sessionId } = createTestSession();
    backend.setFile('/read-target.txt', {
      type: 'file', content: Buffer.from('data'),
      size: 4, mtime: 1700000000, atime: 1700000001, mode: 0o644,
    });

    const openResult = await handleOpenRead({ path: '/read-target.txt' }, sessionId, sessionManager);
    await expect(
      handleCommitWrite({ handleId: openResult.handleId }, sessionId, sessionManager)
    ).rejects.toMatchObject({ code: -32032 });
  });
});

// ============================================================================
// sftp/abortWrite
// ============================================================================

describe('sftp/abortWrite handler', () => {
  it('should abort write and return {aborted: true}', async () => {
    const { sessionManager, sessionId, handleManager } = createTestSession();
    const openResult = await handleOpenWrite({ path: '/abort.txt' }, sessionId, sessionManager);
    expect(handleManager.openCount).toBe(1);

    const result = await handleAbortWrite(
      { handleId: openResult.handleId },
      sessionId, sessionManager
    );

    expect(result).toEqual({ aborted: true });
    expect(handleManager.openCount).toBe(0);
  });

  it('should be idempotent (aborting already-closed handle)', async () => {
    const { sessionManager, sessionId } = createTestSession();
    const openResult = await handleOpenWrite({ path: '/abort2.txt' }, sessionId, sessionManager);

    await handleAbortWrite({ handleId: openResult.handleId }, sessionId, sessionManager);
    // Second abort should not throw
    const result = await handleAbortWrite({ handleId: openResult.handleId }, sessionId, sessionManager);
    expect(result).toEqual({ aborted: true });
  });

  it('should throw -32602 for missing handleId', async () => {
    const { sessionManager, sessionId } = createTestSession();
    await expect(
      handleAbortWrite({}, sessionId, sessionManager)
    ).rejects.toMatchObject({ code: -32602 });
  });

  it('should throw -32000 for unknown session', async () => {
    const { sessionManager } = createTestSession();
    await expect(
      handleAbortWrite({ handleId: 'abc' }, 'unknown-session', sessionManager)
    ).rejects.toMatchObject({ code: -32000 });
  });
});

// ============================================================================
// Full chunked write round-trip
// ============================================================================

describe('Chunked write round-trip', () => {
  it('should write chunks and read back identical data', async () => {
    const { sessionManager, backend, sessionId } = createTestSession();
    const originalData = Buffer.from('The quick brown fox jumps over the lazy dog');

    // Open write
    const openResult = await handleOpenWrite({ path: '/roundtrip.txt' }, sessionId, sessionManager);

    // Write in two chunks
    const chunk1 = originalData.subarray(0, 20);
    const chunk2 = originalData.subarray(20);

    await handleWriteChunk(
      { handleId: openResult.handleId, offset: 0, data: chunk1.toString('base64') },
      sessionId, sessionManager
    );
    await handleWriteChunk(
      { handleId: openResult.handleId, offset: 20, data: chunk2.toString('base64') },
      sessionId, sessionManager
    );

    // Commit
    const commitResult = await handleCommitWrite(
      { handleId: openResult.handleId },
      sessionId, sessionManager
    );
    expect(commitResult.committed).toBe(true);
    expect(commitResult.size).toBe(originalData.length);

    // Read back via backend
    const readBack = await backend.readFile('/roundtrip.txt');
    expect(readBack.equals(originalData)).toBe(true);
  });

  it('should write and read back binary data', async () => {
    const { sessionManager, backend, sessionId } = createTestSession();
    const binaryData = Buffer.alloc(256);
    for (let i = 0; i < 256; i++) binaryData[i] = i;

    const openResult = await handleOpenWrite({ path: '/binary.bin' }, sessionId, sessionManager);
    await handleWriteChunk(
      { handleId: openResult.handleId, offset: 0, data: binaryData.toString('base64') },
      sessionId, sessionManager
    );
    const commitResult = await handleCommitWrite(
      { handleId: openResult.handleId },
      sessionId, sessionManager
    );

    expect(commitResult.committed).toBe(true);
    expect(commitResult.size).toBe(256);

    const readBack = await backend.readFile('/binary.bin');
    expect(readBack.equals(binaryData)).toBe(true);
  });
});

// ============================================================================
// Full chunked read round-trip
// ============================================================================

describe('Chunked read round-trip', () => {
  it('should read file in chunks and reconstruct original content', async () => {
    const { sessionManager, backend, sessionId } = createTestSession();
    const content = Buffer.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
    backend.setFile('/alphabet.txt', {
      type: 'file', content,
      size: content.length, mtime: 1700000000, atime: 1700000001, mode: 0o644,
    });

    const openResult = await handleOpenRead({ path: '/alphabet.txt' }, sessionId, sessionManager);
    expect(openResult.fileSize).toBe(26);

    const allChunks: Buffer[] = [];
    let offset = 0;
    let eof = false;

    while (!eof) {
      const chunk = await handleReadChunk(
        { handleId: openResult.handleId, offset, length: 10 },
        sessionId, sessionManager
      );
      const decoded = Buffer.from(chunk.data, 'base64');
      allChunks.push(decoded);
      offset += chunk.length;
      eof = chunk.eof;
    }

    await handleCloseRead({ handleId: openResult.handleId }, sessionId, sessionManager);

    const reconstructed = Buffer.concat(allChunks);
    expect(reconstructed.equals(content)).toBe(true);
  });
});
