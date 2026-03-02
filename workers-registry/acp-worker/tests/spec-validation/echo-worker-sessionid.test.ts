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
 * Property tests for Echo Worker SessionId Preservation.
 *
 * Feature: reference-implementation-docs, Property 3: Echo Worker SessionId Preservation
 *
 *
 * This test verifies that the echo worker correctly preserves sessionId
 * in responses when present in requests, enabling session-based routing.
 *
 * @module spec-validation/echo-worker-sessionid.test
 */
import * as fc from 'fast-check';
import { ChildProcess, spawn } from 'child_process';
import * as path from 'path';
import * as readline from 'readline';

/**
 * Interface for JSON-RPC 2.0 request messages with sessionId.
 */
interface JsonRpcRequestWithSession {
  jsonrpc: '2.0';
  id: string;
  method: string;
  sessionId: string;
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
  async sendRequest(request: JsonRpcRequestWithSession, timeoutMs: number = 5000): Promise<JsonRpcResponse> {
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

describe('Echo Worker SessionId Preservation', () => {
  let harness: EchoWorkerTestHarness;

  beforeAll(async () => {
    harness = new EchoWorkerTestHarness();
    await harness.start();
  });

  afterAll(async () => {
    await harness.stop();
  });

  /**
   * Feature: reference-implementation-docs, Property 3: Echo Worker SessionId Preservation
   *
   * *For any* JSON-RPC request containing a `sessionId` field, the echo worker's
   * response SHALL include the same `sessionId` value.
   *
   */
  it('should preserve sessionId in response for any request with sessionId', async () => {
    // Arbitrary for generating valid JSON-RPC request objects with sessionId
    const jsonRpcRequestWithSessionArb = fc.record({
      jsonrpc: fc.constant('2.0' as const),
      id: fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
      method: fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
      sessionId: fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
    });

    await fc.assert(
      fc.asyncProperty(jsonRpcRequestWithSessionArb, async (request) => {
        const response = await harness.sendRequest(request as JsonRpcRequestWithSession);

        // Verify response has the same sessionId as the request
        return response.sessionId === request.sessionId;
      }),
      {
        numRuns: 100,
        verbose: true,
      },
    );
  }, 60000); // 60 second timeout for property test

  /**
   * Additional unit test to verify sessionId preservation with specific values.
   *
   */
  it('should preserve a specific sessionId correctly', async () => {
    const request: JsonRpcRequestWithSession = {
      jsonrpc: '2.0',
      id: 'session-test-1',
      method: 'echo',
      sessionId: 'test-session-abc-123',
    };

    const response = await harness.sendRequest(request);

    expect(response.sessionId).toBe(request.sessionId);
  });

  /**
   * Verify sessionId preservation with UUID-like values.
   *
   */
  it('should preserve UUID-like sessionId values', async () => {
    const request: JsonRpcRequestWithSession = {
      jsonrpc: '2.0',
      id: 'uuid-session-test',
      method: 'test',
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
    };

    const response = await harness.sendRequest(request);

    expect(response.sessionId).toBe('550e8400-e29b-41d4-a716-446655440000');
  });

  /**
   * Verify sessionId preservation with special characters.
   *
   */
  it('should preserve sessionId with special characters', async () => {
    const request: JsonRpcRequestWithSession = {
      jsonrpc: '2.0',
      id: 'special-char-test',
      method: 'test',
      sessionId: 'session_with-special.chars:123',
    };

    const response = await harness.sendRequest(request);

    expect(response.sessionId).toBe('session_with-special.chars:123');
  });
});
