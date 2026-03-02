/*
 * Apache License 2.0
 * Copyright (c) 2025–present Raman Marozau, Work Target Insight Function.
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
 * Error Scenario Integration Tests
 *
 * Tests for error handling including invalid sessions and MCP server crashes.
 *
 * @module tests/integration/error-scenarios.test
 */
import { ACPAgent } from '../../src/agent.js';
import { MCPManager } from '../../src/mcp/manager.js';
import { Session } from '../../src/session/session.js';
import type { AgentSideConnection, PromptRequest } from '@agentclientprotocol/sdk';

/**
 * Mock AgentSideConnection for testing.
 */
function createMockConnection(): AgentSideConnection {
  return {
    sessionUpdate: async () => {
    },
    requestPermission: async () => ({ outcome: 'selected' as const, selected: [] }),
    readTextFile: async () => ({ content: '' }),
    writeTextFile: async () => ({}),
    executeCommand: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
    startCommand: async () => ({ commandId: 'test-cmd' }),
  } as unknown as AgentSideConnection;
}

describe('Error Scenarios', () => {
  describe('Invalid Session Handling', () => {
    let agent: ACPAgent;

    beforeEach(() => {
      agent = new ACPAgent(createMockConnection());
    });

    afterEach(async () => {
      const sessions = agent.sessionManager.getAllSessions();
      for (const session of sessions) {
        await session.close();
      }
    });

    it('should reject prompt for non-existent session', async () => {
      const request: PromptRequest = {
        sessionId: 'non-existent-session',
        prompt: [{ type: 'text', text: 'Hello' }],
      };

      await expect(agent.prompt(request)).rejects.toThrow('Session not found: non-existent-session');
    });

    it('should handle cancel for non-existent session gracefully', async () => {
      // Cancel should not throw for non-existent session
      await expect(agent.cancel({ sessionId: 'non-existent-session' })).resolves.not.toThrow();
    });

    it('should reject prompt after session is closed', async () => {
      const response = await agent.newSession({ cwd: '/test', mcpServers: [] });
      const session = agent.sessionManager.getSession(response.sessionId);

      // Close the session
      await session?.close();

      // Remove from manager
      agent.sessionManager.removeSession(response.sessionId);

      const request: PromptRequest = {
        sessionId: response.sessionId,
        prompt: [{ type: 'text', text: 'Hello' }],
      };

      await expect(agent.prompt(request)).rejects.toThrow('Session not found');
    });
  });

  describe('MCP Server Crash Handling', () => {
    let mcpManager: MCPManager;
    let crashCallbacks: Array<{ serverId: string; error: string }>;

    beforeEach(() => {
      mcpManager = new MCPManager();
      crashCallbacks = [];
      mcpManager.setOnServerCrash((serverId, error) => {
        crashCallbacks.push({ serverId, error });
      });
    });

    afterEach(async () => {
      await mcpManager.close();
    });

    it('should track crashed servers', () => {
      // Initially no crashed servers
      expect(mcpManager.getCrashedServers()).toHaveLength(0);
    });

    it('should report server crash status', () => {
      // Non-existent server should not be reported as crashed
      expect(mcpManager.isServerCrashed('non-existent')).toBe(false);
    });

    it('should return undefined crash error for non-crashed server', () => {
      expect(mcpManager.getServerCrashError('non-existent')).toBeUndefined();
    });
  });

  describe('Session Cancellation During Processing', () => {
    let agent: ACPAgent;
    let mockConnection: AgentSideConnection & { updates: Array<{ sessionId: string; update: unknown }> };

    beforeEach(() => {
      const updates: Array<{ sessionId: string; update: unknown }> = [];
      mockConnection = {
        updates,
        sessionUpdate: async (params: { sessionId: string; update: unknown }) => {
          updates.push(params);
        },
        requestPermission: async () => ({ outcome: 'selected' as const, selected: [] }),
        readTextFile: async () => ({ content: '' }),
        writeTextFile: async () => ({}),
        executeCommand: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
        startCommand: async () => ({ commandId: 'test-cmd' }),
      } as unknown as AgentSideConnection & { updates: Array<{ sessionId: string; update: unknown }> };

      agent = new ACPAgent(mockConnection);
    });

    afterEach(async () => {
      const sessions = agent.sessionManager.getAllSessions();
      for (const session of sessions) {
        await session.close();
      }
    });

    it('should stop processing when cancelled before start', async () => {
      const response = await agent.newSession({ cwd: '/test', mcpServers: [] });

      // Cancel before processing
      await agent.cancel({ sessionId: response.sessionId });

      const request: PromptRequest = {
        sessionId: response.sessionId,
        prompt: [
          { type: 'text', text: 'Message 1' },
          { type: 'text', text: 'Message 2' },
          { type: 'text', text: 'Message 3' },
        ],
      };

      const result = await agent.prompt(request);

      expect(result.stopReason).toBe('cancelled');
      expect(mockConnection.updates.length).toBe(0);
    });
  });

  describe('Session State Consistency', () => {
    it('should maintain consistent state after errors', async () => {
      const session = new Session('test-session', '/test');

      // Session should start uncancelled
      expect(session.isCancelled()).toBe(false);

      // Cancel the session
      session.cancel();
      expect(session.isCancelled()).toBe(true);

      // State should be consistent
      const state = session.getState();
      expect(state.cancelled).toBe(true);
      expect(state.id).toBe('test-session');
      expect(state.cwd).toBe('/test');

      await session.close();
    });

    it('should handle multiple cancellations gracefully', async () => {
      const session = new Session('test-session', '/test');

      // Multiple cancellations should not throw
      session.cancel();
      session.cancel();
      session.cancel();

      expect(session.isCancelled()).toBe(true);

      await session.close();
    });
  });

  describe('MCP Manager Error Recovery', () => {
    let mcpManager: MCPManager;

    beforeEach(() => {
      mcpManager = new MCPManager();
    });

    afterEach(async () => {
      await mcpManager.close();
    });

    it('should throw for tool call without discovery', async () => {
      await expect(mcpManager.callTool('unknown-tool', {})).rejects.toThrow(
        'Tool "unknown-tool" not found. Call listTools() first to discover available tools.',
      );
    });

    it('should handle empty server list gracefully', async () => {
      await mcpManager.connect([]);

      const tools = await mcpManager.listTools();
      expect(tools).toHaveLength(0);

      const resources = await mcpManager.listResources();
      expect(resources).toHaveLength(0);
    });

    it('should abort pending operations on close', async () => {
      mcpManager.abortPendingOperations();

      // After abort, all connections should be marked as not connected
      const connections = mcpManager.getAllConnections();
      expect(connections).toHaveLength(0);
    });
  });
});
