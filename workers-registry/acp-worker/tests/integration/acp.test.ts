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
 * ACP Integration Tests
 *
 * Tests for ACP initialization, session management, and prompt processing.
 *
 * @module tests/integration/acp.test
 */
import { ACPAgent } from '../../src/agent.js';
import type { AgentSideConnection, InitializeRequest, PromptRequest } from '@agentclientprotocol/sdk';

/**
 * Mock AgentSideConnection for testing.
 * Captures sessionUpdate calls for verification.
 */
function createMockConnection(): AgentSideConnection & { updates: Array<{ sessionId: string; update: unknown }> } {
  const updates: Array<{ sessionId: string; update: unknown }> = [];

  return {
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
}

describe('ACP Integration', () => {
  let agent: ACPAgent;
  let mockConnection: ReturnType<typeof createMockConnection>;

  beforeEach(() => {
    mockConnection = createMockConnection();
    agent = new ACPAgent(mockConnection);
  });

  afterEach(async () => {
    // Clean up sessions
    const sessions = agent.sessionManager.getAllSessions();
    for (const session of sessions) {
      await session.close();
    }
  });

  describe('Initialization Handshake', () => {
    it('should handle initialize request', async () => {
      const request = {
        protocolVersion: 1,
        clientInfo: {
          name: 'test-client',
          version: '1.0.0',
        },
      } as InitializeRequest;

      const response = await agent.initialize(request);

      expect(response.protocolVersion).toBeDefined();
      expect(response.agentInfo).toEqual({
        name: 'stdio-bus-worker',
        version: '1.0.0',
      });
      expect(response.agentCapabilities).toBeDefined();
      expect(response.agentCapabilities?.promptCapabilities?.embeddedContext).toBe(true);
    });

    it('should store client capabilities', async () => {
      const request = {
        protocolVersion: 1,
        clientInfo: {
          name: 'test-client',
          version: '1.0.0',
        },
        clientCapabilities: {
          fs: {
            readTextFile: true,
            writeTextFile: true,
          },
          terminal: true,
        },
      } as InitializeRequest;

      await agent.initialize(request);

      expect(agent.clientCapabilities).toBeDefined();
      expect(agent.clientCapabilities?.fs?.readTextFile).toBe(true);
      expect(agent.clientCapabilities?.fs?.writeTextFile).toBe(true);
      expect(agent.clientCapabilities?.terminal).toBe(true);
    });
  });

  describe('Session Management', () => {
    it('should create new session', async () => {
      const request = {
        cwd: '/test/path',
        mcpServers: [],
      };

      const response = await agent.newSession(request);

      expect(response.sessionId).toBeDefined();
      expect(typeof response.sessionId).toBe('string');
      expect(response.sessionId.length).toBeGreaterThan(0);
    });

    it('should create session with unique ID', async () => {
      const response1 = await agent.newSession({ cwd: '/test/path1', mcpServers: [] });
      const response2 = await agent.newSession({ cwd: '/test/path2', mcpServers: [] });

      expect(response1.sessionId).not.toBe(response2.sessionId);
    });

    it('should store session in manager', async () => {
      const response = await agent.newSession({ cwd: '/test/path', mcpServers: [] });

      const session = agent.sessionManager.getSession(response.sessionId);
      expect(session).toBeDefined();
      expect(session?.cwd).toBe('/test/path');
    });

    it('should handle session cancellation', async () => {
      const response = await agent.newSession({ cwd: '/test/path', mcpServers: [] });
      const session = agent.sessionManager.getSession(response.sessionId);

      expect(session?.isCancelled()).toBe(false);

      await agent.cancel({ sessionId: response.sessionId });

      expect(session?.isCancelled()).toBe(true);
    });
  });

  describe('Prompt Processing', () => {
    let sessionId: string;

    beforeEach(async () => {
      const response = await agent.newSession({ cwd: '/test/path', mcpServers: [] });
      sessionId = response.sessionId;
    });

    it('should process text prompt', async () => {
      const request: PromptRequest = {
        sessionId,
        prompt: [{ type: 'text', text: 'Hello, Agent!' }],
      };

      const response = await agent.prompt(request);

      expect(response.stopReason).toBe('end_turn');
      expect(mockConnection.updates.length).toBeGreaterThan(0);

      // Verify session update was sent
      const update = mockConnection.updates[0];
      expect(update.sessionId).toBe(sessionId);
      expect(update.update).toMatchObject({
        sessionUpdate: 'agent_message_chunk',
        content: {
          type: 'text',
          text: 'Hello, Agent!',
        },
      });
    });

    it('should process multiple content blocks', async () => {
      const request: PromptRequest = {
        sessionId,
        prompt: [
          { type: 'text', text: 'First message' },
          { type: 'text', text: 'Second message' },
        ],
      };

      const response = await agent.prompt(request);

      expect(response.stopReason).toBe('end_turn');
      expect(mockConnection.updates.length).toBe(2);
    });

    it('should handle image content block', async () => {
      const request: PromptRequest = {
        sessionId,
        prompt: [{ type: 'image', mimeType: 'image/png', data: 'base64data' }],
      };

      const response = await agent.prompt(request);

      expect(response.stopReason).toBe('end_turn');
      expect(mockConnection.updates.length).toBe(1);

      const update = mockConnection.updates[0];
      expect((update.update as { content: { text: string } }).content.text).toContain('[Image: image/png]');
    });

    it('should return cancelled when session is cancelled', async () => {
      // Cancel the session first
      await agent.cancel({ sessionId });

      const request: PromptRequest = {
        sessionId,
        prompt: [{ type: 'text', text: 'This should not be processed' }],
      };

      const response = await agent.prompt(request);

      expect(response.stopReason).toBe('cancelled');
      expect(mockConnection.updates.length).toBe(0);
    });

    it('should throw for invalid session', async () => {
      const request: PromptRequest = {
        sessionId: 'invalid-session-id',
        prompt: [{ type: 'text', text: 'Hello' }],
      };

      await expect(agent.prompt(request)).rejects.toThrow('Session not found');
    });
  });

  describe('Session Isolation', () => {
    it('should isolate sessions from each other', async () => {
      const response1 = await agent.newSession({ cwd: '/path1', mcpServers: [] });
      const response2 = await agent.newSession({ cwd: '/path2', mcpServers: [] });

      // Cancel session 1
      await agent.cancel({ sessionId: response1.sessionId });

      // Session 2 should not be affected
      const session2 = agent.sessionManager.getSession(response2.sessionId);
      expect(session2?.isCancelled()).toBe(false);

      // Session 1 should be cancelled
      const session1 = agent.sessionManager.getSession(response1.sessionId);
      expect(session1?.isCancelled()).toBe(true);
    });

    it('should track updates per session', async () => {
      const response1 = await agent.newSession({ cwd: '/path1', mcpServers: [] });
      const response2 = await agent.newSession({ cwd: '/path2', mcpServers: [] });

      await agent.prompt({
        sessionId: response1.sessionId,
        prompt: [{ type: 'text', text: 'Message for session 1' }],
      });

      await agent.prompt({
        sessionId: response2.sessionId,
        prompt: [{ type: 'text', text: 'Message for session 2' }],
      });

      // Verify updates are tagged with correct session IDs
      const session1Updates = mockConnection.updates.filter((u) => u.sessionId === response1.sessionId);
      const session2Updates = mockConnection.updates.filter((u) => u.sessionId === response2.sessionId);

      expect(session1Updates.length).toBe(1);
      expect(session2Updates.length).toBe(1);
    });
  });
});
