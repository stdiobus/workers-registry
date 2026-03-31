/**
 * HandleManager — управление stream handles для chunked I/O
 * 
 * Manages stream handles for chunked read/write operations:
 * - open/get/close/closeAll lifecycle
 * - TTL-based auto-release (default 60s)
 * - maxOpenHandles limit (default 32)
 * - nextExpectedOffset validation for chunk ordering
 * - Error -32032 for expired/invalid handles
 */

import { randomUUID } from 'crypto';
import { Readable, Writable } from 'stream';
import { SftpError } from './types.js';
import { INVALID_OR_EXPIRED_HANDLE, INVALID_CHUNK, RESOURCE_BUSY } from './error-codes.js';

/**
 * Represents an open stream handle for chunked I/O
 */
export interface StreamHandle {
  handleId: string;
  type: 'read' | 'write';
  path: string;
  stream: Readable | Writable;
  createdAt: number;
  lastAccessAt: number;
  nextExpectedOffset: number;
}

/**
 * HandleManager manages stream handles for chunked I/O operations.
 * 
 * Handles have a TTL and are auto-released when expired.
 * A periodic cleanup timer removes stale handles.
 */
export class HandleManager {
  private handles: Map<string, StreamHandle>;
  private maxOpenHandles: number;
  private handleTimeoutMs: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(maxOpenHandles: number = 32, handleTimeoutMs: number = 60000) {
    this.handles = new Map();
    this.maxOpenHandles = maxOpenHandles;
    this.handleTimeoutMs = handleTimeoutMs;

    // Start periodic cleanup every half the timeout period
    if (handleTimeoutMs > 0) {
      this.cleanupTimer = setInterval(
        () => this.cleanupExpired(),
        Math.max(handleTimeoutMs / 2, 1000)
      );
      // Allow the process to exit even if the timer is running
      if (this.cleanupTimer && typeof this.cleanupTimer === 'object' && 'unref' in this.cleanupTimer) {
        this.cleanupTimer.unref();
      }
    }
  }

  /**
   * Open a new stream handle.
   * 
   * @param type - 'read' or 'write'
   * @param path - Remote file path
   * @param stream - The underlying Node.js stream
   * @returns handleId - Unique identifier for this handle
   * @throws SftpError(-32025) if maxOpenHandles reached
   */
  open(type: 'read' | 'write', path: string, stream: Readable | Writable): string {
    if (this.handles.size >= this.maxOpenHandles) {
      throw new SftpError(
        RESOURCE_BUSY,
        `Maximum open handles (${this.maxOpenHandles}) reached`,
        path
      );
    }

    const handleId = randomUUID();
    const now = Date.now();

    const handle: StreamHandle = {
      handleId,
      type,
      path,
      stream,
      createdAt: now,
      lastAccessAt: now,
      nextExpectedOffset: 0,
    };

    this.handles.set(handleId, handle);
    return handleId;
  }

  /**
   * Get a stream handle by ID.
   * 
   * Updates lastAccessAt on successful retrieval.
   * Throws -32032 if handle does not exist or has expired.
   * 
   * @param handleId - Handle identifier
   * @returns StreamHandle
   * @throws SftpError(-32032) if expired or invalid
   */
  get(handleId: string): StreamHandle {
    const handle = this.handles.get(handleId);

    if (!handle) {
      throw new SftpError(
        INVALID_OR_EXPIRED_HANDLE,
        `Invalid or expired handle: ${handleId}`
      );
    }

    // Check TTL
    const now = Date.now();
    if (now - handle.lastAccessAt > this.handleTimeoutMs) {
      // Handle has expired — remove it and throw
      this.handles.delete(handleId);
      this.destroyStream(handle);
      throw new SftpError(
        INVALID_OR_EXPIRED_HANDLE,
        `Handle expired: ${handleId}`
      );
    }

    // Update last access time
    handle.lastAccessAt = now;
    return handle;
  }

  /**
   * Close a specific handle and release its resources.
   * 
   * Idempotent — no error if handle doesn't exist.
   * 
   * @param handleId - Handle identifier
   */
  close(handleId: string): void {
    const handle = this.handles.get(handleId);
    if (handle) {
      this.handles.delete(handleId);
      this.destroyStream(handle);
    }
  }

  /**
   * Close all handles (for session cleanup).
   * Also stops the cleanup timer.
   */
  closeAll(): void {
    for (const [id, handle] of this.handles.entries()) {
      this.destroyStream(handle);
    }
    this.handles.clear();

    if (this.cleanupTimer !== null) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Validate chunk offset and advance nextExpectedOffset atomically.
   * 
   * Ensures chunks arrive in strict sequential order.
   * Throws -32031 (INVALID_CHUNK) if offset doesn't match expected.
   * 
   * @param handleId - Handle identifier
   * @param providedOffset - The offset provided by the client
   * @param chunkLength - Number of bytes in this chunk
   * @throws SftpError(-32031) if offset doesn't match nextExpectedOffset
   * @throws SftpError(-32032) if handle is invalid or expired
   */
  validateAndAdvanceOffset(handleId: string, providedOffset: number, chunkLength: number): void {
    const handle = this.get(handleId);

    if (providedOffset !== handle.nextExpectedOffset) {
      throw new SftpError(
        INVALID_CHUNK,
        `Invalid chunk offset: expected ${handle.nextExpectedOffset}, got ${providedOffset}`,
        handle.path
      );
    }

    handle.nextExpectedOffset += chunkLength;
  }

  /**
   * Get the number of currently open handles.
   */
  get openCount(): number {
    return this.handles.size;
  }

  /**
   * Remove expired handles.
   * Called periodically by the cleanup timer.
   */
  private cleanupExpired(): void {
    const now = Date.now();
    for (const [id, handle] of this.handles.entries()) {
      if (now - handle.lastAccessAt > this.handleTimeoutMs) {
        this.handles.delete(id);
        this.destroyStream(handle);
      }
    }
  }

  /**
   * Best-effort stream destruction.
   */
  private destroyStream(handle: StreamHandle): void {
    try {
      if (handle.stream && typeof (handle.stream as any).destroy === 'function') {
        (handle.stream as any).destroy();
      }
    } catch {
      // Ignore errors during stream cleanup
    }
  }
}
