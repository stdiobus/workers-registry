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
 * Type definitions for the ACP Registry.
 *
 * These types match the official ACP Registry schema:
 * https://cdn.agentclientprotocol.com/registry/v1/latest/registry.schema.json
 */

/**
 * Platform identifiers for binary distributions.
 * Format: <os>-<arch>
 */
export type Platform =
  | 'darwin-aarch64'
  | 'darwin-x86_64'
  | 'linux-aarch64'
  | 'linux-x86_64'
  | 'windows-aarch64'
  | 'windows-x86_64';

/**
 * Binary target metadata for a specific platform.
 */
export interface BinaryTarget {
  /** URL to download archive */
  archive?: string;
  /** Command to execute after extraction */
  cmd: string;
  /** Optional command-line arguments */
  args?: string[];
  /** Optional environment variables */
  env?: Record<string, string>;
}

/**
 * Binary distribution - platform-specific executables.
 */
export type BinaryDistribution = Partial<Record<Platform, BinaryTarget>>;

/**
 * NPX distribution - Node packages run via npx.
 */
export interface NpxDistribution {
  /** Package name with optional version (e.g., "@scope/pkg@1.0.0") */
  package: string;
  /** Optional command-line arguments */
  args?: string[];
  /** Optional environment variables */
  env?: Record<string, string>;
}

/**
 * UVX distribution - Python packages run via uvx.
 */
export interface UvxDistribution {
  /** Package name with optional version (e.g., "pkg@latest") */
  package: string;
  /** Optional command-line arguments */
  args?: string[];
  /** Optional environment variables */
  env?: Record<string, string>;
}

/**
 * Distribution object containing one or more distribution types.
 * An agent may provide multiple distribution methods.
 */
export interface Distribution {
  /** Binary distribution (platform-specific executables) */
  binary?: BinaryDistribution;
  /** NPX distribution (Node packages) */
  npx?: NpxDistribution;
  /** UVX distribution (Python packages) */
  uvx?: UvxDistribution;
}

/**
 * Agent entry in the ACP Registry.
 */
export interface RegistryAgent {
  /** Unique agent identifier */
  id: string;
  /** Human-readable display name */
  name: string;
  /** Semantic version of the agent */
  version: string;
  /** Brief description */
  description?: string;
  /** Source code repository URL */
  repository?: string;
  /** Author/organization names */
  authors?: string[];
  /** SPDX license identifier */
  license?: string;
  /** Icon URL or path */
  icon?: string;
  /** Distribution methods */
  distribution: Distribution;
}

/**
 * Parsed ACP Registry structure.
 */
export interface Registry {
  /** Registry schema version */
  version: string;
  /** List of registered agents */
  agents: RegistryAgent[];
}

/**
 * Resolved spawn command for an agent.
 */
export interface SpawnCommand {
  /** Command to execute */
  command: string;
  /** Command-line arguments */
  args: string[];
  /** Environment variables */
  env?: Record<string, string>;
}
