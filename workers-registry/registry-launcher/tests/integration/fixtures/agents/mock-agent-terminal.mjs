#!/usr/bin/env node
/**
 * Mock Agent with Terminal Auth support.
 *
 * This mock agent simulates an ACP agent that requires Terminal Auth.
 * It has two modes:
 * 1. Normal ACP mode: Responds to initialize, session/new
 * 2. Setup mode (--setup): Simulates interactive TUI setup
 *
 * Usage:
 *   node mock-agent-terminal.js          # Normal ACP mode
 *   node mock-agent-terminal.js --setup  # Terminal Auth setup mode
 *
 * Environment variables:
 *   MOCK_SETUP_DELAY_MS - Delay for setup simulation (default: 100)
 *   MOCK_SETUP_FAIL - If "true", setup will fail (exit code 1)
 *   MOCK_AUTH_FILE - Path to auth state file (default: /tmp/mock-agent-auth-state)
 */

import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';

const SETUP_DELAY_MS = parseInt(process.env.MOCK_SETUP_DELAY_MS || '100', 10);
const SETUP_SHOULD_FAIL = process.env.MOCK_SETUP_FAIL === 'true';
const AUTH_STATE_FILE = process.env.MOCK_AUTH_FILE || '/tmp/mock-agent-auth-state';

/**
 * Check if we're in setup mode.
 */
function isSetupMode() {
  return process.argv.includes('--setup');
}

/**
 * Run the setup flow (Terminal Auth).
 * Simulates interactive TUI setup.
 */
async function runSetup() {
  console.error('[mock-agent-terminal] Running setup...');

  // Simulate setup delay
  await new Promise(resolve => setTimeout(resolve, SETUP_DELAY_MS));

  if (SETUP_SHOULD_FAIL) {
    console.error('[mock-agent-terminal] Setup failed!');
    process.exit(1);
  }

  // Write auth state to file (simulating credential storage)
  try {
    fs.writeFileSync(AUTH_STATE_FILE, JSON.stringify({
      authenticated: true,
      timestamp: Date.now(),
    }));
    console.error('[mock-agent-terminal] Setup complete, credentials stored.');
    process.exit(0);
  } catch (error) {
    console.error(`[mock-agent-terminal] Failed to write auth state: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Check if authenticated (by reading auth state file).
 */
function isAuthenticated() {
  try {
    if (fs.existsSync(AUTH_STATE_FILE)) {
      const state = JSON.parse(fs.readFileSync(AUTH_STATE_FILE, 'utf-8'));
      return state.authenticated === true;
    }
  } catch {
    // Ignore errors
  }
  return false;
}

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
      name: 'Mock Agent Terminal',
      version: '1.0.0',
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

/**
 * Handle session/new request.
 */
function handleSessionNew(id, params) {
  if (!isAuthenticated()) {
    writeResponse({
      jsonrpc: '2.0',
      id,
      error: {
        code: -32004,
        message: 'Authentication required',
        data: {
          requiredMethod: 'terminal',
          supportedMethods: ['terminal-setup'],
        },
      },
    });
    return;
  }

  writeResponse({
    jsonrpc: '2.0',
    id,
    result: {
      sessionId: `mock-terminal-session-${Date.now()}`,
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
    console.error(`[mock-agent-terminal] Parse error: ${error.message}`);
  }
}

/**
 * Run normal ACP mode.
 */
function runNormalMode() {
  console.error('[mock-agent-terminal] Started in normal mode');

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
}

// Main entry point
if (isSetupMode()) {
  runSetup();
} else {
  runNormalMode();
}
