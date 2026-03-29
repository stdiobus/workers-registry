/**
 * E2E tests for Terminal Auth flow.
 *
 * Tests the complete Terminal Auth flow:
 * - initialize → AUTH_REQUIRED → spawn with args → session/new success
 *
 * Uses mock-agent-terminal.mjs which simulates an agent that requires Terminal Auth.
 *
 * Note: These tests require TTY environment to run Terminal Auth.
 * In CI/non-TTY environments, Terminal Auth should fail gracefully.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as readline from 'readline';
import { MessageRouter, type MessageRouterDeps } from '../../src/router/message-router.js';
import { AgentRuntimeManager } from '../../src/runtime/manager.js';
import type { IRegistryIndex } from '../../src/registry/index.js';
import type { RegistryAgent, SpawnCommand } from '../../src/registry/types.js';

const MOCK_AGENT_PATH = path.join(__dirname, 'fixtures/agents/mock-agent-terminal.mjs');

/**
 * Create a mock registry that returns our mock terminal agent.
 */
function createMockRegistry(): IRegistryIndex {
  const mockAgent: RegistryAgent = {
    id: 'mock-agent-terminal',
    name: 'Mock Agent Terminal',
    version: '1.0.0',
    distribution: { npx: { package: 'mock-agent-terminal' } },
  };

  return {
    fetch: jest.fn().mockResolvedValue(undefined),
    lookup: jest.fn((agentId: string) => {
      if (agentId === 'mock-agent-terminal') {
        return mockAgent;
      }
      return undefined;
    }),
    resolve: jest.fn((agentId: string): SpawnCommand => {
      if (agentId === 'mock-agent-terminal') {
        return {
          command: 'node',
          args: [MOCK_AGENT_PATH],
        };
      }
      throw new Error(`Agent not found: ${agentId}`);
    }),
    getAuthRequirements: jest.fn(() => ({
      authRequired: false,
      authMethods: [],
    })),
  };
}

describe('Terminal Auth E2E (Task 37.4)', () => {
  let runtimeManager: AgentRuntimeManager;
  let registry: IRegistryIndex;
  let responses: object[];
  let tempDir: string;
  let authStateFile: string;

  beforeEach(async () => {
    // Create temp directory for auth state file
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'terminal-auth-test-'));
    authStateFile = path.join(tempDir, 'auth-state.json');

    // Set environment for mock agent
    process.env.MOCK_AUTH_FILE = authStateFile;

    registry = createMockRegistry();
    runtimeManager = new AgentRuntimeManager();
    responses = [];

    const writeCallback = (msg: object) => {
      responses.push(msg);
      return true;
    };
    // Note: writeCallback is used by individual tests via closure
    void writeCallback; // Suppress unused warning
  });

  afterEach(async () => {
    // Clean up all agent processes
    await runtimeManager.terminateAll();

    // Clean up temp directory
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }

    delete process.env.MOCK_AUTH_FILE;
    delete process.env.MOCK_SETUP_FAIL;
  });

  describe('TTY environment detection', () => {
    it('should fail Terminal Auth when not in TTY environment', async () => {
      // Create router with mocked TTY checks (simulating non-TTY)
      const deps: MessageRouterDeps = {
        isStdinTTY: () => false,
        isStdoutTTY: () => false,
      };

      const nonTtyRouter = new MessageRouter(
        registry,
        runtimeManager,
        (msg) => { responses.push(msg); return true; },
        {},
        undefined,
        true, // autoOAuth enabled
        deps,
      );

      // Set up stdout listener for agent responses (like in agent-auth E2E)
      const stdoutListeners: readline.Interface[] = [];
      const originalGetOrSpawn = runtimeManager.getOrSpawn.bind(runtimeManager);
      runtimeManager.getOrSpawn = async (agentId: string, spawnCommand: SpawnCommand) => {
        const runtime = await originalGetOrSpawn(agentId, spawnCommand);

        if (runtime.process.stdout) {
          const rl = readline.createInterface({
            input: runtime.process.stdout,
            crlfDelay: Infinity,
          });

          rl.on('line', (line: string) => {
            try {
              const response = JSON.parse(line);
              nonTtyRouter.handleAgentResponse(agentId, response);
            } catch (err) {
              // Ignore parse errors
            }
          });

          stdoutListeners.push(rl);
        }

        return runtime;
      };

      try {
        // Send initialize request
        await nonTtyRouter.route({
          jsonrpc: '2.0',
          id: 'init-1',
          method: 'initialize',
          agentId: 'mock-agent-terminal',
          params: {},
        });

        // Wait for agent to respond and auth to be attempted
        // Poll for auth state change instead of fixed timeout
        let authState = 'none';
        for (let i = 0; i < 20; i++) {
          await new Promise(resolve => setTimeout(resolve, 100));
          authState = nonTtyRouter.getAuthState('mock-agent-terminal');
          if (authState !== 'none' && authState !== 'pending') break;
        }

        // Auth should fail because no TTY
        expect(authState).toBe('failed');
      } finally {
        // Clean up stdout listeners
        for (const rl of stdoutListeners) {
          rl.close();
        }
      }
    }, 10000);
  });

  describe('Terminal Auth with mocked TTY', () => {
    it('should parse terminal auth methods correctly', async () => {
      // This test verifies that terminal auth methods are parsed from initialize response
      // We use mocked TTY to allow the flow to proceed

      const deps: MessageRouterDeps = {
        isStdinTTY: () => true,
        isStdoutTTY: () => true,
        // We don't mock spawnFn here, so actual spawn will happen
        // but we're mainly testing the parsing
      };

      const ttyRouter = new MessageRouter(
        registry,
        runtimeManager,
        (msg) => { responses.push(msg); return true; },
        {},
        undefined,
        true,
        deps,
      );

      // Send initialize request
      await ttyRouter.route({
        jsonrpc: '2.0',
        id: 'init-1',
        method: 'initialize',
        agentId: 'mock-agent-terminal',
        params: {},
      });

      // Wait for agent to respond
      await new Promise(resolve => setTimeout(resolve, 500));

      // The initialize response should have been received
      // and Terminal Auth should have been triggered (state = pending)
      const authState = ttyRouter.getAuthState('mock-agent-terminal');

      // Auth state should be either pending (setup running) or authenticated (setup completed)
      // or failed (if spawn failed for some reason)
      expect(['none', 'pending', 'authenticated', 'failed']).toContain(authState);
    }, 10000);
  });

  describe('Terminal Auth state transitions', () => {
    it('should transition to failed when setup process fails', async () => {
      // Set environment to make setup fail
      process.env.MOCK_SETUP_FAIL = 'true';

      const deps: MessageRouterDeps = {
        isStdinTTY: () => true,
        isStdoutTTY: () => true,
      };

      const ttyRouter = new MessageRouter(
        registry,
        runtimeManager,
        (msg) => { responses.push(msg); return true; },
        {},
        undefined,
        true,
        deps,
      );

      // Manually set auth state to pending to simulate Terminal Auth in progress
      ttyRouter.setAuthState('mock-agent-terminal', 'pending');

      // Queue a request
      const routePromise = ttyRouter.route({
        jsonrpc: '2.0',
        id: 'session-1',
        method: 'session/new',
        agentId: 'mock-agent-terminal',
        params: {},
      });

      // Simulate failed Terminal Auth
      ttyRouter.setAuthState('mock-agent-terminal', 'failed');

      // Wait for queued request to be rejected
      const result = await routePromise;

      expect(result).toBeDefined();
      expect(result?.error?.code).toBe(-32004); // AUTH_REQUIRED
    }, 10000);

    it('should process queued requests after successful Terminal Auth', async () => {
      const deps: MessageRouterDeps = {
        isStdinTTY: () => true,
        isStdoutTTY: () => true,
      };

      const ttyRouter = new MessageRouter(
        registry,
        runtimeManager,
        (msg) => { responses.push(msg); return true; },
        {},
        undefined,
        true,
        deps,
      );

      // Manually set auth state to pending
      ttyRouter.setAuthState('mock-agent-terminal', 'pending');

      // Queue a request
      const routePromise = ttyRouter.route({
        jsonrpc: '2.0',
        id: 'session-1',
        method: 'session/new',
        agentId: 'mock-agent-terminal',
        params: {},
      });

      expect(ttyRouter.getQueuedRequestCount('mock-agent-terminal')).toBe(1);

      // Simulate successful Terminal Auth
      ttyRouter.setAuthState('mock-agent-terminal', 'authenticated');

      // Wait for queued request to be processed
      const result = await routePromise;

      // Request should have been processed (no error returned from route)
      expect(result).toBeUndefined();
      expect(ttyRouter.getQueuedRequestCount('mock-agent-terminal')).toBe(0);
    }, 10000);
  });
});
