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
 * Property-Based Tests for Distribution Resolution
 *
 * Feature: acp-registry-transit
 *
 * Property 5: Distribution Resolution
 *
 * Property 6: Platform Not Supported Error
 *
 * @module registry-launcher/registry/resolver.property.test
 */
import * as fc from 'fast-check';
import {
  getCurrentPlatform,
  PlatformNotSupportedError,
  resolve,
  resolveBinary,
  resolveNpx,
  resolveUvx,
} from './resolver.js';
import type { BinaryDistribution, Distribution, NpxDistribution, Platform, UvxDistribution } from './types.js';

/**
 * All valid platform identifiers.
 */
const PLATFORMS: Platform[] = [
  'darwin-x64',
  'darwin-arm64',
  'linux-x64',
  'linux-arm64',
  'win32-x64',
];

/**
 * Arbitrary for generating valid platform identifiers.
 */
const platformArb: fc.Arbitrary<Platform> = fc.constantFrom(...PLATFORMS);

/**
 * Arbitrary for generating non-empty strings suitable for paths and IDs.
 */
const nonEmptyStringArb = fc
  .string({ minLength: 1, maxLength: 100 })
  .filter((s) => s.trim().length > 0);

/**
 * Arbitrary for generating valid package names (npm/pypi style).
 */
const packageNameArb = fc
  .stringMatching(/^[a-z][a-z0-9-]*[a-z0-9]$/)
  .filter((s) => s.length >= 2 && s.length <= 50);

/**
 * Arbitrary for generating valid version strings.
 */
const versionStringArb = fc.oneof(
  fc.stringMatching(/^\d+\.\d+\.\d+$/),
  fc.stringMatching(/^\d+\.\d+$/),
  fc.stringMatching(/^\d+$/),
);

/**
 * Arbitrary for generating valid binary distribution objects that include the current platform.
 * This ensures the distribution can be resolved without throwing PlatformNotSupportedError.
 */
const binaryDistributionWithCurrentPlatformArb: fc.Arbitrary<BinaryDistribution> = fc
  .tuple(
    nonEmptyStringArb, // path for current platform
    fc.array(fc.tuple(platformArb, nonEmptyStringArb), { minLength: 0, maxLength: 4 }), // additional platforms
  )
  .map(([currentPlatformPath, additionalPlatforms]) => {
    const currentPlatform = getCurrentPlatform();
    const platforms: Partial<Record<Platform, string>> = {};

    // Always include current platform
    platforms[currentPlatform] = currentPlatformPath;

    // Add additional platforms (may override current platform, which is fine)
    for (const [platform, path] of additionalPlatforms) {
      platforms[platform] = path;
    }

    return {
      type: 'binary' as const,
      platforms,
    };
  });

/**
 * Arbitrary for generating valid npx distribution objects.
 */
const npxDistributionArb: fc.Arbitrary<NpxDistribution> = fc.record({
  type: fc.constant('npx' as const),
  package: packageNameArb,
  version: fc.option(versionStringArb, { nil: undefined }),
});

/**
 * Arbitrary for generating valid uvx distribution objects.
 */
const uvxDistributionArb: fc.Arbitrary<UvxDistribution> = fc.record({
  type: fc.constant('uvx' as const),
  package: packageNameArb,
  version: fc.option(versionStringArb, { nil: undefined }),
});

/**
 * Arbitrary for generating any valid distribution object that can be resolved.
 * Binary distributions always include the current platform.
 */
const resolvableDistributionArb: fc.Arbitrary<Distribution> = fc.oneof(
  binaryDistributionWithCurrentPlatformArb,
  npxDistributionArb,
  uvxDistributionArb,
);

/**
 * Arbitrary for generating valid agent IDs.
 */
const agentIdArb = nonEmptyStringArb;

/**
 * Arbitrary for generating valid command-line arguments.
 */
const argsArrayArb: fc.Arbitrary<string[]> = fc.array(fc.string({ maxLength: 50 }), {
  minLength: 0,
  maxLength: 5,
});

/**
 * Arbitrary for generating valid environment variable keys.
 */
const envKeyArb = fc
  .string({ minLength: 1, maxLength: 20 })
  .filter((s) => /^[A-Z_][A-Z0-9_]*$/i.test(s))
  .filter(
    (s) =>
      !['__proto__', 'constructor', 'prototype', 'hasOwnProperty', 'toString'].includes(s),
  );

/**
 * Arbitrary for generating valid environment variable records.
 */
const envRecordArb: fc.Arbitrary<Record<string, string>> = fc.dictionary(
  envKeyArb,
  fc.string({ maxLength: 100 }),
  { minKeys: 0, maxKeys: 5 },
);

describe('Distribution Resolution Property Tests', () => {
  /**
   * Feature: acp-registry-transit, Property 5: Distribution Resolution
   *
   * *For any* valid distribution (binary with current platform, npx, or uvx),
   * resolving it should produce a SpawnCommand where:
   * - Binary distributions produce a command pointing to the platform-specific path
   * - NPX distributions produce a command starting with "npx" followed by the package name
   * - UVX distributions produce a command starting with "uvx" followed by the package name
   *
   */
  describe('Property 5: Distribution Resolution', () => {
    describe('Binary Distribution Resolution', () => {
      it('should produce a command pointing to the platform-specific path', () => {
        fc.assert(
          fc.property(
            binaryDistributionWithCurrentPlatformArb,
            agentIdArb,
            (distribution, agentId) => {
              const result = resolveBinary(distribution, agentId);
              const currentPlatform = getCurrentPlatform();
              const expectedPath = distribution.platforms[currentPlatform];

              // Command should be the platform-specific path
              return result.command === expectedPath;
            },
          ),
          { numRuns: 100 },
        );
      });

      it('should return a valid SpawnCommand structure', () => {
        fc.assert(
          fc.property(
            binaryDistributionWithCurrentPlatformArb,
            agentIdArb,
            (distribution, agentId) => {
              const result = resolveBinary(distribution, agentId);

              // Result should have required SpawnCommand properties
              return (
                typeof result.command === 'string' &&
                result.command.length > 0 &&
                Array.isArray(result.args)
              );
            },
          ),
          { numRuns: 100 },
        );
      });

      it('should include agent args in the spawn command', () => {
        fc.assert(
          fc.property(
            binaryDistributionWithCurrentPlatformArb,
            agentIdArb,
            argsArrayArb,
            (distribution, agentId, args) => {
              const result = resolveBinary(distribution, agentId, args);

              // Args should match the provided args
              if (result.args.length !== args.length) return false;
              return result.args.every((arg, i) => arg === args[i]);
            },
          ),
          { numRuns: 100 },
        );
      });

      it('should include agent env in the spawn command', () => {
        fc.assert(
          fc.property(
            binaryDistributionWithCurrentPlatformArb,
            agentIdArb,
            fc.option(argsArrayArb, { nil: undefined }),
            envRecordArb,
            (distribution, agentId, args, env) => {
              const result = resolveBinary(distribution, agentId, args, env);

              // Env should match the provided env
              if (!result.env) return Object.keys(env).length === 0;

              const resultKeys = Object.keys(result.env).sort();
              const envKeys = Object.keys(env).sort();

              if (resultKeys.length !== envKeys.length) return false;
              return resultKeys.every((key) => result.env![key] === env[key]);
            },
          ),
          { numRuns: 100 },
        );
      });
    });

    describe('NPX Distribution Resolution', () => {
      it('should produce a command starting with "npx"', () => {
        fc.assert(
          fc.property(npxDistributionArb, (distribution) => {
            const result = resolveNpx(distribution);

            // Command should be "npx"
            return result.command === 'npx';
          }),
          { numRuns: 100 },
        );
      });

      it('should include the package name in args', () => {
        fc.assert(
          fc.property(npxDistributionArb, (distribution) => {
            const result = resolveNpx(distribution);

            // First arg should contain the package name
            return result.args.length > 0 && result.args[0].includes(distribution.package);
          }),
          { numRuns: 100 },
        );
      });

      it('should include version in package spec when provided', () => {
        fc.assert(
          fc.property(
            fc.record({
              type: fc.constant('npx' as const),
              package: packageNameArb,
              version: versionStringArb,
            }),
            (distribution) => {
              const result = resolveNpx(distribution);
              const expectedPackageSpec = `${distribution.package}@${distribution.version}`;

              // First arg should be package@version
              return result.args[0] === expectedPackageSpec;
            },
          ),
          { numRuns: 100 },
        );
      });

      it('should use package name without version when version is not provided', () => {
        fc.assert(
          fc.property(
            fc.record({
              type: fc.constant('npx' as const),
              package: packageNameArb,
            }),
            (distribution) => {
              const result = resolveNpx(distribution as NpxDistribution);

              // First arg should be just the package name
              return result.args[0] === distribution.package;
            },
          ),
          { numRuns: 100 },
        );
      });

      it('should append agent args after package spec', () => {
        fc.assert(
          fc.property(npxDistributionArb, argsArrayArb, (distribution, args) => {
            const result = resolveNpx(distribution, args);

            // Args should be [packageSpec, ...agentArgs]
            const expectedLength = 1 + args.length;
            if (result.args.length !== expectedLength) return false;

            // Verify agent args are appended
            return args.every((arg, i) => result.args[i + 1] === arg);
          }),
          { numRuns: 100 },
        );
      });

      it('should include agent env in the spawn command', () => {
        fc.assert(
          fc.property(
            npxDistributionArb,
            fc.option(argsArrayArb, { nil: undefined }),
            envRecordArb,
            (distribution, args, env) => {
              const result = resolveNpx(distribution, args, env);

              // Env should match the provided env
              if (!result.env) return Object.keys(env).length === 0;

              const resultKeys = Object.keys(result.env).sort();
              const envKeys = Object.keys(env).sort();

              if (resultKeys.length !== envKeys.length) return false;
              return resultKeys.every((key) => result.env![key] === env[key]);
            },
          ),
          { numRuns: 100 },
        );
      });

      it('should return a valid SpawnCommand structure', () => {
        fc.assert(
          fc.property(npxDistributionArb, (distribution) => {
            const result = resolveNpx(distribution);

            // Result should have required SpawnCommand properties
            return (
              typeof result.command === 'string' &&
              result.command === 'npx' &&
              Array.isArray(result.args) &&
              result.args.length >= 1
            );
          }),
          { numRuns: 100 },
        );
      });
    });

    describe('UVX Distribution Resolution', () => {
      it('should produce a command starting with "uvx"', () => {
        fc.assert(
          fc.property(uvxDistributionArb, (distribution) => {
            const result = resolveUvx(distribution);

            // Command should be "uvx"
            return result.command === 'uvx';
          }),
          { numRuns: 100 },
        );
      });

      it('should include the package name in args', () => {
        fc.assert(
          fc.property(uvxDistributionArb, (distribution) => {
            const result = resolveUvx(distribution);

            // First arg should contain the package name
            return result.args.length > 0 && result.args[0].includes(distribution.package);
          }),
          { numRuns: 100 },
        );
      });

      it('should include version in package spec when provided', () => {
        fc.assert(
          fc.property(
            fc.record({
              type: fc.constant('uvx' as const),
              package: packageNameArb,
              version: versionStringArb,
            }),
            (distribution) => {
              const result = resolveUvx(distribution);
              const expectedPackageSpec = `${distribution.package}@${distribution.version}`;

              // First arg should be package@version
              return result.args[0] === expectedPackageSpec;
            },
          ),
          { numRuns: 100 },
        );
      });

      it('should use package name without version when version is not provided', () => {
        fc.assert(
          fc.property(
            fc.record({
              type: fc.constant('uvx' as const),
              package: packageNameArb,
            }),
            (distribution) => {
              const result = resolveUvx(distribution as UvxDistribution);

              // First arg should be just the package name
              return result.args[0] === distribution.package;
            },
          ),
          { numRuns: 100 },
        );
      });

      it('should append agent args after package spec', () => {
        fc.assert(
          fc.property(uvxDistributionArb, argsArrayArb, (distribution, args) => {
            const result = resolveUvx(distribution, args);

            // Args should be [packageSpec, ...agentArgs]
            const expectedLength = 1 + args.length;
            if (result.args.length !== expectedLength) return false;

            // Verify agent args are appended
            return args.every((arg, i) => result.args[i + 1] === arg);
          }),
          { numRuns: 100 },
        );
      });

      it('should include agent env in the spawn command', () => {
        fc.assert(
          fc.property(
            uvxDistributionArb,
            fc.option(argsArrayArb, { nil: undefined }),
            envRecordArb,
            (distribution, args, env) => {
              const result = resolveUvx(distribution, args, env);

              // Env should match the provided env
              if (!result.env) return Object.keys(env).length === 0;

              const resultKeys = Object.keys(result.env).sort();
              const envKeys = Object.keys(env).sort();

              if (resultKeys.length !== envKeys.length) return false;
              return resultKeys.every((key) => result.env![key] === env[key]);
            },
          ),
          { numRuns: 100 },
        );
      });

      it('should return a valid SpawnCommand structure', () => {
        fc.assert(
          fc.property(uvxDistributionArb, (distribution) => {
            const result = resolveUvx(distribution);

            // Result should have required SpawnCommand properties
            return (
              typeof result.command === 'string' &&
              result.command === 'uvx' &&
              Array.isArray(result.args) &&
              result.args.length >= 1
            );
          }),
          { numRuns: 100 },
        );
      });
    });

    describe('Generic resolve() Dispatcher', () => {
      it('should dispatch binary distributions to resolveBinary', () => {
        fc.assert(
          fc.property(
            binaryDistributionWithCurrentPlatformArb,
            agentIdArb,
            (distribution, agentId) => {
              const result = resolve(distribution, agentId);
              const currentPlatform = getCurrentPlatform();
              const expectedPath = distribution.platforms[currentPlatform];

              // Should produce same result as resolveBinary
              return result.command === expectedPath;
            },
          ),
          { numRuns: 100 },
        );
      });

      it('should dispatch npx distributions to resolveNpx', () => {
        fc.assert(
          fc.property(npxDistributionArb, agentIdArb, (distribution, agentId) => {
            const result = resolve(distribution, agentId);

            // Should produce same result as resolveNpx
            return result.command === 'npx';
          }),
          { numRuns: 100 },
        );
      });

      it('should dispatch uvx distributions to resolveUvx', () => {
        fc.assert(
          fc.property(uvxDistributionArb, agentIdArb, (distribution, agentId) => {
            const result = resolve(distribution, agentId);

            // Should produce same result as resolveUvx
            return result.command === 'uvx';
          }),
          { numRuns: 100 },
        );
      });

      it('should correctly resolve any valid distribution type', () => {
        fc.assert(
          fc.property(
            resolvableDistributionArb,
            agentIdArb,
            (distribution, agentId) => {
              const result = resolve(distribution, agentId);

              // Result should be a valid SpawnCommand
              if (typeof result.command !== 'string' || result.command.length === 0) {
                return false;
              }
              if (!Array.isArray(result.args)) {
                return false;
              }

              // Verify command matches distribution type
              switch (distribution.type) {
                case 'binary': {
                  const currentPlatform = getCurrentPlatform();
                  return result.command === distribution.platforms[currentPlatform];
                }
                case 'npx':
                  return result.command === 'npx';
                case 'uvx':
                  return result.command === 'uvx';
                default:
                  return false;
              }
            },
          ),
          { numRuns: 100 },
        );
      });

      it('should pass through agent args for all distribution types', () => {
        fc.assert(
          fc.property(
            resolvableDistributionArb,
            agentIdArb,
            argsArrayArb,
            (distribution, agentId, args) => {
              const result = resolve(distribution, agentId, args);

              // For binary: args should be exactly the agent args
              // For npx/uvx: args should be [packageSpec, ...agentArgs]
              if (distribution.type === 'binary') {
                if (result.args.length !== args.length) return false;
                return result.args.every((arg, i) => arg === args[i]);
              } else {
                // npx or uvx: first arg is package spec, rest are agent args
                if (result.args.length !== 1 + args.length) return false;
                return args.every((arg, i) => result.args[i + 1] === arg);
              }
            },
          ),
          { numRuns: 100 },
        );
      });

      it('should pass through agent env for all distribution types', () => {
        fc.assert(
          fc.property(
            resolvableDistributionArb,
            agentIdArb,
            fc.option(argsArrayArb, { nil: undefined }),
            envRecordArb,
            (distribution, agentId, args, env) => {
              const result = resolve(distribution, agentId, args, env);

              // Env should match the provided env
              if (!result.env) return Object.keys(env).length === 0;

              const resultKeys = Object.keys(result.env).sort();
              const envKeys = Object.keys(env).sort();

              if (resultKeys.length !== envKeys.length) return false;
              return resultKeys.every((key) => result.env![key] === env[key]);
            },
          ),
          { numRuns: 100 },
        );
      });
    });
  });

  /**
   * Feature: acp-registry-transit, Property 6: Platform Not Supported Error
   *
   * *For any* binary distribution that does not include the current platform in its
   * platforms map, attempting to resolve it should return a JSON-RPC error response
   * with code -32002 and message "Platform not supported".
   *
   */
  describe('Property 6: Platform Not Supported Error', () => {
    /**
     * Arbitrary for generating binary distributions that do NOT include the current platform.
     * This ensures the distribution will throw PlatformNotSupportedError when resolved.
     */
    const binaryDistributionWithoutCurrentPlatformArb: fc.Arbitrary<BinaryDistribution> = fc
      .array(
        fc.tuple(
          platformArb.filter((p) => p !== getCurrentPlatform()),
          nonEmptyStringArb,
        ),
        { minLength: 0, maxLength: 4 },
      )
      .map((platformPaths) => {
        const platforms: Partial<Record<Platform, string>> = {};

        // Add platforms that are NOT the current platform
        for (const [platform, path] of platformPaths) {
          platforms[platform] = path;
        }

        return {
          type: 'binary' as const,
          platforms,
        };
      });

    describe('resolveBinary() throws PlatformNotSupportedError', () => {
      it('should throw PlatformNotSupportedError for any binary distribution missing current platform', () => {
        fc.assert(
          fc.property(
            binaryDistributionWithoutCurrentPlatformArb,
            agentIdArb,
            (distribution, agentId) => {
              try {
                resolveBinary(distribution, agentId);
                // Should not reach here - should have thrown
                return false;
              } catch (error) {
                // Should throw PlatformNotSupportedError
                return error instanceof PlatformNotSupportedError;
              }
            },
          ),
          { numRuns: 100 },
        );
      });

      it('should include the agentId in the error', () => {
        fc.assert(
          fc.property(
            binaryDistributionWithoutCurrentPlatformArb,
            agentIdArb,
            (distribution, agentId) => {
              try {
                resolveBinary(distribution, agentId);
                return false;
              } catch (error) {
                if (!(error instanceof PlatformNotSupportedError)) return false;
                // Error should contain the agentId
                return error.agentId === agentId;
              }
            },
          ),
          { numRuns: 100 },
        );
      });

      it('should include the current platform in the error', () => {
        fc.assert(
          fc.property(
            binaryDistributionWithoutCurrentPlatformArb,
            agentIdArb,
            (distribution, agentId) => {
              try {
                resolveBinary(distribution, agentId);
                return false;
              } catch (error) {
                if (!(error instanceof PlatformNotSupportedError)) return false;
                // Error should contain the current platform
                return error.platform === getCurrentPlatform();
              }
            },
          ),
          { numRuns: 100 },
        );
      });

      it('should include "Platform not supported" in the error message', () => {
        fc.assert(
          fc.property(
            binaryDistributionWithoutCurrentPlatformArb,
            agentIdArb,
            (distribution, agentId) => {
              try {
                resolveBinary(distribution, agentId);
                return false;
              } catch (error) {
                if (!(error instanceof PlatformNotSupportedError)) return false;
                // Error message should contain "Platform not supported"
                return error.message.includes('Platform not supported');
              }
            },
          ),
          { numRuns: 100 },
        );
      });
    });

    describe('resolve() throws PlatformNotSupportedError for binary distributions', () => {
      it('should throw PlatformNotSupportedError when dispatching binary distribution missing current platform', () => {
        fc.assert(
          fc.property(
            binaryDistributionWithoutCurrentPlatformArb,
            agentIdArb,
            (distribution, agentId) => {
              try {
                resolve(distribution, agentId);
                // Should not reach here - should have thrown
                return false;
              } catch (error) {
                // Should throw PlatformNotSupportedError
                return error instanceof PlatformNotSupportedError;
              }
            },
          ),
          { numRuns: 100 },
        );
      });

      it('should include the agentId in the error when using resolve()', () => {
        fc.assert(
          fc.property(
            binaryDistributionWithoutCurrentPlatformArb,
            agentIdArb,
            (distribution, agentId) => {
              try {
                resolve(distribution, agentId);
                return false;
              } catch (error) {
                if (!(error instanceof PlatformNotSupportedError)) return false;
                return error.agentId === agentId;
              }
            },
          ),
          { numRuns: 100 },
        );
      });

      it('should include the current platform in the error when using resolve()', () => {
        fc.assert(
          fc.property(
            binaryDistributionWithoutCurrentPlatformArb,
            agentIdArb,
            (distribution, agentId) => {
              try {
                resolve(distribution, agentId);
                return false;
              } catch (error) {
                if (!(error instanceof PlatformNotSupportedError)) return false;
                return error.platform === getCurrentPlatform();
              }
            },
          ),
          { numRuns: 100 },
        );
      });

      it('should include "Platform not supported" in the error message when using resolve()', () => {
        fc.assert(
          fc.property(
            binaryDistributionWithoutCurrentPlatformArb,
            agentIdArb,
            (distribution, agentId) => {
              try {
                resolve(distribution, agentId);
                return false;
              } catch (error) {
                if (!(error instanceof PlatformNotSupportedError)) return false;
                return error.message.includes('Platform not supported');
              }
            },
          ),
          { numRuns: 100 },
        );
      });
    });

    describe('Error properties are correctly set', () => {
      it('should have error name set to PlatformNotSupportedError', () => {
        fc.assert(
          fc.property(
            binaryDistributionWithoutCurrentPlatformArb,
            agentIdArb,
            (distribution, agentId) => {
              try {
                resolveBinary(distribution, agentId);
                return false;
              } catch (error) {
                if (!(error instanceof PlatformNotSupportedError)) return false;
                return error.name === 'PlatformNotSupportedError';
              }
            },
          ),
          { numRuns: 100 },
        );
      });

      it('should be an instance of Error', () => {
        fc.assert(
          fc.property(
            binaryDistributionWithoutCurrentPlatformArb,
            agentIdArb,
            (distribution, agentId) => {
              try {
                resolveBinary(distribution, agentId);
                return false;
              } catch (error) {
                // Should be an instance of both Error and PlatformNotSupportedError
                return error instanceof Error && error instanceof PlatformNotSupportedError;
              }
            },
          ),
          { numRuns: 100 },
        );
      });
    });

    describe('Edge cases for platform support', () => {
      it('should throw for empty platforms map', () => {
        fc.assert(
          fc.property(agentIdArb, (agentId) => {
            const distribution: BinaryDistribution = {
              type: 'binary',
              platforms: {},
            };

            try {
              resolveBinary(distribution, agentId);
              return false;
            } catch (error) {
              return error instanceof PlatformNotSupportedError;
            }
          }),
          { numRuns: 100 },
        );
      });

      it('should throw when only other platforms are supported', () => {
        const currentPlatform = getCurrentPlatform();
        const otherPlatforms = PLATFORMS.filter((p) => p !== currentPlatform);

        // Only run this test if there are other platforms to test with
        if (otherPlatforms.length === 0) return;

        fc.assert(
          fc.property(
            agentIdArb,
            fc.constantFrom(...otherPlatforms),
            nonEmptyStringArb,
            (agentId, otherPlatform, path) => {
              const distribution: BinaryDistribution = {
                type: 'binary',
                platforms: {
                  [otherPlatform]: path,
                },
              };

              try {
                resolveBinary(distribution, agentId);
                return false;
              } catch (error) {
                if (!(error instanceof PlatformNotSupportedError)) return false;
                return error.platform === currentPlatform && error.agentId === agentId;
              }
            },
          ),
          { numRuns: 100 },
        );
      });
    });
  });
});
