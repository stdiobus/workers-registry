/**
 * ErrorMapper Unit Tests
 * 
 * Unit tests for ErrorMapper with specific examples and edge cases.
 * Complements the property-based tests with concrete scenarios.
 * 
 * Feature: sftp-vscode-plugin
 */

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

describe('ErrorMapper - Unit Tests', () => {
  describe('POSIX error code mapping', () => {
    it('should map ENOENT to PATH_NOT_FOUND', () => {
      const error = { code: 'ENOENT', message: 'No such file or directory' };
      const rpcError = ErrorMapper.map(error, { path: '/test/file.txt' });

      expect(rpcError.code).toBe(PATH_NOT_FOUND);
      expect(rpcError.message).toContain('/test/file.txt');
      expect(rpcError.data?.source).toContain('ENOENT');
      expect(rpcError.data?.category).toBe('PATH_NOT_FOUND');
      expect(rpcError.data?.retryable).toBe(false);
    });

    it('should map EACCES to PERMISSION_DENIED', () => {
      const error = { code: 'EACCES', message: 'Permission denied' };
      const rpcError = ErrorMapper.map(error);

      expect(rpcError.code).toBe(PERMISSION_DENIED);
      expect(rpcError.data?.category).toBe('PERMISSION_DENIED');
      expect(rpcError.data?.retryable).toBe(false);
    });

    it('should map EPERM to PERMISSION_DENIED', () => {
      const error = { code: 'EPERM', message: 'Operation not permitted' };
      const rpcError = ErrorMapper.map(error);

      expect(rpcError.code).toBe(PERMISSION_DENIED);
      expect(rpcError.data?.category).toBe('PERMISSION_DENIED');
      expect(rpcError.data?.retryable).toBe(false);
    });

    it('should map EEXIST to ALREADY_EXISTS', () => {
      const error = { code: 'EEXIST', message: 'File exists' };
      const rpcError = ErrorMapper.map(error);

      expect(rpcError.code).toBe(ALREADY_EXISTS);
      expect(rpcError.data?.category).toBe('ALREADY_EXISTS');
      expect(rpcError.data?.retryable).toBe(false);
    });

    it('should map ENOSPC to DISK_FULL_OR_QUOTA', () => {
      const error = { code: 'ENOSPC', message: 'No space left on device' };
      const rpcError = ErrorMapper.map(error);

      expect(rpcError.code).toBe(DISK_FULL_OR_QUOTA);
      expect(rpcError.data?.category).toBe('DISK_FULL_OR_QUOTA');
      expect(rpcError.data?.retryable).toBe(false);
    });

    it('should map ENOTDIR to NOT_A_DIRECTORY', () => {
      const error = { code: 'ENOTDIR', message: 'Not a directory' };
      const rpcError = ErrorMapper.map(error);

      expect(rpcError.code).toBe(NOT_A_DIRECTORY);
      expect(rpcError.data?.category).toBe('NOT_A_DIRECTORY');
      expect(rpcError.data?.retryable).toBe(false);
    });

    it('should map EISDIR to IS_A_DIRECTORY', () => {
      const error = { code: 'EISDIR', message: 'Is a directory' };
      const rpcError = ErrorMapper.map(error);

      expect(rpcError.code).toBe(IS_A_DIRECTORY);
      expect(rpcError.data?.category).toBe('IS_A_DIRECTORY');
      expect(rpcError.data?.retryable).toBe(false);
    });

    it('should map ENOTEMPTY to DIRECTORY_NOT_EMPTY', () => {
      const error = { code: 'ENOTEMPTY', message: 'Directory not empty' };
      const rpcError = ErrorMapper.map(error);

      expect(rpcError.code).toBe(DIRECTORY_NOT_EMPTY);
      expect(rpcError.data?.category).toBe('DIRECTORY_NOT_EMPTY');
      expect(rpcError.data?.retryable).toBe(false);
    });

    it('should map EBUSY to RESOURCE_BUSY (retryable)', () => {
      const error = { code: 'EBUSY', message: 'Device or resource busy' };
      const rpcError = ErrorMapper.map(error);

      expect(rpcError.code).toBe(RESOURCE_BUSY);
      expect(rpcError.data?.category).toBe('RESOURCE_BUSY');
      expect(rpcError.data?.retryable).toBe(true);
    });

    it('should map ETIMEDOUT to CONNECTION_TIMEOUT (retryable)', () => {
      const error = { code: 'ETIMEDOUT', message: 'Connection timed out' };
      const rpcError = ErrorMapper.map(error);

      expect(rpcError.code).toBe(CONNECTION_TIMEOUT);
      expect(rpcError.data?.category).toBe('CONNECTION_TIMEOUT');
      expect(rpcError.data?.retryable).toBe(true);
    });

    it('should map ECONNRESET to SFTP_OPERATION_FAILED (retryable)', () => {
      const error = { code: 'ECONNRESET', message: 'Connection reset by peer' };
      const rpcError = ErrorMapper.map(error);

      expect(rpcError.code).toBe(SFTP_OPERATION_FAILED);
      expect(rpcError.data?.category).toBe('SFTP_OPERATION_FAILED');
      expect(rpcError.data?.retryable).toBe(true);
    });

    it('should map ECONNABORTED to SFTP_OPERATION_FAILED (retryable)', () => {
      const error = { code: 'ECONNABORTED', message: 'Connection aborted' };
      const rpcError = ErrorMapper.map(error);

      expect(rpcError.code).toBe(SFTP_OPERATION_FAILED);
      expect(rpcError.data?.category).toBe('SFTP_OPERATION_FAILED');
      expect(rpcError.data?.retryable).toBe(true);
    });
  });

  describe('SSH_FX_* error code mapping', () => {
    it('should map SSH_FX_NO_SUCH_FILE to PATH_NOT_FOUND', () => {
      const error = { code: 'SSH_FX_NO_SUCH_FILE', message: 'No such file' };
      const rpcError = ErrorMapper.map(error);

      expect(rpcError.code).toBe(PATH_NOT_FOUND);
      expect(rpcError.data?.source).toContain('SSH_FX_NO_SUCH_FILE');
      expect(rpcError.data?.category).toBe('PATH_NOT_FOUND');
    });

    it('should map SSH_FX_PERMISSION_DENIED to PERMISSION_DENIED', () => {
      const error = { code: 'SSH_FX_PERMISSION_DENIED', message: 'Permission denied' };
      const rpcError = ErrorMapper.map(error);

      expect(rpcError.code).toBe(PERMISSION_DENIED);
      expect(rpcError.data?.category).toBe('PERMISSION_DENIED');
    });

    it('should map SSH_FX_FILE_ALREADY_EXISTS to ALREADY_EXISTS', () => {
      const error = { code: 'SSH_FX_FILE_ALREADY_EXISTS', message: 'File already exists' };
      const rpcError = ErrorMapper.map(error);

      expect(rpcError.code).toBe(ALREADY_EXISTS);
      expect(rpcError.data?.category).toBe('ALREADY_EXISTS');
    });

    it('should map SSH_FX_DIR_NOT_EMPTY to DIRECTORY_NOT_EMPTY', () => {
      const error = { code: 'SSH_FX_DIR_NOT_EMPTY', message: 'Directory not empty' };
      const rpcError = ErrorMapper.map(error);

      expect(rpcError.code).toBe(DIRECTORY_NOT_EMPTY);
      expect(rpcError.data?.category).toBe('DIRECTORY_NOT_EMPTY');
    });

    it('should map SSH_FX_OP_UNSUPPORTED to UNSUPPORTED_OPERATION', () => {
      const error = { code: 'SSH_FX_OP_UNSUPPORTED', message: 'Operation not supported' };
      const rpcError = ErrorMapper.map(error);

      expect(rpcError.code).toBe(UNSUPPORTED_OPERATION);
      expect(rpcError.data?.category).toBe('UNSUPPORTED_OPERATION');
    });

    it('should extract SSH_FX_* codes from error messages', () => {
      const error = { message: 'SSH_FX_NO_SUCH_FILE: File not found' };
      const rpcError = ErrorMapper.map(error);

      expect(rpcError.code).toBe(PATH_NOT_FOUND);
      expect(rpcError.data?.source).toContain('SSH_FX_NO_SUCH_FILE');
    });
  });

  describe('Unrecognized error handling', () => {
    it('should map unrecognized error codes to SFTP_OPERATION_FAILED with retryable: false', () => {
      const error = { code: 'EUNKNOWN', message: 'Unknown error' };
      const rpcError = ErrorMapper.map(error);

      expect(rpcError.code).toBe(SFTP_OPERATION_FAILED);
      expect(rpcError.data?.category).toBe('SFTP_OPERATION_FAILED');
      expect(rpcError.data?.retryable).toBe(false);
    });

    it('should map errors without code to SFTP_OPERATION_FAILED with retryable: false', () => {
      const error = { message: 'Something went wrong' };
      const rpcError = ErrorMapper.map(error);

      expect(rpcError.code).toBe(SFTP_OPERATION_FAILED);
      expect(rpcError.data?.retryable).toBe(false);
    });

    it('should handle string errors', () => {
      const error = 'Connection failed';
      const rpcError = ErrorMapper.map(error);

      expect(rpcError.code).toBe(SFTP_OPERATION_FAILED);
      expect(rpcError.message).toBe('Connection failed');
      expect(rpcError.data?.retryable).toBe(false);
    });

    it('should handle Error instances without code', () => {
      const error = new Error('Generic error');
      const rpcError = ErrorMapper.map(error);

      expect(rpcError.code).toBe(SFTP_OPERATION_FAILED);
      expect(rpcError.message).toBe('Generic error');
      expect(rpcError.data?.retryable).toBe(false);
    });
  });

  describe('SftpError handling', () => {
    it('should handle SftpError instances', () => {
      const sftpError = new SftpError(PATH_NOT_FOUND, 'File not found', '/test/file.txt');
      const rpcError = ErrorMapper.map(sftpError);

      expect(rpcError.code).toBe(PATH_NOT_FOUND);
      expect(rpcError.message).toBe('File not found');
      expect(rpcError.data?.path).toBe('/test/file.txt');
      expect(rpcError.data?.category).toBe('PATH_NOT_FOUND');
    });

    it('should preserve originalError in SftpError', () => {
      const originalError = { code: 'ENOENT', message: 'No such file' };
      const sftpError = new SftpError(
        PATH_NOT_FOUND,
        'File not found',
        '/test/file.txt',
        originalError
      );
      const rpcError = ErrorMapper.map(sftpError);

      expect(rpcError.data?.source).toContain('ENOENT');
    });
  });

  describe('Context handling', () => {
    it('should include path in message when provided', () => {
      const error = { code: 'ENOENT', message: 'File not found' };
      const rpcError = ErrorMapper.map(error, { path: '/home/user/file.txt' });

      expect(rpcError.message).toContain('/home/user/file.txt');
      expect(rpcError.data?.path).toBe('/home/user/file.txt');
    });

    it('should not include path in message when not provided', () => {
      const error = { code: 'ENOENT', message: 'File not found' };
      const rpcError = ErrorMapper.map(error);

      expect(rpcError.message).toBe('File not found');
      expect(rpcError.data?.path).toBeUndefined();
    });

    it('should preserve method in context', () => {
      const error = { code: 'ENOENT', message: 'File not found' };
      const rpcError = ErrorMapper.map(error, { method: 'sftp/readFile' });

      // Method is stored in context but not directly in RpcError
      // (it's used for logging/debugging)
      expect(rpcError.data).toBeDefined();
    });
  });

  describe('createError method', () => {
    it('should create RpcError from code and message', () => {
      const rpcError = ErrorMapper.createError(PATH_NOT_FOUND, 'File not found');

      expect(rpcError.code).toBe(PATH_NOT_FOUND);
      expect(rpcError.message).toBe('File not found');
      expect(rpcError.data?.source).toBe('Worker');
      expect(rpcError.data?.category).toBe('PATH_NOT_FOUND');
    });

    it('should include path in createError', () => {
      const rpcError = ErrorMapper.createError(
        PATH_NOT_FOUND,
        'File not found',
        { path: '/test/file.txt' }
      );

      expect(rpcError.message).toContain('/test/file.txt');
      expect(rpcError.data?.path).toBe('/test/file.txt');
    });

    it('should set correct retryability in createError', () => {
      const retryableError = ErrorMapper.createError(RESOURCE_BUSY, 'Resource busy');
      expect(retryableError.data?.retryable).toBe(true);

      const nonRetryableError = ErrorMapper.createError(PATH_NOT_FOUND, 'Not found');
      expect(nonRetryableError.data?.retryable).toBe(false);
    });
  });

  describe('Structured data completeness', () => {
    it('should always include source, category, and retryable', () => {
      const error = { code: 'ENOENT', message: 'File not found' };
      const rpcError = ErrorMapper.map(error);

      expect(rpcError.data).toBeDefined();
      expect(typeof rpcError.data?.source).toBe('string');
      expect(rpcError.data?.source.length).toBeGreaterThan(0);
      expect(typeof rpcError.data?.category).toBe('string');
      expect(rpcError.data?.category.length).toBeGreaterThan(0);
      expect(typeof rpcError.data?.retryable).toBe('boolean');
    });

    it('should include original error code in source', () => {
      const error = { code: 'ENOENT', message: 'File not found' };
      const rpcError = ErrorMapper.map(error);

      expect(rpcError.data?.source).toContain('ENOENT');
      expect(rpcError.data?.source).toContain('File not found');
    });
  });

  describe('Edge cases', () => {
    it('should handle null error', () => {
      const rpcError = ErrorMapper.map(null);

      expect(rpcError.code).toBe(SFTP_OPERATION_FAILED);
      expect(rpcError.message).toBe('Unknown error');
      expect(rpcError.data?.retryable).toBe(false);
    });

    it('should handle undefined error', () => {
      const rpcError = ErrorMapper.map(undefined);

      expect(rpcError.code).toBe(SFTP_OPERATION_FAILED);
      expect(rpcError.message).toBe('Unknown error');
      expect(rpcError.data?.retryable).toBe(false);
    });

    it('should handle empty object error', () => {
      const rpcError = ErrorMapper.map({});

      expect(rpcError.code).toBe(SFTP_OPERATION_FAILED);
      expect(rpcError.data?.retryable).toBe(false);
    });

    it('should handle error with only code', () => {
      const error = { code: 'ENOENT' };
      const rpcError = ErrorMapper.map(error);

      expect(rpcError.code).toBe(PATH_NOT_FOUND);
      expect(rpcError.data?.source).toContain('ENOENT');
    });

    it('should handle error with only message', () => {
      const error = { message: 'Something failed' };
      const rpcError = ErrorMapper.map(error);

      expect(rpcError.code).toBe(SFTP_OPERATION_FAILED);
      expect(rpcError.message).toBe('Something failed');
    });
  });
});
