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
 * Configuration loading for the Registry Launcher.
 *
 * Handles loading configuration from JSON files with support for:
 * - Environment variable overrides (ACP_REGISTRY_URL)
 * - Default values for missing fields
 * - Warning logs for missing or malformed config files
 *
 * @module config
 */

import { readFileSync } from 'node:fs';
import { DEFAULT_CONFIG, LauncherConfig } from './types.js';

/**
 * Environment variable name for registry URL override.
 */
const ENV_REGISTRY_URL = 'ACP_REGISTRY_URL';

/**
 * Environment variable name for API keys path override.
 */
const ENV_API_KEYS_PATH = 'ACP_API_KEYS_PATH';

/**
 * Environment variable name for custom agents file path override.
 */
const ENV_CUSTOM_AGENTS_PATH = 'ACP_CUSTOM_AGENTS_PATH';

/**
 * Log a warning message to stderr with ISO 8601 timestamp.
 * @param message - Warning message to log
 */
function logWarning(message: string): void {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] [WARN] [config] ${message}`);
}

/**
 * Validate that a value is a non-empty string.
 * @param value - Value to validate
 * @returns True if value is a non-empty string
 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Validate that a value is a positive number.
 * @param value - Value to validate
 * @returns True if value is a positive number
 */
function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && value > 0 && Number.isFinite(value);
}

/**
 * Parse and validate a configuration object.
 * Applies default values for missing or invalid fields.
 *
 * @param obj - Parsed JSON object
 * @returns Validated LauncherConfig with defaults applied
 */
function parseConfigObject(obj: unknown): LauncherConfig {
  const config: LauncherConfig = { ...DEFAULT_CONFIG };

  if (obj === null || typeof obj !== 'object') {
    logWarning('Config file does not contain a valid object, using defaults');
    return config;
  }

  const rawConfig = obj as Record<string, unknown>;

  // Parse registryUrl
  if ('registryUrl' in rawConfig) {
    if (isNonEmptyString(rawConfig.registryUrl)) {
      config.registryUrl = rawConfig.registryUrl;
    } else {
      logWarning('Config field "registryUrl" is not a valid string, using default');
    }
  }

  // Parse apiKeysPath
  if ('apiKeysPath' in rawConfig) {
    if (isNonEmptyString(rawConfig.apiKeysPath)) {
      config.apiKeysPath = rawConfig.apiKeysPath;
    } else {
      logWarning('Config field "apiKeysPath" is not a valid string, using default');
    }
  }

  // Parse shutdownTimeoutSec
  if ('shutdownTimeoutSec' in rawConfig) {
    if (isPositiveNumber(rawConfig.shutdownTimeoutSec)) {
      config.shutdownTimeoutSec = rawConfig.shutdownTimeoutSec;
    } else {
      logWarning('Config field "shutdownTimeoutSec" is not a valid positive number, using default');
    }
  }

  // Parse customAgentsPath
  if ('customAgentsPath' in rawConfig) {
    if (isNonEmptyString(rawConfig.customAgentsPath)) {
      config.customAgentsPath = rawConfig.customAgentsPath;
    } else {
      logWarning('Config field "customAgentsPath" is not a valid string, ignoring');
    }
  }

  return config;
}

/**
 * Apply environment variable overrides to the configuration.
 * Environment variables take precedence over config file values.
 *
 * @param config - Configuration to apply overrides to
 * @returns Configuration with environment overrides applied
 */
function applyEnvironmentOverrides(config: LauncherConfig): LauncherConfig {
  const envRegistryUrl = process.env[ENV_REGISTRY_URL];
  const envApiKeysPath = process.env[ENV_API_KEYS_PATH];
  const envCustomAgentsPath = process.env[ENV_CUSTOM_AGENTS_PATH];

  const overrides: Partial<LauncherConfig> = {};

  if (isNonEmptyString(envRegistryUrl)) {
    overrides.registryUrl = envRegistryUrl;
  }

  if (isNonEmptyString(envApiKeysPath)) {
    overrides.apiKeysPath = envApiKeysPath;
  }

  if (isNonEmptyString(envCustomAgentsPath)) {
    overrides.customAgentsPath = envCustomAgentsPath;
  }

  return {
    ...config,
    ...overrides,
  };
}

/**
 * Load configuration from a JSON file.
 *
 * This function:
 * 1. Reads the config file from the specified path
 * 2. Parses it as JSON
 * 3. Validates and applies default values for missing fields
 * 4. Applies environment variable overrides
 *
 * If the config file is missing or malformed, default values are used
 * and a warning is logged to stderr.
 *
 * @param configPath - Path to the JSON config file (optional)
 * @returns Loaded and validated configuration
 */
export function loadConfig(configPath?: string): LauncherConfig {
  let config: LauncherConfig = { ...DEFAULT_CONFIG };

  if (configPath) {
    try {
      const fileContent = readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(fileContent);
      config = parseConfigObject(parsed);
    } catch (error) {
      if (error instanceof SyntaxError) {
        logWarning(`Config file "${configPath}" contains malformed JSON, using defaults`);
      } else if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        logWarning(`Config file "${configPath}" not found, using defaults`);
      } else if ((error as NodeJS.ErrnoException).code === 'EACCES') {
        logWarning(`Config file "${configPath}" is not readable, using defaults`);
      } else {
        logWarning(`Failed to read config file "${configPath}": ${(error as Error).message}, using defaults`);
      }
    }
  }

  // Apply environment variable overrides
  config = applyEnvironmentOverrides(config);

  return config;
}
