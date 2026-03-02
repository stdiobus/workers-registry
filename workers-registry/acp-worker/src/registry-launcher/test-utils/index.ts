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
 * Test Utilities for Registry Launcher
 *
 * Provides mock implementations and test helpers for unit and integration testing
 * of the registry launcher components.
 *
 * @module registry-launcher/test-utils
 */

import { EventEmitter } from 'node:events';
import { PassThrough, Readable, Writable } from 'node:stream';
import type { BinaryTarget, Distribution, Platform, Registry, RegistryAgent } from '../registry/types.js';

/**
 * Default distribution for mock agents when not specified.
 */
const DEFAULT_DISTRIBUTION: Distribution = {
  npx: {
    package: 'mock-agent@1.0.0',
  },
};

/**
 * Create a mock Registry with the specified agents.
 *
 * Fills in default values for any missing required fields in the agent definitions.
 *
 * @param agents - Partial agent definitions to include in the registry
 * @returns A complete Registry object with the specified agents
 *
 * @example
 * ```typescript
 * const registry = createMockRegistry([
 *   { id: 'agent-1', name: 'Test Agent 1' },
 *   { id: 'agent-2', name: 'Test Agent 2', distribution: { uvx: { package: 'my-agent' } } },
 * ]);
 * ```
 */
export function createMockRegistry(agents: Partial<RegistryAgent>[]): Registry {
  const completeAgents: RegistryAgent[] = agents.map((partial, index) => ({
    id: partial.id ?? `mock-agent-${index}`,
    name: partial.name ?? `Mock Agent ${index}`,
    version: partial.version ?? '1.0.0',
    description: partial.description,
    distribution: partial.distribution ?? DEFAULT_DISTRIBUTION,
  }));

  return {
    version: '1.0.0',
    agents: completeAgents,
  };
}

/**
 * Create a mock agent with a specific distribution type.
 *
 * Helper function for creating agents with different distribution configurations.
 *
 * @param id - Agent identifier
 * @param distribution - Distribution configuration
 * @param overrides - Additional agent properties to override
 * @returns A complete RegistryAgent object
 */
export function createMockAgent(
  id: string,
  distribution: Distribution,
  overrides?: Partial<Omit<RegistryAgent, 'id' | 'distribution'>>,
): RegistryAgent {
  return {
    id,
    name: overrides?.name ?? `Agent ${id}`,
    version: overrides?.version ?? '1.0.0',
    description: overrides?.description,
    distribution,
  };
}

/**
 * Create a mock agent with binary distribution for a specific platform.
 *
 * @param id - Agent identifier
 * @param platforms - Map of platform to binary target
 * @param overrides - Additional agent properties
 * @returns A RegistryAgent with binary distribution
 */
export function createMockBinaryAgent(
  id: string,
  platforms: Partial<Record<Platform, BinaryTarget>>,
  overrides?: Partial<Omit<RegistryAgent, 'id' | 'distribution'>>,
): RegistryAgent {
  return createMockAgent(
    id,
    { binary: platforms },
    overrides,
  );
}

/**
 * Create a mock agent with npx distribution.
 *
 * @param id - Agent identifier
 * @param packageName - NPM package name (can include version like "pkg@1.0.0")
 * @param args - Optional command-line arguments
 * @param overrides - Additional agent properties
 * @returns A RegistryAgent with npx distribution
 */
export function createMockNpxAgent(
  id: string,
  packageName: string,
  args?: string[],
  overrides?: Partial<Omit<RegistryAgent, 'id' | 'distribution'>>,
): RegistryAgent {
  return createMockAgent(
    id,
    { npx: { package: packageName, args } },
    overrides,
  );
}

/**
 * Create a mock agent with uvx distribution.
 *
 * @param id - Agent identifier
 * @param packageName - Python package name (can include version like "pkg@latest")
 * @param args - Optional command-line arguments
 * @param overrides - Additional agent properties
 * @returns A RegistryAgent with uvx distribution
 */
export function createMockUvxAgent(
  id: string,
  packageName: string,
  args?: string[],
  overrides?: Partial<Omit<RegistryAgent, 'id' | 'distribution'>>,
): RegistryAgent {
  return createMockAgent(
    id,
    { uvx: { package: packageName, args } },
    overrides,
  );
}

/**
 * Mock ChildProcess interface for testing agent runtime management.
 *
 * Provides controllable stdin/stdout/stderr streams and process lifecycle events.
 */
export interface MockChildProcess extends EventEmitter {
  /** Mock stdin stream for writing to the process */
  stdin: Writable & { destroyed: boolean };
  /** Mock stdout stream for reading from the process */
  stdout: Readable;
  /** Mock stderr stream for reading error output */
  stderr: Readable;
  /** Process ID (mock value) */
  pid: number;
  /** Whether the process has been killed */
  killed: boolean;
  /** Exit code (null until process exits) */
  exitCode: number | null;
  /** Signal that caused exit (null if exited normally) */
  signalCode: string | null;

  /**
   * Send a kill signal to the mock process.
   * @param signal - Signal to send (default: 'SIGTERM')
   * @returns true if signal was sent
   */
  kill(signal?: string): boolean;

  /**
   * Simulate the process exiting with a specific code.
   * @param code - Exit code (0 for success)
   * @param signal - Optional signal that caused exit
   */
  simulateExit(code: number, signal?: string | null): void;

  /**
   * Simulate the process spawning successfully.
   */
  simulateSpawn(): void;

  /**
   * Simulate a spawn error.
   * @param error - Error to emit
   */
  simulateError(error: Error): void;

  /**
   * Write data to stdout as if the process produced it.
   * @param data - Data to write
   */
  writeToStdout(data: string): void;

  /**
   * Write data to stderr as if the process produced it.
   * @param data - Data to write
   */
  writeToStderr(data: string): void;

  /**
   * Get all data written to stdin.
   * @returns Array of strings written to stdin
   */
  getStdinWrites(): string[];
}

/**
 * Create a mock ChildProcess for testing agent runtime management.
 *
 * The mock process provides controllable streams and lifecycle events,
 * allowing tests to simulate various process behaviors.
 *
 * @param pid - Optional process ID (default: random)
 * @returns A MockChildProcess instance
 *
 * @example
 * ```typescript
 * const mockProcess = createMockAgentProcess();
 *
 * // Simulate successful spawn
 * mockProcess.simulateSpawn();
 *
 * // Write to stdout as if the agent produced output
 * mockProcess.writeToStdout('{"jsonrpc":"2.0","id":1,"result":{}}\n');
 *
 * // Simulate process exit
 * mockProcess.simulateExit(0);
 * ```
 */
export function createMockAgentProcess(pid?: number): MockChildProcess {
  const stdinWrites: string[] = [];
  let killed = false;
  let exitCode: number | null = null;
  let signalCode: string | null = null;
  let stdinDestroyed = false;

  // Create mock stdin that captures writes
  const stdin = new Writable({
    write(chunk, _encoding, callback) {
      if (stdinDestroyed) {
        callback(new Error('stdin destroyed'));
        return;
      }
      stdinWrites.push(chunk.toString());
      callback();
    },
  }) as Writable & { destroyed: boolean };

  // Track destroyed state
  const originalEnd = stdin.end.bind(stdin);
  stdin.end = function (...args: Parameters<typeof originalEnd>) {
    stdinDestroyed = true;
    return originalEnd(...args);
  } as typeof stdin.end;

  Object.defineProperty(stdin, 'destroyed', {
    get() {
      return stdinDestroyed;
    },
  });

  // Create mock stdout/stderr as PassThrough streams
  const stdout = new PassThrough();
  const stderr = new PassThrough();

  stdout.setEncoding('utf8');
  stderr.setEncoding('utf8');

  // Create the mock process with EventEmitter capabilities
  const mockProcess = new EventEmitter() as MockChildProcess;

  // Assign streams
  mockProcess.stdin = stdin;
  mockProcess.stdout = stdout;
  mockProcess.stderr = stderr;
  mockProcess.pid = pid ?? Math.floor(Math.random() * 100000) + 1000;

  // Define getters for state properties
  Object.defineProperty(mockProcess, 'killed', {
    get() {
      return killed;
    },
  });

  Object.defineProperty(mockProcess, 'exitCode', {
    get() {
      return exitCode;
    },
  });

  Object.defineProperty(mockProcess, 'signalCode', {
    get() {
      return signalCode;
    },
  });

  // Implement kill method
  mockProcess.kill = function (signal: string = 'SIGTERM'): boolean {
    if (killed || exitCode !== null) {
      return false;
    }
    killed = true;

    // Simulate async exit after kill
    setImmediate(() => {
      if (exitCode === null) {
        signalCode = signal;
        exitCode = null;
        mockProcess.emit('exit', null, signal);
      }
    });

    return true;
  };

  // Implement simulation methods
  mockProcess.simulateExit = function (code: number, signal: string | null = null): void {
    if (exitCode !== null) {
      return; // Already exited
    }
    exitCode = code;
    signalCode = signal;
    killed = true;
    stdinDestroyed = true;
    mockProcess.emit('exit', code, signal);
  };

  mockProcess.simulateSpawn = function (): void {
    mockProcess.emit('spawn');
  };

  mockProcess.simulateError = function (error: Error): void {
    mockProcess.emit('error', error);
  };

  mockProcess.writeToStdout = function (data: string): void {
    stdout.write(data);
  };

  mockProcess.writeToStderr = function (data: string): void {
    stderr.write(data);
  };

  mockProcess.getStdinWrites = function (): string[] {
    return [...stdinWrites];
  };

  return mockProcess;
}

/**
 * Test NDJSON stream pair for testing stream handling.
 *
 * Provides connected input/output streams for testing NDJSON message flow.
 */
export interface TestNDJSONStream {
  /** Writable stream to send data into the handler */
  input: Writable;
  /** Writable stream to capture data from the handler */
  output: Writable;

  /**
   * Write a JSON message to the input stream.
   * @param message - Object to serialize and write as NDJSON
   */
  writeMessage(message: object): void;

  /**
   * Get all messages written to the output stream.
   * @returns Array of parsed JSON objects
   */
  getOutputMessages(): object[];

  /**
   * Get raw output data as string.
   * @returns Concatenated output data
   */
  getRawOutput(): string;
}

/**
 * Create a test NDJSON stream pair for testing stream handling.
 *
 * The input stream can be used to feed data into an NDJSON handler,
 * while the output stream captures data written by the handler.
 *
 * @returns A TestNDJSONStream with connected input/output streams
 *
 * @example
 * ```typescript
 * const { input, output, writeMessage, getOutputMessages } = createTestNDJSONStream();
 *
 * // Create handler with the output stream
 * const handler = new NDJSONHandler(output);
 *
 * // Feed data through input
 * writeMessage({ jsonrpc: '2.0', method: 'test', id: 1 });
 *
 * // Check what was written to output
 * const messages = getOutputMessages();
 * ```
 */
export function createTestNDJSONStream(): TestNDJSONStream {
  const outputChunks: string[] = [];

  // Create input as a PassThrough that can be written to
  const input = new PassThrough();

  // Create output that captures all writes
  const output = new Writable({
    write(chunk, _encoding, callback) {
      outputChunks.push(chunk.toString());
      callback();
    },
  });

  return {
    input,
    output,

    writeMessage(message: object): void {
      input.write(JSON.stringify(message) + '\n');
    },

    getOutputMessages(): object[] {
      const messages: object[] = [];
      const rawOutput = outputChunks.join('');

      for (const line of rawOutput.split('\n')) {
        if (line.trim()) {
          try {
            messages.push(JSON.parse(line));
          } catch {
            // Skip malformed lines
          }
        }
      }

      return messages;
    },

    getRawOutput(): string {
      return outputChunks.join('');
    },
  };
}

/**
 * Create a mock fetch function for testing registry fetching.
 *
 * @param responseData - Data to return from fetch
 * @param options - Optional configuration for the mock
 * @returns A mock fetch function
 */
export function createMockFetch(
  responseData: unknown,
  options?: {
    /** HTTP status code (default: 200) */
    status?: number;
    /** Whether to simulate network error */
    networkError?: boolean;
    /** Error message for network error */
    errorMessage?: string;
  },
): typeof fetch {
  return async (_url: string | URL | Request, _init?: RequestInit): Promise<Response> => {
    if (options?.networkError) {
      throw new Error(options.errorMessage ?? 'Network error');
    }

    const status = options?.status ?? 200;
    const body = typeof responseData === 'string' ? responseData : JSON.stringify(responseData);

    return new Response(body, {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}

/**
 * Wait for a specified number of milliseconds.
 *
 * Utility function for tests that need to wait for async operations.
 *
 * @param ms - Milliseconds to wait
 * @returns Promise that resolves after the delay
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a deferred promise for testing async operations.
 *
 * @returns Object with promise and resolve/reject functions
 */
export function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}
