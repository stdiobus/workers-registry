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
 * OpenAI Agent Worker for stdio Bus kernel
 *
 * This worker implements the Agent Client Protocol (ACP) and bridges
 * to any OpenAI Chat Completions API-compatible endpoint.
 *
 * It runs as a child process of stdio Bus kernel, communicating via stdin/stdout NDJSON.
 *
 * @module index
 */

import { Readable, Writable, Transform } from 'node:stream';
import { AgentSideConnection, ndJsonStream } from '@agentclientprotocol/sdk';
import { OpenAIAgent } from './agent.js';
import { SessionIdRouter } from './session-id-router.js';

// Log startup message to stderr (not stdout - stdout is for protocol messages)
console.error('[openai-agent] Starting OpenAI Agent Worker...');

const sessionIdRouter = new SessionIdRouter();

/**
 * Transform stream to intercept stdin and save sessionId from requests.
 * Removes sessionId before passing to ACP SDK (SDK doesn't know about it).
 */
const stdinTransform = new Transform({
  objectMode: false,
  transform(chunk: Buffer, _encoding, callback) {
    const lines = chunk.toString().split('\n');
    const processedLines: string[] = [];

    for (const line of lines) {
      processedLines.push(sessionIdRouter.processIncomingLine(line));
    }

    callback(null, Buffer.from(processedLines.join('\n')));
  },
});

/**
 * Transform stream to intercept stdout and restore sessionId in responses.
 * Adds sessionId back for stdio_bus routing.
 */
const stdoutTransform = new Transform({
  objectMode: false,
  transform(chunk: Buffer, _encoding, callback) {
    const lines = chunk.toString().split('\n');
    const processedLines: string[] = [];

    for (const line of lines) {
      processedLines.push(sessionIdRouter.processOutgoingLine(line));
    }

    callback(null, Buffer.from(processedLines.join('\n')));
  },
});

// Pipe stdin through transform before SDK
process.stdin.pipe(stdinTransform);

/**
 * Convert transformed stdin to web ReadableStream for SDK.
 */
const inputStream = Readable.toWeb(stdinTransform) as ReadableStream<Uint8Array>;

/**
 * Convert stdout transform to web WritableStream for SDK.
 */
const outputStream = Writable.toWeb(stdoutTransform) as WritableStream<Uint8Array>;

// Pipe transform output to actual stdout
stdoutTransform.pipe(process.stdout);

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
  (conn) => new OpenAIAgent(conn),
  stream,
);

// Log that connection is established
console.error('[openai-agent] AgentSideConnection established, ready for messages');

/**
 * Handle graceful shutdown on SIGTERM.
 *
 * When stdio Bus kernel sends SIGTERM, we should wait for the connection to close
 * and allow pending operations to complete.
 */
process.on('SIGTERM', async () => {
  console.error('[openai-agent] Received SIGTERM, shutting down...');
  await connection.closed;
  process.exit(0);
});

/**
 * Handle SIGINT for development convenience.
 */
process.on('SIGINT', async () => {
  console.error('[openai-agent] Received SIGINT, shutting down...');
  await connection.closed;
  process.exit(0);
});

/**
 * Handle uncaught exceptions to prevent silent failures.
 */
process.on('uncaughtException', (error) => {
  console.error('[openai-agent] Uncaught exception:', error);
  process.exit(1);
});

/**
 * Handle unhandled promise rejections.
 */
process.on('unhandledRejection', (reason, promise) => {
  console.error('[openai-agent] Unhandled rejection at:', promise, 'reason:', reason);
});

/**
 * Wait for the connection to close (either normally or due to error).
 * This keeps the process running until the connection ends.
 */
connection.closed.then(() => {
  console.error('[openai-agent] Connection closed');
  process.exit(0);
}).catch((error) => {
  console.error('[openai-agent] Connection error:', error);
  process.exit(1);
});
