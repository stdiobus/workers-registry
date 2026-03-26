#!/usr/bin/env node

/*
 * Apache License 2.0
 * Copyright (c) 2025–present Raman Marozau, Target Insight Function.
 *
 * Mock ACP agent that REQUIRES authentication.
 * Used for e2e testing of OAuth flow.
 *
 * Behavior:
 * - On initialize: returns authMethods requiring oauth2
 * - On any request: checks for auth token in environment
 *   - If AUTH_TOKEN env is set: returns success response
 *   - If AUTH_TOKEN env is NOT set: returns AUTH_REQUIRED error
 */

import readline from 'readline';

let shuttingDown = false;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

/**
 * Check if authentication is present.
 * In real scenario, token would be injected via env or header.
 */
function isAuthenticated() {
  // Check for injected auth token (simulates OAuth token injection)
  return !!process.env.AUTH_TOKEN || !!process.env.OPENAI_API_KEY || !!process.env.ANTHROPIC_API_KEY;
}

/**
 * Process incoming JSON-RPC message.
 */
function processMessage(line) {
  if (shuttingDown) return;

  try {
    const msg = JSON.parse(line);

    // Only handle requests (has id and method)
    if (msg.id === undefined || msg.method === undefined) {
      return;
    }

    let response;

    if (msg.method === 'initialize') {
      // Initialize response with authMethods
      // Agent supports BOTH OAuth and API key authentication
      response = {
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            prompts: { listChanged: false },
            tools: { listChanged: false }
          },
          serverInfo: {
            name: 'auth-required-agent',
            version: '1.0.0'
          },
          // This agent supports both OAuth and API key authentication
          authMethods: [
            {
              id: 'api-key',
              type: 'api-key'
            },
            {
              id: 'oauth2-openai',
              type: 'oauth2',
              providerId: 'openai'
            }
          ]
        }
      };
    } else {
      // For all other methods, check authentication
      if (isAuthenticated()) {
        // SUCCESS: Token is present, return real response
        response = {
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            success: true,
            authenticated: true,
            method: msg.method,
            message: 'Request processed successfully with authentication',
            timestamp: new Date().toISOString(),
            // Echo back params to prove we processed the request
            params: msg.params || {}
          }
        };
        console.error('[auth-required-agent] Request authenticated, returning success');
      } else {
        // FAILURE: No token, return AUTH_REQUIRED error
        response = {
          jsonrpc: '2.0',
          id: msg.id,
          error: {
            code: -32001,
            message: 'Authentication required',
            data: {
              errorCode: 'AUTH_REQUIRED',
              requiredMethod: 'api-key',
              supportedMethods: ['api-key', 'oauth2-openai']
            }
          }
        };
        console.error('[auth-required-agent] No auth token, returning AUTH_REQUIRED');
      }
    }

    // Preserve sessionId
    if (msg.sessionId) {
      response.sessionId = msg.sessionId;
    }

    console.log(JSON.stringify(response));

  } catch (err) {
    console.error(`[auth-required-agent] Error: ${err.message}`);
  }
}

function handleShutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.error('[auth-required-agent] Shutting down...');
  rl.close();
}

process.on('SIGTERM', handleShutdown);
process.on('SIGINT', handleShutdown);

rl.on('line', processMessage);
rl.on('close', () => process.exit(0));

process.on('uncaughtException', (err) => {
  console.error(`[auth-required-agent] Uncaught: ${err.message}`);
  process.exit(1);
});

console.error('[auth-required-agent] Started, auth required for requests');
console.error(`[auth-required-agent] AUTH_TOKEN present: ${isAuthenticated()}`);
