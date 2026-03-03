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
 * Property tests for NDJSON Client Request-Response Round-Trip.
 *
 * Feature: reference-implementation-docs, Property 4: NDJSON Client Request-Response Round-Trip
 *
 *
 * This test verifies that sending a request via the NDJSON client to stdio Bus kernel
 * results in receiving a corresponding response with the same `id`.
 *
 * The test uses the echo worker as the backend, connecting through stdio Bus kernel
 * via TCP to verify the full client-to-daemon-to-worker round-trip.
 *
 * @module spec-validation/ndjson-client-roundtrip.test
 */
import * as fc from 'fast-check';
import { ChildProcess, spawn } from 'child_process';
import * as net from 'net';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

/**
 * Interface for JSON-RPC 2.0 request messages.
 */
interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string;
  method: string;
  sessionId?: string;
  params?: Record<string, unknown>;
}

/**
 * Interface for JSON-RPC 2.0 response messages.
 */
interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string;
  result?: unknown;
  error?: unknown;
  sessionId?: string;
}

/**
 * Test configuration for stdio Bus kernel with echo worker.
 */
interface TestConfig {
  pools: Array<{
    id: string;
    command: string;
    args: string[];
    instances: number;
  }>;
  limits: {
    max_input_buffer: number;
    max_output_queue: number;
    drain_timeout_sec: number;
  };
}

/**
 * Helper class to manage stdio Bus kernel daemon and TCP client for testing.
 */
class NDJSONClientTestHarness {
  private stdioBusProcess: ChildProcess | null = null;
  private configPath: string | null = null;
  private tcpPort: number = 0;
  private isReady: boolean = false;
  private projectRoot: string;

  constructor() {
    this.projectRoot = path.resolve(__dirname, '../../..');
  }

  /**
   * Find an available TCP port.
   */
  private async findAvailablePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (address && typeof address === 'object') {
          const port = address.port;
          server.close(() => resolve(port));
        } else {
          reject(new Error('Failed to get server address'));
        }
      });
      server.on('error', reject);
    });
  }

  /**
   * Create a temporary config file for stdio Bus kernel.
   */
  private async createConfig(): Promise<string> {
    // Use relative path from project root since stdio Bus kernel will run from there
    const config: TestConfig = {
      pools: [
        {
          id: 'echo',
          command: '/usr/bin/env',
          args: ['node', './examples/echo-worker/echo-worker.js'],
          instances: 1,
        },
      ],
      limits: {
        max_input_buffer: 65536,
        max_output_queue: 1048576, // 1MB to handle response messages
        drain_timeout_sec: 5,
      },
    };

    const configPath = path.join(os.tmpdir(), `stdio-bus-test-config-${Date.now()}.json`);
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    return configPath;
  }

  /**
   * Start the stdio Bus kernel daemon with TCP listener.
   */
  async start(): Promise<void> {
    // Find available port
    this.tcpPort = await this.findAvailablePort();

    // Create config file
    this.configPath = await this.createConfig();

    // Find stdio Bus kernel binary
    const stdioBusBinaryPath = path.join(this.projectRoot, 'build/stdio_bus');

    if (!fs.existsSync(stdioBusBinaryPath)) {
      throw new Error(
        `stdio Bus kernel binary not found at ${stdioBusBinaryPath}. ` +
        'Please build stdio Bus kernel first with: make',
      );
    }

    // Start stdio Bus kernel daemon from the project root directory
    this.stdioBusProcess = spawn(stdioBusBinaryPath, [
      '--config', this.configPath,
      '--tcp', `127.0.0.1:${this.tcpPort}`,
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: this.projectRoot,
    });

    // Log stderr for debugging (uncomment if needed)
    // this.stdioBusProcess.stderr?.on('data', (data) => {
    //     console.error(`[stdio Bus kernel] ${data.toString().trim()}`);
    // });

    this.stdioBusProcess.on('error', (err) => {
      console.error(`[stdio Bus kernel] Process error: ${err.message}`);
    });

    this.stdioBusProcess.on('exit', (code, signal) => {
      if (code !== 0 && code !== null && this.isReady) {
        console.error(`[stdio Bus kernel] Process exited unexpectedly with code ${code}, signal ${signal}`);
      }
    });

    // Wait for stdio Bus kernel to be ready by attempting to connect
    await this.waitForReady();
  }

  /**
   * Wait for stdio Bus kernel to be ready to accept connections.
   */
  private async waitForReady(maxAttempts: number = 50, delayMs: number = 100): Promise<void> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        await this.testConnection();
        this.isReady = true;
        return;
      } catch {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
    throw new Error(`stdio Bus kernel failed to become ready after ${maxAttempts} attempts`);
  }

  /**
   * Test if stdio Bus kernel is accepting connections.
   */
  private async testConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({
        host: '127.0.0.1',
        port: this.tcpPort,
      });

      socket.on('connect', () => {
        socket.destroy();
        resolve();
      });

      socket.on('error', (err) => {
        socket.destroy();
        reject(err);
      });

      setTimeout(() => {
        socket.destroy();
        reject(new Error('Connection timeout'));
      }, 500);
    });
  }

  /**
   * Send a JSON-RPC request via TCP and wait for response.
   * This simulates the NDJSON client behavior.
   */
  async sendRequest(request: JsonRpcRequest, timeoutMs: number = 5000): Promise<JsonRpcResponse> {
    if (!this.isReady) {
      throw new Error('stdio Bus kernel is not ready');
    }

    return new Promise((resolve, reject) => {
      const socket = net.createConnection({
        host: '127.0.0.1',
        port: this.tcpPort,
      });

      let buffer = '';
      let resolved = false;

      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          socket.destroy();
          reject(new Error(`Timeout waiting for response to request ${request.id}`));
        }
      }, timeoutMs);

      socket.on('connect', () => {
        // Send request as NDJSON
        const message = JSON.stringify(request) + '\n';
        socket.write(message);
      });

      socket.on('data', (data) => {
        buffer += data.toString();

        // Process complete NDJSON lines
        let newlineIndex;
        while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);

          if (line.trim()) {
            try {
              const response = JSON.parse(line) as JsonRpcResponse;
              if (response.id === request.id) {
                if (!resolved) {
                  resolved = true;
                  clearTimeout(timeout);
                  socket.destroy();
                  resolve(response);
                }
              }
            } catch {
              // Ignore parse errors, continue waiting
            }
          }
        }
      });

      socket.on('error', (err) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          reject(err);
        }
      });

      socket.on('close', () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          reject(new Error('Connection closed before receiving response'));
        }
      });
    });
  }

  /**
   * Stop the stdio Bus kernel daemon and clean up.
   */
  async stop(): Promise<void> {
    this.isReady = false;

    if (this.stdioBusProcess) {
      const process = this.stdioBusProcess;
      this.stdioBusProcess = null;

      // Send SIGTERM and wait for exit
      process.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        const exitHandler = () => {
          process.removeAllListeners();
          resolve();
        };
        process.on('exit', exitHandler);
        process.on('error', exitHandler);
        // Fallback timeout in case process doesn't exit cleanly
        setTimeout(() => {
          process.removeAllListeners();
          try {
            process.kill('SIGKILL');
          } catch {
            // Process may already be dead
          }
          resolve();
        }, 2000);
      });
    }

    // Clean up config file
    if (this.configPath && fs.existsSync(this.configPath)) {
      try {
        fs.unlinkSync(this.configPath);
      } catch {
        // Ignore cleanup errors
      }
      this.configPath = null;
    }
  }
}

describe('NDJSON Client Request-Response Round-Trip', () => {
  let harness: NDJSONClientTestHarness;

  beforeAll(async () => {
    harness = new NDJSONClientTestHarness();
    await harness.start();
  }, 30000); // 30 second timeout for startup

  afterAll(async () => {
    await harness.stop();
  }, 10000);

  /**
   * Feature: reference-implementation-docs, Property 4: NDJSON Client Request-Response Round-Trip
   *
   * *For any* NDJSON client connection to stdio Bus kernel (via TCP or Unix socket) with a
   * configurable `id` and `sessionId`, sending a request SHALL result in receiving
   * a corresponding response with the same `id`.
   *
   */
  it('should receive response with same id for any request sent via TCP', async () => {
    // Arbitrary for generating request id and sessionId
    // Use alphanumeric strings to avoid JSON escaping issues
    const requestArb = fc.record({
      id: fc.stringMatching(/^[a-zA-Z0-9_-]{1,50}$/),
      sessionId: fc.stringMatching(/^[a-zA-Z0-9_-]{1,50}$/),
    });

    let iterationCount = 0;

    await fc.assert(
      fc.asyncProperty(requestArb, async ({ id, sessionId }) => {
        iterationCount++;
        const request: JsonRpcRequest = {
          jsonrpc: '2.0',
          id,
          sessionId,
          method: 'test',
        };

        const response = await harness.sendRequest(request);

        // Verify response has the same id as the request
        return response.id === id;
      }),
      {
        numRuns: 100,
        verbose: true,
      },
    );

    // Verify we actually ran 100 iterations
    expect(iterationCount).toBe(100);
  }, 120000); // 120 second timeout for property test

  /**
   * Additional unit test to verify basic round-trip functionality.
   *
   */
  it('should receive response with matching id for a simple request', async () => {
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 'simple-test-1',
      method: 'echo',
      sessionId: 'test-session',
    };

    const response = await harness.sendRequest(request);

    expect(response.id).toBe(request.id);
    expect(response).toHaveProperty('result');
  }, 10000);

  /**
   * Verify sessionId is preserved in round-trip through stdio Bus kernel.
   *
   */
  it('should preserve sessionId in response through stdio Bus kernel', async () => {
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 'session-roundtrip-test',
      method: 'test',
      sessionId: 'my-session-123',
    };

    const response = await harness.sendRequest(request);

    expect(response.sessionId).toBe(request.sessionId);
  }, 10000);

  /**
   * Verify multiple sequential requests work correctly.
   *
   */
  it('should handle multiple sequential requests correctly', async () => {
    const requests: JsonRpcRequest[] = [
      { jsonrpc: '2.0', id: 'seq-1', method: 'test', sessionId: 'seq-session' },
      { jsonrpc: '2.0', id: 'seq-2', method: 'test', sessionId: 'seq-session' },
      { jsonrpc: '2.0', id: 'seq-3', method: 'test', sessionId: 'seq-session' },
    ];

    for (const request of requests) {
      const response = await harness.sendRequest(request);
      expect(response.id).toBe(request.id);
    }
  }, 30000);

  /**
   * Verify requests with special characters in id work correctly.
   *
   */
  it('should handle request ids with special characters', async () => {
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 'special-id_with.chars:123',
      method: 'test',
      sessionId: 'special-session',
    };

    const response = await harness.sendRequest(request);

    expect(response.id).toBe(request.id);
  }, 10000);
});
