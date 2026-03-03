#!/usr/bin/env node

/*
 * Apache License 2.0
 * Copyright (c) 2025–present Raman Marozau, Target Insight Function.
 * Contact: raman@worktif.com
 *
 * This file is part of the stdio bus protocol reference implementation:
 *   stdio_bus_kernel_workers (target: <target_stdio_bus_kernel_workers>).
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @file registry-launcher-client.js
 * @brief Test client for ACP Registry Transit via stdio Bus
 *
 * This test client demonstrates sending ACP messages through the Registry Launcher
 * transit chain. It shows how to use the agentId field for routing messages to
 * specific agents registered in the ACP Registry.
 *
 * ## Transit Chain
 *
 * ```
 * This Client → stdio Bus → Registry Launcher → ACP Agent → back
 * ```
 *
 * ## Connection Modes
 *
 * The client supports TCP and Unix socket connections to stdio Bus:
 *
 * - **TCP**: Connect to `--tcp <host:port>` mode
 *   ```bash
 *   node workers-registry/acp-registry/registry-launcher-client.js --tcp localhost:9000 --agent my-agent
 *   ```
 *
 * - **Unix Socket**: Connect to `--unix <path>` mode
 *   ```bash
 *   node workers-registry/acp-registry/registry-launcher-client.js --unix /tmp/stdio_bus.sock --agent my-agent
 *   ```
 *
 * ## Usage
 *
 * ```bash
 * # Start stdio Bus with Registry Launcher configuration. stdio Bus kernel repo: https://github.com/stdiobus/stdiobus
 * ./stdio_bus --config workers-registry/acp-registry/registry-launcher-config.json --tcp localhost:9000
 *
 * # In another terminal, run the test client
 * node workers-registry/acp-registry/registry-launcher-client.js --tcp localhost:9000 --agent my-agent
 *
 * # Run specific ACP flow
 * node workers-registry/acp-registry/registry-launcher-client.js --tcp localhost:9000 --agent my-agent --flow initialize
 * node workers-registry/acp-registry/registry-launcher-client.js --tcp localhost:9000 --agent my-agent --flow session-new
 * node workers-registry/acp-registry/registry-launcher-client.js --tcp localhost:9000 --agent my-agent --flow session-prompt
 *
 * # Run full ACP flow (initialize → session/new → session/prompt)
 * node workers-registry/acp-registry/registry-launcher-client.js --tcp localhost:9000 --agent my-agent --flow full
 *
 * # Interactive mode - send custom messages with agentId
 * node workers-registry/acp-registry/registry-launcher-client.js --tcp localhost:9000 --agent my-agent --interactive
 * ```
 *
 * ## Command Line Options
 *
 * | Option | Description |
 * |--------|-------------|
 * | `--tcp <host:port>` | Connect via TCP to specified host and port |
 * | `--unix <path>` | Connect via Unix domain socket |
 * | `--agent <id>` | Agent ID from ACP Registry (required) |
 * | `--flow <type>` | ACP flow to execute: initialize, session-new, session-prompt, full |
 * | `--session <id>` | Session ID for session-based requests (auto-generated if not provided) |
 * | `--prompt <text>` | Prompt text for session/prompt request (default: "Hello, agent!") |
 * | `--interactive` | Interactive mode: read JSON from stdin, auto-add agentId |
 * | `--timeout <ms>` | Response timeout in milliseconds (default: 30000) |
 * | `--help` | Show usage information |
 *
 * ## ACP Message Flows
 *
 * ### Initialize Flow
 *
 * Sends an `initialize` request to establish protocol version and capabilities:
 *
 * ```json
 * {
 *   "jsonrpc": "2.0",
 *   "id": "init-1",
 *   "method": "initialize",
 *   "agentId": "my-agent",
 *   "params": {
 *     "protocolVersion": 1,
 *     "capabilities": {},
 *     "clientInfo": {
 *       "name": "registry-launcher-test-client",
 *       "version": "1.0.0"
 *     }
 *   }
 * }
 * ```
 *
 * ### Session/New Flow
 *
 * Creates a new session with the agent:
 *
 * ```json
 * {
 *   "jsonrpc": "2.0",
 *   "id": "session-new-1",
 *   "method": "session/new",
 *   "agentId": "my-agent",
 *   "params": {}
 * }
 * ```
 *
 * ### Session/Prompt Flow
 *
 * Sends a prompt to an existing session:
 *
 * ```json
 * {
 *   "jsonrpc": "2.0",
 *   "id": "prompt-1",
 *   "method": "session/prompt",
 *   "agentId": "my-agent",
 *   "params": {
 *     "sessionId": "sess-123",
 *     "prompt": {
 *       "messages": [
 *         {
 *           "role": "user",
 *           "content": { "type": "text", "text": "Hello, agent!" }
 *         }
 *       ]
 *     }
 *   }
 * }
 * ```
 *
 * ## Important Notes
 *
 * - The `agentId` field is required for all messages and is used by the Registry
 *   Launcher to route messages to the correct agent process
 * - The Registry Launcher removes the `agentId` field before forwarding to the agent
 * - Responses from agents are forwarded unchanged (no agentId added)
 * - Session IDs returned by session/new should be used in subsequent session/prompt calls
 */

import net from 'net';
import readline from 'readline';
import crypto from 'crypto';

/**
 * Parse command line arguments.
 * @returns {Object} Parsed options
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    tcp: null,
    unix: null,
    agentId: null,
    flow: null,
    sessionId: null,
    prompt: 'Hello, agent!',
    interactive: false,
    timeout: 30000,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--tcp':
        options.tcp = args[++i];
        break;
      case '--unix':
        options.unix = args[++i];
        break;
      case '--agent':
        options.agentId = args[++i];
        break;
      case '--flow':
        options.flow = args[++i];
        break;
      case '--session':
        options.sessionId = args[++i];
        break;
      case '--prompt':
        options.prompt = args[++i];
        break;
      case '--interactive':
        options.interactive = true;
        break;
      case '--timeout':
        options.timeout = parseInt(args[++i], 10);
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        console.error(`Unknown option: ${arg}`);
        process.exit(1);
    }
  }

  return options;
}

/**
 * Display usage information.
 */
function showHelp() {
  console.log(`
ACP Registry Transit Test Client

This client demonstrates sending ACP messages through the Registry Launcher
transit chain: Client → stdio Bus → Registry Launcher → ACP Agent → back

Usage:
  node registry-launcher-client.js --tcp <host:port> --agent <id> [options]
  node registry-launcher-client.js --unix <path> --agent <id> [options]

Connection (one required):
  --tcp <host:port>    Connect via TCP (e.g., localhost:9000)
  --unix <path>        Connect via Unix socket (e.g., /tmp/stdio_bus.sock)

Required:
  --agent <id>         Agent ID from ACP Registry to route messages to

ACP Flow Options:
  --flow <type>        ACP flow to execute:
                         initialize    - Send initialize request
                         session-new   - Create new session
                         session-prompt - Send prompt to session
                         full          - Run full flow (init → new → prompt)
  --session <id>       Session ID for session/prompt (auto-generated if not set)
  --prompt <text>      Prompt text for session/prompt (default: "Hello, agent!")

Modes:
  --interactive        Read JSON from stdin, auto-add agentId to messages
  --timeout <ms>       Response timeout in ms (default: 30000)

Other:
  --help, -h           Show this help message

Examples:
  # Run full ACP flow with an agent
  node registry-launcher-client.js --tcp localhost:9000 --agent my-agent --flow full

  # Send just an initialize request
  node registry-launcher-client.js --tcp localhost:9000 --agent my-agent --flow initialize

  # Create a new session
  node registry-launcher-client.js --tcp localhost:9000 --agent my-agent --flow session-new

  # Send a prompt to an existing session
  node registry-launcher-client.js --tcp localhost:9000 --agent my-agent --flow session-prompt --session sess-123

  # Interactive mode - type JSON messages, agentId added automatically
  node registry-launcher-client.js --tcp localhost:9000 --agent my-agent --interactive
`);
}

/**
 * Generate a unique request ID.
 * @param {string} prefix - Prefix for the ID
 * @returns {string} Unique ID
 */
function generateId(prefix = 'req') {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * Generate a unique session ID.
 * @returns {string} Session ID
 */
function generateSessionId() {
  return `sess-${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * Build an ACP initialize request.
 * @param {string} agentId - Agent ID for routing
 * @returns {Object} JSON-RPC initialize request
 */
function buildInitializeRequest(agentId) {
  return {
    jsonrpc: '2.0',
    id: generateId('init'),
    method: 'initialize',
    agentId,
    params: {
      protocolVersion: 1,
      clientCapabilities: {},
      clientInfo: {
        name: 'registry-launcher-test-client',
        version: '1.0.0'
      }
    }
  };
}

/**
 * Build an ACP authenticate request.
 * @param {string} agentId - Agent ID for routing
 * @param {string} methodId - Authentication method ID
 * @returns {Object} JSON-RPC authenticate request
 */
function buildAuthenticateRequest(agentId, methodId) {
  return {
    jsonrpc: '2.0',
    id: generateId('auth'),
    method: 'authenticate',
    agentId,
    params: {
      methodId
    }
  };
}

/**
 * Build an ACP session/new request.
 * @param {string} agentId - Agent ID for routing
 * @returns {Object} JSON-RPC session/new request
 */
function buildSessionNewRequest(agentId) {
  return {
    jsonrpc: '2.0',
    id: generateId('session-new'),
    method: 'session/new',
    agentId,
    params: {
      cwd: process.cwd(),
      mcpServers: []
    }
  };
}

/**
 * Build an ACP session/prompt request.
 * @param {string} agentId - Agent ID for routing
 * @param {string} sessionId - Session ID
 * @param {string} promptText - Prompt text
 * @returns {Object} JSON-RPC session/prompt request
 */
function buildSessionPromptRequest(agentId, sessionId, promptText) {
  return {
    jsonrpc: '2.0',
    id: generateId('prompt'),
    method: 'session/prompt',
    agentId,
    params: {
      sessionId,
      prompt: [
        {
          type: 'text',
          text: promptText
        }
      ]
    }
  };
}

/**
 * Create a socket connection to stdio Bus.
 * @param {Object} options - Connection options
 * @returns {net.Socket} Connected socket
 */
function createConnection(options) {
  if (options.tcp) {
    const [host, portStr] = options.tcp.split(':');
    const port = parseInt(portStr, 10);
    if (!host || isNaN(port)) {
      console.error('Invalid TCP address. Use format: host:port');
      process.exit(1);
    }
    console.error(`Connecting to TCP ${host}:${port}...`);
    return net.createConnection({ host, port });
  } else if (options.unix) {
    console.error(`Connecting to Unix socket ${options.unix}...`);
    return net.createConnection({ path: options.unix });
  } else {
    console.error('Error: Must specify --tcp or --unix');
    process.exit(1);
  }
}

/**
 * Send a request and wait for response.
 * @param {net.Socket} socket - Connected socket
 * @param {Object} request - Request to send
 * @param {number} timeout - Timeout in ms
 * @returns {Promise<Object>} Response object
 */
function sendRequest(socket, request, timeout) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    let timeoutId;

    const cleanup = () => {
      clearTimeout(timeoutId);
      socket.removeListener('data', onData);
      socket.removeListener('error', onError);
      socket.removeListener('close', onClose);
    };

    const onData = (data) => {
      buffer += data.toString();

      let newlineIndex;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);

        if (line.trim()) {
          try {
            const response = JSON.parse(line);
            // Check if this response matches our request ID
            if (response.id === request.id) {
              cleanup();
              resolve(response);
              return;
            } else {
              // Log other responses (notifications, etc.)
              console.error(`← Received (other): ${JSON.stringify(response)}`);
            }
          } catch (err) {
            console.error(`Error parsing response: ${err.message}`);
          }
        }
      }
    };

    const onError = (err) => {
      cleanup();
      reject(new Error(`Connection error: ${err.message}`));
    };

    const onClose = () => {
      cleanup();
      reject(new Error('Connection closed before response received'));
    };

    timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error(`Timeout: No response within ${timeout}ms`));
    }, timeout);

    socket.on('data', onData);
    socket.on('error', onError);
    socket.on('close', onClose);

    // Send the request
    console.error(`→ Sending: ${JSON.stringify(request)}`);
    socket.write(JSON.stringify(request) + '\n');
  });
}

/**
 * Run the initialize flow.
 * @param {net.Socket} socket - Connected socket
 * @param {Object} options - Options
 * @returns {Promise<Object>} Initialize response
 */
async function runInitializeFlow(socket, options) {
  console.error('\n=== Initialize Flow ===');
  const request = buildInitializeRequest(options.agentId);
  const response = await sendRequest(socket, request, options.timeout);

  console.log('\nInitialize Response:');
  console.log(JSON.stringify(response, null, 2));

  if (response.error) {
    console.error(`✗ Initialize failed: ${response.error.message}`);
  } else {
    console.error('✓ Initialize successful');
    if (response.result?.protocolVersion) {
      console.error(`  Protocol version: ${response.result.protocolVersion}`);
    }
    if (response.result?.serverInfo) {
      console.error(`  Server: ${response.result.serverInfo.name} v${response.result.serverInfo.version}`);
    }
  }

  return response;
}

/**
 * Run the authenticate flow.
 * @param {net.Socket} socket - Connected socket
 * @param {Object} options - Options
 * @param {string} methodId - Authentication method ID
 * @returns {Promise<Object>} Authenticate response
 */
async function runAuthenticateFlow(socket, options, methodId) {
  console.error('\n=== Authenticate Flow ===');
  console.error(`  Method: ${methodId}`);
  const request = buildAuthenticateRequest(options.agentId, methodId);
  const response = await sendRequest(socket, request, options.timeout);

  console.log('\nAuthenticate Response:');
  console.log(JSON.stringify(response, null, 2));

  if (response.error) {
    console.error(`✗ Authentication failed: ${response.error.message}`);
  } else {
    console.error('✓ Authentication successful');
  }

  return response;
}

/**
 * Run the session/new flow.
 * @param {net.Socket} socket - Connected socket
 * @param {Object} options - Options
 * @returns {Promise<Object>} Session/new response
 */
async function runSessionNewFlow(socket, options) {
  console.error('\n=== Session/New Flow ===');
  const request = buildSessionNewRequest(options.agentId);
  const response = await sendRequest(socket, request, options.timeout);

  console.log('\nSession/New Response:');
  console.log(JSON.stringify(response, null, 2));

  if (response.error) {
    console.error(`✗ Session creation failed: ${response.error.message}`);
  } else {
    console.error('✓ Session created successfully');
    if (response.result?.sessionId) {
      console.error(`  Session ID: ${response.result.sessionId}`);
    }
  }

  return response;
}

/**
 * Run the session/prompt flow.
 * @param {net.Socket} socket - Connected socket
 * @param {Object} options - Options
 * @param {string} sessionId - Session ID to use
 * @returns {Promise<Object>} Session/prompt response
 */
async function runSessionPromptFlow(socket, options, sessionId) {
  console.error('\n=== Session/Prompt Flow ===');
  const request = buildSessionPromptRequest(options.agentId, sessionId, options.prompt);
  const response = await sendRequest(socket, request, options.timeout);

  console.log('\nSession/Prompt Response:');
  console.log(JSON.stringify(response, null, 2));

  if (response.error) {
    console.error(`✗ Prompt failed: ${response.error.message}`);
  } else {
    console.error('✓ Prompt successful');
    if (response.result?.messages) {
      console.error(`  Response messages: ${response.result.messages.length}`);
    }
  }

  return response;
}

/**
 * Run the full ACP flow (initialize → session/new → session/prompt).
 * @param {net.Socket} socket - Connected socket
 * @param {Object} options - Options
 */
async function runFullFlow(socket, options) {
  console.error('\n========================================');
  console.error('Running Full ACP Flow');
  console.error(`Agent: ${options.agentId}`);
  console.error('========================================');

  // Step 1: Initialize
  const initResponse = await runInitializeFlow(socket, options);
  if (initResponse.error) {
    console.error('\nFull flow aborted due to initialize failure.');
    return;
  }

  // Step 2: Authenticate if required
  const authMethods = initResponse.result?.authMethods || [];
  if (authMethods.length > 0) {
    // Prefer openai-api-key, then any api-key method, then first available
    const openaiMethod = authMethods.find(m => m.id === 'openai-api-key');
    const apiKeyMethod = authMethods.find(m =>
      m.id.includes('api-key') || m.id.includes('apikey')
    );
    const methodId = openaiMethod?.id || apiKeyMethod?.id || authMethods[0].id;

    const authResponse = await runAuthenticateFlow(socket, options, methodId);
    if (authResponse.error) {
      console.error('\nFull flow aborted due to authentication failure.');
      return;
    }
  }

  // Step 3: Create session
  const sessionResponse = await runSessionNewFlow(socket, options);
  if (sessionResponse.error) {
    console.error('\nFull flow aborted due to session creation failure.');
    return;
  }

  // Extract session ID from response
  const sessionId = sessionResponse.result?.sessionId || options.sessionId || generateSessionId();

  // Step 4: Send prompt
  await runSessionPromptFlow(socket, options, sessionId);

  console.error('\n========================================');
  console.error('Full ACP Flow Complete');
  console.error('========================================');
}

/**
 * Run a single flow based on options.
 * @param {Object} options - Parsed options
 */
async function runSingleFlow(options) {
  const socket = createConnection(options);

  socket.on('connect', async () => {
    console.error('Connected.');

    try {
      switch (options.flow) {
        case 'initialize':
          await runInitializeFlow(socket, options);
          break;
        case 'session-new':
          await runSessionNewFlow(socket, options);
          break;
        case 'session-prompt':
          const sessionId = options.sessionId || generateSessionId();
          if (!options.sessionId) {
            console.error(`Note: Using generated session ID: ${sessionId}`);
          }
          await runSessionPromptFlow(socket, options, sessionId);
          break;
        case 'full':
          await runFullFlow(socket, options);
          break;
        default:
          console.error(`Unknown flow: ${options.flow}`);
          console.error('Valid flows: initialize, session-new, session-prompt, full');
      }
    } catch (err) {
      console.error(`\nError: ${err.message}`);
    } finally {
      socket.end();
    }
  });

  socket.on('error', (err) => {
    console.error(`Connection error: ${err.message}`);
    process.exit(1);
  });

  socket.on('close', () => {
    console.error('\nConnection closed.');
    process.exit(0);
  });
}

/**
 * Run in interactive mode.
 * Reads JSON messages from stdin and adds agentId before sending.
 * @param {Object} options - Parsed options
 */
function runInteractive(options) {
  const socket = createConnection(options);
  let buffer = '';

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
    terminal: false
  });

  socket.on('connect', () => {
    console.error('Connected in interactive mode.');
    console.error(`Agent ID: ${options.agentId} (will be added to all messages)`);
    console.error('\nEnter JSON-RPC messages (one per line). agentId will be added automatically.');
    console.error('Example: {"jsonrpc":"2.0","id":"1","method":"initialize","params":{}}');
    console.error('Press Ctrl+D to exit.\n');
  });

  // Handle incoming responses
  socket.on('data', (data) => {
    buffer += data.toString();

    let newlineIndex;
    while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);

      if (line.trim()) {
        try {
          const response = JSON.parse(line);
          console.log('\n← Response:');
          console.log(JSON.stringify(response, null, 2));
          console.error('');
        } catch (err) {
          console.error(`Error parsing response: ${err.message}`);
        }
      }
    }
  });

  // Handle user input
  rl.on('line', (line) => {
    if (!line.trim()) return;

    try {
      // Parse the user's JSON
      const msg = JSON.parse(line);

      // Add agentId for routing
      msg.agentId = options.agentId;

      console.error(`→ Sending (with agentId=${options.agentId}): ${JSON.stringify(msg)}`);
      socket.write(JSON.stringify(msg) + '\n');
    } catch (err) {
      console.error(`Invalid JSON: ${err.message}`);
      console.error('Please enter a valid JSON object.');
    }
  });

  rl.on('close', () => {
    console.error('\nClosing connection...');
    socket.end();
  });

  socket.on('error', (err) => {
    console.error(`Connection error: ${err.message}`);
    rl.close();
    process.exit(1);
  });

  socket.on('close', () => {
    console.error('Connection closed.');
    process.exit(0);
  });
}

/**
 * Main entry point.
 */
function main() {
  const options = parseArgs();

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  // Validate required options
  if (!options.tcp && !options.unix) {
    console.error('Error: Must specify --tcp or --unix connection');
    console.error('Use --help for usage information.');
    process.exit(1);
  }

  if (!options.agentId) {
    console.error('Error: Must specify --agent <id> for routing');
    console.error('Use --help for usage information.');
    process.exit(1);
  }

  // Determine mode
  if (options.interactive) {
    runInteractive(options);
  } else if (options.flow) {
    runSingleFlow(options);
  } else {
    // Default to full flow if no specific flow or interactive mode
    options.flow = 'full';
    runSingleFlow(options);
  }
}

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error(`Uncaught exception: ${err.message}`);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason) => {
  console.error(`Unhandled rejection: ${reason}`);
  process.exit(1);
});

main();
