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

import type { AgentRuntime } from './types.js';
import type { SpawnCommand } from '../registry/types.js';
import { AgentRuntimeImpl } from './agent-runtime.js';

/**
 * Default timeout in milliseconds for graceful termination before SIGKILL.
 */
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5000;

/**
 * Callback type for agent exit events.
 */
export type AgentExitCallback = (agentId: string, code: number | null) => void;

/**
 * Manager for agent runtime lifecycle.
 *
 * Handles spawning, tracking, and terminating agent processes.
 * Stores runtimes in a Map keyed by agentId.
 */
export class AgentRuntimeManager {
  /** Map of agentId to AgentRuntime instances */
  private readonly runtimes: Map<string, AgentRuntime> = new Map();

  /** Registered callbacks for agent exit events */
  private readonly exitCallbacks: AgentExitCallback[] = [];

  /**
   * Get an existing runtime or spawn a new one for the given agentId.
   *
   * If a runtime already exists for the agentId, returns it.
   * Otherwise, spawns a new agent process using the provided spawn command.
   *
   * @param agentId - The agent identifier
   * @param spawnCommand - The resolved spawn command for spawning a new process
   * @returns The existing or newly spawned AgentRuntime
   */
  public async getOrSpawn(agentId: string, spawnCommand: SpawnCommand): Promise<AgentRuntime> {
    // Return existing runtime if available
    const existing = this.runtimes.get(agentId);
    if (existing && existing.state !== 'stopped') {
      return existing;
    }

    // Spawn new runtime
    const runtime = AgentRuntimeImpl.spawn(
      agentId,
      spawnCommand,
      (code: number | null, _signal: string | null) => {
        this.handleAgentExit(agentId, code);
      },
    );

    // Store in map
    this.runtimes.set(agentId, runtime);

    return runtime;
  }

  /**
   * Get an existing runtime without spawning.
   *
   * @param agentId - The agent identifier
   * @returns The AgentRuntime if it exists, undefined otherwise
   */
  public get(agentId: string): AgentRuntime | undefined {
    return this.runtimes.get(agentId);
  }

  /**
   * Terminate a specific agent runtime.
   *
   * Sends SIGTERM to the agent process and waits for it to exit.
   * If the process doesn't exit within the timeout, sends SIGKILL.
   *
   * @param agentId - The agent identifier
   * @param timeout - Timeout in milliseconds before SIGKILL (default: 5000ms)
   */
  public async terminate(agentId: string, timeout: number = DEFAULT_SHUTDOWN_TIMEOUT_MS): Promise<void> {
    const runtime = this.runtimes.get(agentId);
    if (!runtime) {
      return;
    }

    await runtime.terminate(timeout);
    this.runtimes.delete(agentId);
  }

  /**
   * Terminate all agent runtimes for graceful shutdown.
   *
   * @param timeout - Timeout in milliseconds before SIGKILL (default: 5000ms)
   */
  public async terminateAll(timeout: number = DEFAULT_SHUTDOWN_TIMEOUT_MS): Promise<void> {
    const terminatePromises: Promise<void>[] = [];

    for (const [agentId, runtime] of this.runtimes) {
      if (runtime.state !== 'stopped') {
        terminatePromises.push(
          runtime.terminate(timeout).then(() => {
            this.runtimes.delete(agentId);
          }),
        );
      }
    }

    await Promise.all(terminatePromises);
  }

  /**
   * Register a callback for agent exit events.
   *
   * The callback is invoked when an agent process exits unexpectedly.
   *
   * @param callback - Function to call when an agent exits
   */
  public onAgentExit(callback: AgentExitCallback): void {
    this.exitCallbacks.push(callback);
  }

  /**
   * Handle agent process exit.
   *
   * Removes the runtime from the map and notifies registered callbacks.
   *
   * @param agentId - The agent identifier
   * @param code - The exit code (null if terminated by signal)
   */
  private handleAgentExit(agentId: string, code: number | null): void {
    // Remove from map
    this.runtimes.delete(agentId);

    // Notify all registered callbacks
    for (const callback of this.exitCallbacks) {
      try {
        callback(agentId, code);
      } catch {
        // Ignore callback errors to prevent one failing callback from affecting others
      }
    }
  }

  /**
   * Get the number of active runtimes.
   *
   * @returns The count of runtimes currently in the map
   */
  public get size(): number {
    return this.runtimes.size;
  }

  /**
   * Check if a runtime exists for the given agentId.
   *
   * @param agentId - The agent identifier
   * @returns true if a runtime exists, false otherwise
   */
  public has(agentId: string): boolean {
    return this.runtimes.has(agentId);
  }
}
