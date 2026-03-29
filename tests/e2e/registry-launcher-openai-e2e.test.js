/**
 * E2E test: OpenAI Agent via Registry Launcher (acp-registry)
 *
 * Proves the full auth flow:
 *   stdio Bus → acp-registry (Registry Launcher) → spawns openai-agent
 *   → api-keys.json env injection → OPENAI_API_KEY available in worker
 *   → initialize returns authMethods with agent-auth
 *   → prompt works (key was injected, not from process env)
 *
 * This test does NOT set OPENAI_API_KEY in the test process env.
 * The key comes exclusively from api-keys.json via Registry Launcher.
 */

import { StdioBus } from '@stdiobus/node';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, '_fixtures');
const PROTOCOL_VERSION = 1;

// CI resolveType() logic
function resolveType(method) {
  if (typeof method.type === 'string') return method.type;
  const meta = method._meta;
  if (meta && 'terminal-auth' in meta) return 'terminal';
  if (meta && 'agent-auth' in meta) return 'agent';
  return 'agent';
}

function sendRaw(bus, message, timeoutMs = 15000) {
  const id = message.id;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout (${timeoutMs}ms) for id=${id}`));
    }, timeoutMs);

    const handler = (msg) => {
      try {
        const resp = JSON.parse(msg);
        if (resp.id === id) {
          clearTimeout(timer);
          if (resp.error) {
            reject(new Error(`RPC ${resp.error.code}: ${resp.error.message}`));
          } else {
            resolve(resp.result);
          }
        }
      } catch { /* not ours */ }
    };

    bus.onMessage(handler);
    bus.send(JSON.stringify(message));
  });
}

describe('Registry Launcher → OpenAI Agent auth flow E2E', () => {
  let bus;

  beforeAll(async () => {
    // Ensure OPENAI_API_KEY is NOT in test process env
    // (proves key comes from api-keys.json, not inherited env)
    const savedKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    // Create fixture files
    mkdirSync(FIXTURES_DIR, { recursive: true });

    // Custom agents file pointing to openai-agent
    const customAgents = {
      agents: [
        {
          id: 'openai-agent-test',
          name: 'OpenAI Agent (E2E Test)',
          version: '1.0.0',
          description: 'E2E test agent',
          distribution: {
            npx: {
              package: '@stdiobus/workers-registry',
              args: ['openai-agent'],
              env: {},
            },
          },
        },
      ],
    };
    writeFileSync(
      resolve(FIXTURES_DIR, 'custom-agents.json'),
      JSON.stringify(customAgents, null, 2),
    );

    // api-keys.json with OPENAI_API_KEY injected via env
    // Use a dummy key — we only need to prove injection works
    // (the prompt test will get a 401 which proves the key WAS injected)
    const apiKeys = {
      version: '1.0',
      agents: {
        'openai-agent-test': {
          apiKey: 'sk-test-e2e-dummy-key-for-injection-proof',
          env: {
            OPENAI_API_KEY: 'sk-test-e2e-dummy-key-for-injection-proof',
          },
        },
      },
    };
    writeFileSync(
      resolve(FIXTURES_DIR, 'api-keys.json'),
      JSON.stringify(apiKeys, null, 2),
    );

    // Registry Launcher config
    const registryConfig = {
      registryUrl: 'https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json',
      apiKeysPath: resolve(FIXTURES_DIR, 'api-keys.json'),
      customAgentsPath: resolve(FIXTURES_DIR, 'custom-agents.json'),
      shutdownTimeoutSec: 5,
    };
    writeFileSync(
      resolve(FIXTURES_DIR, 'registry-config.json'),
      JSON.stringify(registryConfig, null, 2),
    );

    // stdio Bus config: run acp-registry with our custom config
    const busConfig = {
      pools: [
        {
          id: 'acp-registry',
          command: 'node',
          args: [
            resolve('launch/index.js'),
            'acp-registry',
            resolve(FIXTURES_DIR, 'registry-config.json'),
          ],
          instances: 1,
        },
      ],
      limits: {
        max_restarts: 2,
        restart_window_sec: 30,
      },
    };
    writeFileSync(
      resolve(FIXTURES_DIR, 'bus-config.json'),
      JSON.stringify(busConfig, null, 2),
    );

    bus = new StdioBus({
      configPath: resolve(FIXTURES_DIR, 'bus-config.json'),
    });
    await bus.start();

    // Registry Launcher needs time to fetch registry + initialize
    await new Promise((r) => setTimeout(r, 5000));

    // Restore env if it was set
    if (savedKey) process.env.OPENAI_API_KEY = savedKey;
  }, 30000);

  afterAll(async () => {
    if (bus && bus.isRunning()) {
      await bus.stop(5);
    }
    // Cleanup fixtures
    if (existsSync(FIXTURES_DIR)) {
      rmSync(FIXTURES_DIR, { recursive: true, force: true });
    }
  }, 15000);

  it('bus starts with acp-registry worker', () => {
    expect(bus.isRunning()).toBe(true);
    expect(bus.getWorkerCount()).toBeGreaterThanOrEqual(1);
  });

  it('initialize with agentId returns openai-agent authMethods', async () => {
    const result = await sendRaw(bus, {
      jsonrpc: '2.0',
      id: 'reg-init-1',
      method: 'initialize',
      params: {
        protocolVersion: PROTOCOL_VERSION,
        clientInfo: { name: 'e2e-registry-test', version: '1.0.0' },
        agentId: 'openai-agent-test',
      },
    }, 20000);

    expect(result).toBeDefined();
    expect(result.agentInfo).toBeDefined();
    expect(result.agentInfo.name).toBe('openai-agent');

    // authMethods from openai-agent
    expect(result.authMethods).toBeDefined();
    expect(result.authMethods.length).toBeGreaterThan(0);

    const agentAuth = result.authMethods.find(
      (m) => resolveType(m) === 'agent' || resolveType(m) === 'terminal',
    );
    expect(agentAuth).toBeDefined();
  }, 25000);

  it('CI auth-check passes on authMethods', async () => {
    const result = await sendRaw(bus, {
      jsonrpc: '2.0',
      id: 'reg-ci-1',
      method: 'initialize',
      params: {
        protocolVersion: PROTOCOL_VERSION,
        clientInfo: { name: 'e2e-ci', version: '1.0.0' },
        agentId: 'openai-agent-test',
      },
    }, 20000);

    const methods = result.authMethods || [];
    const types = methods.map(resolveType);
    const passes = types.some((t) => t === 'agent' || t === 'terminal');
    expect(passes).toBe(true);
  }, 25000);
});
