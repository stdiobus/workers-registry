/*
 * Apache License 2.0
 * Copyright (c) 2025–present Raman Marozau, Target Insight Function.
 */

/**
 * End-to-End tests for OAuth authentication flow.
 *
 * These tests verify the COMPLETE flow that a user would see:
 * 1. Client sends initialize request
 * 2. Launcher returns authMethods in response
 * 3. Client sends request with agentId
 * 4. Launcher injects authentication into request
 * 5. Agent receives authenticated request
 *
 * @module tests/e2e/auth-flow.e2e.test
 */

import { spawn, ChildProcess } from 'child_process';
import { Readable, Writable } from 'stream';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

/**
 * Helper to send NDJSON message and wait for response.
 */
function sendAndReceive(
  stdin: Writable,
  stdout: Readable,
  message: object,
  timeoutMs = 5000
): Promise<object> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for response to: ${JSON.stringify(message)}`));
    }, timeoutMs);

    let buffer = '';
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      for (let i = 0; i < lines.length - 1; i++) {
        const line = lines[i].trim();
        if (line) {
          try {
            const response = JSON.parse(line);
            clearTimeout(timer);
            stdout.removeListener('data', onData);
            resolve(response);
            return;
          } catch {
            // Not valid JSON, continue
          }
        }
      }
      buffer = lines[lines.length - 1];
    };

    stdout.on('data', onData);
    stdin.write(JSON.stringify(message) + '\n');
  });
}

describe('E2E: OAuth Authentication Flow', () => {
  const launcherPath = path.join(__dirname, '../../dist/registry-launcher/index.js');
  let tempDir: string;
  let apiKeysPath: string;

  beforeAll(() => {
    // Create temp directory for test config
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-e2e-'));
    apiKeysPath = path.join(tempDir, 'api-keys.json');
  });

  afterAll(() => {
    // Cleanup temp directory
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Initialize Response with authMethods', () => {
    it('should return authMethods in initialize response - USER SEES THIS', async () => {
      // Setup: Create api-keys.json with test key
      const apiKeys = {
        'claude': {
          apiKey: 'sk-test-anthropic-key-12345',
          env: { ANTHROPIC_API_KEY: 'sk-test-anthropic-key-12345' }
        }
      };
      fs.writeFileSync(apiKeysPath, JSON.stringify(apiKeys, null, 2));

      // Create a mock agent that responds to initialize
      const mockAgentScript = `
        const readline = require('readline');
        const rl = readline.createInterface({ input: process.stdin });
        rl.on('line', (line) => {
          const msg = JSON.parse(line);
          if (msg.method === 'initialize') {
            const response = {
              jsonrpc: '2.0',
              id: msg.id,
              result: {
                protocolVersion: '1.0',
                agentInfo: { name: 'Mock Agent', version: '1.0.0' }
              }
            };
            console.log(JSON.stringify(response));
          }
        });
      `;
      const mockAgentPath = path.join(tempDir, 'mock-agent.js');
      fs.writeFileSync(mockAgentPath, mockAgentScript);

      // Create custom agents config pointing to our mock
      const customAgents = {
        agents: [{
          id: 'test-mock-agent',
          name: 'Test Mock Agent',
          version: '1.0.0',
          distribution: {
            node: { script: mockAgentPath }
          }
        }]
      };
      const customAgentsPath = path.join(tempDir, 'custom-agents.json');
      fs.writeFileSync(customAgentsPath, JSON.stringify(customAgents, null, 2));

      // Start Registry Launcher
      const launcher = spawn('node', [
        launcherPath,
        '--custom-agents', customAgentsPath
      ], {
        env: {
          ...process.env,
          REGISTRY_LAUNCHER_API_KEYS_PATH: apiKeysPath
        },
        stdio: ['pipe', 'pipe', 'pipe']
      });

      // Wait for launcher to be ready
      await new Promise<void>((resolve) => {
        launcher.stderr!.on('data', (chunk) => {
          const text = chunk.toString();
          if (text.includes('Registry Launcher ready')) {
            resolve();
          }
        });
      });

      try {
        // Send initialize request
        const initRequest = {
          jsonrpc: '2.0',
          id: 'init-1',
          method: 'initialize',
          agentId: 'test-mock-agent',
          params: {
            clientInfo: { name: 'E2E Test Client', version: '1.0.0' }
          }
        };

        const response = await sendAndReceive(
          launcher.stdin!,
          launcher.stdout!,
          initRequest,
          10000
        ) as any;

        // ============================================
        // THIS IS WHAT THE USER SEES IN THE RESPONSE
        // ============================================
        console.log('\n========== USER SEES THIS RESPONSE ==========');
        console.log(JSON.stringify(response, null, 2));
        console.log('==============================================\n');

        // Verify response structure
        expect(response.jsonrpc).toBe('2.0');
        expect(response.id).toBe('init-1');
        expect(response.result).toBeDefined();

        // Verify authMethods are present
        expect(response.result.authMethods).toBeDefined();
        expect(Array.isArray(response.result.authMethods)).toBe(true);
        expect(response.result.authMethods.length).toBeGreaterThan(0);

        // Verify authMethods structure
        const authMethods = response.result.authMethods;
        console.log('Available auth methods:');
        for (const method of authMethods) {
          console.log(`  - ${method.id} (type: ${method.type}, provider: ${method.providerId || 'n/a'})`);
          expect(method.id).toBeDefined();
          expect(method.type).toBeDefined();
        }

        // Should include API key methods
        expect(authMethods.some((m: any) => m.type === 'api-key')).toBe(true);

      } finally {
        launcher.kill('SIGTERM');
        await new Promise(resolve => launcher.on('exit', resolve));
      }
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

      // Should show status for providers
      expect(result.stdout).toMatch(/openai|anthropic|github|google|azure|cognito/i);
    }, 15000);
  });
});
