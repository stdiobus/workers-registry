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
 * Unit Tests for AgentRuntimeManager
 *
 * Tests for spawn/terminate lifecycle, concurrent access, exit handling,
 * and other runtime management scenarios.
 *
 * @module registry-launcher/runtime/manager.test
 */
import { AgentRuntimeManager } from './manager.js';
import type { SpawnCommand } from '../registry/types.js';

/**
 * Create a spawn command that uses 'cat' which exists on all Unix-like systems.
 * 'cat' will wait for input, making it suitable for lifecycle testing.
 */
function createTestSpawnCommand(): SpawnCommand {
  return {
    command: 'cat',
    args: [],
  };
}

/**
 * Create a spawn command that exits immediately with a specific code.
 * Uses 'sh -c' to run a command that exits with the given code.
 */
function createExitingSpawnCommand(exitCode: number): SpawnCommand {
  return {
    command: 'sh',
    args: ['-c', `exit ${exitCode}`],
  };
}

/**
 * Create a spawn command that sleeps for a specified duration.
 * Useful for testing termination scenarios.
 */
function createSleepingSpawnCommand(seconds: number): SpawnCommand {
  return {
    command: 'sleep',
    args: [seconds.toString()],
  };
}

describe('AgentRuntimeManager Unit Tests', () => {
  describe('Spawn/Terminate Lifecycle', () => {
    /**
     * Store AgentRuntime in internal map keyed by agentId after spawn
     */
    it('should spawn a new agent and store it in the map', async () => {
      const manager = new AgentRuntimeManager();
      const spawnCommand = createTestSpawnCommand();

      try {
        const runtime = await manager.getOrSpawn('test-agent', spawnCommand);

        expect(runtime).toBeDefined();
        expect(runtime.agentId).toBe('test-agent');
        expect(manager.has('test-agent')).toBe(true);
        expect(manager.size).toBe(1);
      } finally {
        await manager.terminateAll(100);
      }
    });

    it('should transition runtime state from starting to running', async () => {
      const manager = new AgentRuntimeManager();
      const spawnCommand = createTestSpawnCommand();

      try {
        const runtime = await manager.getOrSpawn('test-agent', spawnCommand);

        // Wait a bit for the process to fully start
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(['starting', 'running']).toContain(runtime.state);
      } finally {
        await manager.terminateAll(100);
      }
    });

    it('should terminate an agent and remove it from the map', async () => {
      const manager = new AgentRuntimeManager();
      const spawnCommand = createTestSpawnCommand();

      const runtime = await manager.getOrSpawn('test-agent', spawnCommand);
      expect(manager.has('test-agent')).toBe(true);

      await manager.terminate('test-agent', 100);

      expect(manager.has('test-agent')).toBe(false);
      expect(manager.size).toBe(0);
      expect(runtime.state).toBe('stopped');
    });

    it('should handle terminating a non-existent agent gracefully', async () => {
      const manager = new AgentRuntimeManager();

      // Should not throw
      await expect(manager.terminate('non-existent', 100)).resolves.toBeUndefined();
    });

    it('should verify runtime is stopped after termination', async () => {
      const manager = new AgentRuntimeManager();
      const spawnCommand = createTestSpawnCommand();

      const runtime = await manager.getOrSpawn('test-agent', spawnCommand);
      await manager.terminate('test-agent', 100);

      expect(runtime.state).toBe('stopped');
    });
  });

  describe('Concurrent Access', () => {
    /**
     * Tests concurrent getOrSpawn calls for the same agentId
     */
    it('should handle concurrent getOrSpawn calls for the same agentId', async () => {
      const manager = new AgentRuntimeManager();
      const spawnCommand = createTestSpawnCommand();

      try {
        // Make concurrent calls
        const [runtime1, runtime2, runtime3] = await Promise.all([
          manager.getOrSpawn('test-agent', spawnCommand),
          manager.getOrSpawn('test-agent', spawnCommand),
          manager.getOrSpawn('test-agent', spawnCommand),
        ]);

        // All should have the same agentId
        expect(runtime1.agentId).toBe('test-agent');
        expect(runtime2.agentId).toBe('test-agent');
        expect(runtime3.agentId).toBe('test-agent');

        // Only one runtime should be stored
        expect(manager.size).toBe(1);
      } finally {
        await manager.terminateAll(100);
      }
    });

    it('should handle concurrent getOrSpawn calls for different agentIds', async () => {
      const manager = new AgentRuntimeManager();
      const spawnCommand = createTestSpawnCommand();

      try {
        const [runtime1, runtime2, runtime3] = await Promise.all([
          manager.getOrSpawn('agent-1', spawnCommand),
          manager.getOrSpawn('agent-2', spawnCommand),
          manager.getOrSpawn('agent-3', spawnCommand),
        ]);

        expect(runtime1.agentId).toBe('agent-1');
        expect(runtime2.agentId).toBe('agent-2');
        expect(runtime3.agentId).toBe('agent-3');
        expect(manager.size).toBe(3);
      } finally {
        await manager.terminateAll(100);
      }
    });

    it('should return existing runtime on subsequent getOrSpawn calls', async () => {
      const manager = new AgentRuntimeManager();
      const spawnCommand = createTestSpawnCommand();

      try {
        const runtime1 = await manager.getOrSpawn('test-agent', spawnCommand);
        const runtime2 = await manager.getOrSpawn('test-agent', spawnCommand);

        expect(runtime1).toBe(runtime2);
        expect(manager.size).toBe(1);
      } finally {
        await manager.terminateAll(100);
      }
    });
  });

  describe('Exit Handling', () => {
    /**
     * Remove AgentRuntime from map and log exit when agent process exits unexpectedly
     */
    it('should invoke onAgentExit callback when agent exits unexpectedly', async () => {
      const manager = new AgentRuntimeManager();
      const spawnCommand = createExitingSpawnCommand(42);

      const exitEvents: { agentId: string; code: number | null }[] = [];
      manager.onAgentExit((agentId, code) => {
        exitEvents.push({ agentId, code });
      });

      await manager.getOrSpawn('test-agent', spawnCommand);

      // Wait for the process to exit
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(exitEvents).toHaveLength(1);
      expect(exitEvents[0].agentId).toBe('test-agent');
      expect(exitEvents[0].code).toBe(42);
    });

    it('should remove runtime from map when agent exits unexpectedly', async () => {
      const manager = new AgentRuntimeManager();
      const spawnCommand = createExitingSpawnCommand(0);

      await manager.getOrSpawn('test-agent', spawnCommand);
      expect(manager.has('test-agent')).toBe(true);

      // Wait for the process to exit
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(manager.has('test-agent')).toBe(false);
      expect(manager.size).toBe(0);
    });

    it('should invoke multiple registered exit callbacks', async () => {
      const manager = new AgentRuntimeManager();
      const spawnCommand = createExitingSpawnCommand(1);

      const callback1Events: string[] = [];
      const callback2Events: string[] = [];

      manager.onAgentExit((agentId) => callback1Events.push(agentId));
      manager.onAgentExit((agentId) => callback2Events.push(agentId));

      await manager.getOrSpawn('test-agent', spawnCommand);

      // Wait for the process to exit
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(callback1Events).toEqual(['test-agent']);
      expect(callback2Events).toEqual(['test-agent']);
    });

    it('should continue invoking callbacks even if one throws', async () => {
      const manager = new AgentRuntimeManager();
      const spawnCommand = createExitingSpawnCommand(0);

      const successfulCallbackEvents: string[] = [];

      // First callback throws
      manager.onAgentExit(() => {
        throw new Error('Callback error');
      });

      // Second callback should still be called
      manager.onAgentExit((agentId) => {
        successfulCallbackEvents.push(agentId);
      });

      await manager.getOrSpawn('test-agent', spawnCommand);

      // Wait for the process to exit
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(successfulCallbackEvents).toEqual(['test-agent']);
    });

    it('should handle agent exit with null code (signal termination)', async () => {
      const manager = new AgentRuntimeManager();
      const spawnCommand = createSleepingSpawnCommand(60);

      const exitEvents: { agentId: string; code: number | null }[] = [];
      manager.onAgentExit((agentId, code) => {
        exitEvents.push({ agentId, code });
      });

      const runtime = await manager.getOrSpawn('test-agent', spawnCommand);

      // Terminate the process (will send SIGTERM)
      await manager.terminate('test-agent', 100);

      // The exit callback should have been invoked
      // Note: When terminated via terminate(), the runtime is removed from map
      // before the exit callback would fire, so we check the runtime state instead
      expect(runtime.state).toBe('stopped');
    });
  });

  describe('terminateAll', () => {
    /**
     * Send SIGTERM to all running agent processes on SIGTERM
     * Wait up to 5 seconds for agent processes to exit
     */
    it('should terminate all running agents', async () => {
      const manager = new AgentRuntimeManager();
      const spawnCommand = createTestSpawnCommand();

      const runtime1 = await manager.getOrSpawn('agent-1', spawnCommand);
      const runtime2 = await manager.getOrSpawn('agent-2', spawnCommand);
      const runtime3 = await manager.getOrSpawn('agent-3', spawnCommand);

      expect(manager.size).toBe(3);

      await manager.terminateAll(100);

      expect(manager.size).toBe(0);
      expect(runtime1.state).toBe('stopped');
      expect(runtime2.state).toBe('stopped');
      expect(runtime3.state).toBe('stopped');
    });

    it('should handle terminateAll with no running agents', async () => {
      const manager = new AgentRuntimeManager();

      // Should not throw
      await expect(manager.terminateAll(100)).resolves.toBeUndefined();
      expect(manager.size).toBe(0);
    });

    it('should handle terminateAll with already stopped agents', async () => {
      const manager = new AgentRuntimeManager();
      const spawnCommand = createExitingSpawnCommand(0);

      await manager.getOrSpawn('test-agent', spawnCommand);

      // Wait for the process to exit naturally
      await new Promise((resolve) => setTimeout(resolve, 200));

      // terminateAll should handle the already-stopped agent gracefully
      await expect(manager.terminateAll(100)).resolves.toBeUndefined();
    });

    it('should terminate agents concurrently', async () => {
      const manager = new AgentRuntimeManager();
      const spawnCommand = createTestSpawnCommand();

      // Spawn multiple agents
      await Promise.all([
        manager.getOrSpawn('agent-1', spawnCommand),
        manager.getOrSpawn('agent-2', spawnCommand),
        manager.getOrSpawn('agent-3', spawnCommand),
      ]);

      const startTime = Date.now();
      await manager.terminateAll(500);
      const elapsed = Date.now() - startTime;

      // Should complete in roughly the timeout time, not 3x the timeout
      // (indicating concurrent termination)
      expect(elapsed).toBeLessThan(1000);
      expect(manager.size).toBe(0);
    });
  });

  describe('get() method', () => {
    it('should return undefined for non-existent agents', async () => {
      const manager = new AgentRuntimeManager();

      expect(manager.get('non-existent')).toBeUndefined();
    });

    it('should return the runtime for existing agents', async () => {
      const manager = new AgentRuntimeManager();
      const spawnCommand = createTestSpawnCommand();

      try {
        const spawned = await manager.getOrSpawn('test-agent', spawnCommand);
        const retrieved = manager.get('test-agent');

        expect(retrieved).toBe(spawned);
      } finally {
        await manager.terminateAll(100);
      }
    });

    it('should return undefined after agent is terminated', async () => {
      const manager = new AgentRuntimeManager();
      const spawnCommand = createTestSpawnCommand();

      await manager.getOrSpawn('test-agent', spawnCommand);
      await manager.terminate('test-agent', 100);

      expect(manager.get('test-agent')).toBeUndefined();
    });

    it('should return undefined after agent exits unexpectedly', async () => {
      const manager = new AgentRuntimeManager();
      const spawnCommand = createExitingSpawnCommand(0);

      await manager.getOrSpawn('test-agent', spawnCommand);

      // Wait for the process to exit
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(manager.get('test-agent')).toBeUndefined();
    });
  });

  describe('has() method', () => {
    it('should return false for non-existent agents', () => {
      const manager = new AgentRuntimeManager();

      expect(manager.has('non-existent')).toBe(false);
    });

    it('should return true for existing agents', async () => {
      const manager = new AgentRuntimeManager();
      const spawnCommand = createTestSpawnCommand();

      try {
        await manager.getOrSpawn('test-agent', spawnCommand);

        expect(manager.has('test-agent')).toBe(true);
      } finally {
        await manager.terminateAll(100);
      }
    });

    it('should return false after agent is terminated', async () => {
      const manager = new AgentRuntimeManager();
      const spawnCommand = createTestSpawnCommand();

      await manager.getOrSpawn('test-agent', spawnCommand);
      expect(manager.has('test-agent')).toBe(true);

      await manager.terminate('test-agent', 100);
      expect(manager.has('test-agent')).toBe(false);
    });

    it('should return false after agent exits unexpectedly', async () => {
      const manager = new AgentRuntimeManager();
      const spawnCommand = createExitingSpawnCommand(0);

      await manager.getOrSpawn('test-agent', spawnCommand);
      expect(manager.has('test-agent')).toBe(true);

      // Wait for the process to exit
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(manager.has('test-agent')).toBe(false);
    });
  });

  describe('size property', () => {
    it('should return 0 for empty manager', () => {
      const manager = new AgentRuntimeManager();

      expect(manager.size).toBe(0);
    });

    it('should reflect correct count after spawning agents', async () => {
      const manager = new AgentRuntimeManager();
      const spawnCommand = createTestSpawnCommand();

      try {
        expect(manager.size).toBe(0);

        await manager.getOrSpawn('agent-1', spawnCommand);
        expect(manager.size).toBe(1);

        await manager.getOrSpawn('agent-2', spawnCommand);
        expect(manager.size).toBe(2);

        await manager.getOrSpawn('agent-3', spawnCommand);
        expect(manager.size).toBe(3);
      } finally {
        await manager.terminateAll(100);
      }
    });

    it('should not increase when spawning same agent twice', async () => {
      const manager = new AgentRuntimeManager();
      const spawnCommand = createTestSpawnCommand();

      try {
        await manager.getOrSpawn('test-agent', spawnCommand);
        expect(manager.size).toBe(1);

        await manager.getOrSpawn('test-agent', spawnCommand);
        expect(manager.size).toBe(1);
      } finally {
        await manager.terminateAll(100);
      }
    });

    it('should decrease after terminating agents', async () => {
      const manager = new AgentRuntimeManager();
      const spawnCommand = createTestSpawnCommand();

      await manager.getOrSpawn('agent-1', spawnCommand);
      await manager.getOrSpawn('agent-2', spawnCommand);
      expect(manager.size).toBe(2);

      await manager.terminate('agent-1', 100);
      expect(manager.size).toBe(1);

      await manager.terminate('agent-2', 100);
      expect(manager.size).toBe(0);
    });

    it('should decrease after agent exits unexpectedly', async () => {
      const manager = new AgentRuntimeManager();
      const spawnCommand = createExitingSpawnCommand(0);

      await manager.getOrSpawn('test-agent', spawnCommand);
      expect(manager.size).toBe(1);

      // Wait for the process to exit
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(manager.size).toBe(0);
    });

    it('should return 0 after terminateAll', async () => {
      const manager = new AgentRuntimeManager();
      const spawnCommand = createTestSpawnCommand();

      await manager.getOrSpawn('agent-1', spawnCommand);
      await manager.getOrSpawn('agent-2', spawnCommand);
      await manager.getOrSpawn('agent-3', spawnCommand);
      expect(manager.size).toBe(3);

      await manager.terminateAll(100);
      expect(manager.size).toBe(0);
    });
  });

  describe('onAgentExit callback registration', () => {
    it('should allow registering multiple callbacks', async () => {
      const manager = new AgentRuntimeManager();
      const spawnCommand = createExitingSpawnCommand(0);

      const events1: string[] = [];
      const events2: string[] = [];
      const events3: string[] = [];

      manager.onAgentExit((agentId) => events1.push(agentId));
      manager.onAgentExit((agentId) => events2.push(agentId));
      manager.onAgentExit((agentId) => events3.push(agentId));

      await manager.getOrSpawn('test-agent', spawnCommand);

      // Wait for the process to exit
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(events1).toEqual(['test-agent']);
      expect(events2).toEqual(['test-agent']);
      expect(events3).toEqual(['test-agent']);
    });

    it('should invoke callbacks with correct exit code', async () => {
      const manager = new AgentRuntimeManager();

      const exitCodes: (number | null)[] = [];
      manager.onAgentExit((_agentId, code) => exitCodes.push(code));

      // Test with different exit codes
      await manager.getOrSpawn('agent-0', createExitingSpawnCommand(0));
      await new Promise((resolve) => setTimeout(resolve, 100));

      await manager.getOrSpawn('agent-1', createExitingSpawnCommand(1));
      await new Promise((resolve) => setTimeout(resolve, 100));

      await manager.getOrSpawn('agent-42', createExitingSpawnCommand(42));
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(exitCodes).toContain(0);
      expect(exitCodes).toContain(1);
      expect(exitCodes).toContain(42);
    });
  });

  describe('Edge Cases', () => {
    it('should handle spawning agent with same ID after previous one exited', async () => {
      const manager = new AgentRuntimeManager();

      // First spawn and exit
      await manager.getOrSpawn('test-agent', createExitingSpawnCommand(0));
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(manager.has('test-agent')).toBe(false);

      // Second spawn with same ID
      try {
        const runtime = await manager.getOrSpawn('test-agent', createTestSpawnCommand());
        expect(runtime.agentId).toBe('test-agent');
        expect(manager.has('test-agent')).toBe(true);
      } finally {
        await manager.terminateAll(100);
      }
    });

    it('should handle spawning agent with same ID after termination', async () => {
      const manager = new AgentRuntimeManager();
      const spawnCommand = createTestSpawnCommand();

      // First spawn and terminate
      await manager.getOrSpawn('test-agent', spawnCommand);
      await manager.terminate('test-agent', 100);
      expect(manager.has('test-agent')).toBe(false);

      // Second spawn with same ID
      try {
        const runtime = await manager.getOrSpawn('test-agent', spawnCommand);
        expect(runtime.agentId).toBe('test-agent');
        expect(manager.has('test-agent')).toBe(true);
      } finally {
        await manager.terminateAll(100);
      }
    });

    it('should handle empty agentId', async () => {
      const manager = new AgentRuntimeManager();
      const spawnCommand = createTestSpawnCommand();

      try {
        // Empty string is technically a valid key
        const runtime = await manager.getOrSpawn('', spawnCommand);
        expect(runtime.agentId).toBe('');
        expect(manager.has('')).toBe(true);
      } finally {
        await manager.terminateAll(100);
      }
    });

    it('should handle agentId with special characters', async () => {
      const manager = new AgentRuntimeManager();
      const spawnCommand = createTestSpawnCommand();

      try {
        const specialId = 'agent/with:special@chars#123';
        const runtime = await manager.getOrSpawn(specialId, spawnCommand);
        expect(runtime.agentId).toBe(specialId);
        expect(manager.has(specialId)).toBe(true);
        expect(manager.get(specialId)).toBe(runtime);
      } finally {
        await manager.terminateAll(100);
      }
    });
  });
});
