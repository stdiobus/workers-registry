/**
 * ResourceLimiter — stateless policy + logging helper for resource limits
 *
 * Centralizes limit checking and 80% threshold warnings without owning
 * any counters. Callers pass current usage; this class decides whether
 * to reject or warn.
 *
 * Enforcement points (callers):
 * - sftp/connect handler → checkSessionLimit(sessionManager.sessionCount)
 * - request admission   → checkInFlightLimit(queue.inFlightCount)
 * - sftp/openRead/Write → checkHandleLimit(handleManager.openCount)
 */

import { SftpError, WorkerLimits, DEFAULT_WORKER_LIMITS } from './types.js';
import { SFTP_OPERATION_FAILED, RESOURCE_BUSY } from './error-codes.js';

/**
 * Resource metric names for logging
 */
export type ResourceMetric = 'sessions' | 'inFlight' | 'handles';

/**
 * Writable stream interface for stderr logging
 */
export interface LogWriter {
  write(data: string): boolean;
}

/**
 * ResourceLimiter — stateless limit enforcement and 80% warning helper.
 *
 * Does NOT own counters. Callers pass current usage values.
 * Tracks which warnings have been emitted to avoid log spam,
 * resetting when usage drops below threshold.
 */
export class ResourceLimiter {
  private readonly limits: WorkerLimits;
  private readonly stderr: LogWriter;

  /** Tracks whether a warning has been emitted for each metric */
  private warningEmitted: Map<string, boolean> = new Map();

  constructor(limits?: Partial<WorkerLimits>, stderr?: LogWriter) {
    this.limits = { ...DEFAULT_WORKER_LIMITS, ...limits };
    this.stderr = stderr ?? process.stderr;
  }

  /**
   * Check session limit before creating a new session (sftp/connect).
   *
   * @param currentCount - Current number of active sessions
   * @throws SftpError(-32020) if at maxConcurrentSessions
   */
  checkSessionLimit(currentCount: number): void {
    const limit = this.limits.maxConcurrentSessions;

    if (currentCount >= limit) {
      throw new SftpError(
        SFTP_OPERATION_FAILED,
        `Max concurrent sessions reached (${limit})`
      );
    }

    this.warnIfNearLimit('sessions', currentCount, limit);
  }

  /**
   * Check in-flight request limit before admitting a new request.
   *
   * @param currentCount - Current number of in-flight requests in the session
   * @throws SftpError(-32025) with retryable semantics if at maxInFlightPerSession
   */
  checkInFlightLimit(currentCount: number): void {
    const limit = this.limits.maxInFlightPerSession;

    if (currentCount >= limit) {
      throw new SftpError(
        RESOURCE_BUSY,
        `Max in-flight requests per session reached (${limit})`
      );
    }

    this.warnIfNearLimit('inFlight', currentCount, limit);
  }

  /**
   * Check handle limit before opening a new stream handle.
   *
   * @param currentCount - Current number of open handles
   * @throws SftpError(-32025) if at maxOpenHandles
   */
  checkHandleLimit(currentCount: number): void {
    const limit = this.limits.maxOpenHandles;

    if (currentCount >= limit) {
      throw new SftpError(
        RESOURCE_BUSY,
        `Max open handles reached (${limit})`
      );
    }

    this.warnIfNearLimit('handles', currentCount, limit);
  }

  /**
   * Get the configured limits (read-only copy).
   */
  getLimits(): Readonly<WorkerLimits> {
    return { ...this.limits };
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  /**
   * Log a warning to stderr when usage reaches 80% of a limit.
   * Resets the warning flag when usage drops below 80%.
   */
  private warnIfNearLimit(
    metric: ResourceMetric,
    current: number,
    limit: number,
  ): void {
    const threshold = Math.floor(limit * 0.8);
    const key = metric;

    if (current >= threshold) {
      if (!this.warningEmitted.get(key)) {
        this.warningEmitted.set(key, true);
        const timestamp = new Date().toISOString();
        this.stderr.write(
          `[${timestamp}] WARN: Resource limit warning: ${metric} at ${current}/${limit} (80% threshold)\n`
        );
      }
    } else {
      // Reset warning when usage drops below threshold
      if (this.warningEmitted.get(key)) {
        this.warningEmitted.set(key, false);
      }
    }
  }
}
