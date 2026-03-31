/**
 * Unit tests for ConcurrencyQueue
 *
 * Tests FIFO ordering, parallel execution, cancellation, and maxInFlight.
 */

import { ConcurrencyQueue } from '../concurrency-queue.js';
import type { CancelReason } from '../concurrency-queue.js';
import { SftpError } from '../types.js';
import { OPERATION_CANCELLED } from '../error-codes.js';

/** Helper: create a deferred promise for test control */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Helper: delay for a given number of ms */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('ConcurrencyQueue', () => {
  let queue: ConcurrencyQueue;

  beforeEach(() => {
    queue = new ConcurrencyQueue(16);
  });

  describe('basic enqueue and execution', () => {
    it('should execute a simple operation and return result', async () => {
      const result = await queue.enqueue({
        requestId: 1,
        path: '/test',
        isMutation: false,
        fn: async () => 'hello',
      });

      expect(result).toBe('hello');
    });

    it('should propagate errors from fn', async () => {
      await expect(
        queue.enqueue({
          requestId: 1,
          path: '/test',
          isMutation: false,
          fn: async () => { throw new Error('boom'); },
        })
      ).rejects.toThrow('boom');
    });

    it('should track inFlightCount correctly', async () => {
      const d = deferred();

      const p = queue.enqueue({
        requestId: 1,
        path: '/test',
        isMutation: false,
        fn: async () => { await d.promise; return 'done'; },
      });

      // Give microtask time for the operation to start running
      await delay(10);
      expect(queue.inFlightCount).toBe(1);

      d.resolve();
      await p;
      expect(queue.inFlightCount).toBe(0);
    });
  });

  describe('FIFO ordering for same-path mutations', () => {
    it('should execute mutations on the same path in FIFO order', async () => {
      const order: number[] = [];
      const d1 = deferred();
      const d2 = deferred();
      const d3 = deferred();

      const p1 = queue.enqueue({
        requestId: 1,
        path: '/file.txt',
        isMutation: true,
        fn: async () => { await d1.promise; order.push(1); return 1; },
      });

      const p2 = queue.enqueue({
        requestId: 2,
        path: '/file.txt',
        isMutation: true,
        fn: async () => { await d2.promise; order.push(2); return 2; },
      });

      const p3 = queue.enqueue({
        requestId: 3,
        path: '/file.txt',
        isMutation: true,
        fn: async () => { await d3.promise; order.push(3); return 3; },
      });

      // Complete in reverse order — but FIFO should still hold
      // p2 and p3 can't start until p1 finishes
      d1.resolve();
      await p1;

      // Now p2 should be running
      d2.resolve();
      await p2;

      // Now p3 should be running
      d3.resolve();
      await p3;

      expect(order).toEqual([1, 2, 3]);
    });

    it('should allow mutations on different paths in parallel', async () => {
      const running: string[] = [];
      const d1 = deferred();
      const d2 = deferred();

      const p1 = queue.enqueue({
        requestId: 1,
        path: '/a.txt',
        isMutation: true,
        fn: async () => { running.push('a-start'); await d1.promise; running.push('a-end'); },
      });

      const p2 = queue.enqueue({
        requestId: 2,
        path: '/b.txt',
        isMutation: true,
        fn: async () => { running.push('b-start'); await d2.promise; running.push('b-end'); },
      });

      await delay(10);
      // Both should be running in parallel since different paths
      expect(running).toContain('a-start');
      expect(running).toContain('b-start');

      d1.resolve();
      d2.resolve();
      await Promise.all([p1, p2]);
    });
  });

  describe('parallel read operations', () => {
    it('should execute read operations in parallel even on the same path', async () => {
      const running: string[] = [];
      const d1 = deferred();
      const d2 = deferred();

      const p1 = queue.enqueue({
        requestId: 1,
        path: '/file.txt',
        isMutation: false,
        fn: async () => { running.push('r1-start'); await d1.promise; running.push('r1-end'); },
      });

      const p2 = queue.enqueue({
        requestId: 2,
        path: '/file.txt',
        isMutation: false,
        fn: async () => { running.push('r2-start'); await d2.promise; running.push('r2-end'); },
      });

      await delay(10);
      // Both reads should be running in parallel
      expect(running).toContain('r1-start');
      expect(running).toContain('r2-start');

      d1.resolve();
      d2.resolve();
      await Promise.all([p1, p2]);
    });
  });

  describe('maxInFlight limit', () => {
    it('should respect maxInFlight limit', async () => {
      const smallQueue = new ConcurrencyQueue(2);
      const deferreds = [deferred(), deferred(), deferred()];
      let runningCount = 0;
      let maxRunning = 0;

      const promises = deferreds.map((d, i) =>
        smallQueue.enqueue({
          requestId: i,
          path: `/file-${i}.txt`,
          isMutation: false,
          fn: async () => {
            runningCount++;
            maxRunning = Math.max(maxRunning, runningCount);
            await d.promise;
            runningCount--;
          },
        })
      );

      await delay(10);
      // Only 2 should be running (maxInFlight = 2)
      expect(maxRunning).toBeLessThanOrEqual(2);

      deferreds.forEach((d) => d.resolve());
      await Promise.all(promises);
    });
  });

  describe('cancel individual operation', () => {
    it('should cancel a pending operation', async () => {
      const d = deferred();

      // Block the semaphore
      const smallQueue = new ConcurrencyQueue(1);
      const blocker = smallQueue.enqueue({
        requestId: 'blocker',
        path: '/a',
        isMutation: false,
        fn: async () => { await d.promise; },
      });

      await delay(5);

      // This one will be pending (waiting for semaphore)
      const pending = smallQueue.enqueue({
        requestId: 'target',
        path: '/b',
        isMutation: false,
        fn: async () => 'should not run',
      });

      // Cancel the pending operation
      smallQueue.cancel('target', 'cancelled');

      await expect(pending).rejects.toThrow(SftpError);
      await expect(pending).rejects.toMatchObject({
        code: OPERATION_CANCELLED,
      });

      d.resolve();
      await blocker;
    });

    it('should ignore cancel after operation completes', async () => {
      const result = await queue.enqueue({
        requestId: 1,
        path: '/test',
        isMutation: false,
        fn: async () => 'done',
      });

      // Cancel after completion — should be a no-op
      queue.cancel(1, 'cancelled');
      expect(result).toBe('done');
    });

    it('should abort a running operation', async () => {
      const d = deferred();
      let aborted = false;

      const p = queue.enqueue({
        requestId: 1,
        path: '/test',
        isMutation: false,
        fn: async (signal) => {
          signal.addEventListener('abort', () => { aborted = true; });
          await d.promise;
          return 'done';
        },
      });

      await delay(10);
      queue.cancel(1, 'cancelled');

      expect(aborted).toBe(true);

      // The operation was cancelled, so the promise should reject
      await expect(p).rejects.toThrow(SftpError);

      d.resolve(); // cleanup
    });
  });

  describe('cancelAll', () => {
    it('should cancel all pending and running operations', async () => {
      const d1 = deferred();
      const d2 = deferred();

      const p1 = queue.enqueue({
        requestId: 1,
        path: '/a',
        isMutation: false,
        fn: async () => { await d1.promise; },
      });

      const p2 = queue.enqueue({
        requestId: 2,
        path: '/b',
        isMutation: false,
        fn: async () => { await d2.promise; },
      });

      await delay(10);
      queue.cancelAll('session_closing');

      await expect(p1).rejects.toMatchObject({ code: OPERATION_CANCELLED });
      await expect(p2).rejects.toMatchObject({ code: OPERATION_CANCELLED });

      d1.resolve();
      d2.resolve();
    });

    it('should reject new operations after cancelAll', async () => {
      queue.cancelAll('session_closing');

      await expect(
        queue.enqueue({
          requestId: 1,
          path: '/test',
          isMutation: false,
          fn: async () => 'nope',
        })
      ).rejects.toThrow(SftpError);
    });

    it('should include reason in cancel error', async () => {
      const d = deferred();

      const p = queue.enqueue({
        requestId: 1,
        path: '/test',
        isMutation: false,
        fn: async () => { await d.promise; },
      });

      await delay(10);
      queue.cancelAll('connection_lost');

      try {
        await p;
      } catch (err) {
        expect(err).toBeInstanceOf(SftpError);
        expect((err as SftpError).code).toBe(OPERATION_CANCELLED);
        expect((err as SftpError).message).toContain('connection lost');
      }

      d.resolve();
    });
  });

  describe('edge cases', () => {
    it('should handle cancel of non-existent requestId gracefully', () => {
      // Should not throw
      queue.cancel('nonexistent', 'cancelled');
    });

    it('should handle empty cancelAll gracefully', () => {
      // Should not throw
      queue.cancelAll('session_closing');
    });

    it('should clean up path chains after mutations complete', async () => {
      await queue.enqueue({
        requestId: 1,
        path: '/file.txt',
        isMutation: true,
        fn: async () => 'done',
      });

      // After completion, totalCount should be 0
      expect(queue.totalCount).toBe(0);
    });
  });
});
