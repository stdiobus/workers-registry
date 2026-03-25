/*
 * Apache License 2.0
 * Copyright (c) 2025–present Raman Marozau, Target Insight Function.
 * Contact: raman@worktif.com
 *
 * This file is part of the stdio bus protocol reference implementation:
 *   stdio_bus_kernel_workers (target: <target_stdio_bus_kernel_workers>).
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for OAuth 2.1 authentication type definitions.
 *
 * Tests type guards and validation functions for runtime type checking.
 *
 * @module types.test
 * @validates Requirements 7.1
 */

import {
  isValidProviderId,
  isValidStorageBackend,
  isValidTokenStatus,
  isValidErrorCode,
  VALID_PROVIDER_IDS,
  VALID_STORAGE_BACKENDS,
  VALID_TOKEN_STATUSES,
  VALID_ERROR_CODES,
  type AuthProviderId,
  type StorageBackendType,
  type TokenStatus,
  type AuthErrorCode,
} from './types.js';

describe('isValidProviderId', () => {
  /**
   * Validates: Requirements 7.1 - Provider Configuration
   * Tests that the type guard correctly identifies valid provider IDs.
   */
  describe('valid provider IDs', () => {
    it.each(VALID_PROVIDER_IDS)('should return true for valid provider ID: %s', (providerId) => {
      expect(isValidProviderId(providerId)).toBe(true);
    });

    it('should accept all supported providers: openai, github, google, cognito, azure, anthropic', () => {
      const expectedProviders: AuthProviderId[] = [
        'openai',
        'github',
        'google',
        'cognito',
        'azure',
        'anthropic',
      ];
      expectedProviders.forEach((provider) => {
        expect(isValidProviderId(provider)).toBe(true);
      });
    });
  });

  describe('invalid provider IDs', () => {
    it('should return false for unknown provider string', () => {
      expect(isValidProviderId('unknown')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(isValidProviderId('')).toBe(false);
    });

    it('should return false for null', () => {
      expect(isValidProviderId(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isValidProviderId(undefined)).toBe(false);
    });

    it('should return false for number', () => {
      expect(isValidProviderId(123)).toBe(false);
    });

    it('should return false for object', () => {
      expect(isValidProviderId({ id: 'openai' })).toBe(false);
    });

    it('should return false for array', () => {
      expect(isValidProviderId(['openai'])).toBe(false);
    });

    it('should return false for boolean', () => {
      expect(isValidProviderId(true)).toBe(false);
    });

    it('should return false for case-sensitive mismatch', () => {
      expect(isValidProviderId('OpenAI')).toBe(false);
      expect(isValidProviderId('GITHUB')).toBe(false);
      expect(isValidProviderId('Google')).toBe(false);
    });

    it('should return false for provider with extra whitespace', () => {
      expect(isValidProviderId(' openai')).toBe(false);
      expect(isValidProviderId('openai ')).toBe(false);
      expect(isValidProviderId(' openai ')).toBe(false);
    });
  });

  describe('type narrowing', () => {
    it('should narrow type to AuthProviderId when guard returns true', () => {
      const value: unknown = 'openai';
      if (isValidProviderId(value)) {
        // TypeScript should recognize value as AuthProviderId here
        const providerId: AuthProviderId = value;
        expect(providerId).toBe('openai');
      }
    });
  });
});

describe('isValidStorageBackend', () => {
  /**
   * Validates: Requirements 7.1 - Type definitions for storage backends
   */
  describe('valid storage backends', () => {
    it.each(VALID_STORAGE_BACKENDS)('should return true for valid storage backend: %s', (backend) => {
      expect(isValidStorageBackend(backend)).toBe(true);
    });

    it('should accept all supported backends: keychain, encrypted-file, memory', () => {
      const expectedBackends: StorageBackendType[] = [
        'keychain',
        'encrypted-file',
        'memory',
      ];
      expectedBackends.forEach((backend) => {
        expect(isValidStorageBackend(backend)).toBe(true);
      });
    });
  });

  describe('invalid storage backends', () => {
    it('should return false for unknown backend string', () => {
      expect(isValidStorageBackend('database')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(isValidStorageBackend('')).toBe(false);
    });

    it('should return false for null', () => {
      expect(isValidStorageBackend(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isValidStorageBackend(undefined)).toBe(false);
    });

    it('should return false for number', () => {
      expect(isValidStorageBackend(1)).toBe(false);
    });

    it('should return false for object', () => {
      expect(isValidStorageBackend({ type: 'keychain' })).toBe(false);
    });

    it('should return false for case-sensitive mismatch', () => {
      expect(isValidStorageBackend('Keychain')).toBe(false);
      expect(isValidStorageBackend('MEMORY')).toBe(false);
    });

    it('should return false for partial match', () => {
      expect(isValidStorageBackend('encrypted')).toBe(false);
      expect(isValidStorageBackend('file')).toBe(false);
    });
  });

  describe('type narrowing', () => {
    it('should narrow type to StorageBackendType when guard returns true', () => {
      const value: unknown = 'keychain';
      if (isValidStorageBackend(value)) {
        const backend: StorageBackendType = value;
        expect(backend).toBe('keychain');
      }
    });
  });
});

describe('isValidTokenStatus', () => {
  /**
   * Validates: Requirements 7.1 - Type definitions for token status
   */
  describe('valid token statuses', () => {
    it.each(VALID_TOKEN_STATUSES)('should return true for valid token status: %s', (status) => {
      expect(isValidTokenStatus(status)).toBe(true);
    });

    it('should accept all supported statuses: authenticated, expired, refresh-failed, not-configured', () => {
      const expectedStatuses: TokenStatus[] = [
        'authenticated',
        'expired',
        'refresh-failed',
        'not-configured',
      ];
      expectedStatuses.forEach((status) => {
        expect(isValidTokenStatus(status)).toBe(true);
      });
    });
  });

  describe('invalid token statuses', () => {
    it('should return false for unknown status string', () => {
      expect(isValidTokenStatus('pending')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(isValidTokenStatus('')).toBe(false);
    });

    it('should return false for null', () => {
      expect(isValidTokenStatus(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isValidTokenStatus(undefined)).toBe(false);
    });

    it('should return false for number', () => {
      expect(isValidTokenStatus(0)).toBe(false);
    });

    it('should return false for boolean', () => {
      expect(isValidTokenStatus(false)).toBe(false);
    });

    it('should return false for case-sensitive mismatch', () => {
      expect(isValidTokenStatus('Authenticated')).toBe(false);
      expect(isValidTokenStatus('EXPIRED')).toBe(false);
    });

    it('should return false for similar but incorrect values', () => {
      expect(isValidTokenStatus('auth')).toBe(false);
      expect(isValidTokenStatus('refreshFailed')).toBe(false);
      expect(isValidTokenStatus('not_configured')).toBe(false);
    });
  });

  describe('type narrowing', () => {
    it('should narrow type to TokenStatus when guard returns true', () => {
      const value: unknown = 'authenticated';
      if (isValidTokenStatus(value)) {
        const status: TokenStatus = value;
        expect(status).toBe('authenticated');
      }
    });
  });
});

describe('isValidErrorCode', () => {
  /**
   * Validates: Requirements 7.1 - Type definitions for error codes
   * Tests type narrowing for error codes as specified in the task.
   */
  describe('valid error codes', () => {
    it.each(VALID_ERROR_CODES)('should return true for valid error code: %s', (code) => {
      expect(isValidErrorCode(code)).toBe(true);
    });

    it('should accept all supported error codes', () => {
      const expectedCodes: AuthErrorCode[] = [
        'INVALID_STATE',
        'TIMEOUT',
        'NETWORK_ERROR',
        'INVALID_CREDENTIALS',
        'STORAGE_ERROR',
        'PROVIDER_ERROR',
        'UNSUPPORTED_PROVIDER',
        'CALLBACK_ERROR',
        'TOKEN_REFRESH_FAILED',
      ];
      expectedCodes.forEach((code) => {
        expect(isValidErrorCode(code)).toBe(true);
      });
    });
  });

  describe('invalid error codes', () => {
    it('should return false for unknown error code string', () => {
      expect(isValidErrorCode('UNKNOWN_ERROR')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(isValidErrorCode('')).toBe(false);
    });

    it('should return false for null', () => {
      expect(isValidErrorCode(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isValidErrorCode(undefined)).toBe(false);
    });

    it('should return false for number', () => {
      expect(isValidErrorCode(500)).toBe(false);
    });

    it('should return false for object', () => {
      expect(isValidErrorCode({ code: 'TIMEOUT' })).toBe(false);
    });

    it('should return false for case-sensitive mismatch', () => {
      expect(isValidErrorCode('invalid_state')).toBe(false);
      expect(isValidErrorCode('Timeout')).toBe(false);
      expect(isValidErrorCode('network_error')).toBe(false);
    });

    it('should return false for partial match', () => {
      expect(isValidErrorCode('INVALID')).toBe(false);
      expect(isValidErrorCode('ERROR')).toBe(false);
      expect(isValidErrorCode('REFRESH')).toBe(false);
    });

    it('should return false for error codes with extra characters', () => {
      expect(isValidErrorCode('TIMEOUT_ERROR')).toBe(false);
      expect(isValidErrorCode('_TIMEOUT')).toBe(false);
    });
  });

  describe('type narrowing for error codes', () => {
    it('should narrow type to AuthErrorCode when guard returns true', () => {
      const value: unknown = 'INVALID_STATE';
      if (isValidErrorCode(value)) {
        const errorCode: AuthErrorCode = value;
        expect(errorCode).toBe('INVALID_STATE');
      }
    });

    it('should allow switch statement exhaustiveness checking after narrowing', () => {
      const value: unknown = 'TIMEOUT';
      if (isValidErrorCode(value)) {
        // This demonstrates that TypeScript can use the narrowed type
        // in a switch statement for exhaustiveness checking
        let message: string;
        switch (value) {
          case 'INVALID_STATE':
            message = 'State mismatch';
            break;
          case 'TIMEOUT':
            message = 'Operation timed out';
            break;
          case 'NETWORK_ERROR':
            message = 'Network failure';
            break;
          case 'INVALID_CREDENTIALS':
            message = 'Bad credentials';
            break;
          case 'STORAGE_ERROR':
            message = 'Storage failure';
            break;
          case 'PROVIDER_ERROR':
            message = 'Provider error';
            break;
          case 'UNSUPPORTED_PROVIDER':
            message = 'Provider not supported';
            break;
          case 'CALLBACK_ERROR':
            message = 'Callback error';
            break;
          case 'TOKEN_REFRESH_FAILED':
            message = 'Token refresh failed';
            break;
          default: {
            // Exhaustiveness check: if all cases are handled, this should never be reached
            // TypeScript will error if a case is missing
            const _exhaustiveCheck: never = value;
            throw new Error(`Unhandled error code: ${_exhaustiveCheck}`);
          }
        }
        expect(message).toBe('Operation timed out');
      }
    });

    it('should handle all error codes in exhaustive switch', () => {
      // Test that all error codes are handled
      const errorCodeToMessage = (code: AuthErrorCode): string => {
        switch (code) {
          case 'INVALID_STATE':
            return 'State mismatch';
          case 'TIMEOUT':
            return 'Operation timed out';
          case 'NETWORK_ERROR':
            return 'Network failure';
          case 'INVALID_CREDENTIALS':
            return 'Bad credentials';
          case 'STORAGE_ERROR':
            return 'Storage failure';
          case 'PROVIDER_ERROR':
            return 'Provider error';
          case 'UNSUPPORTED_PROVIDER':
            return 'Provider not supported';
          case 'CALLBACK_ERROR':
            return 'Callback error';
          case 'TOKEN_REFRESH_FAILED':
            return 'Token refresh failed';
          default: {
            const _exhaustiveCheck: never = code;
            throw new Error(`Unhandled error code: ${_exhaustiveCheck}`);
          }
        }
      };

      // Verify all error codes return a message
      VALID_ERROR_CODES.forEach((code) => {
        expect(typeof errorCodeToMessage(code)).toBe('string');
      });
    });
  });
});

describe('constant arrays', () => {
  /**
   * Validates: Requirements 7.1 - Ensure constant arrays are properly defined
   */
  describe('VALID_PROVIDER_IDS', () => {
    it('should contain exactly 6 providers', () => {
      expect(VALID_PROVIDER_IDS).toHaveLength(6);
    });

    it('should contain the exact expected providers', () => {
      expect([...VALID_PROVIDER_IDS].sort()).toEqual([
        'anthropic',
        'azure',
        'cognito',
        'github',
        'google',
        'openai',
      ]);
    });

    it('should be readonly', () => {
      // TypeScript enforces this at compile time, but we can verify the array exists
      expect(Array.isArray(VALID_PROVIDER_IDS)).toBe(true);
    });
  });

  describe('VALID_STORAGE_BACKENDS', () => {
    it('should contain exactly 3 backends', () => {
      expect(VALID_STORAGE_BACKENDS).toHaveLength(3);
    });

    it('should contain the exact expected backends', () => {
      expect([...VALID_STORAGE_BACKENDS].sort()).toEqual([
        'encrypted-file',
        'keychain',
        'memory',
      ]);
    });
  });

  describe('VALID_TOKEN_STATUSES', () => {
    it('should contain exactly 4 statuses', () => {
      expect(VALID_TOKEN_STATUSES).toHaveLength(4);
    });

    it('should contain the exact expected statuses', () => {
      expect([...VALID_TOKEN_STATUSES].sort()).toEqual([
        'authenticated',
        'expired',
        'not-configured',
        'refresh-failed',
      ]);
    });
  });

  describe('VALID_ERROR_CODES', () => {
    it('should contain exactly 9 error codes', () => {
      expect(VALID_ERROR_CODES).toHaveLength(9);
    });

    it('should contain the exact expected error codes', () => {
      expect([...VALID_ERROR_CODES].sort()).toEqual([
        'CALLBACK_ERROR',
        'INVALID_CREDENTIALS',
        'INVALID_STATE',
        'NETWORK_ERROR',
        'PROVIDER_ERROR',
        'STORAGE_ERROR',
        'TIMEOUT',
        'TOKEN_REFRESH_FAILED',
        'UNSUPPORTED_PROVIDER',
      ]);
    });
  });
});
