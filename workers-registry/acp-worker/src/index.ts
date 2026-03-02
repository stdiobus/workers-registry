/*
 * Apache License 2.0
 * Copyright (c) 2025–present Raman Marozau, Work Target Insight Function.
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
 * ACP/MCP Protocol Worker for stdio Bus kernel
 *
 * This worker implements the Agent Client Protocol (ACP) using official SDKs
 * and connects to MCP servers for tool execution.
 *
 * It runs as a child process of stdio Bus kernel, communicating via stdin/stdout NDJSON.
 *
 * @module index
 */

import { Readable, Writable } from 'node:stream';
import { AgentSideConnection, ndJsonStream } from '@agentclientprotocol/sdk';
import { ACPAgent } from './agent.js';

// Log startup message to stderr (not stdout - stdout is for protocol messages)
console.error('[worker] Starting ACP/MCP Protocol Worker...');

/**
 * Convert Node.js stdin to a web ReadableStream.
 * The SDK expects web streams for NDJSON communication.
 */
const inputStream = Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>;

/**
 * Convert Node.js stdout to a web WritableStream.
 * The SDK expects web streams for NDJSON communication.
 */
const outputStream = Writable.toWeb(process.stdout) as WritableStream<Uint8Array>;

/**
 * Create the NDJSON stream for ACP communication.
 * The SDK handles all NDJSON framing and JSON-RPC protocol details automatically.
 */
const stream = ndJsonStream(outputStream, inputStream);

/**
 * Create the AgentSideConnection with stdio transport.
 *
 * The SDK pattern uses a factory function that receives the connection
 * and returns an Agent instance. The SDK handles all NDJSON framing
 * and JSON-RPC protocol details automatically.
 */
const connection = new AgentSideConnection(
  (conn) => new ACPAgent(conn),
  stream,
);

// Log that connection is established
console.error('[worker] AgentSideConnection established, ready for messages');

/**
 * Handle graceful shutdown on SIGTERM.
 *
 * When stdio Bus kernel sends SIGTERM, we should wait for the connection to close
 * and allow pending operations to complete.
 */
process.on('SIGTERM', async () => {
  console.error('[worker] Received SIGTERM, shutting down...');
  // Wait for the connection to close gracefully
  await connection.closed;
  process.exit(0);
});

/**
 * Handle SIGINT for development convenience.
 */
process.on('SIGINT', async () => {
  console.error('[worker] Received SIGINT, shutting down...');
  await connection.closed;
  process.exit(0);
});

/**
 * Handle uncaught exceptions to prevent silent failures.
 */
process.on('uncaughtException', (error) => {
  console.error('[worker] Uncaught exception:', error);
  process.exit(1);
});

/**
 * Handle unhandled promise rejections.
 */
process.on('unhandledRejection', (reason, promise) => {
  console.error('[worker] Unhandled rejection at:', promise, 'reason:', reason);
});

/**
 * Wait for the connection to close (either normally or due to error).
 * This keeps the process running until the connection ends.
 */
connection.closed.then(() => {
  console.error('[worker] Connection closed');
  process.exit(0);
}).catch((error) => {
  console.error('[worker] Connection error:', error);
  process.exit(1);
});
