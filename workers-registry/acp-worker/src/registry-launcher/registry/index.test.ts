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


describe('parseRegistry - authRequired and authMethods parsing', () => {
  /**
   * Tests for auth requirement detection from registry.
   * Requirements: 11.2, 11.3
   */

  describe('authRequired field parsing', () => {
    it('should parse agent with authRequired: true', () => {
      const data = {
        version: '1.0.0',
        agents: [
          {
            id: 'auth-agent',
            name: 'Auth Agent',
            version: '1.0.0',
            distribution: { npx: { package: 'auth-agent' } },
            authRequired: true,
          },
        ],
      };

      const registry = parseRegistry(data);

      expect(registry.agents[0].authRequired).toBe(true);
    });

    it('should parse agent with authRequired: false', () => {
      const data = {
        version: '1.0.0',
        agents: [
          {
            id: 'no-auth-agent',
            name: 'No Auth Agent',
            version: '1.0.0',
            distribution: { npx: { package: 'no-auth-agent' } },
            authRequired: false,
          },
        ],
      };

      const registry = parseRegistry(data);

      expect(registry.agents[0].authRequired).toBe(false);
    });

    it('should not set authRequired if not present', () => {
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

      expect(registry.agents[0].authRequired).toBeUndefined();
    });

    it('should ignore non-boolean authRequired values', () => {
      const data = {
        version: '1.0.0',
        agents: [
          {
            id: 'test-agent',
            name: 'Test Agent',
            version: '1.0.0',
            distribution: { npx: { package: 'test-agent' } },
            authRequired: 'yes', // Invalid - should be boolean
          },
        ],
      };

      const registry = parseRegistry(data);

      expect(registry.agents[0].authRequired).toBeUndefined();
    });
  });

  describe('authMethods field parsing', () => {
    it('should parse agent with oauth2 authMethods', () => {
      const data = {
        version: '1.0.0',
        agents: [
          {
            id: 'oauth-agent',
            name: 'OAuth Agent',
            version: '1.0.0',
            distribution: { npx: { package: 'oauth-agent' } },
            authMethods: [
              { id: 'oauth2-github', type: 'oauth2', providerId: 'github' },
              { id: 'oauth2-google', type: 'oauth2', providerId: 'google' },
            ],
          },
        ],
      };

      const registry = parseRegistry(data);

      expect(registry.agents[0].authMethods).toBeDefined();
      expect(registry.agents[0].authMethods!.length).toBe(2);
      expect(registry.agents[0].authMethods![0]).toEqual({
        id: 'oauth2-github',
        type: 'oauth2',
        providerId: 'github',
      });
      expect(registry.agents[0].authMethods![1]).toEqual({
        id: 'oauth2-github',
        type: 'oauth2',
        providerId: 'github',
      });
    });

    it('should parse agent with api-key authMethods', () => {
      const data = {
        version: '1.0.0',
        agents: [
          {
            id: 'api-key-agent',
            name: 'API Key Agent',
            version: '1.0.0',
            distribution: { npx: { package: 'api-key-agent' } },
            authMethods: [
              { id: 'github-api-key', type: 'api-key', providerId: 'github' },
            ],
          },
        ],
      };

      const registry = parseRegistry(data);

      expect(registry.agents[0].authMethods).toBeDefined();
      expect(registry.agents[0].authMethods!.length).toBe(1);
      expect(registry.agents[0].authMethods![0]).toEqual({
        id: 'github-api-key',
        type: 'api-key',
        providerId: 'github',
      });
    });

    it('should parse agent with mixed authMethods', () => {
      const data = {
        version: '1.0.0',
        agents: [
          {
            id: 'mixed-auth-agent',
            name: 'Mixed Auth Agent',
            version: '1.0.0',
            distribution: { npx: { package: 'mixed-auth-agent' } },
            authMethods: [
              { id: 'oauth2-github', type: 'oauth2', providerId: 'github' },
              { id: 'github-api-key', type: 'api-key', providerId: 'github' },
            ],
          },
        ],
      };

      const registry = parseRegistry(data);

      expect(registry.agents[0].authMethods!.length).toBe(2);
      expect(registry.agents[0].authMethods![0].type).toBe('oauth2');
      expect(registry.agents[0].authMethods![1].type).toBe('api-key');
    });

    it('should parse authMethod without providerId', () => {
      const data = {
        version: '1.0.0',
        agents: [
          {
            id: 'generic-auth-agent',
            name: 'Generic Auth Agent',
            version: '1.0.0',
            distribution: { npx: { package: 'generic-auth-agent' } },
            authMethods: [
              { id: 'api-key', type: 'api-key' },
            ],
          },
        ],
      };

      const registry = parseRegistry(data);

      expect(registry.agents[0].authMethods![0]).toEqual({
        id: 'api-key',
        type: 'api-key',
      });
      expect(registry.agents[0].authMethods![0].providerId).toBeUndefined();
    });

    it('should skip invalid authMethod entries (missing id)', () => {
      const data = {
        version: '1.0.0',
        agents: [
          {
            id: 'test-agent',
            name: 'Test Agent',
            version: '1.0.0',
            distribution: { npx: { package: 'test-agent' } },
            authMethods: [
              { type: 'oauth2', providerId: 'github' }, // missing id
              { id: 'valid', type: 'api-key' },
            ],
          },
        ],
      };

      const registry = parseRegistry(data);

      expect(registry.agents[0].authMethods!.length).toBe(1);
      expect(registry.agents[0].authMethods![0].id).toBe('valid');
    });

    it('should skip invalid authMethod entries (missing type)', () => {
      const data = {
        version: '1.0.0',
        agents: [
          {
            id: 'test-agent',
            name: 'Test Agent',
            version: '1.0.0',
            distribution: { npx: { package: 'test-agent' } },
            authMethods: [
              { id: 'invalid', providerId: 'github' }, // missing type
              { id: 'valid', type: 'api-key' },
            ],
          },
        ],
      };

      const registry = parseRegistry(data);

      expect(registry.agents[0].authMethods!.length).toBe(1);
      expect(registry.agents[0].authMethods![0].id).toBe('valid');
    });

    it('should skip invalid authMethod entries (invalid type)', () => {
      const data = {
        version: '1.0.0',
        agents: [
          {
            id: 'test-agent',
            name: 'Test Agent',
            version: '1.0.0',
            distribution: { npx: { package: 'test-agent' } },
            authMethods: [
              { id: 'invalid', type: 'bearer' }, // invalid type
              { id: 'valid', type: 'oauth2', providerId: 'github' },
            ],
          },
        ],
      };

      const registry = parseRegistry(data);

      expect(registry.agents[0].authMethods!.length).toBe(1);
      expect(registry.agents[0].authMethods![0].id).toBe('valid');
    });

    it('should handle empty authMethods array', () => {
      const data = {
        version: '1.0.0',
        agents: [
          {
            id: 'test-agent',
            name: 'Test Agent',
            version: '1.0.0',
            distribution: { npx: { package: 'test-agent' } },
            authMethods: [],
          },
        ],
      };

      const registry = parseRegistry(data);

      expect(registry.agents[0].authMethods).toBeUndefined();
    });

    it('should skip non-object authMethod entries', () => {
      const data = {
        version: '1.0.0',
        agents: [
          {
            id: 'test-agent',
            name: 'Test Agent',
            version: '1.0.0',
            distribution: { npx: { package: 'test-agent' } },
            authMethods: [
              'invalid-string',
              123,
              null,
              { id: 'valid', type: 'api-key' },
            ],
          },
        ],
      };

      const registry = parseRegistry(data);

      expect(registry.agents[0].authMethods!.length).toBe(1);
      expect(registry.agents[0].authMethods![0].id).toBe('valid');
    });
  });

  describe('combined authRequired and authMethods', () => {
    it('should parse agent with both authRequired and authMethods', () => {
      const data = {
        version: '1.0.0',
        agents: [
          {
            id: 'full-auth-agent',
            name: 'Full Auth Agent',
            version: '1.0.0',
            distribution: { npx: { package: 'full-auth-agent' } },
            authRequired: true,
            authMethods: [
              { id: 'oauth2-github', type: 'oauth2', providerId: 'github' },
            ],
          },
        ],
      };

      const registry = parseRegistry(data);

      expect(registry.agents[0].authRequired).toBe(true);
      expect(registry.agents[0].authMethods!.length).toBe(1);
    });
  });
});

describe('RegistryIndex - getAuthRequirements', () => {
  /**
   * Tests for auth requirements caching and querying.
   * Requirements: 11.2, 11.3
   */

  // Import RegistryIndex for these tests
  const { RegistryIndex } = require('./index.js');

  it('should return undefined for unknown agent', () => {
    const registry = new RegistryIndex('https://example.com/registry.json');

    const requirements = registry.getAuthRequirements('unknown-agent');

    expect(requirements).toBeUndefined();
  });

  it('should return auth requirements for agent with authRequired', () => {
    const registry = new RegistryIndex('https://example.com/registry.json');
    registry.mergeCustomAgents([
      {
        id: 'auth-agent',
        name: 'Auth Agent',
        version: '1.0.0',
        distribution: { npx: { package: 'auth-agent' } },
        authRequired: true,
      },
    ]);

    const requirements = registry.getAuthRequirements('auth-agent');

    expect(requirements).toBeDefined();
    expect(requirements!.authRequired).toBe(true);
    expect(requirements!.authMethods).toEqual([]);
    expect(requirements!.primaryOAuthProviderId).toBeUndefined();
  });

  it('should return auth requirements for agent with authMethods', () => {
    const registry = new RegistryIndex('https://example.com/registry.json');
    registry.mergeCustomAgents([
      {
        id: 'oauth-agent',
        name: 'OAuth Agent',
        version: '1.0.0',
        distribution: { npx: { package: 'oauth-agent' } },
        authMethods: [
          { id: 'oauth2-github', type: 'oauth2', providerId: 'github' },
          { id: 'oauth2-google', type: 'oauth2', providerId: 'google' },
        ],
      },
    ]);

    const requirements = registry.getAuthRequirements('oauth-agent');

    expect(requirements).toBeDefined();
    expect(requirements!.authRequired).toBe(true); // Implicitly required due to oauth2 methods
    expect(requirements!.authMethods.length).toBe(2);
    expect(requirements!.primaryOAuthProviderId).toBe('github'); // First oauth2 provider
  });

  it('should return authRequired: false for agent without auth fields', () => {
    const registry = new RegistryIndex('https://example.com/registry.json');
    registry.mergeCustomAgents([
      {
        id: 'no-auth-agent',
        name: 'No Auth Agent',
        version: '1.0.0',
        distribution: { npx: { package: 'no-auth-agent' } },
      },
    ]);

    const requirements = registry.getAuthRequirements('no-auth-agent');

    expect(requirements).toBeDefined();
    expect(requirements!.authRequired).toBe(false);
    expect(requirements!.authMethods).toEqual([]);
    expect(requirements!.primaryOAuthProviderId).toBeUndefined();
  });

  it('should cache auth requirements', () => {
    const registry = new RegistryIndex('https://example.com/registry.json');
    registry.mergeCustomAgents([
      {
        id: 'cached-agent',
        name: 'Cached Agent',
        version: '1.0.0',
        distribution: { npx: { package: 'cached-agent' } },
        authRequired: true,
      },
    ]);

    // First call
    const requirements1 = registry.getAuthRequirements('cached-agent');
    // Second call should return cached result
    const requirements2 = registry.getAuthRequirements('cached-agent');

    expect(requirements1).toBe(requirements2); // Same object reference (cached)
  });

  it('should clear cache when clearAuthRequirementsCache is called', () => {
    const registry = new RegistryIndex('https://example.com/registry.json');
    registry.mergeCustomAgents([
      {
        id: 'cache-test-agent',
        name: 'Cache Test Agent',
        version: '1.0.0',
        distribution: { npx: { package: 'cache-test-agent' } },
        authRequired: true,
      },
    ]);

    // First call - caches the result
    const requirements1 = registry.getAuthRequirements('cache-test-agent');

    // Clear cache
    registry.clearAuthRequirementsCache('cache-test-agent');

    // Second call - should create new object
    const requirements2 = registry.getAuthRequirements('cache-test-agent');

    expect(requirements1).not.toBe(requirements2); // Different object references
    expect(requirements1).toEqual(requirements2); // But same values
  });

  it('should find primaryOAuthProviderId from first oauth2 method', () => {
    const registry = new RegistryIndex('https://example.com/registry.json');
    registry.mergeCustomAgents([
      {
        id: 'multi-oauth-agent',
        name: 'Multi OAuth Agent',
        version: '1.0.0',
        distribution: { npx: { package: 'multi-oauth-agent' } },
        authMethods: [
          { id: 'api-key', type: 'api-key' }, // No providerId
          { id: 'oauth2-github', type: 'oauth2', providerId: 'github' },
          { id: 'oauth2-google', type: 'oauth2', providerId: 'google' },
        ],
      },
    ]);

    const requirements = registry.getAuthRequirements('multi-oauth-agent');

    expect(requirements!.primaryOAuthProviderId).toBe('github'); // First oauth2 with providerId
  });

  it('should respect explicit authRequired: false even with oauth2 methods', () => {
    const registry = new RegistryIndex('https://example.com/registry.json');
    registry.mergeCustomAgents([
      {
        id: 'optional-oauth-agent',
        name: 'Optional OAuth Agent',
        version: '1.0.0',
        distribution: { npx: { package: 'optional-oauth-agent' } },
        authRequired: false,
        authMethods: [
          { id: 'oauth2-github', type: 'oauth2', providerId: 'github' },
        ],
      },
    ]);

    const requirements = registry.getAuthRequirements('optional-oauth-agent');

    expect(requirements!.authRequired).toBe(false); // Explicit false takes precedence
    expect(requirements!.authMethods.length).toBe(1);
  });
});
