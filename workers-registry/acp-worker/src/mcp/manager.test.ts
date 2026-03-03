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
 * Unit tests for MCPManager
 *
 * Tests connection lifecycle and error handling for MCP client management.
 * Uses dependency injection to provide mock factories for testing.
 *
 * @module mcp/manager.test
 */

import { type MCPFactories, MCPManager } from './manager.js';
import type { MCPServerConfig } from './types.js';

/**
 * Creates a mock MCP client for testing.
 */
function createMockClient(overrides: Partial<MockClient> = {}): MockClient {
  return {
    connect: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
    getServerCapabilities: jest.fn().mockReturnValue({
      tools: { listChanged: true },
      resources: { listChanged: true },
    }),
    listTools: jest.fn().mockResolvedValue({ tools: [] }),
    callTool: jest.fn().mockResolvedValue({ content: [] }),
    listResources: jest.fn().mockResolvedValue({ resources: [] }),
    readResource: jest.fn().mockResolvedValue({ contents: [] }),
    onclose: null,
    ...overrides,
  };
}

interface MockClient {
  connect: jest.Mock;
  close: jest.Mock;
  getServerCapabilities: jest.Mock;
  listTools: jest.Mock;
  callTool: jest.Mock;
  listResources: jest.Mock;
  readResource: jest.Mock;
  onclose: (() => void) | null;
}

/**
 * Creates mock factories for testing MCPManager.
 */
function createMockFactories(clientOverrides: Partial<MockClient> = {}): {
  factories: MCPFactories;
  mockClient: MockClient;
  mockTransport: object;
  createClientSpy: jest.Mock;
  createTransportSpy: jest.Mock;
} {
  const mockClient = createMockClient(clientOverrides);
  const mockTransport = {};

  const createClientSpy = jest.fn().mockReturnValue(mockClient);
  const createTransportSpy = jest.fn().mockReturnValue(mockTransport);

  return {
    factories: {
      createClient: createClientSpy as unknown as MCPFactories['createClient'],
      createTransport: createTransportSpy as unknown as MCPFactories['createTransport'],
    },
    mockClient,
    mockTransport,
    createClientSpy,
    createTransportSpy,
  };
}

describe('MCPManager', () => {
  let manager: MCPManager;
  let mocks: ReturnType<typeof createMockFactories>;

  beforeEach(() => {
    jest.clearAllMocks();
    mocks = createMockFactories();
    manager = new MCPManager(mocks.factories);
  });

  afterEach(async () => {
    await manager.close();
  });

  describe('connect()', () => {
    it('should create connections for each server config', async () => {
      const servers: MCPServerConfig[] = [
        { id: 'server1', command: 'node', args: ['server1.js'] },
        { id: 'server2', command: 'python', args: ['server2.py'] },
      ];

      await manager.connect(servers);

      // Verify transport was created for each server
      expect(mocks.createTransportSpy).toHaveBeenCalledTimes(2);
      expect(mocks.createTransportSpy).toHaveBeenCalledWith({
        command: 'node',
        args: ['server1.js'],
        env: undefined,
      });
      expect(mocks.createTransportSpy).toHaveBeenCalledWith({
        command: 'python',
        args: ['server2.py'],
        env: undefined,
      });

      // Verify Client was created for each server
      expect(mocks.createClientSpy).toHaveBeenCalledTimes(2);

      // Verify connections are stored
      expect(manager.getConnection('server1')).toBeDefined();
      expect(manager.getConnection('server2')).toBeDefined();
    });

    it('should pass environment variables to transport', async () => {
      const servers: MCPServerConfig[] = [
        {
          id: 'server1',
          command: 'node',
          args: ['server.js'],
          env: { API_KEY: 'secret', DEBUG: 'true' },
        },
      ];

      await manager.connect(servers);

      expect(mocks.createTransportSpy).toHaveBeenCalledWith({
        command: 'node',
        args: ['server.js'],
        env: { API_KEY: 'secret', DEBUG: 'true' },
      });
    });

    it('should handle connection errors gracefully', async () => {
      // Create a manager with a client that fails to connect on first call
      const failingMocks = createMockFactories();
      failingMocks.mockClient.connect
        .mockRejectedValueOnce(new Error('Connection failed'))
        .mockResolvedValue(undefined);

      const failingManager = new MCPManager(failingMocks.factories);

      const servers: MCPServerConfig[] = [
        { id: 'failing-server', command: 'node', args: ['failing.js'] },
        { id: 'working-server', command: 'node', args: ['working.js'] },
      ];

      // Should not throw
      await expect(failingManager.connect(servers)).resolves.toBeUndefined();

      // Failing server should not be stored as connected
      expect(failingManager.getConnection('failing-server')).toBeUndefined();

      // Working server should still be connected
      expect(failingManager.getConnection('working-server')).toBeDefined();
      expect(failingManager.getConnection('working-server')?.connected).toBe(true);

      await failingManager.close();
    });

    it('should store server capabilities after connection', async () => {
      const mockCapabilities = {
        tools: { listChanged: true },
        resources: { listChanged: false },
        prompts: { listChanged: true },
      };

      mocks.mockClient.getServerCapabilities.mockReturnValue(mockCapabilities);

      const servers: MCPServerConfig[] = [
        { id: 'server1', command: 'node', args: ['server.js'] },
      ];

      await manager.connect(servers);

      const connection = manager.getConnection('server1');
      expect(connection?.capabilities).toEqual(mockCapabilities);
    });

    it('should handle empty server list', async () => {
      await expect(manager.connect([])).resolves.toBeUndefined();
      expect(manager.getAllConnections()).toHaveLength(0);
    });

    it('should create client with correct name and version', async () => {
      const servers: MCPServerConfig[] = [
        { id: 'server1', command: 'node', args: ['server.js'] },
      ];

      await manager.connect(servers);

      expect(mocks.createClientSpy).toHaveBeenCalledWith({
        name: 'stdio-bus-worker',
        version: '1.0.0',
      });
    });
  });

  describe('getConnection()', () => {
    it('should return the correct connection by server ID', async () => {
      const servers: MCPServerConfig[] = [
        { id: 'server1', command: 'node', args: ['server1.js'] },
        { id: 'server2', command: 'node', args: ['server2.js'] },
      ];

      await manager.connect(servers);

      const conn1 = manager.getConnection('server1');
      const conn2 = manager.getConnection('server2');

      expect(conn1).toBeDefined();
      expect(conn1?.config.id).toBe('server1');
      expect(conn2).toBeDefined();
      expect(conn2?.config.id).toBe('server2');
    });

    it('should return undefined for unknown server ID', () => {
      const result = manager.getConnection('non-existent');
      expect(result).toBeUndefined();
    });

    it('should return undefined for empty string ID', () => {
      const result = manager.getConnection('');
      expect(result).toBeUndefined();
    });

    it('should return undefined before any connections are made', () => {
      const result = manager.getConnection('server1');
      expect(result).toBeUndefined();
    });
  });

  describe('getAllConnections()', () => {
    it('should return only connected servers', async () => {
      const servers: MCPServerConfig[] = [
        { id: 'server1', command: 'node', args: ['server1.js'] },
        { id: 'server2', command: 'node', args: ['server2.js'] },
      ];

      await manager.connect(servers);

      const connections = manager.getAllConnections();
      expect(connections).toHaveLength(2);
      expect(connections.every((c) => c.connected)).toBe(true);
    });

    it('should return empty array when no connections exist', () => {
      const connections = manager.getAllConnections();
      expect(connections).toEqual([]);
    });

    it('should exclude disconnected servers', async () => {
      const servers: MCPServerConfig[] = [
        { id: 'server1', command: 'node', args: ['server1.js'] },
      ];

      await manager.connect(servers);

      // Manually mark as disconnected (simulating abort)
      manager.abortPendingOperations();

      const connections = manager.getAllConnections();
      expect(connections).toHaveLength(0);
    });
  });

  describe('getServerCapabilities()', () => {
    it('should return capabilities for connected server', async () => {
      const mockCapabilities = {
        tools: { listChanged: true },
      };

      mocks.mockClient.getServerCapabilities.mockReturnValue(mockCapabilities);

      const servers: MCPServerConfig[] = [
        { id: 'server1', command: 'node', args: ['server.js'] },
      ];

      await manager.connect(servers);

      const capabilities = manager.getServerCapabilities('server1');
      expect(capabilities).toEqual(mockCapabilities);
    });

    it('should return undefined for unknown server', () => {
      const capabilities = manager.getServerCapabilities('non-existent');
      expect(capabilities).toBeUndefined();
    });

    it('should return undefined for disconnected server', async () => {
      const servers: MCPServerConfig[] = [
        { id: 'server1', command: 'node', args: ['server.js'] },
      ];

      await manager.connect(servers);
      manager.abortPendingOperations();

      const capabilities = manager.getServerCapabilities('server1');
      expect(capabilities).toBeUndefined();
    });
  });

  describe('close()', () => {
    it('should close all connections', async () => {
      const servers: MCPServerConfig[] = [
        { id: 'server1', command: 'node', args: ['server1.js'] },
        { id: 'server2', command: 'node', args: ['server2.js'] },
      ];

      await manager.connect(servers);
      await manager.close();

      expect(mocks.mockClient.close).toHaveBeenCalledTimes(2);
    });

    it('should clear all connections after close', async () => {
      const servers: MCPServerConfig[] = [
        { id: 'server1', command: 'node', args: ['server.js'] },
      ];

      await manager.connect(servers);
      expect(manager.getConnection('server1')).toBeDefined();

      await manager.close();
      expect(manager.getConnection('server1')).toBeUndefined();
      expect(manager.getAllConnections()).toHaveLength(0);
    });

    it('should handle close errors gracefully', async () => {
      mocks.mockClient.close.mockRejectedValue(new Error('Close failed'));

      const servers: MCPServerConfig[] = [
        { id: 'server1', command: 'node', args: ['server.js'] },
      ];

      await manager.connect(servers);

      // Should not throw
      await expect(manager.close()).resolves.toBeUndefined();
    });

    it('should handle close when no connections exist', async () => {
      // Should not throw
      await expect(manager.close()).resolves.toBeUndefined();
    });
  });

  describe('abortPendingOperations()', () => {
    it('should mark all connections as not connected', async () => {
      const servers: MCPServerConfig[] = [
        { id: 'server1', command: 'node', args: ['server1.js'] },
        { id: 'server2', command: 'node', args: ['server2.js'] },
      ];

      await manager.connect(servers);

      // Verify connections are initially connected
      expect(manager.getConnection('server1')?.connected).toBe(true);
      expect(manager.getConnection('server2')?.connected).toBe(true);

      manager.abortPendingOperations();

      // Verify connections are now marked as not connected
      expect(manager.getConnection('server1')?.connected).toBe(false);
      expect(manager.getConnection('server2')?.connected).toBe(false);
    });

    it('should cause getAllConnections to return empty array', async () => {
      const servers: MCPServerConfig[] = [
        { id: 'server1', command: 'node', args: ['server.js'] },
      ];

      await manager.connect(servers);
      expect(manager.getAllConnections()).toHaveLength(1);

      manager.abortPendingOperations();
      expect(manager.getAllConnections()).toHaveLength(0);
    });

    it('should handle abort when no connections exist', () => {
      // Should not throw
      expect(() => manager.abortPendingOperations()).not.toThrow();
    });

    it('should not remove connections from the map', async () => {
      const servers: MCPServerConfig[] = [
        { id: 'server1', command: 'node', args: ['server.js'] },
      ];

      await manager.connect(servers);
      manager.abortPendingOperations();

      // Connection should still exist in the map, just marked as not connected
      const connection = manager.getConnection('server1');
      expect(connection).toBeDefined();
      expect(connection?.connected).toBe(false);
    });
  });


  describe('listTools()', () => {
    /**
     * Use client.listTools() to discover available tools
     */
    it('should return tools from all connected servers', async () => {
      const mockTools1 = [
        { name: 'tool1', description: 'Tool 1', inputSchema: { type: 'object' } },
        { name: 'tool2', description: 'Tool 2', inputSchema: { type: 'object' } },
      ];
      const mockTools2 = [
        { name: 'tool3', description: 'Tool 3', inputSchema: { type: 'object' } },
      ];

      // Create separate mock clients for each server
      let callCount = 0;
      const multiMocks = createMockFactories();
      multiMocks.createClientSpy.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return createMockClient({
            listTools: jest.fn().mockResolvedValue({ tools: mockTools1 }),
          });
        }
        return createMockClient({
          listTools: jest.fn().mockResolvedValue({ tools: mockTools2 }),
        });
      });

      const multiManager = new MCPManager(multiMocks.factories);

      const servers: MCPServerConfig[] = [
        { id: 'server1', command: 'node', args: ['server1.js'] },
        { id: 'server2', command: 'node', args: ['server2.js'] },
      ];

      await multiManager.connect(servers);
      const tools = await multiManager.listTools();

      expect(tools).toHaveLength(3);
      expect(tools).toContainEqual({
        name: 'tool1',
        description: 'Tool 1',
        inputSchema: { type: 'object' },
        serverId: 'server1',
      });
      expect(tools).toContainEqual({
        name: 'tool2',
        description: 'Tool 2',
        inputSchema: { type: 'object' },
        serverId: 'server1',
      });
      expect(tools).toContainEqual({
        name: 'tool3',
        description: 'Tool 3',
        inputSchema: { type: 'object' },
        serverId: 'server2',
      });

      await multiManager.close();
    });

    /**
     * Store tool definitions (name, description, inputSchema)
     */
    it('should include serverId in each tool definition', async () => {
      const mockTools = [
        {
          name: 'echo',
          description: 'Echo tool',
          inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
        },
      ];

      mocks.mockClient.listTools.mockResolvedValue({ tools: mockTools });

      const servers: MCPServerConfig[] = [
        { id: 'my-server', command: 'node', args: ['server.js'] },
      ];

      await manager.connect(servers);
      const tools = await manager.listTools();

      expect(tools).toHaveLength(1);
      expect(tools[0].serverId).toBe('my-server');
      expect(tools[0].name).toBe('echo');
      expect(tools[0].description).toBe('Echo tool');
      expect(tools[0].inputSchema).toEqual({ type: 'object', properties: { text: { type: 'string' } } });
    });

    /**
     * Handle pagination via nextCursor if present
     */
    it('should handle pagination with nextCursor', async () => {
      mocks.mockClient.listTools
        .mockResolvedValueOnce({
          tools: [{ name: 'tool1', inputSchema: {} }],
          nextCursor: 'cursor1',
        })
        .mockResolvedValueOnce({
          tools: [{ name: 'tool2', inputSchema: {} }],
          nextCursor: 'cursor2',
        })
        .mockResolvedValueOnce({
          tools: [{ name: 'tool3', inputSchema: {} }],
          // No nextCursor - end of pagination
        });

      const servers: MCPServerConfig[] = [
        { id: 'server1', command: 'node', args: ['server.js'] },
      ];

      await manager.connect(servers);
      const tools = await manager.listTools();

      // Should have called listTools 3 times (initial + 2 pagination calls)
      expect(mocks.mockClient.listTools).toHaveBeenCalledTimes(3);
      expect(mocks.mockClient.listTools).toHaveBeenNthCalledWith(1, undefined);
      expect(mocks.mockClient.listTools).toHaveBeenNthCalledWith(2, { cursor: 'cursor1' });
      expect(mocks.mockClient.listTools).toHaveBeenNthCalledWith(3, { cursor: 'cursor2' });

      // Should have all 3 tools
      expect(tools).toHaveLength(3);
      expect(tools.map((t) => t.name)).toEqual(['tool1', 'tool2', 'tool3']);
    });

    it('should return empty array when no servers are connected', async () => {
      const tools = await manager.listTools();
      expect(tools).toEqual([]);
    });

    it('should skip disconnected servers', async () => {
      const mockTools = [
        { name: 'tool1', inputSchema: {} },
      ];

      mocks.mockClient.listTools.mockResolvedValue({ tools: mockTools });

      const servers: MCPServerConfig[] = [
        { id: 'server1', command: 'node', args: ['server.js'] },
      ];

      await manager.connect(servers);
      manager.abortPendingOperations(); // Mark as disconnected

      const tools = await manager.listTools();

      expect(tools).toEqual([]);
      // listTools should not be called since server is disconnected
    });

    it('should handle listTools errors gracefully and continue with other servers', async () => {
      let callCount = 0;
      const multiMocks = createMockFactories();
      multiMocks.createClientSpy.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return createMockClient({
            listTools: jest.fn().mockRejectedValue(new Error('List tools failed')),
          });
        }
        return createMockClient({
          listTools: jest.fn().mockResolvedValue({
            tools: [{ name: 'tool1', inputSchema: {} }],
          }),
        });
      });

      const multiManager = new MCPManager(multiMocks.factories);

      const servers: MCPServerConfig[] = [
        { id: 'failing-server', command: 'node', args: ['failing.js'] },
        { id: 'working-server', command: 'node', args: ['working.js'] },
      ];

      await multiManager.connect(servers);
      const tools = await multiManager.listTools();

      // Should still return tools from the working server
      expect(tools).toHaveLength(1);
      expect(tools[0].serverId).toBe('working-server');

      await multiManager.close();
    });

    it('should handle tools without description', async () => {
      const mockTools = [
        { name: 'tool-no-desc', inputSchema: { type: 'object' } },
      ];

      mocks.mockClient.listTools.mockResolvedValue({ tools: mockTools });

      const servers: MCPServerConfig[] = [
        { id: 'server1', command: 'node', args: ['server.js'] },
      ];

      await manager.connect(servers);
      const tools = await manager.listTools();

      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('tool-no-desc');
      expect(tools[0].description).toBeUndefined();
    });
  });

  describe('callTool()', () => {
    /**
     * Use client.callTool() to invoke tools
     */
    it('should call tool on the correct server', async () => {
      const mockToolResult = {
        content: [{ type: 'text', text: 'Hello, World!' }],
        isError: false,
      };

      mocks.mockClient.listTools.mockResolvedValue({
        tools: [{ name: 'echo', description: 'Echo tool', inputSchema: { type: 'object' } }],
      });
      mocks.mockClient.callTool.mockResolvedValue(mockToolResult);

      const servers: MCPServerConfig[] = [
        { id: 'server1', command: 'node', args: ['server.js'] },
      ];

      await manager.connect(servers);
      await manager.listTools(); // Populate toolToServer map

      const result = await manager.callTool('echo', { text: 'Hello' });

      expect(mocks.mockClient.callTool).toHaveBeenCalledWith({
        name: 'echo',
        arguments: { text: 'Hello' },
      });
      expect(result.content).toHaveLength(1);
      expect(result.content[0]).toEqual({ type: 'text', text: 'Hello, World!' });
      expect(result.isError).toBe(false);
    });

    /**
     * Check CallToolResult.isError for tool failures
     */
    it('should handle tool errors via isError flag', async () => {
      const mockToolResult = {
        content: [{ type: 'text', text: 'Error: Something went wrong' }],
        isError: true,
      };

      mocks.mockClient.listTools.mockResolvedValue({
        tools: [{ name: 'failing-tool', inputSchema: {} }],
      });
      mocks.mockClient.callTool.mockResolvedValue(mockToolResult);

      const servers: MCPServerConfig[] = [
        { id: 'server1', command: 'node', args: ['server.js'] },
      ];

      await manager.connect(servers);
      await manager.listTools();

      const result = await manager.callTool('failing-tool', {});

      expect(result.isError).toBe(true);
      expect(result.content[0]).toEqual({ type: 'text', text: 'Error: Something went wrong' });
    });

    it('should throw for unknown tool', async () => {
      const servers: MCPServerConfig[] = [
        { id: 'server1', command: 'node', args: ['server.js'] },
      ];

      await manager.connect(servers);

      await expect(manager.callTool('unknown-tool', {})).rejects.toThrow(
        'Tool "unknown-tool" not found',
      );
    });

    it('should throw for disconnected server', async () => {
      mocks.mockClient.listTools.mockResolvedValue({
        tools: [{ name: 'echo', inputSchema: {} }],
      });

      const servers: MCPServerConfig[] = [
        { id: 'server1', command: 'node', args: ['server.js'] },
      ];

      await manager.connect(servers);
      await manager.listTools();
      manager.abortPendingOperations();

      await expect(manager.callTool('echo', {})).rejects.toThrow(
        'Server "server1" is unavailable',
      );
    });
  });

  describe('listResources()', () => {
    it('should return resources from all connected servers', async () => {
      const mockResources = [
        { uri: 'file:///test.txt', name: 'test.txt', description: 'Test file' },
      ];

      mocks.mockClient.listResources.mockResolvedValue({ resources: mockResources });

      const servers: MCPServerConfig[] = [
        { id: 'server1', command: 'node', args: ['server.js'] },
      ];

      await manager.connect(servers);
      const resources = await manager.listResources();

      expect(resources).toHaveLength(1);
      expect(resources[0]).toEqual({
        uri: 'file:///test.txt',
        name: 'test.txt',
        description: 'Test file',
        mimeType: undefined,
        serverId: 'server1',
      });
    });

    it('should return empty array when no servers are connected', async () => {
      const resources = await manager.listResources();
      expect(resources).toEqual([]);
    });
  });

  describe('readResource()', () => {
    it('should read resource from specified server', async () => {
      const mockResult = {
        contents: [{ uri: 'file:///test.txt', text: 'Hello, World!' }],
      };

      mocks.mockClient.readResource.mockResolvedValue(mockResult);

      const servers: MCPServerConfig[] = [
        { id: 'server1', command: 'node', args: ['server.js'] },
      ];

      await manager.connect(servers);
      const result = await manager.readResource('file:///test.txt', 'server1');

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0]).toEqual({
        uri: 'file:///test.txt',
        mimeType: undefined,
        text: 'Hello, World!',
      });
    });

    it('should throw for unknown server', async () => {
      await expect(manager.readResource('file:///test.txt', 'unknown-server')).rejects.toThrow(
        'Server "unknown-server" not found',
      );
    });
  });

  describe('crash detection', () => {
    it('should mark server as crashed when onclose is called', async () => {
      const servers: MCPServerConfig[] = [
        { id: 'server1', command: 'node', args: ['server.js'] },
      ];

      await manager.connect(servers);

      // Simulate server crash by calling onclose
      if (mocks.mockClient.onclose) {
        mocks.mockClient.onclose();
      }

      expect(manager.isServerCrashed('server1')).toBe(true);
      expect(manager.getServerCrashError('server1')).toBe('Server process exited unexpectedly');
    });

    it('should notify crash callback when server crashes', async () => {
      const crashCallback = jest.fn();
      manager.setOnServerCrash(crashCallback);

      const servers: MCPServerConfig[] = [
        { id: 'server1', command: 'node', args: ['server.js'] },
      ];

      await manager.connect(servers);

      // Simulate server crash
      if (mocks.mockClient.onclose) {
        mocks.mockClient.onclose();
      }

      expect(crashCallback).toHaveBeenCalledWith('server1', 'Server process exited unexpectedly');
    });

    it('should return crashed servers list', async () => {
      const servers: MCPServerConfig[] = [
        { id: 'server1', command: 'node', args: ['server.js'] },
      ];

      await manager.connect(servers);

      // Simulate server crash
      if (mocks.mockClient.onclose) {
        mocks.mockClient.onclose();
      }

      const crashed = manager.getCrashedServers();
      expect(crashed).toHaveLength(1);
      expect(crashed[0]).toEqual({
        serverId: 'server1',
        error: 'Server process exited unexpectedly',
      });
    });
  });
});
