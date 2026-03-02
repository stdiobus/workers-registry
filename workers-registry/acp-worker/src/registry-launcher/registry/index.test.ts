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
 * Unit Tests for Registry Index Module
 *
 * Tests for fetch mocking, error handling, and lookup edge cases.
 *
 * @module registry-launcher/registry/index.test
 */
import { AgentNotFoundError, parseRegistry, RegistryFetchError, RegistryIndex, RegistryParseError } from './index.js';
import type { Registry, RegistryAgent } from './types.js';

// Store original fetch and env
const originalFetch = global.fetch;
const originalEnv = process.env;

/**
 * Create a mock fetch function that returns the given response.
 */
function createMockFetch(response: {
  ok: boolean;
  status?: number;
  statusText?: string;
  text?: () => Promise<string>;
  textError?: Error;
}): typeof fetch {
  return jest.fn().mockImplementation(() => {
    if (response.textError) {
      return Promise.resolve({
        ok: response.ok,
        status: response.status ?? 200,
        statusText: response.statusText ?? 'OK',
        text: () => Promise.reject(response.textError),
      });
    }
    return Promise.resolve({
      ok: response.ok,
      status: response.status ?? 200,
      statusText: response.statusText ?? 'OK',
      text: response.text ?? (() => Promise.resolve('{}')),
    });
  });
}

/**
 * Create a mock fetch that throws a network error.
 */
function createNetworkErrorFetch(error: Error): typeof fetch {
  return jest.fn().mockImplementation(() => Promise.reject(error));
}

/**
 * Create a valid registry JSON string.
 */
function createValidRegistryJson(agents: Partial<RegistryAgent>[] = []): string {
  const registry: Registry = {
    version: '1.0.0',
    agents: agents.map((a, i) => ({
      id: a.id ?? `agent-${i}`,
      name: a.name ?? `Agent ${i}`,
      distribution: a.distribution ?? { type: 'npx', package: `package-${i}` },
      ...a,
    })) as RegistryAgent[],
  };
  return JSON.stringify(registry);
}

describe('RegistryIndex', () => {
  beforeEach(() => {
    // Reset environment variables
    process.env = { ...originalEnv };
    delete process.env.ACP_REGISTRY_URL;
    // Suppress console.error during tests
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    // Restore original fetch and env
    global.fetch = originalFetch;
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should use provided registry URL', () => {
      const registryUrl = 'https://example.com/registry.json';
      const index = new RegistryIndex(registryUrl);

      // We can't directly access private registryUrl, but we can verify behavior
      // by mocking fetch and checking the URL it's called with
      const mockFetch = createMockFetch({
        ok: true,
        text: () => Promise.resolve(createValidRegistryJson()),
      });
      global.fetch = mockFetch;

      index.fetch();

      expect(mockFetch).toHaveBeenCalledWith(registryUrl);
    });

    it('should override registry URL with ACP_REGISTRY_URL environment variable', () => {
      const configUrl = 'https://config.example.com/registry.json';
      const envUrl = 'https://env.example.com/registry.json';
      process.env.ACP_REGISTRY_URL = envUrl;

      const index = new RegistryIndex(configUrl);

      const mockFetch = createMockFetch({
        ok: true,
        text: () => Promise.resolve(createValidRegistryJson()),
      });
      global.fetch = mockFetch;

      index.fetch();

      expect(mockFetch).toHaveBeenCalledWith(envUrl);
    });

    it('should ignore empty ACP_REGISTRY_URL environment variable', () => {
      const configUrl = 'https://config.example.com/registry.json';
      process.env.ACP_REGISTRY_URL = '';

      const index = new RegistryIndex(configUrl);

      const mockFetch = createMockFetch({
        ok: true,
        text: () => Promise.resolve(createValidRegistryJson()),
      });
      global.fetch = mockFetch;

      index.fetch();

      expect(mockFetch).toHaveBeenCalledWith(configUrl);
    });
  });

  describe('fetch - successful scenarios', () => {
    /**
     * Fetch and parse registry
     */
    it('should successfully fetch and parse valid registry', async () => {
      const agents = [
        { id: 'agent-1', name: 'Agent One', distribution: { type: 'npx' as const, package: 'pkg-1' } },
        { id: 'agent-2', name: 'Agent Two', distribution: { type: 'uvx' as const, package: 'pkg-2' } },
      ];

      global.fetch = createMockFetch({
        ok: true,
        text: () => Promise.resolve(createValidRegistryJson(agents)),
      });

      const index = new RegistryIndex('https://example.com/registry.json');
      await index.fetch();

      expect(index.lookup('agent-1')).toBeDefined();
      expect(index.lookup('agent-1')?.name).toBe('Agent One');
      expect(index.lookup('agent-2')).toBeDefined();
      expect(index.lookup('agent-2')?.name).toBe('Agent Two');
    });

    it('should handle empty agents array', async () => {
      global.fetch = createMockFetch({
        ok: true,
        text: () => Promise.resolve(createValidRegistryJson([])),
      });

      const index = new RegistryIndex('https://example.com/registry.json');
      await index.fetch();

      expect(index.getRegistry()?.agents).toHaveLength(0);
    });

    it('should handle registry with many agents', async () => {
      const agents = Array.from({ length: 100 }, (_, i) => ({
        id: `agent-${i}`,
        name: `Agent ${i}`,
        distribution: { type: 'npx' as const, package: `pkg-${i}` },
      }));

      global.fetch = createMockFetch({
        ok: true,
        text: () => Promise.resolve(createValidRegistryJson(agents)),
      });

      const index = new RegistryIndex('https://example.com/registry.json');
      await index.fetch();

      expect(index.getRegistry()?.agents).toHaveLength(100);
      expect(index.lookup('agent-50')).toBeDefined();
    });
  });

  describe('fetch - HTTP error handling', () => {
    /**
     * Log error and exit on fetch failure
     */
    it('should throw RegistryFetchError on HTTP 404', async () => {
      global.fetch = createMockFetch({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      const index = new RegistryIndex('https://example.com/registry.json');

      await expect(index.fetch()).rejects.toThrow(RegistryFetchError);
      await expect(index.fetch()).rejects.toThrow('HTTP 404');
    });

    it('should throw RegistryFetchError on HTTP 500', async () => {
      global.fetch = createMockFetch({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const index = new RegistryIndex('https://example.com/registry.json');

      await expect(index.fetch()).rejects.toThrow(RegistryFetchError);
      await expect(index.fetch()).rejects.toThrow('HTTP 500');
    });

    it('should throw RegistryFetchError on HTTP 403', async () => {
      global.fetch = createMockFetch({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
      });

      const index = new RegistryIndex('https://example.com/registry.json');

      await expect(index.fetch()).rejects.toThrow(RegistryFetchError);
      await expect(index.fetch()).rejects.toThrow('HTTP 403');
    });

    it('should include status text in error message', async () => {
      global.fetch = createMockFetch({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
      });

      const index = new RegistryIndex('https://example.com/registry.json');

      await expect(index.fetch()).rejects.toThrow('Service Unavailable');
    });
  });

  describe('fetch - network error handling', () => {
    /**
     * Log error and exit on fetch failure
     */
    it('should throw RegistryFetchError on network error', async () => {
      global.fetch = createNetworkErrorFetch(new Error('Network request failed'));

      const index = new RegistryIndex('https://example.com/registry.json');

      await expect(index.fetch()).rejects.toThrow(RegistryFetchError);
      await expect(index.fetch()).rejects.toThrow('Network request failed');
    });

    it('should throw RegistryFetchError on DNS resolution failure', async () => {
      global.fetch = createNetworkErrorFetch(new Error('getaddrinfo ENOTFOUND example.com'));

      const index = new RegistryIndex('https://example.com/registry.json');

      await expect(index.fetch()).rejects.toThrow(RegistryFetchError);
      await expect(index.fetch()).rejects.toThrow('ENOTFOUND');
    });

    it('should throw RegistryFetchError on connection timeout', async () => {
      global.fetch = createNetworkErrorFetch(new Error('Connection timed out'));

      const index = new RegistryIndex('https://example.com/registry.json');

      await expect(index.fetch()).rejects.toThrow(RegistryFetchError);
      await expect(index.fetch()).rejects.toThrow('timed out');
    });

    it('should throw RegistryFetchError when response body read fails', async () => {
      global.fetch = createMockFetch({
        ok: true,
        textError: new Error('Body read failed'),
      });

      const index = new RegistryIndex('https://example.com/registry.json');

      await expect(index.fetch()).rejects.toThrow(RegistryFetchError);
      await expect(index.fetch()).rejects.toThrow('Body read failed');
    });

    it('should preserve original error as cause', async () => {
      const originalError = new Error('Original network error');
      global.fetch = createNetworkErrorFetch(originalError);

      const index = new RegistryIndex('https://example.com/registry.json');

      try {
        await index.fetch();
        fail('Expected RegistryFetchError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(RegistryFetchError);
        expect((error as RegistryFetchError).cause).toBe(originalError);
      }
    });
  });

  describe('fetch - parse error handling', () => {
    /**
     * Log descriptive parse error on malformed JSON
     */
    it('should throw RegistryParseError on invalid JSON', async () => {
      global.fetch = createMockFetch({
        ok: true,
        text: () => Promise.resolve('{ invalid json }'),
      });

      const index = new RegistryIndex('https://example.com/registry.json');

      await expect(index.fetch()).rejects.toThrow(RegistryParseError);
    });

    it('should throw RegistryParseError on empty response', async () => {
      global.fetch = createMockFetch({
        ok: true,
        text: () => Promise.resolve(''),
      });

      const index = new RegistryIndex('https://example.com/registry.json');

      await expect(index.fetch()).rejects.toThrow(RegistryParseError);
    });

    it('should throw RegistryParseError on missing version field', async () => {
      global.fetch = createMockFetch({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ agents: [] })),
      });

      const index = new RegistryIndex('https://example.com/registry.json');

      await expect(index.fetch()).rejects.toThrow(RegistryParseError);
      await expect(index.fetch()).rejects.toThrow('version');
    });

    it('should throw RegistryParseError on missing agents field', async () => {
      global.fetch = createMockFetch({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ version: '1.0.0' })),
      });

      const index = new RegistryIndex('https://example.com/registry.json');

      await expect(index.fetch()).rejects.toThrow(RegistryParseError);
      await expect(index.fetch()).rejects.toThrow('agents');
    });

    it('should throw RegistryParseError on agent missing id', async () => {
      global.fetch = createMockFetch({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({
          version: '1.0.0',
          agents: [{ name: 'Test', distribution: { type: 'npx', package: 'test' } }],
        })),
      });

      const index = new RegistryIndex('https://example.com/registry.json');

      await expect(index.fetch()).rejects.toThrow(RegistryParseError);
      await expect(index.fetch()).rejects.toThrow('id');
    });

    it('should throw RegistryParseError on agent missing name', async () => {
      global.fetch = createMockFetch({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({
          version: '1.0.0',
          agents: [{ id: 'test', distribution: { type: 'npx', package: 'test' } }],
        })),
      });

      const index = new RegistryIndex('https://example.com/registry.json');

      await expect(index.fetch()).rejects.toThrow(RegistryParseError);
      await expect(index.fetch()).rejects.toThrow('name');
    });

    it('should throw RegistryParseError on agent missing distribution', async () => {
      global.fetch = createMockFetch({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({
          version: '1.0.0',
          agents: [{ id: 'test', name: 'Test' }],
        })),
      });

      const index = new RegistryIndex('https://example.com/registry.json');

      await expect(index.fetch()).rejects.toThrow(RegistryParseError);
      await expect(index.fetch()).rejects.toThrow('distribution');
    });

    it('should throw RegistryParseError on invalid distribution type', async () => {
      global.fetch = createMockFetch({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({
          version: '1.0.0',
          agents: [{ id: 'test', name: 'Test', distribution: { type: 'invalid' } }],
        })),
      });

      const index = new RegistryIndex('https://example.com/registry.json');

      await expect(index.fetch()).rejects.toThrow(RegistryParseError);
    });
  });

  describe('lookup', () => {
    /**
     * Look up agent by ID
     */
    it('should return agent when found', async () => {
      const agents = [
        { id: 'my-agent', name: 'My Agent', distribution: { type: 'npx' as const, package: 'my-pkg' } },
      ];

      global.fetch = createMockFetch({
        ok: true,
        text: () => Promise.resolve(createValidRegistryJson(agents)),
      });

      const index = new RegistryIndex('https://example.com/registry.json');
      await index.fetch();

      const agent = index.lookup('my-agent');
      expect(agent).toBeDefined();
      expect(agent?.id).toBe('my-agent');
      expect(agent?.name).toBe('My Agent');
    });

    it('should return undefined when agent not found', async () => {
      global.fetch = createMockFetch({
        ok: true,
        text: () => Promise.resolve(createValidRegistryJson([])),
      });

      const index = new RegistryIndex('https://example.com/registry.json');
      await index.fetch();

      const agent = index.lookup('nonexistent-agent');
      expect(agent).toBeUndefined();
    });

    it('should return undefined before fetch is called', () => {
      const index = new RegistryIndex('https://example.com/registry.json');

      const agent = index.lookup('any-agent');
      expect(agent).toBeUndefined();
    });

    it('should handle case-sensitive agent IDs', async () => {
      const agents = [
        { id: 'MyAgent', name: 'My Agent', distribution: { type: 'npx' as const, package: 'pkg' } },
      ];

      global.fetch = createMockFetch({
        ok: true,
        text: () => Promise.resolve(createValidRegistryJson(agents)),
      });

      const index = new RegistryIndex('https://example.com/registry.json');
      await index.fetch();

      expect(index.lookup('MyAgent')).toBeDefined();
      expect(index.lookup('myagent')).toBeUndefined();
      expect(index.lookup('MYAGENT')).toBeUndefined();
    });

    it('should handle agent IDs with special characters', async () => {
      const agents = [
        { id: 'agent-with-dashes', name: 'Agent 1', distribution: { type: 'npx' as const, package: 'pkg' } },
        { id: 'agent_with_underscores', name: 'Agent 2', distribution: { type: 'npx' as const, package: 'pkg' } },
        { id: 'agent.with.dots', name: 'Agent 3', distribution: { type: 'npx' as const, package: 'pkg' } },
      ];

      global.fetch = createMockFetch({
        ok: true,
        text: () => Promise.resolve(createValidRegistryJson(agents)),
      });

      const index = new RegistryIndex('https://example.com/registry.json');
      await index.fetch();

      expect(index.lookup('agent-with-dashes')).toBeDefined();
      expect(index.lookup('agent_with_underscores')).toBeDefined();
      expect(index.lookup('agent.with.dots')).toBeDefined();
    });
  });

  describe('resolve', () => {
    /**
     * Return error for agent not found
     */
    it('should throw AgentNotFoundError when agent not in registry', async () => {
      global.fetch = createMockFetch({
        ok: true,
        text: () => Promise.resolve(createValidRegistryJson([])),
      });

      const index = new RegistryIndex('https://example.com/registry.json');
      await index.fetch();

      expect(() => index.resolve('nonexistent-agent')).toThrow(AgentNotFoundError);
      expect(() => index.resolve('nonexistent-agent')).toThrow('Agent not found');
    });

    it('should include agentId in AgentNotFoundError', async () => {
      global.fetch = createMockFetch({
        ok: true,
        text: () => Promise.resolve(createValidRegistryJson([])),
      });

      const index = new RegistryIndex('https://example.com/registry.json');
      await index.fetch();

      try {
        index.resolve('my-missing-agent');
        fail('Expected AgentNotFoundError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(AgentNotFoundError);
        expect((error as AgentNotFoundError).agentId).toBe('my-missing-agent');
      }
    });

    it('should resolve npx distribution to spawn command', async () => {
      const agents = [
        {
          id: 'npx-agent',
          name: 'NPX Agent',
          distribution: { type: 'npx' as const, package: 'my-package', version: '1.0.0' },
        },
      ];

      global.fetch = createMockFetch({
        ok: true,
        text: () => Promise.resolve(createValidRegistryJson(agents)),
      });

      const index = new RegistryIndex('https://example.com/registry.json');
      await index.fetch();

      const command = index.resolve('npx-agent');
      expect(command.command).toBe('npx');
      expect(command.args).toContain('my-package@1.0.0');
    });

    it('should resolve uvx distribution to spawn command', async () => {
      const agents = [
        { id: 'uvx-agent', name: 'UVX Agent', distribution: { type: 'uvx' as const, package: 'my-python-pkg' } },
      ];

      global.fetch = createMockFetch({
        ok: true,
        text: () => Promise.resolve(createValidRegistryJson(agents)),
      });

      const index = new RegistryIndex('https://example.com/registry.json');
      await index.fetch();

      const command = index.resolve('uvx-agent');
      expect(command.command).toBe('uvx');
      expect(command.args).toContain('my-python-pkg');
    });

    it('should pass through agent args to spawn command', async () => {
      const agents = [
        {
          id: 'agent-with-args',
          name: 'Agent With Args',
          distribution: { type: 'npx' as const, package: 'pkg' },
          args: ['--verbose', '--config', 'config.json'],
        },
      ];

      global.fetch = createMockFetch({
        ok: true,
        text: () => Promise.resolve(createValidRegistryJson(agents)),
      });

      const index = new RegistryIndex('https://example.com/registry.json');
      await index.fetch();

      const command = index.resolve('agent-with-args');
      expect(command.args).toContain('--verbose');
      expect(command.args).toContain('--config');
      expect(command.args).toContain('config.json');
    });

    it('should pass through agent env to spawn command', async () => {
      const agents = [
        {
          id: 'agent-with-env',
          name: 'Agent With Env',
          distribution: { type: 'npx' as const, package: 'pkg' },
          env: { NODE_ENV: 'production', DEBUG: 'true' },
        },
      ];

      global.fetch = createMockFetch({
        ok: true,
        text: () => Promise.resolve(createValidRegistryJson(agents)),
      });

      const index = new RegistryIndex('https://example.com/registry.json');
      await index.fetch();

      const command = index.resolve('agent-with-env');
      expect(command.env).toEqual({ NODE_ENV: 'production', DEBUG: 'true' });
    });
  });

  describe('getRegistry', () => {
    it('should return null before fetch is called', () => {
      const index = new RegistryIndex('https://example.com/registry.json');
      expect(index.getRegistry()).toBeNull();
    });

    it('should return parsed registry after fetch', async () => {
      global.fetch = createMockFetch({
        ok: true,
        text: () => Promise.resolve(createValidRegistryJson([
          { id: 'test', name: 'Test', distribution: { type: 'npx' as const, package: 'pkg' } },
        ])),
      });

      const index = new RegistryIndex('https://example.com/registry.json');
      await index.fetch();

      const registry = index.getRegistry();
      expect(registry).not.toBeNull();
      expect(registry?.version).toBe('1.0.0');
      expect(registry?.agents).toHaveLength(1);
    });
  });
});

describe('parseRegistry', () => {
  /**
   * Parse error on malformed JSON
   */
  describe('valid registry parsing', () => {
    it('should parse minimal valid registry', () => {
      const data = { version: '1.0.0', agents: [] };
      const result = parseRegistry(data);

      expect(result.version).toBe('1.0.0');
      expect(result.agents).toHaveLength(0);
    });

    it('should parse registry with npx agent', () => {
      const data = {
        version: '1.0.0',
        agents: [{
          id: 'test-agent',
          name: 'Test Agent',
          distribution: { type: 'npx', package: 'test-pkg' },
        }],
      };

      const result = parseRegistry(data);
      expect(result.agents[0].id).toBe('test-agent');
      expect(result.agents[0].distribution.type).toBe('npx');
    });

    it('should parse registry with uvx agent', () => {
      const data = {
        version: '1.0.0',
        agents: [{
          id: 'python-agent',
          name: 'Python Agent',
          distribution: { type: 'uvx', package: 'python-pkg', version: '2.0.0' },
        }],
      };

      const result = parseRegistry(data);
      expect(result.agents[0].distribution.type).toBe('uvx');
      expect((result.agents[0].distribution as { version?: string }).version).toBe('2.0.0');
    });

    it('should parse registry with binary agent', () => {
      const data = {
        version: '1.0.0',
        agents: [{
          id: 'binary-agent',
          name: 'Binary Agent',
          distribution: {
            type: 'binary',
            platforms: {
              'darwin-x64': '/path/to/darwin-x64/binary',
              'linux-x64': '/path/to/linux-x64/binary',
            },
          },
        }],
      };

      const result = parseRegistry(data);
      expect(result.agents[0].distribution.type).toBe('binary');
    });

    it('should parse optional description field', () => {
      const data = {
        version: '1.0.0',
        agents: [{
          id: 'test',
          name: 'Test',
          description: 'A test agent',
          distribution: { type: 'npx', package: 'pkg' },
        }],
      };

      const result = parseRegistry(data);
      expect(result.agents[0].description).toBe('A test agent');
    });

    it('should parse optional args field', () => {
      const data = {
        version: '1.0.0',
        agents: [{
          id: 'test',
          name: 'Test',
          distribution: { type: 'npx', package: 'pkg' },
          args: ['--flag', 'value'],
        }],
      };

      const result = parseRegistry(data);
      expect(result.agents[0].args).toEqual(['--flag', 'value']);
    });

    it('should parse optional env field', () => {
      const data = {
        version: '1.0.0',
        agents: [{
          id: 'test',
          name: 'Test',
          distribution: { type: 'npx', package: 'pkg' },
          env: { KEY: 'value' },
        }],
      };

      const result = parseRegistry(data);
      expect(result.agents[0].env).toEqual({ KEY: 'value' });
    });
  });

  describe('invalid registry rejection', () => {
    it('should reject null', () => {
      expect(() => parseRegistry(null)).toThrow(RegistryParseError);
    });

    it('should reject undefined', () => {
      expect(() => parseRegistry(undefined)).toThrow(RegistryParseError);
    });

    it('should reject string', () => {
      expect(() => parseRegistry('not an object')).toThrow(RegistryParseError);
    });

    it('should reject number', () => {
      expect(() => parseRegistry(42)).toThrow(RegistryParseError);
    });

    it('should reject array', () => {
      expect(() => parseRegistry([1, 2, 3])).toThrow(RegistryParseError);
    });

    it('should reject empty version string', () => {
      expect(() => parseRegistry({ version: '', agents: [] })).toThrow(RegistryParseError);
    });

    it('should reject non-string version', () => {
      expect(() => parseRegistry({ version: 123, agents: [] })).toThrow(RegistryParseError);
    });

    it('should reject non-array agents', () => {
      expect(() => parseRegistry({ version: '1.0.0', agents: 'not an array' })).toThrow(RegistryParseError);
    });
  });
});
