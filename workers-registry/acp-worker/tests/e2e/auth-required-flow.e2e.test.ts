/*
 * Apache License 2.0
 * Copyright (c) 2025–present Raman Marozau, Target Insight Function.
 */

/**
 * E2E Test: OAuth Authentication Required Flow
 *
 * This test verifies the COMPLETE authentication flow:
 * 1. Agent requires authentication (returns authMethods with oauth2)
 * 2. WITHOUT token → AUTH_REQUIRED error
 * 3. WITH token → successful response from agent
 *
 * This is the critical test that proves OAuth integration works end-to-end.
 *
 * @module tests/e2e/auth-required-flow.e2e.test
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
 * Create HTTP server serving mock registry.
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
 * Wait for launcher to be ready.
 */
function waitForLauncherReady(launcher: ChildProcess, timeoutMs = 15000): Promise<void> {
  return new Promise((resolve, reject) => {
    let ready = false;
    let stderrOutput = '';

    const timeout = setTimeout(() => {
      reject(new Error(`Launcher not ready within ${timeoutMs}ms. Stderr: ${stderrOutput}`));
    }, timeoutMs);

    launcher.stderr!.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderrOutput += text;
      if (text.includes('Registry Launcher ready')) {
        ready = true;
        clearTimeout(timeout);
        resolve();
      }
    });

    launcher.on('exit', (code) => {
      if (!ready) {
        clearTimeout(timeout);
        reject(new Error(`Launcher exited with code ${code}. Stderr: ${stderrOutput}`));
      }
    });
  });
}

describe('E2E: OAuth Authentication Required Flow', () => {
  const launcherPath = path.join(__dirname, '../../dist/registry-launcher/index.js');
  const authRequiredAgentPath = path.join(__dirname, 'fixtures/auth-required-agent.js');
  let tempDir: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-required-e2e-'));

    // Verify auth-required-agent.js exists
    if (!fs.existsSync(authRequiredAgentPath)) {
      throw new Error(`Auth required agent not found at: ${authRequiredAgentPath}`);
    }
  });

  afterAll(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Authentication Flow Verification', () => {
    let mockRegistryServer: Server | null = null;
    let launcher: ChildProcess | null = null;
    let registryUrl: string;

    // Create mock registry with auth-required agent
    const createRegistry = () => ({
      version: '1.0.0',
      agents: [{
        id: 'auth-required-agent',
        name: 'Auth Required Agent',
        version: '1.0.0',
        description: 'Agent that requires OAuth authentication',
        distribution: {
          binary: {
            'darwin-aarch64': { cmd: 'node', args: [authRequiredAgentPath] },
            'darwin-x86_64': { cmd: 'node', args: [authRequiredAgentPath] },
            'linux-x86_64': { cmd: 'node', args: [authRequiredAgentPath] },
            'linux-aarch64': { cmd: 'node', args: [authRequiredAgentPath] },
            'windows-x86_64': { cmd: 'node', args: [authRequiredAgentPath] }
          }
        }
      }]
    });

    beforeEach(async () => {
      // Start mock registry server
      const { server, url } = await createMockRegistryServer(createRegistry());
      mockRegistryServer = server;
      registryUrl = url;
    });

    afterEach(async () => {
      if (launcher) {
        launcher.kill('SIGTERM');
        await new Promise<void>((resolve) => {
          launcher!.on('exit', () => resolve());
          setTimeout(resolve, 2000);
        });
        launcher = null;
      }

      if (mockRegistryServer) {
        await new Promise<void>((resolve) => mockRegistryServer!.close(() => resolve()));
        mockRegistryServer = null;
      }
    });

    it('should return AUTH_REQUIRED when no token is provided', async () => {
      console.log('\n========== TEST: NO AUTH TOKEN ==========');

      // Create empty api-keys.json (no credentials)
      // Format: { version, agents: {} }
      const apiKeysPath = path.join(tempDir, 'api-keys-empty.json');
      fs.writeFileSync(apiKeysPath, JSON.stringify({ version: '1.0.0', agents: {} }, null, 2));

      // Start launcher WITHOUT any auth token
      launcher = spawn('node', [launcherPath], {
        env: {
          ...process.env,
          ACP_API_KEYS_PATH: apiKeysPath,
          ACP_REGISTRY_URL: registryUrl,
          // Explicitly NO auth tokens
          AUTH_TOKEN: '',
          OPENAI_API_KEY: '',
          ANTHROPIC_API_KEY: ''
        },
        stdio: ['pipe', 'pipe', 'pipe']
      });

      // Collect stderr for debugging
      let stderrOutput = '';
      launcher.stderr!.on('data', (chunk) => {
        stderrOutput += chunk.toString();
      });

      await waitForLauncherReady(launcher);

      // Step 1: Initialize - should succeed and return authMethods
      const initRequest = {
        jsonrpc: '2.0',
        id: 'init-no-auth',
        method: 'initialize',
        agentId: 'auth-required-agent',
        params: { clientInfo: { name: 'E2E Test', version: '1.0.0' } }
      };

      const initResponse = await sendAndReceive(
        launcher.stdin!,
        launcher.stdout!,
        initRequest,
        15000
      ) as Record<string, unknown>;

      console.log('Initialize response:', JSON.stringify(initResponse, null, 2));

      expect(initResponse.jsonrpc).toBe('2.0');
      expect(initResponse.id).toBe('init-no-auth');
      expect(initResponse.result).toBeDefined();

      const initResult = initResponse.result as Record<string, unknown>;
      expect(initResult.authMethods).toBeDefined();
      console.log('Agent requires auth methods:', initResult.authMethods);

      // Step 2: Send a work request - should get AUTH_REQUIRED
      const workRequest = {
        jsonrpc: '2.0',
        id: 'work-no-auth',
        method: 'prompts/list',
        agentId: 'auth-required-agent',
        params: {}
      };

      const workResponse = await sendAndReceive(
        launcher.stdin!,
        launcher.stdout!,
        workRequest,
        15000
      ) as Record<string, unknown>;

      console.log('Work request response (no auth):', JSON.stringify(workResponse, null, 2));
      console.log('Stderr output:', stderrOutput);

      // CRITICAL ASSERTION: Should get AUTH_REQUIRED error
      expect(workResponse.jsonrpc).toBe('2.0');
      expect(workResponse.id).toBe('work-no-auth');
      expect(workResponse.error).toBeDefined();

      const error = workResponse.error as Record<string, unknown>;
      expect(error.code).toBe(-32004); // AUTH_REQUIRED error code
      expect(error.message).toMatch(/auth/i);

      const errorData = error.data as Record<string, unknown>;
      expect(errorData.requiredMethod).toBeDefined();
      expect(errorData.agentId).toBe('auth-required-agent');

      console.log('✅ AUTH_REQUIRED error received as expected');
      console.log('==========================================\n');
    }, 30000);

    it('should return success when auth token is provided', async () => {
      console.log('\n========== TEST: WITH AUTH TOKEN ==========');

      // Create api-keys.json with credentials for the agent
      // Format: { agents: { agentId: { apiKey, env } } }
      const apiKeysPath = path.join(tempDir, 'api-keys-with-auth.json');
      const apiKeys = {
        version: '1.0.0',
        agents: {
          'auth-required-agent': {
            apiKey: 'test-oauth-token-12345',
            env: {
              AUTH_TOKEN: 'test-oauth-token-12345',
              OPENAI_API_KEY: 'sk-test-key-for-auth'
            }
          }
        }
      };
      fs.writeFileSync(apiKeysPath, JSON.stringify(apiKeys, null, 2));

      // Start launcher WITH auth token (injected via api-keys.json env)
      launcher = spawn('node', [launcherPath], {
        env: {
          ...process.env,
          ACP_API_KEYS_PATH: apiKeysPath,
          ACP_REGISTRY_URL: registryUrl
        },
        stdio: ['pipe', 'pipe', 'pipe']
      });

      // Collect stderr for debugging
      let stderrOutput = '';
      launcher.stderr!.on('data', (chunk) => {
        stderrOutput += chunk.toString();
      });

      await waitForLauncherReady(launcher);

      // Step 1: Initialize
      const initRequest = {
        jsonrpc: '2.0',
        id: 'init-with-auth',
        method: 'initialize',
        agentId: 'auth-required-agent',
        params: { clientInfo: { name: 'E2E Test', version: '1.0.0' } }
      };

      const initResponse = await sendAndReceive(
        launcher.stdin!,
        launcher.stdout!,
        initRequest,
        15000
      ) as Record<string, unknown>;

      console.log('Initialize response:', JSON.stringify(initResponse, null, 2));

      expect(initResponse.jsonrpc).toBe('2.0');
      expect(initResponse.result).toBeDefined();

      // Step 2: Send work request - should succeed because token is injected
      const workRequest = {
        jsonrpc: '2.0',
        id: 'work-with-auth',
        method: 'prompts/list',
        agentId: 'auth-required-agent',
        params: { query: 'test query' }
      };

      const workResponse = await sendAndReceive(
        launcher.stdin!,
        launcher.stdout!,
        workRequest,
        15000
      ) as Record<string, unknown>;

      console.log('Work request response (with auth):', JSON.stringify(workResponse, null, 2));
      console.log('Stderr output:', stderrOutput);

      // CRITICAL ASSERTION: Should get SUCCESS response, NOT error
      expect(workResponse.jsonrpc).toBe('2.0');
      expect(workResponse.id).toBe('work-with-auth');
      expect(workResponse.error).toBeUndefined();
      expect(workResponse.result).toBeDefined();

      const result = workResponse.result as Record<string, unknown>;
      expect(result.success).toBe(true);
      expect(result.authenticated).toBe(true);
      expect(result.message).toMatch(/successfully/i);

      console.log('✅ Success response received - agent authenticated!');
      console.log('===========================================\n');
    }, 30000);

    it('should demonstrate the difference: same agent, different auth state', async () => {
      console.log('\n========== COMPARISON TEST ==========');
      console.log('This test proves that the SAME agent behaves differently');
      console.log('based on whether authentication is provided or not.\n');

      // Test 1: Without auth
      const apiKeysPathEmpty = path.join(tempDir, 'api-keys-compare-empty.json');
      fs.writeFileSync(apiKeysPathEmpty, JSON.stringify({ version: '1.0.0', agents: {} }, null, 2));

      launcher = spawn('node', [launcherPath], {
        env: {
          ...process.env,
          ACP_API_KEYS_PATH: apiKeysPathEmpty,
          ACP_REGISTRY_URL: registryUrl,
          AUTH_TOKEN: '',
          OPENAI_API_KEY: ''
        },
        stdio: ['pipe', 'pipe', 'pipe']
      });

      await waitForLauncherReady(launcher);

      // Initialize
      await sendAndReceive(
        launcher.stdin!,
        launcher.stdout!,
        {
          jsonrpc: '2.0',
          id: 'init-compare-1',
          method: 'initialize',
          agentId: 'auth-required-agent',
          params: { clientInfo: { name: 'Test', version: '1.0.0' } }
        },
        15000
      );

      // Work request without auth
      const responseNoAuth = await sendAndReceive(
        launcher.stdin!,
        launcher.stdout!,
        {
          jsonrpc: '2.0',
          id: 'compare-no-auth',
          method: 'test/method',
          agentId: 'auth-required-agent',
          params: {}
        },
        15000
      ) as Record<string, unknown>;

      // Kill first launcher
      launcher.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        launcher!.on('exit', () => resolve());
        setTimeout(resolve, 2000);
      });

      // Test 2: With auth
      const apiKeysPathFull = path.join(tempDir, 'api-keys-compare-full.json');
      fs.writeFileSync(apiKeysPathFull, JSON.stringify({
        version: '1.0.0',
        agents: {
          'auth-required-agent': {
            apiKey: 'test-token',
            env: { AUTH_TOKEN: 'test-token' }
          }
        }
      }, null, 2));

      launcher = spawn('node', [launcherPath], {
        env: {
          ...process.env,
          ACP_API_KEYS_PATH: apiKeysPathFull,
          ACP_REGISTRY_URL: registryUrl
        },
        stdio: ['pipe', 'pipe', 'pipe']
      });

      await waitForLauncherReady(launcher);

      // Initialize
      await sendAndReceive(
        launcher.stdin!,
        launcher.stdout!,
        {
          jsonrpc: '2.0',
          id: 'init-compare-2',
          method: 'initialize',
          agentId: 'auth-required-agent',
          params: { clientInfo: { name: 'Test', version: '1.0.0' } }
        },
        15000
      );

      // Work request with auth
      const responseWithAuth = await sendAndReceive(
        launcher.stdin!,
        launcher.stdout!,
        {
          jsonrpc: '2.0',
          id: 'compare-with-auth',
          method: 'test/method',
          agentId: 'auth-required-agent',
          params: {}
        },
        15000
      ) as Record<string, unknown>;

      // COMPARISON
      console.log('Response WITHOUT auth:', JSON.stringify(responseNoAuth, null, 2));
      console.log('Response WITH auth:', JSON.stringify(responseWithAuth, null, 2));

      // Verify difference
      expect(responseNoAuth.error).toBeDefined();
      expect((responseNoAuth.error as Record<string, unknown>).code).toBe(-32004);

      expect(responseWithAuth.error).toBeUndefined();
      expect(responseWithAuth.result).toBeDefined();
      expect((responseWithAuth.result as Record<string, unknown>).authenticated).toBe(true);

      console.log('\n✅ PROVEN: Same agent, different behavior based on auth state');
      console.log('   - Without token: AUTH_REQUIRED error (-32004)');
      console.log('   - With token: Success response with authenticated=true');
      console.log('======================================\n');
    }, 60000);
  });
});
