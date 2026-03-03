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
 * Unit Tests for Test Utilities
 *
 * Verifies that the test utilities work correctly for testing
 * registry launcher components.
 *
 * @module registry-launcher/test-utils/index.test
 */

import {
  createDeferred,
  createMockAgent,
  createMockAgentProcess,
  createMockBinaryAgent,
  createMockFetch,
  createMockNpxAgent,
  createMockRegistry,
  createMockUvxAgent,
  createTestNDJSONStream,
  delay,
} from './index.js';
import { NDJSONHandler } from '../stream/ndjson-handler.js';

describe('Test Utilities', () => {
  describe('createMockRegistry', () => {
    it('should create a registry with default values for missing fields', () => {
      const registry = createMockRegistry([
        { id: 'agent-1' },
        { id: 'agent-2', name: 'Custom Name' },
      ]);

      expect(registry.version).toBe('1.0.0');
      expect(registry.agents).toHaveLength(2);
      expect(registry.agents[0].id).toBe('agent-1');
      expect(registry.agents[0].name).toBe('Mock Agent 0');
      expect(registry.agents[0].distribution.type).toBe('npx');
      expect(registry.agents[1].id).toBe('agent-2');
      expect(registry.agents[1].name).toBe('Custom Name');
    });

    it('should create an empty registry', () => {
      const registry = createMockRegistry([]);

      expect(registry.version).toBe('1.0.0');
      expect(registry.agents).toHaveLength(0);
    });

    it('should preserve custom distribution', () => {
      const registry = createMockRegistry([
        {
          id: 'binary-agent',
          distribution: {
            type: 'binary',
            platforms: { 'linux-x64': '/path/to/binary' },
          },
        },
      ]);

      expect(registry.agents[0].distribution.type).toBe('binary');
    });

    it('should generate default IDs when not provided', () => {
      const registry = createMockRegistry([{}, {}, {}]);

      expect(registry.agents[0].id).toBe('mock-agent-0');
      expect(registry.agents[1].id).toBe('mock-agent-1');
      expect(registry.agents[2].id).toBe('mock-agent-2');
    });
  });

  describe('createMockAgent', () => {
    it('should create an agent with specified distribution', () => {
      const agent = createMockAgent('test-agent', {
        type: 'uvx',
        package: 'my-package',
        version: '2.0.0',
      });

      expect(agent.id).toBe('test-agent');
      expect(agent.name).toBe('Agent test-agent');
      expect(agent.distribution.type).toBe('uvx');
    });

    it('should apply overrides', () => {
      const agent = createMockAgent(
        'test-agent',
        { type: 'npx', package: 'pkg' },
        { name: 'Custom Name', description: 'A description', args: ['--flag'] },
      );

      expect(agent.name).toBe('Custom Name');
      expect(agent.description).toBe('A description');
      expect(agent.args).toEqual(['--flag']);
    });
  });

  describe('createMockBinaryAgent', () => {
    it('should create an agent with binary distribution', () => {
      const agent = createMockBinaryAgent('binary-agent', {
        'linux-x64': '/usr/bin/agent',
        'darwin-arm64': '/opt/agent',
      });

      expect(agent.id).toBe('binary-agent');
      expect(agent.distribution.type).toBe('binary');
      if (agent.distribution.type === 'binary') {
        expect(agent.distribution.platforms['linux-x64']).toBe('/usr/bin/agent');
        expect(agent.distribution.platforms['darwin-arm64']).toBe('/opt/agent');
      }
    });
  });

  describe('createMockNpxAgent', () => {
    it('should create an agent with npx distribution', () => {
      const agent = createMockNpxAgent('npx-agent', '@scope/package', '1.2.3');

      expect(agent.id).toBe('npx-agent');
      expect(agent.distribution.type).toBe('npx');
      if (agent.distribution.type === 'npx') {
        expect(agent.distribution.package).toBe('@scope/package');
        expect(agent.distribution.version).toBe('1.2.3');
      }
    });

    it('should create an agent without version', () => {
      const agent = createMockNpxAgent('npx-agent', 'simple-package');

      expect(agent.distribution.type).toBe('npx');
      if (agent.distribution.type === 'npx') {
        expect(agent.distribution.package).toBe('simple-package');
        expect(agent.distribution.version).toBeUndefined();
      }
    });
  });

  describe('createMockUvxAgent', () => {
    it('should create an agent with uvx distribution', () => {
      const agent = createMockUvxAgent('uvx-agent', 'python-package', '3.0.0');

      expect(agent.id).toBe('uvx-agent');
      expect(agent.distribution.type).toBe('uvx');
      if (agent.distribution.type === 'uvx') {
        expect(agent.distribution.package).toBe('python-package');
        expect(agent.distribution.version).toBe('3.0.0');
      }
    });
  });

  describe('createMockAgentProcess', () => {
    it('should create a mock process with streams', () => {
      const mockProcess = createMockAgentProcess();

      expect(mockProcess.stdin).toBeDefined();
      expect(mockProcess.stdout).toBeDefined();
      expect(mockProcess.stderr).toBeDefined();
      expect(mockProcess.pid).toBeGreaterThan(0);
      expect(mockProcess.killed).toBe(false);
      expect(mockProcess.exitCode).toBeNull();
    });

    it('should use provided PID', () => {
      const mockProcess = createMockAgentProcess(12345);

      expect(mockProcess.pid).toBe(12345);
    });

    it('should capture stdin writes', () => {
      const mockProcess = createMockAgentProcess();

      mockProcess.stdin.write('message 1\n');
      mockProcess.stdin.write('message 2\n');

      const writes = mockProcess.getStdinWrites();
      expect(writes).toEqual(['message 1\n', 'message 2\n']);
    });

    it('should emit spawn event', (done) => {
      const mockProcess = createMockAgentProcess();

      mockProcess.on('spawn', () => {
        done();
      });

      mockProcess.simulateSpawn();
    });

    it('should emit exit event with code', (done) => {
      const mockProcess = createMockAgentProcess();

      mockProcess.on('exit', (code, signal) => {
        expect(code).toBe(42);
        expect(signal).toBeNull();
        expect(mockProcess.exitCode).toBe(42);
        expect(mockProcess.killed).toBe(true);
        done();
      });

      mockProcess.simulateExit(42);
    });

    it('should emit exit event with signal', (done) => {
      const mockProcess = createMockAgentProcess();

      mockProcess.on('exit', (code, signal) => {
        expect(code).toBe(0);
        expect(signal).toBe('SIGTERM');
        done();
      });

      mockProcess.simulateExit(0, 'SIGTERM');
    });

    it('should emit error event', (done) => {
      const mockProcess = createMockAgentProcess();
      const testError = new Error('spawn failed');

      mockProcess.on('error', (error) => {
        expect(error).toBe(testError);
        done();
      });

      mockProcess.simulateError(testError);
    });

    it('should write to stdout', (done) => {
      const mockProcess = createMockAgentProcess();
      const chunks: string[] = [];

      mockProcess.stdout.on('data', (chunk) => {
        chunks.push(chunk);
        if (chunks.length === 2) {
          expect(chunks).toEqual(['output 1\n', 'output 2\n']);
          done();
        }
      });

      mockProcess.writeToStdout('output 1\n');
      mockProcess.writeToStdout('output 2\n');
    });

    it('should write to stderr', (done) => {
      const mockProcess = createMockAgentProcess();

      mockProcess.stderr.on('data', (chunk) => {
        expect(chunk).toBe('error message\n');
        done();
      });

      mockProcess.writeToStderr('error message\n');
    });

    it('should handle kill signal', (done) => {
      const mockProcess = createMockAgentProcess();

      mockProcess.on('exit', (code, signal) => {
        expect(code).toBeNull();
        expect(signal).toBe('SIGTERM');
        expect(mockProcess.killed).toBe(true);
        done();
      });

      const result = mockProcess.kill('SIGTERM');
      expect(result).toBe(true);
    });

    it('should return false when killing already killed process', (done) => {
      const mockProcess = createMockAgentProcess();

      mockProcess.on('exit', () => {
        const result = mockProcess.kill();
        expect(result).toBe(false);
        done();
      });

      mockProcess.kill();
    });

    it('should mark stdin as destroyed after exit', () => {
      const mockProcess = createMockAgentProcess();

      expect(mockProcess.stdin.destroyed).toBe(false);

      mockProcess.simulateExit(0);

      expect(mockProcess.stdin.destroyed).toBe(true);
    });

    it('should mark stdin as destroyed after end()', () => {
      const mockProcess = createMockAgentProcess();

      expect(mockProcess.stdin.destroyed).toBe(false);

      mockProcess.stdin.end();

      expect(mockProcess.stdin.destroyed).toBe(true);
    });
  });

  describe('createTestNDJSONStream', () => {
    it('should create connected input/output streams', () => {
      const { input, output } = createTestNDJSONStream();

      expect(input).toBeDefined();
      expect(output).toBeDefined();
    });

    it('should write messages to input', () => {
      const { input, writeMessage } = createTestNDJSONStream();
      const chunks: string[] = [];

      input.on('data', (chunk) => chunks.push(chunk.toString()));

      writeMessage({ test: 'message' });

      expect(chunks).toEqual(['{"test":"message"}\n']);
    });

    it('should capture output messages', () => {
      const { output, getOutputMessages } = createTestNDJSONStream();

      output.write('{"a":1}\n');
      output.write('{"b":2}\n');

      const messages = getOutputMessages();
      expect(messages).toEqual([{ a: 1 }, { b: 2 }]);
    });

    it('should get raw output', () => {
      const { output, getRawOutput } = createTestNDJSONStream();

      output.write('line 1\n');
      output.write('line 2\n');

      expect(getRawOutput()).toBe('line 1\nline 2\n');
    });

    it('should work with NDJSONHandler', () => {
      const { input, output, getOutputMessages } = createTestNDJSONStream();
      const handler = new NDJSONHandler(output);
      const received: object[] = [];

      handler.onMessage((msg) => received.push(msg));

      // Process input through handler
      input.on('data', (chunk) => handler.processChunk(Buffer.from(chunk)));

      // Write a message
      input.write('{"jsonrpc":"2.0","method":"test","id":1}\n');

      // Verify handler received it
      expect(received).toEqual([{ jsonrpc: '2.0', method: 'test', id: 1 }]);

      // Write response through handler
      handler.write({ jsonrpc: '2.0', result: {}, id: 1 });

      // Verify output captured it
      expect(getOutputMessages()).toEqual([{ jsonrpc: '2.0', result: {}, id: 1 }]);
    });

    it('should skip malformed lines in getOutputMessages', () => {
      const { output, getOutputMessages } = createTestNDJSONStream();

      output.write('{"valid":true}\n');
      output.write('not json\n');
      output.write('{"also":"valid"}\n');

      const messages = getOutputMessages();
      expect(messages).toEqual([{ valid: true }, { also: 'valid' }]);
    });
  });

  describe('createMockFetch', () => {
    it('should return JSON response', async () => {
      const mockFetch = createMockFetch({ data: 'test' });

      const response = await mockFetch('https://example.com/api');

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json).toEqual({ data: 'test' });
    });

    it('should return string response', async () => {
      const mockFetch = createMockFetch('raw string');

      const response = await mockFetch('https://example.com/api');
      const text = await response.text();

      expect(text).toBe('raw string');
    });

    it('should return custom status code', async () => {
      const mockFetch = createMockFetch({ error: 'not found' }, { status: 404 });

      const response = await mockFetch('https://example.com/api');

      expect(response.status).toBe(404);
    });

    it('should simulate network error', async () => {
      const mockFetch = createMockFetch(null, {
        networkError: true,
        errorMessage: 'Connection refused',
      });

      await expect(mockFetch('https://example.com/api')).rejects.toThrow('Connection refused');
    });

    it('should use default error message for network error', async () => {
      const mockFetch = createMockFetch(null, { networkError: true });

      await expect(mockFetch('https://example.com/api')).rejects.toThrow('Network error');
    });
  });

  describe('delay', () => {
    it('should wait for specified time', async () => {
      const start = Date.now();

      await delay(50);

      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(45); // Allow some tolerance
      expect(elapsed).toBeLessThan(500); // Allow more tolerance for CI environments
    });
  });

  describe('createDeferred', () => {
    it('should create a resolvable promise', async () => {
      const { promise, resolve } = createDeferred<string>();

      setTimeout(() => resolve('result'), 10);

      const result = await promise;
      expect(result).toBe('result');
    });

    it('should create a rejectable promise', async () => {
      const { promise, reject } = createDeferred<string>();

      setTimeout(() => reject(new Error('test error')), 10);

      await expect(promise).rejects.toThrow('test error');
    });
  });
});
