/**
 * Property-Based Tests for Resource Limits
 *
 * Feature: sftp-vscode-plugin
 *
 * Tests:
 * - Property 44: Resource limit enforcement (Requirements 29.2, 29.3, 29.4)
 * - Property 45: Resource warning at 80% threshold (Requirement 29.5)
 */

import fc from 'fast-check';
import { ResourceLimiter, LogWriter } from '../resource-limiter.js';
import { SftpError, WorkerLimits } from '../types.js';
import { SFTP_OPERATION_FAILED, RESOURCE_BUSY } from '../error-codes.js';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Capture stderr output for assertion
 */
class StderrCapture implements LogWriter {
  public output: string[] = [];

  write(data: string): boolean {
    this.output.push(data);
    return true;
  }

  get allOutput(): string {
    return this.output.join('');
  }

  clear(): void {
    this.output = [];
  }
}

// ============================================================================
// Arbitraries
// ============================================================================

/**
 * Generate small but meaningful limits for testing.
 * Keep limits small (2-10) to make tests fast and deterministic.
 */
const arbSmallLimits = fc.record({
  maxConcurrentSessions: fc.integer({ min: 2, max: 10 }),
  maxInFlightPerSession: fc.integer({ min: 2, max: 10 }),
  maxOpenHandles: fc.integer({ min: 2, max: 10 }),
  handleTimeoutMs: fc.constant(60000),
});

// ============================================================================
// Property 44: Resource limit enforcement
// ============================================================================

describe('Property 44: Resource limit enforcement', () => {
  /**
   * Property 44: Resource limit enforcement
   *
   * For any of the limits (maxConcurrentSessions, maxInFlightPerSession,
   * maxOpenHandles), when the limit is reached, the Worker must reject
   * the corresponding operation:
   * - new connect → -32020
   * - new request → -32025 with retryable: true
   * - new open handle → -32025
   *
   * Feature: sftp-vscode-plugin, Property 44: Resource limit enforcement
   *
   * **Validates: Requirements 29.2, 29.3, 29.4**
   */

  it('rejects new sessions with -32020 when maxConcurrentSessions reached', () => {
    fc.assert(
      fc.property(
        arbSmallLimits,
        (limits) => {
          const stderr = new StderrCapture();
          const limiter = new ResourceLimiter(limits, stderr);

          // At limit — should throw
          try {
            limiter.checkSessionLimit(limits.maxConcurrentSessions);
            return false; // Should have thrown
          } catch (err: unknown) {
            if (!(err instanceof SftpError)) return false;
            return err.code === SFTP_OPERATION_FAILED
              && err.message.includes('Max concurrent sessions');
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('allows sessions below maxConcurrentSessions', () => {
    fc.assert(
      fc.property(
        arbSmallLimits,
        fc.integer({ min: 0, max: 9 }),
        (limits, offset) => {
          const stderr = new StderrCapture();
          const limiter = new ResourceLimiter(limits, stderr);
          const count = Math.min(offset, limits.maxConcurrentSessions - 1);

          // Below limit — should not throw
          limiter.checkSessionLimit(count);
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('rejects new requests with -32025 when maxInFlightPerSession reached', () => {
    fc.assert(
      fc.property(
        arbSmallLimits,
        (limits) => {
          const stderr = new StderrCapture();
          const limiter = new ResourceLimiter(limits, stderr);

          // At limit — should throw
          try {
            limiter.checkInFlightLimit(limits.maxInFlightPerSession);
            return false; // Should have thrown
          } catch (err: unknown) {
            if (!(err instanceof SftpError)) return false;
            return err.code === RESOURCE_BUSY
              && err.message.includes('Max in-flight requests');
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('allows requests below maxInFlightPerSession', () => {
    fc.assert(
      fc.property(
        arbSmallLimits,
        fc.integer({ min: 0, max: 9 }),
        (limits, offset) => {
          const stderr = new StderrCapture();
          const limiter = new ResourceLimiter(limits, stderr);
          const count = Math.min(offset, limits.maxInFlightPerSession - 1);

          limiter.checkInFlightLimit(count);
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('rejects new handles with -32025 when maxOpenHandles reached', () => {
    fc.assert(
      fc.property(
        arbSmallLimits,
        (limits) => {
          const stderr = new StderrCapture();
          const limiter = new ResourceLimiter(limits, stderr);

          // At limit — should throw
          try {
            limiter.checkHandleLimit(limits.maxOpenHandles);
            return false; // Should have thrown
          } catch (err: unknown) {
            if (!(err instanceof SftpError)) return false;
            return err.code === RESOURCE_BUSY
              && err.message.includes('Max open handles');
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('allows handles below maxOpenHandles', () => {
    fc.assert(
      fc.property(
        arbSmallLimits,
        fc.integer({ min: 0, max: 9 }),
        (limits, offset) => {
          const stderr = new StderrCapture();
          const limiter = new ResourceLimiter(limits, stderr);
          const count = Math.min(offset, limits.maxOpenHandles - 1);

          limiter.checkHandleLimit(count);
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('rejects above-limit counts consistently', () => {
    fc.assert(
      fc.property(
        arbSmallLimits,
        fc.integer({ min: 1, max: 20 }),
        (limits, excess) => {
          const stderr = new StderrCapture();
          const limiter = new ResourceLimiter(limits, stderr);

          // Session limit: count = limit + excess
          const sessionCount = limits.maxConcurrentSessions + excess;
          try {
            limiter.checkSessionLimit(sessionCount);
            return false;
          } catch (err: unknown) {
            if (!(err instanceof SftpError)) return false;
            if (err.code !== SFTP_OPERATION_FAILED) return false;
          }

          // In-flight limit
          const inFlightCount = limits.maxInFlightPerSession + excess;
          try {
            limiter.checkInFlightLimit(inFlightCount);
            return false;
          } catch (err: unknown) {
            if (!(err instanceof SftpError)) return false;
            if (err.code !== RESOURCE_BUSY) return false;
          }

          // Handle limit
          const handleCount = limits.maxOpenHandles + excess;
          try {
            limiter.checkHandleLimit(handleCount);
            return false;
          } catch (err: unknown) {
            if (!(err instanceof SftpError)) return false;
            if (err.code !== RESOURCE_BUSY) return false;
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ============================================================================
// Property 45: Resource warning at 80% threshold
// ============================================================================

describe('Property 45: Resource warning at 80% threshold', () => {
  /**
   * Property 45: Resource warning at 80% threshold
   *
   * For any resource (sessions, in-flight, handles), when usage reaches
   * 80% of the limit, the Worker must write a warning to stderr.
   *
   * Feature: sftp-vscode-plugin, Property 45: Resource warning at 80% threshold
   *
   * **Validates: Requirement 29.5**
   */

  it('emits warning when sessions reach 80% of limit', () => {
    fc.assert(
      fc.property(
        arbSmallLimits,
        (limits) => {
          const stderr = new StderrCapture();
          const limiter = new ResourceLimiter(limits, stderr);

          const threshold = Math.floor(limits.maxConcurrentSessions * 0.8);

          // Below threshold — no warning
          if (threshold > 0) {
            limiter.checkSessionLimit(threshold - 1);
            const beforeWarning = stderr.allOutput;
            expect(beforeWarning).not.toContain('sessions');
          }

          // At threshold — warning emitted
          limiter.checkSessionLimit(threshold);
          const afterWarning = stderr.allOutput;
          expect(afterWarning).toContain('sessions');
          expect(afterWarning).toContain(`${threshold}/${limits.maxConcurrentSessions}`);
          expect(afterWarning).toContain('80% threshold');

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('emits warning when in-flight requests reach 80% of limit', () => {
    fc.assert(
      fc.property(
        arbSmallLimits,
        (limits) => {
          const stderr = new StderrCapture();
          const limiter = new ResourceLimiter(limits, stderr);

          const threshold = Math.floor(limits.maxInFlightPerSession * 0.8);

          // At threshold — warning emitted
          limiter.checkInFlightLimit(threshold);
          const output = stderr.allOutput;
          expect(output).toContain('inFlight');
          expect(output).toContain(`${threshold}/${limits.maxInFlightPerSession}`);
          expect(output).toContain('80% threshold');

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('emits warning when handles reach 80% of limit', () => {
    fc.assert(
      fc.property(
        arbSmallLimits,
        (limits) => {
          const stderr = new StderrCapture();
          const limiter = new ResourceLimiter(limits, stderr);

          const threshold = Math.floor(limits.maxOpenHandles * 0.8);

          // At threshold — warning emitted
          limiter.checkHandleLimit(threshold);
          const output = stderr.allOutput;
          expect(output).toContain('handles');
          expect(output).toContain(`${threshold}/${limits.maxOpenHandles}`);
          expect(output).toContain('80% threshold');

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('does not emit duplicate warnings for same metric', () => {
    fc.assert(
      fc.property(
        arbSmallLimits,
        (limits) => {
          const stderr = new StderrCapture();
          const limiter = new ResourceLimiter(limits, stderr);

          const threshold = Math.floor(limits.maxConcurrentSessions * 0.8);

          // Trigger warning twice
          limiter.checkSessionLimit(threshold);
          limiter.checkSessionLimit(threshold);
          limiter.checkSessionLimit(threshold + 1 < limits.maxConcurrentSessions ? threshold + 1 : threshold);

          // Should only have one warning for sessions
          const warnings = stderr.output.filter(line => line.includes('sessions'));
          expect(warnings.length).toBe(1);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('resets warning when usage drops below threshold', () => {
    fc.assert(
      fc.property(
        arbSmallLimits,
        (limits) => {
          const stderr = new StderrCapture();
          const limiter = new ResourceLimiter(limits, stderr);

          const threshold = Math.floor(limits.maxConcurrentSessions * 0.8);

          // Trigger warning
          limiter.checkSessionLimit(threshold);
          expect(stderr.output.filter(l => l.includes('sessions')).length).toBe(1);

          // Drop below threshold
          if (threshold > 0) {
            limiter.checkSessionLimit(threshold - 1);
          }

          // Trigger again — should emit a new warning
          stderr.clear();
          limiter.checkSessionLimit(threshold);
          expect(stderr.output.filter(l => l.includes('sessions')).length).toBe(1);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('no warning emitted below 80% threshold for any metric', () => {
    fc.assert(
      fc.property(
        arbSmallLimits,
        (limits) => {
          const stderr = new StderrCapture();
          const limiter = new ResourceLimiter(limits, stderr);

          // Use counts strictly below the 80% threshold
          const sessionThreshold = Math.floor(limits.maxConcurrentSessions * 0.8);
          const inFlightThreshold = Math.floor(limits.maxInFlightPerSession * 0.8);
          const handleThreshold = Math.floor(limits.maxOpenHandles * 0.8);

          const sessionCount = Math.max(0, sessionThreshold - 1);
          const inFlightCount = Math.max(0, inFlightThreshold - 1);
          const handleCount = Math.max(0, handleThreshold - 1);

          limiter.checkSessionLimit(sessionCount);
          limiter.checkInFlightLimit(inFlightCount);
          limiter.checkHandleLimit(handleCount);

          // No warnings should be emitted
          expect(stderr.output.length).toBe(0);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});
