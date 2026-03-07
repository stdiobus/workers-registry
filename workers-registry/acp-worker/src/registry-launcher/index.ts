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
 * Main entry point for the Registry Launcher Worker.
 *
 * The Registry Launcher is a stdio Bus worker that:
 * 1. Fetches and parses the ACP Registry on startup
 * 2. Receives NDJSON messages from stdio Bus via stdin
 * 3. Routes messages to appropriate agent processes based on agentId
 * 4. Forwards agent responses back to stdout unchanged
 *
 * @module registry-launcher
 */

import { loadConfig } from './config/config.js';
import { loadApiKeys } from './config/api-keys.js';
import { RegistryFetchError, RegistryIndex, RegistryParseError } from './registry/index.js';
import { NDJSONHandler } from './stream/ndjson-handler.js';
import { AgentRuntimeManager } from './runtime/manager.js';
import { MessageRouter } from './router/message-router.js';
import { logError, logExit, logInfo } from './log.js';

/**
 * Exit codes for the Registry Launcher.
 */
const ExitCodes = {
  /** Successful graceful shutdown */
  SUCCESS: 0,
  /** Fatal error during startup or operation */
  FATAL_ERROR: 1,
} as const;

/**
 * Flag to track if shutdown is in progress.
 */
let isShuttingDown = false;

/**
 * Parse command-line arguments to get the config file path.
 *
 * Usage: node index.js [config-path]
 *
 * @returns The config file path or undefined if not provided
 */
function parseArgs(): string | undefined {
  // argv[0] is node, argv[1] is the script path
  // argv[2] is the first argument (config path)
  const args = process.argv.slice(2);

  if (args.length > 0 && args[0] && !args[0].startsWith('-')) {
    return args[0];
  }

  return undefined;
}

/**
 * Set up SIGTERM handler for graceful shutdown.
 *
 * @param runtimeManager - The runtime manager to terminate agents
 * @param shutdownTimeoutMs - Timeout in milliseconds for graceful shutdown
 * @returns A function to trigger shutdown programmatically
 */
function setupSignalHandlers(
  runtimeManager: AgentRuntimeManager,
  shutdownTimeoutMs: number,
): () => Promise<void> {
  const shutdown = async (): Promise<void> => {
    if (isShuttingDown) {
      return;
    }
    isShuttingDown = true;

    logInfo('Received shutdown signal, initiating graceful shutdown');

    try {
      // Terminate all agent processes
      await runtimeManager.terminateAll(shutdownTimeoutMs);
      logInfo('All agent processes terminated');

      // Exit with success code
      process.exit(ExitCodes.SUCCESS);
    } catch (error) {
      logError(`Error during shutdown: ${(error as Error).message}`);
      process.exit(ExitCodes.FATAL_ERROR);
    }
  };

  // Handle SIGTERM
  process.on('SIGTERM', () => {
    void shutdown();
  });

  // Also handle SIGINT for development convenience
  process.on('SIGINT', () => {
    void shutdown();
  });

  return shutdown;
}

/**
 * Set up stdin NDJSON handler and wire up message routing.
 *
 * @param router - The message router for handling incoming messages
 * @param ndjsonHandler - The NDJSON handler for stdin/stdout
 */
function setupStdinHandler(router: MessageRouter, ndjsonHandler: NDJSONHandler): void {
  // Handle parsed messages from stdin
  ndjsonHandler.onMessage(async (message: object) => {
    try {
      const errorResponse = await router.route(message);

      // If routing returned an error, write it to stdout
      if (errorResponse) {
        ndjsonHandler.write(errorResponse);
      }
    } catch (error) {
      logError(`Unexpected error routing message: ${(error as Error).message}`);
    }
  });

  // Handle parse errors
  ndjsonHandler.onError((error: Error, line: string) => {
    logError(`Failed to parse NDJSON: ${error.message} - Line: ${line.slice(0, 100)}`);
  });

  // Process stdin data
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: Buffer | string) => {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    ndjsonHandler.processChunk(buffer);
  });

  // Handle stdin close
  process.stdin.on('end', () => {
    logInfo('stdin closed');
  });

  // Handle stdin errors
  process.stdin.on('error', (error: Error) => {
    logError(`stdin error: ${error.message}`);
  });
}

/**
 * Set up agent response handling.
 *
 * Wires up agent stdout to the message router for forwarding responses.
 *
 * @param runtimeManager - The runtime manager
 * @param router - The message router
 */
function setupAgentResponseHandling(
  runtimeManager: AgentRuntimeManager,
  router: MessageRouter,
): void {
  // Handle agent exit events
  runtimeManager.onAgentExit((agentId: string, code: number | null) => {
    logExit(agentId, code);
  });

  // Hook into runtime manager to set up stdout handling for new agents
  const originalGetOrSpawn = runtimeManager.getOrSpawn.bind(runtimeManager);
  runtimeManager.getOrSpawn = async function (agentId: string, spawnCommand: import('./registry/types.js').SpawnCommand) {
    const runtime = await originalGetOrSpawn(agentId, spawnCommand);

    // Set up stdout handler for this agent if not already done
    const proc = runtime.process;
    if (proc.stdout && !proc.stdout.listenerCount('data')) {
      let buffer = '';

      proc.stdout.on('data', (chunk: string) => {
        buffer += chunk;

        // Process complete NDJSON lines
        let newlineIndex;
        while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);

          if (line.trim()) {
            try {
              const response = JSON.parse(line);
              router.handleAgentResponse(agentId, response);
            } catch (err) {
              logError(`Failed to parse agent ${agentId} response: ${(err as Error).message}`);
            }
          }
        }
      });
    }

    // Log stderr from agent
    if (proc.stderr && !proc.stderr.listenerCount('data')) {
      proc.stderr.on('data', (chunk: string) => {
        // Log agent stderr to our stderr
        process.stderr.write(`[agent:${agentId}] ${chunk}`);
      });
    }

    return runtime;
  };
}

/**
 * Main entry point for the Registry Launcher.
 *
 * 1. Load configuration from command-line argument
 * 2. Fetch and parse registry on startup
 * 3. Set up stdin NDJSON handler
 * 4. Wire up message router with registry and runtime manager
 * 5. Handle SIGTERM for graceful shutdown
 * 6. Exit with appropriate codes
 */
async function main(): Promise<void> {
  logInfo('Registry Launcher starting');

  // Parse command-line arguments
  const configPath = parseArgs();
  if (configPath) {
    logInfo(`Loading configuration from: ${configPath}`);
  }

  // Load configuration
  const config = loadConfig(configPath);
  logInfo(`Configuration loaded: registryUrl=${config.registryUrl}, apiKeysPath=${config.apiKeysPath}, shutdownTimeoutSec=${config.shutdownTimeoutSec}`);

  // Load API keys
  const apiKeys = loadApiKeys(config.apiKeysPath);

  // Create registry index
  const registry = new RegistryIndex(config.registryUrl);

  // Fetch and parse registry on startup
  try {
    await registry.fetch();
  } catch (error) {
    if (error instanceof RegistryFetchError) {
      logError(`Failed to fetch registry: ${error.message}`);
      process.exit(ExitCodes.FATAL_ERROR);
    }
    if (error instanceof RegistryParseError) {
      logError(`Failed to parse registry: ${error.message}`);
      process.exit(ExitCodes.FATAL_ERROR);
    }
    logError(`Unexpected error fetching registry: ${(error as Error).message}`);
    process.exit(ExitCodes.FATAL_ERROR);
  }

  // Create runtime manager
  const runtimeManager = new AgentRuntimeManager();

  // Create NDJSON handler for stdin/stdout
  const ndjsonHandler = new NDJSONHandler(process.stdout);

  // Create message router
  const router = new MessageRouter(
    registry,
    runtimeManager,
    (message: object) => ndjsonHandler.write(message),
    apiKeys,
  );

  // Set up signal handlers for graceful shutdown
  const shutdownTimeoutMs = config.shutdownTimeoutSec * 1000;
  setupSignalHandlers(runtimeManager, shutdownTimeoutMs);

  // Set up agent response handling
  setupAgentResponseHandling(runtimeManager, router);

  // Set up stdin handler and wire up routing
  setupStdinHandler(router, ndjsonHandler);

  logInfo('Registry Launcher ready, waiting for messages');
}

// Run main and handle any uncaught errors
main().catch((error: Error) => {
  logError(`Fatal error: ${error.message}`);
  process.exit(ExitCodes.FATAL_ERROR);
});
