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
 * API Keys loading for the Registry Launcher.
 *
 * Handles loading API keys from JSON files for agent authentication.
 *
 * @module config/api-keys
 */

import { readFileSync } from 'node:fs';

/**
 * API keys structure for a single agent.
 */
export interface AgentApiKeys {
  /** API key for the agent */
  apiKey: string;
  /** Environment variables to pass to the agent */
  env: Record<string, string>;
}

/**
 * API keys file structure.
 */
export interface ApiKeysFile {
  /** Map of agent ID to API keys */
  agents: Record<string, AgentApiKeys>;
  /** Version of the API keys file format */
  version: string;
}

/**
 * Log a warning message to stderr with ISO 8601 timestamp.
 * @param message - Warning message to log
 */
function logWarning(message: string): void {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] [WARN] [api-keys] ${message}`);
}

/**
 * Log an info message to stderr with ISO 8601 timestamp.
 * @param message - Info message to log
 */
function logInfo(message: string): void {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] [INFO] [api-keys] ${message}`);
}

/**
 * Load API keys from a JSON file.
 *
 * @param apiKeysPath - Path to the API keys JSON file
 * @returns Loaded API keys or empty object if file is missing/malformed
 */
export function loadApiKeys(apiKeysPath: string): Record<string, AgentApiKeys> {
  try {
    const fileContent = readFileSync(apiKeysPath, 'utf-8');
    const parsed = JSON.parse(fileContent) as ApiKeysFile;

    if (!parsed.agents || typeof parsed.agents !== 'object') {
      logWarning(`API keys file "${apiKeysPath}" does not contain valid "agents" object`);
      return {};
    }

    // Count agents with non-empty API keys
    const agentsWithKeys = Object.entries(parsed.agents).filter(
      ([_, keys]) => keys.apiKey && keys.apiKey.length > 0,
    );

    logInfo(`Loaded API keys for ${agentsWithKeys.length} agents from "${apiKeysPath}"`);

    return parsed.agents;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      logWarning(`API keys file "${apiKeysPath}" not found, agents will not be authenticated`);
    } else if (error instanceof SyntaxError) {
      logWarning(`API keys file "${apiKeysPath}" contains malformed JSON`);
    } else {
      logWarning(`Failed to read API keys file "${apiKeysPath}": ${(error as Error).message}`);
    }
    return {};
  }
}

/**
 * Get API key for a specific agent.
 *
 * @param apiKeys - Loaded API keys
 * @param agentId - Agent ID to get key for
 * @returns API key or undefined if not found
 */
export function getAgentApiKey(
  apiKeys: Record<string, AgentApiKeys>,
  agentId: string,
): string | undefined {
  const keys = apiKeys[agentId];
  if (!keys || !keys.apiKey || keys.apiKey.length === 0) {
    return undefined;
  }
  return keys.apiKey;
}

/**
 * Get environment variables for a specific agent.
 *
 * @param apiKeys - Loaded API keys
 * @param agentId - Agent ID to get env vars for
 * @returns Environment variables or empty object if not found
 */
export function getAgentEnv(
  apiKeys: Record<string, AgentApiKeys>,
  agentId: string,
): Record<string, string> {
  const keys = apiKeys[agentId];
  if (!keys || !keys.env) {
    return {};
  }
  return keys.env;
}
