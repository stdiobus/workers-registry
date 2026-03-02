/*
 * Apache License 2.0
 * Copyright (c) 2025–present Raman Marozau, Work Target Insight Function.
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
 * Distribution Resolver for the ACP Registry.
 *
 * Resolves distribution metadata to spawn commands based on distribution type.
 * Supports binary (platform-specific), npx (npm), and uvx (Python) distributions.
 *
 * @module registry/resolver
 */

import {
  BinaryDistribution,
  BinaryTarget,
  Distribution,
  NpxDistribution,
  Platform,
  SpawnCommand,
  UvxDistribution,
} from './types.js';

/**
 * Error thrown when the current platform is not supported by a binary distribution.
 */
export class PlatformNotSupportedError extends Error {
  constructor(
    public readonly agentId: string,
    public readonly platform: Platform,
  ) {
    super(`Platform not supported: ${platform} for agent ${agentId}`);
    this.name = 'PlatformNotSupportedError';
  }
}

/**
 * Error thrown when no supported distribution type is available.
 */
export class NoDistributionError extends Error {
  constructor(public readonly agentId: string) {
    super(`No supported distribution type for agent ${agentId}`);
    this.name = 'NoDistributionError';
  }
}

/**
 * Get the current platform identifier.
 * Maps Node.js platform/arch to ACP Registry platform format.
 *
 * @returns Platform identifier for the current OS and architecture
 */
export function getCurrentPlatform(): Platform {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === 'darwin' && arch === 'arm64') return 'darwin-aarch64';
  if (platform === 'darwin' && arch === 'x64') return 'darwin-x86_64';
  if (platform === 'linux' && arch === 'arm64') return 'linux-aarch64';
  if (platform === 'linux' && arch === 'x64') return 'linux-x86_64';
  if (platform === 'win32' && arch === 'arm64') return 'windows-aarch64';
  if (platform === 'win32' && arch === 'x64') return 'windows-x86_64';

  // Default to linux-x86_64 for unsupported platforms
  return 'linux-x86_64';
}

/**
 * Resolve a binary distribution to a spawn command.
 *
 * @param distribution - Binary distribution to resolve
 * @param agentId - Agent ID for error messages
 * @returns Resolved spawn command
 * @throws PlatformNotSupportedError if current platform is not supported
 */
export function resolveBinary(
  distribution: BinaryDistribution,
  agentId: string,
): SpawnCommand {
  const currentPlatform = getCurrentPlatform();
  const target: BinaryTarget | undefined = distribution[currentPlatform];

  if (!target) {
    throw new PlatformNotSupportedError(agentId, currentPlatform);
  }

  return {
    command: target.cmd,
    args: target.args ?? [],
    env: target.env,
  };
}

/**
 * Resolve an npx distribution to a spawn command.
 *
 * @param distribution - NPX distribution to resolve
 * @returns Resolved spawn command
 */
export function resolveNpx(distribution: NpxDistribution): SpawnCommand {
  return {
    command: 'npx',
    args: [distribution.package, ...(distribution.args ?? [])],
    env: distribution.env,
  };
}

/**
 * Resolve a uvx distribution to a spawn command.
 *
 * @param distribution - UVX distribution to resolve
 * @returns Resolved spawn command
 */
export function resolveUvx(distribution: UvxDistribution): SpawnCommand {
  return {
    command: 'uvx',
    args: [distribution.package, ...(distribution.args ?? [])],
    env: distribution.env,
  };
}

/**
 * Resolve a distribution to a spawn command.
 *
 * Priority order: npx > uvx > binary
 * (npx/uvx are preferred as they don't require platform-specific handling)
 *
 * @param distribution - Distribution to resolve
 * @param agentId - Agent ID for error messages
 * @returns Resolved spawn command
 * @throws PlatformNotSupportedError if binary distribution doesn't support current platform
 * @throws NoDistributionError if no distribution type is available
 */
export function resolve(
  distribution: Distribution,
  agentId: string,
): SpawnCommand {
  // Prefer npx (most common, cross-platform)
  if (distribution.npx) {
    return resolveNpx(distribution.npx);
  }

  // Then uvx (Python packages)
  if (distribution.uvx) {
    return resolveUvx(distribution.uvx);
  }

  // Finally binary (platform-specific)
  if (distribution.binary) {
    return resolveBinary(distribution.binary, agentId);
  }

  throw new NoDistributionError(agentId);
}
