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
 * ACP Client Capabilities
 *
 * Provides utilities for accessing client capabilities like file system
 * and terminal operations via the ACP SDK.
 *
 * @module acp/client-capabilities
 */

import type { AgentSideConnection, ClientCapabilities, TerminalHandle } from '@agentclientprotocol/sdk';

/**
 * Result of a file read operation.
 */
export interface FileReadResult {
  /** The file content */
  content: string;
  /** Whether the operation was successful */
  success: boolean;
  /** Error message if the operation failed */
  error?: string;
}

/**
 * Result of a file write operation.
 */
export interface FileWriteResult {
  /** Whether the operation was successful */
  success: boolean;
  /** Error message if the operation failed */
  error?: string;
}

/**
 * Result of a terminal command execution.
 */
export interface TerminalResult {
  /** The terminal output */
  output: string;
  /** The exit code (null if terminated by signal) */
  exitCode: number | null;
  /** The signal that terminated the process (null if exited normally) */
  signal: string | null;
  /** Whether the output was truncated */
  truncated: boolean;
  /** Whether the operation was successful */
  success: boolean;
  /** Error message if the operation failed */
  error?: string;
}

/**
 * Check if the client supports file system read operations.
 *
 * @param capabilities - The client capabilities
 * @returns Whether file read is supported
 */
export function canReadFile(capabilities: ClientCapabilities | null): boolean {
  return capabilities?.fs?.readTextFile === true;
}

/**
 * Check if the client supports file system write operations.
 *
 * @param capabilities - The client capabilities
 * @returns Whether file write is supported
 */
export function canWriteFile(capabilities: ClientCapabilities | null): boolean {
  return capabilities?.fs?.writeTextFile === true;
}

/**
 * Check if the client supports terminal operations.
 *
 * @param capabilities - The client capabilities
 * @returns Whether terminal is supported
 */
export function canUseTerminal(capabilities: ClientCapabilities | null): boolean {
  return capabilities?.terminal === true;
}

/**
 * Read a text file from the client's file system.
 *
 * @param connection - The ACP connection
 * @param sessionId - The session ID
 * @param path - Absolute path to the file
 * @param options - Optional read options (line, limit)
 * @returns The file read result
 */
export async function readFile(
  connection: AgentSideConnection,
  sessionId: string,
  path: string,
  options?: { line?: number; limit?: number },
): Promise<FileReadResult> {
  try {
    const response = await connection.readTextFile({
      sessionId,
      path,
      line: options?.line,
      limit: options?.limit,
    });

    return {
      content: response.content,
      success: true,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[ACP] Failed to read file "${path}":`, error);
    return {
      content: '',
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Write content to a text file in the client's file system.
 *
 * @param connection - The ACP connection
 * @param sessionId - The session ID
 * @param path - Absolute path to the file
 * @param content - The content to write
 * @returns The file write result
 */
export async function writeFile(
  connection: AgentSideConnection,
  sessionId: string,
  path: string,
  content: string,
): Promise<FileWriteResult> {
  try {
    await connection.writeTextFile({
      sessionId,
      path,
      content,
    });

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[ACP] Failed to write file "${path}":`, error);
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Execute a command in a terminal and wait for completion.
 * - Use SDK terminal methods (create, output, wait, kill, release)
 * - Track terminal IDs for cleanup
 * - Implement command timeouts
 *
 * @param connection - The ACP connection
 * @param sessionId - The session ID
 * @param command - The command to execute
 * @param options - Optional execution options
 * @returns The terminal execution result
 */
export async function executeCommand(
  connection: AgentSideConnection,
  sessionId: string,
  command: string,
  options?: {
    args?: string[];
    cwd?: string;
    env?: Array<{ name: string; value: string }>;
    timeout?: number;
    outputByteLimit?: number;
  },
): Promise<TerminalResult> {
  let terminal: TerminalHandle | null = null;

  try {
    // Create terminal and execute command
    terminal = await connection.createTerminal({
      sessionId,
      command,
      args: options?.args,
      cwd: options?.cwd,
      env: options?.env,
      outputByteLimit: options?.outputByteLimit,
    });

    // Set up timeout if specified
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let timedOut = false;

    if (options?.timeout && options.timeout > 0) {
      timeoutId = setTimeout(async () => {
        timedOut = true;
        if (terminal) {
          try {
            await terminal.kill();
          } catch {
            // Ignore kill errors
          }
        }
      }, options.timeout);
    }

    try {
      // Wait for command to complete
      const exitResult = await terminal.waitForExit();

      // Clear timeout if set
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      // Get final output
      const outputResult = await terminal.currentOutput();

      return {
        output: outputResult.output,
        exitCode: timedOut ? null : exitResult.exitCode ?? null,
        signal: timedOut ? 'SIGTERM' : exitResult.signal ?? null,
        truncated: outputResult.truncated,
        success: !timedOut && exitResult.exitCode === 0,
        error: timedOut ? 'Command timed out' : undefined,
      };
    } finally {
      // Clear timeout if still pending
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[ACP] Failed to execute command "${command}":`, error);
    return {
      output: '',
      exitCode: null,
      signal: null,
      truncated: false,
      success: false,
      error: errorMessage,
    };
  } finally {
    // Always release the terminal
    if (terminal) {
      try {
        await terminal.release();
      } catch {
        // Ignore release errors
      }
    }
  }
}

/**
 * Execute a command in a terminal without waiting for completion.
 * Returns a handle for managing the terminal.
 *
 * @param connection - The ACP connection
 * @param sessionId - The session ID
 * @param command - The command to execute
 * @param options - Optional execution options
 * @returns The terminal handle for managing the process
 */
export async function startCommand(
  connection: AgentSideConnection,
  sessionId: string,
  command: string,
  options?: {
    args?: string[];
    cwd?: string;
    env?: Array<{ name: string; value: string }>;
    outputByteLimit?: number;
  },
): Promise<TerminalHandle> {
  return connection.createTerminal({
    sessionId,
    command,
    args: options?.args,
    cwd: options?.cwd,
    env: options?.env,
    outputByteLimit: options?.outputByteLimit,
  });
}
