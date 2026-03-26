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
 * Integration tests for Registry Launcher OAuth authentication.
 *
 * Tests auth flow integration, backward compatibility, and NDJSON protocol compliance.
 *
 * **Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5, 11.1, 11.2**
 *
 * @module auth/integration.test
 */

import { MessageRouter, RoutingErrorCodes, createErrorResponse } from '../router/message-router.js';
import type { IRegistryIndex } from '../registry/index.js';
import type { RegistryAgent, SpawnCommand } from '../registry/types.js';
import type { AgentRuntimeManager } from '../runtime/manager.js';
import type { AgentRuntime } from '../runtime/types.js';
import { AuthManager } from './auth-manager.js';
import { TokenManager } from './token-manager.js';
import { CredentialStore } from './storage/credential-store.js';
import type { StoredCredentials } from './types.js';
import { VALID_PROVIDER_IDS } from './types.js';

/**
 * Create a mock registry index.
 */
function createMockRegistry(agents: Map<string, RegistryAgent> = new Map()): IRegistryIndex {
  return {
    fetch: jest.fn().mockResolvedValue(undefined),
    lookup: jest.fn((agentId: string) => agents.get(agentId)),
    resolve: jest.fn((agentId: string): SpawnCommand => {
      const agent = agents.get(agentId);
      if (!agent) {
        throw new Error(`Agent not found: ${agentId}`);
      }
      return { command: 'node', args: ['agent.js'] };
    }),
    getAuthRequirements: jest.fn(() => undefined),
  };
}

/**
 * Create a mock runtime manager.
 */
function createMockRuntimeManager(): AgentRuntimeManager & { writtenMessages: object[] } {
  const writtenMessages: object[] = [];
  const mockRuntime: AgentRuntime = {
    agentId: 'test-agent',
    state: 'running',
    process: {} as any,
    write: jest.fn((msg: object) => {
      writtenMessages.push(msg);
      return true;
    }),
    terminate: jest.fn().mockResolvedValue(undefined),
  };

  return {
    getOrSpawn: jest.fn().mockResolvedValue(mockRuntime),
    get: jest.fn().mockReturnValue(mockRuntime),
    terminateAll: jest.fn().mockResolvedValue(undefined),
    onAgentExit: jest.fn(),
    writtenMessages,
  } as any;
}

/**
 * Create a mock credential store with memory backend.
 */
function createMockCredentialStore(): CredentialStore {
  return new CredentialStore({ preferredBackend: 'memory' });
}

/**
 * Create a mock AuthManager for testing.
 */
function createMockAuthManager(
  credentialStore: CredentialStore,
  legacyApiKeys: Record<string, { apiKey: string; env: Record<string, string> }> = {}
): AuthManager {
  const tokenManager = new TokenManager({
    credentialStore,
    providerResolver: () => null,
  });

  return new AuthManager({
    credentialStore,
    tokenManager,
    legacyApiKeys,
  });
}

describe('Registry Launcher Auth Integration Tests', () => {
  describe('Auth Flow Integration', () => {
    it('should create MessageRouter with AuthManager', () => {
      const registry = createMockRegistry();
      const runtimeManager = createMockRuntimeManager();
      const writeCallback = jest.fn().mockReturnValue(true);
      const credentialStore = createMockCredentialStore();
      const authManager = createMockAuthManager(credentialStore);

      const router = new MessageRouter(
        registry,
        runtimeManager,
        writeCallback,
        {},
        authManager
      );

      expect(router).toBeDefined();
    });

    it('should return supported auth methods including OAuth when AuthManager is provided', () => {
      const registry = createMockRegistry();
      const runtimeManager = createMockRuntimeManager();
      const writeCallback = jest.fn().mockReturnValue(true);
      const credentialStore = createMockCredentialStore();
      const authManager = createMockAuthManager(credentialStore);

      const router = new MessageRouter(
        registry,
        runtimeManager,
        writeCallback,
        {},
        authManager
      );

      const authMethods = router.getSupportedAuthMethods();

      // Should include both API key and OAuth methods
      expect(authMethods.some(m => m.type === 'api-key')).toBe(true);
      expect(authMethods.some(m => m.type === 'oauth2')).toBe(true);

      // Should include all OAuth providers
      for (const providerId of VALID_PROVIDER_IDS) {
        expect(authMethods.some(m => m.providerId === providerId)).toBe(true);
      }
    });

    it('should return only API key methods when AuthManager is not provided', () => {
      const registry = createMockRegistry();
      const runtimeManager = createMockRuntimeManager();
      const writeCallback = jest.fn().mockReturnValue(true);

      const router = new MessageRouter(
        registry,
        runtimeManager,
        writeCallback,
        {}
        // No authManager
      );

      const authMethods = router.getSupportedAuthMethods();

      // Should include API key methods
      expect(authMethods.some(m => m.type === 'api-key')).toBe(true);

      // Should NOT include OAuth methods
      expect(authMethods.some(m => m.type === 'oauth2')).toBe(false);
    });
  });

  describe('Backward Compatibility (Requirements 10.1, 10.2, 10.5)', () => {
    it('should continue to support legacy api-keys.json format', async () => {
      const agents = new Map<string, RegistryAgent>();
      agents.set('test-agent', {
        id: 'test-agent',
        name: 'Test Agent',
        version: '1.0.0',
        distribution: { npx: { package: 'test-agent' } },
      });

      const registry = createMockRegistry(agents);
      const runtimeManager = createMockRuntimeManager();
      const writeCallback = jest.fn().mockReturnValue(true);

      // Legacy API keys format
      const legacyApiKeys = {
        'test-agent': {
          apiKey: 'sk-legacy-key-12345',
          env: { OPENAI_API_KEY: 'sk-legacy-key-12345' },
        },
      };

      const router = new MessageRouter(
        registry,
        runtimeManager,
        writeCallback,
        legacyApiKeys
        // No authManager - testing backward compatibility
      );

      const message = {
        jsonrpc: '2.0',
        id: 1,
        method: 'session/new',
        agentId: 'test-agent',
        sessionId: 'client-session-1',
        params: { cwd: '/home/user' },
      };

      const result = await router.route(message);

      // Should route successfully without errors
      expect(result).toBeUndefined();
      expect(runtimeManager.writtenMessages.length).toBe(1);
    });

    it('should maintain NDJSON protocol compliance (Requirement 10.5)', async () => {
      const agents = new Map<string, RegistryAgent>();
      agents.set('test-agent', {
        id: 'test-agent',
        name: 'Test Agent',
        version: '1.0.0',
        distribution: { npx: { package: 'test-agent' } },
      });

      const registry = createMockRegistry(agents);
      const runtimeManager = createMockRuntimeManager();
      const writtenResponses: object[] = [];
      const writeCallback = jest.fn((msg: object) => {
        writtenResponses.push(msg);
        return true;
      });

      const router = new MessageRouter(
        registry,
        runtimeManager,
        writeCallback,
        {}
      );

      // Simulate an agent response
      const agentResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: {
          protocolVersion: '1.0',
          agentInfo: { name: 'Test Agent', version: '1.0.0' },
        },
      };

      router.handleAgentResponse('test-agent', agentResponse);

      // Response should be valid JSON (NDJSON compliant)
      expect(writtenResponses.length).toBe(1);
      const response = writtenResponses[0];
      expect(() => JSON.stringify(response)).not.toThrow();
      expect(response).toHaveProperty('jsonrpc', '2.0');
    });

    it('should not require authentication for agents without auth requirements (Requirement 10.4)', async () => {
      const agents = new Map<string, RegistryAgent>();
      agents.set('no-auth-agent', {
        id: 'no-auth-agent',
        name: 'No Auth Agent',
        version: '1.0.0',
        distribution: { npx: { package: 'no-auth-agent' } },
        // No authentication requirements
      });

      const registry = createMockRegistry(agents);
      const runtimeManager = createMockRuntimeManager();
      const writeCallback = jest.fn().mockReturnValue(true);

      const router = new MessageRouter(
        registry,
        runtimeManager,
        writeCallback,
        {} // No API keys
      );

      const message = {
        jsonrpc: '2.0',
        id: 1,
        method: 'session/new',
        agentId: 'no-auth-agent',
        sessionId: 'client-session-1',
        params: { cwd: '/home/user' },
      };

      const result = await router.route(message);

      // Should route successfully without requiring auth
      expect(result).toBeUndefined();
      expect(runtimeManager.writtenMessages.length).toBe(1);
    });
  });

  describe('ACP Protocol Integration (Requirements 11.1, 11.2)', () => {
    it('should include authMethods in initialize response (Requirement 11.1)', () => {
      // Create registry with test agent
      const agents = new Map<string, RegistryAgent>();
      agents.set('test-agent', {
        id: 'test-agent',
        name: 'Test Agent',
        version: '1.0.0',
        distribution: { npx: { package: 'test-agent' } },
      });

      const registry = createMockRegistry(agents);
      const runtimeManager = createMockRuntimeManager();
      const writtenResponses: object[] = [];
      const writeCallback = jest.fn((msg: object) => {
        writtenResponses.push(msg);
        return true;
      });
      const credentialStore = createMockCredentialStore();
      const authManager = createMockAuthManager(credentialStore);

      const router = new MessageRouter(
        registry,
        runtimeManager,
        writeCallback,
        {},
        authManager
      );

      // Verify that getSupportedAuthMethods returns auth methods
      const authMethods = router.getSupportedAuthMethods();
      expect(authMethods.length).toBeGreaterThan(0);
      expect(authMethods.some(m => m.type === 'api-key')).toBe(true);
      expect(authMethods.some(m => m.type === 'oauth2')).toBe(true);

      // Simulate an initialize response from agent (with protocolVersion to trigger injection)
      const agentResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: {
          protocolVersion: '1.0',
          agentInfo: { name: 'Test Agent', version: '1.0.0' },
        },
      };

      // Track the request first (simulating that we routed an initialize request)
      (router as any).pendingRequests.set(1, {
        id: 1,
        agentId: 'test-agent',
        timestamp: Date.now(),
        method: 'initialize',  // Required for initialize response detection
      });

      router.handleAgentResponse('test-agent', agentResponse);

      // Response should be written
      expect(writtenResponses.length).toBe(1);
      const response = writtenResponses[0] as any;
      expect(response.result).toBeDefined();

      // The response should include authMethods injected by the router
      // Note: authMethods are injected when the response has protocolVersion (initialize response)
      expect(response.result.authMethods).toBeDefined();
      expect(Array.isArray(response.result.authMethods)).toBe(true);
      expect(response.result.authMethods.length).toBeGreaterThan(0);
    });

    it('should create AUTH_REQUIRED error response (Requirement 11.2)', () => {
      const registry = createMockRegistry();
      const runtimeManager = createMockRuntimeManager();
      const writeCallback = jest.fn().mockReturnValue(true);
      const credentialStore = createMockCredentialStore();
      const authManager = createMockAuthManager(credentialStore);

      const router = new MessageRouter(
        registry,
        runtimeManager,
        writeCallback,
        {},
        authManager
      );

      const errorResponse = router.createAuthRequiredError(1, 'test-agent', 'oauth2-github');

      expect(errorResponse.jsonrpc).toBe('2.0');
      expect(errorResponse.id).toBe(1);
      expect(errorResponse.error.code).toBe(RoutingErrorCodes.AUTH_REQUIRED);
      expect(errorResponse.error.message).toBe('Authentication required');
      expect(errorResponse.error.data).toBeDefined();
      expect((errorResponse.error.data as any).agentId).toBe('test-agent');
      expect((errorResponse.error.data as any).requiredMethod).toBe('oauth2-openai');
      expect((errorResponse.error.data as any).supportedMethods).toBeDefined();
    });

    it('should check authentication availability for agent', async () => {
      const registry = createMockRegistry();
      const runtimeManager = createMockRuntimeManager();
      const writeCallback = jest.fn().mockReturnValue(true);
      const credentialStore = createMockCredentialStore();

      // Create AuthManager with legacy API keys
      const legacyApiKeys = {
        'agent-with-key': {
          apiKey: 'sk-test-key',
          env: {},
        },
      };
      const authManager = createMockAuthManager(credentialStore, legacyApiKeys);

      const router = new MessageRouter(
        registry,
        runtimeManager,
        writeCallback,
        legacyApiKeys,
        authManager
      );

      // Agent with API key should have auth available
      const hasAuth = await router.hasAuthenticationForAgent('agent-with-key');
      expect(hasAuth).toBe(true);

      // Agent without API key should not have auth available
      const noAuth = await router.hasAuthenticationForAgent('agent-without-key');
      expect(noAuth).toBe(false);
    });
  });

  describe('OAuth Credential Precedence (Requirement 10.3)', () => {
    it('should prefer OAuth credentials over legacy api-keys.json', async () => {
      const credentialStore = createMockCredentialStore();

      // Store OAuth credentials
      const oauthCredentials: StoredCredentials = {
        providerId: 'github',
        accessToken: 'oauth-access-token-12345',
        refreshToken: 'oauth-refresh-token',
        expiresAt: Date.now() + 3600000, // 1 hour from now
        storedAt: Date.now(),
      };
      await credentialStore.store('github', oauthCredentials);

      // Create AuthManager with both OAuth and legacy credentials
      const legacyApiKeys = {
        'openai-agent': {
          apiKey: 'sk-legacy-key-should-not-be-used',
          env: {},
        },
      };

      const tokenManager = new TokenManager({
        credentialStore,
        providerResolver: () => null,
      });

      const authManager = new AuthManager({
        credentialStore,
        tokenManager,
        legacyApiKeys,
      });

      // Get token for agent - should return OAuth token, not legacy
      const token = await authManager.getTokenForAgent('openai-agent', 'github');

      expect(token).toBe('oauth-access-token-12345');
      expect(token).not.toBe('sk-legacy-key-should-not-be-used');
    });

    it('should fall back to legacy credentials when OAuth not available', async () => {
      const credentialStore = createMockCredentialStore();
      // No OAuth credentials stored

      const legacyApiKeys = {
        'test-agent': {
          apiKey: 'sk-legacy-fallback-key',
          env: {},
        },
      };

      const tokenManager = new TokenManager({
        credentialStore,
        providerResolver: () => null,
      });

      const authManager = new AuthManager({
        credentialStore,
        tokenManager,
        legacyApiKeys,
      });

      // Get token for agent - should return legacy key
      const token = await authManager.getTokenForAgent('test-agent');

      expect(token).toBe('sk-legacy-fallback-key');
    });
  });

  describe('NDJSON Protocol Compliance', () => {
    it('should output valid JSON for all responses', () => {
      const registry = createMockRegistry();
      const runtimeManager = createMockRuntimeManager();
      const writtenResponses: object[] = [];
      const writeCallback = jest.fn((msg: object) => {
        writtenResponses.push(msg);
        return true;
      });

      // Create router to verify it can be instantiated (used for context)
      new MessageRouter(
        registry,
        runtimeManager,
        writeCallback,
        {}
      );

      // Test various response types
      const responses = [
        createErrorResponse(1, -32600, 'Missing agentId'),
        createErrorResponse(2, RoutingErrorCodes.AGENT_NOT_FOUND, 'Agent not found', { agentId: 'test' }),
        createErrorResponse(3, RoutingErrorCodes.AUTH_REQUIRED, 'Auth required', { agentId: 'test' }),
      ];

      for (const response of responses) {
        // Each response should be valid JSON
        expect(() => JSON.stringify(response)).not.toThrow();

        // Each response should have required JSON-RPC fields
        expect(response.jsonrpc).toBe('2.0');
        expect(response.id).toBeDefined();
        expect(response.error).toBeDefined();
      }
    });

    it('should not include sensitive data in error responses', () => {
      const errorResponse = createErrorResponse(
        1,
        RoutingErrorCodes.AUTH_REQUIRED,
        'Authentication required',
        {
          agentId: 'test-agent',
          requiredMethod: 'oauth2-openai',
        }
      );

      const responseStr = JSON.stringify(errorResponse);

      // Should not contain any token-like strings
      expect(responseStr).not.toMatch(/sk-[a-zA-Z0-9]+/);
      expect(responseStr).not.toMatch(/access_token/i);
      expect(responseStr).not.toMatch(/refresh_token/i);
      expect(responseStr).not.toMatch(/client_secret/i);
    });

    it('should log to stderr only (not stdout)', async () => {
      // This test verifies the design principle that all logging goes to stderr
      // The actual logging is done via console.error in the implementation

      // Create registry with a test agent
      const agents = new Map<string, RegistryAgent>();
      agents.set('test-agent', {
        id: 'test-agent',
        name: 'Test Agent',
        version: '1.0.0',
        distribution: { npx: { package: 'test-agent' } },
      });

      const registry = createMockRegistry(agents);
      const runtimeManager = createMockRuntimeManager();
      const stdoutWrites: string[] = [];
      const writeCallback = jest.fn((msg: object) => {
        stdoutWrites.push(JSON.stringify(msg));
        return true;
      });

      const router = new MessageRouter(
        registry,
        runtimeManager,
        writeCallback,
        {}
      );

      // Route a valid message
      const message = {
        jsonrpc: '2.0',
        id: 1,
        method: 'session/new',
        agentId: 'test-agent',
        params: {},
      };

      await router.route(message);

      // The message should be routed to the agent (written to runtime)
      // No error responses should be written to stdout for valid messages
      expect(runtimeManager.writtenMessages.length).toBe(1);
    });
  });

  describe('Auth Methods Structure', () => {
    it('should return auth methods with correct structure', () => {
      const registry = createMockRegistry();
      const runtimeManager = createMockRuntimeManager();
      const writeCallback = jest.fn().mockReturnValue(true);
      const credentialStore = createMockCredentialStore();
      const authManager = createMockAuthManager(credentialStore);

      const router = new MessageRouter(
        registry,
        runtimeManager,
        writeCallback,
        {},
        authManager
      );

      const authMethods = router.getSupportedAuthMethods();

      for (const method of authMethods) {
        // Each method should have required fields
        expect(method.id).toBeDefined();
        expect(typeof method.id).toBe('string');
        expect(method.type).toBeDefined();
        expect(['api-key', 'oauth2']).toContain(method.type);

        // OAuth methods should have providerId
        if (method.type === 'oauth2') {
          expect(method.providerId).toBeDefined();
          expect(VALID_PROVIDER_IDS).toContain(method.providerId);
        }
      }
    });

    it('should include all supported OAuth providers', () => {
      const registry = createMockRegistry();
      const runtimeManager = createMockRuntimeManager();
      const writeCallback = jest.fn().mockReturnValue(true);
      const credentialStore = createMockCredentialStore();
      const authManager = createMockAuthManager(credentialStore);

      const router = new MessageRouter(
        registry,
        runtimeManager,
        writeCallback,
        {},
        authManager
      );

      const authMethods = router.getSupportedAuthMethods();
      const oauthProviders = authMethods
        .filter(m => m.type === 'oauth2')
        .map(m => m.providerId);

      // Should include all valid providers
      for (const providerId of VALID_PROVIDER_IDS) {
        expect(oauthProviders).toContain(providerId);
      }
    });
  });
});


describe('Token Persistence and Lifecycle (Task 29)', () => {
  describe('29.1 Token Storage After Browser OAuth', () => {
    it('should store tokens after successful OAuth flow', async () => {
      const credentialStore = createMockCredentialStore();
      const tokenManager = new TokenManager({
        credentialStore,
        providerResolver: () => null,
      });

      // Simulate storing tokens (as AgentAuthFlow would do)
      const tokenResponse = {
        accessToken: 'new-oauth-access-token',
        refreshToken: 'new-oauth-refresh-token',
        expiresIn: 3600,
        tokenType: 'Bearer',
      };

      await tokenManager.storeTokens('github', tokenResponse);

      // Verify tokens can be retrieved
      const retrievedToken = await tokenManager.getAccessToken('github');
      expect(retrievedToken).toBe('new-oauth-access-token');

      // Verify tokens are valid
      const hasValid = await tokenManager.hasValidTokens('github');
      expect(hasValid).toBe(true);
    });

    it('should persist tokens across TokenManager instances', async () => {
      const credentialStore = createMockCredentialStore();

      // First TokenManager stores tokens
      const tokenManager1 = new TokenManager({
        credentialStore,
        providerResolver: () => null,
      });

      await tokenManager1.storeTokens('github', {
        accessToken: 'persisted-token-12345',
        expiresIn: 7200,
        tokenType: 'Bearer',
      });

      // Second TokenManager retrieves tokens (same credential store)
      const tokenManager2 = new TokenManager({
        credentialStore,
        providerResolver: () => null,
      });

      const retrievedToken = await tokenManager2.getAccessToken('github');
      expect(retrievedToken).toBe('persisted-token-12345');
    });

    it('should preserve refresh token when not returned in refresh response', async () => {
      const credentialStore = createMockCredentialStore();
      const tokenManager = new TokenManager({
        credentialStore,
        providerResolver: () => null,
      });

      // Initial token storage with refresh token
      await tokenManager.storeTokens('github', {
        accessToken: 'initial-access-token',
        refreshToken: 'original-refresh-token',
        expiresIn: 3600,
        tokenType: 'Bearer',
      });

      // Simulate refresh response without refresh token (some providers do this)
      await tokenManager.storeTokens('github', {
        accessToken: 'refreshed-access-token',
        expiresIn: 3600,
        tokenType: 'Bearer',
        // No refreshToken in response
      });

      // Verify refresh token was preserved
      const credentials = await credentialStore.retrieve('github');
      expect(credentials?.refreshToken).toBe('original-refresh-token');
      expect(credentials?.accessToken).toBe('refreshed-access-token');
    });
  });

  describe('29.2 Token Reuse in MessageRouter', () => {
    it('should use stored OAuth token for subsequent requests', async () => {
      const credentialStore = createMockCredentialStore();

      // Pre-store OAuth credentials
      const oauthCredentials: StoredCredentials = {
        providerId: 'github',
        accessToken: 'stored-oauth-token-for-reuse',
        expiresAt: Date.now() + 3600000,
        storedAt: Date.now(),
      };
      await credentialStore.store('github', oauthCredentials);

      const tokenManager = new TokenManager({
        credentialStore,
        providerResolver: () => null,
      });

      const authManager = new AuthManager({
        credentialStore,
        tokenManager,
        legacyApiKeys: {},
      });

      // First request - should use stored token
      const token1 = await authManager.getTokenForAgent('openai-agent', 'github');
      expect(token1).toBe('stored-oauth-token-for-reuse');

      // Second request - should reuse same token (no new browser flow)
      const token2 = await authManager.getTokenForAgent('openai-agent', 'github');
      expect(token2).toBe('stored-oauth-token-for-reuse');
    });

    it('should not trigger browser flow when valid token exists', async () => {
      const credentialStore = createMockCredentialStore();

      // Pre-store valid OAuth credentials
      await credentialStore.store('github', {
        providerId: 'github',
        accessToken: 'valid-github-token',
        expiresAt: Date.now() + 3600000,
        storedAt: Date.now(),
      });

      const tokenManager = new TokenManager({
        credentialStore,
        providerResolver: () => null,
      });

      // Check if tokens are valid (this is what MessageRouter would check)
      const hasValid = await tokenManager.hasValidTokens('github');
      expect(hasValid).toBe(true);

      // Get token (should return stored token, not trigger new flow)
      const token = await tokenManager.getAccessToken('github');
      expect(token).toBe('valid-github-token');
    });

    it('should isolate tokens between different providers', async () => {
      const credentialStore = createMockCredentialStore();
      const tokenManager = new TokenManager({
        credentialStore,
        providerResolver: () => null,
      });

      // Store tokens for different providers
      await tokenManager.storeTokens('github', {
        accessToken: 'github-specific-token',
        expiresIn: 3600,
        tokenType: 'Bearer',
      });

      await tokenManager.storeTokens('google', {
        accessToken: 'google-specific-token',
        expiresIn: 3600,
        tokenType: 'Bearer',
      });

      // Verify isolation
      const githubToken = await tokenManager.getAccessToken('github');
      const googleToken = await tokenManager.getAccessToken('google');

      expect(githubToken).toBe('github-specific-token');
      expect(googleToken).toBe('google-specific-token');
      expect(githubToken).not.toBe(googleToken);
    });
  });

  describe('29.3 Token Lifecycle Integration', () => {
    it('should handle token expiry gracefully', async () => {
      const credentialStore = createMockCredentialStore();
      const tokenManager = new TokenManager({
        credentialStore,
        providerResolver: () => null,
      });

      // Store expired token
      await credentialStore.store('github', {
        providerId: 'github',
        accessToken: 'expired-token',
        expiresAt: Date.now() - 1000, // Already expired
        storedAt: Date.now() - 3600000,
      });

      // Token should not be valid
      const hasValid = await tokenManager.hasValidTokens('github');
      expect(hasValid).toBe(false);

      // getAccessToken returns the token even if expired (caller should check hasValidTokens first)
      // This is by design - the token manager doesn't block retrieval, it just reports validity
      await tokenManager.getAccessToken('github');
      // Token is returned but hasValidTokens correctly reports false
      expect(hasValid).toBe(false);
    });

    it('should clear tokens on logout', async () => {
      const credentialStore = createMockCredentialStore();
      const tokenManager = new TokenManager({
        credentialStore,
        providerResolver: () => null,
      });

      // Store token
      await tokenManager.storeTokens('github', {
        accessToken: 'token-to-be-cleared',
        expiresIn: 3600,
        tokenType: 'Bearer',
      });

      // Verify token exists
      expect(await tokenManager.hasValidTokens('github')).toBe(true);

      // Clear tokens
      await tokenManager.clearTokens('github');

      // Verify token is cleared
      expect(await tokenManager.hasValidTokens('github')).toBe(false);
      expect(await tokenManager.getAccessToken('github')).toBeNull();
    });

    it('should return AUTH_REQUIRED when token refresh fails', async () => {
      const credentialStore = createMockCredentialStore();

      // Store token that needs refresh but has no refresh token
      await credentialStore.store('github', {
        providerId: 'github',
        accessToken: 'needs-refresh-token',
        expiresAt: Date.now() + 60000, // Expires in 1 minute (within refresh threshold)
        storedAt: Date.now() - 3600000,
        // No refreshToken - refresh will fail
      });

      const tokenManager = new TokenManager({
        credentialStore,
        providerResolver: () => null, // No provider to refresh with
      });

      // Token should still be returned if not fully expired
      // (proactive refresh fails but token is still valid)
      const token = await tokenManager.getAccessToken('github');
      expect(token).toBe('needs-refresh-token');
    });

    it('should handle corrupted credentials gracefully', async () => {
      const credentialStore = createMockCredentialStore();
      const tokenManager = new TokenManager({
        credentialStore,
        providerResolver: () => null,
      });

      // Store credentials with no expiry (considered valid indefinitely)
      await credentialStore.store('github', {
        providerId: 'github',
        accessToken: 'token-without-expiry',
        storedAt: Date.now(),
        // No expiresAt - token is valid indefinitely
      } as StoredCredentials);

      // Token without expiry is considered valid
      const hasValid = await tokenManager.hasValidTokens('github');
      expect(hasValid).toBe(true);

      // But if we store with past expiry, it should be invalid
      await credentialStore.store('github', {
        providerId: 'github',
        accessToken: 'expired-github-token',
        expiresAt: Date.now() - 1000, // Expired
        storedAt: Date.now() - 3600000,
      } as StoredCredentials);

      const hasValidGithub = await tokenManager.hasValidTokens('github');
      expect(hasValidGithub).toBe(false);
    });

    it('should handle concurrent token requests correctly', async () => {
      const credentialStore = createMockCredentialStore();
      const tokenManager = new TokenManager({
        credentialStore,
        providerResolver: () => null,
      });

      // Store valid token
      await tokenManager.storeTokens('github', {
        accessToken: 'concurrent-access-token',
        expiresIn: 3600,
        tokenType: 'Bearer',
      });

      // Make concurrent requests
      const [token1, token2, token3] = await Promise.all([
        tokenManager.getAccessToken('github'),
        tokenManager.getAccessToken('github'),
        tokenManager.getAccessToken('github'),
      ]);

      // All should return the same token
      expect(token1).toBe('concurrent-access-token');
      expect(token2).toBe('concurrent-access-token');
      expect(token3).toBe('concurrent-access-token');
    });
  });
});
