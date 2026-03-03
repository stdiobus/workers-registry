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
 * Property tests for Echo Worker NDJSON Round-Trip.
 *
 * Feature: reference-implementation-docs, Property 2: Echo Worker NDJSON Round-Trip
 *
 *
 * This test verifies that the echo worker correctly handles JSON-RPC requests
 * by producing responses with the same id and a result field.
 *
 * @module spec-validation/echo-worker-roundtrip.test
 */
import * as fc from 'fast-check';
import { ChildProcess, spawn } from 'child_process';
import * as path from 'path';
import * as readline from 'readline';

/**
 * Interface for JSON-RPC 2.0 request messages.
 */
interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string;
  method: string;
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
 * Helper class to manage echo worker process for testing.
 */
class EchoWorkerTestHarness {
  private process: ChildProcess | null = null;
  private responseQueue: Map<string, (response: JsonRpcResponse) => void> = new Map();
  private rl: readline.Interface | null = null;

  /**
   * Start the echo worker process.
   */
  async start(): Promise<void> {
    const echoWorkerPath = path.resolve(__dirname, '../../../examples/echo-worker/echo-worker.js');

    this.process = spawn('node', [echoWorkerPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (!this.process.stdout) {
      throw new Error('Failed to get stdout from echo worker process');
    }

    this.rl = readline.createInterface({
      input: this.process.stdout,
      terminal: false,
    });

    this.rl.on('line', (line: string) => {
      try {
        const response = JSON.parse(line) as JsonRpcResponse;
        if (response.id !== undefined) {
          const resolver = this.responseQueue.get(response.id);
          if (resolver) {
            resolver(response);
            this.responseQueue.delete(response.id);
          }
        }
      } catch {
        // Ignore non-JSON lines (shouldn't happen with echo worker)
      }
    });

    // Wait a bit for the process to start
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  /**
   * Send a JSON-RPC request to the echo worker and wait for response.
   */
  async sendRequest(request: JsonRpcRequest, timeoutMs: number = 5000): Promise<JsonRpcResponse> {
    if (!this.process || !this.process.stdin) {
      throw new Error('Echo worker process not started');
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.responseQueue.delete(request.id);
        reject(new Error(`Timeout waiting for response to request ${request.id}`));
      }, timeoutMs);

      this.responseQueue.set(request.id, (response) => {
        clearTimeout(timeout);
        resolve(response);
      });

      const message = JSON.stringify(request) + '\n';
      this.process!.stdin!.write(message);
    });
  }

  /**
   * Stop the echo worker process.
   */
  async stop(): Promise<void> {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }

    if (this.process) {
      this.process.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        this.process!.on('exit', () => resolve());
        // Fallback timeout in case process doesn't exit cleanly
        setTimeout(resolve, 1000);
      });
      this.process = null;
    }

    this.responseQueue.clear();
  }
}

describe('Echo Worker NDJSON Round-Trip', () => {
  let harness: EchoWorkerTestHarness;

  beforeAll(async () => {
    harness = new EchoWorkerTestHarness();
    await harness.start();
  });

  afterAll(async () => {
    await harness.stop();
  });

  /**
   * Feature: reference-implementation-docs, Property 2: Echo Worker NDJSON Round-Trip
   *
   * *For any* valid JSON-RPC request message with an `id` and `method` field
   * sent to the echo worker's stdin, the worker SHALL produce a valid JSON-RPC
   * response on stdout containing the same `id` and a `result` field.
   *
   */
  it('should produce response with same id and result field for any valid JSON-RPC request', async () => {
    // Arbitrary for generating valid JSON-RPC request objects
    const jsonRpcRequestArb = fc.record({
      jsonrpc: fc.constant('2.0' as const),
      id: fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
      method: fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
      params: fc.option(
        fc.dictionary(
          fc.string({ minLength: 1, maxLength: 50 }),
          fc.oneof(
            fc.string(),
            fc.integer(),
            fc.boolean(),
            fc.constant(null),
          ),
        ),
        { nil: undefined },
      ),
    });

    await fc.assert(
      fc.asyncProperty(jsonRpcRequestArb, async (request) => {
        const response = await harness.sendRequest(request as JsonRpcRequest);

        // Verify response has the same id as the request
        const sameId = response.id === request.id;

        // Verify response has a result field (not an error)
        const hasResult = 'result' in response;

        return sameId && hasResult;
      }),
      {
        numRuns: 100,
        verbose: true,
      },
    );
  }, 60000); // 60 second timeout for property test

  /**
   * Additional unit test to verify basic echo worker functionality.
   *
   */
  it('should echo back a simple request correctly', async () => {
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 'test-1',
      method: 'echo',
      params: { message: 'hello' },
    };

    const response = await harness.sendRequest(request);

    expect(response.id).toBe(request.id);
    expect(response).toHaveProperty('result');
    expect(response.result).toHaveProperty('echo');
    expect(response.result).toHaveProperty('method', 'echo');
  });

  /**
   * Verify response contains jsonrpc version field.
   *
   */
  it('should include jsonrpc version in response', async () => {
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 'version-test',
      method: 'test',
    };

    const response = await harness.sendRequest(request);

    expect(response.jsonrpc).toBe('2.0');
  });
});
