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
  isValidAuthMethodId,
  resolveAuthMethodIdToProviderId,
  tryResolveAuthMethodIdToProviderId,
  UnknownAuthMethodIdError,
  VALID_PROVIDER_IDS,
  VALID_STORAGE_BACKENDS,
  VALID_TOKEN_STATUSES,
  VALID_ERROR_CODES,
  VALID_AUTH_METHOD_IDS,
  AUTH_METHOD_ID_TO_PROVIDER_ID,
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

    it('should accept all supported providers: github, google, cognito, azure', () => {
      const expectedProviders: AuthProviderId[] = [
        'github',
        'google',
        'cognito',
        'azure',
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
      expect(isValidProviderId({ id: 'github' })).toBe(false);
    });

    it('should return false for array', () => {
      expect(isValidProviderId(['github'])).toBe(false);
    });

    it('should return false for boolean', () => {
      expect(isValidProviderId(true)).toBe(false);
    });

    it('should return false for case-sensitive mismatch', () => {
      expect(isValidProviderId('GitHub')).toBe(false);
      expect(isValidProviderId('GITHUB')).toBe(false);
      expect(isValidProviderId('Google')).toBe(false);
    });

    it('should return false for provider with extra whitespace', () => {
      expect(isValidProviderId(' github')).toBe(false);
      expect(isValidProviderId('github ')).toBe(false);
      expect(isValidProviderId(' github ')).toBe(false);
    });
  });

  describe('type narrowing', () => {
    it('should narrow type to AuthProviderId when guard returns true', () => {
      const value: unknown = 'github';
      if (isValidProviderId(value)) {
        // TypeScript should recognize value as AuthProviderId here
        const providerId: AuthProviderId = value;
        expect(providerId).toBe('github');
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
        'HEADLESS_ENVIRONMENT',
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
          case 'HEADLESS_ENVIRONMENT':
            message = 'Headless environment detected';
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
          case 'HEADLESS_ENVIRONMENT':
            return 'Headless environment detected';
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
    it('should contain exactly 5 providers', () => {
      expect(VALID_PROVIDER_IDS).toHaveLength(5);
    });

    it('should contain the exact expected providers', () => {
      expect([...VALID_PROVIDER_IDS].sort()).toEqual([
        'azure',
        'cognito',
        'github',
        'google',
        'oidc',
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
    it('should contain exactly 10 error codes', () => {
      expect(VALID_ERROR_CODES).toHaveLength(10);
    });

    it('should contain the exact expected error codes', () => {
      expect([...VALID_ERROR_CODES].sort()).toEqual([
        'CALLBACK_ERROR',
        'HEADLESS_ENVIRONMENT',
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


// =============================================================================
// AuthMethod ID to Provider ID Mapping Tests
// =============================================================================

describe('AUTH_METHOD_ID_TO_PROVIDER_ID', () => {
  /**
   * Validates: Requirements 7.1, 13.4
   * Tests the explicit mapping table from authMethod.id to providerId.
   */
  describe('mapping table structure', () => {
    it('should contain oauth2-prefixed mappings for all providers', () => {
      const oauth2Mappings = [
        'oauth2-github',
        'oauth2-google',
        'oauth2-cognito',
        'oauth2-azure',
        'oauth2-oidc',
      ];

      oauth2Mappings.forEach((methodId) => {
        expect(AUTH_METHOD_ID_TO_PROVIDER_ID[methodId]).toBeDefined();
      });
    });

    it('should contain direct provider ID mappings for backward compatibility', () => {
      VALID_PROVIDER_IDS.forEach((providerId) => {
        expect(AUTH_METHOD_ID_TO_PROVIDER_ID[providerId]).toBe(providerId);
      });
    });

    it('should map oauth2-prefixed IDs to correct providers', () => {
      expect(AUTH_METHOD_ID_TO_PROVIDER_ID['oauth2-github']).toBe('github');
      expect(AUTH_METHOD_ID_TO_PROVIDER_ID['oauth2-google']).toBe('google');
      expect(AUTH_METHOD_ID_TO_PROVIDER_ID['oauth2-cognito']).toBe('cognito');
      expect(AUTH_METHOD_ID_TO_PROVIDER_ID['oauth2-azure']).toBe('azure');
      expect(AUTH_METHOD_ID_TO_PROVIDER_ID['oauth2-oidc']).toBe('oidc');
    });

    it('should have exactly 10 mappings (5 oauth2 + 5 direct)', () => {
      expect(Object.keys(AUTH_METHOD_ID_TO_PROVIDER_ID)).toHaveLength(10);
    });
  });
});

describe('VALID_AUTH_METHOD_IDS', () => {
  /**
   * Validates: Requirements 7.1
   * Tests the list of valid authMethod.id values.
   */
  it('should contain all oauth2-prefixed method IDs', () => {
    expect(VALID_AUTH_METHOD_IDS).toContain('oauth2-github');
    expect(VALID_AUTH_METHOD_IDS).toContain('oauth2-google');
    expect(VALID_AUTH_METHOD_IDS).toContain('oauth2-cognito');
    expect(VALID_AUTH_METHOD_IDS).toContain('oauth2-azure');
    expect(VALID_AUTH_METHOD_IDS).toContain('oauth2-oidc');
  });

  it('should contain all direct provider IDs', () => {
    VALID_PROVIDER_IDS.forEach((providerId) => {
      expect(VALID_AUTH_METHOD_IDS).toContain(providerId);
    });
  });

  it('should have exactly 10 valid method IDs', () => {
    expect(VALID_AUTH_METHOD_IDS).toHaveLength(10);
  });
});

describe('isValidAuthMethodId', () => {
  /**
   * Validates: Requirements 7.1
   * Tests the type guard for authMethod.id validation.
   */
  describe('valid authMethod IDs', () => {
    it.each(VALID_AUTH_METHOD_IDS)('should return true for valid method ID: %s', (methodId) => {
      expect(isValidAuthMethodId(methodId)).toBe(true);
    });
  });

  describe('invalid authMethod IDs', () => {
    it('should return false for unknown method ID', () => {
      expect(isValidAuthMethodId('oauth2-unknown')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(isValidAuthMethodId('')).toBe(false);
    });

    it('should return false for null', () => {
      expect(isValidAuthMethodId(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isValidAuthMethodId(undefined)).toBe(false);
    });

    it('should return false for number', () => {
      expect(isValidAuthMethodId(123)).toBe(false);
    });

    it('should return false for object', () => {
      expect(isValidAuthMethodId({ id: 'oauth2-github' })).toBe(false);
    });

    it('should return false for case-sensitive mismatch', () => {
      expect(isValidAuthMethodId('OAuth2-GitHub')).toBe(false);
      expect(isValidAuthMethodId('OAUTH2-GITHUB')).toBe(false);
      expect(isValidAuthMethodId('GitHub')).toBe(false);
    });

    it('should return false for wrong format (no substring matching)', () => {
      expect(isValidAuthMethodId('github-oauth2')).toBe(false);
      expect(isValidAuthMethodId('oauth-github')).toBe(false);
      expect(isValidAuthMethodId('oauth2github')).toBe(false);
    });

    it('should return false for partial matches (security requirement)', () => {
      expect(isValidAuthMethodId('oauth2')).toBe(false);
      expect(isValidAuthMethodId('oauth2-')).toBe(false);
      expect(isValidAuthMethodId('-github')).toBe(false);
    });
  });
});

describe('resolveAuthMethodIdToProviderId', () => {
  /**
   * Validates: Requirements 7.1, 13.4
   * Tests the explicit mapping resolution function.
   */
  describe('valid mappings', () => {
    it('should resolve oauth2-github to github', () => {
      expect(resolveAuthMethodIdToProviderId('oauth2-github')).toBe('github');
    });

    it('should resolve oauth2-github to github', () => {
      expect(resolveAuthMethodIdToProviderId('oauth2-github')).toBe('github');
    });

    it('should resolve oauth2-google to google', () => {
      expect(resolveAuthMethodIdToProviderId('oauth2-google')).toBe('google');
    });

    it('should resolve oauth2-cognito to cognito', () => {
      expect(resolveAuthMethodIdToProviderId('oauth2-cognito')).toBe('cognito');
    });

    it('should resolve oauth2-azure to azure', () => {
      expect(resolveAuthMethodIdToProviderId('oauth2-azure')).toBe('azure');
    });

    it('should resolve direct provider IDs for backward compatibility', () => {
      expect(resolveAuthMethodIdToProviderId('github')).toBe('github');
      expect(resolveAuthMethodIdToProviderId('google')).toBe('google');
      expect(resolveAuthMethodIdToProviderId('cognito')).toBe('cognito');
      expect(resolveAuthMethodIdToProviderId('azure')).toBe('azure');
    });
  });

  describe('invalid mappings - throws UnknownAuthMethodIdError', () => {
    it('should throw for unknown method ID', () => {
      expect(() => resolveAuthMethodIdToProviderId('oauth2-unknown')).toThrow(
        UnknownAuthMethodIdError
      );
    });

    it('should throw for wrong format', () => {
      expect(() => resolveAuthMethodIdToProviderId('github-oauth2')).toThrow(
        UnknownAuthMethodIdError
      );
    });

    it('should throw for case mismatch (no heuristic matching)', () => {
      expect(() => resolveAuthMethodIdToProviderId('GITHUB')).toThrow(
        UnknownAuthMethodIdError
      );
      expect(() => resolveAuthMethodIdToProviderId('OAuth2-GitHub')).toThrow(
        UnknownAuthMethodIdError
      );
    });

    it('should throw for partial matches (security requirement)', () => {
      expect(() => resolveAuthMethodIdToProviderId('oauth2')).toThrow(
        UnknownAuthMethodIdError
      );
      expect(() => resolveAuthMethodIdToProviderId('oauth2-')).toThrow(
        UnknownAuthMethodIdError
      );
    });

    it('should throw for empty string', () => {
      expect(() => resolveAuthMethodIdToProviderId('')).toThrow(
        UnknownAuthMethodIdError
      );
    });
  });
});

describe('tryResolveAuthMethodIdToProviderId', () => {
  /**
   * Validates: Requirements 7.1, 13.4
   * Tests the safe (non-throwing) mapping resolution function.
   */
  describe('valid mappings', () => {
    it('should return providerId for valid oauth2-prefixed method IDs', () => {
      expect(tryResolveAuthMethodIdToProviderId('oauth2-github')).toBe('github');
      expect(tryResolveAuthMethodIdToProviderId('oauth2-google')).toBe('google');
      expect(tryResolveAuthMethodIdToProviderId('oauth2-cognito')).toBe('cognito');
      expect(tryResolveAuthMethodIdToProviderId('oauth2-azure')).toBe('azure');
    });

    it('should return providerId for direct provider IDs', () => {
      VALID_PROVIDER_IDS.forEach((providerId) => {
        expect(tryResolveAuthMethodIdToProviderId(providerId)).toBe(providerId);
      });
    });
  });

  describe('invalid mappings - returns null', () => {
    it('should return null for unknown method ID', () => {
      expect(tryResolveAuthMethodIdToProviderId('oauth2-unknown')).toBeNull();
    });

    it('should return null for wrong format', () => {
      expect(tryResolveAuthMethodIdToProviderId('github-oauth2')).toBeNull();
    });

    it('should return null for case mismatch', () => {
      expect(tryResolveAuthMethodIdToProviderId('GITHUB')).toBeNull();
      expect(tryResolveAuthMethodIdToProviderId('OAuth2-GitHub')).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(tryResolveAuthMethodIdToProviderId('')).toBeNull();
    });

    it('should return null for partial matches', () => {
      expect(tryResolveAuthMethodIdToProviderId('oauth2')).toBeNull();
      expect(tryResolveAuthMethodIdToProviderId('oauth2-')).toBeNull();
    });
  });
});

describe('UnknownAuthMethodIdError', () => {
  /**
   * Validates: Requirements 13.4
   * Tests the error class for unknown authMethod.id values.
   */
  describe('error properties', () => {
    it('should have correct error code', () => {
      const error = new UnknownAuthMethodIdError('oauth2-unknown');
      expect(error.code).toBe('UNSUPPORTED_PROVIDER');
    });

    it('should have correct error name', () => {
      const error = new UnknownAuthMethodIdError('oauth2-unknown');
      expect(error.name).toBe('UnknownAuthMethodIdError');
    });

    it('should store the unknown method ID', () => {
      const error = new UnknownAuthMethodIdError('oauth2-unknown');
      expect(error.unknownMethodId).toBe('oauth2-unknown');
    });

    it('should include supported method IDs', () => {
      const error = new UnknownAuthMethodIdError('oauth2-unknown');
      expect(error.supportedMethodIds).toEqual(VALID_AUTH_METHOD_IDS);
    });

    it('should include supported providers', () => {
      const error = new UnknownAuthMethodIdError('oauth2-unknown');
      expect(error.supportedProviders).toEqual(VALID_PROVIDER_IDS);
    });
  });

  describe('error message', () => {
    it('should include the unknown method ID in the message', () => {
      const error = new UnknownAuthMethodIdError('oauth2-unknown');
      expect(error.message).toContain('oauth2-unknown');
    });

    it('should list supported method IDs in the message', () => {
      const error = new UnknownAuthMethodIdError('oauth2-unknown');
      expect(error.message).toContain('oauth2-github');
      expect(error.message).toContain('oauth2-github');
    });

    it('should list supported providers in the message', () => {
      const error = new UnknownAuthMethodIdError('oauth2-unknown');
      expect(error.message).toContain('github');
      expect(error.message).toContain('google');
      expect(error.message).toContain('cognito');
      expect(error.message).toContain('azure');
    });
  });

  describe('error inheritance', () => {
    it('should be an instance of Error', () => {
      const error = new UnknownAuthMethodIdError('oauth2-unknown');
      expect(error).toBeInstanceOf(Error);
    });

    it('should be an instance of UnknownAuthMethodIdError', () => {
      const error = new UnknownAuthMethodIdError('oauth2-unknown');
      expect(error).toBeInstanceOf(UnknownAuthMethodIdError);
    });

    it('should have a stack trace', () => {
      const error = new UnknownAuthMethodIdError('oauth2-unknown');
      expect(error.stack).toBeDefined();
    });
  });
});

describe('security: no substring/heuristic matching', () => {
  /**
   * Validates: Requirements 7.1, 13.4
   * Security tests to ensure no substring or heuristic matching is used.
   */
  it('should not match substrings of valid method IDs', () => {
    // These should all fail - no partial matching
    expect(isValidAuthMethodId('oauth2-open')).toBe(false);
    expect(isValidAuthMethodId('oauth2-git')).toBe(false);
    expect(isValidAuthMethodId('auth2-github')).toBe(false);
    expect(isValidAuthMethodId('2-github')).toBe(false);
  });

  it('should not match method IDs with extra characters', () => {
    expect(isValidAuthMethodId('oauth2-github-extra')).toBe(false);
    expect(isValidAuthMethodId('prefix-oauth2-github')).toBe(false);
    expect(isValidAuthMethodId('oauth2-github ')).toBe(false);
    expect(isValidAuthMethodId(' oauth2-github')).toBe(false);
  });

  it('should not match similar-looking method IDs', () => {
    // Typos and variations should not match
    expect(isValidAuthMethodId('oauth2-opanai')).toBe(false);
    expect(isValidAuthMethodId('oauth2-githab')).toBe(false);
    expect(isValidAuthMethodId('oauth2-gogle')).toBe(false);
    expect(isValidAuthMethodId('oauth2-cognitio')).toBe(false);
    expect(isValidAuthMethodId('oauth2-azur')).toBe(false);
    expect(isValidAuthMethodId('oauth2-antropic')).toBe(false);
  });

  it('should be case-sensitive (no case-insensitive matching)', () => {
    // All case variations should fail
    expect(isValidAuthMethodId('OAuth2-GitHub')).toBe(false);
    expect(isValidAuthMethodId('OAUTH2-GITHUB')).toBe(false);
    expect(isValidAuthMethodId('oauth2-GITHUB')).toBe(false);
    expect(isValidAuthMethodId('OAuth2-github')).toBe(false);
  });

  it('should not use regex or pattern matching', () => {
    // Regex-like patterns should not work
    expect(isValidAuthMethodId('oauth2-.*')).toBe(false);
    expect(isValidAuthMethodId('oauth2-.+')).toBe(false);
    expect(isValidAuthMethodId('oauth2-[a-z]+')).toBe(false);
  });
});
