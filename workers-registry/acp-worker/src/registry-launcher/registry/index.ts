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

import { Distribution, Registry, RegistryAgent, SpawnCommand } from './types.js';
import { resolve as resolveDistribution } from './resolver.js';

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
}

