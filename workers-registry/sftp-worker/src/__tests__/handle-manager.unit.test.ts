/**
 * Unit Tests for HandleManager
 * 
 * Tests HandleManager lifecycle, TTL, limits, and offset validation.
 */

import { Readable, Writable, PassThrough } from 'stream';
import { HandleManager, StreamHandle } from '../handle-manager.js';
import { SftpError } from '../types.js';
import { INVALID_OR_EXPIRED_HANDLE, INVALID_CHUNK, RESOURCE_BUSY } from '../error-codes.js';

// ============================================================================
// Helpers
// ============================================================================

function createMockReadStream(): Readable {
  return new PassThrough();
}

function createMockWriteStream(): Writable {
  return new PassThrough();
}

// ============================================================================
// Tests: open / get / close / closeAll
// ============================================================================

describe('HandleManager — lifecycle (open/get/close/closeAll)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('open() returns a unique handleId string', () => {
    const hm = new HandleManager(32, 60000);
    const stream = createMockReadStream();
    const id = hm.open('read', '/file.txt', stream);

    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
    expect(hm.openCount).toBe(1);

    hm.closeAll();
  });

  it('open() creates handles with correct initial state', () => {
    const hm = new HandleManager(32, 60000);
    const stream = createMockWriteStream();
    const id = hm.open('write', '/data.bin', stream);
    const handle = hm.get(id);

    expect(handle.handleId).toBe(id);
    expect(handle.type).toBe('write');
    expect(handle.path).toBe('/data.bin');
    expect(handle.stream).toBe(stream);
    expect(handle.nextExpectedOffset).toBe(0);
    expect(handle.createdAt).toBeGreaterThan(0);
    expect(handle.lastAccessAt).toBeGreaterThan(0);

    hm.closeAll();
  });

  it('get() returns the correct handle', () => {
    const hm = new HandleManager(32, 60000);
    const s1 = createMockReadStream();
    const s2 = createMockWriteStream();
    const id1 = hm.open('read', '/a.txt', s1);
    const id2 = hm.open('write', '/b.txt', s2);

    expect(hm.get(id1).path).toBe('/a.txt');
    expect(hm.get(id2).path).toBe('/b.txt');

    hm.closeAll();
  });

  it('get() throws -32032 for unknown handleId', () => {
    const hm = new HandleManager(32, 60000);

    expect(() => hm.get('nonexistent-id')).toThrow(SftpError);
    try {
      hm.get('nonexistent-id');
    } catch (e: any) {
      expect(e.code).toBe(INVALID_OR_EXPIRED_HANDLE);
    }

    hm.closeAll();
  });

  it('close() removes the handle', () => {
    const hm = new HandleManager(32, 60000);
    const id = hm.open('read', '/file.txt', createMockReadStream());
    expect(hm.openCount).toBe(1);

    hm.close(id);
    expect(hm.openCount).toBe(0);

    // get() should now throw
    expect(() => hm.get(id)).toThrow(SftpError);

    hm.closeAll();
  });

  it('close() is idempotent — no error on double close', () => {
    const hm = new HandleManager(32, 60000);
    const id = hm.open('read', '/file.txt', createMockReadStream());

    hm.close(id);
    expect(() => hm.close(id)).not.toThrow();
    expect(hm.openCount).toBe(0);

    hm.closeAll();
  });

  it('closeAll() removes all handles and stops cleanup timer', () => {
    const hm = new HandleManager(32, 60000);
    hm.open('read', '/a.txt', createMockReadStream());
    hm.open('write', '/b.txt', createMockWriteStream());
    hm.open('read', '/c.txt', createMockReadStream());
    expect(hm.openCount).toBe(3);

    hm.closeAll();
    expect(hm.openCount).toBe(0);
  });

  it('closeAll() destroys streams', () => {
    const hm = new HandleManager(32, 60000);
    const stream = createMockReadStream();
    const destroySpy = jest.spyOn(stream, 'destroy');

    hm.open('read', '/file.txt', stream);
    hm.closeAll();

    expect(destroySpy).toHaveBeenCalled();
  });
});

// ============================================================================
// Tests: maxOpenHandles limit
// ============================================================================

describe('HandleManager — maxOpenHandles limit', () => {
  it('throws -32025 when maxOpenHandles is reached', () => {
    const MAX = 3;
    const hm = new HandleManager(MAX, 60000);

    for (let i = 0; i < MAX; i++) {
      hm.open('read', `/file${i}.txt`, createMockReadStream());
    }
    expect(hm.openCount).toBe(MAX);

    expect(() => hm.open('read', '/overflow.txt', createMockReadStream())).toThrow(SftpError);
    try {
      hm.open('read', '/overflow.txt', createMockReadStream());
    } catch (e: any) {
      expect(e.code).toBe(RESOURCE_BUSY);
      expect(e.message).toContain(`${MAX}`);
    }

    hm.closeAll();
  });

  it('allows opening after closing a handle', () => {
    const MAX = 2;
    const hm = new HandleManager(MAX, 60000);

    const id1 = hm.open('read', '/a.txt', createMockReadStream());
    hm.open('write', '/b.txt', createMockWriteStream());
    expect(hm.openCount).toBe(MAX);

    // Close one, then open should succeed
    hm.close(id1);
    expect(hm.openCount).toBe(1);

    const id3 = hm.open('read', '/c.txt', createMockReadStream());
    expect(typeof id3).toBe('string');
    expect(hm.openCount).toBe(2);

    hm.closeAll();
  });
});

// ============================================================================
// Tests: TTL expiry
// ============================================================================

describe('HandleManager — TTL expiry', () => {
  it('get() throws -32032 for expired handle', async () => {
    const TIMEOUT = 50;
    const hm = new HandleManager(32, TIMEOUT);
    const id = hm.open('read', '/file.txt', createMockReadStream());

    // Wait for expiry
    await new Promise(r => setTimeout(r, TIMEOUT + 20));

    expect(() => hm.get(id)).toThrow(SftpError);
    try {
      hm.get(id);
    } catch (e: any) {
      expect(e.code).toBe(INVALID_OR_EXPIRED_HANDLE);
    }

    hm.closeAll();
  });

  it('get() refreshes lastAccessAt, keeping handle alive', async () => {
    const TIMEOUT = 150;
    const hm = new HandleManager(32, TIMEOUT);
    const id = hm.open('read', '/file.txt', createMockReadStream());

    // Access at ~60ms (within timeout)
    await new Promise(r => setTimeout(r, 60));
    const handle = hm.get(id); // should succeed and refresh
    expect(handle).toBeDefined();

    // Access at ~120ms from last access (within timeout from refreshed time)
    await new Promise(r => setTimeout(r, 60));
    const handle2 = hm.get(id); // should still succeed
    expect(handle2).toBeDefined();

    hm.closeAll();
  });

  it('expired handle is removed from map when accessed via get()', async () => {
    const TIMEOUT = 50;
    const hm = new HandleManager(32, TIMEOUT);
    const id = hm.open('read', '/file.txt', createMockReadStream());
    expect(hm.openCount).toBe(1);

    await new Promise(r => setTimeout(r, TIMEOUT + 20));

    // Accessing the expired handle triggers removal
    try { hm.get(id); } catch { /* expected -32032 */ }

    expect(hm.openCount).toBe(0);

    hm.closeAll();
  });
});

// ============================================================================
// Tests: validateAndAdvanceOffset
// ============================================================================

describe('HandleManager — validateAndAdvanceOffset', () => {
  it('accepts correct sequential offsets', () => {
    const hm = new HandleManager(32, 60000);
    const id = hm.open('write', '/file.txt', createMockWriteStream());

    // First chunk: offset 0, length 100
    hm.validateAndAdvanceOffset(id, 0, 100);
    expect(hm.get(id).nextExpectedOffset).toBe(100);

    // Second chunk: offset 100, length 200
    hm.validateAndAdvanceOffset(id, 100, 200);
    expect(hm.get(id).nextExpectedOffset).toBe(300);

    // Third chunk: offset 300, length 50
    hm.validateAndAdvanceOffset(id, 300, 50);
    expect(hm.get(id).nextExpectedOffset).toBe(350);

    hm.closeAll();
  });

  it('throws -32031 for out-of-order offset', () => {
    const hm = new HandleManager(32, 60000);
    const id = hm.open('write', '/file.txt', createMockWriteStream());

    // First chunk at offset 0 is fine
    hm.validateAndAdvanceOffset(id, 0, 100);

    // Next expected is 100, but we send 50 → should fail
    expect(() => hm.validateAndAdvanceOffset(id, 50, 100)).toThrow(SftpError);
    try {
      hm.validateAndAdvanceOffset(id, 50, 100);
    } catch (e: any) {
      expect(e.code).toBe(INVALID_CHUNK);
      expect(e.message).toContain('expected 100');
      expect(e.message).toContain('got 50');
    }

    hm.closeAll();
  });

  it('throws -32031 when first chunk offset is not 0', () => {
    const hm = new HandleManager(32, 60000);
    const id = hm.open('write', '/file.txt', createMockWriteStream());

    expect(() => hm.validateAndAdvanceOffset(id, 10, 100)).toThrow(SftpError);
    try {
      hm.validateAndAdvanceOffset(id, 10, 100);
    } catch (e: any) {
      expect(e.code).toBe(INVALID_CHUNK);
    }

    hm.closeAll();
  });

  it('throws -32032 for invalid handleId', () => {
    const hm = new HandleManager(32, 60000);

    expect(() => hm.validateAndAdvanceOffset('bad-id', 0, 100)).toThrow(SftpError);
    try {
      hm.validateAndAdvanceOffset('bad-id', 0, 100);
    } catch (e: any) {
      expect(e.code).toBe(INVALID_OR_EXPIRED_HANDLE);
    }

    hm.closeAll();
  });

  it('throws -32032 for expired handle during offset validation', async () => {
    const TIMEOUT = 50;
    const hm = new HandleManager(32, TIMEOUT);
    const id = hm.open('write', '/file.txt', createMockWriteStream());

    await new Promise(r => setTimeout(r, TIMEOUT + 20));

    expect(() => hm.validateAndAdvanceOffset(id, 0, 100)).toThrow(SftpError);
    try {
      hm.validateAndAdvanceOffset(id, 0, 100);
    } catch (e: any) {
      expect(e.code).toBe(INVALID_OR_EXPIRED_HANDLE);
    }

    hm.closeAll();
  });

  it('works correctly for zero-length chunks', () => {
    const hm = new HandleManager(32, 60000);
    const id = hm.open('write', '/file.txt', createMockWriteStream());

    hm.validateAndAdvanceOffset(id, 0, 0);
    expect(hm.get(id).nextExpectedOffset).toBe(0);

    hm.validateAndAdvanceOffset(id, 0, 100);
    expect(hm.get(id).nextExpectedOffset).toBe(100);

    hm.closeAll();
  });
});

// ============================================================================
// Tests: openCount
// ============================================================================

describe('HandleManager — openCount', () => {
  it('tracks open handles correctly', () => {
    const hm = new HandleManager(32, 60000);
    expect(hm.openCount).toBe(0);

    const id1 = hm.open('read', '/a.txt', createMockReadStream());
    expect(hm.openCount).toBe(1);

    const id2 = hm.open('write', '/b.txt', createMockWriteStream());
    expect(hm.openCount).toBe(2);

    hm.close(id1);
    expect(hm.openCount).toBe(1);

    hm.close(id2);
    expect(hm.openCount).toBe(0);

    hm.closeAll();
  });
});
