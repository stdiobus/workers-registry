/*
 * Apache License 2.0
 * Copyright (c) 2025–present Raman Marozau, Target Insight Function.
 */

/**
 * Production E2E: Full request lifecycle tests.
 *
 * Tests the complete ACP lifecycle through the production binary:
 * - initialize → session/new → prompt → response
 * - NDJSON protocol compliance
 * - Graceful shutdown
 *
 * All tests spawn `node dist/registry-launcher/index.js` as a separate process.
 * No imports from src/ are allowed.
 *
 * @module tests/e2e/production-lifecycle.e2e.test
 */

import * as path from 'path';
import { LauncherHarness, MockRegistryServer, ApiKeysHelper } from './helpers';

const MOCK_AGENT_PATH = path.resolve(
  __dirname,
  'fixtures/agents/mock-acp-agent.mjs',
);

describe('E2E: Full request lifecycle (production binary)', () => {
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

  describe('48.1: initialize → session/new → prompt → response (happy path)', () => {
    it('should complete full ACP lifecycle', async () => {
      const registryUrl = await registry.start([
        {
          id: 'echo-agent',
          name: 'Echo Agent',
          cmd: 'node',
          args: [MOCK_AGENT_PATH],
        },
      ]);

      const apiKeysPath = apiKeys.createApiKeysFile({
        'echo-agent': {
          apiKey: 'test-key',
          env: { TEST_API_KEY: 'test-key' },
        },
      });

      await launcher.start({
        registryUrl,
        apiKeysPath,
        env: { AUTH_AUTO_OAUTH: 'false' },
      });

      // Step 1: initialize
      launcher.sendMessage({
        jsonrpc: '2.0',
        id: 'init-1',
        method: 'initialize',
        agentId: 'echo-agent',
        params: { clientInfo: { name: 'E2E Test', version: '1.0.0' } },
      });

      const initResp = (await launcher.waitForResponse('init-1', 15000)) as Record<string, unknown>;
      expect(initResp.jsonrpc).toBe('2.0');
      expect(initResp.id).toBe('init-1');
      expect(initResp.result).toBeDefined();

      const initResult = initResp.result as Record<string, unknown>;
      expect(initResult.protocolVersion).toBeDefined();
      expect(initResult.authMethods).toBeDefined();
      expect(Array.isArray(initResult.authMethods)).toBe(true);

      // Step 2: session/new
      launcher.sendMessage({
        jsonrpc: '2.0',
        id: 'session-1',
        method: 'session/new',
        agentId: 'echo-agent',
        params: {},
      });

      const sessionResp = (await launcher.waitForResponse('session-1', 10000)) as Record<string, unknown>;
      expect(sessionResp.jsonrpc).toBe('2.0');
      expect(sessionResp.id).toBe('session-1');
      expect(sessionResp.result).toBeDefined();

      const sessionResult = sessionResp.result as Record<string, unknown>;
      const sessionId = sessionResult.sessionId as string;
      expect(sessionId).toBeDefined();
      expect(typeof sessionId).toBe('string');

      // Step 3: session/prompt
      launcher.sendMessage({
        jsonrpc: '2.0',
        id: 'prompt-1',
        method: 'session/prompt',
        agentId: 'echo-agent',
        params: {
          sessionId,
          messages: [{ role: 'user', content: { type: 'text', text: 'Hello' } }],
        },
      });

      const promptResp = (await launcher.waitForResponse('prompt-1', 10000)) as Record<string, unknown>;
      expect(promptResp.jsonrpc).toBe('2.0');
      expect(promptResp.id).toBe('prompt-1');
      expect(promptResp.result).toBeDefined();

      const promptResult = promptResp.result as Record<string, unknown>;
      expect(promptResult.content).toBeDefined();
      expect(Array.isArray(promptResult.content)).toBe(true);

      // Verify stdout contains ONLY valid NDJSON
      const allResponses = await launcher.collectAllResponses(500);
      for (const resp of allResponses) {
        expect(typeof resp).toBe('object');
        expect((resp as Record<string, unknown>).jsonrpc).toBe('2.0');
      }
    }, 30000);
  });

  describe('48.2: NDJSON protocol compliance', () => {
    it('should return valid JSON-RPC 2.0 responses with correct id preservation', async () => {
      const registryUrl = await registry.start([
        {
          id: 'echo-agent',
          name: 'Echo Agent',
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

      // Send multiple requests with different ids
      const ids = ['req-alpha', 'req-beta'];

      launcher.sendMessage({
        jsonrpc: '2.0',
        id: ids[0],
        method: 'initialize',
        agentId: 'echo-agent',
        params: { clientInfo: { name: 'Test', version: '1.0.0' } },
      });

      const resp1 = (await launcher.waitForResponse(ids[0], 15000)) as Record<string, unknown>;

      // Verify JSON-RPC 2.0 structure
      expect(resp1.jsonrpc).toBe('2.0');
      expect(resp1.id).toBe(ids[0]);
      // Must have either result or error
      expect(resp1.result !== undefined || resp1.error !== undefined).toBe(true);

      // Send session/new
      launcher.sendMessage({
        jsonrpc: '2.0',
        id: ids[1],
        method: 'session/new',
        agentId: 'echo-agent',
        params: {},
      });

      const resp2 = (await launcher.waitForResponse(ids[1], 10000)) as Record<string, unknown>;
      expect(resp2.jsonrpc).toBe('2.0');
      expect(resp2.id).toBe(ids[1]);
    }, 30000);

    it('should preserve sessionId in responses', async () => {
      const registryUrl = await registry.start([
        {
          id: 'echo-agent',
          name: 'Echo Agent',
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

      // Initialize first
      launcher.sendMessage({
        jsonrpc: '2.0',
        id: 'init-sid',
        method: 'initialize',
        agentId: 'echo-agent',
        params: { clientInfo: { name: 'Test', version: '1.0.0' } },
      });
      await launcher.waitForResponse('init-sid', 15000);

      // Create session
      launcher.sendMessage({
        jsonrpc: '2.0',
        id: 'new-sid',
        method: 'session/new',
        agentId: 'echo-agent',
        params: {},
      });

      const sessionResp = (await launcher.waitForResponse('new-sid', 10000)) as Record<string, unknown>;
      const sessionResult = sessionResp.result as Record<string, unknown>;
      const sessionId = sessionResult.sessionId as string;

      // Send prompt with sessionId
      launcher.sendMessage({
        jsonrpc: '2.0',
        id: 'prompt-sid',
        method: 'session/prompt',
        agentId: 'echo-agent',
        sessionId,
        params: {
          sessionId,
          messages: [{ role: 'user', content: { type: 'text', text: 'test' } }],
        },
      });

      const promptResp = (await launcher.waitForResponse('prompt-sid', 10000)) as Record<string, unknown>;
      // sessionId should be preserved in the response
      if (promptResp.sessionId) {
        expect(promptResp.sessionId).toBe(sessionId);
      }
    }, 30000);
  });

  describe('48.3: Graceful shutdown', () => {
    it('should exit with code 0 on SIGTERM after active session', async () => {
      const registryUrl = await registry.start([
        {
          id: 'echo-agent',
          name: 'Echo Agent',
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

      // Initialize and create a session
      launcher.sendMessage({
        jsonrpc: '2.0',
        id: 'init-shutdown',
        method: 'initialize',
        agentId: 'echo-agent',
        params: { clientInfo: { name: 'Test', version: '1.0.0' } },
      });
      await launcher.waitForResponse('init-shutdown', 15000);

      launcher.sendMessage({
        jsonrpc: '2.0',
        id: 'session-shutdown',
        method: 'session/new',
        agentId: 'echo-agent',
        params: {},
      });
      await launcher.waitForResponse('session-shutdown', 10000);

      // Send SIGTERM
      const { exitCode } = await launcher.stop();
      expect(exitCode).toBe(0);
    }, 30000);

    it('should exit with code 0 on SIGTERM before any requests', async () => {
      const registryUrl = await registry.start([
        {
          id: 'echo-agent',
          name: 'Echo Agent',
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

      // Immediately stop without sending any requests
      const { exitCode } = await launcher.stop();
      expect(exitCode).toBe(0);
    }, 15000);
  });
});
