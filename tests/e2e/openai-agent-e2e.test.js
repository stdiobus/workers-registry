/**
 * E2E test: OpenAI Agent via @stdiobus/node
 *
 * Starts a real stdio Bus instance with the openai-agent worker,
 * sends JSON-RPC requests through the bus, and validates responses.
 *
 * This covers the full path: client -> stdio Bus -> openai-agent worker -> response.
 */

import { StdioBus } from '@stdiobus/node';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = resolve(__dirname, 'openai-agent-bus-config.json');

// ACP SDK PROTOCOL_VERSION is 1 (integer)
const PROTOCOL_VERSION = 1;

// CI resolveType() logic from verify_agents.py
function resolveType(method) {
  if (typeof method.type === 'string') return method.type;
  const meta = method._meta;
  if (meta && 'terminal-auth' in meta) return 'terminal';
  if (meta && 'agent-auth' in meta) return 'agent';
  return 'agent';
}

/**
 * Send a raw JSON-RPC message and wait for the correlated response.
 */
function sendAndWait(bus, message, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const id = message.id;
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for response to id=${id}`));
    }, timeoutMs);

    const handler = (msg) => {
      try {
        const response = JSON.parse(msg);
        if (response.id === id) {
          clearTimeout(timer);
          if (response.error) {
            reject(new Error(
              `JSON-RPC error ${response.error.code}: ${response.error.message}`
            ));
          } else {
            resolve(response.result);
          }
        }
      } catch {
        // Not our response
      }
    };

    bus.onMessage(handler);
    const sent = bus.send(JSON.stringify(message));
    if (!sent) {
      clearTimeout(timer);
      reject(new Error('Failed to send message'));
    }
  });
}

describe('OpenAI Agent E2E via stdio Bus', () => {
  let bus;

  beforeAll(async () => {
    bus = new StdioBus({ configPath: CONFIG_PATH });
    await bus.start();
    // Give worker time to initialize
    await new Promise((r) => setTimeout(r, 1000));
  }, 15000);

  afterAll(async () => {
    if (bus && bus.isRunning()) {
      await bus.stop(5);
    }
  }, 10000);

  it('bus starts and has workers running', () => {
    expect(bus.isRunning()).toBe(true);
    expect(bus.getWorkerCount()).toBeGreaterThanOrEqual(1);
  });

  it('initialize returns valid response with authMethods', async () => {
    const result = await sendAndWait(bus, {
      jsonrpc: '2.0',
      id: 'e2e-init-1',
      method: 'initialize',
      params: {
        protocolVersion: PROTOCOL_VERSION,
        clientInfo: { name: 'e2e-test', version: '1.0.0' },
      },
    });

    // Basic response structure
    expect(result).toBeDefined();
    expect(result.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(result.agentInfo).toBeDefined();
    expect(result.agentInfo.name).toBe('openai-agent');
    expect(result.agentInfo.version).toBe('1.0.0');
    expect(result.agentCapabilities).toBeDefined();

    // authMethods — the bugfix target
    expect(result.authMethods).toBeDefined();
    expect(Array.isArray(result.authMethods)).toBe(true);
    expect(result.authMethods.length).toBeGreaterThan(0);

    const oauthMethod = result.authMethods.find((m) => m.id === 'oauth2');
    expect(oauthMethod).toBeDefined();
    expect(oauthMethod.name).toBe('OAuth 2.1 Authentication');
    expect(oauthMethod._meta).toBeDefined();
    expect(oauthMethod._meta['agent-auth']).toBe(true);
  }, 15000);

  it('authMethods resolves to type "agent" via CI resolveType logic', async () => {
    const result = await sendAndWait(bus, {
      jsonrpc: '2.0',
      id: 'e2e-ci-1',
      method: 'initialize',
      params: {
        protocolVersion: PROTOCOL_VERSION,
        clientInfo: { name: 'e2e-ci-check', version: '1.0.0' },
      },
    });

    const methods = result.authMethods;
    expect(methods.length).toBeGreaterThan(0);

    // Simulate CI auth-check
    const validTypes = methods.map(resolveType);
    const hasValidType = validTypes.some((t) => t === 'agent' || t === 'terminal');
    expect(hasValidType).toBe(true);

    const oauthMethod = methods.find((m) => m.id === 'oauth2');
    expect(resolveType(oauthMethod)).toBe('agent');
  }, 15000);

  it('authMethods entries conform to AuthMethod type', async () => {
    const result = await sendAndWait(bus, {
      jsonrpc: '2.0',
      id: 'e2e-type-1',
      method: 'initialize',
      params: {
        protocolVersion: PROTOCOL_VERSION,
        clientInfo: { name: 'e2e-type-check', version: '1.0.0' },
      },
    });

    for (const method of result.authMethods) {
      expect(typeof method.id).toBe('string');
      expect(method.id.length).toBeGreaterThan(0);
      expect(typeof method.name).toBe('string');
      expect(method.name.length).toBeGreaterThan(0);
    }
  }, 15000);

  it('bus stats show message traffic', () => {
    const stats = bus.getStats();
    expect(stats.messagesIn).toBeGreaterThan(0);
    expect(stats.messagesOut).toBeGreaterThan(0);
  });
});
