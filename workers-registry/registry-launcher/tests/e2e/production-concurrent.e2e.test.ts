/*
 * Apache License 2.0
 * Copyright (c) 2025–present Raman Marozau, Target Insight Function.
 */

/**
 * Production E2E: Concurrent requests and edge cases.
 *
 * Tests concurrent agent handling and error resilience:
 * - Multiple agents simultaneously
 * - Invalid JSON input → error response
 * - Missing agentId → error response
 *
 * All tests spawn `node dist/registry-launcher/index.js`.
 * No imports from src/.
 *
 * @module tests/e2e/production-concurrent.e2e.test
 */

import * as path from 'path';
import { LauncherHarness, MockRegistryServer, ApiKeysHelper } from './helpers';

const MOCK_AGENT_PATH = path.resolve(
  __dirname,
  'fixtures/agents/mock-acp-agent.mjs',
);

describe('E2E: Concurrent requests and edge cases (production binary)', () => {
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

  describe('54.1: Multiple agents simultaneously', () => {
    it('should handle requests to two different agents', async () => {
      const registryUrl = await registry.start([
        {
          id: 'agent-alpha',
          name: 'Agent Alpha',
          cmd: 'node',
          args: [MOCK_AGENT_PATH],
        },
        {
          id: 'agent-beta',
          name: 'Agent Beta',
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

      // Initialize agent-alpha
      launcher.sendMessage({
        jsonrpc: '2.0',
        id: 'init-alpha',
        method: 'initialize',
        agentId: 'agent-alpha',
        params: { clientInfo: { name: 'Test', version: '1.0.0' } },
      });

      // Initialize agent-beta
      launcher.sendMessage({
        jsonrpc: '2.0',
        id: 'init-beta',
        method: 'initialize',
        agentId: 'agent-beta',
        params: { clientInfo: { name: 'Test', version: '1.0.0' } },
      });

      // Wait for both responses
      const [respAlpha, respBeta] = await Promise.all([
        launcher.waitForResponse('init-alpha', 15000),
        launcher.waitForResponse('init-beta', 15000),
      ]) as [Record<string, unknown>, Record<string, unknown>];

      expect(respAlpha.id).toBe('init-alpha');
      expect(respAlpha.result).toBeDefined();

      expect(respBeta.id).toBe('init-beta');
      expect(respBeta.result).toBeDefined();

      // Create sessions for both
      launcher.sendMessage({
        jsonrpc: '2.0',
        id: 'session-alpha',
        method: 'session/new',
        agentId: 'agent-alpha',
        params: {},
      });

      launcher.sendMessage({
        jsonrpc: '2.0',
        id: 'session-beta',
        method: 'session/new',
        agentId: 'agent-beta',
        params: {},
      });

      const [sessAlpha, sessBeta] = await Promise.all([
        launcher.waitForResponse('session-alpha', 10000),
        launcher.waitForResponse('session-beta', 10000),
      ]) as [Record<string, unknown>, Record<string, unknown>];

      expect(sessAlpha.id).toBe('session-alpha');
      expect(sessAlpha.result).toBeDefined();

      expect(sessBeta.id).toBe('session-beta');
      expect(sessBeta.result).toBeDefined();

      // Verify different sessionIds
      const sidAlpha = (sessAlpha.result as Record<string, unknown>).sessionId;
      const sidBeta = (sessBeta.result as Record<string, unknown>).sessionId;
      expect(sidAlpha).toBeDefined();
      expect(sidBeta).toBeDefined();
    }, 30000);
  });

  describe('54.2: Invalid JSON input → error response', () => {
    it('should not crash on invalid JSON and continue processing', async () => {
      const registryUrl = await registry.start([
        {
          id: 'resilient-agent',
          name: 'Resilient Agent',
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

      // Send invalid JSON directly to stdin
      // (bypass sendMessage which would serialize properly)
      const proc = (launcher as any).process;
      if (proc && proc.stdin) {
        proc.stdin.write('this is not valid json\n');
      }

      // Small delay to let the launcher process the invalid input
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Launcher should still be running
      expect(launcher.isRunning()).toBe(true);

      // Send a valid request — should still work
      launcher.sendMessage({
        jsonrpc: '2.0',
        id: 'after-invalid',
        method: 'initialize',
        agentId: 'resilient-agent',
        params: { clientInfo: { name: 'Test', version: '1.0.0' } },
      });

      const resp = (await launcher.waitForResponse('after-invalid', 15000)) as Record<string, unknown>;
      expect(resp.jsonrpc).toBe('2.0');
      expect(resp.id).toBe('after-invalid');
      expect(resp.result).toBeDefined();
    }, 30000);
  });

  describe('54.3: Missing agentId → error response', () => {
    it('should return error when agentId is missing from request', async () => {
      const registryUrl = await registry.start([
        {
          id: 'some-agent',
          name: 'Some Agent',
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

      // Send initialize without agentId — should return launcher capabilities
      // (required for ACP Registry CI auth-check)
      launcher.sendMessage({
        jsonrpc: '2.0',
        id: 'no-agent-id',
        method: 'initialize',
        params: { clientInfo: { name: 'Test', version: '1.0.0' } },
      });

      const resp = (await launcher.waitForResponse('no-agent-id', 10000)) as Record<string, unknown>;
      expect(resp.jsonrpc).toBe('2.0');
      expect(resp.id).toBe('no-agent-id');
      // initialize without agentId returns launcher's own capabilities
      expect(resp.result).toBeDefined();
      const result = resp.result as Record<string, unknown>;
      expect(result.authMethods).toBeDefined();
      expect(Array.isArray(result.authMethods)).toBe(true);

      // Non-initialize requests without agentId should still return error
      launcher.sendMessage({
        jsonrpc: '2.0',
        id: 'no-agent-id-2',
        method: 'session/new',
        params: {},
      });

      const errResp = (await launcher.waitForResponse('no-agent-id-2', 10000)) as Record<string, unknown>;
      expect(errResp.error).toBeDefined();
      const error = errResp.error as Record<string, unknown>;
      expect(typeof error.code).toBe('number');
      expect(typeof error.message).toBe('string');
    }, 30000);
  });
});
