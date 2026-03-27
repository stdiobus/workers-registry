/**
 * E2E tests for Agent Auth flow.
 *
 * Tests the complete Agent Auth flow:
 * - initialize → AUTH_REQUIRED → authenticate → session/new success
 *
 * Uses mock-agent-auth.mjs which simulates an agent that requires Agent Auth.
 */

import * as path from 'path';
import * as readline from 'readline';
import { MessageRouter } from '../../src/router/message-router.js';
import { AgentRuntimeManager } from '../../src/runtime/manager.js';
import type { IRegistryIndex } from '../../src/registry/index.js';
import type { RegistryAgent, SpawnCommand } from '../../src/registry/types.js';

const MOCK_AGENT_PATH = path.resolve(__dirname, 'fixtures/agents/mock-agent-auth.mjs');

/**
 * Create a mock registry that returns our mock agent.
 */
function createMockRegistry(): IRegistryIndex {
  const mockAgent: RegistryAgent = {
    id: 'mock-agent-auth',
    name: 'Mock Agent Auth',
    version: '1.0.0',
    distribution: { npx: { package: 'mock-agent-auth' } },
  };

  return {
    fetch: jest.fn().mockResolvedValue(undefined),
    lookup: jest.fn((agentId: string) => {
      if (agentId === 'mock-agent-auth') {
        return mockAgent;
      }
      return undefined;
    }),
    resolve: jest.fn((agentId: string): SpawnCommand => {
      if (agentId === 'mock-agent-auth') {
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

describe('Agent Auth E2E (Task 37.3)', () => {
  let router: MessageRouter;
  let runtimeManager: AgentRuntimeManager;
  let registry: IRegistryIndex;
  let responses: object[];
  let stdoutListeners: Map<string, readline.Interface>;

  beforeEach(() => {
    registry = createMockRegistry();
    runtimeManager = new AgentRuntimeManager();
    responses = [];
    stdoutListeners = new Map();

    const writeCallback = (msg: object) => {
      responses.push(msg);
      return true;
    };

    // Enable auto-OAuth for E2E tests
    router = new MessageRouter(
      registry,
      runtimeManager,
      writeCallback,
      {},
      undefined,
      true, // autoOAuth
    );

    // Set up stdout listener for agent responses
    // This mimics what index.ts does in production
    const originalGetOrSpawn = runtimeManager.getOrSpawn.bind(runtimeManager);
    runtimeManager.getOrSpawn = async (agentId: string, spawnCommand: any) => {
      const runtime = await originalGetOrSpawn(agentId, spawnCommand);

      // Set up stdout listener if not already set up
      if (!stdoutListeners.has(agentId) && runtime.process.stdout) {
        const rl = readline.createInterface({
          input: runtime.process.stdout,
          crlfDelay: Infinity,
        });

        rl.on('line', (line: string) => {
          try {
            const response = JSON.parse(line);
            router.handleAgentResponse(agentId, response);
          } catch (err) {
            console.error(`Failed to parse agent ${agentId} response: ${(err as Error).message}`);
          }
        });

        stdoutListeners.set(agentId, rl);
      }

      return runtime;
    };
  });

  afterEach(async () => {
    // Clean up stdout listeners
    for (const rl of stdoutListeners.values()) {
      rl.close();
    }
    stdoutListeners.clear();

    // Clean up all agent processes
    await runtimeManager.terminateAll();
  });

  it('should complete Agent Auth flow: initialize → authenticate → session/new', async () => {
    // Step 1: Send initialize request
    await router.route({
      jsonrpc: '2.0',
      id: 'init-1',
      method: 'initialize',
      agentId: 'mock-agent-auth',
      params: {},
    });

    // Wait for agent to start and respond
    await new Promise(resolve => setTimeout(resolve, 500));

    // The agent should have responded with initialize result containing authMethods
    // MessageRouter should have triggered Agent Auth flow

    // Step 2: Wait for authenticate flow to complete
    await new Promise(resolve => setTimeout(resolve, 500));

    // Check auth state
    const authState = router.getAuthState('mock-agent-auth');

    // Auth should be either pending (still waiting) or authenticated (completed)
    expect(['pending', 'authenticated']).toContain(authState);

    // If still pending, wait more
    if (authState === 'pending') {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Now auth should be authenticated
    expect(router.getAuthState('mock-agent-auth')).toBe('authenticated');

    // Step 3: Send session/new request (should succeed now)
    await router.route({
      jsonrpc: '2.0',
      id: 'session-1',
      method: 'session/new',
      agentId: 'mock-agent-auth',
      params: {},
    });

    // Wait for response
    await new Promise(resolve => setTimeout(resolve, 500));

    // Check that we got a successful session response
    const sessionResponse = responses.find(
      (r: any) => r.id === 'session-1' && r.result?.sessionId
    );

    expect(sessionResponse).toBeDefined();
  }, 10000); // 10 second timeout for E2E test

  it('should handle Agent Auth failure gracefully', async () => {
    // Set environment to make auth fail
    process.env.MOCK_AUTH_FAIL = 'true';

    try {
      // Send initialize request
      await router.route({
        jsonrpc: '2.0',
        id: 'init-1',
        method: 'initialize',
        agentId: 'mock-agent-auth',
        params: {},
      });

      // Wait for auth flow to complete (and fail)
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Auth should be failed
      expect(router.getAuthState('mock-agent-auth')).toBe('failed');

      // Subsequent requests should get AUTH_REQUIRED error
      const result = await router.route({
        jsonrpc: '2.0',
        id: 'session-1',
        method: 'session/new',
        agentId: 'mock-agent-auth',
        params: {},
      });

      expect(result).toBeDefined();
      expect(result?.error?.code).toBe(-32004); // AUTH_REQUIRED
    } finally {
      delete process.env.MOCK_AUTH_FAIL;
    }
  }, 10000);
});
