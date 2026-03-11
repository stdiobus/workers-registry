/*
 * Apache License 2.0
 * Copyright (c) 2025–present Raman Marozau, Target Insight Function.
 * Contact: raman@worktif.com
 */

/**
 * Unit tests for Registry parsing, specifically mcpServers.
 */

import { parseRegistry } from './index.js';

describe('parseRegistry', () => {
  describe('mcpServers parsing', () => {
    it('should parse agent with mcpServers', () => {
      const data = {
        version: '1.0.0',
        agents: [
          {
            id: 'test-agent',
            name: 'Test Agent',
            version: '1.0.0',
            distribution: { npx: { package: 'test-agent' } },
            mcpServers: [
              { name: 'filesystem', command: 'npx', args: ['-y', '@mcp/server-filesystem', '/'] },
              { name: 'shell', command: 'npx', args: ['-y', '@mcp/server-shell'] },
            ],
          },
        ],
      };

      const registry = parseRegistry(data);

      expect(registry.agents.length).toBe(1);
      expect(registry.agents[0].mcpServers).toBeDefined();
      expect(registry.agents[0].mcpServers!.length).toBe(2);
      expect(registry.agents[0].mcpServers![0].name).toBe('filesystem');
      expect(registry.agents[0].mcpServers![0].command).toBe('npx');
      expect(registry.agents[0].mcpServers![0].args).toEqual(['-y', '@mcp/server-filesystem', '/']);
      expect(registry.agents[0].mcpServers![1].name).toBe('shell');
    });

    it('should parse agent with mcpServers containing env', () => {
      const data = {
        version: '1.0.0',
        agents: [
          {
            id: 'test-agent',
            name: 'Test Agent',
            version: '1.0.0',
            distribution: { npx: { package: 'test-agent' } },
            mcpServers: [
              {
                name: 'server-with-env',
                command: 'npx',
                args: ['-y', '@mcp/server'],
                env: { API_KEY: 'secret', DEBUG: 'true' },
              },
            ],
          },
        ],
      };

      const registry = parseRegistry(data);

      expect(registry.agents[0].mcpServers![0].env).toEqual({
        API_KEY: 'secret',
        DEBUG: 'true',
      });
    });

    it('should parse agent without mcpServers', () => {
      const data = {
        version: '1.0.0',
        agents: [
          {
            id: 'test-agent',
            name: 'Test Agent',
            version: '1.0.0',
            distribution: { npx: { package: 'test-agent' } },
          },
        ],
      };

      const registry = parseRegistry(data);

      expect(registry.agents[0].mcpServers).toBeUndefined();
    });

    it('should skip invalid mcpServer entries (missing name)', () => {
      const data = {
        version: '1.0.0',
        agents: [
          {
            id: 'test-agent',
            name: 'Test Agent',
            version: '1.0.0',
            distribution: { npx: { package: 'test-agent' } },
            mcpServers: [
              { command: 'npx', args: ['-y', '@mcp/server'] }, // missing name
              { name: 'valid', command: 'npx' },
            ],
          },
        ],
      };

      const registry = parseRegistry(data);

      // Should only have the valid server
      expect(registry.agents[0].mcpServers!.length).toBe(1);
      expect(registry.agents[0].mcpServers![0].name).toBe('valid');
    });

    it('should skip invalid mcpServer entries (missing command)', () => {
      const data = {
        version: '1.0.0',
        agents: [
          {
            id: 'test-agent',
            name: 'Test Agent',
            version: '1.0.0',
            distribution: { npx: { package: 'test-agent' } },
            mcpServers: [
              { name: 'invalid' }, // missing command
              { name: 'valid', command: 'npx' },
            ],
          },
        ],
      };

      const registry = parseRegistry(data);

      expect(registry.agents[0].mcpServers!.length).toBe(1);
      expect(registry.agents[0].mcpServers![0].name).toBe('valid');
    });

    it('should handle empty mcpServers array', () => {
      const data = {
        version: '1.0.0',
        agents: [
          {
            id: 'test-agent',
            name: 'Test Agent',
            version: '1.0.0',
            distribution: { npx: { package: 'test-agent' } },
            mcpServers: [],
          },
        ],
      };

      const registry = parseRegistry(data);

      // Empty array should not be set
      expect(registry.agents[0].mcpServers).toBeUndefined();
    });

    it('should filter non-string values from args', () => {
      const data = {
        version: '1.0.0',
        agents: [
          {
            id: 'test-agent',
            name: 'Test Agent',
            version: '1.0.0',
            distribution: { npx: { package: 'test-agent' } },
            mcpServers: [
              { name: 'server', command: 'npx', args: ['-y', 123, '@mcp/server', null] },
            ],
          },
        ],
      };

      const registry = parseRegistry(data);

      expect(registry.agents[0].mcpServers![0].args).toEqual(['-y', '@mcp/server']);
    });

    it('should filter non-string values from env', () => {
      const data = {
        version: '1.0.0',
        agents: [
          {
            id: 'test-agent',
            name: 'Test Agent',
            version: '1.0.0',
            distribution: { npx: { package: 'test-agent' } },
            mcpServers: [
              {
                name: 'server',
                command: 'npx',
                env: { VALID: 'value', INVALID: 123, ALSO_INVALID: null },
              },
            ],
          },
        ],
      };

      const registry = parseRegistry(data);

      expect(registry.agents[0].mcpServers![0].env).toEqual({ VALID: 'value' });
    });
  });
});
