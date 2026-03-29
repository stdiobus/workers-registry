/*
 * Apache License 2.0
 * Copyright (c) 2025–present Raman Marozau, Target Insight Function.
 */

/**
 * Production E2E: AUTH_REQUIRED flow tests.
 *
 * Tests authentication enforcement through the production binary:
 * - Agent requires auth, no credentials → AUTH_REQUIRED
 * - Agent requires auth, credentials present → success
 * - authMethods injection in initialize response
 *
 * All tests spawn `node dist/registry-launcher/index.js`.
 * No imports from src/.
 *
 * @module tests/e2e/production-auth-required.e2e.test
 */

import * as path from 'path';
import { LauncherHarness, MockRegistryServer, ApiKeysHelper } from './helpers';

const MOCK_AGENT_PATH = path.resolve(
  __dirname,
  'fixtures/agents/mock-acp-agent.mjs',
);

describe('E2E: AUTH_REQUIRED flow (production binary)', () => {
  let launcher: LauncherHarness;
  let registry: MockRegistryServer;
  let apiKeys: ApiKeysHelper;

  beforeEach(() => {
    launcher = new LauncherHarness();
    registry = new MockRegistryServer();
    apiKeys = new ApiKeysHelper();
  });

  afterEach(async () => {
    await launcher.stop();
    await registry.stop();
    apiKeys.cleanup();
  });

  describe('50.1: Agent requires auth, no credentials → AUTH_REQUIRED', () => {
    it('should return AUTH_REQUIRED when agent needs auth but no credentials exist', async () => {
      // Agent requires token (MOCK_REQUIRE_TOKEN=true) and returns oauth2 authMethods
      const registryUrl = await registry.start([
        {
          id: 'auth-agent',
          name: 'Auth Agent',
          cmd: 'node',
          args: [MOCK_AGENT_PATH],
        },
      ]);

      const apiKeysPath = apiKeys.createApiKeysFile({
        'auth-agent': {
          env: {
            MOCK_REQUIRE_TOKEN: 'true',
            MOCK_AUTH_METHODS: JSON.stringify([
              { id: 'oauth2-github', type: 'oauth2', providerId: 'github' },
            ]),
          },
        },
      });

      await launcher.start({
        registryUrl,
        apiKeysPath,
        env: { AUTH_AUTO_OAUTH: 'false' },
      });

      // Initialize
      launcher.sendMessage({
        jsonrpc: '2.0',
        id: 'init-auth',
        method: 'initialize',
        agentId: 'auth-agent',
        params: { clientInfo: { name: 'Test', version: '1.0.0' } },
      });

      const initResp = (await launcher.waitForResponse('init-auth', 15000)) as Record<string, unknown>;
      expect(initResp.result).toBeDefined();

      // session/new should fail with AUTH_REQUIRED
      launcher.sendMessage({
        jsonrpc: '2.0',
        id: 'session-auth',
        method: 'session/new',
        agentId: 'auth-agent',
        params: {},
      });

      const sessionResp = (await launcher.waitForResponse('session-auth', 10000)) as Record<string, unknown>;
      expect(sessionResp.jsonrpc).toBe('2.0');
      expect(sessionResp.id).toBe('session-auth');
      expect(sessionResp.error).toBeDefined();

      const error = sessionResp.error as Record<string, unknown>;
      expect(error.code).toBe(-32004); // AUTH_REQUIRED

      // Verify error data contains required fields
      if (error.data) {
        const data = error.data as Record<string, unknown>;
        expect(data.requiredMethod || data.errorCode).toBeDefined();
        expect(data.supportedMethods || data.remediation).toBeDefined();
      }
    }, 30000);
  });

  describe('50.2: Agent requires auth, credentials present → success', () => {
    it('should succeed when agent has credentials via api-keys.json', async () => {
      // Agent requires token but we provide it via env injection
      const registryUrl = await registry.start([
        {
          id: 'auth-agent',
          name: 'Auth Agent',
          cmd: 'node',
          args: [MOCK_AGENT_PATH],
        },
      ]);

      const apiKeysPath = apiKeys.createApiKeysFile({
        'auth-agent': {
          apiKey: 'test-token-xyz',
          env: {
            AUTH_TOKEN: 'test-token-xyz',
            MOCK_REQUIRE_TOKEN: 'true',
            MOCK_AUTH_METHODS: JSON.stringify([
              { id: 'api-key', type: 'api-key' },
            ]),
          },
        },
      });

      await launcher.start({
        registryUrl,
        apiKeysPath,
        env: { AUTH_AUTO_OAUTH: 'false' },
      });

      // Initialize
      launcher.sendMessage({
        jsonrpc: '2.0',
        id: 'init-cred',
        method: 'initialize',
        agentId: 'auth-agent',
        params: { clientInfo: { name: 'Test', version: '1.0.0' } },
      });
      await launcher.waitForResponse('init-cred', 15000);

      // session/new should succeed because AUTH_TOKEN is injected
      launcher.sendMessage({
        jsonrpc: '2.0',
        id: 'session-cred',
        method: 'session/new',
        agentId: 'auth-agent',
        params: {},
      });

      const resp = (await launcher.waitForResponse('session-cred', 10000)) as Record<string, unknown>;
      expect(resp.jsonrpc).toBe('2.0');
      expect(resp.id).toBe('session-cred');
      expect(resp.error).toBeUndefined();
      expect(resp.result).toBeDefined();
      expect((resp.result as Record<string, unknown>).sessionId).toBeDefined();
    }, 30000);
  });

  describe('50.3: authMethods injection in initialize response', () => {
    it('should include authMethods in initialize response', async () => {
      const registryUrl = await registry.start([
        {
          id: 'any-agent',
          name: 'Any Agent',
          cmd: 'node',
          args: [MOCK_AGENT_PATH],
        },
      ]);

      const apiKeysPath = apiKeys.createEmptyApiKeysFile();

      await launcher.start({
        registryUrl,
        apiKeysPath,
        env: { AUTH_AUTO_OAUTH: 'false' },
      });

      launcher.sendMessage({
        jsonrpc: '2.0',
        id: 'init-methods',
        method: 'initialize',
        agentId: 'any-agent',
        params: { clientInfo: { name: 'Test', version: '1.0.0' } },
      });

      const resp = (await launcher.waitForResponse('init-methods', 15000)) as Record<string, unknown>;
      expect(resp.result).toBeDefined();

      const result = resp.result as Record<string, unknown>;
      expect(result.authMethods).toBeDefined();
      expect(Array.isArray(result.authMethods)).toBe(true);

      const authMethods = result.authMethods as Array<Record<string, unknown>>;
      expect(authMethods.length).toBeGreaterThan(0);

      // Each authMethod should have id and type
      for (const method of authMethods) {
        expect(method.id).toBeDefined();
        expect(method.type).toBeDefined();
        expect(typeof method.id).toBe('string');
        expect(typeof method.type).toBe('string');
      }

      // Should include OAuth methods
      const oauthMethods = authMethods.filter((m) => m.type === 'oauth2');
      expect(oauthMethods.length).toBeGreaterThan(0);

      // Should include API key methods
      const apiKeyMethods = authMethods.filter((m) => m.type === 'api-key');
      expect(apiKeyMethods.length).toBeGreaterThan(0);
    }, 30000);
  });
});
