/**
 * JSON-RPC and SFTP error code constants
 * 
 * Defines all error codes used by the SFTP Worker:
 * - JSON-RPC 2.0 standard error codes (-32700 to -32600)
 * - SFTP application-level error codes (-32000 to -32035)
 */

// ============================================================================
// JSON-RPC 2.0 Standard Error Codes
// ============================================================================

/**
 * Parse error - Invalid JSON received by the server
 */
export const JSONRPC_PARSE_ERROR = -32700;

/**
 * Invalid Request - The JSON sent is not a valid Request object
 */
export const JSONRPC_INVALID_REQUEST = -32600;

/**
 * Method not found - The method does not exist or is not available
 */
export const JSONRPC_METHOD_NOT_FOUND = -32601;

/**
 * Invalid params - Invalid method parameter(s)
 */
export const JSONRPC_INVALID_PARAMS = -32602;

/**
 * Internal error - Internal JSON-RPC error
 */
export const JSONRPC_INTERNAL_ERROR = -32603;

// ============================================================================
// SFTP Application Error Codes - Core (-32000 to -32013)
// ============================================================================

/**
 * No active connection for session
 * 
 * Returned when an RPC method is called with a sessionId that has no
 * active SFTP connection. Client must call sftp/connect first.
 */
export const NO_ACTIVE_CONNECTION = -32000;

/**
 * Authentication failed
 * 
 * Username/password or private key authentication rejected by server.
 */
export const AUTHENTICATION_FAILED = -32001;

/**
 * Host unreachable
 * 
 * Cannot connect to host due to DNS failure, routing error, or host down.
 */
export const HOST_UNREACHABLE = -32002;

/**
 * Connection timeout
 * 
 * Connection attempt exceeded configured timeout (default 30s).
 */
export const CONNECTION_TIMEOUT = -32003;

/**
 * Path not found
 * 
 * Maps to ENOENT / SSH_FX_NO_SUCH_FILE.
 * The requested file or directory does not exist.
 */
export const PATH_NOT_FOUND = -32010;

/**
 * Permission denied
 * 
 * Maps to EACCES / EPERM / SSH_FX_PERMISSION_DENIED.
 * Insufficient permissions to perform the operation.
 */
export const PERMISSION_DENIED = -32011;

/**
 * Already exists
 * 
 * Maps to EEXIST / SSH_FX_FILE_ALREADY_EXISTS.
 * Cannot create file/directory because it already exists.
 */
export const ALREADY_EXISTS = -32012;

/**
 * Disk full or quota exceeded
 * 
 * Maps to ENOSPC.
 * Cannot write because disk is full or user quota exceeded.
 */
export const DISK_FULL_OR_QUOTA = -32013;

/**
 * SFTP operation failed
 * 
 * Generic fallback for unrecognized SFTP errors.
 * Check error.data.source for original error details.
 */
export const SFTP_OPERATION_FAILED = -32020;

// ============================================================================
// SFTP Application Error Codes - Extended (-32021 to -32035)
// ============================================================================

/**
 * Operation cancelled
 * 
 * Request was cancelled by client via $/cancelRequest notification.
 * Check error.data.reason for cancellation cause.
 */
export const OPERATION_CANCELLED = -32021;

/**
 * Not a directory
 * 
 * Maps to ENOTDIR.
 * Operation expected a directory but found a file.
 */
export const NOT_A_DIRECTORY = -32022;

/**
 * Is a directory
 * 
 * Maps to EISDIR.
 * Operation expected a file but found a directory.
 */
export const IS_A_DIRECTORY = -32023;

/**
 * Directory not empty
 * 
 * Maps to ENOTEMPTY / SSH_FX_DIR_NOT_EMPTY.
 * Cannot delete non-empty directory without recursive flag.
 */
export const DIRECTORY_NOT_EMPTY = -32024;

/**
 * Resource busy
 * 
 * Maps to EBUSY.
 * Resource is locked or in use. Retryable error.
 */
export const RESOURCE_BUSY = -32025;

/**
 * Invalid path
 * 
 * Path contains null bytes, invalid UTF-8, or cannot be normalized.
 */
export const INVALID_PATH = -32026;

/**
 * Host key unknown
 * 
 * Host key not in trust store (strict policy).
 * Check error.data.presentedFingerprint.
 */
export const HOST_KEY_UNKNOWN = -32027;

/**
 * Host key mismatch
 * 
 * Host key changed or pinning violation.
 * Check error.data.presentedFingerprint and error.data.expectedFingerprint.
 */
export const HOST_KEY_MISMATCH = -32028;

/**
 * Unsupported operation
 * 
 * Operation not supported by server or not enabled via capability negotiation.
 * Maps to SSH_FX_OP_UNSUPPORTED.
 */
export const UNSUPPORTED_OPERATION = -32029;

/**
 * Incompatible protocol version
 * 
 * Client and worker have incompatible MAJOR protocol versions.
 * Returned during sftp/initialize handshake.
 */
export const INCOMPATIBLE_PROTOCOL = -32030;

/**
 * Invalid chunk
 * 
 * Chunk offset/sequence/size mismatch in chunked I/O operation.
 */
export const INVALID_CHUNK = -32031;

/**
 * Invalid or expired handle
 * 
 * Stream handle does not exist or has expired (TTL exceeded).
 */
export const INVALID_OR_EXPIRED_HANDLE = -32032;

/**
 * Session closing
 * 
 * Session is in closing state, new requests are rejected.
 * In-flight requests will complete.
 */
export const SESSION_CLOSING = -32033;

/**
 * Conflicting operation
 * 
 * Concurrent mutation on same path detected.
 * Operations are serialized via FIFO queue.
 */
export const CONFLICTING_OPERATION = -32034;

/**
 * Data integrity error
 * 
 * Data or protocol corruption detected (e.g., checksum mismatch).
 */
export const DATA_INTEGRITY_ERROR = -32035;

// ============================================================================
// Error Code Categories
// ============================================================================

/**
 * Map of error codes to their category names
 * 
 * Used for structured error.data.category field.
 */
export const ERROR_CATEGORIES: Record<number, string> = {
  [NO_ACTIVE_CONNECTION]: 'NO_ACTIVE_CONNECTION',
  [AUTHENTICATION_FAILED]: 'AUTHENTICATION_FAILED',
  [HOST_UNREACHABLE]: 'HOST_UNREACHABLE',
  [CONNECTION_TIMEOUT]: 'CONNECTION_TIMEOUT',
  [PATH_NOT_FOUND]: 'PATH_NOT_FOUND',
  [PERMISSION_DENIED]: 'PERMISSION_DENIED',
  [ALREADY_EXISTS]: 'ALREADY_EXISTS',
  [DISK_FULL_OR_QUOTA]: 'DISK_FULL_OR_QUOTA',
  [SFTP_OPERATION_FAILED]: 'SFTP_OPERATION_FAILED',
  [OPERATION_CANCELLED]: 'OPERATION_CANCELLED',
  [NOT_A_DIRECTORY]: 'NOT_A_DIRECTORY',
  [IS_A_DIRECTORY]: 'IS_A_DIRECTORY',
  [DIRECTORY_NOT_EMPTY]: 'DIRECTORY_NOT_EMPTY',
  [RESOURCE_BUSY]: 'RESOURCE_BUSY',
  [INVALID_PATH]: 'INVALID_PATH',
  [HOST_KEY_UNKNOWN]: 'HOST_KEY_UNKNOWN',
  [HOST_KEY_MISMATCH]: 'HOST_KEY_MISMATCH',
  [UNSUPPORTED_OPERATION]: 'UNSUPPORTED_OPERATION',
  [INCOMPATIBLE_PROTOCOL]: 'INCOMPATIBLE_PROTOCOL',
  [INVALID_CHUNK]: 'INVALID_CHUNK',
  [INVALID_OR_EXPIRED_HANDLE]: 'INVALID_OR_EXPIRED_HANDLE',
  [SESSION_CLOSING]: 'SESSION_CLOSING',
  [CONFLICTING_OPERATION]: 'CONFLICTING_OPERATION',
  [DATA_INTEGRITY_ERROR]: 'DATA_INTEGRITY_ERROR',
};

/**
 * Retryable error codes
 * 
 * These errors indicate transient conditions that may succeed on retry.
 */
export const RETRYABLE_ERROR_CODES = new Set([
  RESOURCE_BUSY,
  CONNECTION_TIMEOUT,
  SFTP_OPERATION_FAILED, // May be retryable depending on context
]);

/**
 * Check if an error code indicates a retryable condition
 */
export function isRetryableError(code: number): boolean {
  return RETRYABLE_ERROR_CODES.has(code);
}

/**
 * Get error category name for a given error code
 */
export function getErrorCategory(code: number): string {
  return ERROR_CATEGORIES[code] || 'UNKNOWN_ERROR';
}
