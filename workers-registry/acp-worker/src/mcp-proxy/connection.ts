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
 * TCP connection handler for ACP protocol communication.
 *
 * This module manages the TCP connection to stdio Bus with NDJSON streaming,
 * handling connection lifecycle, message buffering, and line parsing.
 */

import net from 'net';
import { ACPNotification, ACPRequest, ACPResponse, ProxyConfig } from './types.js';

/**
 * TCP connection handler with NDJSON streaming.
 *
 * Manages the TCP connection to stdio Bus, handling:
 * - Connection establishment and lifecycle
 * - NDJSON buffering and line parsing
 * - Sending ACP requests
 * - Receiving ACP responses and notifications
 *
 * @example
 * ```typescript
 * const connection = new ACPConnection(
 *   config,
 *   (msg) => console.log('Received:', msg),
 *   (err) => console.error('Error:', err)
 * );
 *
 * connection.send({
 *   jsonrpc: '2.0',
 *   id: 1,
 *   method: 'initialize',
 *   agentId: 'my-agent',
 *   sessionId: 'session-123',
 *   params: {}
 * });
 * ```
 */
export class ACPConnection {
  private socket: net.Socket;
  private buffer: string = '';
  private connected: boolean = false;

  /**
   * Creates a new ACP connection.
   *
   * @param config - Proxy configuration with host and port
   * @param onMessage - Callback for received ACP messages (responses or notifications)
   * @param onError - Callback for connection errors
   */
  constructor(
    private config: ProxyConfig,
    private onMessage: (msg: ACPResponse | ACPNotification) => void,
    private onError: (err: Error) => void,
  ) {
    this.socket = net.connect(config.acpPort, config.acpHost);
    this.setupHandlers();
  }

  /**
   * Setup event handlers for the TCP socket.
   *
   * Handles connect, error, data, and close events.
   */
  private setupHandlers(): void {
    this.socket.on('connect', () => {
      console.error(`[mcp-proxy] Connected to ACP stdio Bus at ${this.config.acpHost}:${this.config.acpPort}`);
      this.connected = true;
    });

    this.socket.on('error', (err) => {
      console.error(`[mcp-proxy] ACP connection error: ${err.message}`);
      this.onError(err);
    });

    this.socket.on('data', (data) => {
      this.handleData(data);
    });

    this.socket.on('close', () => {
      console.error('[mcp-proxy] ACP connection closed');
      this.connected = false;
    });
  }

  /**
   * Buffer and parse NDJSON lines from incoming data.
   *
   * Accumulates data in a buffer and processes complete lines (ending with \n).
   * Incomplete lines remain in the buffer until more data arrives.
   *
   * @param data - Raw data received from the socket
   */
  private handleData(data: Buffer): void {
    // Append incoming data to buffer
    this.buffer += data.toString();

    // Process all complete lines (ending with \n) in the buffer
    let newlineIndex: number;
    while ((newlineIndex = this.buffer.indexOf('\n')) !== -1) {
      // Extract line up to (but not including) the newline
      const line = this.buffer.slice(0, newlineIndex);

      // Remove processed line from buffer (including the newline)
      this.buffer = this.buffer.slice(newlineIndex + 1);

      // Skip empty lines (whitespace only)
      if (line.trim()) {
        try {
          const msg = JSON.parse(line);
          console.error(`[mcp-proxy] ← ACP: ${JSON.stringify(msg)}`);
          this.onMessage(msg);
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          console.error(`[mcp-proxy] Error parsing ACP message: ${errorMessage}`);
        }
      }
    }
    // Any remaining data in buffer is an incomplete line - wait for more data
  }

  /**
   * Send an ACP request as NDJSON.
   *
   * Serializes the request to JSON and appends a newline character.
   * Logs the request to stderr for debugging.
   *
   * @param request - ACP request to send
   */
  send(request: ACPRequest): void {
    if (!this.connected) {
      console.error('[mcp-proxy] Cannot send: not connected');
      return;
    }

    const line = JSON.stringify(request) + '\n';
    console.error(`[mcp-proxy] → ACP: ${JSON.stringify(request)}`);
    this.socket.write(line);
  }

  /**
   * Close the connection gracefully.
   *
   * Ends the socket connection, allowing any pending writes to complete.
   */
  close(): void {
    this.socket.end();
  }

  /**
   * Check if the connection is currently established.
   *
   * @returns true if connected, false otherwise
   */
  isConnected(): boolean {
    return this.connected;
  }
}
