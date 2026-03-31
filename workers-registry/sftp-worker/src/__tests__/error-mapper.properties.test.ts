/**
 * ErrorMapper Property-Based Tests
 * 
 * Property-based tests using fast-check to validate error mapping completeness
 * and correctness.
 * 
 * Feature: sftp-vscode-plugin
 * 
 * Tests:
 * - Property 13: Error mapping completeness (Requirements 10.3, 11.9, 11.10, 24.2, 24.3, 24.4)
 */

import fc from 'fast-check';
import { ErrorMapper } from '../error-mapper.js';
import { SftpError } from '../types.js';
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
} from '../error-codes.js';

// ============================================================================
// Fast-check Arbitraries (Generators)
// ============================================================================

/**
 * Known POSIX error codes that should be mapped
 */
const KNOWN_POSIX_CODES = [
  'ENOENT',
  'EACCES',
  'EPERM',
  'EEXIST',
  'ENOSPC',
  'ENOTDIR',
  'EISDIR',
  'ENOTEMPTY',
  'EBUSY',
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNABORTED',
] as const;

/**
 * Known SSH_FX_* error codes that should be mapped
 */
const KNOWN_SSH_FX_CODES = [
  'SSH_FX_NO_SUCH_FILE',
  'SSH_FX_PERMISSION_DENIED',
  'SSH_FX_FILE_ALREADY_EXISTS',
  'SSH_FX_DIR_NOT_EMPTY',
  'SSH_FX_OP_UNSUPPORTED',
] as const;

/**
 * Expected mapping for known error codes
 */
const EXPECTED_MAPPINGS: Record<string, number> = {
  'ENOENT': PATH_NOT_FOUND,
  'EACCES': PERMISSION_DENIED,
  'EPERM': PERMISSION_DENIED,
  'EEXIST': ALREADY_EXISTS,
  'ENOSPC': DISK_FULL_OR_QUOTA,
  'ENOTDIR': NOT_A_DIRECTORY,
  'EISDIR': IS_A_DIRECTORY,
  'ENOTEMPTY': DIRECTORY_NOT_EMPTY,
  'EBUSY': RESOURCE_BUSY,
  'ETIMEDOUT': CONNECTION_TIMEOUT,
  'ECONNRESET': SFTP_OPERATION_FAILED,
  'ECONNABORTED': SFTP_OPERATION_FAILED,
  'SSH_FX_NO_SUCH_FILE': PATH_NOT_FOUND,
  'SSH_FX_PERMISSION_DENIED': PERMISSION_DENIED,
  'SSH_FX_FILE_ALREADY_EXISTS': ALREADY_EXISTS,
  'SSH_FX_DIR_NOT_EMPTY': DIRECTORY_NOT_EMPTY,
  'SSH_FX_OP_UNSUPPORTED': UNSUPPORTED_OPERATION,
};

/**
 * Generate known POSIX error codes
 */
const arbKnownPosixCode = fc.constantFrom(...KNOWN_POSIX_CODES);

/**
 * Generate known SSH_FX_* error codes
 */
const arbKnownSshFxCode = fc.constantFrom(...KNOWN_SSH_FX_CODES);

/**
 * Generate any known error code
 */
const arbKnownErrorCode = fc.oneof(arbKnownPosixCode, arbKnownSshFxCode);

/**
 * Generate unrecognized error codes
 */
const arbUnrecognizedErrorCode = fc.oneof(
  // Random POSIX-style codes
  fc.stringOf(fc.constantFrom('E', 'X', 'Y', 'Z', 'A', 'B'), { minLength: 5, maxLength: 10 }),
  // Random SSH_FX_* codes
  fc.stringOf(fc.constantFrom('_', 'A', 'B', 'C', 'X', 'Y', 'Z'), { minLength: 10, maxLength: 20 })
    .map(s => 'SSH_FX_' + s),
  // Completely random strings
  fc.string({ minLength: 3, maxLength: 15 })
).filter(code => !(code in EXPECTED_MAPPINGS));

/**
 * Generate error messages
 */
const arbErrorMessage = fc.oneof(
  fc.constant('File not found'),
  fc.constant('Permission denied'),
  fc.constant('Connection reset by peer'),
  fc.constant('No such file or directory'),
  fc.constant('Operation not permitted'),
  fc.string({ minLength: 10, maxLength: 100 })
);

/**
 * Generate ssh2-sftp-client style errors with error.code
 */
const arbSsh2ErrorWithCode = fc.record({
  code: arbKnownErrorCode,
  message: arbErrorMessage,
});

/**
 * Generate ssh2-sftp-client style errors with SSH_FX_* in message
 */
const arbSsh2ErrorWithSshFxInMessage = fc.record({
  message: fc.tuple(arbKnownSshFxCode, arbErrorMessage)
    .map(([code, msg]) => `${code}: ${msg}`),
});

/**
 * Generate unrecognized errors
 */
const arbUnrecognizedError = fc.oneof(
  // Error with unrecognized code
  fc.record({
    code: arbUnrecognizedErrorCode,
    message: arbErrorMessage,
  }),
  // Error with no code
  fc.record({
    message: arbErrorMessage,
  }),
  // Plain string error
  arbErrorMessage,
  // Error object without code
  fc.record({
    name: fc.constant('Error'),
    message: arbErrorMessage,
  })
);

/**
 * Generate valid POSIX paths
 */
const arbPath = fc.array(
  fc.stringOf(fc.char().filter(c => c !== '/' && c !== '\0'), { minLength: 1, maxLength: 20 }),
  { minLength: 1, maxLength: 5 }
).map(segments => '/' + segments.join('/'));

/**
 * Generate error context
 */
const arbErrorContext = fc.record({
  path: fc.option(arbPath, { nil: undefined }),
  method: fc.option(fc.constantFrom('sftp/readFile', 'sftp/writeFile', 'sftp/readdir', 'sftp/stat'), { nil: undefined }),
});

// ============================================================================
// Property-Based Tests
// ============================================================================

describe('ErrorMapper - Property-Based Tests', () => {
  /**
   * Property 13: Error mapping completeness
   * 
   * For any error from ssh2-sftp-client with a known code (ENOENT, EACCES, EPERM,
   * EEXIST, ENOSPC, ENOTDIR, EISDIR, ENOTEMPTY, EBUSY, ETIMEDOUT, ECONNRESET,
   * SSH_FX_* codes), ErrorMapper should produce a JSON-RPC error with the code
   * corresponding to the normative table.
   * 
   * For any unrecognized error, the result should be -32020 with retryable: false.
   * 
   * For all errors, data should contain source (with original code/message),
   * category, and retryable.
   * 
   * **Validates: Requirements 10.3, 11.9, 11.10, 24.2, 24.3, 24.4**
   */
  describe('Property 13: Error mapping completeness', () => {
    it('should map all known POSIX error codes correctly', () => {
      fc.assert(
        fc.property(
          arbSsh2ErrorWithCode,
          arbErrorContext,
          (error, context) => {
            const rpcError = ErrorMapper.map(error, context);

            // Should map to expected code
            const expectedCode = EXPECTED_MAPPINGS[error.code];
            expect(rpcError.code).toBe(expectedCode);

            // Should have structured data
            expect(rpcError.data).toBeDefined();
            expect(rpcError.data?.source).toBeDefined();
            expect(rpcError.data?.category).toBeDefined();
            expect(typeof rpcError.data?.retryable).toBe('boolean');

            // Source should contain original error code
            expect(rpcError.data?.source).toContain(error.code);

            // Path should be preserved if provided
            if (context.path) {
              expect(rpcError.data?.path).toBe(context.path);
              expect(rpcError.message).toContain(context.path);
            }

            return true;
          }
        ),
        { numRuns: 200 }
      );
    });

    it('should map SSH_FX_* codes in error messages correctly', () => {
      fc.assert(
        fc.property(
          arbSsh2ErrorWithSshFxInMessage,
          arbErrorContext,
          (error, context) => {
            const rpcError = ErrorMapper.map(error, context);

            // Extract SSH_FX_* code from message
            const sshFxMatch = error.message.match(/SSH_FX_[A-Z_]+/);
            if (sshFxMatch) {
              const sshFxCode = sshFxMatch[0];
              const expectedCode = EXPECTED_MAPPINGS[sshFxCode];

              // Should map to expected code
              expect(rpcError.code).toBe(expectedCode);

              // Source should contain SSH_FX_* code
              expect(rpcError.data?.source).toContain(sshFxCode);
            }

            // Should have structured data
            expect(rpcError.data).toBeDefined();
            expect(rpcError.data?.source).toBeDefined();
            expect(rpcError.data?.category).toBeDefined();
            expect(typeof rpcError.data?.retryable).toBe('boolean');

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should map unrecognized errors to -32020 with retryable: false', () => {
      fc.assert(
        fc.property(
          arbUnrecognizedError,
          arbErrorContext,
          (error, context) => {
            const rpcError = ErrorMapper.map(error, context);

            // Should map to SFTP_OPERATION_FAILED
            expect(rpcError.code).toBe(SFTP_OPERATION_FAILED);

            // Should NOT be retryable (Requirement 24.3)
            expect(rpcError.data?.retryable).toBe(false);

            // Should have structured data
            expect(rpcError.data).toBeDefined();
            expect(rpcError.data?.source).toBeDefined();
            expect(rpcError.data?.category).toBe('SFTP_OPERATION_FAILED');

            return true;
          }
        ),
        { numRuns: 200 }
      );
    });

    it('should always include source, category, and retryable in data', () => {
      fc.assert(
        fc.property(
          fc.oneof(arbSsh2ErrorWithCode, arbSsh2ErrorWithSshFxInMessage, arbUnrecognizedError),
          arbErrorContext,
          (error, context) => {
            const rpcError = ErrorMapper.map(error, context);

            // data must be defined
            expect(rpcError.data).toBeDefined();

            // source must be a non-empty string
            expect(typeof rpcError.data?.source).toBe('string');
            expect(rpcError.data?.source.length).toBeGreaterThan(0);

            // category must be a non-empty string
            expect(typeof rpcError.data?.category).toBe('string');
            expect(rpcError.data?.category.length).toBeGreaterThan(0);

            // retryable must be a boolean
            expect(typeof rpcError.data?.retryable).toBe('boolean');

            return true;
          }
        ),
        { numRuns: 300 }
      );
    });

    it('should preserve path in data when provided in context', () => {
      fc.assert(
        fc.property(
          fc.oneof(arbSsh2ErrorWithCode, arbUnrecognizedError),
          arbPath,
          (error, path) => {
            const rpcError = ErrorMapper.map(error, { path });

            // Path should be in data
            expect(rpcError.data?.path).toBe(path);

            // Path should be in message
            expect(rpcError.message).toContain(path);

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle SftpError instances correctly', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: -32035, max: -32000 }),
          arbErrorMessage,
          arbPath,
          (code, message, path) => {
            const sftpError = new SftpError(code, message, path);
            const rpcError = ErrorMapper.map(sftpError);

            // Should preserve code
            expect(rpcError.code).toBe(code);

            // Should preserve message
            expect(rpcError.message).toBe(message);

            // Should preserve path
            expect(rpcError.data?.path).toBe(path);

            // Should have structured data
            expect(rpcError.data).toBeDefined();
            expect(rpcError.data?.source).toBeDefined();
            expect(rpcError.data?.category).toBeDefined();
            expect(typeof rpcError.data?.retryable).toBe('boolean');

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should correctly identify retryable errors', () => {
      // EBUSY should be retryable
      const busyError = { code: 'EBUSY', message: 'Resource busy' };
      const busyRpcError = ErrorMapper.map(busyError);
      expect(busyRpcError.code).toBe(RESOURCE_BUSY);
      expect(busyRpcError.data?.retryable).toBe(true);

      // ETIMEDOUT should be retryable
      const timeoutError = { code: 'ETIMEDOUT', message: 'Connection timeout' };
      const timeoutRpcError = ErrorMapper.map(timeoutError);
      expect(timeoutRpcError.code).toBe(CONNECTION_TIMEOUT);
      expect(timeoutRpcError.data?.retryable).toBe(true);

      // ECONNRESET should be retryable (maps to SFTP_OPERATION_FAILED)
      const resetError = { code: 'ECONNRESET', message: 'Connection reset' };
      const resetRpcError = ErrorMapper.map(resetError);
      expect(resetRpcError.code).toBe(SFTP_OPERATION_FAILED);
      expect(resetRpcError.data?.retryable).toBe(true);
    });

    it('should correctly identify non-retryable errors', () => {
      // ENOENT should not be retryable
      const noentError = { code: 'ENOENT', message: 'File not found' };
      const noentRpcError = ErrorMapper.map(noentError);
      expect(noentRpcError.code).toBe(PATH_NOT_FOUND);
      expect(noentRpcError.data?.retryable).toBe(false);

      // EACCES should not be retryable
      const accessError = { code: 'EACCES', message: 'Permission denied' };
      const accessRpcError = ErrorMapper.map(accessError);
      expect(accessRpcError.code).toBe(PERMISSION_DENIED);
      expect(accessRpcError.data?.retryable).toBe(false);

      // Unrecognized errors should not be retryable
      const unknownError = { code: 'EUNKNOWN', message: 'Unknown error' };
      const unknownRpcError = ErrorMapper.map(unknownError);
      expect(unknownRpcError.code).toBe(SFTP_OPERATION_FAILED);
      expect(unknownRpcError.data?.retryable).toBe(false);
    });

    it('should handle all known error codes from normative table', () => {
      const testCases = [
        { code: 'ENOENT', expected: PATH_NOT_FOUND },
        { code: 'EACCES', expected: PERMISSION_DENIED },
        { code: 'EPERM', expected: PERMISSION_DENIED },
        { code: 'EEXIST', expected: ALREADY_EXISTS },
        { code: 'ENOSPC', expected: DISK_FULL_OR_QUOTA },
        { code: 'ENOTDIR', expected: NOT_A_DIRECTORY },
        { code: 'EISDIR', expected: IS_A_DIRECTORY },
        { code: 'ENOTEMPTY', expected: DIRECTORY_NOT_EMPTY },
        { code: 'EBUSY', expected: RESOURCE_BUSY },
        { code: 'ETIMEDOUT', expected: CONNECTION_TIMEOUT },
        { code: 'ECONNRESET', expected: SFTP_OPERATION_FAILED },
        { code: 'SSH_FX_NO_SUCH_FILE', expected: PATH_NOT_FOUND },
        { code: 'SSH_FX_PERMISSION_DENIED', expected: PERMISSION_DENIED },
        { code: 'SSH_FX_FILE_ALREADY_EXISTS', expected: ALREADY_EXISTS },
        { code: 'SSH_FX_DIR_NOT_EMPTY', expected: DIRECTORY_NOT_EMPTY },
        { code: 'SSH_FX_OP_UNSUPPORTED', expected: UNSUPPORTED_OPERATION },
      ];

      for (const { code, expected } of testCases) {
        const error = { code, message: `Test error: ${code}` };
        const rpcError = ErrorMapper.map(error);

        expect(rpcError.code).toBe(expected);
        expect(rpcError.data?.source).toContain(code);
        expect(rpcError.data?.category).toBeDefined();
        expect(typeof rpcError.data?.retryable).toBe('boolean');
      }
    });

    it('should use createError for internal errors', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: -32035, max: -32000 }),
          arbErrorMessage,
          arbErrorContext,
          (code, message, context) => {
            const rpcError = ErrorMapper.createError(code, message, context);

            // Should have correct code and message
            expect(rpcError.code).toBe(code);
            expect(rpcError.message).toContain(message);

            // Should have structured data
            expect(rpcError.data).toBeDefined();
            expect(rpcError.data?.source).toBe('Worker');
            expect(rpcError.data?.category).toBeDefined();
            expect(typeof rpcError.data?.retryable).toBe('boolean');

            // Should preserve path if provided
            if (context.path) {
              expect(rpcError.data?.path).toBe(context.path);
              expect(rpcError.message).toContain(context.path);
            }

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
