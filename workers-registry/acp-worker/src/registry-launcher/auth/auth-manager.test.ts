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
 * Unit tests for Auth Manager module.
 *
 * Tests flow orchestration, credential precedence, and status reporting.
 *
 * **Validates: Requirements 3.1, 4.1, 10.1, 10.2, 10.3, 10.4, 11.1, 11.2, 11.4**
 *
 * @module auth-manager.test
 */

import { AuthManager, createAuthManager } from './auth-manager';
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
 */
class MockCredentialStore implements ICredentialStore {
  private credentials = new Map<AuthProviderId, StoredCredentials>();

  async store(providerId: AuthProviderId, credentials: StoredCredentials): Promise<void> {
    this.credentials.set(providerId, { ...credentials });
  }

  async retrieve(providerId: AuthProviderId): Promise<StoredCredentials | null> {
    const creds = this.credentials.get(providerId);
    return creds ? { ...creds } : null;
  }

  async delete(providerId: AuthProviderId): Promise<void> {
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

  hasCredentials(providerId: AuthProviderId): boolean {
    return this.credentials.has(providerId);
  }

  reset(): void {
    this.credentials.clear();
  }
}


/**
 * Mock token manager for testing.
 */
class MockTokenManager implements ITokenManager {
  private tokens = new Map<AuthProviderId, string>();
  private tokenStatus = new Map<AuthProviderId, TokenStatus>();
  private validTokens = new Set<AuthProviderId>();
  public storeTokensCallCount = 0;
  public clearTokensCallCount = 0;

  async getAccessToken(providerId: AuthProviderId): Promise<string | null> {
    return this.tokens.get(providerId) ?? null;
  }

  async storeTokens(providerId: AuthProviderId, tokens: TokenResponse): Promise<void> {
    this.storeTokensCallCount++;
    this.tokens.set(providerId, tokens.accessToken);
    this.validTokens.add(providerId);
  }

  async hasValidTokens(providerId: AuthProviderId): Promise<boolean> {
    return this.validTokens.has(providerId);
  }

  async forceRefresh(providerId: AuthProviderId): Promise<string | null> {
    return this.tokens.get(providerId) ?? null;
  }

  async clearTokens(providerId: AuthProviderId): Promise<void> {
    this.clearTokensCallCount++;
    this.tokens.delete(providerId);
    this.validTokens.delete(providerId);
  }

  async getStatus(): Promise<Map<AuthProviderId, TokenStatus>> {
    return new Map(this.tokenStatus);
  }

  setToken(providerId: AuthProviderId, token: string): void {
    this.tokens.set(providerId, token);
    this.validTokens.add(providerId);
  }

  setTokenStatus(providerId: AuthProviderId, status: TokenStatus): void {
    this.tokenStatus.set(providerId, status);
  }

  setValidTokens(providerId: AuthProviderId, valid: boolean): void {
    if (valid) {
      this.validTokens.add(providerId);
    } else {
      this.validTokens.delete(providerId);
    }
  }

  reset(): void {
    this.tokens.clear();
    this.tokenStatus.clear();
    this.validTokens.clear();
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
}


describe('Auth Manager Unit Tests', () => {
  let credentialStore: MockCredentialStore;
  let tokenManager: MockTokenManager;
  let mockProviders: Map<AuthProviderId, MockAuthProvider>;

  beforeEach(() => {
    credentialStore = new MockCredentialStore();
    tokenManager = new MockTokenManager();
    mockProviders = new Map();

    // Set up default providers
    const providers: AuthProviderId[] = ['openai', 'github', 'google', 'cognito', 'azure', 'anthropic'];
    for (const id of providers) {
      mockProviders.set(id, new MockAuthProvider(id));
    }
  });

  afterEach(() => {
    credentialStore.reset();
    tokenManager.reset();
    mockProviders.clear();
  });

  describe('Constructor', () => {
    it('should create AuthManager with options object', () => {
      const authManager = new AuthManager({
        credentialStore,
        tokenManager,
        legacyApiKeys: {},
      });

      expect(authManager).toBeInstanceOf(AuthManager);
    });

    it('should create AuthManager with legacy constructor signature', () => {
      const authManager = new AuthManager(credentialStore, tokenManager, {});

      expect(authManager).toBeInstanceOf(AuthManager);
    });

    it('should create AuthManager using factory function', () => {
      const authManager = createAuthManager({
        credentialStore,
        tokenManager,
        legacyApiKeys: {},
      });

      expect(authManager).toBeInstanceOf(AuthManager);
    });
  });


  describe('getTokenForAgent - Credential Precedence (Requirement 10.3)', () => {
    it('should return OAuth token when both OAuth and legacy credentials exist', async () => {
      const now = Date.now();
      credentialStore.setCredentials('openai', {
        providerId: 'openai',
        accessToken: 'oauth-token',
        storedAt: now,
      });
      tokenManager.setToken('openai', 'oauth-token');

      const legacyApiKeys: Record<string, AgentApiKeys> = {
        'test-agent': { apiKey: 'legacy-api-key', env: {} },
      };

      const authManager = new AuthManager({
        credentialStore,
        tokenManager,
        legacyApiKeys,
      });

      const result = await authManager.getTokenForAgent('test-agent', 'openai');

      expect(result).toBe('oauth-token');
    });

    it('should return legacy API key when no OAuth credentials exist', async () => {
      const legacyApiKeys: Record<string, AgentApiKeys> = {
        'test-agent': { apiKey: 'legacy-api-key', env: {} },
      };

      const authManager = new AuthManager({
        credentialStore,
        tokenManager,
        legacyApiKeys,
      });

      const result = await authManager.getTokenForAgent('test-agent');

      expect(result).toBe('legacy-api-key');
    });

    it('should return null when no credentials exist', async () => {
      const authManager = new AuthManager({
        credentialStore,
        tokenManager,
        legacyApiKeys: {},
      });

      const result = await authManager.getTokenForAgent('test-agent');

      expect(result).toBeNull();
    });

    it('should find OAuth token from any configured provider when no provider specified', async () => {
      const now = Date.now();
      credentialStore.setCredentials('github', {
        providerId: 'github',
        accessToken: 'github-oauth-token',
        storedAt: now,
      });
      tokenManager.setToken('github', 'github-oauth-token');

      const authManager = new AuthManager({
        credentialStore,
        tokenManager,
        legacyApiKeys: {},
      });

      // Use agent ID that maps to github provider
      const result = await authManager.getTokenForAgent('github-agent');

      expect(result).toBe('github-oauth-token');
    });
  });


  describe('injectAuth - Token Injection (Requirement 11.4)', () => {
    it('should inject token into header with Bearer format', async () => {
      const now = Date.now();
      credentialStore.setCredentials('openai', {
        providerId: 'openai',
        accessToken: 'test-token',
        storedAt: now,
      });
      tokenManager.setToken('openai', 'test-token');

      const provider = new MockAuthProvider('openai', 'OpenAI', {
        type: 'header',
        key: 'Authorization',
        format: 'Bearer {token}',
      });
      mockProviders.set('openai', provider);

      const authManager = new AuthManager({
        credentialStore,
        tokenManager,
        legacyApiKeys: {},
        providerResolver: (id) => mockProviders.get(id)!,
      });

      const request = { method: 'POST', url: 'https://api.openai.com' };
      // Use agent ID that maps to openai provider
      const result = await authManager.injectAuth('openai-agent', request) as Record<string, unknown>;

      expect(result.headers).toBeDefined();
      const headers = result.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer test-token');
    });

    it('should inject token into query parameter', async () => {
      const now = Date.now();
      credentialStore.setCredentials('github', {
        providerId: 'github',
        accessToken: 'github-token',
        storedAt: now,
      });
      tokenManager.setToken('github', 'github-token');

      const provider = new MockAuthProvider('github', 'GitHub', {
        type: 'query',
        key: 'access_token',
      });
      mockProviders.set('github', provider);

      const authManager = new AuthManager({
        credentialStore,
        tokenManager,
        legacyApiKeys: {},
        providerResolver: (id) => mockProviders.get(id)!,
      });

      const request = { method: 'GET', url: 'https://api.github.com' };
      // Use agent ID that maps to github provider
      const result = await authManager.injectAuth('github-agent', request) as Record<string, unknown>;

      expect(result.query).toBeDefined();
      const query = result.query as Record<string, string>;
      expect(query['access_token']).toBe('github-token');
    });

    it('should inject token into body', async () => {
      const now = Date.now();
      credentialStore.setCredentials('google', {
        providerId: 'google',
        accessToken: 'google-token',
        storedAt: now,
      });
      tokenManager.setToken('google', 'google-token');

      const provider = new MockAuthProvider('google', 'Google', {
        type: 'body',
        key: 'token',
      });
      mockProviders.set('google', provider);

      const authManager = new AuthManager({
        credentialStore,
        tokenManager,
        legacyApiKeys: {},
        providerResolver: (id) => mockProviders.get(id)!,
      });

      const request = { method: 'POST', url: 'https://api.google.com' };
      // Use agent ID that maps to google provider
      const result = await authManager.injectAuth('google-agent', request) as Record<string, unknown>;

      expect(result.body).toBeDefined();
      const body = result.body as Record<string, string>;
      expect(body['token']).toBe('google-token');
    });

    it('should preserve existing request properties', async () => {
      const now = Date.now();
      credentialStore.setCredentials('openai', {
        providerId: 'openai',
        accessToken: 'test-token',
        storedAt: now,
      });
      tokenManager.setToken('openai', 'test-token');

      const provider = new MockAuthProvider('openai', 'OpenAI', {
        type: 'header',
        key: 'Authorization',
        format: 'Bearer {token}',
      });
      mockProviders.set('openai', provider);

      const authManager = new AuthManager({
        credentialStore,
        tokenManager,
        legacyApiKeys: {},
        providerResolver: (id) => mockProviders.get(id)!,
      });

      const request = {
        method: 'POST',
        url: 'https://api.openai.com',
        headers: { 'Content-Type': 'application/json' },
        body: { data: 'test' },
      };
      // Use agent ID that maps to openai provider
      const result = await authManager.injectAuth('openai-agent', request) as Record<string, unknown>;

      expect(result.method).toBe('POST');
      expect(result.url).toBe('https://api.openai.com');
      expect((result.body as Record<string, unknown>).data).toBe('test');
      const headers = result.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['Authorization']).toBe('Bearer test-token');
    });

    it('should return original request when no credentials available', async () => {
      const authManager = new AuthManager({
        credentialStore,
        tokenManager,
        legacyApiKeys: {},
      });

      const request = { method: 'GET', url: 'https://api.example.com' };
      const result = await authManager.injectAuth('test-agent', request);

      expect(result).toEqual(request);
    });

    it('should use legacy API key with Bearer header when no OAuth credentials', async () => {
      const legacyApiKeys: Record<string, AgentApiKeys> = {
        'test-agent': { apiKey: 'legacy-key', env: {} },
      };

      const authManager = new AuthManager({
        credentialStore,
        tokenManager,
        legacyApiKeys,
      });

      const request = { method: 'POST', url: 'https://api.example.com' };
      const result = await authManager.injectAuth('test-agent', request) as Record<string, unknown>;

      expect(result.headers).toBeDefined();
      const headers = result.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer legacy-key');
    });
  });


  describe('getStatus - Status Reporting (Requirement 11.1)', () => {
    it('should return status for all valid provider IDs', async () => {
      const authManager = new AuthManager({
        credentialStore,
        tokenManager,
        legacyApiKeys: {},
      });

      const status = await authManager.getStatus();

      // Should include all valid provider IDs
      expect(status.has('openai')).toBe(true);
      expect(status.has('github')).toBe(true);
      expect(status.has('google')).toBe(true);
      expect(status.has('cognito')).toBe(true);
      expect(status.has('azure')).toBe(true);
      expect(status.has('anthropic')).toBe(true);
    });

    it('should return not-configured for providers without credentials', async () => {
      const authManager = new AuthManager({
        credentialStore,
        tokenManager,
        legacyApiKeys: {},
      });

      const status = await authManager.getStatus();

      for (const [, entry] of status) {
        expect(entry.status).toBe('not-configured');
      }
    });

    it('should return authenticated status for providers with valid tokens', async () => {
      const now = Date.now();
      credentialStore.setCredentials('openai', {
        providerId: 'openai',
        accessToken: 'valid-token',
        expiresAt: now + 3600000,
        storedAt: now,
      });
      tokenManager.setTokenStatus('openai', 'authenticated');

      const authManager = new AuthManager({
        credentialStore,
        tokenManager,
        legacyApiKeys: {},
      });

      const status = await authManager.getStatus();

      const openaiStatus = status.get('openai');
      expect(openaiStatus).toBeDefined();
      expect(openaiStatus!.status).toBe('authenticated');
    });

    it('should include expiration and scope information', async () => {
      const now = Date.now();
      const expiresAt = now + 3600000;
      credentialStore.setCredentials('openai', {
        providerId: 'openai',
        accessToken: 'valid-token',
        expiresAt,
        scope: 'openid profile',
        storedAt: now,
      });
      tokenManager.setTokenStatus('openai', 'authenticated');

      const authManager = new AuthManager({
        credentialStore,
        tokenManager,
        legacyApiKeys: {},
      });

      const status = await authManager.getStatus();

      const openaiStatus = status.get('openai');
      expect(openaiStatus).toBeDefined();
      expect(openaiStatus!.expiresAt).toBe(expiresAt);
      expect(openaiStatus!.scope).toBe('openid profile');
    });
  });


  describe('requiresReauth - Auth Required Detection (Requirement 11.2)', () => {
    it('should return true when no credentials exist', async () => {
      const authManager = new AuthManager({
        credentialStore,
        tokenManager,
        legacyApiKeys: {},
      });

      const result = await authManager.requiresReauth('openai');

      expect(result).toBe(true);
    });

    it('should return false when valid tokens exist', async () => {
      const now = Date.now();
      credentialStore.setCredentials('openai', {
        providerId: 'openai',
        accessToken: 'valid-token',
        storedAt: now,
      });
      tokenManager.setValidTokens('openai', true);

      const authManager = new AuthManager({
        credentialStore,
        tokenManager,
        legacyApiKeys: {},
      });

      const result = await authManager.requiresReauth('openai');

      expect(result).toBe(false);
    });

    it('should return true when tokens are invalid and refresh fails', async () => {
      const now = Date.now();
      credentialStore.setCredentials('openai', {
        providerId: 'openai',
        accessToken: 'expired-token',
        storedAt: now,
      });
      tokenManager.setValidTokens('openai', false);
      // forceRefresh returns null (simulating failure)

      const authManager = new AuthManager({
        credentialStore,
        tokenManager,
        legacyApiKeys: {},
      });

      const result = await authManager.requiresReauth('openai');

      expect(result).toBe(true);
    });
  });


  describe('logout', () => {
    it('should clear tokens and credentials for specific provider', async () => {
      const now = Date.now();
      credentialStore.setCredentials('openai', {
        providerId: 'openai',
        accessToken: 'openai-token',
        storedAt: now,
      });
      credentialStore.setCredentials('github', {
        providerId: 'github',
        accessToken: 'github-token',
        storedAt: now,
      });
      tokenManager.setToken('openai', 'openai-token');
      tokenManager.setToken('github', 'github-token');

      const authManager = new AuthManager({
        credentialStore,
        tokenManager,
        legacyApiKeys: {},
      });

      await authManager.logout('openai');

      expect(tokenManager.clearTokensCallCount).toBe(1);
      expect(credentialStore.hasCredentials('openai')).toBe(false);
      expect(credentialStore.hasCredentials('github')).toBe(true);
    });

    it('should clear all tokens and credentials when no provider specified', async () => {
      const now = Date.now();
      credentialStore.setCredentials('openai', {
        providerId: 'openai',
        accessToken: 'openai-token',
        storedAt: now,
      });
      credentialStore.setCredentials('github', {
        providerId: 'github',
        accessToken: 'github-token',
        storedAt: now,
      });
      tokenManager.setToken('openai', 'openai-token');
      tokenManager.setToken('github', 'github-token');

      const authManager = new AuthManager({
        credentialStore,
        tokenManager,
        legacyApiKeys: {},
      });

      await authManager.logout();

      expect(tokenManager.clearTokensCallCount).toBe(2);
      expect(credentialStore.hasCredentials('openai')).toBe(false);
      expect(credentialStore.hasCredentials('github')).toBe(false);
    });
  });


  describe('authenticateAgent - Flow Orchestration (Requirement 3.1)', () => {
    it('should return error for unsupported provider ID', async () => {
      const authManager = new AuthManager({
        credentialStore,
        tokenManager,
        legacyApiKeys: {},
      });

      const result = await authManager.authenticateAgent('invalid-provider' as AuthProviderId);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('UNSUPPORTED_PROVIDER');
        expect(result.error.message).toContain('not supported');
      }
    });

    it('should return error for unregistered provider', async () => {
      const authManager = new AuthManager({
        credentialStore,
        tokenManager,
        legacyApiKeys: {},
      });

      const result = await authManager.authenticateAgent('openai');

      // The provider is valid but not registered
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('UNSUPPORTED_PROVIDER');
      }
    });
  });

  describe('setupTerminal - Terminal Flow Orchestration (Requirement 4.1)', () => {
    it('should return error for unsupported provider ID', async () => {
      const authManager = new AuthManager({
        credentialStore,
        tokenManager,
        legacyApiKeys: {},
      });

      const result = await authManager.setupTerminal('invalid-provider' as AuthProviderId);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('UNSUPPORTED_PROVIDER');
        expect(result.error.message).toContain('not supported');
      }
    });
  });


  describe('getProviderForAgent', () => {
    it('should return openai for agent IDs containing openai', () => {
      const authManager = new AuthManager({
        credentialStore,
        tokenManager,
        legacyApiKeys: {},
      });

      expect(authManager.getProviderForAgent('openai-agent')).toBe('openai');
      expect(authManager.getProviderForAgent('my-openai-bot')).toBe('openai');
      expect(authManager.getProviderForAgent('gpt-4-agent')).toBe('openai');
    });

    it('should return anthropic for agent IDs containing anthropic or claude', () => {
      const authManager = new AuthManager({
        credentialStore,
        tokenManager,
        legacyApiKeys: {},
      });

      expect(authManager.getProviderForAgent('anthropic-agent')).toBe('anthropic');
      expect(authManager.getProviderForAgent('claude-3-bot')).toBe('anthropic');
    });

    it('should return github for agent IDs containing github or copilot', () => {
      const authManager = new AuthManager({
        credentialStore,
        tokenManager,
        legacyApiKeys: {},
      });

      expect(authManager.getProviderForAgent('github-agent')).toBe('github');
      expect(authManager.getProviderForAgent('copilot-assistant')).toBe('github');
    });

    it('should return google for agent IDs containing google or gemini', () => {
      const authManager = new AuthManager({
        credentialStore,
        tokenManager,
        legacyApiKeys: {},
      });

      expect(authManager.getProviderForAgent('google-agent')).toBe('google');
      expect(authManager.getProviderForAgent('gemini-pro')).toBe('google');
    });

    it('should return azure for agent IDs containing azure', () => {
      const authManager = new AuthManager({
        credentialStore,
        tokenManager,
        legacyApiKeys: {},
      });

      expect(authManager.getProviderForAgent('azure-agent')).toBe('azure');
    });

    it('should return cognito for agent IDs containing cognito or aws', () => {
      const authManager = new AuthManager({
        credentialStore,
        tokenManager,
        legacyApiKeys: {},
      });

      expect(authManager.getProviderForAgent('cognito-agent')).toBe('cognito');
      expect(authManager.getProviderForAgent('aws-bedrock')).toBe('cognito');
    });

    it('should return undefined for unrecognized agent IDs', () => {
      const authManager = new AuthManager({
        credentialStore,
        tokenManager,
        legacyApiKeys: {},
      });

      expect(authManager.getProviderForAgent('custom-agent')).toBeUndefined();
      expect(authManager.getProviderForAgent('my-bot')).toBeUndefined();
    });
  });


  describe('Optional Authentication (Requirement 10.4)', () => {
    it('should allow requests without credentials for agents without auth requirements', async () => {
      const authManager = new AuthManager({
        credentialStore,
        tokenManager,
        legacyApiKeys: {},
      });

      // No credentials configured
      const token = await authManager.getTokenForAgent('no-auth-agent');

      // Should return null, allowing request to proceed without auth
      expect(token).toBeNull();
    });

    it('should not inject auth when no credentials available', async () => {
      const authManager = new AuthManager({
        credentialStore,
        tokenManager,
        legacyApiKeys: {},
      });

      const request = { method: 'GET', url: 'https://api.example.com' };
      const result = await authManager.injectAuth('no-auth-agent', request);

      // Request should be unchanged
      expect(result).toEqual(request);
      expect((result as Record<string, unknown>).headers).toBeUndefined();
    });
  });

  describe('Backward Compatibility (Requirements 10.1, 10.2)', () => {
    it('should support legacy api-keys.json format', async () => {
      const legacyApiKeys: Record<string, AgentApiKeys> = {
        'legacy-agent': { apiKey: 'sk-legacy-key-12345', env: {} },
      };

      const authManager = new AuthManager({
        credentialStore,
        tokenManager,
        legacyApiKeys,
      });

      const token = await authManager.getTokenForAgent('legacy-agent');

      expect(token).toBe('sk-legacy-key-12345');
    });

    it('should work with empty legacy api keys', async () => {
      const authManager = new AuthManager({
        credentialStore,
        tokenManager,
        legacyApiKeys: {},
      });

      const token = await authManager.getTokenForAgent('any-agent');

      expect(token).toBeNull();
    });
  });


  describe('Security - Marker Token Filtering', () => {
    it('should filter out marker tokens in getTokenForAgent', async () => {
      // Set up a marker token (simulating terminal auth flow)
      tokenManager.setToken('openai', '__CLIENT_CREDENTIALS_CONFIGURED__');

      const authManager = new AuthManager({
        credentialStore,
        tokenManager,
        legacyApiKeys: {},
      });

      // Should return null because marker token is not a real token
      const result = await authManager.getTokenForAgent('openai-agent', 'openai');

      expect(result).toBeNull();
    });

    it('should filter out marker tokens in injectAuth', async () => {
      // Set up a marker token
      tokenManager.setToken('openai', '__CLIENT_CREDENTIALS_CONFIGURED__');

      const provider = new MockAuthProvider('openai', 'OpenAI', {
        type: 'header',
        key: 'Authorization',
        format: 'Bearer {token}',
      });
      mockProviders.set('openai', provider);

      const authManager = new AuthManager({
        credentialStore,
        tokenManager,
        legacyApiKeys: {},
        providerResolver: (id) => mockProviders.get(id)!,
      });

      const request = { method: 'POST', url: 'https://api.openai.com' };
      const result = await authManager.injectAuth('openai-agent', request);

      // Request should be unchanged (no auth injected)
      expect(result).toEqual(request);
      expect((result as Record<string, unknown>).headers).toBeUndefined();
    });

    it('should fall back to legacy key when marker token is present', async () => {
      // Set up a marker token
      tokenManager.setToken('openai', '__CLIENT_CREDENTIALS_CONFIGURED__');

      const legacyApiKeys: Record<string, AgentApiKeys> = {
        'openai-agent': { apiKey: 'sk-legacy-key', env: {} },
      };

      const authManager = new AuthManager({
        credentialStore,
        tokenManager,
        legacyApiKeys,
      });

      // Should fall back to legacy key
      const result = await authManager.getTokenForAgent('openai-agent', 'openai');

      expect(result).toBe('sk-legacy-key');
    });
  });


  describe('Security - Control Character Rejection', () => {
    it('should reject tokens with control characters in injectAuth', async () => {
      // Set up a token with control characters
      tokenManager.setToken('openai', 'token-with\r\ncontrol-chars');

      const provider = new MockAuthProvider('openai', 'OpenAI', {
        type: 'header',
        key: 'Authorization',
        format: 'Bearer {token}',
      });
      mockProviders.set('openai', provider);

      const authManager = new AuthManager({
        credentialStore,
        tokenManager,
        legacyApiKeys: {},
        providerResolver: (id) => mockProviders.get(id)!,
      });

      const request = { method: 'POST', url: 'https://api.openai.com' };
      const result = await authManager.injectAuth('openai-agent', request);

      // Request should be unchanged (no auth injected due to control chars)
      expect(result).toEqual(request);
      expect((result as Record<string, unknown>).headers).toBeUndefined();
    });

    it('should reject legacy keys with control characters', async () => {
      const legacyApiKeys: Record<string, AgentApiKeys> = {
        'test-agent': { apiKey: 'key-with\x00null-char', env: {} },
      };

      const authManager = new AuthManager({
        credentialStore,
        tokenManager,
        legacyApiKeys,
      });

      const request = { method: 'POST', url: 'https://api.example.com' };
      const result = await authManager.injectAuth('test-agent', request);

      // Request should be unchanged (no auth injected due to control chars)
      expect(result).toEqual(request);
      expect((result as Record<string, unknown>).headers).toBeUndefined();
    });
  });


  describe('Security - Logout Validation', () => {
    it('should throw error for invalid provider ID in logout', async () => {
      const authManager = new AuthManager({
        credentialStore,
        tokenManager,
        legacyApiKeys: {},
      });

      await expect(authManager.logout('invalid-provider' as AuthProviderId))
        .rejects.toThrow('Invalid provider ID for logout: invalid-provider');
    });

    it('should not throw for valid provider ID in logout', async () => {
      const now = Date.now();
      credentialStore.setCredentials('openai', {
        providerId: 'openai',
        accessToken: 'test-token',
        storedAt: now,
      });
      tokenManager.setToken('openai', 'test-token');

      const authManager = new AuthManager({
        credentialStore,
        tokenManager,
        legacyApiKeys: {},
      });

      // Should not throw
      await expect(authManager.logout('openai')).resolves.toBeUndefined();
    });
  });


  describe('Method Precedence Strategy (Requirements 3.1, 10.3)', () => {
    describe('Default Precedence: oauth2 > api-key', () => {
      it('should select oauth2 when both OAuth and API key are available', async () => {
        // Set up OAuth token
        tokenManager.setToken('openai', 'oauth-token');

        // Set up legacy API key
        const legacyApiKeys: Record<string, AgentApiKeys> = {
          'openai-agent': { apiKey: 'legacy-api-key', env: {} },
        };

        const authManager = new AuthManager({
          credentialStore,
          tokenManager,
          legacyApiKeys,
        });

        const result = await authManager.selectAuthMethod('openai-agent');

        expect(result.methodType).toBe('oauth2');
        expect(result.providerId).toBe('openai');
        expect(result.hasCredential).toBe(true);
      });

      it('should fall back to api-key when OAuth is not available', async () => {
        // No OAuth token set up

        // Set up legacy API key
        const legacyApiKeys: Record<string, AgentApiKeys> = {
          'test-agent': { apiKey: 'legacy-api-key', env: {} },
        };

        const authManager = new AuthManager({
          credentialStore,
          tokenManager,
          legacyApiKeys,
        });

        const result = await authManager.selectAuthMethod('test-agent');

        expect(result.methodType).toBe('api-key');
        expect(result.hasCredential).toBe(true);
      });

      it('should return no credentials when neither OAuth nor API key available', async () => {
        const authManager = new AuthManager({
          credentialStore,
          tokenManager,
          legacyApiKeys: {},
        });

        const result = await authManager.selectAuthMethod('unknown-agent');

        expect(result.hasCredential).toBe(false);
        expect(result.error).toContain('No credentials available');
      });
    });


    describe('Configuration Override via AuthConfig', () => {
      it('should respect custom method precedence (api-key > oauth2)', async () => {
        // Set up OAuth token
        tokenManager.setToken('openai', 'oauth-token');

        // Set up legacy API key
        const legacyApiKeys: Record<string, AgentApiKeys> = {
          'openai-agent': { apiKey: 'legacy-api-key', env: {} },
        };

        const authManager = new AuthManager({
          credentialStore,
          tokenManager,
          legacyApiKeys,
          methodPrecedence: {
            methodPrecedence: ['api-key', 'oauth2'], // Reversed precedence
          },
        });

        const result = await authManager.selectAuthMethod('openai-agent');

        // Should select api-key first due to custom precedence
        expect(result.methodType).toBe('api-key');
        expect(result.hasCredential).toBe(true);
      });

      it('should use default precedence when not configured', async () => {
        const authManager = new AuthManager({
          credentialStore,
          tokenManager,
          legacyApiKeys: {},
        });

        const config = authManager.getMethodPrecedenceConfig();

        expect(config.methodPrecedence).toEqual(['oauth2', 'api-key']);
        expect(config.failFastOnUnsupported).toBe(true);
        expect(config.failFastOnAmbiguous).toBe(true);
      });

      it('should merge partial config with defaults', async () => {
        const authManager = new AuthManager({
          credentialStore,
          tokenManager,
          legacyApiKeys: {},
          methodPrecedence: {
            failFastOnAmbiguous: false, // Only override this
          },
        });

        const config = authManager.getMethodPrecedenceConfig();

        expect(config.methodPrecedence).toEqual(['oauth2', 'api-key']); // Default
        expect(config.failFastOnUnsupported).toBe(true); // Default
        expect(config.failFastOnAmbiguous).toBe(false); // Overridden
      });
    });


    describe('Fail-Fast on Unsupported Provider', () => {
      it('should throw error for invalid provider ID when failFastOnUnsupported is true', async () => {
        const authManager = new AuthManager({
          credentialStore,
          tokenManager,
          legacyApiKeys: {},
          methodPrecedence: {
            failFastOnUnsupported: true,
          },
        });

        await expect(
          authManager.selectAuthMethod('test-agent', undefined, 'invalid-provider' as AuthProviderId)
        ).rejects.toThrow("Provider 'invalid-provider' is not supported");
      });

      it('should return error result for invalid provider when failFastOnUnsupported is false', async () => {
        const authManager = new AuthManager({
          credentialStore,
          tokenManager,
          legacyApiKeys: {},
          methodPrecedence: {
            failFastOnUnsupported: false,
          },
        });

        const result = await authManager.selectAuthMethod(
          'test-agent',
          undefined,
          'invalid-provider' as AuthProviderId
        );

        expect(result.hasCredential).toBe(false);
        expect(result.error).toContain('not supported');
      });
    });


    describe('Fail-Fast on Ambiguous Provider', () => {
      it('should throw error for ambiguous agent ID when failFastOnAmbiguous is true', async () => {
        const authManager = new AuthManager({
          credentialStore,
          tokenManager,
          legacyApiKeys: {},
          methodPrecedence: {
            failFastOnAmbiguous: true,
          },
        });

        // Agent ID that matches multiple providers (azure and openai)
        await expect(
          authManager.selectAuthMethod('azure-openai-agent')
        ).rejects.toThrow('Ambiguous provider mapping');
      });

      it('should not throw for ambiguous agent ID when failFastOnAmbiguous is false', async () => {
        const authManager = new AuthManager({
          credentialStore,
          tokenManager,
          legacyApiKeys: {},
          methodPrecedence: {
            failFastOnAmbiguous: false,
          },
        });

        // Should not throw, will use first matching provider
        const result = await authManager.selectAuthMethod('azure-openai-agent');

        // Result will indicate no credentials (since none are set up)
        expect(result.hasCredential).toBe(false);
      });

      it('should not throw for unambiguous agent ID', async () => {
        const authManager = new AuthManager({
          credentialStore,
          tokenManager,
          legacyApiKeys: {},
          methodPrecedence: {
            failFastOnAmbiguous: true,
          },
        });

        // Agent ID that matches only one provider
        const result = await authManager.selectAuthMethod('github-agent');

        // Should not throw, just indicate no credentials
        // Note: providerId is only set when OAuth method is tried, even if no token available
        expect(result.hasCredential).toBe(false);
        // The method tried oauth2 first, found github provider but no token
        expect(result.error).toContain('No credentials available');
      });

      it('should not check ambiguity when explicit providerId is specified', async () => {
        tokenManager.setToken('openai', 'oauth-token');

        const authManager = new AuthManager({
          credentialStore,
          tokenManager,
          legacyApiKeys: {},
          methodPrecedence: {
            failFastOnAmbiguous: true,
          },
        });

        // Even with ambiguous agent ID, explicit providerId should work
        const result = await authManager.selectAuthMethod(
          'azure-openai-agent',
          undefined,
          'openai'
        );

        expect(result.methodType).toBe('oauth2');
        expect(result.providerId).toBe('openai');
        expect(result.hasCredential).toBe(true);
      });
    });


    describe('Available Methods Filtering', () => {
      it('should only consider methods in availableMethods list', async () => {
        // Set up OAuth token
        tokenManager.setToken('openai', 'oauth-token');

        // Set up legacy API key
        const legacyApiKeys: Record<string, AgentApiKeys> = {
          'openai-agent': { apiKey: 'legacy-api-key', env: {} },
        };

        const authManager = new AuthManager({
          credentialStore,
          tokenManager,
          legacyApiKeys,
        });

        // Only allow api-key method
        const result = await authManager.selectAuthMethod('openai-agent', ['api-key']);

        // Should select api-key even though OAuth is available
        expect(result.methodType).toBe('api-key');
        expect(result.hasCredential).toBe(true);
      });

      it('should return no credentials when availableMethods excludes all configured methods', async () => {
        // Set up legacy API key only
        const legacyApiKeys: Record<string, AgentApiKeys> = {
          'test-agent': { apiKey: 'legacy-api-key', env: {} },
        };

        const authManager = new AuthManager({
          credentialStore,
          tokenManager,
          legacyApiKeys,
        });

        // Only allow oauth2 method, but no OAuth is configured
        const result = await authManager.selectAuthMethod('test-agent', ['oauth2']);

        expect(result.hasCredential).toBe(false);
      });
    });


    describe('getMethodPrecedenceConfig', () => {
      it('should return a copy of the configuration', () => {
        const authManager = new AuthManager({
          credentialStore,
          tokenManager,
          legacyApiKeys: {},
        });

        const config1 = authManager.getMethodPrecedenceConfig();
        const config2 = authManager.getMethodPrecedenceConfig();

        // Should be equal but not the same object
        expect(config1).toEqual(config2);
        expect(config1).not.toBe(config2);
      });
    });
  });
});
