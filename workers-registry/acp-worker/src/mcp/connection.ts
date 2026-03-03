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
 * MCP Connection
 *
 * Represents a single connection to an MCP server.
 * Uses @modelcontextprotocol/sdk for protocol handling.
 *
 * @module mcp/connection
 */

import type { MCPResource, MCPServerConfig, MCPTool } from './types.js';

/**
 * Represents a connection to a single MCP server.
 */
export class MCPConnection {
  private _config: MCPServerConfig;
  private connected: boolean = false;

  constructor(config: MCPServerConfig) {
    this._config = config;
  }

  /**
   * Get the server configuration.
   */
  get config(): MCPServerConfig {
    return this._config;
  }

  /**
   * Establish connection to the MCP server.
   */
  async connect(): Promise<void> {
    // TODO: Implement in task 22.2
    throw new Error('Not implemented');
  }

  /**
   * Check if the connection is active.
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get tools available from this server.
   */
  async listTools(): Promise<MCPTool[]> {
    // TODO: Implement in task 23.1
    throw new Error('Not implemented');
  }

  /**
   * Invoke a tool on this server.
   */
  async callTool(_name: string, _args: Record<string, unknown>): Promise<unknown> {
    // TODO: Implement in task 23.2
    throw new Error('Not implemented');
  }

  /**
   * Get resources available from this server.
   */
  async listResources(): Promise<MCPResource[]> {
    // TODO: Implement in task 24.1
    throw new Error('Not implemented');
  }

  /**
   * Read a resource from this server.
   */
  async readResource(_uri: string): Promise<unknown> {
    // TODO: Implement in task 24.2
    throw new Error('Not implemented');
  }

  /**
   * Close the connection to the MCP server.
   */
  async close(): Promise<void> {
    // TODO: Implement in task 29.1
    this.connected = false;
  }

  /**
   * Abort all pending operations on this connection.
   * Called when a session is cancelled to stop in-flight requests.
   */
  abortPendingOperations(): void {
    // When the MCP client is fully implemented (task 22.2),
    // this will abort any pending requests using AbortController
    // For now, mark the connection as not connected to prevent new operations
    this.connected = false;
  }
}
