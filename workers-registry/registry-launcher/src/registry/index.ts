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
 * Registry Index for the ACP Registry.
 *
 * Handles fetching, parsing, and querying the ACP Registry.
 * Supports configurable registry URL via environment variable.
 *
 * @module registry/index
 */

import { AgentAuthMethod, Distribution, McpServerConfig, Registry, RegistryAgent, SpawnCommand } from './types.js';
import { resolve as resolveDistribution } from './resolver.js';
import { readFileSync } from 'node:fs';

// Re-export types for external use
export type {
  Platform,
  BinaryDistribution,
  BinaryTarget,
  NpxDistribution,
  UvxDistribution,
  Distribution,
  RegistryAgent,
  Registry,
  SpawnCommand,
  McpServerConfig,
  AgentAuthMethod,
} from './types.js';

// Re-export resolver functions and errors for external use
export { PlatformNotSupportedError, NoDistributionError, getCurrentPlatform, resolve } from './resolver.js';

/**
 * Environment variable name for registry URL override.
 */
const ENV_REGISTRY_URL = 'ACP_REGISTRY_URL';

/**
 * Error thrown when registry fetch fails.
 */
export class RegistryFetchError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = 'RegistryFetchError';
  }
}

/**
 * Error thrown when registry JSON is malformed.
 */
export class RegistryParseError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = 'RegistryParseError';
  }
}

/**
 * Error thrown when an agent is not found in the registry.
 */
export class AgentNotFoundError extends Error {
  constructor(public readonly agentId: string) {
    super(`Agent not found: ${agentId}`);
    this.name = 'AgentNotFoundError';
  }
}

/**
 * Log an error message to stderr with ISO 8601 timestamp.
 * @param message - Error message to log
 */
function logError(message: string): void {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] [ERROR] [registry] ${message}`);
}

/**
 * Log an info message to stderr with ISO 8601 timestamp.
 * @param message - Info message to log
 */
function logInfo(message: string): void {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] [INFO] [registry] ${message}`);
}

/**
 * Cached auth requirements for an agent.
 *
 * Requirements: 11.2, 11.3
 */
export interface AgentAuthRequirements {
  /** Whether authentication is required */
  authRequired: boolean;
  /** Authentication methods supported/required by the agent */
  authMethods: AgentAuthMethod[];
  /** Primary OAuth provider ID (first oauth2 method's providerId) */
  primaryOAuthProviderId?: string;
}

/**
 * Interface for the RegistryIndex.
 */
export interface IRegistryIndex {
  /**
   * Fetch and parse the ACP Registry from the configured URL.
   * @throws RegistryFetchError if fetch fails
   * @throws RegistryParseError if JSON is malformed
   */
  fetch(): Promise<void>;

  /**
   * Look up an agent by ID.
   * @returns The agent entry or undefined if not found
   */
  lookup(agentId: string): RegistryAgent | undefined;

  /**
   * Resolve an agent ID to a spawn command.
   * @throws AgentNotFoundError if agent not in registry
   * @throws PlatformNotSupportedError if binary distribution doesn't support current platform
   */
  resolve(agentId: string): SpawnCommand;

  /**
   * Get auth requirements for an agent.
   *
   * Checks the agent definition in the registry for `authRequired` or `authMethods` fields.
   * Results are cached per agent for efficient repeated lookups.
   *
   * Requirements: 11.2, 11.3
   *
   * @param agentId - Agent ID to query
   * @returns Auth requirements or undefined if agent not found
   */
  getAuthRequirements(agentId: string): AgentAuthRequirements | undefined;
}

/**
 * Validate that a value is a non-empty string.
 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Validate that a value is a valid distribution object.
 * Distribution must have at least one of: binary, npx, uvx
 */
function isValidDistribution(value: unknown): value is Distribution {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const dist = value as Record<string, unknown>;

  // Must have at least one distribution type
  const hasBinary = dist.binary !== undefined && typeof dist.binary === 'object';
  const hasNpx = dist.npx !== undefined && typeof dist.npx === 'object';
  const hasUvx = dist.uvx !== undefined && typeof dist.uvx === 'object';

  if (!hasBinary && !hasNpx && !hasUvx) {
    return false;
  }

  // Validate npx if present
  if (hasNpx) {
    const npx = dist.npx as Record<string, unknown>;
    if (!isNonEmptyString(npx.package)) {
      return false;
    }
  }

  // Validate uvx if present
  if (hasUvx) {
    const uvx = dist.uvx as Record<string, unknown>;
    if (!isNonEmptyString(uvx.package)) {
      return false;
    }
  }

  return true;
}

/**
 * Validate and parse a single MCP server configuration.
 */
function parseMcpServer(value: unknown, agentIndex: number, serverIndex: number): McpServerConfig | null {
  if (value === null || typeof value !== 'object') {
    logWarning(`Agent at index ${agentIndex}: mcpServers[${serverIndex}] is not an object, skipping`);
    return null;
  }

  const raw = value as Record<string, unknown>;

  if (!isNonEmptyString(raw.name)) {
    logWarning(`Agent at index ${agentIndex}: mcpServers[${serverIndex}] has invalid or missing "name" field, skipping`);
    return null;
  }

  if (!isNonEmptyString(raw.command)) {
    logWarning(`Agent at index ${agentIndex}: mcpServers[${serverIndex}] has invalid or missing "command" field, skipping`);
    return null;
  }

  const server: McpServerConfig = {
    name: raw.name,
    command: raw.command,
  };

  // Optional args
  if (Array.isArray(raw.args)) {
    server.args = raw.args.filter((a): a is string => typeof a === 'string');
  }

  // Optional env
  if (raw.env !== null && typeof raw.env === 'object' && !Array.isArray(raw.env)) {
    const env: Record<string, string> = {};
    for (const [key, val] of Object.entries(raw.env as Record<string, unknown>)) {
      if (typeof val === 'string') {
        env[key] = val;
      }
    }
    if (Object.keys(env).length > 0) {
      server.env = env;
    }
  }

  return server;
}

/**
 * Parse and validate mcpServers array for an agent.
 */
function parseMcpServers(servers: unknown[], agentIndex: number): McpServerConfig[] {
  const result: McpServerConfig[] = [];

  for (let i = 0; i < servers.length; i++) {
    const server = parseMcpServer(servers[i], agentIndex, i);
    if (server !== null) {
      result.push(server);
    }
  }

  return result;
}

/**
 * Log a warning message to stderr with ISO 8601 timestamp.
 */
function logWarning(message: string): void {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] [WARN] [registry] ${message}`);
}

/**
 * Valid auth method types for validation.
 */
const VALID_AUTH_METHOD_TYPES: readonly string[] = ['oauth2', 'api-key'];

/**
 * Validate and parse a single auth method configuration.
 *
 * Requirements: 11.2, 11.3
 *
 * @param value - Raw auth method object
 * @param agentIndex - Index of the agent in the registry (for error messages)
 * @param methodIndex - Index of the auth method in the array (for error messages)
 * @returns Parsed AgentAuthMethod or null if invalid
 */
function parseAuthMethod(value: unknown, agentIndex: number, methodIndex: number): AgentAuthMethod | null {
  if (value === null || typeof value !== 'object') {
    logWarning(`Agent at index ${agentIndex}: authMethods[${methodIndex}] is not an object, skipping`);
    return null;
  }

  const raw = value as Record<string, unknown>;

  // Validate required 'id' field
  if (!isNonEmptyString(raw.id)) {
    logWarning(`Agent at index ${agentIndex}: authMethods[${methodIndex}] has invalid or missing "id" field, skipping`);
    return null;
  }

  // Validate required 'type' field
  if (!isNonEmptyString(raw.type) || !VALID_AUTH_METHOD_TYPES.includes(raw.type)) {
    logWarning(`Agent at index ${agentIndex}: authMethods[${methodIndex}] has invalid or missing "type" field (must be 'oauth2' or 'api-key'), skipping`);
    return null;
  }

  const method: AgentAuthMethod = {
    id: raw.id,
    type: raw.type as 'oauth2' | 'api-key',
  };

  // Optional providerId field
  if (isNonEmptyString(raw.providerId)) {
    method.providerId = raw.providerId;
  }

  return method;
}

/**
 * Parse and validate authMethods array for an agent.
 *
 * Requirements: 11.2, 11.3
 *
 * @param methods - Raw auth methods array
 * @param agentIndex - Index of the agent in the registry (for error messages)
 * @returns Array of validated AgentAuthMethod entries
 */
function parseAuthMethods(methods: unknown[], agentIndex: number): AgentAuthMethod[] {
  const result: AgentAuthMethod[] = [];

  for (let i = 0; i < methods.length; i++) {
    const method = parseAuthMethod(methods[i], agentIndex, i);
    if (method !== null) {
      result.push(method);
    }
  }

  return result;
}

/**
 * Validate and parse a registry agent entry.
 */
function parseAgent(value: unknown, index: number): RegistryAgent {
  if (value === null || typeof value !== 'object') {
    throw new RegistryParseError(`Agent at index ${index} is not an object`);
  }

  const raw = value as Record<string, unknown>;

  if (!isNonEmptyString(raw.id)) {
    throw new RegistryParseError(`Agent at index ${index} has invalid or missing "id" field`);
  }

  if (!isNonEmptyString(raw.name)) {
    throw new RegistryParseError(`Agent at index ${index} has invalid or missing "name" field`);
  }

  if (!isNonEmptyString(raw.version)) {
    throw new RegistryParseError(`Agent at index ${index} has invalid or missing "version" field`);
  }

  if (!isValidDistribution(raw.distribution)) {
    throw new RegistryParseError(`Agent at index ${index} has invalid or missing "distribution" field`);
  }

  const agent: RegistryAgent = {
    id: raw.id,
    name: raw.name,
    version: raw.version,
    distribution: raw.distribution as Distribution,
  };

  // Optional fields
  if (typeof raw.description === 'string') {
    agent.description = raw.description;
  }

  if (typeof raw.repository === 'string') {
    agent.repository = raw.repository;
  }

  if (Array.isArray(raw.authors)) {
    agent.authors = raw.authors.filter((a): a is string => typeof a === 'string');
  }

  if (typeof raw.license === 'string') {
    agent.license = raw.license;
  }

  if (typeof raw.icon === 'string') {
    agent.icon = raw.icon;
  }

  // Parse mcpServers if present
  if (Array.isArray(raw.mcpServers)) {
    const mcpServers = parseMcpServers(raw.mcpServers, index);
    if (mcpServers.length > 0) {
      agent.mcpServers = mcpServers;
    }
  }

  // Parse authRequired if present (Requirements: 11.2, 11.3)
  if (typeof raw.authRequired === 'boolean') {
    agent.authRequired = raw.authRequired;
  }

  // Parse authMethods if present (Requirements: 11.2, 11.3)
  if (Array.isArray(raw.authMethods)) {
    const authMethods = parseAuthMethods(raw.authMethods, index);
    if (authMethods.length > 0) {
      agent.authMethods = authMethods;
    }
  }

  return agent;
}

/**
 * Parse and validate registry JSON data.
 *
 * @param data - Raw JSON data to parse
 * @returns Parsed and validated Registry object
 * @throws RegistryParseError if JSON is malformed or invalid
 */
export function parseRegistry(data: unknown): Registry {
  if (data === null || typeof data !== 'object') {
    throw new RegistryParseError('Registry data is not an object');
  }

  const raw = data as Record<string, unknown>;

  // Validate version field
  if (!isNonEmptyString(raw.version)) {
    throw new RegistryParseError('Registry has invalid or missing "version" field');
  }

  // Validate agents array
  if (!Array.isArray(raw.agents)) {
    throw new RegistryParseError('Registry has invalid or missing "agents" field');
  }

  // Parse each agent
  const agents: RegistryAgent[] = [];
  for (let i = 0; i < raw.agents.length; i++) {
    agents.push(parseAgent(raw.agents[i], i));
  }

  return {
    version: raw.version,
    agents,
  };
}

/**
 * Registry Index implementation.
 *
 * Fetches, parses, and provides lookup functionality for the ACP Registry.
 */
export class RegistryIndex implements IRegistryIndex {
  /** Configured registry URL */
  private readonly registryUrl: string;

  /** Parsed registry data (null until fetch() is called) */
  private registry: Registry | null = null;

  /** Map of agent ID to agent entry for fast lookup */
  private agentMap: Map<string, RegistryAgent> = new Map();

  /**
   * Cache of auth requirements per agent.
   *
   * Requirements: 11.2, 11.3
   */
  private authRequirementsCache: Map<string, AgentAuthRequirements> = new Map();

  /**
   * Create a new RegistryIndex.
   *
   * @param registryUrl - URL to fetch the registry from (can be overridden by ACP_REGISTRY_URL env var)
   */
  constructor(registryUrl: string) {
    // Environment variable takes precedence
    const envUrl = process.env[ENV_REGISTRY_URL];
    this.registryUrl = isNonEmptyString(envUrl) ? envUrl : registryUrl;
  }

  /**
   * Fetch and parse the ACP Registry from the configured URL.
   *
   * @throws RegistryFetchError if fetch fails
   * @throws RegistryParseError if JSON is malformed
   */
  async fetch(): Promise<void> {
    logInfo(`Fetching registry from ${this.registryUrl}`);

    let response: Response;
    try {
      response = await fetch(this.registryUrl);
    } catch (error) {
      const message = `Failed to fetch registry from ${this.registryUrl}: ${(error as Error).message}`;
      logError(message);
      throw new RegistryFetchError(message, error as Error);
    }

    if (!response.ok) {
      const message = `Failed to fetch registry from ${this.registryUrl}: HTTP ${response.status} ${response.statusText}`;
      logError(message);
      throw new RegistryFetchError(message);
    }

    let text: string;
    try {
      text = await response.text();
    } catch (error) {
      const message = `Failed to read registry response body: ${(error as Error).message}`;
      logError(message);
      throw new RegistryFetchError(message, error as Error);
    }

    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch (error) {
      const message = `Failed to parse registry JSON: ${(error as Error).message}`;
      logError(message);
      throw new RegistryParseError(message, error as Error);
    }

    try {
      this.registry = parseRegistry(data);
    } catch (error) {
      if (error instanceof RegistryParseError) {
        logError(error.message);
        throw error;
      }
      const message = `Failed to validate registry data: ${(error as Error).message}`;
      logError(message);
      throw new RegistryParseError(message, error as Error);
    }

    // Build the agent lookup map
    this.agentMap.clear();
    this.authRequirementsCache.clear();
    for (const agent of this.registry.agents) {
      this.agentMap.set(agent.id, agent);
    }

    logInfo(`Registry loaded: version ${this.registry.version}, ${this.registry.agents.length} agents`);
  }

  /**
   * Look up an agent by ID.
   *
   * @param agentId - Agent ID to look up
   * @returns The agent entry or undefined if not found
   */
  lookup(agentId: string): RegistryAgent | undefined {
    return this.agentMap.get(agentId);
  }

  /**
   * Resolve an agent ID to a spawn command.
   *
   * @param agentId - Agent ID to resolve
   * @returns Resolved spawn command
   * @throws AgentNotFoundError if agent not in registry
   * @throws PlatformNotSupportedError if binary distribution doesn't support current platform
   */
  resolve(agentId: string): SpawnCommand {
    const agent = this.lookup(agentId);
    if (!agent) {
      throw new AgentNotFoundError(agentId);
    }

    return resolveDistribution(agent.distribution, agentId);
  }

  /**
   * Get the parsed registry data.
   * @returns The parsed registry or null if not yet fetched
   */
  getRegistry(): Registry | null {
    return this.registry;
  }

  /**
   * Get auth requirements for an agent.
   *
   * Checks the agent definition in the registry for `authRequired` or `authMethods` fields.
   * Results are cached per agent for efficient repeated lookups.
   *
   * Requirements: 11.2, 11.3
   *
   * @param agentId - Agent ID to query
   * @returns Auth requirements or undefined if agent not found
   */
  getAuthRequirements(agentId: string): AgentAuthRequirements | undefined {
    // Check cache first
    const cached = this.authRequirementsCache.get(agentId);
    if (cached !== undefined) {
      return cached;
    }

    // Look up agent
    const agent = this.lookup(agentId);
    if (!agent) {
      return undefined;
    }

    // Build auth requirements from agent definition
    const authMethods = agent.authMethods ?? [];

    // Determine if auth is required:
    // - Explicitly set via authRequired field
    // - Implicitly required if authMethods contains oauth2 methods
    const hasOAuthMethods = authMethods.some(m => m.type === 'oauth2');
    const authRequired = agent.authRequired ?? hasOAuthMethods;

    // Find primary OAuth provider ID (first oauth2 method with providerId)
    let primaryOAuthProviderId: string | undefined;
    for (const method of authMethods) {
      if (method.type === 'oauth2' && method.providerId) {
        primaryOAuthProviderId = method.providerId;
        break;
      }
    }

    const requirements: AgentAuthRequirements = {
      authRequired,
      authMethods,
      primaryOAuthProviderId,
    };

    // Cache the result
    this.authRequirementsCache.set(agentId, requirements);

    if (authRequired) {
      logInfo(`Agent "${agentId}" requires authentication${primaryOAuthProviderId ? ` (OAuth provider: ${primaryOAuthProviderId})` : ''}`);
    }

    return requirements;
  }

  /**
   * Clear the auth requirements cache for a specific agent or all agents.
   *
   * @param agentId - Optional agent ID to clear. If not provided, clears all cached requirements.
   */
  clearAuthRequirementsCache(agentId?: string): void {
    if (agentId) {
      this.authRequirementsCache.delete(agentId);
      logInfo(`Cleared auth requirements cache for agent "${agentId}"`);
    } else {
      this.authRequirementsCache.clear();
      logInfo('Cleared all auth requirements cache');
    }
  }

  /**
   * Merge custom agents into the registry.
   *
   * Custom agents take precedence over remote registry agents with the same ID.
   * This allows users to override or extend the official ACP Registry with
   * locally-defined agents (e.g., AWS Bedrock, custom internal agents).
   *
   * @param agents - Array of custom RegistryAgent entries to merge
   */
  mergeCustomAgents(agents: RegistryAgent[]): void {
    if (agents.length === 0) {
      return;
    }

    // Initialize registry if fetch() hasn't been called yet
    if (!this.registry) {
      this.registry = { version: 'custom', agents: [] };
    }

    for (const agent of agents) {
      // Custom agents override remote agents with the same ID
      const existingIndex = this.registry.agents.findIndex((a) => a.id === agent.id);
      if (existingIndex !== -1) {
        this.registry.agents[existingIndex] = agent;
        logInfo(`Custom agent "${agent.id}" overrides remote registry entry`);
      } else {
        this.registry.agents.push(agent);
        logInfo(`Custom agent "${agent.id}" added to registry`);
      }

      this.agentMap.set(agent.id, agent);

      // Clear cached auth requirements for this agent (may have changed)
      this.authRequirementsCache.delete(agent.id);
    }

    logInfo(`Registry now contains ${this.registry.agents.length} agents (${agents.length} custom)`);
  }
}

/**
 * Error thrown when custom agents file cannot be loaded.
 */
export class CustomAgentsLoadError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = 'CustomAgentsLoadError';
  }
}

/**
 * Load and validate custom agents from a JSON file.
 *
 * The file must contain a JSON object with an "agents" array field.
 * Each agent entry is validated using the same rules as the remote registry.
 *
 * Expected file format:
 * ```json
 * {
 *   "agents": [
 *     {
 *       "id": "my-custom-agent",
 *       "name": "My Custom Agent",
 *       "version": "1.0.0",
 *       "distribution": {
 *         "npx": { "package": "@my-org/my-agent@latest" }
 *       }
 *     }
 *   ]
 * }
 * ```
 *
 * @param filePath - Path to the custom agents JSON file
 * @returns Array of validated RegistryAgent entries
 * @throws CustomAgentsLoadError if file cannot be read or parsed
 * @throws RegistryParseError if agent entries are malformed
 */
export function loadCustomAgents(filePath: string): RegistryAgent[] {
  let fileContent: string;
  try {
    fileContent = readFileSync(filePath, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new CustomAgentsLoadError(`Custom agents file not found: ${filePath}`);
    }
    if ((error as NodeJS.ErrnoException).code === 'EACCES') {
      throw new CustomAgentsLoadError(`Custom agents file not readable: ${filePath}`);
    }
    throw new CustomAgentsLoadError(
      `Failed to read custom agents file "${filePath}": ${(error as Error).message}`,
      error as Error,
    );
  }

  let data: unknown;
  try {
    data = JSON.parse(fileContent);
  } catch (error) {
    throw new CustomAgentsLoadError(
      `Custom agents file "${filePath}" contains malformed JSON: ${(error as Error).message}`,
      error as Error,
    );
  }

  if (data === null || typeof data !== 'object') {
    throw new CustomAgentsLoadError(
      `Custom agents file "${filePath}" does not contain a valid object`,
    );
  }

  const raw = data as Record<string, unknown>;

  if (!Array.isArray(raw.agents)) {
    throw new CustomAgentsLoadError(
      `Custom agents file "${filePath}" does not contain a valid "agents" array`,
    );
  }

  // Reuse parseRegistry for validation — wrap in registry structure
  const registryData = {
    version: 'custom',
    agents: raw.agents,
  };

  const parsed = parseRegistry(registryData);
  return parsed.agents;
}

