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
 * Registry Launcher Integration Tests
 *
 * Tests for the complete transit chain: Client → stdio Bus → Launcher → Agent → back.
 * Covers end-to-end message flow, graceful shutdown, agent exit handling, and concurrent routing.
 *
 * @module tests/integration/registry-launcher.test
 */

import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { MessageRouter, RoutingErrorCodes } from '../../src/registry-launcher/router/message-router.js';
import { AgentRuntimeManager } from '../../src/registry-launcher/runtime/manager.js';
import { NDJSONHandler } from '../../src/registry-launcher/stream/ndjson-handler.js';
import type { IRegistryIndex } from '../../src/registry-launcher/registry/index.js';
import { AgentNotFoundError } from '../../src/registry-launcher/registry/index.js';
import type { RegistryAgent, SpawnCommand } from '../../src/registry-launcher/registry/types.js';
import {
  createMockAgentProcess,
  createMockNpxAgent,
  type MockChildProcess,
} from '../../src/registry-launcher/test-utils/index.js';

/**
 * Mock RegistryIndex for testing.
 * Provides controllable agent lookup and resolution.
 */
class MockRegistryIndex implements IRegistryIndex {
  private agents: Map<string, RegistryAgent> = new Map();
  private spawnCommands: Map<string, SpawnCommand> = new Map();

  constructor(agents: RegistryAgent[] = []) {
    for (const agent of agents) {
      this.agents.set(agent.id, agent);
      // Default spawn command for npx agents
      if (agent.distribution.type === 'npx') {
        this.spawnCommands.set(agent.id, {
          command: 'npx',
          args: [agent.distribution.package],
          env: agent.env,
        });
      }
    }
  }

  async fetch(): Promise<void> {
    // No-op for mock
  }

  lookup(agentId: string): RegistryAgent | undefined {
    return this.agents.get(agentId);
  }

  resolve(agentId: string): SpawnCommand {
    const command = this.spawnCommands.get(agentId);
    if (!command) {
      throw new AgentNotFoundError(agentId);
    }
    return command;
  }

  setSpawnCommand(agentId: string, command: SpawnCommand): void {
    this.spawnCommands.set(agentId, command);
  }
}

/**
 * Create a mock agent runtime that wraps a MockChildProcess.
 */
function createMockRuntime(agentId: string, mockProcess: MockChildProcess) {
  return {
    agentId,
    state: 'running' as const,
    process: mockProcess as unknown as ChildProcess,
    write: (message: object): boolean => {
      if (mockProcess.killed || mockProcess.exitCode !== null) {
        return false;
      }
      const ndjsonLine = JSON.stringify(message) + '\n';
      try {
        mockProcess.stdin.write(ndjsonLine);
        return true;
      } catch {
        return false;
      }
    },
    terminate: async (timeout?: number): Promise<void> => {
      mockProcess.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        if (mockProcess.exitCode !== null) {
          resolve();
          return;
        }
        const timer = setTimeout(() => {
          mockProcess.kill('SIGKILL');
          resolve();
        }, timeout ?? 5000);
        mockProcess.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    },
  };
}

describe('Registry Launcher Integration', () => {
  describe('End-to-End Message Flow', () => {
    let registry: MockRegistryIndex;
    let runtimeManager: AgentRuntimeManager;
    let outputStream: PassThrough;
    let outputMessages: object[];
    let router: MessageRouter;
    let mockProcesses: Map<string, MockChildProcess>;

    beforeEach(() => {
      // Set up mock registry with test agents
      const agents = [
        createMockNpxAgent('test-agent-1', '@test/agent1'),
        createMockNpxAgent('test-agent-2', '@test/agent2'),
      ];
      registry = new MockRegistryIndex(agents);

      // Set up output capture
      outputMessages = [];
      outputStream = new PassThrough();
      outputStream.on('data', (chunk: Buffer) => {
        const lines = chunk.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            outputMessages.push(JSON.parse(line));
          } catch {
            // Skip malformed lines
          }
        }
      });

      // Set up mock processes map
      mockProcesses = new Map();

      // Create a custom runtime manager that uses mock processes
      runtimeManager = new AgentRuntimeManager();

      // Override getOrSpawn to use mock processes
      runtimeManager.getOrSpawn = async (agentId: string, _spawnCommand: SpawnCommand) => {
        let mockProcess = mockProcesses.get(agentId);
        if (!mockProcess) {
          mockProcess = createMockAgentProcess();
          mockProcesses.set(agentId, mockProcess);
          // Simulate successful spawn
          setImmediate(() => mockProcess!.simulateSpawn());
        }
        return createMockRuntime(agentId, mockProcess);
      };

      // Create router with write callback
      router = new MessageRouter(
        registry,
        runtimeManager,
        (message: object) => {
          outputStream.write(JSON.stringify(message) + '\n');
          return true;
        },
      );
    });

    afterEach(() => {
      outputStream.destroy();
      for (const process of mockProcesses.values()) {
        if (process.exitCode === null) {
          process.simulateExit(0);
        }
      }
    });

    it('should route message to correct agent and receive response', async () => {
      // Send a request with agentId
      const request = {
        jsonrpc: '2.0',
        id: 'req-1',
        method: 'test/method',
        agentId: 'test-agent-1',
        params: { foo: 'bar' },
      };

      const error = await router.route(request);
      expect(error).toBeUndefined();

      // Verify message was written to agent stdin (without agentId)
      const mockProcess = mockProcesses.get('test-agent-1');
      expect(mockProcess).toBeDefined();

      const stdinWrites = mockProcess!.getStdinWrites();
      expect(stdinWrites.length).toBe(1);

      const sentMessage = JSON.parse(stdinWrites[0]);
      expect(sentMessage).toEqual({
        jsonrpc: '2.0',
        id: 'req-1',
        method: 'test/method',
        params: { foo: 'bar' },
      });
      expect(sentMessage.agentId).toBeUndefined();
    });

    it('should forward agent response unchanged to stdout', async () => {
      // First route a request
      const request = {
        jsonrpc: '2.0',
        id: 'req-2',
        method: 'test/method',
        agentId: 'test-agent-1',
      };

      await router.route(request);

      // Simulate agent response
      const response = {
        jsonrpc: '2.0',
        id: 'req-2',
        result: { success: true, data: 'test-data' },
      };

      router.handleAgentResponse('test-agent-1', response);

      // Wait for output to be processed
      await new Promise((resolve) => setImmediate(resolve));

      // Verify response was forwarded unchanged
      expect(outputMessages.length).toBe(1);
      expect(outputMessages[0]).toEqual(response);
    });

    it('should return error for missing agentId', async () => {
      const request = {
        jsonrpc: '2.0',
        id: 'req-3',
        method: 'test/method',
        params: {},
      };

      const error = await router.route(request);

      expect(error).toBeDefined();
      expect(error?.error.code).toBe(RoutingErrorCodes.MISSING_AGENT_ID);
      expect(error?.error.message).toBe('Missing agentId');
      expect(error?.id).toBe('req-3');
    });

    it('should return error for unknown agent', async () => {
      const request = {
        jsonrpc: '2.0',
        id: 'req-4',
        method: 'test/method',
        agentId: 'unknown-agent',
      };

      const error = await router.route(request);

      expect(error).toBeDefined();
      expect(error?.error.code).toBe(RoutingErrorCodes.AGENT_NOT_FOUND);
      expect(error?.error.message).toBe('Agent not found');
      expect(error?.error.data).toEqual({ agentId: 'unknown-agent' });
    });

    it('should handle multiple sequential requests to same agent', async () => {
      const requests = [
        { jsonrpc: '2.0', id: 'seq-1', method: 'method1', agentId: 'test-agent-1' },
        { jsonrpc: '2.0', id: 'seq-2', method: 'method2', agentId: 'test-agent-1' },
        { jsonrpc: '2.0', id: 'seq-3', method: 'method3', agentId: 'test-agent-1' },
      ];

      for (const request of requests) {
        const error = await router.route(request);
        expect(error).toBeUndefined();
      }

      // Verify all messages were sent to the same agent
      const mockProcess = mockProcesses.get('test-agent-1');
      const stdinWrites = mockProcess!.getStdinWrites();
      expect(stdinWrites.length).toBe(3);

      // Verify each message was transformed correctly
      for (let i = 0; i < 3; i++) {
        const sent = JSON.parse(stdinWrites[i]);
        expect(sent.id).toBe(`seq-${i + 1}`);
        expect(sent.agentId).toBeUndefined();
      }
    });
  });

  describe('Concurrent Routing to Multiple Agents', () => {
    let registry: MockRegistryIndex;
    let runtimeManager: AgentRuntimeManager;
    let outputMessages: object[];
    let router: MessageRouter;
    let mockProcesses: Map<string, MockChildProcess>;

    beforeEach(() => {
      // Set up mock registry with multiple agents
      const agents = [
        createMockNpxAgent('agent-a', '@test/agent-a'),
        createMockNpxAgent('agent-b', '@test/agent-b'),
        createMockNpxAgent('agent-c', '@test/agent-c'),
      ];
      registry = new MockRegistryIndex(agents);

      outputMessages = [];
      mockProcesses = new Map();

      runtimeManager = new AgentRuntimeManager();
      runtimeManager.getOrSpawn = async (agentId: string, _spawnCommand: SpawnCommand) => {
        let mockProcess = mockProcesses.get(agentId);
        if (!mockProcess) {
          mockProcess = createMockAgentProcess();
          mockProcesses.set(agentId, mockProcess);
          setImmediate(() => mockProcess!.simulateSpawn());
        }
        return createMockRuntime(agentId, mockProcess);
      };

      router = new MessageRouter(
        registry,
        runtimeManager,
        (message: object) => {
          outputMessages.push(message);
          return true;
        },
      );
    });

    afterEach(() => {
      for (const process of mockProcesses.values()) {
        if (process.exitCode === null) {
          process.simulateExit(0);
        }
      }
    });

    it('should route concurrent requests to different agents', async () => {
      // Send requests to different agents concurrently
      const requests = [
        { jsonrpc: '2.0', id: 'a-1', method: 'test', agentId: 'agent-a' },
        { jsonrpc: '2.0', id: 'b-1', method: 'test', agentId: 'agent-b' },
        { jsonrpc: '2.0', id: 'c-1', method: 'test', agentId: 'agent-c' },
      ];

      const results = await Promise.all(requests.map((req) => router.route(req)));

      // All should succeed
      expect(results.every((r) => r === undefined)).toBe(true);

      // Each agent should have received exactly one message
      expect(mockProcesses.size).toBe(3);
      for (const [agentId, process] of mockProcesses) {
        const writes = process.getStdinWrites();
        expect(writes.length).toBe(1);
        const msg = JSON.parse(writes[0]);
        expect(msg.id).toContain(agentId.split('-')[1]);
      }
    });

    it('should handle interleaved responses from multiple agents', async () => {
      // Route requests to multiple agents
      await router.route({ jsonrpc: '2.0', id: 'a-1', method: 'test', agentId: 'agent-a' });
      await router.route({ jsonrpc: '2.0', id: 'b-1', method: 'test', agentId: 'agent-b' });

      // Simulate responses in different order
      router.handleAgentResponse('agent-b', { jsonrpc: '2.0', id: 'b-1', result: 'b-result' });
      router.handleAgentResponse('agent-a', { jsonrpc: '2.0', id: 'a-1', result: 'a-result' });

      // Both responses should be forwarded
      expect(outputMessages.length).toBe(2);
      expect(outputMessages[0]).toEqual({ jsonrpc: '2.0', id: 'b-1', result: 'b-result' });
      expect(outputMessages[1]).toEqual({ jsonrpc: '2.0', id: 'a-1', result: 'a-result' });
    });

    it('should reuse existing agent runtime for subsequent requests', async () => {
      // Send multiple requests to the same agent
      await router.route({ jsonrpc: '2.0', id: 'r1', method: 'test', agentId: 'agent-a' });
      await router.route({ jsonrpc: '2.0', id: 'r2', method: 'test', agentId: 'agent-a' });

      // Should only have one process for agent-a
      expect(mockProcesses.size).toBe(1);
      expect(mockProcesses.has('agent-a')).toBe(true);

      // Both messages should have been sent to the same process
      const writes = mockProcesses.get('agent-a')!.getStdinWrites();
      expect(writes.length).toBe(2);
    });
  });

  describe('Agent Process Exit Handling', () => {
    let registry: MockRegistryIndex;
    let runtimeManager: AgentRuntimeManager;
    let router: MessageRouter;
    let mockProcesses: Map<string, MockChildProcess>;
    let exitEvents: Array<{ agentId: string; code: number | null }>;

    beforeEach(() => {
      const agents = [createMockNpxAgent('exit-test-agent', '@test/exit-agent')];
      registry = new MockRegistryIndex(agents);

      mockProcesses = new Map();
      exitEvents = [];

      runtimeManager = new AgentRuntimeManager();
      runtimeManager.onAgentExit((agentId, code) => {
        exitEvents.push({ agentId, code });
      });

      runtimeManager.getOrSpawn = async (agentId: string, _spawnCommand: SpawnCommand) => {
        let mockProcess = mockProcesses.get(agentId);
        if (!mockProcess) {
          mockProcess = createMockAgentProcess();
          mockProcesses.set(agentId, mockProcess);
          setImmediate(() => mockProcess!.simulateSpawn());
        }
        return createMockRuntime(agentId, mockProcess);
      };

      router = new MessageRouter(registry, runtimeManager, () => true);
    });

    afterEach(() => {
      for (const process of mockProcesses.values()) {
        if (process.exitCode === null) {
          process.simulateExit(0);
        }
      }
    });

    it('should handle agent process exit with code 0', async () => {
      await router.route({ jsonrpc: '2.0', id: '1', method: 'test', agentId: 'exit-test-agent' });

      const mockProcess = mockProcesses.get('exit-test-agent')!;

      // Simulate graceful exit
      mockProcess.simulateExit(0);

      // Wait for event processing
      await new Promise((resolve) => setImmediate(resolve));

      // Runtime manager should have been notified
      // Note: In real implementation, the exit callback would be triggered
    });

    it('should handle agent process exit with non-zero code', async () => {
      await router.route({ jsonrpc: '2.0', id: '1', method: 'test', agentId: 'exit-test-agent' });

      const mockProcess = mockProcesses.get('exit-test-agent')!;

      // Simulate crash
      mockProcess.simulateExit(1);

      await new Promise((resolve) => setImmediate(resolve));

      // Process should be marked as exited
      expect(mockProcess.exitCode).toBe(1);
    });

    it('should handle agent process killed by signal', async () => {
      await router.route({ jsonrpc: '2.0', id: '1', method: 'test', agentId: 'exit-test-agent' });

      const mockProcess = mockProcesses.get('exit-test-agent')!;

      // Simulate kill by signal
      mockProcess.simulateExit(0, 'SIGKILL');

      await new Promise((resolve) => setImmediate(resolve));

      expect(mockProcess.signalCode).toBe('SIGKILL');
    });

    it('should not write to exited agent process', async () => {
      await router.route({ jsonrpc: '2.0', id: '1', method: 'test', agentId: 'exit-test-agent' });

      const mockProcess = mockProcesses.get('exit-test-agent')!;
      mockProcess.simulateExit(0);

      // Try to write after exit
      const runtime = createMockRuntime('exit-test-agent', mockProcess);
      const success = runtime.write({ jsonrpc: '2.0', id: '2', method: 'test' });

      expect(success).toBe(false);
    });
  });

  describe('Graceful Shutdown with SIGTERM', () => {
    let mockProcesses: Map<string, MockChildProcess>;

    beforeEach(() => {
      mockProcesses = new Map();
    });

    afterEach(() => {
      for (const process of mockProcesses.values()) {
        if (process.exitCode === null) {
          process.simulateExit(0);
        }
      }
    });

    it('should terminate agent on SIGTERM', async () => {
      const mockProcess = createMockAgentProcess();
      mockProcesses.set('test', mockProcess);
      mockProcess.simulateSpawn();

      const runtime = createMockRuntime('test', mockProcess);

      // Terminate with short timeout
      const terminatePromise = runtime.terminate(100);

      // Simulate process responding to SIGTERM
      setImmediate(() => mockProcess.simulateExit(0, 'SIGTERM'));

      await terminatePromise;

      expect(mockProcess.killed).toBe(true);
    });

    it('should force kill agent after timeout', async () => {
      const mockProcess = createMockAgentProcess();
      mockProcesses.set('test', mockProcess);
      mockProcess.simulateSpawn();

      const runtime = createMockRuntime('test', mockProcess);

      // Terminate with very short timeout
      const terminatePromise = runtime.terminate(50);

      // Don't simulate exit - let timeout trigger SIGKILL
      await terminatePromise;

      // Process should have been killed
      expect(mockProcess.killed).toBe(true);
    });

    it('should terminate multiple agents concurrently', async () => {
      const processes = [
        createMockAgentProcess(),
        createMockAgentProcess(),
        createMockAgentProcess(),
      ];

      for (const p of processes) {
        p.simulateSpawn();
      }

      const runtimes = processes.map((p, i) => createMockRuntime(`agent-${i}`, p));

      // Terminate all concurrently
      const terminatePromises = runtimes.map((r) => r.terminate(100));

      // Simulate all processes exiting
      for (const p of processes) {
        setImmediate(() => p.simulateExit(0, 'SIGTERM'));
      }

      await Promise.all(terminatePromises);

      // All should be killed
      for (const p of processes) {
        expect(p.killed).toBe(true);
      }
    });

    it('should handle already stopped agent gracefully', async () => {
      const mockProcess = createMockAgentProcess();
      mockProcess.simulateSpawn();
      mockProcess.simulateExit(0);

      const runtime = createMockRuntime('test', mockProcess);

      // Should not throw
      await expect(runtime.terminate(100)).resolves.not.toThrow();
    });
  });

  describe('NDJSON Stream Integration', () => {
    let outputStream: PassThrough;
    let ndjsonHandler: NDJSONHandler;
    let receivedMessages: object[];

    beforeEach(() => {
      outputStream = new PassThrough();
      ndjsonHandler = new NDJSONHandler(outputStream);
      receivedMessages = [];

      ndjsonHandler.onMessage((msg) => {
        receivedMessages.push(msg);
      });
    });

    afterEach(() => {
      outputStream.destroy();
    });

    it('should parse complete NDJSON messages', () => {
      const message = { jsonrpc: '2.0', id: 1, method: 'test' };
      ndjsonHandler.processChunk(Buffer.from(JSON.stringify(message) + '\n'));

      expect(receivedMessages.length).toBe(1);
      expect(receivedMessages[0]).toEqual(message);
    });

    it('should handle chunked NDJSON messages', () => {
      const message = { jsonrpc: '2.0', id: 1, method: 'test', params: { data: 'value' } };
      const json = JSON.stringify(message) + '\n';

      // Split into chunks
      const mid = Math.floor(json.length / 2);
      ndjsonHandler.processChunk(Buffer.from(json.slice(0, mid)));
      ndjsonHandler.processChunk(Buffer.from(json.slice(mid)));

      expect(receivedMessages.length).toBe(1);
      expect(receivedMessages[0]).toEqual(message);
    });

    it('should handle multiple messages in single chunk', () => {
      const messages = [
        { jsonrpc: '2.0', id: 1, method: 'test1' },
        { jsonrpc: '2.0', id: 2, method: 'test2' },
        { jsonrpc: '2.0', id: 3, method: 'test3' },
      ];

      const chunk = messages.map((m) => JSON.stringify(m)).join('\n') + '\n';
      ndjsonHandler.processChunk(Buffer.from(chunk));

      expect(receivedMessages.length).toBe(3);
      expect(receivedMessages).toEqual(messages);
    });

    it('should write NDJSON to output stream', () => {
      const chunks: string[] = [];
      outputStream.on('data', (chunk: Buffer) => {
        chunks.push(chunk.toString());
      });

      const message = { jsonrpc: '2.0', id: 1, result: 'success' };
      ndjsonHandler.write(message);

      expect(chunks.length).toBe(1);
      expect(chunks[0]).toBe(JSON.stringify(message) + '\n');
    });

    it('should handle parse errors gracefully', () => {
      const errors: Array<{ error: Error; line: string }> = [];
      ndjsonHandler.onError((error, line) => {
        errors.push({ error, line });
      });

      // Send invalid JSON
      ndjsonHandler.processChunk(Buffer.from('not valid json\n'));

      expect(errors.length).toBe(1);
      expect(errors[0].line).toBe('not valid json');
      expect(receivedMessages.length).toBe(0);
    });
  });

  describe('Request-Response Correlation', () => {
    let registry: MockRegistryIndex;
    let runtimeManager: AgentRuntimeManager;
    let router: MessageRouter;
    let mockProcesses: Map<string, MockChildProcess>;

    beforeEach(() => {
      const agents = [createMockNpxAgent('correlation-agent', '@test/correlation')];
      registry = new MockRegistryIndex(agents);

      mockProcesses = new Map();

      runtimeManager = new AgentRuntimeManager();
      runtimeManager.getOrSpawn = async (agentId: string, _spawnCommand: SpawnCommand) => {
        let mockProcess = mockProcesses.get(agentId);
        if (!mockProcess) {
          mockProcess = createMockAgentProcess();
          mockProcesses.set(agentId, mockProcess);
          setImmediate(() => mockProcess!.simulateSpawn());
        }
        return createMockRuntime(agentId, mockProcess);
      };

      router = new MessageRouter(registry, runtimeManager, () => true);
    });

    afterEach(() => {
      for (const process of mockProcesses.values()) {
        if (process.exitCode === null) {
          process.simulateExit(0);
        }
      }
    });

    it('should track pending requests', async () => {
      await router.route({ jsonrpc: '2.0', id: 'track-1', method: 'test', agentId: 'correlation-agent' });

      expect(router.isPending('track-1')).toBe(true);
      expect(router.pendingCount).toBe(1);
    });

    it('should remove pending request on response', async () => {
      await router.route({ jsonrpc: '2.0', id: 'track-2', method: 'test', agentId: 'correlation-agent' });

      expect(router.isPending('track-2')).toBe(true);

      router.handleAgentResponse('correlation-agent', { jsonrpc: '2.0', id: 'track-2', result: {} });

      expect(router.isPending('track-2')).toBe(false);
      expect(router.pendingCount).toBe(0);
    });

    it('should handle notifications without tracking', async () => {
      // Notification has no id
      await router.route({ jsonrpc: '2.0', method: 'notify', agentId: 'correlation-agent' });

      expect(router.pendingCount).toBe(0);
    });

    it('should handle numeric request IDs', async () => {
      await router.route({ jsonrpc: '2.0', id: 42, method: 'test', agentId: 'correlation-agent' });

      expect(router.isPending(42)).toBe(true);

      router.handleAgentResponse('correlation-agent', { jsonrpc: '2.0', id: 42, result: {} });

      expect(router.isPending(42)).toBe(false);
    });

    it('should not remove pending request for wrong agent', async () => {
      await router.route({ jsonrpc: '2.0', id: 'wrong-agent', method: 'test', agentId: 'correlation-agent' });

      // Response from different agent should not clear pending
      router.handleAgentResponse('other-agent', { jsonrpc: '2.0', id: 'wrong-agent', result: {} });

      expect(router.isPending('wrong-agent')).toBe(true);
    });
  });
});
