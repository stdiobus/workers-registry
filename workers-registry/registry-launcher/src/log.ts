/**
 * Logging utilities for the Registry Launcher.
 *
 * Provides structured logging to stderr with ISO 8601 timestamps and severity levels.
 * All logs go to stderr only - stdout is reserved for NDJSON protocol messages.
 *
 * @module log
 */

/**
 * Log severity levels.
 */
export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

/**
 * Log context identifier for the registry launcher.
 */
const LOG_CONTEXT = 'registry-launcher';

/**
 * Format a log message with ISO 8601 timestamp and severity level.
 *
 * @param level - Severity level
 * @param message - Log message
 * @param context - Optional context identifier (defaults to 'registry-launcher')
 * @returns Formatted log line
 */
function formatLogMessage(level: LogLevel, message: string, context: string = LOG_CONTEXT): string {
  const timestamp = new Date().toISOString();
  return `[${timestamp}] [${level}] [${context}] ${message}`;
}

/**
 * Log a message to stderr with ISO 8601 timestamp and severity level.
 *
 * @param level - Severity level (DEBUG, INFO, WARN, ERROR)
 * @param message - Log message
 * @param context - Optional context identifier (defaults to 'registry-launcher')
 */
export function log(level: LogLevel, message: string, context?: string): void {
  const formatted = formatLogMessage(level, message, context);
  console.error(formatted);
}

/**
 * Log an agent spawn event.
 *
 * @param agentId - The agent identifier
 * @param command - The spawn command
 * @param args - The spawn command arguments
 */
export function logSpawn(agentId: string, command: string, args: string[]): void {
  const fullCommand = [command, ...args].join(' ');
  log('INFO', `Spawning agent "${agentId}": ${fullCommand}`);
}

/**
 * Log an agent exit event.
 *
 * @param agentId - The agent identifier
 * @param exitCode - The exit code (null if terminated by signal)
 * @param signal - The signal that terminated the process (null if exited normally)
 */
export function logExit(agentId: string, exitCode: number | null, signal?: string | null): void {
  if (signal) {
    log('INFO', `Agent "${agentId}" exited with signal ${signal}`);
  } else if (exitCode !== null) {
    log('INFO', `Agent "${agentId}" exited with code ${exitCode}`);
  } else {
    log('INFO', `Agent "${agentId}" exited`);
  }
}

/**
 * Log a backpressure warning when writing to an agent process fails.
 *
 * @param agentId - The agent identifier
 */
export function logBackpressure(agentId: string): void {
  log('WARN', `Write to agent "${agentId}" failed due to backpressure`);
}

/**
 * Log an error when an agent's stdin closes unexpectedly.
 *
 * @param agentId - The agent identifier
 * @param error - The error that occurred
 */
export function logStdinClosed(agentId: string, error?: Error): void {
  const errorMessage = error ? `: ${error.message}` : '';
  log('ERROR', `Agent "${agentId}" stdin closed unexpectedly${errorMessage}`);
}

/**
 * Convenience function for logging debug messages.
 *
 * @param message - Debug message
 * @param context - Optional context identifier
 */
export function logDebug(message: string, context?: string): void {
  log('DEBUG', message, context);
}

/**
 * Convenience function for logging info messages.
 *
 * @param message - Info message
 * @param context - Optional context identifier
 */
export function logInfo(message: string, context?: string): void {
  log('INFO', message, context);
}

/**
 * Convenience function for logging warning messages.
 *
 * @param message - Warning message
 * @param context - Optional context identifier
 */
export function logWarn(message: string, context?: string): void {
  log('WARN', message, context);
}

/**
 * Convenience function for logging error messages.
 *
 * @param message - Error message
 * @param context - Optional context identifier
 */
export function logError(message: string, context?: string): void {
  log('ERROR', message, context);
}
