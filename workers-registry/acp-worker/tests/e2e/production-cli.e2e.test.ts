/*
 * Apache License 2.0
 * Copyright (c) 2025–present Raman Marozau, Target Insight Function.
 */

/**
 * Production E2E: CLI command tests.
 *
 * Tests CLI commands through the production binary:
 * - --auth-status exit code and output
 * - --logout exit code
 * - --login with invalid provider
 * - --login without argument
 *
 * All tests spawn `node dist/registry-launcher/index.js` with CLI args.
 * No imports from src/.
 *
 * @module tests/e2e/production-cli.e2e.test
 */

import { spawn } from 'child_process';
import * as path from 'path';

const LAUNCHER_PATH = path.resolve(
  __dirname,
  '../../dist/registry-launcher/index.js',
);

/**
 * Run the launcher with CLI args and capture output.
 */
function runCli(
  args: string[],
  env?: Record<string, string>,
  timeoutMs = 15000,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [LAUNCHER_PATH, ...args], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout!.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr!.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`CLI command timed out after ${timeoutMs}ms. stderr: ${stderr}`));
    }, timeoutMs);

    proc.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

describe('E2E: CLI commands (production binary)', () => {
  describe('53.1: --auth-status exit code and output', () => {
    it('should exit with code 0 and show provider status', async () => {
      const result = await runCli(['--auth-status']);

      expect(result.exitCode).toBe(0);

      // Should show OAuth provider names in stderr
      expect(result.stderr).toMatch(/github|google|azure|cognito|oidc|entra/i);

      // Should show Model API Keys section
      expect(result.stderr).toMatch(/openai|anthropic|api.key|model/i);
    }, 15000);
  });

  describe('53.2: --logout exit code', () => {
    it('should exit with code 0 and show confirmation', async () => {
      const result = await runCli(['--logout']);

      expect(result.exitCode).toBe(0);

      // Should show logout/cleared message in stderr
      expect(result.stderr).toMatch(/logout|cleared|removed|credentials/i);
    }, 15000);
  });

  describe('53.3: --login with invalid provider', () => {
    it('should exit with code 1 and show error with supported providers', async () => {
      const result = await runCli(['--login', 'invalid-provider']);

      expect(result.exitCode).toBe(1);

      // Should show error about invalid provider
      expect(result.stderr).toMatch(/invalid|unsupported|unknown/i);

      // Should list supported providers
      expect(result.stderr).toMatch(/github|google|azure|cognito|oidc/i);
    }, 15000);
  });

  describe('53.4: --login without argument', () => {
    it('should exit with code 1 and show usage message', async () => {
      const result = await runCli(['--login']);

      expect(result.exitCode).toBe(1);

      // Should show error about missing provider argument
      expect(result.stderr).toMatch(/--login requires|provider|argument|usage/i);
    }, 15000);
  });
});
