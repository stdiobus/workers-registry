/**
 * Tests for the universal worker launcher (TypeScript version)
 * 
 * The launcher is now implemented in TypeScript at workers-registry/launcher/index.ts
 * and compiled to out/dist/workers/launcher/index.js
 */

import { describe, it, expect } from '@jest/globals';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const launcherPath = join(__dirname, '../../index.js');

/**
 * Helper to run launcher and capture output
 */
function runLauncher(args, input = null) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [launcherPath, ...args], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });

    proc.on('error', reject);

    if (input) {
      proc.stdin.write(input);
      proc.stdin.end();
    } else {
      proc.stdin.end();
    }

    // Kill after 2 seconds to prevent hanging
    setTimeout(() => {
      proc.kill();
      reject(new Error('Process timeout'));
    }, 2000);
  });
}

describe('Universal Worker Launcher', () => {
  it('should show usage when no worker name provided', async () => {
    const result = await runLauncher([]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Error: Worker name is required');
    expect(result.stderr).toContain('Available workers:');
    expect(result.stderr).toContain('acp-worker');
    expect(result.stderr).toContain('echo-worker');
  });

  it('should show error for unknown worker', async () => {
    const result = await runLauncher(['unknown-worker']);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Error: Unknown worker "unknown-worker"');
    expect(result.stderr).toContain('Available workers:');
  });

  it('should start echo-worker and process messages', async () => {
    const input = JSON.stringify({
      jsonrpc: '2.0',
      id: 'test-1',
      method: 'echo',
      params: { message: 'Hello from test' }
    }) + '\n';

    const result = await runLauncher(['echo-worker'], input);

    expect(result.stderr).toContain('[launcher] Starting worker: echo-worker');
    expect(result.stderr).toContain('[launcher] Description:');
    expect(result.stderr).toContain('[echo-worker] Started');

    // Parse the JSON response
    const lines = result.stdout.trim().split('\n');
    expect(lines.length).toBeGreaterThan(0);

    const response = JSON.parse(lines[0]);
    expect(response.jsonrpc).toBe('2.0');
    expect(response.id).toBe('test-1');
    expect(response.result.echo.message).toBe('Hello from test');
  });

  it('should show error if worker file not found', async () => {
    // This test assumes the build hasn't been run or out/ doesn't exist
    // We'll skip it if the files exist
    const { access } = await import('fs/promises');
    const workerPath = join(__dirname, '../../out/dist/workers/echo-worker/echo-worker.js');

    try {
      await access(workerPath);
      // Worker exists, skip this test
      expect(true).toBe(true);
    } catch {
      // Worker doesn't exist, test the error message
      const result = await runLauncher(['echo-worker']);

      expect(result.code).toBe(1);
      expect(result.stderr).toContain('Worker file not found');
      expect(result.stderr).toContain('Please run "npm run build"');
    }
  });
});
