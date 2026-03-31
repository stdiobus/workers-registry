/**
 * ConcurrencyQueue — FIFO per-path mutations + parallel reads
 *
 * Manages concurrent SFTP operations within a single session:
 * - Mutations (writeFile, delete, rename, mkdir) on the same path execute in FIFO order
 * - Non-conflicting operations and read operations execute in parallel
 * - Global maxInFlight limit prevents resource exhaustion
 * - Supports individual cancel ($/cancelRequest) and bulk cancelAll (session closing)
 */

import { SftpError } from './types.js';
import { OPERATION_CANCELLED } from './error-codes.js';

// ============================================================================
// Types
// ============================================================================

/** Lifecycle state of a queued operation */
type OperationState = 'pending' | 'running' | 'completed' | 'cancelled';

/** Cancellation reason for error.data.reason field */
export type CancelReason = 'cancelled' | 'session_closing' | 'connection_lost';

/** Options for enqueuing an operation */
export interface EnqueueOptions {
  requestId: string | number;
  path: string;
  isMutation: boolean;
  fn: (signal: AbortSignal) => Promise<unknown>;
}

/** Internal operation record */
interface Operation {
  requestId: string | number;
  path: string;
  isMutation: boolean;
  state: OperationState;
  controller: AbortController;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

// ============================================================================
// Semaphore — bounded concurrency control
// ============================================================================

/**
 * Simple counting semaphore with FIFO waiter queue.
 * Used to enforce maxInFlight limit across all operations.
 */
class Semaphore {
  private count: number;
  private readonly max: number;
  private readonly waiters: Array<() => void> = [];

  constructor(max: number) {
    this.max = max;
    this.count = 0;
  }

  /** Acquire a slot. Resolves immediately if available, otherwise waits in FIFO order. */
  acquire(): Promise<void> {
    if (this.count < this.max) {
      this.count++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  /** Release a slot and wake the next waiter if any. */
  release(): void {
    const next = this.waiters.shift();
    if (next) {
      // Hand slot directly to next waiter (count stays the same)
      next();
    } else {
      this.count--;
    }
  }

  /** Current number of acquired slots */
  get acquired(): number {
    return this.count;
  }

  /** Number of waiters blocked on acquire */
  get waiting(): number {
    return this.waiters.length;
  }
}

// ============================================================================
// ConcurrencyQueue
// ============================================================================

export class ConcurrencyQueue {
  private readonly semaphore: Semaphore;
  private readonly pathChains: Map<string, Promise<void>> = new Map();
  private readonly operations: Map<string | number, Operation> = new Map();
  private cancelled = false;

  constructor(maxInFlight: number = 16) {
    this.semaphore = new Semaphore(maxInFlight);
  }

  /**
   * Enqueue an operation for execution.
   *
   * Mutations on the same path are chained in FIFO order.
   * Read operations and non-conflicting mutations run in parallel.
   * All operations are gated by the global maxInFlight semaphore.
   *
   * @param opts - Operation options including requestId, path, isMutation, fn
   * @returns Promise resolving to the operation result
   * @throws SftpError with OPERATION_CANCELLED if cancelled
   */
  enqueue(opts: EnqueueOptions): Promise<unknown> {
    if (this.cancelled) {
      return Promise.reject(
        new SftpError(OPERATION_CANCELLED, 'Operation cancelled', opts.path)
      );
    }

    const controller = new AbortController();

    return new Promise<unknown>((resolve, reject) => {
      const op: Operation = {
        requestId: opts.requestId,
        path: opts.path,
        isMutation: opts.isMutation,
        state: 'pending',
        controller,
        resolve,
        reject,
      };

      this.operations.set(opts.requestId, op);
      this.scheduleOperation(op, opts.fn);
    });
  }

  /**
   * Cancel a single operation by request id.
   *
   * - If pending: reject immediately with OPERATION_CANCELLED
   * - If running: abort via AbortController, fn should cooperate
   * - If completed/cancelled: ignore (no-op)
   *
   * @param requestId - The JSON-RPC request id to cancel
   * @param reason - Cancellation reason for error.data.reason
   */
  cancel(requestId: string | number, reason: CancelReason = 'cancelled'): void {
    const op = this.operations.get(requestId);
    if (!op) return;

    if (op.state === 'completed' || op.state === 'cancelled') {
      return; // Ignore cancel after completion
    }

    op.state = 'cancelled';
    op.controller.abort(reason);
    op.reject(this.makeCancelError(reason, op.path));
    this.operations.delete(requestId);
  }

  /**
   * Cancel all operations (for session closing or connection loss).
   *
   * @param reason - Cancellation reason ('session_closing' | 'connection_lost')
   */
  cancelAll(reason: CancelReason): void {
    this.cancelled = true;

    for (const [requestId, op] of this.operations) {
      if (op.state === 'completed' || op.state === 'cancelled') {
        continue;
      }
      op.state = 'cancelled';
      op.controller.abort(reason);
      op.reject(this.makeCancelError(reason, op.path));
    }

    this.operations.clear();
    this.pathChains.clear();
  }

  /** Number of currently in-flight (running) operations */
  get inFlightCount(): number {
    let count = 0;
    for (const op of this.operations.values()) {
      if (op.state === 'running') {
        count++;
      }
    }
    return count;
  }

  /** Total number of tracked operations (pending + running) */
  get totalCount(): number {
    return this.operations.size;
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private async scheduleOperation(
    op: Operation,
    fn: (signal: AbortSignal) => Promise<unknown>,
  ): Promise<void> {
    try {
      // Step 1: Wait for path chain if mutation
      if (op.isMutation) {
        await this.waitForPathChain(op);
      }

      // Check if cancelled while waiting for path chain
      if ((op.state as string) === 'cancelled') return;

      // Step 2: Acquire semaphore slot
      await this.semaphore.acquire();

      // Check if cancelled while waiting for semaphore
      if ((op.state as string) === 'cancelled') {
        this.semaphore.release();
        return;
      }

      // Step 3: Execute the operation
      op.state = 'running';
      try {
        const result = await fn(op.controller.signal);

        // Mark completed and resolve
        if (op.state === 'running') {
          op.state = 'completed';
          op.resolve(result);
          this.operations.delete(op.requestId);
        }
      } catch (err: unknown) {
        if (op.state === 'running') {
          op.state = 'completed';
          op.reject(err);
          this.operations.delete(op.requestId);
        }
      } finally {
        this.semaphore.release();
      }
    } catch {
      // If path chain wait or semaphore acquire fails (shouldn't normally happen)
      if (op.state !== 'cancelled' && op.state !== 'completed') {
        op.state = 'completed';
        op.reject(
          new SftpError(OPERATION_CANCELLED, 'Operation scheduling failed', op.path)
        );
        this.operations.delete(op.requestId);
      }
    }
  }

  /**
   * Chain mutation operations on the same path.
   * Each mutation waits for the previous mutation on the same path to complete.
   */
  private waitForPathChain(op: Operation): Promise<void> {
    const { path } = op;
    const prev = this.pathChains.get(path);

    let chainResolve: () => void;
    const chainPromise = new Promise<void>((resolve) => {
      chainResolve = resolve;
    });

    // Register this operation as the new tail of the chain
    this.pathChains.set(path, chainPromise);

    // When this operation completes (success or failure), resolve the chain
    // so the next mutation on this path can proceed
    const originalResolve = op.resolve;
    const originalReject = op.reject;

    op.resolve = (value: unknown) => {
      chainResolve!();
      this.cleanupPathChain(path, chainPromise);
      originalResolve(value);
    };

    op.reject = (reason: unknown) => {
      chainResolve!();
      this.cleanupPathChain(path, chainPromise);
      originalReject(reason);
    };

    // Wait for previous mutation on this path (if any)
    if (prev) {
      return prev;
    }
    return Promise.resolve();
  }

  /** Remove path chain entry if it's still the current tail */
  private cleanupPathChain(path: string, chainPromise: Promise<void>): void {
    if (this.pathChains.get(path) === chainPromise) {
      this.pathChains.delete(path);
    }
  }

  /** Create a cancellation SftpError with reason in data */
  private makeCancelError(reason: CancelReason, path?: string): SftpError {
    const message = reason === 'session_closing'
      ? 'Operation cancelled: session closing'
      : reason === 'connection_lost'
        ? 'Operation cancelled: connection lost'
        : 'Operation cancelled';

    return new SftpError(OPERATION_CANCELLED, message, path);
  }
}
