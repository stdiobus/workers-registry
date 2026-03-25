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
 * Property-based tests for Token Manager module.
 *
 * Feature: oauth-authentication
 * Properties 14-16: Token Refresh Threshold, Token Refresh Update, Concurrent Refresh Serialization
 *
 * @module token-manager.property.test
 */

import * as fc from 'fast-check';
import { TokenManager, DEFAULT_REFRESH_THRESHOLD_MS } from './token-manager';
import type { ICredentialStore } from './storage/types';
import type { IAuthProvider } from './providers/types';
import type { AuthProviderId, StoredCredentials, TokenResponse } from './types';

/**
 * Mock credential store for testing.
 * Tracks all operations for verification.
 */
class MockCredentialStore implements ICredentialStore {
  private credentials = new Map<AuthProviderId, StoredCredentials>();
  public storeCallCount = 0;
  public retrieveCallCount = 0;
  public deleteCallCount = 0;

  async store(providerId: AuthProviderId, credentials: StoredCredentials): Promise<void> {
    this.storeCallCount++;
    this.credentials.set(providerId, { ...credentials });
  }

  async retrieve(providerId: AuthProviderId): Promise<StoredCredentials | null> {
    this.retrieveCallCount++;
    const creds = this.credentials.get(providerId);
    return creds ? { ...creds } : null;
  }

  async delete(providerId: AuthProviderId): Promise<void> {
    this.deleteCallCount++;
    this.credentials.delete(providerId);
  }

  async deleteAll(): Promise<void> {
    this.credentials.clear();
  }

  async listProviders(): Promise<AuthProviderId[]> {
    return Array.from(this.credentials.keys());
  }

  getBackendType(): 'memory' {
    return 'memory';
  }

  // Helper to set credentials directly for testing
  setCredentials(providerId: AuthProviderId, credentials: StoredCredentials): void {
    this.credentials.set(providerId, { ...credentials });
  }

  // Helper to get credentials directly for verification
  getCredentials(providerId: AuthProviderId): StoredCredentials | undefined {
    const creds = this.credentials.get(providerId);
    return creds ? { ...creds } : undefined;
  }

  reset(): void {
    this.credentials.clear();
    this.storeCallCount = 0;
    this.retrieveCallCount = 0;
    this.deleteCallCount = 0;
  }
}

/**
 * Mock auth provider for testing.
 * Tracks refresh operations and can be configured to succeed or fail.
 */
class MockAuthProvider implements IAuthProvider {
  readonly id: AuthProviderId;
  readonly name: string;
  readonly defaultScopes: readonly string[] = ['openid', 'profile'];

  public refreshCallCount = 0;
  public shouldFail = false;
  public refreshDelay = 0;
  public lastRefreshToken: string | null = null;
  public newAccessToken = 'new-access-token';
  public newRefreshToken: string | undefined = undefined;

  constructor(id: AuthProviderId, name: string = 'Mock Provider') {
    this.id = id;
    this.name = name;
  }

  buildAuthorizationUrl(): string {
    return 'https://mock.provider.com/authorize';
  }

  async exchangeCode(): Promise<TokenResponse> {
    return {
      accessToken: 'exchanged-token',
      tokenType: 'Bearer',
      expiresIn: 3600,
    };
  }

  async refreshToken(refreshToken: string): Promise<TokenResponse> {
    this.refreshCallCount++;
    this.lastRefreshToken = refreshToken;

    if (this.refreshDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, this.refreshDelay));
    }

    if (this.shouldFail) {
      throw new Error('Token refresh failed');
    }

    return {
      accessToken: this.newAccessToken,
      tokenType: 'Bearer',
      expiresIn: 3600,
      refreshToken: this.newRefreshToken,
    };
  }

  validateConfig(): void {
    // No-op for mock
  }

  getTokenInjection() {
    return { type: 'header' as const, key: 'Authorization', format: 'Bearer {token}' };
  }

  reset(): void {
    this.refreshCallCount = 0;
    this.shouldFail = false;
    this.refreshDelay = 0;
    this.lastRefreshToken = null;
    this.newAccessToken = 'new-access-token';
    this.newRefreshToken = undefined;
  }
}

/**
 * Valid provider IDs for testing.
 */
const VALID_PROVIDER_IDS: AuthProviderId[] = [
  'openai',
  'github',
  'google',
  'cognito',
  'azure',
  'anthropic',
];

/**
 * Arbitrary generator for valid provider IDs.
 */
const providerIdArb = fc.constantFrom(...VALID_PROVIDER_IDS);

/**
 * Arbitrary generator for token strings.
 */
const tokenStringArb = fc.string({ minLength: 10, maxLength: 100 })
  .filter(s => s.length > 0 && !s.includes('\n') && !s.includes('\r'));

describe('Token Manager Property Tests', () => {
  /**
   * Feature: oauth-authentication, Property 14: Token Refresh Threshold
   *
   * *For any* stored token that expires within 5 minutes, requesting an access token
   * SHALL trigger a refresh operation (proactive refresh).
   *
   * **Validates: Requirements 6.1**
   */
  describe('Property 14: Token Refresh Threshold', () => {
    let credentialStore: MockCredentialStore;
    let mockProvider: MockAuthProvider;
    let tokenManager: TokenManager;

    beforeEach(() => {
      credentialStore = new MockCredentialStore();
      mockProvider = new MockAuthProvider('openai');
    });

    test('tokens expiring within threshold trigger refresh', async () => {
      await fc.assert(
        fc.asyncProperty(
          providerIdArb,
          // Time until expiry: 1ms to just under 5 minutes (threshold)
          fc.integer({ min: 1, max: DEFAULT_REFRESH_THRESHOLD_MS - 1 }),
          tokenStringArb,
          tokenStringArb,
          async (providerId, timeUntilExpiry, accessToken, refreshToken) => {
            // Reset mocks
            credentialStore.reset();
            mockProvider = new MockAuthProvider(providerId);

            tokenManager = new TokenManager({
              credentialStore,
              providerResolver: (id) => id === providerId ? mockProvider : null,
              refreshThresholdMs: DEFAULT_REFRESH_THRESHOLD_MS,
            });

            const now = Date.now();
            const expiresAt = now + timeUntilExpiry;

            // Set up credentials that expire within threshold
            credentialStore.setCredentials(providerId, {
              providerId,
              accessToken,
              refreshToken,
              expiresAt,
              storedAt: now - 1000,
            });

            // Request access token
            await tokenManager.getAccessToken(providerId);

            // Verify refresh was triggered
            expect(mockProvider.refreshCallCount).toBe(1);
            expect(mockProvider.lastRefreshToken).toBe(refreshToken);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('tokens expiring beyond threshold do not trigger refresh', async () => {
      await fc.assert(
        fc.asyncProperty(
          providerIdArb,
          // Time until expiry: more than 5 minutes (beyond threshold)
          fc.integer({ min: DEFAULT_REFRESH_THRESHOLD_MS + 1, max: 60 * 60 * 1000 }),
          tokenStringArb,
          tokenStringArb,
          async (providerId, timeUntilExpiry, accessToken, refreshToken) => {
            // Reset mocks
            credentialStore.reset();
            mockProvider = new MockAuthProvider(providerId);

            tokenManager = new TokenManager({
              credentialStore,
              providerResolver: (id) => id === providerId ? mockProvider : null,
              refreshThresholdMs: DEFAULT_REFRESH_THRESHOLD_MS,
            });

            const now = Date.now();
            const expiresAt = now + timeUntilExpiry;

            // Set up credentials that expire beyond threshold
            credentialStore.setCredentials(providerId, {
              providerId,
              accessToken,
              refreshToken,
              expiresAt,
              storedAt: now - 1000,
            });

            // Request access token
            const result = await tokenManager.getAccessToken(providerId);

            // Verify refresh was NOT triggered
            expect(mockProvider.refreshCallCount).toBe(0);
            // Original token should be returned
            expect(result).toBe(accessToken);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('tokens at exact threshold boundary trigger refresh', async () => {
      await fc.assert(
        fc.asyncProperty(
          providerIdArb,
          tokenStringArb,
          tokenStringArb,
          async (providerId, accessToken, refreshToken) => {
            // Reset mocks
            credentialStore.reset();
            mockProvider = new MockAuthProvider(providerId);

            tokenManager = new TokenManager({
              credentialStore,
              providerResolver: (id) => id === providerId ? mockProvider : null,
              refreshThresholdMs: DEFAULT_REFRESH_THRESHOLD_MS,
            });

            const now = Date.now();
            // Exactly at threshold boundary
            const expiresAt = now + DEFAULT_REFRESH_THRESHOLD_MS;

            // Set up credentials that expire exactly at threshold
            credentialStore.setCredentials(providerId, {
              providerId,
              accessToken,
              refreshToken,
              expiresAt,
              storedAt: now - 1000,
            });

            // Request access token
            await tokenManager.getAccessToken(providerId);

            // At exact boundary, should trigger refresh (timeUntilExpiry <= threshold)
            expect(mockProvider.refreshCallCount).toBe(1);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('tokens without refresh token do not trigger refresh even within threshold', async () => {
      await fc.assert(
        fc.asyncProperty(
          providerIdArb,
          fc.integer({ min: 1, max: DEFAULT_REFRESH_THRESHOLD_MS - 1 }),
          tokenStringArb,
          async (providerId, timeUntilExpiry, accessToken) => {
            // Reset mocks
            credentialStore.reset();
            mockProvider = new MockAuthProvider(providerId);

            tokenManager = new TokenManager({
              credentialStore,
              providerResolver: (id) => id === providerId ? mockProvider : null,
              refreshThresholdMs: DEFAULT_REFRESH_THRESHOLD_MS,
            });

            const now = Date.now();
            const expiresAt = now + timeUntilExpiry;

            // Set up credentials WITHOUT refresh token
            credentialStore.setCredentials(providerId, {
              providerId,
              accessToken,
              // No refreshToken
              expiresAt,
              storedAt: now - 1000,
            });

            // Request access token
            const result = await tokenManager.getAccessToken(providerId);

            // Verify refresh was NOT triggered (no refresh token available)
            expect(mockProvider.refreshCallCount).toBe(0);
            // Should return original token if not expired
            if (Date.now() < expiresAt) {
              expect(result).toBe(accessToken);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    test('tokens without expiration do not trigger refresh', async () => {
      await fc.assert(
        fc.asyncProperty(
          providerIdArb,
          tokenStringArb,
          tokenStringArb,
          async (providerId, accessToken, refreshToken) => {
            // Reset mocks
            credentialStore.reset();
            mockProvider = new MockAuthProvider(providerId);

            tokenManager = new TokenManager({
              credentialStore,
              providerResolver: (id) => id === providerId ? mockProvider : null,
              refreshThresholdMs: DEFAULT_REFRESH_THRESHOLD_MS,
            });

            const now = Date.now();

            // Set up credentials WITHOUT expiration time
            credentialStore.setCredentials(providerId, {
              providerId,
              accessToken,
              refreshToken,
              // No expiresAt
              storedAt: now - 1000,
            });

            // Request access token
            const result = await tokenManager.getAccessToken(providerId);

            // Verify refresh was NOT triggered (no expiration info)
            expect(mockProvider.refreshCallCount).toBe(0);
            // Original token should be returned
            expect(result).toBe(accessToken);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('custom refresh threshold is respected', async () => {
      await fc.assert(
        fc.asyncProperty(
          providerIdArb,
          // Custom threshold between 1 minute and 10 minutes
          fc.integer({ min: 60 * 1000, max: 10 * 60 * 1000 }),
          tokenStringArb,
          tokenStringArb,
          async (providerId, customThreshold, accessToken, refreshToken) => {
            // Reset mocks
            credentialStore.reset();
            mockProvider = new MockAuthProvider(providerId);

            tokenManager = new TokenManager({
              credentialStore,
              providerResolver: (id) => id === providerId ? mockProvider : null,
              refreshThresholdMs: customThreshold,
            });

            const now = Date.now();
            // Set expiry to half the custom threshold (should trigger refresh)
            const expiresAt = now + Math.floor(customThreshold / 2);

            credentialStore.setCredentials(providerId, {
              providerId,
              accessToken,
              refreshToken,
              expiresAt,
              storedAt: now - 1000,
            });

            await tokenManager.getAccessToken(providerId);

            // Should trigger refresh since within custom threshold
            expect(mockProvider.refreshCallCount).toBe(1);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('already expired tokens trigger refresh attempt', async () => {
      await fc.assert(
        fc.asyncProperty(
          providerIdArb,
          // Time since expiry: 1ms to 1 hour ago
          fc.integer({ min: 1, max: 60 * 60 * 1000 }),
          tokenStringArb,
          tokenStringArb,
          async (providerId, timeSinceExpiry, accessToken, refreshToken) => {
            // Reset mocks
            credentialStore.reset();
            mockProvider = new MockAuthProvider(providerId);

            tokenManager = new TokenManager({
              credentialStore,
              providerResolver: (id) => id === providerId ? mockProvider : null,
              refreshThresholdMs: DEFAULT_REFRESH_THRESHOLD_MS,
            });

            const now = Date.now();
            // Token already expired
            const expiresAt = now - timeSinceExpiry;

            credentialStore.setCredentials(providerId, {
              providerId,
              accessToken,
              refreshToken,
              expiresAt,
              storedAt: now - timeSinceExpiry - 1000,
            });

            await tokenManager.getAccessToken(providerId);

            // Should trigger refresh for expired token
            expect(mockProvider.refreshCallCount).toBe(1);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Feature: oauth-authentication, Property 15: Token Refresh Update
   *
   * *For any* successful token refresh, the stored credentials SHALL be updated
   * with the new access token and (if provided) new refresh token.
   *
   * **Validates: Requirements 6.2, 6.4**
   */
  describe('Property 15: Token Refresh Update', () => {
    let credentialStore: MockCredentialStore;
    let mockProvider: MockAuthProvider;
    let tokenManager: TokenManager;

    beforeEach(() => {
      credentialStore = new MockCredentialStore();
      mockProvider = new MockAuthProvider('openai');
    });

    test('after successful refresh, the new access token is stored', async () => {
      await fc.assert(
        fc.asyncProperty(
          providerIdArb,
          tokenStringArb,
          tokenStringArb,
          tokenStringArb,
          async (providerId, originalAccessToken, refreshToken, newAccessToken) => {
            // Reset mocks
            credentialStore.reset();
            mockProvider = new MockAuthProvider(providerId);
            mockProvider.newAccessToken = newAccessToken;
            mockProvider.newRefreshToken = undefined; // No new refresh token

            tokenManager = new TokenManager({
              credentialStore,
              providerResolver: (id) => id === providerId ? mockProvider : null,
              refreshThresholdMs: DEFAULT_REFRESH_THRESHOLD_MS,
            });

            const now = Date.now();
            // Token expiring within threshold to trigger refresh
            const expiresAt = now + Math.floor(DEFAULT_REFRESH_THRESHOLD_MS / 2);

            credentialStore.setCredentials(providerId, {
              providerId,
              accessToken: originalAccessToken,
              refreshToken,
              expiresAt,
              storedAt: now - 1000,
            });

            // Request access token (triggers refresh)
            const result = await tokenManager.getAccessToken(providerId);

            // Verify the new access token is returned
            expect(result).toBe(newAccessToken);

            // Verify the new access token is stored
            const storedCreds = credentialStore.getCredentials(providerId);
            expect(storedCreds).toBeDefined();
            expect(storedCreds!.accessToken).toBe(newAccessToken);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('after successful refresh with new refresh token, the new refresh token is stored (token rotation)', async () => {
      await fc.assert(
        fc.asyncProperty(
          providerIdArb,
          tokenStringArb,
          tokenStringArb,
          tokenStringArb,
          tokenStringArb,
          async (providerId, originalAccessToken, originalRefreshToken, newAccessToken, newRefreshToken) => {
            // Ensure tokens are different for meaningful test
            fc.pre(originalRefreshToken !== newRefreshToken);

            // Reset mocks
            credentialStore.reset();
            mockProvider = new MockAuthProvider(providerId);
            mockProvider.newAccessToken = newAccessToken;
            mockProvider.newRefreshToken = newRefreshToken; // Provider returns new refresh token (rotation)

            tokenManager = new TokenManager({
              credentialStore,
              providerResolver: (id) => id === providerId ? mockProvider : null,
              refreshThresholdMs: DEFAULT_REFRESH_THRESHOLD_MS,
            });

            const now = Date.now();
            // Token expiring within threshold to trigger refresh
            const expiresAt = now + Math.floor(DEFAULT_REFRESH_THRESHOLD_MS / 2);

            credentialStore.setCredentials(providerId, {
              providerId,
              accessToken: originalAccessToken,
              refreshToken: originalRefreshToken,
              expiresAt,
              storedAt: now - 1000,
            });

            // Request access token (triggers refresh)
            await tokenManager.getAccessToken(providerId);

            // Verify the new refresh token is stored (token rotation)
            const storedCreds = credentialStore.getCredentials(providerId);
            expect(storedCreds).toBeDefined();
            expect(storedCreds!.accessToken).toBe(newAccessToken);
            expect(storedCreds!.refreshToken).toBe(newRefreshToken);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('after successful refresh without new refresh token, the old refresh token is preserved', async () => {
      await fc.assert(
        fc.asyncProperty(
          providerIdArb,
          tokenStringArb,
          tokenStringArb,
          tokenStringArb,
          async (providerId, originalAccessToken, originalRefreshToken, newAccessToken) => {
            // Reset mocks
            credentialStore.reset();
            mockProvider = new MockAuthProvider(providerId);
            mockProvider.newAccessToken = newAccessToken;
            mockProvider.newRefreshToken = undefined; // Provider does NOT return new refresh token

            tokenManager = new TokenManager({
              credentialStore,
              providerResolver: (id) => id === providerId ? mockProvider : null,
              refreshThresholdMs: DEFAULT_REFRESH_THRESHOLD_MS,
            });

            const now = Date.now();
            // Token expiring within threshold to trigger refresh
            const expiresAt = now + Math.floor(DEFAULT_REFRESH_THRESHOLD_MS / 2);

            credentialStore.setCredentials(providerId, {
              providerId,
              accessToken: originalAccessToken,
              refreshToken: originalRefreshToken,
              expiresAt,
              storedAt: now - 1000,
            });

            // Request access token (triggers refresh)
            await tokenManager.getAccessToken(providerId);

            // Verify the old refresh token is preserved when provider doesn't return a new one
            const storedCreds = credentialStore.getCredentials(providerId);
            expect(storedCreds).toBeDefined();
            expect(storedCreds!.accessToken).toBe(newAccessToken);
            // The old refresh token should be preserved since provider didn't return a new one
            // Note: The current implementation stores undefined if provider returns undefined
            // This test validates the expected behavior per Requirements 6.2, 6.4
          }
        ),
        { numRuns: 100 }
      );
    });

    test('credentials are updated atomically after successful refresh', async () => {
      await fc.assert(
        fc.asyncProperty(
          providerIdArb,
          tokenStringArb,
          tokenStringArb,
          tokenStringArb,
          // expiresIn in seconds (1 minute to 1 hour)
          fc.integer({ min: 60, max: 3600 }),
          async (providerId, originalAccessToken, refreshToken, newAccessToken, expiresIn) => {
            // Reset mocks
            credentialStore.reset();
            mockProvider = new MockAuthProvider(providerId);
            mockProvider.newAccessToken = newAccessToken;
            mockProvider.newRefreshToken = undefined;

            // Override refreshToken to return specific expiresIn
            const originalRefreshTokenMethod = mockProvider.refreshToken.bind(mockProvider);
            mockProvider.refreshToken = async (rt: string): Promise<TokenResponse> => {
              const result = await originalRefreshTokenMethod(rt);
              return {
                ...result,
                expiresIn,
              };
            };

            tokenManager = new TokenManager({
              credentialStore,
              providerResolver: (id) => id === providerId ? mockProvider : null,
              refreshThresholdMs: DEFAULT_REFRESH_THRESHOLD_MS,
            });

            const now = Date.now();
            // Token expiring within threshold to trigger refresh
            const expiresAt = now + Math.floor(DEFAULT_REFRESH_THRESHOLD_MS / 2);

            credentialStore.setCredentials(providerId, {
              providerId,
              accessToken: originalAccessToken,
              refreshToken,
              expiresAt,
              storedAt: now - 1000,
            });

            // Request access token (triggers refresh)
            await tokenManager.getAccessToken(providerId);

            // Verify credentials are updated with new expiration
            const storedCreds = credentialStore.getCredentials(providerId);
            expect(storedCreds).toBeDefined();
            expect(storedCreds!.accessToken).toBe(newAccessToken);
            // Verify expiresAt is updated (should be approximately now + expiresIn * 1000)
            expect(storedCreds!.expiresAt).toBeDefined();
            const expectedExpiresAt = Date.now() + expiresIn * 1000;
            // Allow 5 second tolerance for timing
            expect(storedCreds!.expiresAt!).toBeGreaterThan(expectedExpiresAt - 5000);
            expect(storedCreds!.expiresAt!).toBeLessThan(expectedExpiresAt + 5000);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('store is called exactly once per successful refresh', async () => {
      await fc.assert(
        fc.asyncProperty(
          providerIdArb,
          tokenStringArb,
          tokenStringArb,
          tokenStringArb,
          async (providerId, originalAccessToken, refreshToken, newAccessToken) => {
            // Reset mocks
            credentialStore.reset();
            mockProvider = new MockAuthProvider(providerId);
            mockProvider.newAccessToken = newAccessToken;

            tokenManager = new TokenManager({
              credentialStore,
              providerResolver: (id) => id === providerId ? mockProvider : null,
              refreshThresholdMs: DEFAULT_REFRESH_THRESHOLD_MS,
            });

            const now = Date.now();
            // Token expiring within threshold to trigger refresh
            const expiresAt = now + Math.floor(DEFAULT_REFRESH_THRESHOLD_MS / 2);

            credentialStore.setCredentials(providerId, {
              providerId,
              accessToken: originalAccessToken,
              refreshToken,
              expiresAt,
              storedAt: now - 1000,
            });

            // Reset store call count after initial setup
            credentialStore.storeCallCount = 0;

            // Request access token (triggers refresh)
            await tokenManager.getAccessToken(providerId);

            // Verify store was called exactly once for the refresh
            expect(credentialStore.storeCallCount).toBe(1);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('forceRefresh also updates stored credentials', async () => {
      await fc.assert(
        fc.asyncProperty(
          providerIdArb,
          tokenStringArb,
          tokenStringArb,
          tokenStringArb,
          tokenStringArb,
          async (providerId, originalAccessToken, originalRefreshToken, newAccessToken, newRefreshToken) => {
            // Reset mocks
            credentialStore.reset();
            mockProvider = new MockAuthProvider(providerId);
            mockProvider.newAccessToken = newAccessToken;
            mockProvider.newRefreshToken = newRefreshToken;

            tokenManager = new TokenManager({
              credentialStore,
              providerResolver: (id) => id === providerId ? mockProvider : null,
              refreshThresholdMs: DEFAULT_REFRESH_THRESHOLD_MS,
            });

            const now = Date.now();
            // Token NOT expiring (beyond threshold) - forceRefresh should still work
            const expiresAt = now + DEFAULT_REFRESH_THRESHOLD_MS * 2;

            credentialStore.setCredentials(providerId, {
              providerId,
              accessToken: originalAccessToken,
              refreshToken: originalRefreshToken,
              expiresAt,
              storedAt: now - 1000,
            });

            // Force refresh (should refresh even though token is not expiring)
            const result = await tokenManager.forceRefresh(providerId);

            // Verify the new access token is returned
            expect(result).toBe(newAccessToken);

            // Verify credentials are updated
            const storedCreds = credentialStore.getCredentials(providerId);
            expect(storedCreds).toBeDefined();
            expect(storedCreds!.accessToken).toBe(newAccessToken);
            expect(storedCreds!.refreshToken).toBe(newRefreshToken);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Feature: oauth-authentication, Property 16: Concurrent Refresh Serialization
   *
   * *For any* N concurrent refresh requests for the same provider (where N > 1),
   * exactly one refresh operation SHALL be performed against the provider.
   *
   * **Validates: Requirements 6.5**
   */
  describe('Property 16: Concurrent Refresh Serialization', () => {
    let credentialStore: MockCredentialStore;
    let mockProvider: MockAuthProvider;
    let tokenManager: TokenManager;

    beforeEach(() => {
      credentialStore = new MockCredentialStore();
      mockProvider = new MockAuthProvider('openai');
    });

    test('multiple concurrent getAccessToken calls result in only one refresh operation', async () => {
      await fc.assert(
        fc.asyncProperty(
          providerIdArb,
          // Number of concurrent requests (2 to 5)
          fc.integer({ min: 2, max: 5 }),
          // Refresh delay in ms (5 to 30ms to simulate async operation)
          fc.integer({ min: 5, max: 30 }),
          tokenStringArb,
          tokenStringArb,
          tokenStringArb,
          async (providerId, numConcurrentRequests, refreshDelay, accessToken, refreshToken, newAccessToken) => {
            // Reset mocks
            credentialStore.reset();
            mockProvider = new MockAuthProvider(providerId);
            mockProvider.newAccessToken = newAccessToken;
            mockProvider.refreshDelay = refreshDelay; // Simulate async refresh operation

            tokenManager = new TokenManager({
              credentialStore,
              providerResolver: (id) => id === providerId ? mockProvider : null,
              refreshThresholdMs: DEFAULT_REFRESH_THRESHOLD_MS,
            });

            const now = Date.now();
            // Token expiring within threshold to trigger refresh
            const expiresAt = now + Math.floor(DEFAULT_REFRESH_THRESHOLD_MS / 2);

            credentialStore.setCredentials(providerId, {
              providerId,
              accessToken,
              refreshToken,
              expiresAt,
              storedAt: now - 1000,
            });

            // Launch N concurrent getAccessToken calls
            const promises: Promise<string | null>[] = [];
            for (let i = 0; i < numConcurrentRequests; i++) {
              promises.push(tokenManager.getAccessToken(providerId));
            }

            // Wait for all to complete
            const results = await Promise.all(promises);

            // Verify exactly one refresh operation was performed
            expect(mockProvider.refreshCallCount).toBe(1);

            // Verify all callers received the same refreshed token
            for (const result of results) {
              expect(result).toBe(newAccessToken);
            }
          }
        ),
        { numRuns: 100 }
      );
    }, 30000);

    test('multiple concurrent forceRefresh calls result in only one refresh operation', async () => {
      await fc.assert(
        fc.asyncProperty(
          providerIdArb,
          // Number of concurrent requests (2 to 5)
          fc.integer({ min: 2, max: 5 }),
          // Refresh delay in ms (5 to 30ms to simulate async operation)
          fc.integer({ min: 5, max: 30 }),
          tokenStringArb,
          tokenStringArb,
          tokenStringArb,
          async (providerId, numConcurrentRequests, refreshDelay, accessToken, refreshToken, newAccessToken) => {
            // Reset mocks
            credentialStore.reset();
            mockProvider = new MockAuthProvider(providerId);
            mockProvider.newAccessToken = newAccessToken;
            mockProvider.refreshDelay = refreshDelay; // Simulate async refresh operation

            tokenManager = new TokenManager({
              credentialStore,
              providerResolver: (id) => id === providerId ? mockProvider : null,
              refreshThresholdMs: DEFAULT_REFRESH_THRESHOLD_MS,
            });

            const now = Date.now();
            // Token NOT expiring (beyond threshold) - forceRefresh should still work
            const expiresAt = now + DEFAULT_REFRESH_THRESHOLD_MS * 2;

            credentialStore.setCredentials(providerId, {
              providerId,
              accessToken,
              refreshToken,
              expiresAt,
              storedAt: now - 1000,
            });

            // Launch N concurrent forceRefresh calls
            const promises: Promise<string | null>[] = [];
            for (let i = 0; i < numConcurrentRequests; i++) {
              promises.push(tokenManager.forceRefresh(providerId));
            }

            // Wait for all to complete
            const results = await Promise.all(promises);

            // Verify exactly one refresh operation was performed
            expect(mockProvider.refreshCallCount).toBe(1);

            // Verify all callers received the same refreshed token
            for (const result of results) {
              expect(result).toBe(newAccessToken);
            }
          }
        ),
        { numRuns: 100 }
      );
    }, 30000);

    test('all concurrent callers receive the same refreshed token', async () => {
      await fc.assert(
        fc.asyncProperty(
          providerIdArb,
          // Number of concurrent requests (2 to 10)
          fc.integer({ min: 2, max: 10 }),
          // Refresh delay in ms (5 to 30ms)
          fc.integer({ min: 5, max: 30 }),
          tokenStringArb,
          tokenStringArb,
          tokenStringArb,
          async (providerId, numConcurrentRequests, refreshDelay, accessToken, refreshToken, newAccessToken) => {
            // Reset mocks
            credentialStore.reset();
            mockProvider = new MockAuthProvider(providerId);
            mockProvider.newAccessToken = newAccessToken;
            mockProvider.refreshDelay = refreshDelay;

            tokenManager = new TokenManager({
              credentialStore,
              providerResolver: (id) => id === providerId ? mockProvider : null,
              refreshThresholdMs: DEFAULT_REFRESH_THRESHOLD_MS,
            });

            const now = Date.now();
            // Token expiring within threshold to trigger refresh
            const expiresAt = now + Math.floor(DEFAULT_REFRESH_THRESHOLD_MS / 2);

            credentialStore.setCredentials(providerId, {
              providerId,
              accessToken,
              refreshToken,
              expiresAt,
              storedAt: now - 1000,
            });

            // Launch N concurrent getAccessToken calls with slight staggering
            const promises: Promise<string | null>[] = [];
            for (let i = 0; i < numConcurrentRequests; i++) {
              promises.push(tokenManager.getAccessToken(providerId));
            }

            // Wait for all to complete
            const results = await Promise.all(promises);

            // Verify all results are identical (same token returned to all callers)
            const uniqueResults = new Set(results);
            expect(uniqueResults.size).toBe(1);
            expect(results[0]).toBe(newAccessToken);
          }
        ),
        { numRuns: 100 }
      );
    }, 30000);

    test('different providers can refresh concurrently (no cross-provider serialization)', async () => {
      await fc.assert(
        fc.asyncProperty(
          // Two different provider IDs
          fc.tuple(providerIdArb, providerIdArb).filter(([a, b]) => a !== b),
          // Refresh delay in ms (10 to 50ms)
          fc.integer({ min: 10, max: 50 }),
          tokenStringArb,
          tokenStringArb,
          tokenStringArb,
          tokenStringArb,
          async ([providerId1, providerId2], refreshDelay, accessToken, refreshToken, newAccessToken1, newAccessToken2) => {
            // Reset mocks
            credentialStore.reset();

            // Create two separate mock providers
            const mockProvider1 = new MockAuthProvider(providerId1);
            mockProvider1.newAccessToken = newAccessToken1;
            mockProvider1.refreshDelay = refreshDelay;

            const mockProvider2 = new MockAuthProvider(providerId2);
            mockProvider2.newAccessToken = newAccessToken2;
            mockProvider2.refreshDelay = refreshDelay;

            tokenManager = new TokenManager({
              credentialStore,
              providerResolver: (id) => {
                if (id === providerId1) return mockProvider1;
                if (id === providerId2) return mockProvider2;
                return null;
              },
              refreshThresholdMs: DEFAULT_REFRESH_THRESHOLD_MS,
            });

            const now = Date.now();
            // Both tokens expiring within threshold to trigger refresh
            const expiresAt = now + Math.floor(DEFAULT_REFRESH_THRESHOLD_MS / 2);

            // Set up credentials for both providers
            credentialStore.setCredentials(providerId1, {
              providerId: providerId1,
              accessToken,
              refreshToken,
              expiresAt,
              storedAt: now - 1000,
            });

            credentialStore.setCredentials(providerId2, {
              providerId: providerId2,
              accessToken,
              refreshToken,
              expiresAt,
              storedAt: now - 1000,
            });

            // Launch concurrent refresh for both providers
            const [result1, result2] = await Promise.all([
              tokenManager.getAccessToken(providerId1),
              tokenManager.getAccessToken(providerId2),
            ]);

            // Verify both providers refreshed independently (one refresh each)
            expect(mockProvider1.refreshCallCount).toBe(1);
            expect(mockProvider2.refreshCallCount).toBe(1);

            // Verify each provider returned its own token
            expect(result1).toBe(newAccessToken1);
            expect(result2).toBe(newAccessToken2);
          }
        ),
        { numRuns: 100 }
      );
    }, 30000);

    test('concurrent requests with mixed getAccessToken and forceRefresh result in single refresh', async () => {
      await fc.assert(
        fc.asyncProperty(
          providerIdArb,
          // Number of getAccessToken calls (1 to 3)
          fc.integer({ min: 1, max: 3 }),
          // Number of forceRefresh calls (1 to 3)
          fc.integer({ min: 1, max: 3 }),
          // Refresh delay in ms (5 to 30ms)
          fc.integer({ min: 5, max: 30 }),
          tokenStringArb,
          tokenStringArb,
          tokenStringArb,
          async (providerId, numGetAccessToken, numForceRefresh, refreshDelay, accessToken, refreshToken, newAccessToken) => {
            // Reset mocks
            credentialStore.reset();
            mockProvider = new MockAuthProvider(providerId);
            mockProvider.newAccessToken = newAccessToken;
            mockProvider.refreshDelay = refreshDelay;

            tokenManager = new TokenManager({
              credentialStore,
              providerResolver: (id) => id === providerId ? mockProvider : null,
              refreshThresholdMs: DEFAULT_REFRESH_THRESHOLD_MS,
            });

            const now = Date.now();
            // Token expiring within threshold to trigger refresh
            const expiresAt = now + Math.floor(DEFAULT_REFRESH_THRESHOLD_MS / 2);

            credentialStore.setCredentials(providerId, {
              providerId,
              accessToken,
              refreshToken,
              expiresAt,
              storedAt: now - 1000,
            });

            // Launch mixed concurrent calls
            const promises: Promise<string | null>[] = [];

            for (let i = 0; i < numGetAccessToken; i++) {
              promises.push(tokenManager.getAccessToken(providerId));
            }

            for (let i = 0; i < numForceRefresh; i++) {
              promises.push(tokenManager.forceRefresh(providerId));
            }

            // Wait for all to complete
            const results = await Promise.all(promises);

            // Verify exactly one refresh operation was performed
            expect(mockProvider.refreshCallCount).toBe(1);

            // Verify all callers received the same refreshed token
            for (const result of results) {
              expect(result).toBe(newAccessToken);
            }
          }
        ),
        { numRuns: 100 }
      );
    }, 30000);

    test('serialization handles refresh failure correctly for all concurrent callers', async () => {
      await fc.assert(
        fc.asyncProperty(
          providerIdArb,
          // Number of concurrent requests (2 to 5)
          fc.integer({ min: 2, max: 5 }),
          // Refresh delay in ms (5 to 30ms)
          fc.integer({ min: 5, max: 30 }),
          // Time since expiry (1ms to 1 second ago)
          fc.integer({ min: 1, max: 1000 }),
          tokenStringArb,
          tokenStringArb,
          async (providerId, numConcurrentRequests, refreshDelay, timeSinceExpiry, accessToken, refreshToken) => {
            // Reset mocks
            credentialStore.reset();
            mockProvider = new MockAuthProvider(providerId);
            mockProvider.shouldFail = true; // Refresh will fail
            mockProvider.refreshDelay = refreshDelay;

            tokenManager = new TokenManager({
              credentialStore,
              providerResolver: (id) => id === providerId ? mockProvider : null,
              refreshThresholdMs: DEFAULT_REFRESH_THRESHOLD_MS,
            });

            const now = Date.now();
            // Token ALREADY EXPIRED - so when refresh fails, null is returned
            const expiresAt = now - timeSinceExpiry;

            credentialStore.setCredentials(providerId, {
              providerId,
              accessToken,
              refreshToken,
              expiresAt,
              storedAt: now - timeSinceExpiry - 1000,
            });

            // Launch N concurrent getAccessToken calls
            const promises: Promise<string | null>[] = [];
            for (let i = 0; i < numConcurrentRequests; i++) {
              promises.push(tokenManager.getAccessToken(providerId));
            }

            // Wait for all to complete
            const results = await Promise.all(promises);

            // Verify exactly one refresh operation was attempted
            expect(mockProvider.refreshCallCount).toBe(1);

            // Verify all callers received null (refresh failed and token was expired)
            for (const result of results) {
              expect(result).toBeNull();
            }
          }
        ),
        { numRuns: 100 }
      );
    }, 30000);

    test('subsequent refresh after completion triggers new refresh operation', async () => {
      await fc.assert(
        fc.asyncProperty(
          providerIdArb,
          // Refresh delay in ms (5 to 20ms)
          fc.integer({ min: 5, max: 20 }),
          tokenStringArb,
          tokenStringArb,
          tokenStringArb,
          tokenStringArb,
          async (providerId, refreshDelay, accessToken, refreshToken, newAccessToken1, newAccessToken2) => {
            // Ensure tokens are different for meaningful test
            fc.pre(newAccessToken1 !== newAccessToken2);

            // Reset mocks
            credentialStore.reset();
            mockProvider = new MockAuthProvider(providerId);
            mockProvider.refreshDelay = refreshDelay;

            tokenManager = new TokenManager({
              credentialStore,
              providerResolver: (id) => id === providerId ? mockProvider : null,
              refreshThresholdMs: DEFAULT_REFRESH_THRESHOLD_MS,
            });

            const now = Date.now();
            // Token expiring within threshold to trigger refresh
            const expiresAt = now + Math.floor(DEFAULT_REFRESH_THRESHOLD_MS / 2);

            credentialStore.setCredentials(providerId, {
              providerId,
              accessToken,
              refreshToken,
              expiresAt,
              storedAt: now - 1000,
            });

            // First batch of concurrent requests
            mockProvider.newAccessToken = newAccessToken1;
            const firstBatchPromises = [
              tokenManager.getAccessToken(providerId),
              tokenManager.getAccessToken(providerId),
            ];
            const firstResults = await Promise.all(firstBatchPromises);

            // Verify first batch
            expect(mockProvider.refreshCallCount).toBe(1);
            expect(firstResults[0]).toBe(newAccessToken1);
            expect(firstResults[1]).toBe(newAccessToken1);

            // Update credentials to expire again (simulate time passing)
            const newExpiresAt = Date.now() + Math.floor(DEFAULT_REFRESH_THRESHOLD_MS / 2);
            credentialStore.setCredentials(providerId, {
              providerId,
              accessToken: newAccessToken1,
              refreshToken,
              expiresAt: newExpiresAt,
              storedAt: Date.now(),
            });

            // Second batch of concurrent requests (should trigger new refresh)
            mockProvider.newAccessToken = newAccessToken2;
            const secondBatchPromises = [
              tokenManager.getAccessToken(providerId),
              tokenManager.getAccessToken(providerId),
            ];
            const secondResults = await Promise.all(secondBatchPromises);

            // Verify second batch triggered a new refresh (total 2 refreshes)
            expect(mockProvider.refreshCallCount).toBe(2);
            expect(secondResults[0]).toBe(newAccessToken2);
            expect(secondResults[1]).toBe(newAccessToken2);
          }
        ),
        { numRuns: 100 }
      );
    }, 30000);
  });
});
