/*
 * Apache License 2.0
 * Copyright (c) 2025–present Raman Marozau, Target Insight Function.
 * Contact: raman@worktif.com
 */

/**
 * Unit tests for MessageRouter mcpServers injection.
 */

import { MessageRouter, createErrorResponse, extractAgentId, extractId, transformMessage } from './message-router.js';
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
