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
import { RegistryFetchError, RegistryIndex, RegistryParseError, CustomAgentsLoadError, loadCustomAgents } from './registry/index.js';
import { NDJSONHandler } from './stream/ndjson-handler.js';
import { AgentRuntimeManager } from './runtime/manager.js';
import { MessageRouter } from './router/message-router.js';
import { logError, logExit, logInfo, logWarn } from './log.js';
import { runSetupCommand, runStatusCommand, runLogoutCommand, runLoginCommand } from './auth/cli/index.js';
import type { AuthProviderId } from './auth/types.js';
import { isValidProviderId, VALID_PROVIDER_IDS } from './auth/types.js';
import { AuthManager } from './auth/auth-manager.js';
import { TokenManager } from './auth/token-manager.js';
import { CredentialStore } from './auth/storage/credential-store.js';
import { getProvider } from './auth/providers/index.js';

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
 * Parsed command-line arguments.
 */
interface ParsedArgs {
  /** Path to the config file (positional argument) */
  configPath?: string;
  /** Path to the custom agents JSON file (--custom-agents <path>) */
  customAgentsPath?: string;
  /** Run the --setup auth command */
  setup?: boolean;
  /** Run the --auth-status command */
  authStatus?: boolean;
  /** Run the --logout command */
  logout?: boolean;
  /** Provider ID for --logout (optional) */
  logoutProvider?: AuthProviderId;
  /** Run the --login command */
  login?: boolean;
  /** Provider ID for --login (required) */
  loginProvider?: string;
}

/**
 * Parse command-line arguments.
 *
 * Usage: node index.js [config-path] [--custom-agents <path>] [--setup] [--auth-status] [--logout [provider]] [--login <provider>]
 *
 * @returns Parsed arguments
 */
function parseArgs(): ParsedArgs {
  // argv[0] is node, argv[1] is the script path
  const args = process.argv.slice(2);
  const result: ParsedArgs = {};

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === '--custom-agents') {
      const nextArg = args[i + 1];
      if (nextArg && !nextArg.startsWith('-')) {
        result.customAgentsPath = nextArg;
        i += 2;
        continue;
      }
      // --custom-agents without value: log warning and skip
      logWarn('--custom-agents requires a file path argument, ignoring');
      i += 1;
      continue;
    }

    // Auth CLI flags (Requirement 9.1, 9.2, 9.3)
    if (arg === '--setup') {
      result.setup = true;
      i += 1;
      continue;
    }

    if (arg === '--auth-status') {
      result.authStatus = true;
      i += 1;
      continue;
    }

    if (arg === '--logout') {
      result.logout = true;
      // Check if next arg is a provider ID (not a flag)
      const nextArg = args[i + 1];
      if (nextArg && !nextArg.startsWith('-')) {
        result.logoutProvider = nextArg as AuthProviderId;
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }

    // --login [provider] flag (Requirement 3.1, 9.1)
    if (arg === '--login') {
      result.login = true;
      // Check if next arg is a provider ID (not a flag)
      const nextArg = args[i + 1];
      if (nextArg && !nextArg.startsWith('-')) {
        result.loginProvider = nextArg;
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }

    // First non-flag argument is the config path
    if (!arg.startsWith('-') && !result.configPath) {
      result.configPath = arg;
    }

    i += 1;
  }

  return result;
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
 * 2. Handle auth CLI commands (--setup, --auth-status, --logout) if present
 * 3. Fetch and parse registry on startup
 * 4. Set up stdin NDJSON handler
 * 5. Wire up message router with registry and runtime manager
 * 6. Handle SIGTERM for graceful shutdown
 * 7. Exit with appropriate codes
 */
async function main(): Promise<void> {
  logInfo('Registry Launcher starting');

  // Parse command-line arguments
  const parsedArgs = parseArgs();

  // Handle auth CLI commands (Requirement 9.1, 9.2, 9.3)
  // These commands exit after completion and don't start the worker
  if (parsedArgs.setup) {
    logInfo('Running --setup command');
    const exitCode = await runSetupCommand();
    process.exit(exitCode);
  }

  if (parsedArgs.authStatus) {
    logInfo('Running --auth-status command');
    const exitCode = await runStatusCommand();
    process.exit(exitCode);
  }

  if (parsedArgs.logout) {
    logInfo('Running --logout command');
    const exitCode = await runLogoutCommand(parsedArgs.logoutProvider);
    process.exit(exitCode);
  }

  // Handle --login command (Requirement 3.1, 9.1)
  if (parsedArgs.login) {
    logInfo('Running --login command');

    // Validate that provider is specified
    if (!parsedArgs.loginProvider) {
      logError('Error: --login requires a provider argument.');
      logError(`Usage: --login <provider>`);
      logError(`Supported providers: ${VALID_PROVIDER_IDS.join(', ')}`);
      process.exit(ExitCodes.FATAL_ERROR);
    }

    // Validate provider ID
    if (!isValidProviderId(parsedArgs.loginProvider)) {
      logError(`Error: Invalid provider '${parsedArgs.loginProvider}'.`);
      logError(`Supported providers: ${VALID_PROVIDER_IDS.join(', ')}`);
      process.exit(ExitCodes.FATAL_ERROR);
    }

    const exitCode = await runLoginCommand(parsedArgs.loginProvider);
    process.exit(exitCode);
  }

  if (parsedArgs.configPath) {
    logInfo(`Loading configuration from: ${parsedArgs.configPath}`);
  }

  // Load configuration
  const config = loadConfig(parsedArgs.configPath);

  // CLI --custom-agents takes precedence over config file and env
  if (parsedArgs.customAgentsPath) {
    config.customAgentsPath = parsedArgs.customAgentsPath;
  }

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

  // Load and merge custom agents if --custom-agents was provided
  if (config.customAgentsPath) {
    try {
      logInfo(`Loading custom agents from: ${config.customAgentsPath}`);
      const customAgents = loadCustomAgents(config.customAgentsPath);
      registry.mergeCustomAgents(customAgents);
    } catch (error) {
      if (error instanceof CustomAgentsLoadError) {
        logError(`Failed to load custom agents: ${error.message}`);
        process.exit(ExitCodes.FATAL_ERROR);
      }
      if (error instanceof RegistryParseError) {
        logError(`Invalid custom agents file: ${error.message}`);
        process.exit(ExitCodes.FATAL_ERROR);
      }
      logError(`Unexpected error loading custom agents: ${(error as Error).message}`);
      process.exit(ExitCodes.FATAL_ERROR);
    }
  }

  // Create runtime manager
  const runtimeManager = new AgentRuntimeManager();

  // Create NDJSON handler for stdin/stdout
  const ndjsonHandler = new NDJSONHandler(process.stdout);

  // Create OAuth authentication components (Requirement 3.1, 10.3)
  const credentialStore = new CredentialStore();
  const tokenManager = new TokenManager({
    credentialStore,
    providerResolver: getProvider,
  });
  const authManager = new AuthManager({
    credentialStore,
    tokenManager,
    legacyApiKeys: apiKeys,
  });
  logInfo('OAuth authentication manager initialized');

  // Create message router with AuthManager for OAuth support
  const router = new MessageRouter(
    registry,
    runtimeManager,
    (message: object) => ndjsonHandler.write(message),
    apiKeys,
    authManager,
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
