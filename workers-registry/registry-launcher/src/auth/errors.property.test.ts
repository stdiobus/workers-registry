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
 * Property-based tests for error handling module.
 *
 * Feature: oauth-authentication
 * Properties 29-30: Error Handling
 *
 * @module errors.property.test
 */

import * as fc from 'fast-check';
import {
  parseProviderErrorResponse,
  createUnsupportedProviderError,
  formatErrorResponse,
  redactSensitiveData,
  AuthenticationError,
  ProviderError,
  UnsupportedProviderError,
} from './errors.js';
import { VALID_PROVIDER_IDS } from './types.js';
import type { AuthProviderId } from './types.js';

/**
 * Arbitrary for generating valid OAuth error codes.
 */
const oauthErrorCodeArb = fc.constantFrom(
  'invalid_request',
  'unauthorized_client',
  'access_denied',
  'unsupported_response_type',
  'invalid_scope',
  'server_error',
  'temporarily_unavailable',
  'invalid_client',
  'invalid_grant',
  'unsupported_grant_type'
);

/**
 * Arbitrary for generating valid provider IDs.
 */
const providerIdArb = fc.constantFrom(...VALID_PROVIDER_IDS) as fc.Arbitrary<AuthProviderId>;

/**
 * Arbitrary for generating OAuth error response objects.
 */
const oauthErrorResponseArb = fc.record({
  error: oauthErrorCodeArb,
  error_description: fc.option(fc.string({ minLength: 1, maxLength: 200 }), { nil: undefined }),
  error_uri: fc.option(fc.webUrl(), { nil: undefined }),
});

/**
 * Arbitrary for generating invalid provider IDs.
 */
const invalidProviderIdArb = fc.string({ minLength: 1, maxLength: 50 }).filter(
  (s) => !VALID_PROVIDER_IDS.includes(s as AuthProviderId)
);

describe('Error Handling Property Tests', () => {
  /**
   * Feature: oauth-authentication, Property 29: Provider Error Parsing
   *
   * *For any* OAuth error response from a provider, the auth module SHALL parse
   * the error into a structured AuthError with code and message.
   *
   * **Validates: Requirements 13.1**
   */
  describe('Property 29: Provider Error Parsing', () => {
    test('parses OAuth error response into structured AuthError', () => {
      fc.assert(
        fc.property(
          oauthErrorResponseArb,
          providerIdArb,
          (errorResponse, providerId) => {
            const result = parseProviderErrorResponse(errorResponse, providerId);

            // Result should have required AuthError fields
            expect(result).toHaveProperty('code');
            expect(result).toHaveProperty('message');
            expect(typeof result.code).toBe('string');
            expect(typeof result.message).toBe('string');

            // Code should be PROVIDER_ERROR for OAuth errors
            expect(result.code).toBe('PROVIDER_ERROR');

            // Message should contain the error code from the response
            expect(result.message).toContain(errorResponse.error);

            // If error_description is provided, it should be in the message
            if (errorResponse.error_description) {
              expect(result.message).toContain(errorResponse.error_description);
            }

            // Details should contain the error code
            expect(result.details).toBeDefined();
            expect(result.details?.errorCode).toBe(errorResponse.error);

            // Provider ID should be in details
            expect(result.details?.providerId).toBe(providerId);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('parses string error responses', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 500 }),
          providerIdArb,
          (errorString, providerId) => {
            const result = parseProviderErrorResponse(errorString, providerId);

            // Result should have required AuthError fields
            expect(result).toHaveProperty('code');
            expect(result).toHaveProperty('message');
            expect(typeof result.code).toBe('string');
            expect(typeof result.message).toBe('string');

            // Code should be PROVIDER_ERROR
            expect(result.code).toBe('PROVIDER_ERROR');
          }
        ),
        { numRuns: 100 }
      );
    });

    test('parses JSON string error responses', () => {
      fc.assert(
        fc.property(
          oauthErrorResponseArb,
          providerIdArb,
          (errorResponse, providerId) => {
            const jsonString = JSON.stringify(errorResponse);
            const result = parseProviderErrorResponse(jsonString, providerId);

            // Result should have required AuthError fields
            expect(result).toHaveProperty('code');
            expect(result).toHaveProperty('message');

            // Should parse the JSON and extract error code
            expect(result.code).toBe('PROVIDER_ERROR');
            expect(result.details?.errorCode).toBe(errorResponse.error);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('handles null and undefined responses gracefully', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(null, undefined),
          providerIdArb,
          (response, providerId) => {
            const result = parseProviderErrorResponse(response, providerId);

            // Should return a valid AuthError
            expect(result).toHaveProperty('code');
            expect(result).toHaveProperty('message');
            expect(result.code).toBe('PROVIDER_ERROR');
          }
        ),
        { numRuns: 10 }
      );
    });

    test('handles generic object responses with message field', () => {
      fc.assert(
        fc.property(
          fc.record({
            message: fc.string({ minLength: 1, maxLength: 200 }),
          }),
          providerIdArb,
          (errorObj, providerId) => {
            const result = parseProviderErrorResponse(errorObj, providerId);

            // Result should have required AuthError fields
            expect(result).toHaveProperty('code');
            expect(result).toHaveProperty('message');
            expect(result.code).toBe('PROVIDER_ERROR');
          }
        ),
        { numRuns: 100 }
      );
    });

    test('ProviderError class creates valid AuthError', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 200 }),
          oauthErrorCodeArb,
          fc.option(fc.string({ minLength: 1, maxLength: 200 }), { nil: undefined }),
          providerIdArb,
          (message, errorCode, errorDescription, providerId) => {
            const error = new ProviderError(message, {
              errorCode,
              errorDescription,
              providerId,
            });

            // Should be an AuthenticationError
            expect(error).toBeInstanceOf(AuthenticationError);
            expect(error.code).toBe('PROVIDER_ERROR');
            expect(error.message).toBe(message);

            // toAuthError should return valid AuthError
            const authError = error.toAuthError();
            expect(authError.code).toBe('PROVIDER_ERROR');
            expect(authError.message).toBe(message);
            expect(authError.details?.errorCode).toBe(errorCode);
            expect(authError.details?.providerId).toBe(providerId);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Feature: oauth-authentication, Property 30: Invalid Provider Error
   *
   * *For any* authentication request with an unsupported provider ID, the error
   * response SHALL include the list of supported providers.
   *
   * **Validates: Requirements 13.4**
   */
  describe('Property 30: Invalid Provider Error', () => {
    test('unsupported provider error includes list of supported providers', () => {
      fc.assert(
        fc.property(
          invalidProviderIdArb,
          (invalidProviderId) => {
            const result = createUnsupportedProviderError(invalidProviderId);

            // Result should have required AuthError fields
            expect(result).toHaveProperty('code');
            expect(result).toHaveProperty('message');
            expect(result.code).toBe('UNSUPPORTED_PROVIDER');

            // Message should mention the invalid provider
            expect(result.message).toContain(invalidProviderId);
            expect(result.message).toContain('not supported');

            // Details should include supported providers
            expect(result.details).toBeDefined();
            expect(result.details?.supportedProviders).toBeDefined();
            expect(Array.isArray(result.details?.supportedProviders)).toBe(true);

            // Supported providers should match VALID_PROVIDER_IDS
            const supportedProviders = result.details?.supportedProviders as string[];
            expect(supportedProviders).toEqual(expect.arrayContaining([...VALID_PROVIDER_IDS]));
            expect(supportedProviders.length).toBe(VALID_PROVIDER_IDS.length);

            // Invalid provider should be in details
            expect(result.details?.providerId).toBe(invalidProviderId);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('UnsupportedProviderError class includes supported providers', () => {
      fc.assert(
        fc.property(
          invalidProviderIdArb,
          (invalidProviderId) => {
            const error = new UnsupportedProviderError(invalidProviderId);

            // Should be an AuthenticationError
            expect(error).toBeInstanceOf(AuthenticationError);
            expect(error.code).toBe('UNSUPPORTED_PROVIDER');

            // Message should mention the invalid provider
            expect(error.message).toContain(invalidProviderId);

            // toAuthError should include supported providers
            const authError = error.toAuthError();
            expect(authError.details?.supportedProviders).toBeDefined();
            expect(Array.isArray(authError.details?.supportedProviders)).toBe(true);

            const supportedProviders = authError.details?.supportedProviders as string[];
            expect(supportedProviders).toEqual(expect.arrayContaining([...VALID_PROVIDER_IDS]));
          }
        ),
        { numRuns: 100 }
      );
    });

    test('supported providers list is complete and accurate', () => {
      fc.assert(
        fc.property(
          invalidProviderIdArb,
          (invalidProviderId) => {
            const result = createUnsupportedProviderError(invalidProviderId);
            const supportedProviders = result.details?.supportedProviders as string[];

            // All valid provider IDs should be in the list
            for (const validId of VALID_PROVIDER_IDS) {
              expect(supportedProviders).toContain(validId);
            }

            // The invalid provider should NOT be in the supported list
            expect(supportedProviders).not.toContain(invalidProviderId);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('error response is properly formatted', () => {
      fc.assert(
        fc.property(
          invalidProviderIdArb,
          (invalidProviderId) => {
            const error = new UnsupportedProviderError(invalidProviderId);
            const formatted = formatErrorResponse(error);

            // Formatted response should have all required fields
            expect(formatted).toHaveProperty('code');
            expect(formatted).toHaveProperty('message');
            expect(formatted.code).toBe('UNSUPPORTED_PROVIDER');

            // Should include supported providers in details
            expect(formatted.details?.supportedProviders).toBeDefined();
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Additional property tests for sensitive data handling.
   *
   * **Validates: Requirements 13.5**
   */
  describe('Sensitive Data Redaction', () => {
    /**
     * Arbitrary for generating realistic token strings (no whitespace).
     */
    const tokenArb = fc.stringOf(
      fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~+/='.split('')),
      { minLength: 10, maxLength: 100 }
    );

    test('redacts access tokens from error messages', () => {
      fc.assert(
        fc.property(
          tokenArb,
          (token) => {
            const messageWithToken = `Error with access_token=${token}`;
            const redacted = redactSensitiveData(messageWithToken);

            // Token should be redacted
            expect(redacted).not.toContain(token);
            expect(redacted).toContain('[REDACTED]');
          }
        ),
        { numRuns: 100 }
      );
    });

    test('redacts refresh tokens from error messages', () => {
      fc.assert(
        fc.property(
          tokenArb,
          (token) => {
            const messageWithToken = `Error with refresh_token=${token}`;
            const redacted = redactSensitiveData(messageWithToken);

            // Token should be redacted
            expect(redacted).not.toContain(token);
            expect(redacted).toContain('[REDACTED]');
          }
        ),
        { numRuns: 100 }
      );
    });

    test('redacts client secrets from error messages', () => {
      fc.assert(
        fc.property(
          tokenArb,
          (secret) => {
            const messageWithSecret = `Error with client_secret=${secret}`;
            const redacted = redactSensitiveData(messageWithSecret);

            // Secret should be redacted
            expect(redacted).not.toContain(secret);
            expect(redacted).toContain('[REDACTED]');
          }
        ),
        { numRuns: 100 }
      );
    });

    test('redacts Bearer tokens from error messages', () => {
      fc.assert(
        fc.property(
          fc.stringOf(fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'.split('')), { minLength: 10, maxLength: 100 }),
          (token) => {
            const messageWithBearer = `Authorization failed: Bearer ${token}`;
            const redacted = redactSensitiveData(messageWithBearer);

            // Token should be redacted
            expect(redacted).not.toContain(token);
            expect(redacted).toContain('[REDACTED]');
          }
        ),
        { numRuns: 100 }
      );
    });

    test('formatErrorResponse never exposes sensitive data', () => {
      fc.assert(
        fc.property(
          tokenArb,
          tokenArb,
          (accessToken, refreshToken) => {
            const errorWithSensitiveData = new Error(
              `Failed with access_token=${accessToken} and refresh_token=${refreshToken}`
            );
            const formatted = formatErrorResponse(errorWithSensitiveData);

            // Sensitive data should be redacted
            expect(formatted.message).not.toContain(accessToken);
            expect(formatted.message).not.toContain(refreshToken);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
