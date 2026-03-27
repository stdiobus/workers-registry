#!/usr/bin/env node
/**
 * Comprehensive Mock ACP Agent for E2E testing.
 *
 * Supports the full ACP protocol lifecycle with configurable behavior
 * via environment variables. Used by production E2E tests.
 *
 * @see tests/e2e/helpers/launcher-harness.ts
 */

import * as readline from 'readline';

// ---------------------------------------------------------------------------
// Configuration from environment variables
// ---------------------------------------------------------------------------

const AUTH_METHODS = parseJsonEnv(
  'MOCK_AUTH_METHODS',
  [{ id: 'api-key', type: 'api-key' }],
);
const AUTH_BEHAVIOR = process.env.MOCK_AUTH_BEHAVIOR || 'success';
const AUTH_DELAY_MS = parseInt(process.env.MOCK_AUTH_DELAY_MS || '100', 10);
const REQUIRE_TOKEN = process.env.MOCK_REQUIRE_TOKEN === 'true';
const PROMPT_RESPONSE = process.env.MOCK_PROMPT_RESPONSE || 'Mock response';

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

let isAuthenticated = false;
let sessionCounter = 0;
const sessions = new Map(); // sessionId → { createdAt: number }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a JSON string from an environment variable with a fallback default.
 */
function parseJsonEnv(name, defaultValue) {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error(`[mock-acp-agent] Failed to parse ${name}: ${err.message}`);
    return defaultValue;
  }
}

/**
 * Check whether an auth token is present in the environment.
 */
function hasEnvToken() {
  return !!(
    process.env.AUTH_TOKEN ||
    process.env.OPENAI_API_KEY ||
    process.env.ANTHROPIC_API_KEY
  );
}

/**
 * Write a JSON-RPC message (response or notification) to stdout.
 */
function writeMessage(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

// ---------------------------------------------------------------------------
// JSON-RPC method handlers
// ---------------------------------------------------------------------------

/**
 * Handle `initialize` — return capabilities, serverInfo, and authMethods.
 */
function handleInitialize(id) {
  writeMessage({
    jsonrpc: '2.0',
    id,
    result: {
      protocolVersion: '2024-11-05',
      capabilities: {
        prompts: { listChanged: false },
        tools: { listChanged: false },
      },
      serverInfo: {
        name: 'mock-acp-agent',
        version: '1.0.0',
      },
      authMethods: AUTH_METHODS,
    },
  });
}

/**
 * Handle `authenticate` — simulate Agent Auth flow.
 *
 * Behavior is controlled by MOCK_AUTH_BEHAVIOR:
 *   - "success"  → respond with success after MOCK_AUTH_DELAY_MS
 *   - "fail"     → respond with error
 *   - "timeout"  → never respond (simulates timeout)
 *   - "cancel"   → respond with user-cancelled error
 */
function handleAuthenticate(id) {
  console.error(`[mock-acp-agent] authenticate: behavior=${AUTH_BEHAVIOR}, delay=${AUTH_DELAY_MS}ms`);

  if (AUTH_BEHAVIOR === 'timeout') {
    // Intentionally never respond — caller will time out.
    return;
  }

  setTimeout(() => {
    switch (AUTH_BEHAVIOR) {
      case 'success':
        isAuthenticated = true;
        writeMessage({
          jsonrpc: '2.0',
          id,
          result: {
            success: true,
            message: 'Authentication successful',
          },
        });
        break;

      case 'fail':
        writeMessage({
          jsonrpc: '2.0',
          id,
          error: {
            code: -32001,
            message: 'Authentication failed',
          },
        });
        break;

      case 'cancel':
        writeMessage({
          jsonrpc: '2.0',
          id,
          error: {
            code: -32002,
            message: 'Authentication cancelled by user',
          },
        });
        break;

      default:
        console.error(`[mock-acp-agent] Unknown AUTH_BEHAVIOR: ${AUTH_BEHAVIOR}`);
        writeMessage({
          jsonrpc: '2.0',
          id,
          error: {
            code: -32001,
            message: `Unknown auth behavior: ${AUTH_BEHAVIOR}`,
          },
        });
    }
  }, AUTH_DELAY_MS);
}

/**
 * Handle `session/new` — create a new session.
 *
 * When MOCK_REQUIRE_TOKEN is "true", the agent checks for an auth token
 * in the environment or the internal isAuthenticated flag.
 */
function handleSessionNew(id) {
  if (REQUIRE_TOKEN && !isAuthenticated && !hasEnvToken()) {
    console.error('[mock-acp-agent] session/new: not authenticated, returning AUTH_REQUIRED');
    writeMessage({
      jsonrpc: '2.0',
      id,
      error: {
        code: -32004,
        message: 'Authentication required',
        data: {
          errorCode: 'AUTH_REQUIRED',
          requiredMethod: AUTH_METHODS[0]?.type || 'api-key',
          supportedMethods: AUTH_METHODS.map((m) => m.id),
        },
      },
    });
    return;
  }

  sessionCounter++;
  const sessionId = `mock-session-${sessionCounter}`;
  sessions.set(sessionId, { createdAt: Date.now() });

  console.error(`[mock-acp-agent] session/new: created ${sessionId}`);
  writeMessage({
    jsonrpc: '2.0',
    id,
    result: { sessionId },
  });
}

/**
 * Handle `session/prompt` — return a prompt response.
 *
 * Sends a `session/update` notification before the actual response.
 */
function handleSessionPrompt(id, params) {
  const sessionId = params?.sessionId;

  if (sessionId && !sessions.has(sessionId)) {
    writeMessage({
      jsonrpc: '2.0',
      id,
      error: {
        code: -32003,
        message: `Unknown session: ${sessionId}`,
      },
    });
    return;
  }

  // Send a progress notification (no id — it's a notification).
  writeMessage({
    jsonrpc: '2.0',
    method: 'session/update',
    params: {
      sessionId: sessionId || null,
      type: 'progress',
      message: 'Processing...',
    },
  });

  // Send the actual response.
  const response = {
    jsonrpc: '2.0',
    id,
    result: {
      content: [
        {
          type: 'text',
          text: PROMPT_RESPONSE,
        },
      ],
    },
  };

  if (sessionId) {
    response.sessionId = sessionId;
  }

  writeMessage(response);
}

/**
 * Handle `session/cancel` — acknowledge cancellation.
 */
function handleSessionCancel(id, params) {
  const sessionId = params?.sessionId;
  console.error(`[mock-acp-agent] session/cancel: sessionId=${sessionId}`);

  const response = {
    jsonrpc: '2.0',
    id,
    result: { success: true },
  };

  if (sessionId) {
    response.sessionId = sessionId;
  }

  writeMessage(response);
}

// ---------------------------------------------------------------------------
// Message dispatch
// ---------------------------------------------------------------------------

/**
 * Route an incoming JSON-RPC message to the appropriate handler.
 */
function handleMessage(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch (err) {
    console.error(`[mock-acp-agent] Malformed JSON: ${err.message}`);
    return;
  }

  const { id, method, params } = msg;
  console.error(`[mock-acp-agent] ← ${method} (id=${id})`);

  switch (method) {
    case 'initialize':
      handleInitialize(id);
      break;
    case 'authenticate':
      handleAuthenticate(id, params);
      break;
    case 'session/new':
      handleSessionNew(id, params);
      break;
    case 'session/prompt':
      handleSessionPrompt(id, params);
      break;
    case 'session/cancel':
      handleSessionCancel(id, params);
      break;
    default:
      writeMessage({
        jsonrpc: '2.0',
        id,
        error: {
          code: -32601,
          message: `Method not found: ${method}`,
        },
      });
  }
}

// ---------------------------------------------------------------------------
// Process lifecycle
// ---------------------------------------------------------------------------

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

rl.on('line', handleMessage);

rl.on('close', () => {
  console.error('[mock-acp-agent] stdin closed, exiting');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.error('[mock-acp-agent] Received SIGTERM, exiting');
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  console.error(`[mock-acp-agent] Uncaught exception: ${err.message}`);
  process.exit(1);
});

console.error('[mock-acp-agent] Started');
console.error(`[mock-acp-agent] Config: authBehavior=${AUTH_BEHAVIOR}, requireToken=${REQUIRE_TOKEN}, authDelay=${AUTH_DELAY_MS}ms`);
