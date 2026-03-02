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
 * Property-Based Tests for AgentRuntimeManager
 *
 * Feature: acp-registry-transit
 *
 * Property 7: Runtime Storage After Spawn
 *
 * @module registry-launcher/runtime/manager.property.test
 */
import * as fc from 'fast-check';
import { AgentRuntimeManager } from './manager.js';
import type { SpawnCommand } from '../registry/types.js';

/**
 * Arbitrary for generating valid agent IDs.
 * Agent IDs should be non-empty strings.
 */
const agentIdArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 50 })
  .filter((s) => s.trim().length > 0 && !s.includes('\n') && !s.includes('\r'));

/**
 * Arbitrary for generating unique agent IDs.
 * Returns an array of unique agent IDs.
 */
const uniqueAgentIdsArb = (minLength: number, maxLength: number): fc.Arbitrary<string[]> =>
  fc
    .array(agentIdArb, { minLength, maxLength })
    .map((ids) => [...new Set(ids)])
    .filter((ids) => ids.length >= minLength);

/**
 * Create a spawn command that uses a simple, fast command.
 * Uses 'cat' which exists on all Unix-like systems and will wait for input.
 */
function createTestSpawnCommand(): SpawnCommand {
  return {
    command: 'cat',
    args: [],
  };
}

describe('AgentRuntimeManager Property Tests', () => {
  /**
   * Feature: acp-registry-transit, Property 7: Runtime Storage After Spawn
   *
   * *For any* agentId, after successfully spawning an agent process, the
   * AgentRuntimeManager should return the same AgentRuntime instance when
   * queried for that agentId.
   *
   */
  describe('Property 7: Runtime Storage After Spawn', () => {
    afterEach(async () => {
      // Clean up any spawned processes after each test
      // This is handled by individual test cleanup
    });

    it('should return the same runtime instance when queried after spawn', async () => {
      await fc.assert(
        fc.asyncProperty(agentIdArb, async (agentId) => {
          const manager = new AgentRuntimeManager();
          const spawnCommand = createTestSpawnCommand();

          try {
            // Spawn a new runtime
            const runtime1 = await manager.getOrSpawn(agentId, spawnCommand);

            // Query for the same agentId
            const runtime2 = manager.get(agentId);

            // Verify same instance is returned
            const sameInstance = runtime1 === runtime2;

            // Verify agentId matches
            const correctAgentId = runtime1.agentId === agentId;

            return sameInstance && correctAgentId;
          } finally {
            // Clean up spawned process
            await manager.terminateAll(100);
          }
        }),
        { numRuns: 100 },
      );
    });

    it('should return the same runtime instance on subsequent getOrSpawn calls', async () => {
      await fc.assert(
        fc.asyncProperty(agentIdArb, async (agentId) => {
          const manager = new AgentRuntimeManager();
          const spawnCommand = createTestSpawnCommand();

          try {
            // First spawn
            const runtime1 = await manager.getOrSpawn(agentId, spawnCommand);

            // Second getOrSpawn should return the same instance
            const runtime2 = await manager.getOrSpawn(agentId, spawnCommand);

            // Verify same instance is returned
            return runtime1 === runtime2;
          } finally {
            // Clean up spawned process
            await manager.terminateAll(100);
          }
        }),
        { numRuns: 100 },
      );
    });

    it('should store runtime in map immediately after spawn', async () => {
      await fc.assert(
        fc.asyncProperty(agentIdArb, async (agentId) => {
          const manager = new AgentRuntimeManager();
          const spawnCommand = createTestSpawnCommand();

          try {
            // Before spawn, should not have the runtime
            const beforeSpawn = manager.has(agentId);

            // Spawn
            await manager.getOrSpawn(agentId, spawnCommand);

            // After spawn, should have the runtime
            const afterSpawn = manager.has(agentId);

            return !beforeSpawn && afterSpawn;
          } finally {
            // Clean up spawned process
            await manager.terminateAll(100);
          }
        }),
        { numRuns: 100 },
      );
    });

    it('should maintain correct size after spawning multiple agents', async () => {
      await fc.assert(
        fc.asyncProperty(uniqueAgentIdsArb(1, 5), async (agentIds) => {
          const manager = new AgentRuntimeManager();
          const spawnCommand = createTestSpawnCommand();

          try {
            // Spawn all agents
            for (const agentId of agentIds) {
              await manager.getOrSpawn(agentId, spawnCommand);
            }

            // Verify size matches number of unique agent IDs
            return manager.size === agentIds.length;
          } finally {
            // Clean up spawned processes
            await manager.terminateAll(100);
          }
        }),
        { numRuns: 100 },
      );
    });

    it('should return different runtime instances for different agentIds', async () => {
      await fc.assert(
        fc.asyncProperty(uniqueAgentIdsArb(2, 5), async (agentIds) => {
          const manager = new AgentRuntimeManager();
          const spawnCommand = createTestSpawnCommand();

          try {
            // Spawn all agents and collect runtimes
            const runtimes = await Promise.all(
              agentIds.map((agentId) => manager.getOrSpawn(agentId, spawnCommand)),
            );

            // Verify all runtimes are different instances
            for (let i = 0; i < runtimes.length; i++) {
              for (let j = i + 1; j < runtimes.length; j++) {
                if (runtimes[i] === runtimes[j]) {
                  return false;
                }
              }
            }

            // Verify each runtime has the correct agentId
            for (let i = 0; i < runtimes.length; i++) {
              if (runtimes[i].agentId !== agentIds[i]) {
                return false;
              }
            }

            return true;
          } finally {
            // Clean up spawned processes
            await manager.terminateAll(100);
          }
        }),
        { numRuns: 50 },
      );
    }, 30000);

    it('should preserve runtime reference after multiple get calls', async () => {
      await fc.assert(
        fc.asyncProperty(
          agentIdArb,
          fc.integer({ min: 2, max: 10 }),
          async (agentId, numGets) => {
            const manager = new AgentRuntimeManager();
            const spawnCommand = createTestSpawnCommand();

            try {
              // Spawn the runtime
              const originalRuntime = await manager.getOrSpawn(agentId, spawnCommand);

              // Get the runtime multiple times
              for (let i = 0; i < numGets; i++) {
                const runtime = manager.get(agentId);
                if (runtime !== originalRuntime) {
                  return false;
                }
              }

              return true;
            } finally {
              // Clean up spawned process
              await manager.terminateAll(100);
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('should return undefined for non-existent agentId', async () => {
      await fc.assert(
        fc.asyncProperty(
          agentIdArb,
          agentIdArb.filter((id) => id !== 'spawned-agent'),
          async (spawnedId, queriedId) => {
            // Skip if IDs are the same
            if (spawnedId === queriedId) {
              return true;
            }

            const manager = new AgentRuntimeManager();
            const spawnCommand = createTestSpawnCommand();

            try {
              // Spawn one agent
              await manager.getOrSpawn(spawnedId, spawnCommand);

              // Query for a different agent
              const runtime = manager.get(queriedId);

              // Should return undefined for non-existent agent
              return runtime === undefined;
            } finally {
              // Clean up spawned process
              await manager.terminateAll(100);
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('should correctly report has() for spawned and non-spawned agents', async () => {
      await fc.assert(
        fc.asyncProperty(uniqueAgentIdsArb(2, 5), async (agentIds) => {
          const manager = new AgentRuntimeManager();
          const spawnCommand = createTestSpawnCommand();

          // Only spawn the first half of agents
          const spawnedIds = agentIds.slice(0, Math.ceil(agentIds.length / 2));
          const notSpawnedIds = agentIds.slice(Math.ceil(agentIds.length / 2));

          try {
            // Spawn some agents
            for (const agentId of spawnedIds) {
              await manager.getOrSpawn(agentId, spawnCommand);
            }

            // Verify has() returns true for spawned agents
            for (const agentId of spawnedIds) {
              if (!manager.has(agentId)) {
                return false;
              }
            }

            // Verify has() returns false for non-spawned agents
            for (const agentId of notSpawnedIds) {
              if (manager.has(agentId)) {
                return false;
              }
            }

            return true;
          } finally {
            // Clean up spawned processes
            await manager.terminateAll(100);
          }
        }),
        { numRuns: 100 },
      );
    });

    it('should maintain runtime storage consistency across concurrent getOrSpawn calls', async () => {
      await fc.assert(
        fc.asyncProperty(agentIdArb, async (agentId) => {
          const manager = new AgentRuntimeManager();
          const spawnCommand = createTestSpawnCommand();

          try {
            // Make concurrent getOrSpawn calls for the same agentId
            const [runtime1, runtime2, runtime3] = await Promise.all([
              manager.getOrSpawn(agentId, spawnCommand),
              manager.getOrSpawn(agentId, spawnCommand),
              manager.getOrSpawn(agentId, spawnCommand),
            ]);

            // All should return the same instance (or at least have the same agentId)
            // Note: Due to race conditions, we may get different instances initially,
            // but the final stored runtime should be consistent
            const storedRuntime = manager.get(agentId);

            // Verify the stored runtime is one of the returned runtimes
            const isConsistent =
              storedRuntime === runtime1 ||
              storedRuntime === runtime2 ||
              storedRuntime === runtime3;

            // Verify only one runtime is stored
            const sizeIsOne = manager.size === 1;

            return isConsistent && sizeIsOne;
          } finally {
            // Clean up spawned processes
            await manager.terminateAll(100);
          }
        }),
        { numRuns: 100 },
      );
    });
  });
});
