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
 * Property-based tests for Auth Manager module.
 *
 * Feature: oauth-authentication
 * Properties 23-27: OAuth Credential Precedence, Optional Authentication,
 *                   ACP AuthMethods Advertisement, AUTH_REQUIRED Error Response,
 *                   Token Injection by Provider
 *
 * @module auth-manager.property.test
 */

import * as fc from 'fast-check';
import { AuthManager } from './auth-manager';
import type { ICredentialStore } from './storage/types';
import type { IAuthProvider } from './providers/types';
import type { ITokenManager } from './token-manager';
import type {
  AuthProviderId,
  StoredCredentials,
  TokenResponse,
  TokenStatus,
  TokenInjectionMethod,
} from './types';
import type { AgentApiKeys } from '../config/api-keys';


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

  setCredentials(providerId: AuthProviderId, credentials: StoredCredentials): void {
    this.credentials.set(providerId, { ...credentials });
  }

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
 * Mock token manager for testing.
 * Tracks operations and can be configured to return specific tokens.
 */
class MockTokenManager implements ITokenManager {
  private tokens = new Map<AuthProviderId, string>();
  private tokenStatus = new Map<AuthProviderId, TokenStatus>();
  public getAccessTokenCallCount = 0;
  public storeTokensCallCount = 0;
  public clearTokensCallCount = 0;

  async getAccessToken(providerId: AuthProviderId): Promise<string | null> {
    this.getAccessTokenCallCount++;
    return this.tokens.get(providerId) ?? null;
  }

  async storeTokens(providerId: AuthProviderId, _tokens: TokenResponse): Promise<void> {
    this.storeTokensCallCount++;
    this.tokens.set(providerId, _tokens.accessToken);
  }

  async hasValidTokens(providerId: AuthProviderId): Promise<boolean> {
    return this.tokens.has(providerId);
  }

  async forceRefresh(providerId: AuthProviderId): Promise<string | null> {
    return this.tokens.get(providerId) ?? null;
  }

  async clearTokens(providerId: AuthProviderId): Promise<void> {
    this.clearTokensCallCount++;
    this.tokens.delete(providerId);
  }

  async getStatus(): Promise<Map<AuthProviderId, TokenStatus>> {
    return new Map(this.tokenStatus);
  }

  setToken(providerId: AuthProviderId, token: string): void {
    this.tokens.set(providerId, token);
  }

  setTokenStatus(providerId: AuthProviderId, status: TokenStatus): void {
    this.tokenStatus.set(providerId, status);
  }

  reset(): void {
    this.tokens.clear();
    this.tokenStatus.clear();
    this.getAccessTokenCallCount = 0;
    this.storeTokensCallCount = 0;
    this.clearTokensCallCount = 0;
  }
}


/**
 * Mock auth provider for testing.
 */
class MockAuthProvider implements IAuthProvider {
  readonly id: AuthProviderId;
  readonly name: string;
  readonly defaultScopes: readonly string[] = ['openid', 'profile'];
  private injectionMethod: TokenInjectionMethod;

  constructor(
    id: AuthProviderId,
    name: string = 'Mock Provider',
    injectionMethod?: TokenInjectionMethod
  ) {
    this.id = id;
    this.name = name;
    this.injectionMethod = injectionMethod ?? {
      type: 'header',
      key: 'Authorization',
      format: 'Bearer {token}',
    };
  }

  buildAuthorizationUrl(): string {
    return `https://mock.${this.id}.com/authorize`;
  }

  async exchangeCode(): Promise<TokenResponse> {
    return {
      accessToken: 'exchanged-token',
      tokenType: 'Bearer',
      expiresIn: 3600,
    };
  }

  async refreshToken(): Promise<TokenResponse> {
    return {
      accessToken: 'refreshed-token',
      tokenType: 'Bearer',
      expiresIn: 3600,
    };
  }

  validateConfig(): void {
    // No-op for mock
  }

  getTokenInjection(): TokenInjectionMethod {
    return this.injectionMethod;
  }

  setInjectionMethod(method: TokenInjectionMethod): void {
    this.injectionMethod = method;
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
 * Avoids special regex replacement characters ($) to prevent issues with format replacement.
 */
const tokenStringArb = fc.string({ minLength: 10, maxLength: 100 })
  .filter(s => s.length > 0 && !s.includes('\n') && !s.includes('\r') && !s.includes('$'));

/**
 * Arbitrary generator for agent IDs.
 */
const agentIdArb = fc.string({ minLength: 1, maxLength: 50 })
  .filter(s => s.length > 0 && !s.includes('\n') && !s.includes('\r'));

/**
 * Generate an agent ID that maps to a specific provider.
 * This is needed because AuthManager.getProviderForAgent() uses keyword matching.
 */
function agentIdForProvider(providerId: AuthProviderId): string {
  const prefixes: Record<AuthProviderId, string> = {
    openai: 'openai-agent',
    anthropic: 'claude-agent',
    github: 'github-copilot',
    google: 'gemini-agent',
    azure: 'azure-agent',
    cognito: 'cognito-agent',
  };
  return prefixes[providerId] || `${providerId}-agent`;
}

/**
 * Arbitrary generator for API keys.
 * Avoids special regex replacement characters ($) to prevent issues with format replacement.
 */
const apiKeyArb = fc.string({ minLength: 10, maxLength: 100 })
  .filter(s => s.length > 0 && !s.includes('\n') && !s.includes('\r') && !s.includes('$'));


describe('Auth Manager Property Tests', () => {
  /**
   * Feature: oauth-authentication, Property 23: OAuth Credential Precedence
   *
   * *For any* agent with both OAuth credentials and legacy api-keys.json credentials
   * available, the OAuth credentials SHALL be used for authentication.
   *
   * **Validates: Requirements 10.3**
   */
  describe('Property 23: OAuth Credential Precedence', () => {
    let credentialStore: MockCredentialStore;
    let tokenManager: MockTokenManager;

    beforeEach(() => {
      credentialStore = new MockCredentialStore();
      tokenManager = new MockTokenManager();
    });

    test('OAuth credentials are preferred over legacy api-keys.json', async () => {
      await fc.assert(
        fc.asyncProperty(
          agentIdArb,
          providerIdArb,
          tokenStringArb,
          apiKeyArb,
          async (agentId, providerId, oauthToken, legacyApiKey) => {
            // Ensure tokens are different for meaningful test
            fc.pre(oauthToken !== legacyApiKey);

            // Reset mocks
            credentialStore.reset();
            tokenManager.reset();

            // Set up OAuth token
            tokenManager.setToken(providerId, oauthToken);

            // Set up credential store with the provider
            const now = Date.now();
            credentialStore.setCredentials(providerId, {
              providerId,
              accessToken: oauthToken,
              storedAt: now,
            });

            // Set up legacy API keys
            const legacyApiKeys: Record<string, AgentApiKeys> = {
              [agentId]: { apiKey: legacyApiKey, env: {} },
            };

            const authManager = new AuthManager({
              credentialStore,
              tokenManager,
              legacyApiKeys,
            });

            // Request token for agent with specified provider
            const result = await authManager.getTokenForAgent(agentId, providerId);

            // OAuth token should be returned, not legacy API key
            expect(result).toBe(oauthToken);
          }
        ),
        { numRuns: 100 }
      );
    });


    test('OAuth credentials from any provider are preferred over legacy keys', async () => {
      await fc.assert(
        fc.asyncProperty(
          providerIdArb,
          tokenStringArb,
          apiKeyArb,
          async (providerId, oauthToken, legacyApiKey) => {
            fc.pre(oauthToken !== legacyApiKey);

            credentialStore.reset();
            tokenManager.reset();

            // Use agent ID that maps to the provider for proper provider detection
            const agentId = agentIdForProvider(providerId);

            // Set up OAuth token (without specifying provider in request)
            tokenManager.setToken(providerId, oauthToken);

            const now = Date.now();
            credentialStore.setCredentials(providerId, {
              providerId,
              accessToken: oauthToken,
              storedAt: now,
            });

            const legacyApiKeys: Record<string, AgentApiKeys> = {
              [agentId]: { apiKey: legacyApiKey, env: {} },
            };

            const authManager = new AuthManager({
              credentialStore,
              tokenManager,
              legacyApiKeys,
            });

            // Request token without specifying provider
            // Agent ID maps to provider, so OAuth token should be found
            const result = await authManager.getTokenForAgent(agentId);

            // OAuth token should be returned (found via agent-to-provider mapping)
            expect(result).toBe(oauthToken);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('legacy API key is used when no OAuth credentials available', async () => {
      await fc.assert(
        fc.asyncProperty(
          agentIdArb,
          apiKeyArb,
          async (agentId, legacyApiKey) => {
            credentialStore.reset();
            tokenManager.reset();

            // No OAuth credentials set up

            const legacyApiKeys: Record<string, AgentApiKeys> = {
              [agentId]: { apiKey: legacyApiKey, env: {} },
            };

            const authManager = new AuthManager({
              credentialStore,
              tokenManager,
              legacyApiKeys,
            });

            const result = await authManager.getTokenForAgent(agentId);

            // Legacy API key should be returned as fallback
            expect(result).toBe(legacyApiKey);
          }
        ),
        { numRuns: 100 }
      );
    });
  });


  /**
   * Feature: oauth-authentication, Property 24: Optional Authentication
   *
   * *For any* agent that does not specify authentication requirements,
   * the auth module SHALL allow the request to proceed without credentials.
   *
   * **Validates: Requirements 10.4**
   */
  describe('Property 24: Optional Authentication', () => {
    let credentialStore: MockCredentialStore;
    let tokenManager: MockTokenManager;

    beforeEach(() => {
      credentialStore = new MockCredentialStore();
      tokenManager = new MockTokenManager();
    });

    test('returns null when no credentials are available (allows request to proceed)', async () => {
      await fc.assert(
        fc.asyncProperty(
          agentIdArb,
          async (agentId) => {
            credentialStore.reset();
            tokenManager.reset();

            // No OAuth credentials and no legacy API keys
            const legacyApiKeys: Record<string, AgentApiKeys> = {};

            const authManager = new AuthManager({
              credentialStore,
              tokenManager,
              legacyApiKeys,
            });

            const result = await authManager.getTokenForAgent(agentId);

            // Should return null (no credentials), allowing request to proceed without auth
            expect(result).toBeNull();
          }
        ),
        { numRuns: 100 }
      );
    });

    test('injectAuth returns original request when no credentials available', async () => {
      await fc.assert(
        fc.asyncProperty(
          agentIdArb,
          fc.record({
            method: fc.constantFrom('GET', 'POST', 'PUT', 'DELETE'),
            url: fc.webUrl(),
          }),
          async (agentId, request) => {
            credentialStore.reset();
            tokenManager.reset();

            const legacyApiKeys: Record<string, AgentApiKeys> = {};

            const authManager = new AuthManager({
              credentialStore,
              tokenManager,
              legacyApiKeys,
            });

            const result = await authManager.injectAuth(agentId, request);

            // Request should be returned unchanged (no auth injected)
            expect(result).toEqual(request);
          }
        ),
        { numRuns: 100 }
      );
    });
  });


  /**
   * Feature: oauth-authentication, Property 25: ACP AuthMethods Advertisement
   *
   * *For any* initialize response from the Registry Launcher, the response
   * SHALL include an `authMethods` array listing supported authentication methods.
   *
   * **Validates: Requirements 11.1**
   *
   * Note: This property is tested at the integration level since it involves
   * the Registry Launcher's initialize response. Here we test that AuthManager
   * provides the necessary status information for building authMethods.
   */
  describe('Property 25: ACP AuthMethods Advertisement', () => {
    let credentialStore: MockCredentialStore;
    let tokenManager: MockTokenManager;

    beforeEach(() => {
      credentialStore = new MockCredentialStore();
      tokenManager = new MockTokenManager();
    });

    test('getStatus returns status for all valid provider IDs', async () => {
      await fc.assert(
        fc.asyncProperty(
          // Random subset of providers to configure
          fc.subarray(VALID_PROVIDER_IDS, { minLength: 0, maxLength: VALID_PROVIDER_IDS.length }),
          async (configuredProviders) => {
            credentialStore.reset();
            tokenManager.reset();

            const now = Date.now();

            // Set up credentials for configured providers
            for (const providerId of configuredProviders) {
              credentialStore.setCredentials(providerId, {
                providerId,
                accessToken: `token-${providerId}`,
                storedAt: now,
              });
              tokenManager.setTokenStatus(providerId, 'authenticated');
            }

            const authManager = new AuthManager({
              credentialStore,
              tokenManager,
              legacyApiKeys: {},
            });

            const status = await authManager.getStatus();

            // Status should include all valid provider IDs
            for (const providerId of VALID_PROVIDER_IDS) {
              expect(status.has(providerId)).toBe(true);
              const entry = status.get(providerId);
              expect(entry).toBeDefined();
              expect(entry!.providerId).toBe(providerId);

              if (configuredProviders.includes(providerId)) {
                // Configured providers should have status from token manager
                expect(['authenticated', 'expired', 'refresh-failed', 'not-configured'])
                  .toContain(entry!.status);
              } else {
                // Unconfigured providers should be 'not-configured'
                expect(entry!.status).toBe('not-configured');
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });


  /**
   * Feature: oauth-authentication, Property 26: AUTH_REQUIRED Error Response
   *
   * *For any* agent request where authentication is required but credentials
   * are not available, the response SHALL be an AUTH_REQUIRED error with
   * the required authentication method specified.
   *
   * **Validates: Requirements 11.2**
   *
   * Note: This property tests that AuthManager correctly reports when
   * re-authentication is required.
   */
  describe('Property 26: AUTH_REQUIRED Error Response', () => {
    let credentialStore: MockCredentialStore;
    let tokenManager: MockTokenManager;

    beforeEach(() => {
      credentialStore = new MockCredentialStore();
      tokenManager = new MockTokenManager();
    });

    test('requiresReauth returns true when no credentials exist', async () => {
      await fc.assert(
        fc.asyncProperty(
          providerIdArb,
          async (providerId) => {
            credentialStore.reset();
            tokenManager.reset();

            const authManager = new AuthManager({
              credentialStore,
              tokenManager,
              legacyApiKeys: {},
            });

            const result = await authManager.requiresReauth(providerId);

            // Should require re-auth when no credentials exist
            expect(result).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('requiresReauth returns false when valid tokens exist', async () => {
      await fc.assert(
        fc.asyncProperty(
          providerIdArb,
          tokenStringArb,
          async (providerId, token) => {
            credentialStore.reset();
            tokenManager.reset();

            // Set up valid tokens
            tokenManager.setToken(providerId, token);

            const now = Date.now();
            credentialStore.setCredentials(providerId, {
              providerId,
              accessToken: token,
              storedAt: now,
            });

            const authManager = new AuthManager({
              credentialStore,
              tokenManager,
              legacyApiKeys: {},
            });

            const result = await authManager.requiresReauth(providerId);

            // Should not require re-auth when valid tokens exist
            expect(result).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });
  });


  /**
   * Feature: oauth-authentication, Property 27: Token Injection by Provider
   *
   * *For any* authenticated request to an agent, the access token SHALL be
   * injected according to the provider's configured token injection method
   * (header, query, or body).
   *
   * **Validates: Requirements 11.4**
   */
  describe('Property 27: Token Injection by Provider', () => {
    let credentialStore: MockCredentialStore;
    let tokenManager: MockTokenManager;
    let mockProviders: Map<AuthProviderId, MockAuthProvider>;

    beforeEach(() => {
      credentialStore = new MockCredentialStore();
      tokenManager = new MockTokenManager();
      mockProviders = new Map();
    });

    test('token is injected into header according to provider config', async () => {
      await fc.assert(
        fc.asyncProperty(
          providerIdArb,
          tokenStringArb,
          fc.constantFrom('Authorization', 'X-API-Key', 'X-Auth-Token'),
          fc.option(fc.constantFrom('Bearer {token}', '{token}', 'Token {token}')),
          async (providerId, token, headerKey, formatOption) => {
            credentialStore.reset();
            tokenManager.reset();
            mockProviders.clear();

            // Use agent ID that maps to the provider
            const agentId = agentIdForProvider(providerId);

            const format = formatOption ?? undefined;
            const injectionMethod: TokenInjectionMethod = {
              type: 'header',
              key: headerKey,
              format,
            };

            // Set up provider with header injection
            const provider = new MockAuthProvider(providerId, `${providerId} Provider`, injectionMethod);
            mockProviders.set(providerId, provider);

            // Set up credentials
            tokenManager.setToken(providerId, token);
            const now = Date.now();
            credentialStore.setCredentials(providerId, {
              providerId,
              accessToken: token,
              storedAt: now,
            });

            const authManager = new AuthManager({
              credentialStore,
              tokenManager,
              legacyApiKeys: {},
              providerResolver: (id) => mockProviders.get(id)!,
            });

            const request = { method: 'POST', url: 'https://api.example.com' };
            const result = await authManager.injectAuth(agentId, request) as Record<string, unknown>;

            // Token should be injected into headers
            expect(result.headers).toBeDefined();
            const headers = result.headers as Record<string, string>;
            expect(headers[headerKey]).toBeDefined();

            // Verify format is applied correctly
            const expectedValue = format ? format.replace('{token}', token) : token;
            expect(headers[headerKey]).toBe(expectedValue);
          }
        ),
        { numRuns: 100 }
      );
    });


    test('token is injected into query according to provider config', async () => {
      await fc.assert(
        fc.asyncProperty(
          providerIdArb,
          tokenStringArb,
          fc.constantFrom('access_token', 'token', 'api_key'),
          async (providerId, token, queryKey) => {
            credentialStore.reset();
            tokenManager.reset();
            mockProviders.clear();

            // Use agent ID that maps to the provider
            const agentId = agentIdForProvider(providerId);

            const injectionMethod: TokenInjectionMethod = {
              type: 'query',
              key: queryKey,
            };

            const provider = new MockAuthProvider(providerId, `${providerId} Provider`, injectionMethod);
            mockProviders.set(providerId, provider);

            tokenManager.setToken(providerId, token);
            const now = Date.now();
            credentialStore.setCredentials(providerId, {
              providerId,
              accessToken: token,
              storedAt: now,
            });

            const authManager = new AuthManager({
              credentialStore,
              tokenManager,
              legacyApiKeys: {},
              providerResolver: (id) => mockProviders.get(id)!,
            });

            const request = { method: 'GET', url: 'https://api.example.com' };
            const result = await authManager.injectAuth(agentId, request) as Record<string, unknown>;

            // Token should be injected into query
            expect(result.query).toBeDefined();
            const query = result.query as Record<string, string>;
            expect(query[queryKey]).toBe(token);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('token is injected into body according to provider config', async () => {
      await fc.assert(
        fc.asyncProperty(
          providerIdArb,
          tokenStringArb,
          fc.constantFrom('access_token', 'token', 'api_key'),
          async (providerId, token, bodyKey) => {
            credentialStore.reset();
            tokenManager.reset();
            mockProviders.clear();

            // Use agent ID that maps to the provider
            const agentId = agentIdForProvider(providerId);

            const injectionMethod: TokenInjectionMethod = {
              type: 'body',
              key: bodyKey,
            };

            const provider = new MockAuthProvider(providerId, `${providerId} Provider`, injectionMethod);
            mockProviders.set(providerId, provider);

            tokenManager.setToken(providerId, token);
            const now = Date.now();
            credentialStore.setCredentials(providerId, {
              providerId,
              accessToken: token,
              storedAt: now,
            });

            const authManager = new AuthManager({
              credentialStore,
              tokenManager,
              legacyApiKeys: {},
              providerResolver: (id) => mockProviders.get(id)!,
            });

            const request = { method: 'POST', url: 'https://api.example.com' };
            const result = await authManager.injectAuth(agentId, request) as Record<string, unknown>;

            // Token should be injected into body
            expect(result.body).toBeDefined();
            const body = result.body as Record<string, string>;
            expect(body[bodyKey]).toBe(token);
          }
        ),
        { numRuns: 100 }
      );
    });


    test('legacy API key uses Bearer header injection', async () => {
      await fc.assert(
        fc.asyncProperty(
          agentIdArb,
          apiKeyArb,
          async (agentId, apiKey) => {
            credentialStore.reset();
            tokenManager.reset();
            mockProviders.clear();

            // No OAuth credentials, only legacy API key
            const legacyApiKeys: Record<string, AgentApiKeys> = {
              [agentId]: { apiKey, env: {} },
            };

            const authManager = new AuthManager({
              credentialStore,
              tokenManager,
              legacyApiKeys,
            });

            const request = { method: 'POST', url: 'https://api.example.com' };
            const result = await authManager.injectAuth(agentId, request) as Record<string, unknown>;

            // Legacy API key should be injected as Bearer header
            expect(result.headers).toBeDefined();
            const headers = result.headers as Record<string, string>;
            expect(headers['Authorization']).toBe(`Bearer ${apiKey}`);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('existing headers are preserved when injecting token', async () => {
      await fc.assert(
        fc.asyncProperty(
          providerIdArb,
          tokenStringArb,
          fc.record({
            'Content-Type': fc.constantFrom('application/json', 'text/plain'),
            'Accept': fc.constantFrom('application/json', '*/*'),
          }),
          async (providerId, token, existingHeaders) => {
            credentialStore.reset();
            tokenManager.reset();
            mockProviders.clear();

            // Use agent ID that maps to the provider
            const agentId = agentIdForProvider(providerId);

            const injectionMethod: TokenInjectionMethod = {
              type: 'header',
              key: 'Authorization',
              format: 'Bearer {token}',
            };

            const provider = new MockAuthProvider(providerId, `${providerId} Provider`, injectionMethod);
            mockProviders.set(providerId, provider);

            tokenManager.setToken(providerId, token);
            const now = Date.now();
            credentialStore.setCredentials(providerId, {
              providerId,
              accessToken: token,
              storedAt: now,
            });

            const authManager = new AuthManager({
              credentialStore,
              tokenManager,
              legacyApiKeys: {},
              providerResolver: (id) => mockProviders.get(id)!,
            });

            const request = {
              method: 'POST',
              url: 'https://api.example.com',
              headers: existingHeaders,
            };
            const result = await authManager.injectAuth(agentId, request) as Record<string, unknown>;

            // Existing headers should be preserved
            const headers = result.headers as Record<string, string>;
            expect(headers['Content-Type']).toBe(existingHeaders['Content-Type']);
            expect(headers['Accept']).toBe(existingHeaders['Accept']);
            // Auth header should be added
            expect(headers['Authorization']).toBe(`Bearer ${token}`);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
