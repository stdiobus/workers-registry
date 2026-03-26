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
 * 3. CLI commands work correctly
 *
 * @module tests/e2e/auth-flow.e2e.test
 */

import { spawn, ChildProcess } from 'child_process';
import { createServer, Server, IncomingMessage, ServerResponse } from 'http';
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
  timeoutMs = 10000
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

/**
 * Create a simple HTTP server that serves a mock registry.
 */
function createMockRegistryServer(registry: object): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer((_req: IncomingMessage, res: ServerResponse) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(registry));
    });

    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') {
        const url = `http://127.0.0.1:${address.port}/registry.json`;
        resolve({ server, url });
      }
    });
  });
}

/**
 * Wait for launcher to be ready by monitoring stderr.
 */
function waitForLauncherReady(
  launcher: ChildProcess,
  timeoutMs = 15000
): Promise<void> {
  return new Promise((resolve, reject) => {
    let launcherReady = false;
    let stderrOutput = '';

    const timeout = setTimeout(() => {
      reject(new Error(`Launcher did not become ready within ${timeoutMs}ms. Stderr: ${stderrOutput}`));
    }, timeoutMs);

    launcher.stderr!.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderrOutput += text;
      if (text.includes('Registry Launcher ready')) {
        launcherReady = true;
        clearTimeout(timeout);
        resolve();
      }
    });

    launcher.on('exit', (code) => {
      if (!launcherReady) {
        clearTimeout(timeout);
        reject(new Error(`Launcher exited with code ${code} before becoming ready. Stderr: ${stderrOutput}`));
      }
    });
  });
}

describe('E2E: OAuth Authentication Flow', () => {
  const launcherPath = path.join(__dirname, '../../dist/registry-launcher/index.js');
  // Use the actual echo-worker from the repository (relative to acp-worker)
  const echoWorkerPath = path.resolve(__dirname, '../../../echo-worker/echo-worker.js');
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

  describe('Full OAuth Flow with Initialize Response', () => {
    let mockRegistryServer: Server | null = null;
    let launcher: ChildProcess | null = null;

    afterEach(async () => {
      // Cleanup launcher
      if (launcher) {
        launcher.kill('SIGTERM');
        await new Promise<void>((resolve) => {
          launcher!.on('exit', () => resolve());
          setTimeout(resolve, 1000); // Fallback timeout
        });
        launcher = null;
      }

      // Cleanup mock registry server
      if (mockRegistryServer) {
        await new Promise<void>((resolve) => mockRegistryServer!.close(() => resolve()));
        mockRegistryServer = null;
      }
    });

    it('should return authMethods in initialize response - FULL E2E TEST', async () => {
      // Setup: Create api-keys.json with test key
      const apiKeysPath = path.join(tempDir, 'api-keys.json');
      const apiKeys = {
        'test-echo-agent': {
          apiKey: 'sk-test-key-12345',
          env: { TEST_API_KEY: 'sk-test-key-12345' }
        }
      };
      fs.writeFileSync(apiKeysPath, JSON.stringify(apiKeys, null, 2));

      // Create mock registry with echo-worker as agent using binary distribution
      // BinaryTarget uses 'cmd' not 'command'
      const mockRegistry = {
        version: '1.0.0',
        agents: [{
          id: 'test-echo-agent',
          name: 'Test Echo Agent',
          version: '1.0.0',
          description: 'Echo agent for e2e testing',
          distribution: {
            binary: {
              'darwin-aarch64': {
                cmd: 'node',
                args: [echoWorkerPath]
              },
              'darwin-x86_64': {
                cmd: 'node',
                args: [echoWorkerPath]
              },
              'linux-x86_64': {
                cmd: 'node',
                args: [echoWorkerPath]
              },
              'linux-aarch64': {
                cmd: 'node',
                args: [echoWorkerPath]
              },
              'windows-x86_64': {
                cmd: 'node',
                args: [echoWorkerPath]
              }
            }
          }
        }]
      };

      // Start mock registry server
      const { server, url } = await createMockRegistryServer(mockRegistry);
      mockRegistryServer = server;

      // Start Registry Launcher
      launcher = spawn('node', [launcherPath], {
        env: {
          ...process.env,
          REGISTRY_LAUNCHER_API_KEYS_PATH: apiKeysPath,
          ACP_REGISTRY_URL: url
        },
        stdio: ['pipe', 'pipe', 'pipe']
      });

      // Wait for launcher to be ready
      await waitForLauncherReady(launcher);

      // Send initialize request
      const initRequest = {
        jsonrpc: '2.0',
        id: 'init-1',
        method: 'initialize',
        agentId: 'test-echo-agent',
        params: {
          clientInfo: { name: 'E2E Test Client', version: '1.0.0' }
        }
      };

      const response = await sendAndReceive(
        launcher.stdin!,
        launcher.stdout!,
        initRequest,
        15000
      ) as Record<string, unknown>;

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

      const result = response.result as Record<string, unknown>;

      // Verify authMethods are present (injected by MessageRouter)
      expect(result.authMethods).toBeDefined();
      expect(Array.isArray(result.authMethods)).toBe(true);

      const authMethods = result.authMethods as Array<Record<string, unknown>>;
      expect(authMethods.length).toBeGreaterThan(0);

      // Verify authMethods structure
      console.log('Available auth methods:');
      for (const method of authMethods) {
        console.log(`  - ${method.id} (type: ${method.type}, provider: ${method.providerId || 'n/a'})`);
        expect(method.id).toBeDefined();
        expect(method.type).toBeDefined();
      }

      // Should include OAuth methods for supported providers
      const oauthMethods = authMethods.filter((m) => m.type === 'oauth2');
      expect(oauthMethods.length).toBeGreaterThan(0);
      console.log(`Found ${oauthMethods.length} OAuth methods`);

      // Should include API key methods
      const apiKeyMethods = authMethods.filter((m) => m.type === 'api-key');
      expect(apiKeyMethods.length).toBeGreaterThan(0);
      console.log(`Found ${apiKeyMethods.length} API key methods`);

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
      expect(result.stderr).toMatch(/github|google|azure|cognito|oidc/i);
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
