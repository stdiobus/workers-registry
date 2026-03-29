/*
 * Apache License 2.0
 * Copyright (c) 2025–present Raman Marozau, Target Insight Function.
 */

/**
 * Smoke test for E2E test infrastructure.
 *
 * Verifies that all helper classes can be instantiated and basic
 * operations work correctly.
 *
 * @module tests/e2e/infrastructure-smoke.test
 */

import { LauncherHarness, MockRegistryServer, ApiKeysHelper } from './helpers/index.js';
import * as path from 'path';

describe('E2E Infrastructure Smoke Tests', () => {
  describe('LauncherHarness', () => {
    it('should instantiate without errors', () => {
      const harness = new LauncherHarness();
      expect(harness).toBeDefined();
      expect(harness.isRunning()).toBe(false);
    });

    it('should have all required methods', () => {
      const harness = new LauncherHarness();
      expect(typeof harness.start).toBe('function');
      expect(typeof harness.sendMessage).toBe('function');
      expect(typeof harness.waitForResponse).toBe('function');
      expect(typeof harness.waitForStderr).toBe('function');
      expect(typeof harness.collectAllResponses).toBe('function');
      expect(typeof harness.stop).toBe('function');
      expect(typeof harness.getStderr).toBe('function');
      expect(typeof harness.isRunning).toBe('function');
    });
  });

  describe('MockRegistryServer', () => {
    it('should instantiate without errors', () => {
      const server = new MockRegistryServer();
      expect(server).toBeDefined();
    });

    it('should have all required methods', () => {
      const server = new MockRegistryServer();
      expect(typeof server.start).toBe('function');
      expect(typeof server.stop).toBe('function');
      expect(typeof server.getUrl).toBe('function');
    });

    it('should start and stop successfully', async () => {
      const server = new MockRegistryServer();

      const url = await server.start([
        {
          id: 'test-agent',
          name: 'Test Agent',
          cmd: 'node',
          args: ['test.js'],
        },
      ]);

      expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/registry\.json$/);
      expect(server.getUrl()).toBe(url);

      await server.stop();
    });
  });

  describe('ApiKeysHelper', () => {
    let helper: ApiKeysHelper;

    beforeEach(() => {
      helper = new ApiKeysHelper();
    });

    afterEach(() => {
      helper.cleanup();
    });

    it('should instantiate without errors', () => {
      expect(helper).toBeDefined();
    });

    it('should have all required methods', () => {
      expect(typeof helper.createApiKeysFile).toBe('function');
      expect(typeof helper.createEmptyApiKeysFile).toBe('function');
      expect(typeof helper.cleanup).toBe('function');
    });

    it('should create empty api-keys.json file', () => {
      const filePath = helper.createEmptyApiKeysFile();
      expect(filePath).toBeDefined();
      expect(filePath).toContain('api-keys.json');

      const fs = require('fs');
      expect(fs.existsSync(filePath)).toBe(true);

      const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      expect(content.version).toBe('1.0.0');
      expect(content.agents).toEqual({});
    });

    it('should create api-keys.json with agent configs', () => {
      const filePath = helper.createApiKeysFile({
        'test-agent': {
          apiKey: 'test-key-123',
          env: {
            TEST_VAR: 'test-value',
          },
        },
      });

      const fs = require('fs');
      const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));

      expect(content.version).toBe('1.0.0');
      expect(content.agents['test-agent']).toBeDefined();
      expect(content.agents['test-agent'].apiKey).toBe('test-key-123');
      expect(content.agents['test-agent'].env.TEST_VAR).toBe('test-value');
    });

    it('should cleanup temp files', () => {
      const filePath = helper.createEmptyApiKeysFile();
      const fs = require('fs');

      expect(fs.existsSync(filePath)).toBe(true);

      helper.cleanup();

      // Directory should be removed
      const dir = path.dirname(filePath);
      expect(fs.existsSync(dir)).toBe(false);
    });
  });

  describe('Mock Agents', () => {
    it('mock-acp-agent.mjs should exist and be executable', () => {
      const fs = require('fs');
      const agentPath = path.join(__dirname, 'fixtures/agents/mock-acp-agent.mjs');

      expect(fs.existsSync(agentPath)).toBe(true);

      const stats = fs.statSync(agentPath);
      expect(stats.mode & 0o111).not.toBe(0); // Check executable bit
    });

    it('mock-terminal-agent.mjs should exist and be executable', () => {
      const fs = require('fs');
      const agentPath = path.join(__dirname, 'fixtures/agents/mock-terminal-agent.mjs');

      expect(fs.existsSync(agentPath)).toBe(true);

      const stats = fs.statSync(agentPath);
      expect(stats.mode & 0o111).not.toBe(0); // Check executable bit
    });
  });
});
