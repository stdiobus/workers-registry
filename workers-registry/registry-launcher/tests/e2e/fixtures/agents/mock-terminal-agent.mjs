#!/usr/bin/env node
/**
 * Mock Agent with Terminal Auth support for E2E testing.
 *
 * Two modes:
 * 1. Normal ACP mode: Responds to initialize, session/new, session/prompt
 * 2. Setup mode (--setup): Simulates interactive TUI credential setup
 *
 * Environment variables:
 *   MOCK_SETUP_BEHAVIOR   - "success" | "fail" | "timeout" (default: "success")
 *   MOCK_AUTH_STATE_FILE   - Path to auth state file (default: /tmp/mock-terminal-agent-auth-state)
 *   MOCK_SETUP_DELAY_MS   - Delay before setup completes in ms (default: 100)
 *
 * @see tests/e2e/helpers/launcher-harness.ts
 */

import * as readline from 'readline';
import * as fs from 'fs';

// ---------------------------------------------------------------------------
// Configuration from environment variables
// ---------------------------------------------------------------------------

const SETUP_BEHAVIOR = process.env.MOCK_SETUP_BEHAVIOR || 'success';
const AUTH_STATE_FILE =
  process.env.MOCK_AUTH_STATE_FILE || '/tmp/mock-terminal-agent-auth-state';
const SETUP_DELAY_MS = parseInt(process.env.MOCK_SETUP_DELAY_MS || '100', 10);

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

let sessionCounter = 0;
const sessions = new Map(); // sessionId → { createdAt }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Write a JSON-RPC message to stdout. */
function writeMessage(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

/** Check if authenticated by reading the auth state file. */
function isAuthenticated() {
  try {
    if (fs.existsSync(AUTH_STATE_FILE)) {
      const state = JSON.parse(fs.readFileSync(AUTH_STATE_FILE, 'utf-8'));
      return state.authenticated === true;
    }
  } catch {
    // Ignore read errors
  }
  return false;
}

// ---------------------------------------------------------------------------
// Setup mode (--setup)
// ---------------------------------------------------------------------------

async function runSetup() {
  console.error(`[mock-terminal-agent] Running setup (behavior=${SETUP_BEHAVIOR}, delay=${SETUP_DELAY_MS}ms)`);

  await new Promise((resolve) => setTimeout(resolve, SETUP_DELAY_MS));

  if (SETUP_BEHAVIOR === 'timeout') {
    console.error('[mock-terminal-agent] Setup: simulating timeout (hanging)');
    // Intentionally never exit — caller will time out.
    return;
  }

  if (SETUP_BEHAVIOR === 'fail') {
    console.error('[mock-terminal-agent] Setup failed');
    process.exit(1);
  }

  // success
  try {
    fs.writeFileSync(
      AUTH_STATE_FILE,
      JSON.stringify({
        authenticated: true,
        timestamp: Date.now(),
        provider: 'terminal',
      }),
    );
    console.error('[mock-terminal-agent] Setup complete, credentials stored');
    process.exit(0);
  } catch (err) {
    console.error(`[mock-terminal-agent] Failed to write auth state: ${err.message}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Normal ACP mode — JSON-RPC handlers
// ---------------------------------------------------------------------------

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
        name: 'mock-terminal-agent',
        version: '1.0.0',
      },
      authMethods: [
        {
          id: 'terminal-setup',
          type: 'terminal',
          name: 'Terminal Setup',
          args: ['--setup'],
          env: {},
        },
      ],
    },
  });
}

function handleSessionNew(id) {
  if (!isAuthenticated()) {
    console.error('[mock-terminal-agent] session/new: not authenticated, returning AUTH_REQUIRED');
    writeMessage({
      jsonrpc: '2.0',
      id,
      error: {
        code: -32004,
        message: 'Authentication required',
        data: {
          errorCode: 'AUTH_REQUIRED',
          requiredMethod: 'terminal',
          supportedMethods: ['terminal-setup'],
        },
      },
    });
    return;
  }

  sessionCounter++;
  const sessionId = `mock-terminal-session-${sessionCounter}`;
  sessions.set(sessionId, { createdAt: Date.now() });

  console.error(`[mock-terminal-agent] session/new: created ${sessionId}`);
  writeMessage({
    jsonrpc: '2.0',
    id,
    result: { sessionId },
  });
}

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

  const response = {
    jsonrpc: '2.0',
    id,
    result: {
      content: [
        {
          type: 'text',
          text: 'Terminal agent response',
        },
      ],
    },
  };

  if (sessionId) {
    response.sessionId = sessionId;
  }

  writeMessage(response);
}

// ---------------------------------------------------------------------------
// Message dispatch
// ---------------------------------------------------------------------------

function handleMessage(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch (err) {
    console.error(`[mock-terminal-agent] Malformed JSON: ${err.message}`);
    return;
  }

  const { id, method, params } = msg;
  console.error(`[mock-terminal-agent] ← ${method} (id=${id})`);

  switch (method) {
    case 'initialize':
      handleInitialize(id);
      break;
    case 'session/new':
      handleSessionNew(id, params);
      break;
    case 'session/prompt':
      handleSessionPrompt(id, params);
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

if (process.argv.includes('--setup')) {
  runSetup();
} else {
  console.error('[mock-terminal-agent] Started in normal ACP mode');
  console.error(`[mock-terminal-agent] Auth state file: ${AUTH_STATE_FILE}`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  rl.on('line', handleMessage);

  rl.on('close', () => {
    console.error('[mock-terminal-agent] stdin closed, exiting');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.error('[mock-terminal-agent] Received SIGTERM, exiting');
    process.exit(0);
  });

  process.on('uncaughtException', (err) => {
    console.error(`[mock-terminal-agent] Uncaught exception: ${err.message}`);
    process.exit(1);
  });
}
