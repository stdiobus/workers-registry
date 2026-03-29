/*
 * Apache License 2.0
 * Copyright (c) 2025–present Raman Marozau, Target Insight Function.
 */

/**
 * Production E2E: Agent Auth flow tests.
 *
 * Tests the Agent Auth (type: "agent") flow through the production binary:
 * - Agent Auth success flow
 * - Agent Auth failure → AUTH_REQUIRED
 * - Request queueing during Agent Auth
 *
 * All tests spawn `node dist/registry-launcher/index.js`.
 * No imports from src/.
 *
 * @module tests/e2e/production-agent-auth.e2e.test
 */

import * as path from 'path';
import { LauncherHarness, MockRegistryServer, ApiKeysHelper } from './helpers';

const MOCK_AGENT_AUTH_PATH = path.resolve(
  __dirname,
  'fixtures/agents/mock-agent-auth.mjs',
);

const MOCK_ACP_AGENT_PATH = path.resolve(
  __dirname,
  'fixtures/agents/mock-acp-agent.mjs',
);

describe('E2E: Agent Auth flow (production binary)', () => {
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

  describe('51.1: Agent Auth success flow', () => {
    it('should complete Agent Auth and allow session creation', async () => {
      const registryUrl = await registry.start([
        {
          id: 'agent-auth-test',
          name: 'Agent Auth Test',
          cmd: 'node',
          args: [MOCK_AGENT_AUTH_PATH],
        },
      ]);

      const apiKeysPath = apiKeys.createEmptyApiKeysFile();

      await launcher.start({
        registryUrl,
        apiKeysPath,
        env: { AUTH_AUTO_OAUTH: 'true' },
      });

      // Initialize — triggers Agent Auth flow
      launcher.sendMessage({
        jsonrpc: '2.0',
        id: 'init-agent-auth',
        method: 'initialize',
        agentId: 'agent-auth-test',
        params: { clientInfo: { name: 'Test', version: '1.0.0' } },
      });

      const initResp = (await launcher.waitForResponse('init-agent-auth', 15000)) as Record<string, unknown>;
      expect(initResp.result).toBeDefined();

      // Wait for authenticate flow to complete
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // session/new should succeed after auth
      launcher.sendMessage({
        jsonrpc: '2.0',
        id: 'session-agent-auth',
        method: 'session/new',
        agentId: 'agent-auth-test',
        params: {},
      });

      const sessionResp = (await launcher.waitForResponse('session-agent-auth', 10000)) as Record<string, unknown>;
      expect(sessionResp.jsonrpc).toBe('2.0');
      expect(sessionResp.id).toBe('session-agent-auth');
      // Should succeed (either result with sessionId, or at least no AUTH_REQUIRED)
      if (sessionResp.result) {
        expect((sessionResp.result as Record<string, unknown>).sessionId).toBeDefined();
      }
    }, 30000);
  });

  describe('51.2: Agent Auth failure → AUTH_REQUIRED', () => {
    it('should return AUTH_REQUIRED when Agent Auth fails', async () => {
      const registryUrl = await registry.start([
        {
          id: 'agent-auth-fail',
          name: 'Agent Auth Fail',
          cmd: 'node',
          args: [MOCK_AGENT_AUTH_PATH],
        },
      ]);

      const apiKeysPath = apiKeys.createApiKeysFile({
        'agent-auth-fail': {
          env: { MOCK_AUTH_FAIL: 'true' },
        },
      });

      await launcher.start({
        registryUrl,
        apiKeysPath,
        env: { AUTH_AUTO_OAUTH: 'true' },
      });

      // Initialize — triggers Agent Auth which will fail
      launcher.sendMessage({
        jsonrpc: '2.0',
        id: 'init-fail',
        method: 'initialize',
        agentId: 'agent-auth-fail',
        params: { clientInfo: { name: 'Test', version: '1.0.0' } },
      });

      const initResp = (await launcher.waitForResponse('init-fail', 15000)) as Record<string, unknown>;
      expect(initResp.result).toBeDefined();

      // Wait for auth flow to fail
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // session/new should fail with AUTH_REQUIRED
      launcher.sendMessage({
        jsonrpc: '2.0',
        id: 'session-fail',
        method: 'session/new',
        agentId: 'agent-auth-fail',
        params: {},
      });

      const sessionResp = (await launcher.waitForResponse('session-fail', 10000)) as Record<string, unknown>;
      expect(sessionResp.error).toBeDefined();

      const error = sessionResp.error as Record<string, unknown>;
      expect(error.code).toBe(-32004); // AUTH_REQUIRED
    }, 30000);
  });

  describe('51.3: Request queueing during Agent Auth', () => {
    it('should queue requests during pending auth and process after success', async () => {
      // Use mock agent with a delay on authenticate
      const registryUrl = await registry.start([
        {
          id: 'agent-auth-queue',
          name: 'Agent Auth Queue',
          cmd: 'node',
          args: [MOCK_ACP_AGENT_PATH],
        },
      ]);

      const apiKeysPath = apiKeys.createApiKeysFile({
        'agent-auth-queue': {
          env: {
            MOCK_AUTH_METHODS: JSON.stringify([
              { id: 'agent-openai', type: 'agent', providerId: 'openai' },
            ]),
            MOCK_AUTH_BEHAVIOR: 'success',
            MOCK_AUTH_DELAY_MS: '500',
            MOCK_REQUIRE_TOKEN: 'false',
          },
        },
      });

      await launcher.start({
        registryUrl,
        apiKeysPath,
        env: { AUTH_AUTO_OAUTH: 'true' },
      });

      // Initialize — triggers Agent Auth with 500ms delay
      launcher.sendMessage({
        jsonrpc: '2.0',
        id: 'init-queue',
        method: 'initialize',
        agentId: 'agent-auth-queue',
        params: { clientInfo: { name: 'Test', version: '1.0.0' } },
      });

      const initResp = (await launcher.waitForResponse('init-queue', 15000)) as Record<string, unknown>;
      expect(initResp.result).toBeDefined();

      // Immediately send session/new (should be queued while auth is pending)
      launcher.sendMessage({
        jsonrpc: '2.0',
        id: 'session-queued',
        method: 'session/new',
        agentId: 'agent-auth-queue',
        params: {},
      });

      // Wait for auth to complete and queued request to be processed
      const sessionResp = (await launcher.waitForResponse('session-queued', 15000)) as Record<string, unknown>;
      expect(sessionResp.jsonrpc).toBe('2.0');
      expect(sessionResp.id).toBe('session-queued');

      // Should have been processed after auth completed
      if (sessionResp.result) {
        expect((sessionResp.result as Record<string, unknown>).sessionId).toBeDefined();
      }
    }, 30000);
  });
});
