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
 * Unit tests for error handling module.
 *
 * Tests error message formatting and sensitive data exclusion.
 *
 * **Validates: Requirements 13.1, 13.2, 13.3, 13.4, 13.5**
 *
 * @module errors.test
 */

import {
  AuthenticationError,
  InvalidStateError,
  TimeoutError,
  NetworkError,
  InvalidCredentialsError,
  StorageError,
  ProviderError,
  UnsupportedProviderError,
  CallbackError,
  TokenRefreshError,
  parseProviderErrorResponse,
  parseHttpErrorResponse,
  formatErrorResponse,
  createUnsupportedProviderError,
  createNetworkError,
  createStorageError,
  redactSensitiveData,
  isOAuthErrorResponse,
} from './errors.js';
import { VALID_PROVIDER_IDS } from './types.js';

describe('Error Handling Unit Tests', () => {
  describe('AuthenticationError base class', () => {
    it('should create error with code and message', () => {
      const error = new AuthenticationError('PROVIDER_ERROR', 'Test error message');

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(AuthenticationError);
      expect(error.code).toBe('PROVIDER_ERROR');
      expect(error.message).toBe('Test error message');
      expect(error.name).toBe('AuthenticationError');
    });

    it('should create error with details', () => {
      const error = new AuthenticationError('PROVIDER_ERROR', 'Test error', {
        providerId: 'github',
        endpoint: 'https://api.github.com',
      });

      expect(error.details).toEqual({
        providerId: 'github',
        endpoint: 'https://api.github.com',
      });
    });

    it('should convert to AuthError interface', () => {
      const error = new AuthenticationError('TIMEOUT', 'Operation timed out', {
        timeoutMs: 5000,
      });

      const authError = error.toAuthError();

      expect(authError).toEqual({
        code: 'TIMEOUT',
        message: 'Operation timed out',
        details: { timeoutMs: 5000 },
      });
    });

    it('should redact sensitive data from message', () => {
      const error = new AuthenticationError(
        'PROVIDER_ERROR',
        'Failed with access_token=secret123'
      );

      expect(error.message).not.toContain('secret123');
      expect(error.message).toContain('[REDACTED]');
    });

    it('should sanitize sensitive data from details', () => {
      const error = new AuthenticationError('PROVIDER_ERROR', 'Test error', {
        accessToken: 'secret-token',
        providerId: 'github',
      });

      expect(error.details?.accessToken).toBe('[REDACTED]');
      expect(error.details?.providerId).toBe('github');
    });
  });

  describe('Specific error classes', () => {
    describe('InvalidStateError', () => {
      it('should create with default message', () => {
        const error = new InvalidStateError();

        expect(error.code).toBe('INVALID_STATE');
        expect(error.message).toBe('State parameter validation failed');
        expect(error.name).toBe('InvalidStateError');
      });

      it('should create with custom message', () => {
        const error = new InvalidStateError('Custom state error');

        expect(error.code).toBe('INVALID_STATE');
        expect(error.message).toBe('Custom state error');
      });
    });

    describe('TimeoutError', () => {
      it('should create with default message', () => {
        const error = new TimeoutError();

        expect(error.code).toBe('TIMEOUT');
        expect(error.message).toBe('Operation timed out');
        expect(error.name).toBe('TimeoutError');
      });

      it('should create with custom message and details', () => {
        const error = new TimeoutError('Auth flow timed out', { timeoutMs: 300000 });

        expect(error.code).toBe('TIMEOUT');
        expect(error.message).toBe('Auth flow timed out');
        expect(error.details).toEqual({ timeoutMs: 300000 });
      });
    });

    describe('NetworkError', () => {
      it('should create with message only', () => {
        const error = new NetworkError('Connection refused');

        expect(error.code).toBe('NETWORK_ERROR');
        expect(error.message).toBe('Connection refused');
        expect(error.name).toBe('NetworkError');
        expect(error.details).toBeUndefined();
      });

      it('should create with endpoint', () => {
        const error = new NetworkError(
          'Failed to connect',
          'https://auth.openai.com/token'
        );

        expect(error.code).toBe('NETWORK_ERROR');
        expect(error.details).toEqual({
          endpoint: 'https://auth.openai.com/token',
        });
      });
    });

    describe('InvalidCredentialsError', () => {
      it('should create with default message', () => {
        const error = new InvalidCredentialsError();

        expect(error.code).toBe('INVALID_CREDENTIALS');
        expect(error.message).toBe('Invalid credentials');
        expect(error.name).toBe('InvalidCredentialsError');
      });
    });

    describe('StorageError', () => {
      it('should create with message only', () => {
        const error = new StorageError('Failed to store credentials');

        expect(error.code).toBe('STORAGE_ERROR');
        expect(error.message).toBe('Failed to store credentials');
        expect(error.name).toBe('StorageError');
      });

      it('should create with backend information', () => {
        const error = new StorageError('Keychain access denied', 'keychain');

        expect(error.code).toBe('STORAGE_ERROR');
        expect(error.details).toEqual({ backend: 'keychain' });
      });
    });

    describe('ProviderError', () => {
      it('should create with message only', () => {
        const error = new ProviderError('Provider returned error');

        expect(error.code).toBe('PROVIDER_ERROR');
        expect(error.message).toBe('Provider returned error');
        expect(error.name).toBe('ProviderError');
      });

      it('should create with OAuth error details', () => {
        const error = new ProviderError('Authentication failed', {
          errorCode: 'invalid_grant',
          errorDescription: 'The authorization code has expired',
          providerId: 'github',
        });

        expect(error.code).toBe('PROVIDER_ERROR');
        expect(error.details).toEqual({
          errorCode: 'invalid_grant',
          errorDescription: 'The authorization code has expired',
          providerId: 'github',
        });
      });
    });

    describe('UnsupportedProviderError', () => {
      it('should include supported providers list', () => {
        const error = new UnsupportedProviderError('invalid-provider');

        expect(error.code).toBe('UNSUPPORTED_PROVIDER');
        expect(error.message).toContain('invalid-provider');
        expect(error.message).toContain('not supported');
        expect(error.name).toBe('UnsupportedProviderError');

        expect(error.details?.providerId).toBe('invalid-provider');
        expect(error.details?.supportedProviders).toEqual([...VALID_PROVIDER_IDS]);
      });
    });

    describe('CallbackError', () => {
      it('should create with message', () => {
        const error = new CallbackError('Callback server failed to start');

        expect(error.code).toBe('CALLBACK_ERROR');
        expect(error.message).toBe('Callback server failed to start');
        expect(error.name).toBe('CallbackError');
      });

      it('should create with details', () => {
        const error = new CallbackError('Port binding failed', { port: 8080 });

        expect(error.details).toEqual({ port: 8080 });
      });
    });

    describe('TokenRefreshError', () => {
      it('should create with default message', () => {
        const error = new TokenRefreshError();

        expect(error.code).toBe('TOKEN_REFRESH_FAILED');
        expect(error.message).toBe('Token refresh failed');
        expect(error.name).toBe('TokenRefreshError');
      });

      it('should create with provider ID', () => {
        const error = new TokenRefreshError('Refresh token expired', 'github');

        expect(error.code).toBe('TOKEN_REFRESH_FAILED');
        expect(error.details).toEqual({ providerId: 'github' });
      });
    });
  });

  describe('Provider error response parsing', () => {
    describe('parseProviderErrorResponse', () => {
      it('should parse standard OAuth error response', () => {
        const response = {
          error: 'invalid_grant',
          error_description: 'The authorization code has expired',
        };

        const result = parseProviderErrorResponse(response, 'github');

        expect(result.code).toBe('PROVIDER_ERROR');
        expect(result.message).toContain('invalid_grant');
        expect(result.message).toContain('The authorization code has expired');
        expect(result.details?.errorCode).toBe('invalid_grant');
        expect(result.details?.errorDescription).toBe('The authorization code has expired');
        expect(result.details?.providerId).toBe('github');
      });

      it('should parse OAuth error with error_uri', () => {
        const response = {
          error: 'invalid_request',
          error_description: 'Missing required parameter',
          error_uri: 'https://docs.example.com/errors/invalid_request',
        };

        const result = parseProviderErrorResponse(response);

        expect(result.details?.errorUri).toBe('https://docs.example.com/errors/invalid_request');
      });

      it('should parse string error response', () => {
        const result = parseProviderErrorResponse('Something went wrong', 'openai');

        expect(result.code).toBe('PROVIDER_ERROR');
        expect(result.message).toBe('Something went wrong');
        expect(result.details?.providerId).toBe('openai');
      });

      it('should parse JSON string error response', () => {
        const jsonString = JSON.stringify({
          error: 'access_denied',
          error_description: 'User denied access',
        });

        const result = parseProviderErrorResponse(jsonString);

        expect(result.code).toBe('PROVIDER_ERROR');
        expect(result.details?.errorCode).toBe('access_denied');
      });

      it('should handle object with message field', () => {
        const response = { message: 'Internal server error' };

        const result = parseProviderErrorResponse(response);

        expect(result.code).toBe('PROVIDER_ERROR');
        expect(result.message).toBe('Internal server error');
      });

      it('should handle object with error_message field', () => {
        const response = { error_message: 'Rate limit exceeded' };

        const result = parseProviderErrorResponse(response);

        expect(result.code).toBe('PROVIDER_ERROR');
        expect(result.message).toBe('Rate limit exceeded');
      });

      it('should handle null response', () => {
        const result = parseProviderErrorResponse(null);

        expect(result.code).toBe('PROVIDER_ERROR');
        expect(result.message).toBe('Unknown provider error');
      });

      it('should handle undefined response', () => {
        const result = parseProviderErrorResponse(undefined);

        expect(result.code).toBe('PROVIDER_ERROR');
        expect(result.message).toBe('Unknown provider error');
      });

      it('should redact sensitive data from error response', () => {
        const response = {
          error: 'invalid_token',
          error_description: 'Token access_token=secret123 is invalid',
        };

        const result = parseProviderErrorResponse(response);

        expect(result.message).not.toContain('secret123');
        expect(result.message).toContain('[REDACTED]');
      });
    });

    describe('parseHttpErrorResponse', () => {
      it('should include HTTP status in error message', () => {
        const result = parseHttpErrorResponse(401, { error: 'unauthorized' }, 'github');

        expect(result.message).toContain('HTTP 401');
        expect(result.message).toContain('Unauthorized');
        expect(result.details?.httpStatus).toBe(401);
      });

      it('should handle 400 Bad Request', () => {
        const result = parseHttpErrorResponse(400, { error: 'invalid_request' });

        expect(result.message).toContain('HTTP 400');
        expect(result.message).toContain('Bad Request');
      });

      it('should handle 403 Forbidden', () => {
        const result = parseHttpErrorResponse(403, { error: 'access_denied' });

        expect(result.message).toContain('HTTP 403');
        expect(result.message).toContain('Forbidden');
      });

      it('should handle 429 Too Many Requests', () => {
        const result = parseHttpErrorResponse(429, { error: 'rate_limited' });

        expect(result.message).toContain('HTTP 429');
        expect(result.message).toContain('Too Many Requests');
      });

      it('should handle 500 Internal Server Error', () => {
        const result = parseHttpErrorResponse(500, { error: 'server_error' });

        expect(result.message).toContain('HTTP 500');
        expect(result.message).toContain('Internal Server Error');
      });

      it('should handle unknown status codes', () => {
        const result = parseHttpErrorResponse(418, { error: 'teapot' });

        expect(result.message).toContain('HTTP 418');
        expect(result.message).toContain('Error');
      });
    });

    describe('isOAuthErrorResponse', () => {
      it('should return true for valid OAuth error response', () => {
        expect(isOAuthErrorResponse({ error: 'invalid_grant' })).toBe(true);
        expect(isOAuthErrorResponse({
          error: 'invalid_request',
          error_description: 'Missing parameter',
        })).toBe(true);
      });

      it('should return false for invalid responses', () => {
        expect(isOAuthErrorResponse(null)).toBe(false);
        expect(isOAuthErrorResponse(undefined)).toBe(false);
        expect(isOAuthErrorResponse('string')).toBe(false);
        expect(isOAuthErrorResponse(123)).toBe(false);
        expect(isOAuthErrorResponse({})).toBe(false);
        expect(isOAuthErrorResponse({ message: 'error' })).toBe(false);
        expect(isOAuthErrorResponse({ error: 123 })).toBe(false);
      });
    });
  });

  describe('Error response formatting', () => {
    describe('formatErrorResponse', () => {
      it('should format AuthenticationError', () => {
        const error = new ProviderError('Test error', { providerId: 'github' });
        const formatted = formatErrorResponse(error);

        expect(formatted.code).toBe('PROVIDER_ERROR');
        expect(formatted.message).toBe('Test error');
        expect(formatted.details?.providerId).toBe('github');
      });

      it('should format standard Error', () => {
        const error = new Error('Standard error message');
        const formatted = formatErrorResponse(error);

        expect(formatted.code).toBe('PROVIDER_ERROR');
        expect(formatted.message).toBe('Standard error message');
      });

      it('should format AuthError object', () => {
        const authError = {
          code: 'TIMEOUT' as const,
          message: 'Operation timed out',
          details: { timeoutMs: 5000 },
        };
        const formatted = formatErrorResponse(authError);

        expect(formatted.code).toBe('TIMEOUT');
        expect(formatted.message).toBe('Operation timed out');
        expect(formatted.details?.timeoutMs).toBe(5000);
      });

      it('should format string error', () => {
        const formatted = formatErrorResponse('String error message');

        expect(formatted.code).toBe('PROVIDER_ERROR');
        expect(formatted.message).toBe('String error message');
      });

      it('should handle unknown error types', () => {
        const formatted = formatErrorResponse({ unknown: 'object' });

        expect(formatted.code).toBe('PROVIDER_ERROR');
        expect(formatted.message).toBe('An unknown error occurred');
      });

      it('should redact sensitive data from Error message', () => {
        const error = new Error('Failed with access_token=secret123');
        const formatted = formatErrorResponse(error);

        expect(formatted.message).not.toContain('secret123');
        expect(formatted.message).toContain('[REDACTED]');
      });

      it('should sanitize sensitive data from details', () => {
        const authError = {
          code: 'PROVIDER_ERROR' as const,
          message: 'Error',
          details: {
            accessToken: 'secret-token',
            refreshToken: 'refresh-secret',
            providerId: 'github',
          },
        };
        const formatted = formatErrorResponse(authError);

        expect(formatted.details?.accessToken).toBe('[REDACTED]');
        expect(formatted.details?.refreshToken).toBe('[REDACTED]');
        expect(formatted.details?.providerId).toBe('github');
      });
    });

    describe('createUnsupportedProviderError', () => {
      it('should create error with supported providers list', () => {
        const error = createUnsupportedProviderError('invalid-provider');

        expect(error.code).toBe('UNSUPPORTED_PROVIDER');
        expect(error.message).toContain('invalid-provider');
        expect(error.details?.supportedProviders).toEqual([...VALID_PROVIDER_IDS]);
      });
    });

    describe('createNetworkError', () => {
      it('should create error with endpoint', () => {
        const error = createNetworkError('Connection failed', 'https://api.example.com');

        expect(error.code).toBe('NETWORK_ERROR');
        expect(error.message).toBe('Connection failed');
        expect(error.details?.endpoint).toBe('https://api.example.com');
      });

      it('should create error without endpoint', () => {
        const error = createNetworkError('Network unavailable');

        expect(error.code).toBe('NETWORK_ERROR');
        expect(error.details).toBeUndefined();
      });
    });

    describe('createStorageError', () => {
      it('should create error with backend', () => {
        const error = createStorageError('Storage failed', 'keychain');

        expect(error.code).toBe('STORAGE_ERROR');
        expect(error.message).toBe('Storage failed');
        expect(error.details?.backend).toBe('keychain');
      });

      it('should create error without backend', () => {
        const error = createStorageError('Storage unavailable');

        expect(error.code).toBe('STORAGE_ERROR');
        expect(error.details).toBeUndefined();
      });
    });
  });

  describe('Sensitive data redaction', () => {
    describe('redactSensitiveData', () => {
      it('should redact access_token', () => {
        const input = 'Error: access_token=abc123xyz';
        const result = redactSensitiveData(input);

        expect(result).not.toContain('abc123xyz');
        expect(result).toContain('access_token=[REDACTED]');
      });

      it('should redact refresh_token', () => {
        const input = 'Error: refresh_token=refresh123';
        const result = redactSensitiveData(input);

        expect(result).not.toContain('refresh123');
        expect(result).toContain('refresh_token=[REDACTED]');
      });

      it('should redact client_secret', () => {
        const input = 'Error: client_secret=secret456';
        const result = redactSensitiveData(input);

        expect(result).not.toContain('secret456');
        expect(result).toContain('client_secret=[REDACTED]');
      });

      it('should redact Bearer tokens', () => {
        const input = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
        const result = redactSensitiveData(input);

        expect(result).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
        expect(result).toContain('[REDACTED]');
      });

      it('should redact api_key', () => {
        const input = 'Error: api_key=sk-1234567890';
        const result = redactSensitiveData(input);

        expect(result).not.toContain('sk-1234567890');
        expect(result).toContain('api_key=[REDACTED]');
      });

      it('should redact code_verifier', () => {
        const input = 'Error: code_verifier=dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
        const result = redactSensitiveData(input);

        expect(result).not.toContain('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk');
        expect(result).toContain('code_verifier=[REDACTED]');
      });

      it('should redact password', () => {
        const input = 'Error: password=mySecretPassword123';
        const result = redactSensitiveData(input);

        expect(result).not.toContain('mySecretPassword123');
        expect(result).toContain('password=[REDACTED]');
      });

      it('should redact multiple sensitive values', () => {
        const input = 'Error: access_token=token1 refresh_token=token2 client_secret=secret1';
        const result = redactSensitiveData(input);

        expect(result).not.toContain('token1');
        expect(result).not.toContain('token2');
        expect(result).not.toContain('secret1');
        expect(result).toContain('[REDACTED]');
      });

      it('should preserve non-sensitive data', () => {
        const input = 'Error: providerId=github endpoint=https://api.github.com';
        const result = redactSensitiveData(input);

        expect(result).toContain('providerId=github');
        expect(result).toContain('endpoint=https://api.github.com');
      });

      it('should handle quoted values', () => {
        const input = 'Error: access_token="secret123"';
        const result = redactSensitiveData(input);

        expect(result).not.toContain('secret123');
        expect(result).toContain('[REDACTED]');
      });

      it('should handle colon-separated values', () => {
        const input = 'Error: access_token: secret123';
        const result = redactSensitiveData(input);

        expect(result).not.toContain('secret123');
        expect(result).toContain('[REDACTED]');
      });

      it('should handle empty string', () => {
        const result = redactSensitiveData('');
        expect(result).toBe('');
      });

      it('should handle string without sensitive data', () => {
        const input = 'Normal error message without secrets';
        const result = redactSensitiveData(input);
        expect(result).toBe(input);
      });
    });
  });
});
