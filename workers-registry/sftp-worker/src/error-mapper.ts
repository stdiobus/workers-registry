/**
 * ErrorMapper - ssh2-sftp-client error → SftpError → RpcError pipeline
 * 
 * Implements the normative error mapping table from Requirements 11.8, 24.1-24.4.
 * 
 * Pipeline:
 * 1. Extract error code/message from ssh2-sftp-client exception
 * 2. Map to SftpError using normative table
 * 3. Enrich with structured data (source, category, path, retryable)
 * 4. Format as JSON-RPC error object
 */

import { RpcError, SftpError } from './types.js';
import {
  PATH_NOT_FOUND,
  PERMISSION_DENIED,
  ALREADY_EXISTS,
  DISK_FULL_OR_QUOTA,
  NOT_A_DIRECTORY,
  IS_A_DIRECTORY,
  DIRECTORY_NOT_EMPTY,
  RESOURCE_BUSY,
  CONNECTION_TIMEOUT,
  SFTP_OPERATION_FAILED,
  UNSUPPORTED_OPERATION,
  ERROR_CATEGORIES,
  isRetryableError,
  getErrorCategory,
} from './error-codes.js';

// ============================================================================
// Error Code Mapping Table
// ============================================================================

/**
 * Normative mapping table: ssh2/POSIX error codes → JSON-RPC error codes
 * 
 * This table defines the canonical mapping from ssh2-sftp-client and POSIX
 * error codes to JSON-RPC error codes as specified in Requirements 11.8, 24.2.
 */
const ERROR_CODE_MAP: Record<string, number> = {
  // POSIX error codes
  'ENOENT': PATH_NOT_FOUND,           // -32010
  'EACCES': PERMISSION_DENIED,        // -32011
  'EPERM': PERMISSION_DENIED,         // -32011
  'EEXIST': ALREADY_EXISTS,           // -32012
  'ENOSPC': DISK_FULL_OR_QUOTA,       // -32013
  'ENOTDIR': NOT_A_DIRECTORY,         // -32022
  'EISDIR': IS_A_DIRECTORY,           // -32023
  'ENOTEMPTY': DIRECTORY_NOT_EMPTY,   // -32024
  'EBUSY': RESOURCE_BUSY,             // -32025
  'ETIMEDOUT': CONNECTION_TIMEOUT,    // -32003
  'ECONNRESET': SFTP_OPERATION_FAILED, // -32020
  'ECONNABORTED': SFTP_OPERATION_FAILED, // -32020

  // SSH_FX_* error codes (SFTP protocol errors)
  'SSH_FX_NO_SUCH_FILE': PATH_NOT_FOUND,           // -32010
  'SSH_FX_PERMISSION_DENIED': PERMISSION_DENIED,   // -32011
  'SSH_FX_FILE_ALREADY_EXISTS': ALREADY_EXISTS,    // -32012
  'SSH_FX_DIR_NOT_EMPTY': DIRECTORY_NOT_EMPTY,     // -32024
  'SSH_FX_OP_UNSUPPORTED': UNSUPPORTED_OPERATION,  // -32029
};

// ============================================================================
// Error Extraction
// ============================================================================

/**
 * Extract error code from ssh2-sftp-client error
 * 
 * ssh2-sftp-client errors can have:
 * - error.code (string): POSIX error code (ENOENT, EACCES, etc.)
 * - error.message (string): May contain SSH_FX_* codes
 */
function extractErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') {
    return null;
  }

  const err = error as any;

  // Check for error.code property (POSIX codes)
  if (typeof err.code === 'string') {
    return err.code;
  }

  // Check for SSH_FX_* codes in message
  if (typeof err.message === 'string') {
    const sshFxMatch = err.message.match(/SSH_FX_[A-Z_]+/);
    if (sshFxMatch) {
      return sshFxMatch[0];
    }
  }

  return null;
}

/**
 * Extract error message from ssh2-sftp-client error
 */
function extractErrorMessage(error: unknown): string {
  if (!error) {
    return 'Unknown error';
  }

  if (typeof error === 'string') {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'object' && 'message' in error) {
    return String((error as any).message);
  }

  return String(error);
}

/**
 * Format original error for data.source field
 * 
 * Includes error code and message for diagnostics, but never credentials.
 */
function formatSourceError(error: unknown): string {
  const code = extractErrorCode(error);
  const message = extractErrorMessage(error);

  if (code) {
    return `${code}: ${message}`;
  }

  return message;
}

// ============================================================================
// ErrorMapper
// ============================================================================

export interface ErrorContext {
  path?: string;
  method?: string;
}

export class ErrorMapper {
  /**
   * Map ssh2-sftp-client error to JSON-RPC error
   * 
   * Pipeline:
   * 1. Extract error code from ssh2-sftp-client exception
   * 2. Map to JSON-RPC error code using normative table
   * 3. Enrich with structured data (source, category, path, retryable)
   * 4. Return RpcError object
   * 
   * @param err - Error from ssh2-sftp-client or other source
   * @param context - Additional context (path, method)
   * @returns RpcError object ready for JSON-RPC response
   */
  static map(err: unknown, context: ErrorContext = {}): RpcError {
    // If already an SftpError, use its code directly
    if (err instanceof SftpError) {
      return this.mapSftpError(err, context);
    }

    // Extract error code from ssh2-sftp-client error
    const errorCode = extractErrorCode(err);
    const errorMessage = extractErrorMessage(err);

    // Map to JSON-RPC error code using normative table
    let rpcCode: number;
    let isRecognized = false;
    if (errorCode && errorCode in ERROR_CODE_MAP) {
      rpcCode = ERROR_CODE_MAP[errorCode];
      isRecognized = true;
    } else {
      // Unrecognized error → -32020 with retryable: false (Requirement 24.3)
      rpcCode = SFTP_OPERATION_FAILED;
      isRecognized = false;
    }

    // Determine retryability
    // Special case: unrecognized errors mapped to -32020 should NOT be retryable
    // even though ECONNRESET → -32020 IS retryable (Requirement 24.3)
    let retryable: boolean;
    if (!isRecognized && rpcCode === SFTP_OPERATION_FAILED) {
      retryable = false;
    } else {
      retryable = isRetryableError(rpcCode);
    }

    // Get error category
    const category = getErrorCategory(rpcCode);

    // Format message
    const message = context.path
      ? `${errorMessage}: ${context.path}`
      : errorMessage;

    // Build RpcError with structured data (Requirement 11.9)
    return {
      code: rpcCode,
      message,
      data: {
        source: formatSourceError(err),
        category,
        path: context.path,
        retryable,
      },
    };
  }

  /**
   * Map SftpError to RpcError
   * 
   * Used when error is already typed as SftpError (internal errors).
   */
  private static mapSftpError(err: SftpError, context: ErrorContext): RpcError {
    const category = getErrorCategory(err.code);
    const retryable = isRetryableError(err.code);

    return {
      code: err.code,
      message: err.message,
      data: {
        source: err.originalError ? formatSourceError(err.originalError) : 'SftpError',
        category,
        path: err.path || context.path,
        retryable,
      },
    };
  }

  /**
   * Create RpcError from error code and message
   * 
   * Used for internal errors that don't originate from ssh2-sftp-client.
   */
  static createError(
    code: number,
    message: string,
    context: ErrorContext = {}
  ): RpcError {
    const category = getErrorCategory(code);
    const retryable = isRetryableError(code);

    return {
      code,
      message: context.path ? `${message}: ${context.path}` : message,
      data: {
        source: 'Worker',
        category,
        path: context.path,
        retryable,
      },
    };
  }

  /**
   * Create and throw RpcError
   * 
   * Convenience method for throwing RPC errors directly.
   */
  static createRpcError(
    code: number,
    message: string,
    context: ErrorContext = {}
  ): never {
    throw this.createError(code, message, context);
  }
}
