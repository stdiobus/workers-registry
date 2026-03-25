/*
 * Apache License 2.0
 * Copyright (c) 2025–present Raman Marozau, Target Insight Function.
 */

/**
 * End-to-End tests for OAuth authentication flow.
 *
 * These tests verify the CLI commands that a user would see.
 * Full launcher integration tests are covered in unit/integration tests.
 *
 * @module tests/e2e/auth-flow.e2e.test
 */

import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

describe('E2E: OAuth Authentication Flow', () => {
  const launcherPath = path.join(__dirname, '../../dist/registry-launcher/index.js');
  let tempDir: string;

  beforeAll(() => {
    // Create temp directory for test config
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-e2e-'));
  });

  afterAll(() => {
    // Cleanup temp directory
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Initialize Response with authMethods', () => {
    /**
     * This test is skipped because it requires complex infrastructure:
     * 1. A mock registry server
     * 2. A custom agent that can be spawned via npx/uvx/binary
     * 
     * The authMethods injection is thoroughly tested in:
     * - src/registry-launcher/router/message-router.test.ts
     * - src/registry-launcher/auth/integration.test.ts
     * 
     * For manual verification:
     * 1. Start the launcher with a real agent
     * 2. Send an initialize request
     * 3. Verify authMethods are present in the response
     */
    it.skip('should return authMethods in initialize response - requires real agent', async () => {
      // This test requires a real agent to be spawned, which is complex to set up
      // See the unit tests for authMethods injection verification
    }, 30000);
  });

  describe('--auth-status CLI command', () => {
    it('should show authentication status - USER SEES THIS', async () => {
      // Run --auth-status command
      const result = await new Promise<{ stdout: string; stderr: string; code: number }>((resolve) => {
        const proc = spawn('node', [launcherPath, '--auth-status'], {
          stdio: ['pipe', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';

        proc.stdout!.on('data', (chunk) => { stdout += chunk.toString(); });
        proc.stderr!.on('data', (chunk) => { stderr += chunk.toString(); });

        proc.on('exit', (code) => {
          resolve({ stdout, stderr, code: code ?? 1 });
        });
      });

      // ============================================
      // THIS IS WHAT THE USER SEES IN THE TERMINAL
      // ============================================
      console.log('\n========== USER SEES THIS OUTPUT ==========');
      console.log('STDOUT:', result.stdout);
      console.log('STDERR:', result.stderr);
      console.log('Exit code:', result.code);
      console.log('============================================\n');

      // Should exit with code 0
      expect(result.code).toBe(0);

      // Should show status for providers (output goes to stderr per NDJSON protocol)
      expect(result.stderr).toMatch(/openai|anthropic|github|google|azure|cognito/i);
    }, 15000);
  });

  describe('--login CLI command', () => {
    it('should show error for missing provider argument', async () => {
      const result = await new Promise<{ stdout: string; stderr: string; code: number }>((resolve) => {
        const proc = spawn('node', [launcherPath, '--login'], {
          stdio: ['pipe', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';

        proc.stdout!.on('data', (chunk) => { stdout += chunk.toString(); });
        proc.stderr!.on('data', (chunk) => { stderr += chunk.toString(); });

        proc.on('exit', (code) => {
          resolve({ stdout, stderr, code: code ?? 1 });
        });
      });

      // Should exit with error code
      expect(result.code).toBe(1);

      // Should show error message about missing provider
      expect(result.stderr).toMatch(/--login requires a provider argument/i);
    }, 15000);

    it('should show error for invalid provider', async () => {
      const result = await new Promise<{ stdout: string; stderr: string; code: number }>((resolve) => {
        const proc = spawn('node', [launcherPath, '--login', 'invalid-provider'], {
          stdio: ['pipe', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';

        proc.stdout!.on('data', (chunk) => { stdout += chunk.toString(); });
        proc.stderr!.on('data', (chunk) => { stderr += chunk.toString(); });

        proc.on('exit', (code) => {
          resolve({ stdout, stderr, code: code ?? 1 });
        });
      });

      // Should exit with error code
      expect(result.code).toBe(1);

      // Should show error message about invalid provider
      expect(result.stderr).toMatch(/invalid provider/i);
    }, 15000);
  });

  describe('--logout CLI command', () => {
    it('should complete logout for all providers', async () => {
      const result = await new Promise<{ stdout: string; stderr: string; code: number }>((resolve) => {
        const proc = spawn('node', [launcherPath, '--logout'], {
          stdio: ['pipe', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';

        proc.stdout!.on('data', (chunk) => { stdout += chunk.toString(); });
        proc.stderr!.on('data', (chunk) => { stderr += chunk.toString(); });

        proc.on('exit', (code) => {
          resolve({ stdout, stderr, code: code ?? 1 });
        });
      });

      // Should exit with code 0
      expect(result.code).toBe(0);

      // Should show logout message
      expect(result.stderr).toMatch(/logout|cleared|removed/i);
    }, 15000);
  });
});
