/*
 * Apache License 2.0
 * Copyright (c) 2025–present Raman Marozau, Target Insight Function.
 */

/**
 * Production E2E: Terminal Auth flow tests.
 *
 * Tests Terminal Auth (type: "terminal") through the production binary:
 * - Non-TTY environment → fallback/failure
 *
 * All tests spawn `node dist/registry-launcher/index.js`.
 * No imports from src/.
 *
 * @module tests/e2e/production-terminal-auth.e2e.test
 */

import * as path from 'path';
import { LauncherHarness, MockRegistryServer, ApiKeysHelper } from './helpers';

const MOCK_TERMINAL_AGENT_PATH = path.resolve(
  __dirname,
  'fixtures/agents/mock-terminal-agent.mjs',
);

describe('E2E: Terminal Auth flow (production binary)', () => {
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

  describe('52.1: Terminal Auth in non-TTY environment → fallback', () => {
    it('should fail Terminal Auth when launcher is in non-TTY (piped) mode', async () => {
      const registryUrl = await registry.start([
        {
          id: 'terminal-agent',
          name: 'Terminal Agent',
          cmd: 'node',
          args: [MOCK_TERMINAL_AGENT_PATH],
        },
      ]);

      const apiKeysPath = apiKeys.createEmptyApiKeysFile();

      // Launcher is spawned with piped stdio (non-TTY)
      await launcher.start({
        registryUrl,
        apiKeysPath,
        env: { AUTH_AUTO_OAUTH: 'true' },
      });

      // Initialize — agent returns authMethods with type: "terminal"
      launcher.sendMessage({
        jsonrpc: '2.0',
        id: 'init-terminal',
        method: 'initialize',
        agentId: 'terminal-agent',
        params: { clientInfo: { name: 'Test', version: '1.0.0' } },
      });

      const initResp = (await launcher.waitForResponse('init-terminal', 15000)) as Record<string, unknown>;
      expect(initResp.result).toBeDefined();

      // Wait for Terminal Auth to be attempted and fail (non-TTY)
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // session/new should fail because Terminal Auth failed in non-TTY
      launcher.sendMessage({
        jsonrpc: '2.0',
        id: 'session-terminal',
        method: 'session/new',
        agentId: 'terminal-agent',
        params: {},
      });

      const sessionResp = (await launcher.waitForResponse('session-terminal', 10000)) as Record<string, unknown>;
      expect(sessionResp.jsonrpc).toBe('2.0');
      expect(sessionResp.id).toBe('session-terminal');

      // Should get an error (AUTH_REQUIRED or similar)
      expect(sessionResp.error).toBeDefined();

      const error = sessionResp.error as Record<string, unknown>;
      expect(error.code).toBe(-32004); // AUTH_REQUIRED
    }, 30000);
  });
});
