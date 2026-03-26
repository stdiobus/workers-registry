#!/usr/bin/env node
/**
 * Mock Agent with Agent Auth support.
 *
 * This mock agent simulates an ACP agent that requires Agent Auth.
 * It responds to:
 * - initialize: Returns authMethods with type: "agent"
 * - authenticate: Simulates OAuth flow completion
 * - session/new: Creates a session (only after authentication)
 *
 * Usage:
 *   node mock-agent-auth.js
 *
 * Environment variables:
 *   MOCK_AUTH_DELAY_MS - Delay before authenticate response (default: 100)
 *   MOCK_AUTH_FAIL - If "true", authenticate will fail
 */

import * as readline from 'readline';

const AUTH_DELAY_MS = parseInt(process.env.MOCK_AUTH_DELAY_MS || '100', 10);
const AUTH_SHOULD_FAIL = process.env.MOCK_AUTH_FAIL === 'true';

let isAuthenticated = false;
let sessionCounter = 0;

/**
 * Write a JSON-RPC response to stdout.
 */
function writeResponse(response) {
  process.stdout.write(JSON.stringify(response) + '\n');
}

/**
 * Handle initialize request.
 */
function handleInitialize(id) {
  writeResponse({
    jsonrpc: '2.0',
    id,
    result: {
      protocolVersion: '1.0',
      name: 'Mock Agent Auth',
      version: '1.0.0',
      authMethods: [
        {
          id: 'agent-openai',
          type: 'agent',
          providerId: 'openai',
          name: 'Mock Agent Auth',
        },
      ],
    },
  });
}

/**
 * Handle authenticate request.
 * Simulates the agent handling OAuth internally.
 */
function handleAuthenticate(id, params) {
  // Simulate async OAuth flow
  setTimeout(() => {
    if (AUTH_SHOULD_FAIL) {
      writeResponse({
        jsonrpc: '2.0',
        id,
        error: {
          code: -32001,
          message: 'Authentication failed: user cancelled',
        },
      });
    } else {
      isAuthenticated = true;
      writeResponse({
        jsonrpc: '2.0',
        id,
        result: {
          success: true,
          message: 'Authentication successful',
        },
      });
    }
  }, AUTH_DELAY_MS);
}

/**
 * Handle session/new request.
 */
function handleSessionNew(id, params) {
  if (!isAuthenticated) {
    writeResponse({
      jsonrpc: '2.0',
      id,
      error: {
        code: -32004,
        message: 'Authentication required',
        data: {
          requiredMethod: 'agent',
          supportedMethods: ['agent-openai'],
        },
      },
    });
    return;
  }

  sessionCounter++;
  writeResponse({
    jsonrpc: '2.0',
    id,
    result: {
      sessionId: `mock-session-${sessionCounter}`,
    },
  });
}

/**
 * Handle incoming JSON-RPC message.
 */
function handleMessage(message) {
  try {
    const msg = JSON.parse(message);
    const { id, method, params } = msg;

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
      default:
        writeResponse({
          jsonrpc: '2.0',
          id,
          error: {
            code: -32601,
            message: `Method not found: ${method}`,
          },
        });
    }
  } catch (error) {
    console.error(`[mock-agent-auth] Parse error: ${error.message}`);
  }
}

// Set up NDJSON reader
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

rl.on('line', handleMessage);

rl.on('close', () => {
  process.exit(0);
});

// Handle SIGTERM gracefully
process.on('SIGTERM', () => {
  process.exit(0);
});

console.error('[mock-agent-auth] Started');
