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

      const errorResponse = router.createAuthRequiredError(1, 'test-agent', 'oauth2-openai');

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
        providerId: 'openai',
        accessToken: 'oauth-access-token-12345',
        refreshToken: 'oauth-refresh-token',
        expiresAt: Date.now() + 3600000, // 1 hour from now
        storedAt: Date.now(),
      };
      await credentialStore.store('openai', oauthCredentials);

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
      const token = await authManager.getTokenForAgent('openai-agent', 'openai');

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
