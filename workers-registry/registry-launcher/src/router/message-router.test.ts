/*
 * Apache License 2.0
 * Copyright (c) 2025–present Raman Marozau, Target Insight Function.
 * Contact: raman@worktif.com
 */

/**
 * Unit tests for MessageRouter mcpServers injection.
 */

import {
  MessageRouter,
  createErrorResponse,
  extractAgentId,
  extractId,
  transformMessage,
  parseAuthMethods,
  getOAuthMethods,
  getApiKeyMethods,
  getAgentAuthMethods,
  AUTH_METHOD_ID_TO_PROVIDER,
} from './message-router.js';
import type { IRegistryIndex } from '../registry/index.js';
import type { RegistryAgent, SpawnCommand } from '../registry/types.js';
import type { AgentRuntimeManager } from '../runtime/manager.js';
import type { AgentRuntime } from '../runtime/types.js';

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
    getAuthRequirements: jest.fn((agentId: string) => {
      const agent = agents.get(agentId);
      if (!agent) {
        return undefined;
      }
      // Return default auth requirements (no auth required by default)
      return {
        authRequired: false,
        authMethods: [],
      };
    }),
  };
}

/**
 * Create a mock runtime manager.
 */
function createMockRuntimeManager(): AgentRuntimeManager {
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
    terminate: jest.fn().mockResolvedValue(undefined),
    terminateAll: jest.fn().mockResolvedValue(undefined),
    onAgentExit: jest.fn(),
    writtenMessages,
  } as any;
}

describe('MessageRouter', () => {
  describe('mcpServers injection', () => {
    it('should inject mcpServers from registry into session/new request', async () => {
      const agents = new Map<string, RegistryAgent>();
      agents.set('test-agent', {
        id: 'test-agent',
        name: 'Test Agent',
        version: '1.0.0',
        distribution: { npx: { package: 'test-agent' } },
        mcpServers: [
          { name: 'filesystem', command: 'npx', args: ['-y', '@mcp/server-filesystem', '/'] },
          { name: 'shell', command: 'npx', args: ['-y', '@mcp/server-shell'] },
        ],
      });

      const registry = createMockRegistry(agents);
      const runtimeManager = createMockRuntimeManager();
      const writeCallback = jest.fn().mockReturnValue(true);

      const router = new MessageRouter(registry, runtimeManager, writeCallback);

      const message = {
        jsonrpc: '2.0',
        id: 1,
        method: 'session/new',
        agentId: 'test-agent',
        sessionId: 'client-session-1',
        params: { cwd: '/home/user' },
      };

      await router.route(message);

      // Check that the message was written with mcpServers injected
      const writtenMessages = (runtimeManager as any).writtenMessages;
      expect(writtenMessages.length).toBe(1);

      const written = writtenMessages[0] as any;
      expect(written.method).toBe('session/new');
      expect(written.params.mcpServers).toBeDefined();
      expect(written.params.mcpServers.length).toBe(2);
      expect(written.params.mcpServers[0].name).toBe('filesystem');
      expect(written.params.mcpServers[1].name).toBe('shell');
    });

    it('should merge registry mcpServers with request mcpServers', async () => {
      const agents = new Map<string, RegistryAgent>();
      agents.set('test-agent', {
        id: 'test-agent',
        name: 'Test Agent',
        version: '1.0.0',
        distribution: { npx: { package: 'test-agent' } },
        mcpServers: [
          { name: 'filesystem', command: 'npx', args: ['-y', '@mcp/server-filesystem', '/'] },
        ],
      });

      const registry = createMockRegistry(agents);
      const runtimeManager = createMockRuntimeManager();
      const writeCallback = jest.fn().mockReturnValue(true);

      const router = new MessageRouter(registry, runtimeManager, writeCallback);

      const message = {
        jsonrpc: '2.0',
        id: 1,
        method: 'session/new',
        agentId: 'test-agent',
        sessionId: 'client-session-1',
        params: {
          cwd: '/home/user',
          mcpServers: [
            { name: 'custom', command: 'node', args: ['custom-server.js'] },
          ],
        },
      };

      await router.route(message);

      const writtenMessages = (runtimeManager as any).writtenMessages;
      const written = writtenMessages[0] as any;

      // Should have both registry and request servers
      expect(written.params.mcpServers.length).toBe(2);
      expect(written.params.mcpServers.map((s: any) => s.name)).toContain('filesystem');
      expect(written.params.mcpServers.map((s: any) => s.name)).toContain('custom');
    });

    it('should let request mcpServers override registry servers with same name', async () => {
      const agents = new Map<string, RegistryAgent>();
      agents.set('test-agent', {
        id: 'test-agent',
        name: 'Test Agent',
        version: '1.0.0',
        distribution: { npx: { package: 'test-agent' } },
        mcpServers: [
          { name: 'filesystem', command: 'npx', args: ['-y', '@mcp/server-filesystem', '/default'] },
        ],
      });

      const registry = createMockRegistry(agents);
      const runtimeManager = createMockRuntimeManager();
      const writeCallback = jest.fn().mockReturnValue(true);

      const router = new MessageRouter(registry, runtimeManager, writeCallback);

      const message = {
        jsonrpc: '2.0',
        id: 1,
        method: 'session/new',
        agentId: 'test-agent',
        sessionId: 'client-session-1',
        params: {
          cwd: '/home/user',
          mcpServers: [
            { name: 'filesystem', command: 'npx', args: ['-y', '@mcp/server-filesystem', '/custom'] },
          ],
        },
      };

      await router.route(message);

      const writtenMessages = (runtimeManager as any).writtenMessages;
      const written = writtenMessages[0] as any;

      // Should have only one filesystem server (the request one)
      expect(written.params.mcpServers.length).toBe(1);
      expect(written.params.mcpServers[0].name).toBe('filesystem');
      expect(written.params.mcpServers[0].args).toContain('/custom');
    });

    it('should not inject mcpServers for non-session/new methods', async () => {
      const agents = new Map<string, RegistryAgent>();
      agents.set('test-agent', {
        id: 'test-agent',
        name: 'Test Agent',
        version: '1.0.0',
        distribution: { npx: { package: 'test-agent' } },
        mcpServers: [
          { name: 'filesystem', command: 'npx', args: ['-y', '@mcp/server-filesystem', '/'] },
        ],
      });

      const registry = createMockRegistry(agents);
      const runtimeManager = createMockRuntimeManager();
      const writeCallback = jest.fn().mockReturnValue(true);

      const router = new MessageRouter(registry, runtimeManager, writeCallback);

      const message = {
        jsonrpc: '2.0',
        id: 1,
        method: 'session/prompt',
        agentId: 'test-agent',
        sessionId: 'client-session-1',
        params: { sessionId: 'agent-session', prompt: [{ type: 'text', text: 'Hello' }] },
      };

      await router.route(message);

      const writtenMessages = (runtimeManager as any).writtenMessages;
      const written = writtenMessages[0] as any;

      // Should not have mcpServers injected
      expect(written.params.mcpServers).toBeUndefined();
    });

    it('should handle agent without mcpServers configured', async () => {
      const agents = new Map<string, RegistryAgent>();
      agents.set('test-agent', {
        id: 'test-agent',
        name: 'Test Agent',
        version: '1.0.0',
        distribution: { npx: { package: 'test-agent' } },
        // No mcpServers
      });

      const registry = createMockRegistry(agents);
      const runtimeManager = createMockRuntimeManager();
      const writeCallback = jest.fn().mockReturnValue(true);

      const router = new MessageRouter(registry, runtimeManager, writeCallback);

      const message = {
        jsonrpc: '2.0',
        id: 1,
        method: 'session/new',
        agentId: 'test-agent',
        sessionId: 'client-session-1',
        params: { cwd: '/home/user' },
      };

      await router.route(message);

      const writtenMessages = (runtimeManager as any).writtenMessages;
      const written = writtenMessages[0] as any;

      // Should not have mcpServers (or empty)
      expect(written.params.mcpServers).toBeUndefined();
    });

    it('should convert env from registry format to ACP format', async () => {
      const agents = new Map<string, RegistryAgent>();
      agents.set('test-agent', {
        id: 'test-agent',
        name: 'Test Agent',
        version: '1.0.0',
        distribution: { npx: { package: 'test-agent' } },
        mcpServers: [
          {
            name: 'server-with-env',
            command: 'npx',
            args: ['-y', '@mcp/server'],
            env: { API_KEY: 'secret', DEBUG: 'true' },
          },
        ],
      });

      const registry = createMockRegistry(agents);
      const runtimeManager = createMockRuntimeManager();
      const writeCallback = jest.fn().mockReturnValue(true);

      const router = new MessageRouter(registry, runtimeManager, writeCallback);

      const message = {
        jsonrpc: '2.0',
        id: 1,
        method: 'session/new',
        agentId: 'test-agent',
        sessionId: 'client-session-1',
        params: { cwd: '/home/user' },
      };

      await router.route(message);

      const writtenMessages = (runtimeManager as any).writtenMessages;
      const written = writtenMessages[0] as any;

      // Check env is converted to ACP format (array of {name, value})
      const server = written.params.mcpServers[0];
      expect(server.env).toBeDefined();
      expect(Array.isArray(server.env)).toBe(true);
      expect(server.env).toContainEqual({ name: 'API_KEY', value: 'secret' });
      expect(server.env).toContainEqual({ name: 'DEBUG', value: 'true' });
    });
  });
});

describe('Helper functions', () => {
  describe('extractAgentId', () => {
    it('should extract agentId from message', () => {
      expect(extractAgentId({ agentId: 'test' })).toBe('test');
    });

    it('should return undefined for missing agentId', () => {
      expect(extractAgentId({})).toBeUndefined();
    });

    it('should return undefined for empty agentId', () => {
      expect(extractAgentId({ agentId: '' })).toBeUndefined();
    });
  });

  describe('extractId', () => {
    it('should extract string id', () => {
      expect(extractId({ id: 'test-id' })).toBe('test-id');
    });

    it('should extract number id', () => {
      expect(extractId({ id: 123 })).toBe(123);
    });

    it('should return null for missing id', () => {
      expect(extractId({})).toBeNull();
    });
  });

  describe('transformMessage', () => {
    it('should remove agentId from message', () => {
      const result = transformMessage({ agentId: 'test', method: 'test', id: 1 });
      expect(result).toEqual({ method: 'test', id: 1 });
    });
  });

  describe('createErrorResponse', () => {
    it('should create error response with data', () => {
      const response = createErrorResponse(1, -32600, 'Test error', { extra: 'data' });
      expect(response).toEqual({
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32600, message: 'Test error', data: { extra: 'data' } },
      });
    });
  });
});


// =============================================================================
// Task 21.1: Auth Method Parsing Tests
// =============================================================================

describe('parseAuthMethods (Task 21.1)', () => {
  describe('basic parsing', () => {
    it('should parse valid oauth2 auth methods', () => {
      const raw = [
        { id: 'oauth2-google', type: 'oauth2', providerId: 'google' },
        { id: 'oauth2-github', type: 'oauth2', providerId: 'github' },
      ];

      const result = parseAuthMethods(raw);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ kind: 'oauth2', id: 'oauth2-google', providerId: 'google' });
      expect(result[1]).toEqual({ kind: 'oauth2', id: 'oauth2-github', providerId: 'github' });
    });

    it('should parse valid api-key auth methods', () => {
      const raw = [
        { id: 'google-api-key', type: 'api-key', providerId: 'google' },
        { id: 'api-key', type: 'api-key' },
      ];

      const result = parseAuthMethods(raw);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ kind: 'api-key', id: 'google-api-key', providerId: 'google' });
      expect(result[1]).toEqual({ kind: 'api-key', id: 'api-key', providerId: undefined });
    });

    it('should parse "agent" type as Agent Auth (kind: agent)', () => {
      // AUTH_REQUIREMENTS.md: Agent Auth is the default authentication method
      // where the agent manages the entire OAuth flow independently.
      const raw = [
        { id: 'agent-google', type: 'agent', providerId: 'google' },
      ];

      const result = parseAuthMethods(raw);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ kind: 'agent', id: 'agent-google', providerId: 'google' });
    });

    it('should parse "agent" type without providerId', () => {
      // AUTH_REQUIREMENTS.md: Agent Auth - providerId is optional
      const raw = [
        { id: 'my-agent-auth', type: 'agent' },
      ];

      const result = parseAuthMethods(raw);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ kind: 'agent', id: 'my-agent-auth', providerId: undefined });
    });
  });

  describe('explicit id-to-provider mapping', () => {
    it('should resolve providerId from explicit mapping when not provided', () => {
      const raw = [
        { id: 'oauth2-google', type: 'oauth2' },  // No providerId, should map from id
        { id: 'oauth2-github', type: 'oauth2' },
      ];

      const result = parseAuthMethods(raw);

      expect(result).toHaveLength(2);
      expect((result[0] as any).providerId).toBe('google');
      expect((result[1] as any).providerId).toBe('github');
    });

    it('should use explicit providerId when it matches mapping', () => {
      const raw = [
        { id: 'oauth2-google', type: 'oauth2', providerId: 'google' },
      ];

      const result = parseAuthMethods(raw);

      expect(result).toHaveLength(1);
      expect((result[0] as any).providerId).toBe('google');
    });

    it('should reject methods with conflicting providerId and mapping', () => {
      const raw = [
        { id: 'oauth2-google', type: 'oauth2', providerId: 'github' },  // Conflict!
      ];

      const result = parseAuthMethods(raw);

      expect(result).toHaveLength(0);  // Rejected due to conflict
    });

    it('should support all mapped provider IDs', () => {
      // Test all entries in AUTH_METHOD_ID_TO_PROVIDER
      const mappedIds = Object.keys(AUTH_METHOD_ID_TO_PROVIDER);

      for (const id of mappedIds) {
        // agent-* IDs now map to kind: 'agent', not 'oauth2'
        const type = id.startsWith('oauth2-') ? 'oauth2' : id.startsWith('agent-') ? 'agent' : 'api-key';
        const raw = [{ id, type }];
        const result = parseAuthMethods(raw);

        expect(result).toHaveLength(1);
        expect((result[0] as any).providerId).toBe(AUTH_METHOD_ID_TO_PROVIDER[id]);
      }
    });
  });

  describe('validation and security', () => {
    it('should return empty array for non-array input', () => {
      expect(parseAuthMethods(null)).toEqual([]);
      expect(parseAuthMethods(undefined)).toEqual([]);
      expect(parseAuthMethods('string')).toEqual([]);
      expect(parseAuthMethods(123)).toEqual([]);
      expect(parseAuthMethods({})).toEqual([]);
    });

    it('should skip methods with invalid type', () => {
      const raw = [
        { id: 'valid', type: 'oauth2', providerId: 'google' },
        { id: 'invalid-type', type: 'unknown' },
        { id: 'another-valid', type: 'api-key' },
      ];

      const result = parseAuthMethods(raw);

      expect(result).toHaveLength(2);
      expect(result.map(m => m.id)).toEqual(['valid', 'another-valid']);
    });

    it('should skip methods with missing or invalid id', () => {
      const raw = [
        { type: 'oauth2', providerId: 'google' },  // Missing id
        { id: '', type: 'oauth2', providerId: 'google' },  // Empty id
        { id: 123, type: 'oauth2', providerId: 'google' },  // Non-string id
        { id: 'valid', type: 'oauth2', providerId: 'google' },
      ];

      const result = parseAuthMethods(raw);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('valid');
    });

    it('should skip oauth2 methods without valid providerId', () => {
      const raw = [
        { id: 'unknown-oauth', type: 'oauth2' },  // No providerId and no mapping
        { id: 'oauth2-google', type: 'oauth2' },  // Has mapping
      ];

      const result = parseAuthMethods(raw);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('oauth2-google');
    });

    it('should skip methods with invalid providerId', () => {
      const raw = [
        { id: 'test', type: 'oauth2', providerId: 'invalid-provider' },
      ];

      const result = parseAuthMethods(raw);

      expect(result).toHaveLength(0);
    });

    it('should deduplicate methods by id', () => {
      const raw = [
        { id: 'oauth2-google', type: 'oauth2', providerId: 'google' },
        { id: 'oauth2-google', type: 'oauth2', providerId: 'google' },  // Duplicate
        { id: 'oauth2-github', type: 'oauth2', providerId: 'github' },
      ];

      const result = parseAuthMethods(raw);

      expect(result).toHaveLength(2);
      expect(result.map(m => m.id)).toEqual(['oauth2-google', 'oauth2-github']);
    });

    it('should limit number of methods processed (DoS protection)', () => {
      // Create more than MAX_AUTH_METHODS (50) methods
      const raw = Array.from({ length: 100 }, (_, i) => ({
        id: `api-key-${i}`,
        type: 'api-key',
      }));

      const result = parseAuthMethods(raw);

      // Should be capped at 50
      expect(result.length).toBeLessThanOrEqual(50);
    });

    it('should handle null and non-object methods gracefully', () => {
      const raw = [
        null,
        undefined,
        'string',
        123,
        { id: 'valid', type: 'api-key' },
      ];

      const result = parseAuthMethods(raw);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('valid');
    });
  });
});

describe('getOAuthMethods', () => {
  it('should filter only oauth2 methods', () => {
    const methods = parseAuthMethods([
      { id: 'oauth2-google', type: 'oauth2', providerId: 'google' },
      { id: 'api-key', type: 'api-key' },
      { id: 'oauth2-github', type: 'oauth2', providerId: 'github' },
    ]);

    const oauthMethods = getOAuthMethods(methods);

    expect(oauthMethods).toHaveLength(2);
    expect(oauthMethods.every(m => m.kind === 'oauth2')).toBe(true);
    expect(oauthMethods.map(m => m.providerId)).toEqual(['google', 'github']);
  });

  it('should return empty array when no oauth2 methods', () => {
    const methods = parseAuthMethods([
      { id: 'api-key', type: 'api-key' },
    ]);

    const oauthMethods = getOAuthMethods(methods);

    expect(oauthMethods).toHaveLength(0);
  });
});

describe('getApiKeyMethods', () => {
  it('should filter only api-key methods', () => {
    const methods = parseAuthMethods([
      { id: 'oauth2-google', type: 'oauth2', providerId: 'google' },
      { id: 'google-api-key', type: 'api-key', providerId: 'google' },
      { id: 'api-key', type: 'api-key' },
    ]);

    const apiKeyMethods = getApiKeyMethods(methods);

    expect(apiKeyMethods).toHaveLength(2);
    expect(apiKeyMethods.every(m => m.kind === 'api-key')).toBe(true);
    expect(apiKeyMethods.map(m => m.id)).toEqual(['google-api-key', 'api-key']);
  });

  it('should return empty array when no api-key methods', () => {
    const methods = parseAuthMethods([
      { id: 'oauth2-google', type: 'oauth2', providerId: 'google' },
    ]);

    const apiKeyMethods = getApiKeyMethods(methods);

    expect(apiKeyMethods).toHaveLength(0);
  });
});

describe('AUTH_METHOD_ID_TO_PROVIDER mapping', () => {
  it('should have all oauth2 provider mappings', () => {
    expect(AUTH_METHOD_ID_TO_PROVIDER['oauth2-github']).toBe('github');
    expect(AUTH_METHOD_ID_TO_PROVIDER['oauth2-google']).toBe('google');
    expect(AUTH_METHOD_ID_TO_PROVIDER['oauth2-cognito']).toBe('cognito');
    expect(AUTH_METHOD_ID_TO_PROVIDER['oauth2-azure']).toBe('azure');
  });

  it('should have all agent provider mappings (legacy)', () => {
    expect(AUTH_METHOD_ID_TO_PROVIDER['agent-github']).toBe('github');
    expect(AUTH_METHOD_ID_TO_PROVIDER['agent-google']).toBe('google');
    expect(AUTH_METHOD_ID_TO_PROVIDER['agent-cognito']).toBe('cognito');
    expect(AUTH_METHOD_ID_TO_PROVIDER['agent-azure']).toBe('azure');
  });

  it('should have all api-key provider mappings', () => {
    expect(AUTH_METHOD_ID_TO_PROVIDER['github-api-key']).toBe('github');
    expect(AUTH_METHOD_ID_TO_PROVIDER['google-api-key']).toBe('google');
    expect(AUTH_METHOD_ID_TO_PROVIDER['azure-api-key']).toBe('azure');
    expect(AUTH_METHOD_ID_TO_PROVIDER['cognito-api-key']).toBe('cognito');
  });
});


// =============================================================================
// Task 21.3: Auth State Machine Tests
// =============================================================================

describe('Auth State Machine (Task 21.3)', () => {
  describe('getAuthState', () => {
    it('should return "none" for unknown agents', () => {
      const registry = createMockRegistry(new Map());
      const runtimeManager = createMockRuntimeManager();
      const writeCallback = jest.fn().mockReturnValue(true);

      const router = new MessageRouter(registry, runtimeManager, writeCallback);

      expect(router.getAuthState('unknown-agent')).toBe('none');
    });
  });

  describe('setAuthState', () => {
    it('should update auth state for an agent', () => {
      const registry = createMockRegistry(new Map());
      const runtimeManager = createMockRuntimeManager();
      const writeCallback = jest.fn().mockReturnValue(true);

      const router = new MessageRouter(registry, runtimeManager, writeCallback);

      router.setAuthState('test-agent', 'pending');
      expect(router.getAuthState('test-agent')).toBe('pending');

      router.setAuthState('test-agent', 'authenticated');
      expect(router.getAuthState('test-agent')).toBe('authenticated');

      router.setAuthState('test-agent', 'failed');
      expect(router.getAuthState('test-agent')).toBe('failed');

      router.setAuthState('test-agent', 'none');
      expect(router.getAuthState('test-agent')).toBe('none');
    });

    it('should not trigger side effects when state does not change', () => {
      const registry = createMockRegistry(new Map());
      const runtimeManager = createMockRuntimeManager();
      const writeCallback = jest.fn().mockReturnValue(true);

      const router = new MessageRouter(registry, runtimeManager, writeCallback);

      // Set to pending
      router.setAuthState('test-agent', 'pending');
      expect(router.getAuthState('test-agent')).toBe('pending');

      // Set to pending again (no change)
      router.setAuthState('test-agent', 'pending');
      expect(router.getAuthState('test-agent')).toBe('pending');
    });
  });

  describe('request queueing', () => {
    it('should queue requests when auth state is pending', async () => {
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

      const router = new MessageRouter(registry, runtimeManager, writeCallback);

      // Set auth state to pending
      router.setAuthState('test-agent', 'pending');

      // Start routing a request (should be queued)
      const routePromise = router.route({
        jsonrpc: '2.0',
        id: 1,
        method: 'session/new',
        agentId: 'test-agent',
        params: {},
      });

      // Check that request is queued
      expect(router.getQueuedRequestCount('test-agent')).toBe(1);
      expect(router.getTotalQueuedRequestCount()).toBe(1);

      // Transition to authenticated - should process queued requests
      router.setAuthState('test-agent', 'authenticated');

      // Wait for the route promise to resolve
      const result = await routePromise;

      // Request should have been processed successfully
      expect(result).toBeUndefined();
      expect(router.getQueuedRequestCount('test-agent')).toBe(0);
    });

    it('should reject queued requests when auth fails', async () => {
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

      const router = new MessageRouter(registry, runtimeManager, writeCallback);

      // Set auth state to pending
      router.setAuthState('test-agent', 'pending');

      // Start routing a request (should be queued)
      const routePromise = router.route({
        jsonrpc: '2.0',
        id: 1,
        method: 'session/new',
        agentId: 'test-agent',
        params: {},
      });

      // Check that request is queued
      expect(router.getQueuedRequestCount('test-agent')).toBe(1);

      // Transition to failed - should reject queued requests
      router.setAuthState('test-agent', 'failed');

      // Wait for the route promise to resolve
      const result = await routePromise;

      // Request should have been rejected with AUTH_REQUIRED error
      expect(result).toBeDefined();
      expect(result?.error.code).toBe(-32004); // AUTH_REQUIRED
      expect(router.getQueuedRequestCount('test-agent')).toBe(0);
    });

    it('should return AUTH_REQUIRED for requests when auth state is failed', async () => {
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

      const router = new MessageRouter(registry, runtimeManager, writeCallback);

      // Set auth state to failed
      router.setAuthState('test-agent', 'failed');

      // Route a request - should immediately return AUTH_REQUIRED
      const result = await router.route({
        jsonrpc: '2.0',
        id: 1,
        method: 'session/new',
        agentId: 'test-agent',
        params: {},
      });

      expect(result).toBeDefined();
      expect(result?.error.code).toBe(-32004); // AUTH_REQUIRED
      expect(result?.error.message).toBe('Authentication required');
    });

    it('should route requests normally when auth state is none', async () => {
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

      const router = new MessageRouter(registry, runtimeManager, writeCallback);

      // Auth state is 'none' by default
      expect(router.getAuthState('test-agent')).toBe('none');

      // Route a request - should proceed normally
      const result = await router.route({
        jsonrpc: '2.0',
        id: 1,
        method: 'session/new',
        agentId: 'test-agent',
        params: {},
      });

      expect(result).toBeUndefined();
    });

    it('should route requests normally when auth state is authenticated', async () => {
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

      const router = new MessageRouter(registry, runtimeManager, writeCallback);

      // Set auth state to authenticated
      router.setAuthState('test-agent', 'authenticated');

      // Route a request - should proceed normally
      const result = await router.route({
        jsonrpc: '2.0',
        id: 1,
        method: 'session/new',
        agentId: 'test-agent',
        params: {},
      });

      expect(result).toBeUndefined();
    });

    it('should queue multiple requests while auth is pending', async () => {
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

      const router = new MessageRouter(registry, runtimeManager, writeCallback);

      // Set auth state to pending
      router.setAuthState('test-agent', 'pending');

      // Queue multiple requests
      const promises = [
        router.route({ jsonrpc: '2.0', id: 1, method: 'session/new', agentId: 'test-agent', params: {} }),
        router.route({ jsonrpc: '2.0', id: 2, method: 'session/prompt', agentId: 'test-agent', params: {} }),
        router.route({ jsonrpc: '2.0', id: 3, method: 'session/end', agentId: 'test-agent', params: {} }),
      ];

      // Check that all requests are queued
      expect(router.getQueuedRequestCount('test-agent')).toBe(3);
      expect(router.getTotalQueuedRequestCount()).toBe(3);

      // Transition to authenticated
      router.setAuthState('test-agent', 'authenticated');

      // Wait for all promises to resolve
      const results = await Promise.all(promises);

      // All requests should have been processed successfully
      expect(results.every(r => r === undefined)).toBe(true);
      expect(router.getQueuedRequestCount('test-agent')).toBe(0);
    });
  });

  describe('clearQueues', () => {
    it('should clear all queued requests and auth state', async () => {
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

      const router = new MessageRouter(registry, runtimeManager, writeCallback);

      // Set auth state to pending and queue a request
      router.setAuthState('test-agent', 'pending');
      const routePromise = router.route({
        jsonrpc: '2.0',
        id: 1,
        method: 'session/new',
        agentId: 'test-agent',
        params: {},
      });

      expect(router.getQueuedRequestCount('test-agent')).toBe(1);

      // Clear queues
      router.clearQueues();

      // Wait for the route promise to resolve
      const result = await routePromise;

      // Request should have been rejected with shutdown error
      expect(result).toBeDefined();
      expect(result?.error.message).toBe('Router shutdown');

      // Auth state should be cleared
      expect(router.getAuthState('test-agent')).toBe('none');
      expect(router.getQueuedRequestCount('test-agent')).toBe(0);
    });
  });

  describe('resetAuthState', () => {
    it('should reset auth state to none', () => {
      const registry = createMockRegistry(new Map());
      const runtimeManager = createMockRuntimeManager();
      const writeCallback = jest.fn().mockReturnValue(true);

      const router = new MessageRouter(registry, runtimeManager, writeCallback);

      // Set auth state to authenticated
      router.setAuthState('test-agent', 'authenticated');
      expect(router.getAuthState('test-agent')).toBe('authenticated');

      // Reset auth state
      router.resetAuthState('test-agent');
      expect(router.getAuthState('test-agent')).toBe('none');
    });
  });
});


// =============================================================================
// Task 21.4: OAuth Negotiation Unit Tests
// =============================================================================

describe('OAuth Negotiation (Task 21.4)', () => {
  /**
   * Validates: Requirements 3.1, 11.2
   * Test authMethods parsing with various type/providerId combinations
   */
  describe('authMethods parsing with type/providerId combinations', () => {
    it('should parse oauth2 type with explicit providerId', () => {
      const raw = [
        { id: 'custom-oauth', type: 'oauth2', providerId: 'google' },
      ];

      const result = parseAuthMethods(raw);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ kind: 'oauth2', id: 'custom-oauth', providerId: 'google' });
    });

    it('should parse agent type with explicit providerId', () => {
      // Agent Auth: agent handles OAuth internally via authenticate method
      // This is the ACP-compliant behavior per AUTH_REQUIREMENTS.md
      const raw = [
        { id: 'custom-agent', type: 'agent', providerId: 'github' },
      ];

      const result = parseAuthMethods(raw);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ kind: 'agent', id: 'custom-agent', providerId: 'github' });
    });

    it('should parse api-key type with explicit providerId', () => {
      const raw = [
        { id: 'custom-api-key', type: 'api-key', providerId: 'github' },
      ];

      const result = parseAuthMethods(raw);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ kind: 'api-key', id: 'custom-api-key', providerId: 'github' });
    });

    it('should parse api-key type without providerId', () => {
      const raw = [
        { id: 'generic-api-key', type: 'api-key' },
      ];

      const result = parseAuthMethods(raw);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ kind: 'api-key', id: 'generic-api-key', providerId: undefined });
    });

    it('should parse mixed auth methods correctly', () => {
      const raw = [
        { id: 'oauth2-google', type: 'oauth2', providerId: 'google' },
        { id: 'agent-github', type: 'agent', providerId: 'github' },
        { id: 'google-api-key', type: 'api-key', providerId: 'google' },
        { id: 'generic-key', type: 'api-key' },
      ];

      const result = parseAuthMethods(raw);

      expect(result).toHaveLength(4);
      expect(result[0]).toEqual({ kind: 'oauth2', id: 'oauth2-google', providerId: 'google' });
      // Agent Auth: type: 'agent' is parsed as kind: 'agent' (ACP-compliant)
      expect(result[1]).toEqual({ kind: 'agent', id: 'agent-github', providerId: 'github' });
      expect(result[2]).toEqual({ kind: 'api-key', id: 'google-api-key', providerId: 'google' });
      expect(result[3]).toEqual({ kind: 'api-key', id: 'generic-key', providerId: undefined });
    });

    it('should reject oauth2 methods with invalid providerId', () => {
      const raw = [
        { id: 'oauth2-invalid', type: 'oauth2', providerId: 'not-a-real-provider' },
      ];

      const result = parseAuthMethods(raw);

      expect(result).toHaveLength(0);
    });

    it('should reject oauth2 methods without providerId and no mapping', () => {
      const raw = [
        { id: 'unmapped-oauth', type: 'oauth2' },  // No providerId, no mapping
      ];

      const result = parseAuthMethods(raw);

      expect(result).toHaveLength(0);
    });

    it('should use mapping when providerId not provided but id is mapped', () => {
      const raw = [
        { id: 'oauth2-google', type: 'oauth2' },  // No providerId, but id is mapped
      ];

      const result = parseAuthMethods(raw);

      expect(result).toHaveLength(1);
      expect((result[0] as any).providerId).toBe('google');
    });

    it('should handle all supported providers', () => {
      const providers = ['github', 'google', 'cognito', 'azure', 'oidc'];

      for (const provider of providers) {
        const raw = [
          { id: `oauth2-${provider}`, type: 'oauth2', providerId: provider },
        ];

        const result = parseAuthMethods(raw);

        expect(result).toHaveLength(1);
        expect((result[0] as any).providerId).toBe(provider);
      }
    });
  });

  /**
   * Validates: Requirements 3.1, 3.2
   * Test OAuth flow trigger when type is "oauth2"
   */
  describe('OAuth flow trigger', () => {
    it('should identify OAuth methods from authMethods array', () => {
      const methods = parseAuthMethods([
        { id: 'oauth2-google', type: 'oauth2', providerId: 'google' },
        { id: 'api-key', type: 'api-key' },
        { id: 'agent-github', type: 'agent', providerId: 'github' },
      ]);

      const oauthMethods = getOAuthMethods(methods);

      // Only oauth2 type is included in OAuth methods
      // Agent Auth (type: 'agent') is handled separately via getAgentAuthMethods()
      expect(oauthMethods).toHaveLength(1);
      expect(oauthMethods[0].kind).toBe('oauth2');
      expect(oauthMethods[0].providerId).toBe('google');
    });

    it('should prioritize OAuth methods over API key methods', () => {
      const methods = parseAuthMethods([
        { id: 'google-api-key', type: 'api-key', providerId: 'google' },
        { id: 'oauth2-google', type: 'oauth2', providerId: 'google' },
      ]);

      const oauthMethods = getOAuthMethods(methods);
      const apiKeyMethods = getApiKeyMethods(methods);

      // Both should be parsed
      expect(oauthMethods).toHaveLength(1);
      expect(apiKeyMethods).toHaveLength(1);

      // OAuth should be selected first (per Requirement 3.1, 10.3)
      expect(oauthMethods[0].kind).toBe('oauth2');
    });

    it('should handle agent type as Agent Auth (ACP-compliant)', () => {
      // Per AUTH_REQUIREMENTS.md: type: 'agent' means Agent Auth
      // where the agent handles OAuth internally via authenticate method
      const methods = parseAuthMethods([
        { id: 'agent-github', type: 'agent', providerId: 'github' },
      ]);

      const oauthMethods = getOAuthMethods(methods);
      const agentAuthMethods = getAgentAuthMethods(methods);

      // Agent Auth is NOT included in OAuth methods
      expect(oauthMethods).toHaveLength(0);
      // Agent Auth is handled separately
      expect(agentAuthMethods).toHaveLength(1);
      expect(agentAuthMethods[0].kind).toBe('agent');
      expect(agentAuthMethods[0].providerId).toBe('github');
    });

    it('should return empty array when no OAuth methods present', () => {
      const methods = parseAuthMethods([
        { id: 'api-key', type: 'api-key' },
        { id: 'google-api-key', type: 'api-key', providerId: 'google' },
      ]);

      const oauthMethods = getOAuthMethods(methods);

      expect(oauthMethods).toHaveLength(0);
    });
  });

  /**
   * Validates: Requirements 3.1, 3.5
   * Test request queueing during pending auth
   */
  describe('request queueing during pending auth', () => {
    it('should queue requests when OAuth auth is pending', async () => {
      const agents = new Map<string, RegistryAgent>();
      agents.set('oauth-agent', {
        id: 'oauth-agent',
        name: 'OAuth Agent',
        version: '1.0.0',
        distribution: { npx: { package: 'oauth-agent' } },
      });

      const registry = createMockRegistry(agents);
      const runtimeManager = createMockRuntimeManager();
      const writeCallback = jest.fn().mockReturnValue(true);

      const router = new MessageRouter(registry, runtimeManager, writeCallback);

      // Simulate OAuth flow starting (sets state to pending)
      router.setAuthState('oauth-agent', 'pending');

      // Queue multiple requests during pending auth
      const request1 = router.route({
        jsonrpc: '2.0',
        id: 1,
        method: 'session/new',
        agentId: 'oauth-agent',
        params: {},
      });

      const request2 = router.route({
        jsonrpc: '2.0',
        id: 2,
        method: 'session/prompt',
        agentId: 'oauth-agent',
        params: { prompt: 'test' },
      });

      // Verify requests are queued
      expect(router.getQueuedRequestCount('oauth-agent')).toBe(2);

      // Complete OAuth flow
      router.setAuthState('oauth-agent', 'authenticated');

      // Wait for requests to be processed
      const [result1, result2] = await Promise.all([request1, request2]);

      // Requests should succeed
      expect(result1).toBeUndefined();
      expect(result2).toBeUndefined();
      expect(router.getQueuedRequestCount('oauth-agent')).toBe(0);
    });

    it('should reject queued requests when OAuth auth fails', async () => {
      const agents = new Map<string, RegistryAgent>();
      agents.set('oauth-agent', {
        id: 'oauth-agent',
        name: 'OAuth Agent',
        version: '1.0.0',
        distribution: { npx: { package: 'oauth-agent' } },
      });

      const registry = createMockRegistry(agents);
      const runtimeManager = createMockRuntimeManager();
      const writeCallback = jest.fn().mockReturnValue(true);

      const router = new MessageRouter(registry, runtimeManager, writeCallback);

      // Simulate OAuth flow starting
      router.setAuthState('oauth-agent', 'pending');

      // Queue a request
      const requestPromise = router.route({
        jsonrpc: '2.0',
        id: 1,
        method: 'session/new',
        agentId: 'oauth-agent',
        params: {},
      });

      expect(router.getQueuedRequestCount('oauth-agent')).toBe(1);

      // OAuth flow fails
      router.setAuthState('oauth-agent', 'failed');

      // Request should be rejected with AUTH_REQUIRED
      const result = await requestPromise;
      expect(result).toBeDefined();
      expect(result?.error.code).toBe(-32004);
      expect(result?.error.message).toBe('Authentication required');
    });

    it('should not queue requests for different agents', async () => {
      const agents = new Map<string, RegistryAgent>();
      agents.set('oauth-agent', {
        id: 'oauth-agent',
        name: 'OAuth Agent',
        version: '1.0.0',
        distribution: { npx: { package: 'oauth-agent' } },
      });
      agents.set('other-agent', {
        id: 'other-agent',
        name: 'Other Agent',
        version: '1.0.0',
        distribution: { npx: { package: 'other-agent' } },
      });

      const registry = createMockRegistry(agents);
      const runtimeManager = createMockRuntimeManager();
      const writeCallback = jest.fn().mockReturnValue(true);

      const router = new MessageRouter(registry, runtimeManager, writeCallback);

      // Only oauth-agent has pending auth
      router.setAuthState('oauth-agent', 'pending');

      // Request to oauth-agent should be queued
      const oauthRequest = router.route({
        jsonrpc: '2.0',
        id: 1,
        method: 'session/new',
        agentId: 'oauth-agent',
        params: {},
      });

      // Request to other-agent should proceed immediately
      const otherResult = await router.route({
        jsonrpc: '2.0',
        id: 2,
        method: 'session/new',
        agentId: 'other-agent',
        params: {},
      });

      expect(router.getQueuedRequestCount('oauth-agent')).toBe(1);
      expect(router.getQueuedRequestCount('other-agent')).toBe(0);
      expect(otherResult).toBeUndefined();

      // Complete OAuth for oauth-agent
      router.setAuthState('oauth-agent', 'authenticated');
      const oauthResult = await oauthRequest;
      expect(oauthResult).toBeUndefined();
    });
  });

  /**
   * Validates: Requirements 3.1, 11.2
   * Test state transitions: none → pending → authenticated
   */
  describe('state transitions', () => {
    it('should transition from none to pending when OAuth starts', () => {
      const registry = createMockRegistry(new Map());
      const runtimeManager = createMockRuntimeManager();
      const writeCallback = jest.fn().mockReturnValue(true);

      const router = new MessageRouter(registry, runtimeManager, writeCallback);

      // Initial state is none
      expect(router.getAuthState('test-agent')).toBe('none');

      // Transition to pending (OAuth flow starting)
      router.setAuthState('test-agent', 'pending');
      expect(router.getAuthState('test-agent')).toBe('pending');
    });

    it('should transition from pending to authenticated on success', () => {
      const registry = createMockRegistry(new Map());
      const runtimeManager = createMockRuntimeManager();
      const writeCallback = jest.fn().mockReturnValue(true);

      const router = new MessageRouter(registry, runtimeManager, writeCallback);

      // Start OAuth flow
      router.setAuthState('test-agent', 'pending');
      expect(router.getAuthState('test-agent')).toBe('pending');

      // OAuth succeeds
      router.setAuthState('test-agent', 'authenticated');
      expect(router.getAuthState('test-agent')).toBe('authenticated');
    });

    it('should transition from pending to failed on error', () => {
      const registry = createMockRegistry(new Map());
      const runtimeManager = createMockRuntimeManager();
      const writeCallback = jest.fn().mockReturnValue(true);

      const router = new MessageRouter(registry, runtimeManager, writeCallback);

      // Start OAuth flow
      router.setAuthState('test-agent', 'pending');
      expect(router.getAuthState('test-agent')).toBe('pending');

      // OAuth fails
      router.setAuthState('test-agent', 'failed');
      expect(router.getAuthState('test-agent')).toBe('failed');
    });

    it('should allow transition from failed to pending (retry)', () => {
      const registry = createMockRegistry(new Map());
      const runtimeManager = createMockRuntimeManager();
      const writeCallback = jest.fn().mockReturnValue(true);

      const router = new MessageRouter(registry, runtimeManager, writeCallback);

      // OAuth fails
      router.setAuthState('test-agent', 'failed');
      expect(router.getAuthState('test-agent')).toBe('failed');

      // Retry OAuth
      router.setAuthState('test-agent', 'pending');
      expect(router.getAuthState('test-agent')).toBe('pending');
    });

    it('should allow transition from authenticated to none (logout)', () => {
      const registry = createMockRegistry(new Map());
      const runtimeManager = createMockRuntimeManager();
      const writeCallback = jest.fn().mockReturnValue(true);

      const router = new MessageRouter(registry, runtimeManager, writeCallback);

      // Authenticated
      router.setAuthState('test-agent', 'authenticated');
      expect(router.getAuthState('test-agent')).toBe('authenticated');

      // Logout
      router.setAuthState('test-agent', 'none');
      expect(router.getAuthState('test-agent')).toBe('none');
    });

    it('should track state independently per agent', () => {
      const registry = createMockRegistry(new Map());
      const runtimeManager = createMockRuntimeManager();
      const writeCallback = jest.fn().mockReturnValue(true);

      const router = new MessageRouter(registry, runtimeManager, writeCallback);

      // Set different states for different agents
      router.setAuthState('agent-1', 'pending');
      router.setAuthState('agent-2', 'authenticated');
      router.setAuthState('agent-3', 'failed');

      expect(router.getAuthState('agent-1')).toBe('pending');
      expect(router.getAuthState('agent-2')).toBe('authenticated');
      expect(router.getAuthState('agent-3')).toBe('failed');
      expect(router.getAuthState('agent-4')).toBe('none');  // Unknown agent
    });

    it('should complete full OAuth lifecycle: none → pending → authenticated', async () => {
      const agents = new Map<string, RegistryAgent>();
      agents.set('oauth-agent', {
        id: 'oauth-agent',
        name: 'OAuth Agent',
        version: '1.0.0',
        distribution: { npx: { package: 'oauth-agent' } },
      });

      const registry = createMockRegistry(agents);
      const runtimeManager = createMockRuntimeManager();
      const writeCallback = jest.fn().mockReturnValue(true);

      const router = new MessageRouter(registry, runtimeManager, writeCallback);

      // Initial state
      expect(router.getAuthState('oauth-agent')).toBe('none');

      // Start OAuth flow
      router.setAuthState('oauth-agent', 'pending');
      expect(router.getAuthState('oauth-agent')).toBe('pending');

      // Queue a request during pending
      const requestPromise = router.route({
        jsonrpc: '2.0',
        id: 1,
        method: 'session/new',
        agentId: 'oauth-agent',
        params: {},
      });

      expect(router.getQueuedRequestCount('oauth-agent')).toBe(1);

      // OAuth completes successfully
      router.setAuthState('oauth-agent', 'authenticated');
      expect(router.getAuthState('oauth-agent')).toBe('authenticated');

      // Queued request should be processed
      const result = await requestPromise;
      expect(result).toBeUndefined();
      expect(router.getQueuedRequestCount('oauth-agent')).toBe(0);
    });

    it('should complete failed OAuth lifecycle: none → pending → failed', async () => {
      const agents = new Map<string, RegistryAgent>();
      agents.set('oauth-agent', {
        id: 'oauth-agent',
        name: 'OAuth Agent',
        version: '1.0.0',
        distribution: { npx: { package: 'oauth-agent' } },
      });

      const registry = createMockRegistry(agents);
      const runtimeManager = createMockRuntimeManager();
      const writeCallback = jest.fn().mockReturnValue(true);

      const router = new MessageRouter(registry, runtimeManager, writeCallback);

      // Initial state
      expect(router.getAuthState('oauth-agent')).toBe('none');

      // Start OAuth flow
      router.setAuthState('oauth-agent', 'pending');
      expect(router.getAuthState('oauth-agent')).toBe('pending');

      // Queue a request during pending
      const requestPromise = router.route({
        jsonrpc: '2.0',
        id: 1,
        method: 'session/new',
        agentId: 'oauth-agent',
        params: {},
      });

      expect(router.getQueuedRequestCount('oauth-agent')).toBe(1);

      // OAuth fails
      router.setAuthState('oauth-agent', 'failed');
      expect(router.getAuthState('oauth-agent')).toBe('failed');

      // Queued request should be rejected
      const result = await requestPromise;
      expect(result).toBeDefined();
      expect(result?.error.code).toBe(-32004);
      expect(router.getQueuedRequestCount('oauth-agent')).toBe(0);
    });
  });

  /**
   * Additional edge cases for OAuth negotiation
   */
  describe('edge cases', () => {
    it('should handle empty authMethods array', () => {
      const result = parseAuthMethods([]);
      expect(result).toEqual([]);
    });

    it('should handle authMethods with only invalid entries', () => {
      const raw = [
        { id: 'invalid-1', type: 'unknown-type' },
        { id: '', type: 'oauth2', providerId: 'google' },
        { type: 'api-key' },  // Missing id
      ];

      const result = parseAuthMethods(raw);
      expect(result).toEqual([]);
    });

    it('should preserve order of valid auth methods', () => {
      const raw = [
        { id: 'oauth2-github', type: 'oauth2', providerId: 'github' },
        { id: 'api-key', type: 'api-key' },
        { id: 'oauth2-google', type: 'oauth2', providerId: 'google' },
      ];

      const result = parseAuthMethods(raw);

      expect(result).toHaveLength(3);
      expect(result[0].id).toBe('oauth2-github');
      expect(result[1].id).toBe('api-key');
      expect(result[2].id).toBe('oauth2-google');
    });

    it('should handle concurrent state changes safely', async () => {
      const registry = createMockRegistry(new Map());
      const runtimeManager = createMockRuntimeManager();
      const writeCallback = jest.fn().mockReturnValue(true);

      const router = new MessageRouter(registry, runtimeManager, writeCallback);

      // Rapid state changes
      router.setAuthState('test-agent', 'pending');
      router.setAuthState('test-agent', 'authenticated');
      router.setAuthState('test-agent', 'none');
      router.setAuthState('test-agent', 'pending');
      router.setAuthState('test-agent', 'failed');

      // Final state should be 'failed'
      expect(router.getAuthState('test-agent')).toBe('failed');
    });
  });
});


// =============================================================================
// Task 23.3: AUTH_REQUIRED Enforcement Unit Tests
// =============================================================================

describe('AUTH_REQUIRED Enforcement (Task 23.3)', () => {
  /**
   * Validates: Requirement 11.2
   * Test AUTH_REQUIRED returned when OAuth needed but not authenticated
   */
  describe('AUTH_REQUIRED when OAuth needed but not authenticated', () => {
    it('should return AUTH_REQUIRED when agent requires OAuth but credentials not available', async () => {
      const agents = new Map<string, RegistryAgent>();
      agents.set('oauth-required-agent', {
        id: 'oauth-required-agent',
        name: 'OAuth Required Agent',
        version: '1.0.0',
        distribution: { npx: { package: 'oauth-required-agent' } },
      });

      const registry = createMockRegistry(agents);
      const runtimeManager = createMockRuntimeManager();
      const writeCallback = jest.fn().mockReturnValue(true);

      // Create router without AuthManager (no OAuth credentials available)
      const router = new MessageRouter(registry, runtimeManager, writeCallback);

      // Set OAuth requirement for the agent
      router.setAgentOAuthRequirement('oauth-required-agent', 'github');

      // Auth state is 'none' (not authenticated)
      expect(router.getAuthState('oauth-required-agent')).toBe('none');

      // Route a request - should return AUTH_REQUIRED
      const result = await router.route({
        jsonrpc: '2.0',
        id: 1,
        method: 'session/new',
        agentId: 'oauth-required-agent',
        params: {},
      });

      expect(result).toBeDefined();
      expect(result?.error.code).toBe(-32004); // AUTH_REQUIRED
      expect(result?.error.message).toBe('Authentication required');
    });

    it('should return AUTH_REQUIRED when auth state is failed', async () => {
      const agents = new Map<string, RegistryAgent>();
      agents.set('failed-auth-agent', {
        id: 'failed-auth-agent',
        name: 'Failed Auth Agent',
        version: '1.0.0',
        distribution: { npx: { package: 'failed-auth-agent' } },
      });

      const registry = createMockRegistry(agents);
      const runtimeManager = createMockRuntimeManager();
      const writeCallback = jest.fn().mockReturnValue(true);

      const router = new MessageRouter(registry, runtimeManager, writeCallback);

      // Set OAuth requirement and mark auth as failed
      router.setAgentOAuthRequirement('failed-auth-agent', 'github');
      router.setAuthState('failed-auth-agent', 'failed');

      // Route a request - should return AUTH_REQUIRED
      const result = await router.route({
        jsonrpc: '2.0',
        id: 2,
        method: 'session/prompt',
        agentId: 'failed-auth-agent',
        params: { prompt: 'test' },
      });

      expect(result).toBeDefined();
      expect(result?.error.code).toBe(-32004); // AUTH_REQUIRED
      expect(result?.error.message).toBe('Authentication required');
    });

    it('should block multiple request types when OAuth required but not authenticated', async () => {
      const agents = new Map<string, RegistryAgent>();
      agents.set('oauth-agent', {
        id: 'oauth-agent',
        name: 'OAuth Agent',
        version: '1.0.0',
        distribution: { npx: { package: 'oauth-agent' } },
      });

      const registry = createMockRegistry(agents);
      const runtimeManager = createMockRuntimeManager();
      const writeCallback = jest.fn().mockReturnValue(true);

      const router = new MessageRouter(registry, runtimeManager, writeCallback);

      // Set OAuth requirement
      router.setAgentOAuthRequirement('oauth-agent', 'google');

      // Test various request methods
      const methods = ['session/new', 'session/prompt', 'session/end', 'tools/call'];

      for (const method of methods) {
        const result = await router.route({
          jsonrpc: '2.0',
          id: `test-${method}`,
          method,
          agentId: 'oauth-agent',
          params: {},
        });

        expect(result).toBeDefined();
        expect(result?.error.code).toBe(-32004);
        expect(result?.error.message).toBe('Authentication required');
      }
    });
  });

  /**
   * Validates: Requirement 11.2
   * Test request proceeds when OAuth completed
   */
  describe('Request proceeds when OAuth completed', () => {
    it('should route request normally when auth state is authenticated', async () => {
      const agents = new Map<string, RegistryAgent>();
      agents.set('authenticated-agent', {
        id: 'authenticated-agent',
        name: 'Authenticated Agent',
        version: '1.0.0',
        distribution: { npx: { package: 'authenticated-agent' } },
      });

      const registry = createMockRegistry(agents);
      const runtimeManager = createMockRuntimeManager();
      const writeCallback = jest.fn().mockReturnValue(true);

      const router = new MessageRouter(registry, runtimeManager, writeCallback);

      // Set OAuth requirement and mark as authenticated
      router.setAgentOAuthRequirement('authenticated-agent', 'github');
      router.setAuthState('authenticated-agent', 'authenticated');

      // Route a request - should proceed normally
      const result = await router.route({
        jsonrpc: '2.0',
        id: 1,
        method: 'session/new',
        agentId: 'authenticated-agent',
        params: {},
      });

      // No error returned means request was routed successfully
      expect(result).toBeUndefined();
    });

    it('should process queued requests after OAuth completes successfully', async () => {
      const agents = new Map<string, RegistryAgent>();
      agents.set('pending-auth-agent', {
        id: 'pending-auth-agent',
        name: 'Pending Auth Agent',
        version: '1.0.0',
        distribution: { npx: { package: 'pending-auth-agent' } },
      });

      const registry = createMockRegistry(agents);
      const runtimeManager = createMockRuntimeManager();
      const writeCallback = jest.fn().mockReturnValue(true);

      const router = new MessageRouter(registry, runtimeManager, writeCallback);

      // Set OAuth requirement and mark as pending
      router.setAgentOAuthRequirement('pending-auth-agent', 'github');
      router.setAuthState('pending-auth-agent', 'pending');

      // Queue a request while auth is pending
      const requestPromise = router.route({
        jsonrpc: '2.0',
        id: 1,
        method: 'session/new',
        agentId: 'pending-auth-agent',
        params: {},
      });

      // Verify request is queued
      expect(router.getQueuedRequestCount('pending-auth-agent')).toBe(1);

      // Complete OAuth authentication
      router.setAuthState('pending-auth-agent', 'authenticated');

      // Wait for request to be processed
      const result = await requestPromise;

      // Request should succeed (no error)
      expect(result).toBeUndefined();
      expect(router.getQueuedRequestCount('pending-auth-agent')).toBe(0);
    });

    it('should allow requests for agents without OAuth requirements', async () => {
      const agents = new Map<string, RegistryAgent>();
      agents.set('no-auth-agent', {
        id: 'no-auth-agent',
        name: 'No Auth Agent',
        version: '1.0.0',
        distribution: { npx: { package: 'no-auth-agent' } },
      });

      const registry = createMockRegistry(agents);
      const runtimeManager = createMockRuntimeManager();
      const writeCallback = jest.fn().mockReturnValue(true);

      const router = new MessageRouter(registry, runtimeManager, writeCallback);

      // No OAuth requirement set for this agent
      expect(router.getAgentOAuthRequirement('no-auth-agent')).toBeUndefined();

      // Route a request - should proceed normally
      const result = await router.route({
        jsonrpc: '2.0',
        id: 1,
        method: 'session/new',
        agentId: 'no-auth-agent',
        params: {},
      });

      // No error returned means request was routed successfully
      expect(result).toBeUndefined();
    });
  });

  /**
   * Validates: Requirement 11.2
   * Test error response format matches spec (requiredMethod, supportedMethods, providerId)
   */
  describe('Error response format matches spec', () => {
    it('should include requiredMethod in AUTH_REQUIRED error', () => {
      const registry = createMockRegistry(new Map());
      const runtimeManager = createMockRuntimeManager();
      const writeCallback = jest.fn().mockReturnValue(true);

      const router = new MessageRouter(registry, runtimeManager, writeCallback);

      const errorResponse = router.createAuthRequiredError(1, 'test-agent', 'oauth2-google');

      expect(errorResponse.error.data).toBeDefined();
      const data = errorResponse.error.data as Record<string, unknown>;
      expect(data.requiredMethod).toBe('oauth2-google');
    });

    it('should include supportedMethods array in AUTH_REQUIRED error', () => {
      const registry = createMockRegistry(new Map());
      const runtimeManager = createMockRuntimeManager();
      const writeCallback = jest.fn().mockReturnValue(true);

      const router = new MessageRouter(registry, runtimeManager, writeCallback);

      const errorResponse = router.createAuthRequiredError(1, 'test-agent', 'oauth2-github');

      expect(errorResponse.error.data).toBeDefined();
      const data = errorResponse.error.data as Record<string, unknown>;
      expect(data.supportedMethods).toBeDefined();
      expect(Array.isArray(data.supportedMethods)).toBe(true);
      expect((data.supportedMethods as string[]).length).toBeGreaterThan(0);
    });

    it('should include agentId in AUTH_REQUIRED error', () => {
      const registry = createMockRegistry(new Map());
      const runtimeManager = createMockRuntimeManager();
      const writeCallback = jest.fn().mockReturnValue(true);

      const router = new MessageRouter(registry, runtimeManager, writeCallback);

      const errorResponse = router.createAuthRequiredError(1, 'my-test-agent', 'oauth2-google');

      expect(errorResponse.error.data).toBeDefined();
      const data = errorResponse.error.data as Record<string, unknown>;
      expect(data.agentId).toBe('my-test-agent');
    });

    it('should include providerId in AUTH_REQUIRED error when OAuth required', async () => {
      const agents = new Map<string, RegistryAgent>();
      agents.set('oauth-agent', {
        id: 'oauth-agent',
        name: 'OAuth Agent',
        version: '1.0.0',
        distribution: { npx: { package: 'oauth-agent' } },
      });

      const registry = createMockRegistry(agents);
      const runtimeManager = createMockRuntimeManager();
      const writeCallback = jest.fn().mockReturnValue(true);

      const router = new MessageRouter(registry, runtimeManager, writeCallback);

      // Set OAuth requirement with specific provider
      router.setAgentOAuthRequirement('oauth-agent', 'azure');

      // Route a request - should return AUTH_REQUIRED with providerId
      const result = await router.route({
        jsonrpc: '2.0',
        id: 1,
        method: 'session/new',
        agentId: 'oauth-agent',
        params: {},
      });

      expect(result).toBeDefined();
      expect(result?.error.code).toBe(-32004);
      expect(result?.error.data).toBeDefined();
      const data = result?.error.data as Record<string, unknown>;
      expect(data.providerId).toBe('azure');
    });

    it('should have correct JSON-RPC 2.0 error structure', () => {
      const registry = createMockRegistry(new Map());
      const runtimeManager = createMockRuntimeManager();
      const writeCallback = jest.fn().mockReturnValue(true);

      const router = new MessageRouter(registry, runtimeManager, writeCallback);

      const errorResponse = router.createAuthRequiredError(42, 'test-agent', 'oauth2-cognito');

      // Verify JSON-RPC 2.0 structure
      expect(errorResponse.jsonrpc).toBe('2.0');
      expect(errorResponse.id).toBe(42);
      expect(errorResponse.error).toBeDefined();
      expect(errorResponse.error.code).toBe(-32004);
      expect(errorResponse.error.message).toBe('Authentication required');
    });

    it('should default requiredMethod to api-key when not specified', () => {
      const registry = createMockRegistry(new Map());
      const runtimeManager = createMockRuntimeManager();
      const writeCallback = jest.fn().mockReturnValue(true);

      const router = new MessageRouter(registry, runtimeManager, writeCallback);

      const errorResponse = router.createAuthRequiredError(1, 'test-agent');

      expect(errorResponse.error.data).toBeDefined();
      const data = errorResponse.error.data as Record<string, unknown>;
      expect(data.requiredMethod).toBe('api-key');
    });

    it('should include all supported auth methods in supportedMethods', () => {
      const registry = createMockRegistry(new Map());
      const runtimeManager = createMockRuntimeManager();
      const writeCallback = jest.fn().mockReturnValue(true);

      const router = new MessageRouter(registry, runtimeManager, writeCallback);

      const errorResponse = router.createAuthRequiredError(1, 'test-agent', 'oauth2-google');

      const data = errorResponse.error.data as Record<string, unknown>;
      const supportedMethods = data.supportedMethods as string[];

      // Should include at least the basic api-key methods
      expect(supportedMethods).toContain('api-key');
    });

    it('should handle null request ID in error response', () => {
      const registry = createMockRegistry(new Map());
      const runtimeManager = createMockRuntimeManager();
      const writeCallback = jest.fn().mockReturnValue(true);

      const router = new MessageRouter(registry, runtimeManager, writeCallback);

      const errorResponse = router.createAuthRequiredError(null, 'test-agent', 'oauth2-google');

      expect(errorResponse.jsonrpc).toBe('2.0');
      expect(errorResponse.id).toBeNull();
      expect(errorResponse.error.code).toBe(-32004);
    });

    it('should handle string request ID in error response', () => {
      const registry = createMockRegistry(new Map());
      const runtimeManager = createMockRuntimeManager();
      const writeCallback = jest.fn().mockReturnValue(true);

      const router = new MessageRouter(registry, runtimeManager, writeCallback);

      const errorResponse = router.createAuthRequiredError('request-uuid-123', 'test-agent', 'oauth2-github');

      expect(errorResponse.jsonrpc).toBe('2.0');
      expect(errorResponse.id).toBe('request-uuid-123');
      expect(errorResponse.error.code).toBe(-32004);
    });
  });

  /**
   * Additional edge cases for AUTH_REQUIRED enforcement
   */
  describe('Edge cases', () => {
    it('should handle OAuth requirement being set after initial request', async () => {
      const agents = new Map<string, RegistryAgent>();
      agents.set('dynamic-auth-agent', {
        id: 'dynamic-auth-agent',
        name: 'Dynamic Auth Agent',
        version: '1.0.0',
        distribution: { npx: { package: 'dynamic-auth-agent' } },
      });

      const registry = createMockRegistry(agents);
      const runtimeManager = createMockRuntimeManager();
      const writeCallback = jest.fn().mockReturnValue(true);

      const router = new MessageRouter(registry, runtimeManager, writeCallback);

      // First request should succeed (no OAuth requirement)
      const result1 = await router.route({
        jsonrpc: '2.0',
        id: 1,
        method: 'session/new',
        agentId: 'dynamic-auth-agent',
        params: {},
      });
      expect(result1).toBeUndefined();

      // Set OAuth requirement
      router.setAgentOAuthRequirement('dynamic-auth-agent', 'github');

      // Second request should fail with AUTH_REQUIRED
      const result2 = await router.route({
        jsonrpc: '2.0',
        id: 2,
        method: 'session/prompt',
        agentId: 'dynamic-auth-agent',
        params: {},
      });
      expect(result2).toBeDefined();
      expect(result2?.error.code).toBe(-32004);
    });

    it('should clear OAuth requirement and allow requests again', async () => {
      const agents = new Map<string, RegistryAgent>();
      agents.set('clearable-auth-agent', {
        id: 'clearable-auth-agent',
        name: 'Clearable Auth Agent',
        version: '1.0.0',
        distribution: { npx: { package: 'clearable-auth-agent' } },
      });

      const registry = createMockRegistry(agents);
      const runtimeManager = createMockRuntimeManager();
      const writeCallback = jest.fn().mockReturnValue(true);

      const router = new MessageRouter(registry, runtimeManager, writeCallback);

      // Set OAuth requirement
      router.setAgentOAuthRequirement('clearable-auth-agent', 'github');

      // Request should fail
      const result1 = await router.route({
        jsonrpc: '2.0',
        id: 1,
        method: 'session/new',
        agentId: 'clearable-auth-agent',
        params: {},
      });
      expect(result1?.error.code).toBe(-32004);

      // Clear OAuth requirement
      router.clearAgentOAuthRequirement('clearable-auth-agent');

      // Request should succeed now
      const result2 = await router.route({
        jsonrpc: '2.0',
        id: 2,
        method: 'session/new',
        agentId: 'clearable-auth-agent',
        params: {},
      });
      expect(result2).toBeUndefined();
    });

    it('should handle multiple agents with different OAuth requirements', async () => {
      const agents = new Map<string, RegistryAgent>();
      agents.set('agent-google', {
        id: 'agent-google',
        name: 'Google Agent',
        version: '1.0.0',
        distribution: { npx: { package: 'agent-google' } },
      });
      agents.set('agent-github', {
        id: 'agent-github',
        name: 'GitHub Agent',
        version: '1.0.0',
        distribution: { npx: { package: 'agent-github' } },
      });
      agents.set('agent-no-auth', {
        id: 'agent-no-auth',
        name: 'No Auth Agent',
        version: '1.0.0',
        distribution: { npx: { package: 'agent-no-auth' } },
      });

      const registry = createMockRegistry(agents);
      const runtimeManager = createMockRuntimeManager();
      const writeCallback = jest.fn().mockReturnValue(true);

      const router = new MessageRouter(registry, runtimeManager, writeCallback);

      // Set different OAuth requirements
      router.setAgentOAuthRequirement('agent-google', 'google');
      router.setAgentOAuthRequirement('agent-github', 'github');
      // agent-no-auth has no OAuth requirement

      // Authenticate only agent-google
      router.setAuthState('agent-google', 'authenticated');

      // agent-google should succeed
      const result1 = await router.route({
        jsonrpc: '2.0',
        id: 1,
        method: 'session/new',
        agentId: 'agent-google',
        params: {},
      });
      expect(result1).toBeUndefined();

      // agent-github should fail (not authenticated)
      const result2 = await router.route({
        jsonrpc: '2.0',
        id: 2,
        method: 'session/new',
        agentId: 'agent-github',
        params: {},
      });
      expect(result2?.error.code).toBe(-32004);
      expect((result2?.error.data as any).providerId).toBe('github');

      // agent-no-auth should succeed (no OAuth requirement)
      const result3 = await router.route({
        jsonrpc: '2.0',
        id: 3,
        method: 'session/new',
        agentId: 'agent-no-auth',
        params: {},
      });
      expect(result3).toBeUndefined();
    });
  });
});


// =============================================================================
// Task 35: Agent Auth Flow Tests
// =============================================================================

describe('getAgentAuthMethods', () => {
  it('should filter only agent auth methods', () => {
    const methods = parseAuthMethods([
      { id: 'my-agent-auth', type: 'agent' },
      { id: 'oauth2-google', type: 'oauth2', providerId: 'google' },
      { id: 'api-key', type: 'api-key' },
      { id: 'another-agent', type: 'agent', providerId: 'github' },
    ]);

    const agentMethods = getAgentAuthMethods(methods);

    expect(agentMethods).toHaveLength(2);
    expect(agentMethods.every(m => m.kind === 'agent')).toBe(true);
    expect(agentMethods.map(m => m.id)).toEqual(['my-agent-auth', 'another-agent']);
  });

  it('should return empty array when no agent auth methods', () => {
    const methods = parseAuthMethods([
      { id: 'oauth2-google', type: 'oauth2', providerId: 'google' },
      { id: 'api-key', type: 'api-key' },
    ]);

    const agentMethods = getAgentAuthMethods(methods);

    expect(agentMethods).toHaveLength(0);
  });
});

describe('Agent Auth Flow (Task 35)', () => {
  describe('authenticate method call (Task 35.1)', () => {
    it('should call authenticate method on agent with correct id', async () => {
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

      const router = new MessageRouter(registry, runtimeManager, writeCallback, {}, undefined, true);

      // Simulate agent returning authMethods with type: "agent"
      const initializeResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: {
          name: 'Test Agent',
          version: '1.0.0',
          authMethods: [
            { id: 'my-agent-auth', type: 'agent', name: 'Agent Auth' },
          ],
        },
      };

      // First, route an initialize request to set up pending request tracking
      await router.route({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        agentId: 'test-agent',
        params: {},
      });

      // Handle the initialize response - this should trigger Agent Auth
      router.handleAgentResponse('test-agent', initializeResponse);

      // Wait for async Agent Auth flow to start
      await new Promise(resolve => setTimeout(resolve, 100));

      // Check that auth state is pending (Agent Auth flow started)
      expect(router.getAuthState('test-agent')).toBe('pending');

      // Check that authenticate request was sent to agent
      const writtenMessages = (runtimeManager as any).writtenMessages;
      const authRequest = writtenMessages.find((m: any) => m.method === 'authenticate');
      expect(authRequest).toBeDefined();
      expect(authRequest.params.id).toBe('my-agent-auth');
    });
  });

  describe('authenticate response handling (Task 35.2)', () => {
    it('should set auth state to authenticated on success response', async () => {
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

      const router = new MessageRouter(registry, runtimeManager, writeCallback, {}, undefined, true);

      // Set up the agent auth flow
      await router.route({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        agentId: 'test-agent',
        params: {},
      });

      // Simulate agent returning authMethods with type: "agent"
      const initializeResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: {
          name: 'Test Agent',
          version: '1.0.0',
          authMethods: [
            { id: 'my-agent-auth', type: 'agent', name: 'Agent Auth' },
          ],
        },
      };

      router.handleAgentResponse('test-agent', initializeResponse);

      // Wait for async Agent Auth flow to start
      await new Promise(resolve => setTimeout(resolve, 100));

      // Auth state should be pending
      expect(router.getAuthState('test-agent')).toBe('pending');

      // Find the authenticate request ID
      const writtenMessages = (runtimeManager as any).writtenMessages;
      const authRequest = writtenMessages.find((m: any) => m.method === 'authenticate');
      expect(authRequest).toBeDefined();

      // Simulate successful authenticate response from agent
      const authResponse = {
        jsonrpc: '2.0',
        id: authRequest.id,
        result: { success: true },
      };

      router.handleAgentResponse('test-agent', authResponse);

      // Wait for async response handling
      await new Promise(resolve => setTimeout(resolve, 100));

      // Auth state should now be authenticated
      expect(router.getAuthState('test-agent')).toBe('authenticated');
    });

    it('should set auth state to failed on error response', async () => {
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

      const router = new MessageRouter(registry, runtimeManager, writeCallback, {}, undefined, true);

      // Set up the agent auth flow
      await router.route({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        agentId: 'test-agent',
        params: {},
      });

      // Simulate agent returning authMethods with type: "agent"
      const initializeResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: {
          name: 'Test Agent',
          version: '1.0.0',
          authMethods: [
            { id: 'my-agent-auth', type: 'agent', name: 'Agent Auth' },
          ],
        },
      };

      router.handleAgentResponse('test-agent', initializeResponse);

      // Wait for async Agent Auth flow to start
      await new Promise(resolve => setTimeout(resolve, 100));

      // Auth state should be pending
      expect(router.getAuthState('test-agent')).toBe('pending');

      // Find the authenticate request ID
      const writtenMessages = (runtimeManager as any).writtenMessages;
      const authRequest = writtenMessages.find((m: any) => m.method === 'authenticate');
      expect(authRequest).toBeDefined();

      // Simulate error authenticate response from agent
      const authResponse = {
        jsonrpc: '2.0',
        id: authRequest.id,
        error: {
          code: -32000,
          message: 'Authentication failed: user cancelled',
        },
      };

      router.handleAgentResponse('test-agent', authResponse);

      // Wait for async response handling
      await new Promise(resolve => setTimeout(resolve, 100));

      // Auth state should now be failed
      expect(router.getAuthState('test-agent')).toBe('failed');
    });

    it('should retry queued requests after successful Agent Auth', async () => {
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

      const router = new MessageRouter(registry, runtimeManager, writeCallback, {}, undefined, true);

      // Set auth state to pending to queue requests
      router.setAuthState('test-agent', 'pending');

      // Queue a request
      const routePromise = router.route({
        jsonrpc: '2.0',
        id: 2,
        method: 'session/new',
        agentId: 'test-agent',
        params: {},
      });

      // Verify request is queued
      expect(router.getQueuedRequestCount('test-agent')).toBe(1);

      // Transition to authenticated - should process queued requests
      router.setAuthState('test-agent', 'authenticated');

      // Wait for the route promise to resolve
      const result = await routePromise;

      // Request should have been processed successfully
      expect(result).toBeUndefined();
      expect(router.getQueuedRequestCount('test-agent')).toBe(0);
    });

    it('should return AUTH_REQUIRED for queued requests after failed Agent Auth', async () => {
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

      const router = new MessageRouter(registry, runtimeManager, writeCallback, {}, undefined, true);

      // Set auth state to pending to queue requests
      router.setAuthState('test-agent', 'pending');

      // Queue a request
      const routePromise = router.route({
        jsonrpc: '2.0',
        id: 2,
        method: 'session/new',
        agentId: 'test-agent',
        params: {},
      });

      // Verify request is queued
      expect(router.getQueuedRequestCount('test-agent')).toBe(1);

      // Transition to failed - should reject queued requests
      router.setAuthState('test-agent', 'failed');

      // Wait for the route promise to resolve
      const result = await routePromise;

      // Request should have been rejected with AUTH_REQUIRED
      expect(result).toBeDefined();
      expect(result?.error.code).toBe(-32004); // AUTH_REQUIRED
      expect(router.getQueuedRequestCount('test-agent')).toBe(0);
    });
  });

  describe('Agent Auth precedence', () => {
    it('should prefer Agent Auth over OAuth when both are present', () => {
      // When agent provides both type: "agent" and type: "oauth2",
      // Agent Auth should be used (agent handles OAuth internally)
      const methods = parseAuthMethods([
        { id: 'my-agent-auth', type: 'agent', name: 'Agent Auth' },
        { id: 'oauth2-google', type: 'oauth2', providerId: 'google' },
      ]);

      const agentMethods = getAgentAuthMethods(methods);
      const oauthMethods = getOAuthMethods(methods);

      // Both should be parsed
      expect(agentMethods).toHaveLength(1);
      expect(oauthMethods).toHaveLength(1);

      // Agent Auth should be first in precedence (checked first in attemptAuthentication)
      expect(agentMethods[0].id).toBe('my-agent-auth');
    });
  });
});


// =============================================================================
// Task 35.3: Agent Auth Flow Tests
// =============================================================================

describe('Agent Auth Flow (Task 35)', () => {
  describe('callAgentAuthenticate (Task 35.1)', () => {
    it('should send authenticate JSON-RPC request to agent', async () => {
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

      const router = new MessageRouter(registry, runtimeManager, writeCallback, {}, undefined, true);

      // Simulate agent returning authMethods with type: "agent"
      const initializeResponse = {
        jsonrpc: '2.0',
        id: 'init-1',
        result: {
          protocolVersion: '1.0',
          authMethods: [
            { id: 'agent-google', type: 'agent', providerId: 'google' },
          ],
        },
      };

      // First, route an initialize request to set up pending request tracking
      await router.route({
        jsonrpc: '2.0',
        id: 'init-1',
        method: 'initialize',
        agentId: 'test-agent',
        params: {},
      });

      // Handle the initialize response - this should trigger Agent Auth
      router.handleAgentResponse('test-agent', initializeResponse);

      // Wait for async auth flow to start
      await new Promise(resolve => setTimeout(resolve, 100));

      // Check that authenticate request was sent to agent
      const writtenMessages = (runtimeManager as any).writtenMessages;
      const authenticateRequest = writtenMessages.find(
        (msg: any) => msg.method === 'authenticate'
      );

      expect(authenticateRequest).toBeDefined();
      expect(authenticateRequest.jsonrpc).toBe('2.0');
      expect(authenticateRequest.method).toBe('authenticate');
      expect(authenticateRequest.params).toBeDefined();
      expect(authenticateRequest.params.id).toBe('agent-google');
      expect(authenticateRequest.id).toMatch(/^agent-auth-test-agent-/);
    });

    it('should include correct auth method id in authenticate request', async () => {
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

      const router = new MessageRouter(registry, runtimeManager, writeCallback, {}, undefined, true);

      // Route initialize request
      await router.route({
        jsonrpc: '2.0',
        id: 'init-1',
        method: 'initialize',
        agentId: 'test-agent',
        params: {},
      });

      // Handle initialize response with custom auth method id
      router.handleAgentResponse('test-agent', {
        jsonrpc: '2.0',
        id: 'init-1',
        result: {
          protocolVersion: '1.0',
          authMethods: [
            { id: 'custom-auth-method', type: 'agent' },
          ],
        },
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      const writtenMessages = (runtimeManager as any).writtenMessages;
      const authenticateRequest = writtenMessages.find(
        (msg: any) => msg.method === 'authenticate'
      );

      expect(authenticateRequest).toBeDefined();
      expect(authenticateRequest.params.id).toBe('custom-auth-method');
    });
  });

  describe('handleAuthenticateResponse (Task 35.2)', () => {
    it('should set auth state to authenticated on success response', async () => {
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

      const router = new MessageRouter(registry, runtimeManager, writeCallback, {}, undefined, true);

      // Route initialize request
      await router.route({
        jsonrpc: '2.0',
        id: 'init-1',
        method: 'initialize',
        agentId: 'test-agent',
        params: {},
      });

      // Handle initialize response to trigger auth
      router.handleAgentResponse('test-agent', {
        jsonrpc: '2.0',
        id: 'init-1',
        result: {
          protocolVersion: '1.0',
          authMethods: [
            { id: 'agent-google', type: 'agent', providerId: 'google' },
          ],
        },
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      // Get the authenticate request id
      const writtenMessages = (runtimeManager as any).writtenMessages;
      const authenticateRequest = writtenMessages.find(
        (msg: any) => msg.method === 'authenticate'
      );
      const authRequestId = authenticateRequest?.id;

      expect(authRequestId).toBeDefined();

      // Simulate successful authenticate response from agent
      router.handleAgentResponse('test-agent', {
        jsonrpc: '2.0',
        id: authRequestId,
        result: { success: true },
      });

      // Wait for state update
      await new Promise(resolve => setTimeout(resolve, 50));

      // Auth state should be authenticated
      expect(router.getAuthState('test-agent')).toBe('authenticated');
    });

    it('should set auth state to failed on error response', async () => {
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

      const router = new MessageRouter(registry, runtimeManager, writeCallback, {}, undefined, true);

      // Route initialize request
      await router.route({
        jsonrpc: '2.0',
        id: 'init-1',
        method: 'initialize',
        agentId: 'test-agent',
        params: {},
      });

      // Handle initialize response to trigger auth
      router.handleAgentResponse('test-agent', {
        jsonrpc: '2.0',
        id: 'init-1',
        result: {
          protocolVersion: '1.0',
          authMethods: [
            { id: 'agent-google', type: 'agent', providerId: 'google' },
          ],
        },
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      // Get the authenticate request id
      const writtenMessages = (runtimeManager as any).writtenMessages;
      const authenticateRequest = writtenMessages.find(
        (msg: any) => msg.method === 'authenticate'
      );
      const authRequestId = authenticateRequest?.id;

      // Simulate error response from agent
      router.handleAgentResponse('test-agent', {
        jsonrpc: '2.0',
        id: authRequestId,
        error: {
          code: -32001,
          message: 'Authentication failed: user cancelled',
        },
      });

      // Wait for state update
      await new Promise(resolve => setTimeout(resolve, 50));

      // Auth state should be failed
      expect(router.getAuthState('test-agent')).toBe('failed');
    });

    it('should process queued requests after successful authentication', async () => {
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

      const router = new MessageRouter(registry, runtimeManager, writeCallback, {}, undefined, true);

      // Set auth state to pending to queue requests
      router.setAuthState('test-agent', 'pending');

      // Queue a request
      const routePromise = router.route({
        jsonrpc: '2.0',
        id: 'queued-1',
        method: 'session/new',
        agentId: 'test-agent',
        params: {},
      });

      expect(router.getQueuedRequestCount('test-agent')).toBe(1);

      // Simulate successful authentication
      router.setAuthState('test-agent', 'authenticated');

      // Wait for queued request to be processed
      const result = await routePromise;

      expect(result).toBeUndefined(); // No error
      expect(router.getQueuedRequestCount('test-agent')).toBe(0);
    });

    it('should reject queued requests after failed authentication', async () => {
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

      const router = new MessageRouter(registry, runtimeManager, writeCallback, {}, undefined, true);

      // Set auth state to pending to queue requests
      router.setAuthState('test-agent', 'pending');

      // Queue a request
      const routePromise = router.route({
        jsonrpc: '2.0',
        id: 'queued-1',
        method: 'session/new',
        agentId: 'test-agent',
        params: {},
      });

      expect(router.getQueuedRequestCount('test-agent')).toBe(1);

      // Simulate failed authentication
      router.setAuthState('test-agent', 'failed');

      // Wait for queued request to be rejected
      const result = await routePromise;

      expect(result).toBeDefined();
      expect(result?.error.code).toBe(-32004); // AUTH_REQUIRED
      expect(router.getQueuedRequestCount('test-agent')).toBe(0);
    });

    it('should not forward authenticate response to client', async () => {
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

      const router = new MessageRouter(registry, runtimeManager, writeCallback, {}, undefined, true);

      // Route initialize request
      await router.route({
        jsonrpc: '2.0',
        id: 'init-1',
        method: 'initialize',
        agentId: 'test-agent',
        params: {},
      });

      // Handle initialize response to trigger auth
      router.handleAgentResponse('test-agent', {
        jsonrpc: '2.0',
        id: 'init-1',
        result: {
          protocolVersion: '1.0',
          authMethods: [
            { id: 'agent-google', type: 'agent', providerId: 'google' },
          ],
        },
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      // Get the authenticate request id
      const writtenMessages = (runtimeManager as any).writtenMessages;
      const authenticateRequest = writtenMessages.find(
        (msg: any) => msg.method === 'authenticate'
      );
      const authRequestId = authenticateRequest?.id;

      // Clear writeCallback calls
      writeCallback.mockClear();

      // Simulate authenticate response from agent
      router.handleAgentResponse('test-agent', {
        jsonrpc: '2.0',
        id: authRequestId,
        result: { success: true },
      });

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 50));

      // writeCallback should NOT have been called with authenticate response
      // (authenticate responses are internal and not forwarded to client)
      const authenticateResponseForwarded = writeCallback.mock.calls.some(
        (call: any[]) => call[0]?.id === authRequestId
      );
      expect(authenticateResponseForwarded).toBe(false);
    });
  });

  describe('Agent Auth state transitions', () => {
    it('should transition: none -> pending -> authenticated', async () => {
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

      const router = new MessageRouter(registry, runtimeManager, writeCallback, {}, undefined, true);

      // Initial state
      expect(router.getAuthState('test-agent')).toBe('none');

      // Route initialize request
      await router.route({
        jsonrpc: '2.0',
        id: 'init-1',
        method: 'initialize',
        agentId: 'test-agent',
        params: {},
      });

      // Handle initialize response with authMethods
      router.handleAgentResponse('test-agent', {
        jsonrpc: '2.0',
        id: 'init-1',
        result: {
          protocolVersion: '1.0',
          authMethods: [
            { id: 'agent-google', type: 'agent', providerId: 'google' },
          ],
        },
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      // State should be pending while waiting for authenticate response
      expect(router.getAuthState('test-agent')).toBe('pending');

      // Get authenticate request id and simulate success
      const writtenMessages = (runtimeManager as any).writtenMessages;
      const authenticateRequest = writtenMessages.find(
        (msg: any) => msg.method === 'authenticate'
      );

      router.handleAgentResponse('test-agent', {
        jsonrpc: '2.0',
        id: authenticateRequest?.id,
        result: { success: true },
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      // State should be authenticated
      expect(router.getAuthState('test-agent')).toBe('authenticated');
    });

    it('should transition: none -> pending -> failed', async () => {
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

      const router = new MessageRouter(registry, runtimeManager, writeCallback, {}, undefined, true);

      // Initial state
      expect(router.getAuthState('test-agent')).toBe('none');

      // Route initialize request
      await router.route({
        jsonrpc: '2.0',
        id: 'init-1',
        method: 'initialize',
        agentId: 'test-agent',
        params: {},
      });

      // Handle initialize response with authMethods
      router.handleAgentResponse('test-agent', {
        jsonrpc: '2.0',
        id: 'init-1',
        result: {
          protocolVersion: '1.0',
          authMethods: [
            { id: 'agent-google', type: 'agent', providerId: 'google' },
          ],
        },
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      // State should be pending
      expect(router.getAuthState('test-agent')).toBe('pending');

      // Get authenticate request id and simulate failure
      const writtenMessages = (runtimeManager as any).writtenMessages;
      const authenticateRequest = writtenMessages.find(
        (msg: any) => msg.method === 'authenticate'
      );

      router.handleAgentResponse('test-agent', {
        jsonrpc: '2.0',
        id: authenticateRequest?.id,
        error: { code: -32001, message: 'User cancelled' },
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      // State should be failed
      expect(router.getAuthState('test-agent')).toBe('failed');
    });
  });

  describe('getAgentAuthMethods', () => {
    it('should filter only agent auth methods', () => {
      const methods = parseAuthMethods([
        { id: 'agent-google', type: 'agent', providerId: 'google' },
        { id: 'oauth2-github', type: 'oauth2', providerId: 'github' },
        { id: 'my-agent-auth', type: 'agent' },
        { id: 'api-key', type: 'api-key' },
      ]);

      const agentMethods = getAgentAuthMethods(methods);

      expect(agentMethods).toHaveLength(2);
      expect(agentMethods.every(m => m.kind === 'agent')).toBe(true);
      expect(agentMethods.map(m => m.id)).toEqual(['agent-google', 'my-agent-auth']);
    });

    it('should return empty array when no agent auth methods', () => {
      const methods = parseAuthMethods([
        { id: 'oauth2-google', type: 'oauth2', providerId: 'google' },
        { id: 'api-key', type: 'api-key' },
      ]);

      const agentMethods = getAgentAuthMethods(methods);

      expect(agentMethods).toHaveLength(0);
    });
  });
});


// =============================================================================
// Task 36.4: Terminal Auth Flow Tests
// =============================================================================

import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';
import type { MessageRouterDeps, SpawnFn } from './message-router.js';
import { getTerminalAuthMethods } from './message-router.js';

/**
 * Create a mock child process for testing Terminal Auth.
 */
function createMockChildProcess(): ChildProcess & EventEmitter {
  const child = new EventEmitter() as ChildProcess & EventEmitter;
  (child as any).killed = false;
  child.kill = jest.fn(() => {
    (child as any).killed = true;
    return true;
  }) as any;
  return child;
}

describe('Terminal Auth Flow (Task 36)', () => {
  describe('getTerminalAuthMethods', () => {
    it('should filter only terminal auth methods', () => {
      const methods = parseAuthMethods([
        { id: 'terminal-setup', type: 'terminal', args: ['--setup'] },
        { id: 'oauth2-google', type: 'oauth2', providerId: 'google' },
        { id: 'terminal-login', type: 'terminal', args: ['--login'], env: { DEBUG: 'true' } },
        { id: 'api-key', type: 'api-key' },
      ]);

      const terminalMethods = getTerminalAuthMethods(methods);

      expect(terminalMethods).toHaveLength(2);
      expect(terminalMethods.every(m => m.kind === 'terminal')).toBe(true);
      expect(terminalMethods.map(m => m.id)).toEqual(['terminal-setup', 'terminal-login']);
    });

    it('should return empty array when no terminal auth methods', () => {
      const methods = parseAuthMethods([
        { id: 'oauth2-google', type: 'oauth2', providerId: 'google' },
        { id: 'api-key', type: 'api-key' },
      ]);

      const terminalMethods = getTerminalAuthMethods(methods);

      expect(terminalMethods).toHaveLength(0);
    });

    it('should parse args and env from terminal auth method', () => {
      const methods = parseAuthMethods([
        {
          id: 'terminal-setup',
          type: 'terminal',
          args: ['--setup', '--provider', 'github'],
          env: { API_KEY: 'test', DEBUG: 'true' },
        },
      ]);

      expect(methods).toHaveLength(1);
      expect(methods[0].kind).toBe('terminal');
      if (methods[0].kind === 'terminal') {
        expect(methods[0].args).toEqual(['--setup', '--provider', 'github']);
        expect(methods[0].env).toEqual({ API_KEY: 'test', DEBUG: 'true' });
      }
    });

    it('should handle terminal auth method without args/env', () => {
      const methods = parseAuthMethods([
        { id: 'terminal-basic', type: 'terminal' },
      ]);

      expect(methods).toHaveLength(1);
      expect(methods[0].kind).toBe('terminal');
      if (methods[0].kind === 'terminal') {
        expect(methods[0].args).toBeUndefined();
        expect(methods[0].env).toBeUndefined();
      }
    });
  });

  describe('TTY check', () => {
    it('should fail Terminal Auth when stdin is not TTY', async () => {
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
      const mockSpawn = jest.fn();

      const deps: MessageRouterDeps = {
        spawnFn: mockSpawn as unknown as SpawnFn,
        isStdinTTY: () => false,  // Not a TTY
        isStdoutTTY: () => true,
      };

      const router = new MessageRouter(
        registry, runtimeManager, writeCallback, {}, undefined, true, deps
      );

      // Route initialize request
      await router.route({
        jsonrpc: '2.0',
        id: 'init-1',
        method: 'initialize',
        agentId: 'test-agent',
        params: {},
      });

      // Handle initialize response with terminal auth
      router.handleAgentResponse('test-agent', {
        jsonrpc: '2.0',
        id: 'init-1',
        result: {
          protocolVersion: '1.0',
          authMethods: [
            { id: 'terminal-setup', type: 'terminal', args: ['--setup'] },
          ],
        },
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      // Auth should fail because no TTY
      expect(router.getAuthState('test-agent')).toBe('failed');
      // spawn should NOT have been called
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('should fail Terminal Auth when stdout is not TTY', async () => {
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
      const mockSpawn = jest.fn();

      const deps: MessageRouterDeps = {
        spawnFn: mockSpawn as unknown as SpawnFn,
        isStdinTTY: () => true,
        isStdoutTTY: () => false,  // Not a TTY
      };

      const router = new MessageRouter(
        registry, runtimeManager, writeCallback, {}, undefined, true, deps
      );

      // Route initialize request
      await router.route({
        jsonrpc: '2.0',
        id: 'init-1',
        method: 'initialize',
        agentId: 'test-agent',
        params: {},
      });

      // Handle initialize response with terminal auth
      router.handleAgentResponse('test-agent', {
        jsonrpc: '2.0',
        id: 'init-1',
        result: {
          protocolVersion: '1.0',
          authMethods: [
            { id: 'terminal-setup', type: 'terminal', args: ['--setup'] },
          ],
        },
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      // Auth should fail because no TTY
      expect(router.getAuthState('test-agent')).toBe('failed');
      expect(mockSpawn).not.toHaveBeenCalled();
    });
  });

  describe('Terminal Auth process execution', () => {
    it('should set auth state to authenticated on exit code 0', async () => {
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

      const mockChild = createMockChildProcess();
      const mockSpawn = jest.fn().mockReturnValue(mockChild);

      const deps: MessageRouterDeps = {
        spawnFn: mockSpawn as unknown as SpawnFn,
        isStdinTTY: () => true,
        isStdoutTTY: () => true,
      };

      const router = new MessageRouter(
        registry, runtimeManager, writeCallback, {}, undefined, true, deps
      );

      // Route initialize request
      await router.route({
        jsonrpc: '2.0',
        id: 'init-1',
        method: 'initialize',
        agentId: 'test-agent',
        params: {},
      });

      // Handle initialize response with terminal auth
      router.handleAgentResponse('test-agent', {
        jsonrpc: '2.0',
        id: 'init-1',
        result: {
          protocolVersion: '1.0',
          authMethods: [
            { id: 'terminal-setup', type: 'terminal', args: ['--setup'] },
          ],
        },
      });

      // Wait for spawn to be called
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockSpawn).toHaveBeenCalled();
      expect(router.getAuthState('test-agent')).toBe('pending');

      // Simulate successful exit
      mockChild.emit('exit', 0, null);

      // Wait for state update
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(router.getAuthState('test-agent')).toBe('authenticated');
    });

    it('should set auth state to failed on non-zero exit code', async () => {
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

      const mockChild = createMockChildProcess();
      const mockSpawn = jest.fn().mockReturnValue(mockChild);

      const deps: MessageRouterDeps = {
        spawnFn: mockSpawn as unknown as SpawnFn,
        isStdinTTY: () => true,
        isStdoutTTY: () => true,
      };

      const router = new MessageRouter(
        registry, runtimeManager, writeCallback, {}, undefined, true, deps
      );

      // Route initialize request
      await router.route({
        jsonrpc: '2.0',
        id: 'init-1',
        method: 'initialize',
        agentId: 'test-agent',
        params: {},
      });

      // Handle initialize response with terminal auth
      router.handleAgentResponse('test-agent', {
        jsonrpc: '2.0',
        id: 'init-1',
        result: {
          protocolVersion: '1.0',
          authMethods: [
            { id: 'terminal-setup', type: 'terminal', args: ['--setup'] },
          ],
        },
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      // Simulate failed exit
      mockChild.emit('exit', 1, null);

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(router.getAuthState('test-agent')).toBe('failed');
    });

    it('should set auth state to failed on signal termination', async () => {
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

      const mockChild = createMockChildProcess();
      const mockSpawn = jest.fn().mockReturnValue(mockChild);

      const deps: MessageRouterDeps = {
        spawnFn: mockSpawn as unknown as SpawnFn,
        isStdinTTY: () => true,
        isStdoutTTY: () => true,
      };

      const router = new MessageRouter(
        registry, runtimeManager, writeCallback, {}, undefined, true, deps
      );

      // Route initialize request
      await router.route({
        jsonrpc: '2.0',
        id: 'init-1',
        method: 'initialize',
        agentId: 'test-agent',
        params: {},
      });

      // Handle initialize response with terminal auth
      router.handleAgentResponse('test-agent', {
        jsonrpc: '2.0',
        id: 'init-1',
        result: {
          protocolVersion: '1.0',
          authMethods: [
            { id: 'terminal-setup', type: 'terminal', args: ['--setup'] },
          ],
        },
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      // Simulate signal termination (e.g., Ctrl+C)
      mockChild.emit('exit', null, 'SIGINT');

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(router.getAuthState('test-agent')).toBe('failed');
    });

    it('should set auth state to failed on spawn error', async () => {
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

      const mockChild = createMockChildProcess();
      const mockSpawn = jest.fn().mockReturnValue(mockChild);

      const deps: MessageRouterDeps = {
        spawnFn: mockSpawn as unknown as SpawnFn,
        isStdinTTY: () => true,
        isStdoutTTY: () => true,
      };

      const router = new MessageRouter(
        registry, runtimeManager, writeCallback, {}, undefined, true, deps
      );

      // Route initialize request
      await router.route({
        jsonrpc: '2.0',
        id: 'init-1',
        method: 'initialize',
        agentId: 'test-agent',
        params: {},
      });

      // Handle initialize response with terminal auth
      router.handleAgentResponse('test-agent', {
        jsonrpc: '2.0',
        id: 'init-1',
        result: {
          protocolVersion: '1.0',
          authMethods: [
            { id: 'terminal-setup', type: 'terminal', args: ['--setup'] },
          ],
        },
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      // Simulate spawn error
      mockChild.emit('error', new Error('ENOENT: command not found'));

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(router.getAuthState('test-agent')).toBe('failed');
    });
  });

  describe('Terminal Auth args/env handling', () => {
    it('should pass args from authMethod to spawn', async () => {
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

      const mockChild = createMockChildProcess();
      const mockSpawn = jest.fn().mockReturnValue(mockChild);

      const deps: MessageRouterDeps = {
        spawnFn: mockSpawn as unknown as SpawnFn,
        isStdinTTY: () => true,
        isStdoutTTY: () => true,
      };

      const router = new MessageRouter(
        registry, runtimeManager, writeCallback, {}, undefined, true, deps
      );

      // Route initialize request
      await router.route({
        jsonrpc: '2.0',
        id: 'init-1',
        method: 'initialize',
        agentId: 'test-agent',
        params: {},
      });

      // Handle initialize response with terminal auth including args
      router.handleAgentResponse('test-agent', {
        jsonrpc: '2.0',
        id: 'init-1',
        result: {
          protocolVersion: '1.0',
          authMethods: [
            {
              id: 'terminal-setup',
              type: 'terminal',
              args: ['--setup', '--provider', 'github'],
            },
          ],
        },
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      // Check spawn was called with correct args
      expect(mockSpawn).toHaveBeenCalledWith(
        'node',  // command from registry
        ['--setup', '--provider', 'github'],  // args from authMethod (replacement)
        expect.objectContaining({
          stdio: 'inherit',
          shell: false,
        })
      );
    });

    it('should pass env from authMethod to spawn (merged with process.env)', async () => {
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

      const mockChild = createMockChildProcess();
      const mockSpawn = jest.fn().mockReturnValue(mockChild);

      const deps: MessageRouterDeps = {
        spawnFn: mockSpawn as unknown as SpawnFn,
        isStdinTTY: () => true,
        isStdoutTTY: () => true,
      };

      const router = new MessageRouter(
        registry, runtimeManager, writeCallback, {}, undefined, true, deps
      );

      // Route initialize request
      await router.route({
        jsonrpc: '2.0',
        id: 'init-1',
        method: 'initialize',
        agentId: 'test-agent',
        params: {},
      });

      // Handle initialize response with terminal auth including env
      router.handleAgentResponse('test-agent', {
        jsonrpc: '2.0',
        id: 'init-1',
        result: {
          protocolVersion: '1.0',
          authMethods: [
            {
              id: 'terminal-setup',
              type: 'terminal',
              args: ['--setup'],
              env: { CUSTOM_VAR: 'custom_value', DEBUG: 'true' },
            },
          ],
        },
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      // Check spawn was called with env containing authMethod env vars
      const spawnCall = mockSpawn.mock.calls[0];
      const spawnEnv = spawnCall[2].env;

      expect(spawnEnv.CUSTOM_VAR).toBe('custom_value');
      expect(spawnEnv.DEBUG).toBe('true');
    });

    it('should use empty args when authMethod has no args', async () => {
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

      const mockChild = createMockChildProcess();
      const mockSpawn = jest.fn().mockReturnValue(mockChild);

      const deps: MessageRouterDeps = {
        spawnFn: mockSpawn as unknown as SpawnFn,
        isStdinTTY: () => true,
        isStdoutTTY: () => true,
      };

      const router = new MessageRouter(
        registry, runtimeManager, writeCallback, {}, undefined, true, deps
      );

      // Route initialize request
      await router.route({
        jsonrpc: '2.0',
        id: 'init-1',
        method: 'initialize',
        agentId: 'test-agent',
        params: {},
      });

      // Handle initialize response with terminal auth without args
      router.handleAgentResponse('test-agent', {
        jsonrpc: '2.0',
        id: 'init-1',
        result: {
          protocolVersion: '1.0',
          authMethods: [
            { id: 'terminal-basic', type: 'terminal' },
          ],
        },
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      // Check spawn was called with empty args
      expect(mockSpawn).toHaveBeenCalledWith(
        'node',
        [],  // empty args
        expect.any(Object)
      );
    });
  });

  describe('Terminal Auth queue handling', () => {
    it('should process queued requests after successful Terminal Auth', async () => {
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

      const mockChild = createMockChildProcess();
      const mockSpawn = jest.fn().mockReturnValue(mockChild);

      const deps: MessageRouterDeps = {
        spawnFn: mockSpawn as unknown as SpawnFn,
        isStdinTTY: () => true,
        isStdoutTTY: () => true,
      };

      const router = new MessageRouter(
        registry, runtimeManager, writeCallback, {}, undefined, true, deps
      );

      // Set auth state to pending to queue requests
      router.setAuthState('test-agent', 'pending');

      // Queue a request
      const routePromise = router.route({
        jsonrpc: '2.0',
        id: 'queued-1',
        method: 'session/new',
        agentId: 'test-agent',
        params: {},
      });

      expect(router.getQueuedRequestCount('test-agent')).toBe(1);

      // Simulate successful Terminal Auth completion
      router.setAuthState('test-agent', 'authenticated');

      // Wait for queued request to be processed
      const result = await routePromise;

      expect(result).toBeUndefined(); // No error
      expect(router.getQueuedRequestCount('test-agent')).toBe(0);
    });

    it('should reject queued requests after failed Terminal Auth', async () => {
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

      const router = new MessageRouter(
        registry, runtimeManager, writeCallback, {}, undefined, true
      );

      // Set auth state to pending to queue requests
      router.setAuthState('test-agent', 'pending');

      // Queue a request
      const routePromise = router.route({
        jsonrpc: '2.0',
        id: 'queued-1',
        method: 'session/new',
        agentId: 'test-agent',
        params: {},
      });

      expect(router.getQueuedRequestCount('test-agent')).toBe(1);

      // Simulate failed Terminal Auth
      router.setAuthState('test-agent', 'failed');

      // Wait for queued request to be rejected
      const result = await routePromise;

      expect(result).toBeDefined();
      expect(result?.error.code).toBe(-32004); // AUTH_REQUIRED
      expect(router.getQueuedRequestCount('test-agent')).toBe(0);
    });
  });

  describe('Terminal Auth precedence', () => {
    it('should prefer Agent Auth over Terminal Auth when both are present', () => {
      const methods = parseAuthMethods([
        { id: 'agent-google', type: 'agent', providerId: 'google' },
        { id: 'terminal-setup', type: 'terminal', args: ['--setup'] },
      ]);

      const agentMethods = getAgentAuthMethods(methods);
      const terminalMethods = getTerminalAuthMethods(methods);

      // Both should be parsed
      expect(agentMethods).toHaveLength(1);
      expect(terminalMethods).toHaveLength(1);

      // Agent Auth should be first in precedence (checked first in attemptAuthentication)
      expect(agentMethods[0].id).toBe('agent-google');
    });

    it('should prefer Terminal Auth over OAuth when both are present', () => {
      const methods = parseAuthMethods([
        { id: 'terminal-setup', type: 'terminal', args: ['--setup'] },
        { id: 'oauth2-google', type: 'oauth2', providerId: 'google' },
      ]);

      const terminalMethods = getTerminalAuthMethods(methods);
      const oauthMethods = getOAuthMethods(methods);

      // Both should be parsed
      expect(terminalMethods).toHaveLength(1);
      expect(oauthMethods).toHaveLength(1);

      // Terminal Auth should be preferred over OAuth (checked before OAuth in attemptAuthentication)
      expect(terminalMethods[0].id).toBe('terminal-setup');
    });
  });
});
