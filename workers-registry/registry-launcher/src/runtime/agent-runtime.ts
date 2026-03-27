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

import { ChildProcess, spawn } from 'child_process';
import type { AgentRuntime, RuntimeState } from './types.js';
import type { SpawnCommand } from '../registry/types.js';

/**
 * Default timeout in milliseconds for graceful termination before SIGKILL.
 */
const DEFAULT_TERMINATE_TIMEOUT_MS = 5000;

/**
 * Implementation of AgentRuntime that manages a spawned agent process.
 *
 * Handles process spawning with non-blocking file descriptors,
 * message writing to stdin, and graceful termination with SIGTERM/SIGKILL.
 */
export class AgentRuntimeImpl implements AgentRuntime {
  public readonly agentId: string;
  public state: RuntimeState;
  public readonly process: ChildProcess;

  private readonly onExitCallback?: (code: number | null, signal: string | null) => void;

  /**
   * Create a new AgentRuntime by spawning a process.
   *
   * @param agentId - The agent identifier
   * @param spawnCommand - The resolved spawn command
   * @param onExit - Optional callback when process exits
   */
  private constructor(
    agentId: string,
    process: ChildProcess,
    onExit?: (code: number | null, signal: string | null) => void,
  ) {
    this.agentId = agentId;
    this.process = process;
    this.state = 'starting';
    this.onExitCallback = onExit;

    this.setupProcessHandlers();
  }

  /**
   * Spawn a new agent process and create an AgentRuntime instance.
   *
   * @param agentId - The agent identifier
   * @param spawnCommand - The resolved spawn command with command, args, and optional env
   * @param onExit - Optional callback when process exits
   * @returns A new AgentRuntime instance
   */
  public static spawn(
    agentId: string,
    spawnCommand: SpawnCommand,
    onExit?: (code: number | null, signal: string | null) => void,
  ): AgentRuntimeImpl {
    const childProcess = spawn(spawnCommand.command, spawnCommand.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ...spawnCommand.env,
      },
      // Detach from parent's controlling terminal to avoid signal propagation issues
      detached: false,
    });

    // Set file descriptors to non-blocking mode
    // Node.js streams are already non-blocking by default when using 'pipe',
    // but we ensure the streams are in flowing mode for proper async handling
    if (childProcess.stdout) {
      childProcess.stdout.setEncoding('utf8');
    }
    if (childProcess.stderr) {
      childProcess.stderr.setEncoding('utf8');
    }

    return new AgentRuntimeImpl(agentId, childProcess, onExit);
  }

  /**
   * Set up event handlers for the child process.
   */
  private setupProcessHandlers(): void {
    // Handle process spawn success
    this.process.on('spawn', () => {
      if (this.state === 'starting') {
        this.state = 'running';
      }
    });

    // Handle process errors (e.g., spawn failure)
    this.process.on('error', (error: Error) => {
      this.state = 'stopped';
      // Log to stderr as per requirements
      process.stderr.write(
        `[${new Date().toISOString()}] ERROR: Agent ${this.agentId} process error: ${error.message}\n`,
      );
    });

    // Handle process exit
    this.process.on('exit', (code: number | null, signal: string | null) => {
      this.state = 'stopped';
      if (this.onExitCallback) {
        this.onExitCallback(code, signal);
      }
    });

    // Handle stdin errors (e.g., broken pipe)
    if (this.process.stdin) {
      this.process.stdin.on('error', (error: Error) => {
        // Log stdin write errors but don't change state
        process.stderr.write(
          `[${new Date().toISOString()}] WARN: Agent ${this.agentId} stdin error: ${error.message}\n`,
        );
      });
    }
  }

  /**
   * Write a message to the agent's stdin as NDJSON.
   *
   * @param message - The message object to send
   * @returns true if the write was accepted, false if backpressure or error
   */
  public write(message: object): boolean {
    if (this.state !== 'running' && this.state !== 'starting') {
      return false;
    }

    if (!this.process.stdin || this.process.stdin.destroyed) {
      return false;
    }

    try {
      const ndjsonLine = JSON.stringify(message) + '\n';
      return this.process.stdin.write(ndjsonLine);
    } catch {
      return false;
    }
  }

  /**
   * Terminate the agent process gracefully.
   *
   * Sends SIGTERM first, then SIGKILL after timeout if process doesn't exit.
   *
   * @param timeout - Timeout in milliseconds before SIGKILL (default: 5000ms)
   * @returns Promise that resolves when process has exited
   */
  public async terminate(timeout: number = DEFAULT_TERMINATE_TIMEOUT_MS): Promise<void> {
    // Already stopped or stopping
    if (this.state === 'stopped') {
      return;
    }

    if (this.state === 'stopping') {
      // Wait for existing termination to complete
      return this.waitForExit();
    }

    this.state = 'stopping';

    // Close stdin to signal no more input
    if (this.process.stdin && !this.process.stdin.destroyed) {
      this.process.stdin.end();
    }

    // Send SIGTERM for graceful shutdown
    this.process.kill('SIGTERM');

    // Wait for exit with timeout
    const exitPromise = this.waitForExit();
    const timeoutPromise = new Promise<'timeout'>((resolve) => {
      setTimeout(() => resolve('timeout'), timeout);
    });

    const result = await Promise.race([exitPromise, timeoutPromise]);

    if (result === 'timeout' && !this.process.killed && this.process.exitCode === null) {
      // Force kill if still running after timeout
      this.process.kill('SIGKILL');
      await this.waitForExit();
    }
  }

  /**
   * Wait for the process to exit.
   *
   * @returns Promise that resolves when process exits
   */
  private waitForExit(): Promise<void> {
    if (this.state === 'stopped') {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.process.once('exit', () => {
        resolve();
      });
    });
  }
}

