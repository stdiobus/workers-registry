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
 * Main entry point for the MCP-ACP protocol proxy.
 *
 * This module orchestrates all components (StateManager, ProtocolConverter, ACPConnection)
 * and handles stdin/stdout communication for the MCP protocol proxy.
 *
 * The proxy:
 * - Reads MCP requests from stdin (NDJSON format)
 * - Converts them to ACP requests
 * - Forwards to stdio Bus via TCP
 * - Receives ACP responses and notifications
 * - Converts back to MCP format
 * - Writes MCP responses to stdout (NDJSON format)
 *
 * Configuration via environment variables:
 * - AGENT_ID: Target agent identifier (required)
 * - ACP_HOST: stdio Bus host (default: 127.0.0.1)
 * - ACP_PORT: stdio Bus port (default: 9011)
 *
 * @example
 * ```bash
 * AGENT_ID=my-agent ./dist/mcp-proxy/index.js
 * ```
 */

import { createInterface } from 'readline';
import { ACPNotification, ACPRequest, ACPResponse, MCPRequest, MCPResponse, ProxyConfig } from './types.js';
import { StateManager } from './state.js';
import { ProtocolConverter } from './converter.js';
import { ACPConnection } from './connection.js';

/**
 * Load configuration from environment variables.
 *
 * Validates that required variables (AGENT_ID) are present and loads
 * optional variables with defaults.
 *
 * @returns Proxy configuration object
 * @throws Exits process with code 1 if AGENT_ID is missing
 *
 * @example
 * ```typescript
 * const config = loadConfig();
 * // { acpHost: '127.0.0.1', acpPort: 9011, agentId: 'my-agent' }
 * ```
 */
function loadConfig(): ProxyConfig {
  const agentId = process.env.AGENT_ID;
  if (!agentId) {
    console.error('[mcp-proxy] ERROR: AGENT_ID environment variable is required');
    process.exit(1);
  }

  const config: ProxyConfig = {
    acpHost: process.env.ACP_HOST || '127.0.0.1',
    acpPort: parseInt(process.env.ACP_PORT || '9011', 10),
    agentId,
  };

  console.error('[mcp-proxy] Starting MCP-to-ACP proxy...');
  console.error(`[mcp-proxy] Target: ${config.acpHost}:${config.acpPort}`);
  console.error(`[mcp-proxy] Agent ID: ${config.agentId}`);

  return config;
}

/**
 * Send MCP response to stdout.
 *
 * Serializes the response to JSON and writes to stdout with newline.
 * Logs the response to stderr for debugging.
 *
 * @param response - MCP response to send
 *
 * @example
 * ```typescript
 * sendMCP({ jsonrpc: '2.0', id: 1, result: { tools: [] } });
 * ```
 */
function sendMCP(response: MCPResponse): void {
  console.error(`[mcp-proxy] → MCP: ${JSON.stringify(response)}`);
  process.stdout.write(JSON.stringify(response) + '\n');
}

/**
 * Main proxy logic.
 *
 * Orchestrates all components:
 * 1. Loads configuration
 * 2. Initializes state manager and protocol converter
 * 3. Establishes TCP connection to stdio Bus
 * 4. Sets up stdin reader for MCP requests
 * 5. Routes messages between MCP and ACP
 * 6. Handles signals and errors
 */
function main(): void {
  const config = loadConfig();
  const state = new StateManager();

  // We'll set the sendACPCallback after creating the connection
  // This callback is used by the converter to send queued requests
  // (e.g., session/prompt after session/new completes)
  let connection: ACPConnection;

  const converter = new ProtocolConverter(
    config,
    state,
    (request: ACPRequest) => {
      // Callback for sending ACP requests (used for queued requests)
      if (connection && connection.isConnected()) {
        connection.send(request);
      }
    },
  );

  // Setup TCP connection to stdio Bus
  connection = new ACPConnection(
    config,
    (msg) => {
      // Handle incoming ACP message (response or notification)
      // Type guard: notifications don't have 'id' field, responses do
      if ('id' in msg && msg.id !== undefined && msg.id !== null) {
        // Response (has id field) - convert to MCP and send to stdout
        const mcpResponse = converter.convertACPtoMCP(msg as ACPResponse);
        if (mcpResponse) {
          sendMCP(mcpResponse);
        }
      } else {
        // Notification (no id field) - handle internally (e.g., text accumulation)
        converter.handleACPNotification(msg as ACPNotification);
      }
    },
    (err) => {
      // Fatal connection error - cannot continue without stdio Bus connection
      console.error(`[mcp-proxy] Fatal connection error: ${err.message}`);
      process.exit(1);
    },
  );

  // Setup stdin reader for MCP requests
  const rl = createInterface({
    input: process.stdin,
    terminal: false,
  });

  rl.on('line', (line) => {
    // Ignore empty lines (whitespace only)
    if (!line.trim()) return;

    try {
      // Parse MCP request from stdin
      const mcpReq: MCPRequest = JSON.parse(line);
      console.error(`[mcp-proxy] ← MCP: ${JSON.stringify(mcpReq)}`);

      // Convert to ACP and send if connection is ready
      const acpReq = converter.convertMCPtoACP(mcpReq);
      if (acpReq && connection.isConnected()) {
        connection.send(acpReq);
      }
      // Note: Some MCP methods (tools/list, resources/list) return null
      // because they're handled directly without forwarding to ACP
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`[mcp-proxy] Error parsing MCP request: ${errorMessage}`);
      // Continue processing - don't exit on parse errors
    }
  });

  // Signal handlers for graceful shutdown
  process.on('SIGTERM', () => {
    console.error('[mcp-proxy] Received SIGTERM, shutting down...');
    connection.close();
    process.exit(0);
  });

  process.on('SIGINT', () => {
    console.error('[mcp-proxy] Received SIGINT, shutting down...');
    connection.close();
    process.exit(0);
  });

  // Exception handlers for fatal errors
  process.on('uncaughtException', (err) => {
    console.error('[mcp-proxy] Uncaught exception:', err);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    console.error('[mcp-proxy] Unhandled rejection:', reason);
    process.exit(1);
  });
}

// Start the proxy
main();
