/*
 * Apache License 2.0
 * Copyright (c) 2025–present Raman Marozau, Target Insight Function.
 */

/**
 * Production E2E: API key injection tests (legacy credentials).
 *
 * Tests that api-keys.json env vars are injected into agent processes,
 * agents work without credentials, and unknown agents return errors.
 *
 * All tests spawn `node dist/registry-launcher/index.js`.
 * No imports from src/.
 *
 * @module tests/e2e/production-api-keys.e2e.test
 */

import * as path from 'path';
import { LauncherHarness, MockRegistryServer, ApiKeysHelper } from './helpers';

const MOCK_AGENT_PATH = path.resolve(
  __dirname,
  'fixtures/agents/mock-acp-agent.mjs',
);

describe('E2E: API key injection (production binary)', () => {
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

  describe('49.1: api-keys.json env injection into agent process', () => {
    it('should inject env vars from api-keys.json into agent process', async () => {
      // Mock agent checks for AUTH_TOKEN env var via MOCK_REQUIRE_TOKEN
      const registryUrl = await registry.start([
        {
          id: 'keyed-agent',
          name: 'Keyed Agent',
          cmd: 'node',
          args: [MOCK_AGENT_PATH],
        },
      ]);

      const apiKeysPath = apiKeys.createApiKeysFile({
        'keyed-agent': {
          apiKey: 'test-api-key-123',
          env: {
            AUTH_TOKEN: 'test-api-key-123',
            MOCK_REQUIRE_TOKEN: 'true',
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
        id: 'init-key',
        method: 'initialize',
        agentId: 'keyed-agent',
        params: { clientInfo: { name: 'Test', version: '1.0.0' } },
      });
      await launcher.waitForResponse('init-key', 15000);

      // session/new — agent checks for AUTH_TOKEN env
      launcher.sendMessage({
        jsonrpc: '2.0',
        id: 'session-key',
        method: 'session/new',
        agentId: 'keyed-agent',
        params: {},
      });

      const resp = (await launcher.waitForResponse('session-key', 10000)) as Record<string, unknown>;
      expect(resp.jsonrpc).toBe('2.0');
      expect(resp.id).toBe('session-key');
      // Should succeed because AUTH_TOKEN was injected
      expect(resp.result).toBeDefined();
      expect((resp.result as Record<string, unknown>).sessionId).toBeDefined();
    }, 30000);
  });

  describe('49.2: Missing api-keys → agent works without credentials', () => {
    it('should allow agent without auth requirements to work with empty api-keys', async () => {
      // Agent does NOT require token (MOCK_REQUIRE_TOKEN defaults to false)
      const registryUrl = await registry.start([
        {
          id: 'open-agent',
          name: 'Open Agent',
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

      // Initialize
      launcher.sendMessage({
        jsonrpc: '2.0',
        id: 'init-open',
        method: 'initialize',
        agentId: 'open-agent',
        params: { clientInfo: { name: 'Test', version: '1.0.0' } },
      });
      await launcher.waitForResponse('init-open', 15000);

      // session/new should succeed
      launcher.sendMessage({
        jsonrpc: '2.0',
        id: 'session-open',
        method: 'session/new',
        agentId: 'open-agent',
        params: {},
      });

      const resp = (await launcher.waitForResponse('session-open', 10000)) as Record<string, unknown>;
      expect(resp.result).toBeDefined();
      expect((resp.result as Record<string, unknown>).sessionId).toBeDefined();

      // session/prompt should also succeed
      const sessionId = (resp.result as Record<string, unknown>).sessionId as string;
      launcher.sendMessage({
        jsonrpc: '2.0',
        id: 'prompt-open',
        method: 'session/prompt',
        agentId: 'open-agent',
        params: {
          sessionId,
          messages: [{ role: 'user', content: { type: 'text', text: 'Hello' } }],
        },
      });

      const promptResp = (await launcher.waitForResponse('prompt-open', 10000)) as Record<string, unknown>;
      expect(promptResp.result).toBeDefined();
    }, 30000);
  });

  describe('49.3: Agent not found in registry', () => {
    it('should return error for non-existent agentId', async () => {
      const registryUrl = await registry.start([
        {
          id: 'real-agent',
          name: 'Real Agent',
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

      // Request with non-existent agent
      launcher.sendMessage({
        jsonrpc: '2.0',
        id: 'init-ghost',
        method: 'initialize',
        agentId: 'non-existent-agent',
        params: { clientInfo: { name: 'Test', version: '1.0.0' } },
      });

      const resp = (await launcher.waitForResponse('init-ghost', 15000)) as Record<string, unknown>;
      expect(resp.jsonrpc).toBe('2.0');
      expect(resp.id).toBe('init-ghost');
      expect(resp.error).toBeDefined();

      const error = resp.error as Record<string, unknown>;
      // Should be an agent-not-found or similar error
      expect(typeof error.code).toBe('number');
      expect(typeof error.message).toBe('string');
    }, 30000);
  });
});
