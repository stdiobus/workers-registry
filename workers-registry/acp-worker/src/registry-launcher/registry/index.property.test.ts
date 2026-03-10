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
 * Property-Based Tests for Registry Parsing
 *
 * Feature: acp-registry-transit
 *
 * Property 1: Registry Parsing Round-Trip
 *
 * Property 2: Malformed JSON Rejection
 *
 * Property 3: Agent Lookup Correctness
 *
 * Property 4: Agent Not Found Error
 *
 * @module registry-launcher/registry/index.property.test
 */
import * as fc from 'fast-check';
import { AgentNotFoundError, parseRegistry, RegistryIndex, RegistryParseError } from './index.js';
import type {
  BinaryDistribution,
  BinaryTarget,
  Distribution,
  NpxDistribution,
  Platform,
  Registry,
  RegistryAgent,
  UvxDistribution,
} from './types.js';

/**
 * All valid platform identifiers.
 */
const PLATFORMS: Platform[] = [
  'darwin-x86_64',
  'darwin-aarch64',
  'linux-x86_64',
  'linux-aarch64',
  'windows-x86_64',
];

/**
 * Arbitrary for generating valid platform identifiers.
 */
const platformArb: fc.Arbitrary<Platform> = fc.constantFrom(...PLATFORMS);

/**
 * Arbitrary for generating non-empty strings suitable for IDs and names.
 */
const nonEmptyStringArb = fc.string({ minLength: 1, maxLength: 50 }).filter(
  (s) => s.trim().length > 0,
);

/**
 * Arbitrary for generating valid package names (npm/pypi style).
 */
const packageNameArb = fc.stringMatching(/^[a-z][a-z0-9-]*[a-z0-9]$/).filter(
  (s) => s.length >= 2 && s.length <= 50,
);

/**
 * Arbitrary for generating valid version strings.
 */
const versionStringArb = fc.oneof(
  fc.stringMatching(/^\d+\.\d+\.\d+$/),
  fc.stringMatching(/^\d+\.\d+$/),
  fc.stringMatching(/^\d+$/),
);

/**
 * Arbitrary for generating valid binary distribution objects.
 */
const binaryDistributionArb: fc.Arbitrary<BinaryDistribution> = fc
  .array(fc.tuple(platformArb, nonEmptyStringArb), { minLength: 1, maxLength: 5 })
  .map((entries) => {
    const distribution: Partial<Record<Platform, BinaryTarget>> = {};
    for (const [platform, path] of entries) {
      distribution[platform] = {
        cmd: path,
        args: [],
      };
    }
    return distribution;
  });

/**
 * Arbitrary for generating valid npx distribution objects.
 */
const npxDistributionArb: fc.Arbitrary<NpxDistribution> = fc.record({
  package: packageNameArb,
});

/**
 * Arbitrary for generating valid uvx distribution objects.
 */
const uvxDistributionArb: fc.Arbitrary<UvxDistribution> = fc.record({
  package: packageNameArb,
});

/**
 * Arbitrary for generating any valid distribution object.
 */
const distributionArb: fc.Arbitrary<Distribution> = fc.oneof(
  binaryDistributionArb.map((binary) => ({ binary })),
  npxDistributionArb.map((npx) => ({ npx })),
  uvxDistributionArb.map((uvx) => ({ uvx })),
);

/**
 * Arbitrary for generating valid RegistryAgent objects.
 */
const registryAgentArb: fc.Arbitrary<RegistryAgent> = fc.record({
  id: nonEmptyStringArb,
  name: nonEmptyStringArb,
  version: versionStringArb,
  description: fc.option(fc.string({ maxLength: 200 }), { nil: undefined }),
  distribution: distributionArb,
});

/**
 * Arbitrary for generating valid Registry objects.
 */
const registryArb: fc.Arbitrary<Registry> = fc.record({
  version: versionStringArb,
  agents: fc.array(registryAgentArb, { minLength: 0, maxLength: 10 }),
});

/**
 * Deep equality check for Distribution objects.
 */
function distributionsEqual(a: Distribution, b: Distribution): boolean {
  // Check binary distribution
  if (a.binary || b.binary) {
    if (!a.binary || !b.binary) return false;
    const aPlatforms = Object.keys(a.binary).sort();
    const bPlatforms = Object.keys(b.binary).sort();
    if (aPlatforms.length !== bPlatforms.length) return false;
    for (const platform of aPlatforms) {
      const aTarget = a.binary[platform as Platform];
      const bTarget = b.binary[platform as Platform];
      if (!aTarget || !bTarget) return false;
      if (aTarget.cmd !== bTarget.cmd) return false;
    }
  }

  // Check npx distribution
  if (a.npx || b.npx) {
    if (!a.npx || !b.npx) return false;
    if (a.npx.package !== b.npx.package) return false;
  }

  // Check uvx distribution
  if (a.uvx || b.uvx) {
    if (!a.uvx || !b.uvx) return false;
    if (a.uvx.package !== b.uvx.package) return false;
  }

  return true;
}

/**
 * Deep equality check for RegistryAgent objects.
 */
function agentsEqual(a: RegistryAgent, b: RegistryAgent): boolean {
  if (a.id !== b.id) return false;
  if (a.name !== b.name) return false;
  if (a.version !== b.version) return false;
  if (a.description !== b.description) return false;
  if (!distributionsEqual(a.distribution, b.distribution)) return false;

  return true;
}

/**
 * Deep equality check for Registry objects.
 */
function registriesEqual(a: Registry, b: Registry): boolean {
  if (a.version !== b.version) return false;
  if (a.agents.length !== b.agents.length) return false;

  for (let i = 0; i < a.agents.length; i++) {
    if (!agentsEqual(a.agents[i], b.agents[i])) return false;
  }

  return true;
}

describe('Registry Parsing Property Tests', () => {
  /**
   * Feature: acp-registry-transit, Property 1: Registry Parsing Round-Trip
   *
   * *For any* valid Registry object, serializing it to JSON and parsing it back
   * should produce an equivalent Registry object with the same agents, versions,
   * and distribution metadata.
   *
   */
  describe('Property 1: Registry Parsing Round-Trip', () => {
    it('should produce equivalent Registry after JSON serialization and parsing', () => {
      fc.assert(
        fc.property(registryArb, (originalRegistry) => {
          // Serialize to JSON
          const json = JSON.stringify(originalRegistry);

          // Parse JSON back to object
          const parsed = JSON.parse(json);

          // Parse using parseRegistry
          const result = parseRegistry(parsed);

          // Verify round-trip produces equivalent Registry
          return registriesEqual(originalRegistry, result);
        }),
        { numRuns: 100 },
      );
    });

    it('should preserve version string through round-trip', () => {
      fc.assert(
        fc.property(registryArb, (originalRegistry) => {
          const json = JSON.stringify(originalRegistry);
          const parsed = JSON.parse(json);
          const result = parseRegistry(parsed);

          return result.version === originalRegistry.version;
        }),
        { numRuns: 100 },
      );
    });

    it('should preserve agent count through round-trip', () => {
      fc.assert(
        fc.property(registryArb, (originalRegistry) => {
          const json = JSON.stringify(originalRegistry);
          const parsed = JSON.parse(json);
          const result = parseRegistry(parsed);

          return result.agents.length === originalRegistry.agents.length;
        }),
        { numRuns: 100 },
      );
    });

    it('should preserve all agent IDs through round-trip', () => {
      fc.assert(
        fc.property(registryArb, (originalRegistry) => {
          const json = JSON.stringify(originalRegistry);
          const parsed = JSON.parse(json);
          const result = parseRegistry(parsed);

          const originalIds = originalRegistry.agents.map((a) => a.id);
          const resultIds = result.agents.map((a) => a.id);

          return (
            originalIds.length === resultIds.length &&
            originalIds.every((id, i) => id === resultIds[i])
          );
        }),
        { numRuns: 100 },
      );
    });

    it('should preserve all agent names through round-trip', () => {
      fc.assert(
        fc.property(registryArb, (originalRegistry) => {
          const json = JSON.stringify(originalRegistry);
          const parsed = JSON.parse(json);
          const result = parseRegistry(parsed);

          const originalNames = originalRegistry.agents.map((a) => a.name);
          const resultNames = result.agents.map((a) => a.name);

          return (
            originalNames.length === resultNames.length &&
            originalNames.every((name, i) => name === resultNames[i])
          );
        }),
        { numRuns: 100 },
      );
    });

    it('should preserve distribution types through round-trip', () => {
      fc.assert(
        fc.property(registryArb, (originalRegistry) => {
          const json = JSON.stringify(originalRegistry);
          const parsed = JSON.parse(json);
          const result = parseRegistry(parsed);

          return originalRegistry.agents.every((agent, i) => {
            const orig = agent.distribution;
            const res = result.agents[i].distribution;
            // Check that the same distribution types are present
            return (
              (!!orig.binary === !!res.binary) &&
              (!!orig.npx === !!res.npx) &&
              (!!orig.uvx === !!res.uvx)
            );
          });
        }),
        { numRuns: 100 },
      );
    });

    it('should preserve binary distribution platforms through round-trip', () => {
      fc.assert(
        fc.property(
          fc.record({
            version: versionStringArb,
            agents: fc.array(
              fc.record({
                id: nonEmptyStringArb,
                name: nonEmptyStringArb,
                version: versionStringArb,
                distribution: binaryDistributionArb.map((binary) => ({ binary })),
              }),
              { minLength: 1, maxLength: 5 },
            ),
          }),
          (originalRegistry) => {
            const json = JSON.stringify(originalRegistry);
            const parsed = JSON.parse(json);
            const result = parseRegistry(parsed);

            return originalRegistry.agents.every((agent, i) => {
              const originalDist = agent.distribution.binary;
              const resultDist = result.agents[i].distribution.binary;

              if (!originalDist || !resultDist) return false;

              const originalPlatforms = Object.keys(originalDist).sort();
              const resultPlatforms = Object.keys(resultDist).sort();

              if (originalPlatforms.length !== resultPlatforms.length) return false;

              return originalPlatforms.every((platform) => {
                const origTarget = originalDist[platform as Platform];
                const resTarget = resultDist[platform as Platform];
                return origTarget?.cmd === resTarget?.cmd;
              });
            });
          },
        ),
        { numRuns: 100 },
      );
    });

    it('should preserve npx distribution package and version through round-trip', () => {
      fc.assert(
        fc.property(
          fc.record({
            version: versionStringArb,
            agents: fc.array(
              fc.record({
                id: nonEmptyStringArb,
                name: nonEmptyStringArb,
                version: versionStringArb,
                distribution: npxDistributionArb.map((npx) => ({ npx })),
              }),
              { minLength: 1, maxLength: 5 },
            ),
          }),
          (originalRegistry) => {
            const json = JSON.stringify(originalRegistry);
            const parsed = JSON.parse(json);
            const result = parseRegistry(parsed);

            return originalRegistry.agents.every((agent, i) => {
              const originalDist = agent.distribution.npx;
              const resultDist = result.agents[i].distribution.npx;

              if (!originalDist || !resultDist) return false;

              return originalDist.package === resultDist.package;
            });
          },
        ),
        { numRuns: 100 },
      );
    });

    it('should preserve uvx distribution package and version through round-trip', () => {
      fc.assert(
        fc.property(
          fc.record({
            version: versionStringArb,
            agents: fc.array(
              fc.record({
                id: nonEmptyStringArb,
                name: nonEmptyStringArb,
                version: versionStringArb,
                distribution: uvxDistributionArb.map((uvx) => ({ uvx })),
              }),
              { minLength: 1, maxLength: 5 },
            ),
          }),
          (originalRegistry) => {
            const json = JSON.stringify(originalRegistry);
            const parsed = JSON.parse(json);
            const result = parseRegistry(parsed);

            return originalRegistry.agents.every((agent, i) => {
              const originalDist = agent.distribution.uvx;
              const resultDist = result.agents[i].distribution.uvx;

              if (!originalDist || !resultDist) return false;

              return originalDist.package === resultDist.package;
            });
          },
        ),
        { numRuns: 100 },
      );
    });

    it('should preserve optional description field through round-trip', () => {
      fc.assert(
        fc.property(registryArb, (originalRegistry) => {
          const json = JSON.stringify(originalRegistry);
          const parsed = JSON.parse(json);
          const result = parseRegistry(parsed);

          return originalRegistry.agents.every((agent, i) => {
            return agent.description === result.agents[i].description;
          });
        }),
        { numRuns: 100 },
      );
    });

    it('should handle empty agents array through round-trip', () => {
      fc.assert(
        fc.property(versionStringArb, (version) => {
          const originalRegistry: Registry = { version, agents: [] };
          const json = JSON.stringify(originalRegistry);
          const parsed = JSON.parse(json);
          const result = parseRegistry(parsed);

          return result.version === version && result.agents.length === 0;
        }),
        { numRuns: 100 },
      );
    });

    it('should handle registry with many agents through round-trip', () => {
      fc.assert(
        fc.property(
          fc.record({
            version: versionStringArb,
            agents: fc.array(registryAgentArb, { minLength: 5, maxLength: 10 }),
          }),
          (originalRegistry) => {
            const json = JSON.stringify(originalRegistry);
            const parsed = JSON.parse(json);
            const result = parseRegistry(parsed);

            return registriesEqual(originalRegistry, result);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  /**
   * Feature: acp-registry-transit, Property 2: Malformed JSON Rejection
   *
   * *For any* string that is not valid JSON, attempting to parse it as a registry
   * should produce a parse error rather than silently failing or returning partial data.
   *
   * Note: This property tests that parseRegistry() throws RegistryParseError for
   * invalid registry structures (not invalid JSON strings - that's handled by JSON.parse).
   *
   */
  describe('Property 2: Malformed JSON Rejection', () => {
    /**
     * Arbitrary for generating non-object values that should be rejected.
     * These are valid JSON values but not valid registry structures.
     */
    const nonObjectValueArb: fc.Arbitrary<unknown> = fc.oneof(
      fc.string(),
      fc.integer(),
      fc.double(),
      fc.boolean(),
      fc.constant(null),
      fc.array(fc.jsonValue()),
    );

    /**
     * Arbitrary for generating objects missing the required "version" field.
     */
    const missingVersionArb: fc.Arbitrary<object> = fc.record({
      agents: fc.array(registryAgentArb, { minLength: 0, maxLength: 3 }),
    });

    /**
     * Arbitrary for generating objects with invalid "version" field types.
     */
    const invalidVersionTypeArb: fc.Arbitrary<object> = fc.record({
      version: fc.oneof(
        fc.integer(),
        fc.boolean(),
        fc.constant(null),
        fc.array(fc.string()),
        fc.object(),
      ),
      agents: fc.array(registryAgentArb, { minLength: 0, maxLength: 3 }),
    });

    /**
     * Arbitrary for generating objects with empty string version.
     */
    const emptyVersionArb: fc.Arbitrary<object> = fc.record({
      version: fc.constant(''),
      agents: fc.array(registryAgentArb, { minLength: 0, maxLength: 3 }),
    });

    /**
     * Arbitrary for generating objects missing the required "agents" field.
     */
    const missingAgentsArb: fc.Arbitrary<object> = fc.record({
      version: versionStringArb,
    });

    /**
     * Arbitrary for generating objects with invalid "agents" field types.
     */
    const invalidAgentsTypeArb: fc.Arbitrary<object> = fc.record({
      version: versionStringArb,
      agents: fc.oneof(
        fc.string(),
        fc.integer(),
        fc.boolean(),
        fc.constant(null),
        fc.object(),
      ),
    });

    /**
     * Arbitrary for generating agents missing the required "id" field.
     */
    const agentMissingIdArb: fc.Arbitrary<object> = fc.record({
      version: versionStringArb,
      agents: fc.array(
        fc.record({
          name: nonEmptyStringArb,
          distribution: distributionArb,
        }),
        { minLength: 1, maxLength: 3 },
      ),
    });

    /**
     * Arbitrary for generating agents with invalid "id" field types.
     */
    const agentInvalidIdTypeArb: fc.Arbitrary<object> = fc.record({
      version: versionStringArb,
      agents: fc.array(
        fc.record({
          id: fc.oneof(fc.integer(), fc.boolean(), fc.constant(null), fc.array(fc.string())),
          name: nonEmptyStringArb,
          distribution: distributionArb,
        }),
        { minLength: 1, maxLength: 3 },
      ),
    });

    /**
     * Arbitrary for generating agents with empty string "id".
     */
    const agentEmptyIdArb: fc.Arbitrary<object> = fc.record({
      version: versionStringArb,
      agents: fc.array(
        fc.record({
          id: fc.constant(''),
          name: nonEmptyStringArb,
          distribution: distributionArb,
        }),
        { minLength: 1, maxLength: 3 },
      ),
    });

    /**
     * Arbitrary for generating agents missing the required "name" field.
     */
    const agentMissingNameArb: fc.Arbitrary<object> = fc.record({
      version: versionStringArb,
      agents: fc.array(
        fc.record({
          id: nonEmptyStringArb,
          distribution: distributionArb,
        }),
        { minLength: 1, maxLength: 3 },
      ),
    });

    /**
     * Arbitrary for generating agents with invalid "name" field types.
     */
    const agentInvalidNameTypeArb: fc.Arbitrary<object> = fc.record({
      version: versionStringArb,
      agents: fc.array(
        fc.record({
          id: nonEmptyStringArb,
          name: fc.oneof(fc.integer(), fc.boolean(), fc.constant(null), fc.array(fc.string())),
          distribution: distributionArb,
        }),
        { minLength: 1, maxLength: 3 },
      ),
    });

    /**
     * Arbitrary for generating agents with empty string "name".
     */
    const agentEmptyNameArb: fc.Arbitrary<object> = fc.record({
      version: versionStringArb,
      agents: fc.array(
        fc.record({
          id: nonEmptyStringArb,
          name: fc.constant(''),
          distribution: distributionArb,
        }),
        { minLength: 1, maxLength: 3 },
      ),
    });

    /**
     * Arbitrary for generating agents missing the required "distribution" field.
     */
    const agentMissingDistributionArb: fc.Arbitrary<object> = fc.record({
      version: versionStringArb,
      agents: fc.array(
        fc.record({
          id: nonEmptyStringArb,
          name: nonEmptyStringArb,
        }),
        { minLength: 1, maxLength: 3 },
      ),
    });

    /**
     * Arbitrary for generating agents with invalid "distribution" field types.
     */
    const agentInvalidDistributionTypeArb: fc.Arbitrary<object> = fc.record({
      version: versionStringArb,
      agents: fc.array(
        fc.record({
          id: nonEmptyStringArb,
          name: nonEmptyStringArb,
          distribution: fc.oneof(
            fc.string(),
            fc.integer(),
            fc.boolean(),
            fc.constant(null),
            fc.array(fc.string()),
          ),
        }),
        { minLength: 1, maxLength: 3 },
      ),
    });

    /**
     * Arbitrary for generating agents with distribution objects missing "type".
     */
    const agentDistributionMissingTypeArb: fc.Arbitrary<object> = fc.record({
      version: versionStringArb,
      agents: fc.array(
        fc.record({
          id: nonEmptyStringArb,
          name: nonEmptyStringArb,
          distribution: fc.record({
            package: packageNameArb,
          }),
        }),
        { minLength: 1, maxLength: 3 },
      ),
    });

    /**
     * Arbitrary for generating agents with distribution objects with invalid "type".
     */
    const agentDistributionInvalidTypeArb: fc.Arbitrary<object> = fc.record({
      version: versionStringArb,
      agents: fc.array(
        fc.record({
          id: nonEmptyStringArb,
          name: nonEmptyStringArb,
          distribution: fc.record({
            type: fc.constantFrom('invalid', 'unknown', 'docker', 'pip'),
            package: packageNameArb,
          }),
        }),
        { minLength: 1, maxLength: 3 },
      ),
    });

    /**
     * Arbitrary for generating npx distributions missing the required "package" field.
     */
    const npxDistributionMissingPackageArb: fc.Arbitrary<object> = fc.record({
      version: versionStringArb,
      agents: fc.array(
        fc.record({
          id: nonEmptyStringArb,
          name: nonEmptyStringArb,
          distribution: fc.record({
            type: fc.constant('npx'),
            version: fc.option(versionStringArb, { nil: undefined }),
          }),
        }),
        { minLength: 1, maxLength: 3 },
      ),
    });

    /**
     * Arbitrary for generating uvx distributions missing the required "package" field.
     */
    const uvxDistributionMissingPackageArb: fc.Arbitrary<object> = fc.record({
      version: versionStringArb,
      agents: fc.array(
        fc.record({
          id: nonEmptyStringArb,
          name: nonEmptyStringArb,
          distribution: fc.record({
            type: fc.constant('uvx'),
            version: fc.option(versionStringArb, { nil: undefined }),
          }),
        }),
        { minLength: 1, maxLength: 3 },
      ),
    });

    /**
     * Arbitrary for generating binary distributions missing the required "platforms" field.
     */
    const binaryDistributionMissingPlatformsArb: fc.Arbitrary<object> = fc.record({
      version: versionStringArb,
      agents: fc.array(
        fc.record({
          id: nonEmptyStringArb,
          name: nonEmptyStringArb,
          distribution: fc.record({
            type: fc.constant('binary'),
          }),
        }),
        { minLength: 1, maxLength: 3 },
      ),
    });

    /**
     * Arbitrary for generating agents that are not objects (e.g., strings, numbers).
     */
    const agentsArrayWithNonObjectArb: fc.Arbitrary<object> = fc.record({
      version: versionStringArb,
      agents: fc.array(
        fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)),
        { minLength: 1, maxLength: 3 },
      ),
    });

    it('should reject non-object values (strings, numbers, arrays, null, booleans)', () => {
      fc.assert(
        fc.property(nonObjectValueArb, (invalidData) => {
          expect(() => parseRegistry(invalidData)).toThrow(RegistryParseError);
        }),
        { numRuns: 100 },
      );
    });

    it('should reject objects missing the required "version" field', () => {
      fc.assert(
        fc.property(missingVersionArb, (invalidData) => {
          expect(() => parseRegistry(invalidData)).toThrow(RegistryParseError);
        }),
        { numRuns: 100 },
      );
    });

    it('should reject objects with invalid "version" field types', () => {
      fc.assert(
        fc.property(invalidVersionTypeArb, (invalidData) => {
          expect(() => parseRegistry(invalidData)).toThrow(RegistryParseError);
        }),
        { numRuns: 100 },
      );
    });

    it('should reject objects with empty string "version"', () => {
      fc.assert(
        fc.property(emptyVersionArb, (invalidData) => {
          expect(() => parseRegistry(invalidData)).toThrow(RegistryParseError);
        }),
        { numRuns: 100 },
      );
    });

    it('should reject objects missing the required "agents" field', () => {
      fc.assert(
        fc.property(missingAgentsArb, (invalidData) => {
          expect(() => parseRegistry(invalidData)).toThrow(RegistryParseError);
        }),
        { numRuns: 100 },
      );
    });

    it('should reject objects with invalid "agents" field types', () => {
      fc.assert(
        fc.property(invalidAgentsTypeArb, (invalidData) => {
          expect(() => parseRegistry(invalidData)).toThrow(RegistryParseError);
        }),
        { numRuns: 100 },
      );
    });

    it('should reject agents missing the required "id" field', () => {
      fc.assert(
        fc.property(agentMissingIdArb, (invalidData) => {
          expect(() => parseRegistry(invalidData)).toThrow(RegistryParseError);
        }),
        { numRuns: 100 },
      );
    });

    it('should reject agents with invalid "id" field types', () => {
      fc.assert(
        fc.property(agentInvalidIdTypeArb, (invalidData) => {
          expect(() => parseRegistry(invalidData)).toThrow(RegistryParseError);
        }),
        { numRuns: 100 },
      );
    });

    it('should reject agents with empty string "id"', () => {
      fc.assert(
        fc.property(agentEmptyIdArb, (invalidData) => {
          expect(() => parseRegistry(invalidData)).toThrow(RegistryParseError);
        }),
        { numRuns: 100 },
      );
    });

    it('should reject agents missing the required "name" field', () => {
      fc.assert(
        fc.property(agentMissingNameArb, (invalidData) => {
          expect(() => parseRegistry(invalidData)).toThrow(RegistryParseError);
        }),
        { numRuns: 100 },
      );
    });

    it('should reject agents with invalid "name" field types', () => {
      fc.assert(
        fc.property(agentInvalidNameTypeArb, (invalidData) => {
          expect(() => parseRegistry(invalidData)).toThrow(RegistryParseError);
        }),
        { numRuns: 100 },
      );
    });

    it('should reject agents with empty string "name"', () => {
      fc.assert(
        fc.property(agentEmptyNameArb, (invalidData) => {
          expect(() => parseRegistry(invalidData)).toThrow(RegistryParseError);
        }),
        { numRuns: 100 },
      );
    });

    it('should reject agents missing the required "distribution" field', () => {
      fc.assert(
        fc.property(agentMissingDistributionArb, (invalidData) => {
          expect(() => parseRegistry(invalidData)).toThrow(RegistryParseError);
        }),
        { numRuns: 100 },
      );
    });

    it('should reject agents with invalid "distribution" field types', () => {
      fc.assert(
        fc.property(agentInvalidDistributionTypeArb, (invalidData) => {
          expect(() => parseRegistry(invalidData)).toThrow(RegistryParseError);
        }),
        { numRuns: 100 },
      );
    });

    it('should reject agents with distribution objects missing "type"', () => {
      fc.assert(
        fc.property(agentDistributionMissingTypeArb, (invalidData) => {
          expect(() => parseRegistry(invalidData)).toThrow(RegistryParseError);
        }),
        { numRuns: 100 },
      );
    });

    it('should reject agents with distribution objects with invalid "type"', () => {
      fc.assert(
        fc.property(agentDistributionInvalidTypeArb, (invalidData) => {
          expect(() => parseRegistry(invalidData)).toThrow(RegistryParseError);
        }),
        { numRuns: 100 },
      );
    });

    it('should reject npx distributions missing the required "package" field', () => {
      fc.assert(
        fc.property(npxDistributionMissingPackageArb, (invalidData) => {
          expect(() => parseRegistry(invalidData)).toThrow(RegistryParseError);
        }),
        { numRuns: 100 },
      );
    });

    it('should reject uvx distributions missing the required "package" field', () => {
      fc.assert(
        fc.property(uvxDistributionMissingPackageArb, (invalidData) => {
          expect(() => parseRegistry(invalidData)).toThrow(RegistryParseError);
        }),
        { numRuns: 100 },
      );
    });

    it('should reject binary distributions missing the required "platforms" field', () => {
      fc.assert(
        fc.property(binaryDistributionMissingPlatformsArb, (invalidData) => {
          expect(() => parseRegistry(invalidData)).toThrow(RegistryParseError);
        }),
        { numRuns: 100 },
      );
    });

    it('should reject agents array containing non-object values', () => {
      fc.assert(
        fc.property(agentsArrayWithNonObjectArb, (invalidData) => {
          expect(() => parseRegistry(invalidData)).toThrow(RegistryParseError);
        }),
        { numRuns: 100 },
      );
    });

    it('should throw RegistryParseError (not other error types) for all malformed inputs', () => {
      // Combined arbitrary for all malformed inputs
      const allMalformedArb = fc.oneof(
        nonObjectValueArb,
        missingVersionArb,
        invalidVersionTypeArb,
        emptyVersionArb,
        missingAgentsArb,
        invalidAgentsTypeArb,
        agentMissingIdArb,
        agentInvalidIdTypeArb,
        agentEmptyIdArb,
        agentMissingNameArb,
        agentInvalidNameTypeArb,
        agentEmptyNameArb,
        agentMissingDistributionArb,
        agentInvalidDistributionTypeArb,
        agentDistributionMissingTypeArb,
        agentDistributionInvalidTypeArb,
        npxDistributionMissingPackageArb,
        uvxDistributionMissingPackageArb,
        binaryDistributionMissingPlatformsArb,
        agentsArrayWithNonObjectArb,
      );

      fc.assert(
        fc.property(allMalformedArb, (invalidData) => {
          try {
            parseRegistry(invalidData);
            // If we get here, the function didn't throw - this is a failure
            return false;
          } catch (error) {
            // Verify it's specifically a RegistryParseError
            return error instanceof RegistryParseError;
          }
        }),
        { numRuns: 100 },
      );
    });

    it('should include descriptive error message for malformed inputs', () => {
      fc.assert(
        fc.property(nonObjectValueArb, (invalidData) => {
          try {
            parseRegistry(invalidData);
            return false;
          } catch (error) {
            if (error instanceof RegistryParseError) {
              // Error message should be non-empty and descriptive
              return error.message.length > 0;
            }
            return false;
          }
        }),
        { numRuns: 100 },
      );
    });
  });
});

/**
 * Feature: acp-registry-transit, Property 3: Agent Lookup Correctness
 *
 * *For any* agentId that exists in the registry, looking up that agentId
 * should return the exact agent entry with matching id, name, description,
 * and distribution.
 *
 */
describe('Property 3: Agent Lookup Correctness', () => {
  /**
   * Arbitrary for generating registries with guaranteed unique agent IDs.
   * This ensures each agent can be looked up unambiguously.
   */
  const uniqueIdRegistryArb: fc.Arbitrary<Registry> = fc
    .record({
      version: versionStringArb,
      agents: fc.array(registryAgentArb, { minLength: 0, maxLength: 10 }),
    })
    .map((registry) => {
      // Ensure unique IDs by appending index
      const agents = registry.agents.map((agent, index) => ({
        ...agent,
        id: `${agent.id}-${index}`,
      }));
      return { ...registry, agents };
    });

  /**
   * Helper to create a RegistryIndex with pre-populated data.
   * Since RegistryIndex.fetch() requires network access, we manually
   * set the internal registry and agentMap using the parsed registry data.
   */
  function createPopulatedRegistryIndex(registry: Registry): {
    index: RegistryIndex;
    lookup: (agentId: string) => RegistryAgent | undefined;
  } {
    // Create a RegistryIndex instance (URL doesn't matter since we won't fetch)
    const index = new RegistryIndex('http://localhost/test-registry.json');

    // Access private members to populate the registry data
    // We use Object.assign to set private fields for testing purposes
    const indexAny = index as unknown as {
      registry: Registry | null;
      agentMap: Map<string, RegistryAgent>;
    };

    indexAny.registry = registry;
    indexAny.agentMap = new Map();
    for (const agent of registry.agents) {
      indexAny.agentMap.set(agent.id, agent);
    }

    return {
      index,
      lookup: (agentId: string) => index.lookup(agentId),
    };
  }

  it('should return the exact agent entry for any existing agentId', () => {
    fc.assert(
      fc.property(uniqueIdRegistryArb, (registry) => {
        const { lookup } = createPopulatedRegistryIndex(registry);

        // For every agent in the registry, lookup should return the exact entry
        return registry.agents.every((agent) => {
          const result = lookup(agent.id);
          if (!result) return false;

          // Verify all fields match exactly
          return agentsEqual(agent, result);
        });
      }),
      { numRuns: 100 },
    );
  });

  it('should return agent with matching id field', () => {
    fc.assert(
      fc.property(uniqueIdRegistryArb, (registry) => {
        const { lookup } = createPopulatedRegistryIndex(registry);

        return registry.agents.every((agent) => {
          const result = lookup(agent.id);
          return result !== undefined && result.id === agent.id;
        });
      }),
      { numRuns: 100 },
    );
  });

  it('should return agent with matching name field', () => {
    fc.assert(
      fc.property(uniqueIdRegistryArb, (registry) => {
        const { lookup } = createPopulatedRegistryIndex(registry);

        return registry.agents.every((agent) => {
          const result = lookup(agent.id);
          return result !== undefined && result.name === agent.name;
        });
      }),
      { numRuns: 100 },
    );
  });

  it('should return agent with matching description field', () => {
    fc.assert(
      fc.property(uniqueIdRegistryArb, (registry) => {
        const { lookup } = createPopulatedRegistryIndex(registry);

        return registry.agents.every((agent) => {
          const result = lookup(agent.id);
          return result !== undefined && result.description === agent.description;
        });
      }),
      { numRuns: 100 },
    );
  });

  it('should return agent with matching distribution type', () => {
    fc.assert(
      fc.property(uniqueIdRegistryArb, (registry) => {
        const { lookup } = createPopulatedRegistryIndex(registry);

        return registry.agents.every((agent) => {
          const result = lookup(agent.id);
          if (!result) return false;
          // Check that the same distribution types are present
          return (
            (!!result.distribution.binary === !!agent.distribution.binary) &&
            (!!result.distribution.npx === !!agent.distribution.npx) &&
            (!!result.distribution.uvx === !!agent.distribution.uvx)
          );
        });
      }),
      { numRuns: 100 },
    );
  });

  it('should return agent with matching distribution details', () => {
    fc.assert(
      fc.property(uniqueIdRegistryArb, (registry) => {
        const { lookup } = createPopulatedRegistryIndex(registry);

        return registry.agents.every((agent) => {
          const result = lookup(agent.id);
          return result !== undefined && distributionsEqual(agent.distribution, result.distribution);
        });
      }),
      { numRuns: 100 },
    );
  });

  it('should handle duplicate IDs by returning the last agent with that ID', () => {
    // Generate registry with intentional duplicate IDs
    const duplicateIdRegistryArb = fc
      .record({
        version: versionStringArb,
        agents: fc.array(registryAgentArb, { minLength: 2, maxLength: 10 }),
      })
      .map((registry) => {
        // Force first two agents to have the same ID
        if (registry.agents.length >= 2) {
          registry.agents[1] = { ...registry.agents[1], id: registry.agents[0].id };
        }
        return registry;
      });

    fc.assert(
      fc.property(duplicateIdRegistryArb, (registry) => {
        const { lookup } = createPopulatedRegistryIndex(registry);

        // For duplicate IDs, the last agent in the array should be returned
        const duplicateId = registry.agents[0].id;
        const lastAgentWithId = [...registry.agents].reverse().find((a) => a.id === duplicateId);
        const result = lookup(duplicateId);

        if (!result || !lastAgentWithId) return false;
        return agentsEqual(lastAgentWithId, result);
      }),
      { numRuns: 100 },
    );
  });

  it('should return undefined for non-existent agentId', () => {
    fc.assert(
      fc.property(
        uniqueIdRegistryArb,
        nonEmptyStringArb,
        (registry, randomId) => {
          const { lookup } = createPopulatedRegistryIndex(registry);

          // If the random ID doesn't exist in the registry, lookup should return undefined
          const existingIds = new Set(registry.agents.map((a) => a.id));
          if (!existingIds.has(randomId)) {
            return lookup(randomId) === undefined;
          }
          // If it happens to exist, the lookup should succeed
          return lookup(randomId) !== undefined;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should handle empty registry correctly', () => {
    fc.assert(
      fc.property(
        versionStringArb,
        nonEmptyStringArb,
        (version, agentId) => {
          const emptyRegistry: Registry = { version, agents: [] };
          const { lookup } = createPopulatedRegistryIndex(emptyRegistry);

          // Any lookup on empty registry should return undefined
          return lookup(agentId) === undefined;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should return the same reference for repeated lookups', () => {
    fc.assert(
      fc.property(uniqueIdRegistryArb, (registry) => {
        const { lookup } = createPopulatedRegistryIndex(registry);

        // Multiple lookups for the same ID should return the same reference
        return registry.agents.every((agent) => {
          const result1 = lookup(agent.id);
          const result2 = lookup(agent.id);
          return result1 === result2;
        });
      }),
      { numRuns: 100 },
    );
  });

  it('should handle binary distribution lookup correctly', () => {
    const binaryAgentRegistryArb = fc
      .record({
        version: versionStringArb,
        agents: fc.array(
          fc.record({
            id: nonEmptyStringArb,
            name: nonEmptyStringArb,
            version: versionStringArb,
            description: fc.option(fc.string({ maxLength: 200 }), { nil: undefined }),
            distribution: binaryDistributionArb.map((binary) => ({ binary })),
          }),
          { minLength: 1, maxLength: 5 },
        ),
      })
      .map((registry) => {
        // Ensure unique IDs
        const agents = registry.agents.map((agent, index) => ({
          ...agent,
          id: `${agent.id}-${index}`,
        }));
        return { ...registry, agents };
      });

    fc.assert(
      fc.property(binaryAgentRegistryArb, (registry) => {
        const { lookup } = createPopulatedRegistryIndex(registry);

        return registry.agents.every((agent) => {
          const result = lookup(agent.id);
          if (!result) return false;

          // Verify binary distribution details
          const originalDist = agent.distribution.binary;
          const resultDist = result.distribution.binary;

          if (!originalDist || !resultDist) return false;

          const originalPlatforms = Object.keys(originalDist).sort();
          const resultPlatforms = Object.keys(resultDist).sort();

          if (originalPlatforms.length !== resultPlatforms.length) return false;
          return originalPlatforms.every((p) => {
            const origTarget = originalDist[p as Platform];
            const resTarget = resultDist[p as Platform];
            return origTarget?.cmd === resTarget?.cmd;
          });
        });
      }),
      { numRuns: 100 },
    );
  });

  it('should handle npx distribution lookup correctly', () => {
    const npxAgentRegistryArb = fc
      .record({
        version: versionStringArb,
        agents: fc.array(
          fc.record({
            id: nonEmptyStringArb,
            name: nonEmptyStringArb,
            version: versionStringArb,
            description: fc.option(fc.string({ maxLength: 200 }), { nil: undefined }),
            distribution: npxDistributionArb.map((npx) => ({ npx })),
          }),
          { minLength: 1, maxLength: 5 },
        ),
      })
      .map((registry) => {
        // Ensure unique IDs
        const agents = registry.agents.map((agent, index) => ({
          ...agent,
          id: `${agent.id}-${index}`,
        }));
        return { ...registry, agents };
      });

    fc.assert(
      fc.property(npxAgentRegistryArb, (registry) => {
        const { lookup } = createPopulatedRegistryIndex(registry);

        return registry.agents.every((agent) => {
          const result = lookup(agent.id);
          if (!result) return false;

          // Verify npx distribution details
          const originalDist = agent.distribution.npx;
          const resultDist = result.distribution.npx;

          if (!originalDist || !resultDist) return false;

          return originalDist.package === resultDist.package;
        });
      }),
      { numRuns: 100 },
    );
  });

  it('should handle uvx distribution lookup correctly', () => {
    const uvxAgentRegistryArb = fc
      .record({
        version: versionStringArb,
        agents: fc.array(
          fc.record({
            id: nonEmptyStringArb,
            name: nonEmptyStringArb,
            version: versionStringArb,
            description: fc.option(fc.string({ maxLength: 200 }), { nil: undefined }),
            distribution: uvxDistributionArb.map((uvx) => ({ uvx })),
          }),
          { minLength: 1, maxLength: 5 },
        ),
      })
      .map((registry) => {
        // Ensure unique IDs
        const agents = registry.agents.map((agent, index) => ({
          ...agent,
          id: `${agent.id}-${index}`,
        }));
        return { ...registry, agents };
      });

    fc.assert(
      fc.property(uvxAgentRegistryArb, (registry) => {
        const { lookup } = createPopulatedRegistryIndex(registry);

        return registry.agents.every((agent) => {
          const result = lookup(agent.id);
          if (!result) return false;

          // Verify uvx distribution details
          const originalDist = agent.distribution.uvx;
          const resultDist = result.distribution.uvx;

          if (!originalDist || !resultDist) return false;

          return originalDist.package === resultDist.package;
        });
      }),
      { numRuns: 100 },
    );
  });
});


/**
 * Feature: acp-registry-transit, Property 4: Agent Not Found Error
 *
 * *For any* agentId that does not exist in the registry, attempting to resolve it
 * should return a JSON-RPC error response with code -32001 and message "Agent not found".
 *
 * Note: The resolve() method throws AgentNotFoundError when the agent is not found.
 * This test verifies:
 * 1. For any agentId not in the registry, resolve() throws AgentNotFoundError
 * 2. The error contains the agentId that was not found
 * 3. The error message includes "Agent not found"
 *
 */
describe('Property 4: Agent Not Found Error', () => {
  /**
   * Arbitrary for generating registries with guaranteed unique agent IDs.
   */
  const uniqueIdRegistryArb: fc.Arbitrary<Registry> = fc
    .record({
      version: versionStringArb,
      agents: fc.array(registryAgentArb, { minLength: 0, maxLength: 10 }),
    })
    .map((registry) => {
      // Ensure unique IDs by appending index
      const agents = registry.agents.map((agent, index) => ({
        ...agent,
        id: `${agent.id}-${index}`,
      }));
      return { ...registry, agents };
    });

  /**
   * Arbitrary for generating agent IDs that are guaranteed not to exist in a registry.
   * Uses a prefix that won't match the unique ID pattern used in uniqueIdRegistryArb.
   */
  const nonExistentAgentIdArb: fc.Arbitrary<string> = fc
    .string({ minLength: 1, maxLength: 50 })
    .filter((s) => s.trim().length > 0)
    .map((s) => `__nonexistent__${s}`);

  /**
   * Helper to create a RegistryIndex with pre-populated data.
   */
  function createPopulatedRegistryIndex(registry: Registry): RegistryIndex {
    const index = new RegistryIndex('http://localhost/test-registry.json');

    // Access private members to populate the registry data
    const indexAny = index as unknown as {
      registry: Registry | null;
      agentMap: Map<string, RegistryAgent>;
    };

    indexAny.registry = registry;
    indexAny.agentMap = new Map();
    for (const agent of registry.agents) {
      indexAny.agentMap.set(agent.id, agent);
    }

    return index;
  }

  it('should throw AgentNotFoundError for any agentId not in the registry', () => {
    fc.assert(
      fc.property(
        uniqueIdRegistryArb,
        nonExistentAgentIdArb,
        (registry, nonExistentId) => {
          const index = createPopulatedRegistryIndex(registry);

          // Verify the ID doesn't exist in the registry
          const existingIds = new Set(registry.agents.map((a) => a.id));
          if (existingIds.has(nonExistentId)) {
            // Skip this case - the ID happens to exist
            return true;
          }

          // resolve() should throw AgentNotFoundError
          try {
            index.resolve(nonExistentId);
            // If we get here, the function didn't throw - this is a failure
            return false;
          } catch (error) {
            return error instanceof AgentNotFoundError;
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should include the agentId in the AgentNotFoundError', () => {
    fc.assert(
      fc.property(
        uniqueIdRegistryArb,
        nonExistentAgentIdArb,
        (registry, nonExistentId) => {
          const index = createPopulatedRegistryIndex(registry);

          // Verify the ID doesn't exist in the registry
          const existingIds = new Set(registry.agents.map((a) => a.id));
          if (existingIds.has(nonExistentId)) {
            return true;
          }

          try {
            index.resolve(nonExistentId);
            return false;
          } catch (error) {
            if (error instanceof AgentNotFoundError) {
              // The error should contain the agentId that was not found
              return error.agentId === nonExistentId;
            }
            return false;
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should include "Agent not found" in the error message', () => {
    fc.assert(
      fc.property(
        uniqueIdRegistryArb,
        nonExistentAgentIdArb,
        (registry, nonExistentId) => {
          const index = createPopulatedRegistryIndex(registry);

          // Verify the ID doesn't exist in the registry
          const existingIds = new Set(registry.agents.map((a) => a.id));
          if (existingIds.has(nonExistentId)) {
            return true;
          }

          try {
            index.resolve(nonExistentId);
            return false;
          } catch (error) {
            if (error instanceof AgentNotFoundError) {
              // The error message should include "Agent not found"
              return error.message.includes('Agent not found');
            }
            return false;
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should throw AgentNotFoundError for empty registry', () => {
    fc.assert(
      fc.property(
        versionStringArb,
        nonExistentAgentIdArb,
        (version, agentId) => {
          const emptyRegistry: Registry = { version, agents: [] };
          const index = createPopulatedRegistryIndex(emptyRegistry);

          try {
            index.resolve(agentId);
            return false;
          } catch (error) {
            if (error instanceof AgentNotFoundError) {
              return error.agentId === agentId && error.message.includes('Agent not found');
            }
            return false;
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should throw AgentNotFoundError with correct error name', () => {
    fc.assert(
      fc.property(
        uniqueIdRegistryArb,
        nonExistentAgentIdArb,
        (registry, nonExistentId) => {
          const index = createPopulatedRegistryIndex(registry);

          const existingIds = new Set(registry.agents.map((a) => a.id));
          if (existingIds.has(nonExistentId)) {
            return true;
          }

          try {
            index.resolve(nonExistentId);
            return false;
          } catch (error) {
            if (error instanceof AgentNotFoundError) {
              return error.name === 'AgentNotFoundError';
            }
            return false;
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should throw AgentNotFoundError for random string IDs not in registry', () => {
    fc.assert(
      fc.property(
        uniqueIdRegistryArb,
        fc.string({ minLength: 1, maxLength: 100 }),
        (registry, randomId) => {
          const index = createPopulatedRegistryIndex(registry);

          const existingIds = new Set(registry.agents.map((a) => a.id));
          if (existingIds.has(randomId)) {
            // If the random ID happens to exist, resolve should succeed (not throw)
            try {
              index.resolve(randomId);
              return true;
            } catch {
              return false;
            }
          }

          // If the ID doesn't exist, resolve should throw AgentNotFoundError
          try {
            index.resolve(randomId);
            return false;
          } catch (error) {
            return error instanceof AgentNotFoundError && error.agentId === randomId;
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should throw AgentNotFoundError for IDs with special characters', () => {
    const specialCharIdArb = fc.oneof(
      fc.constant('agent with spaces'),
      fc.constant('agent/with/slashes'),
      fc.constant('agent@special!chars'),
      fc.constant('agent\twith\ttabs'),
      fc.constant('agent\nwith\nnewlines'),
      fc.constant('émojis🎉agent'),
      fc.constant('中文agent'),
      fc.constant(''),
      fc.constant('   '),
      fc.constant('agent-with-dashes'),
      fc.constant('agent_with_underscores'),
      fc.constant('agent.with.dots'),
    ).filter((s) => s.length > 0 && s.trim().length > 0);

    fc.assert(
      fc.property(
        uniqueIdRegistryArb,
        specialCharIdArb,
        (registry, specialId) => {
          const index = createPopulatedRegistryIndex(registry);

          const existingIds = new Set(registry.agents.map((a) => a.id));
          if (existingIds.has(specialId)) {
            return true;
          }

          try {
            index.resolve(specialId);
            return false;
          } catch (error) {
            if (error instanceof AgentNotFoundError) {
              return error.agentId === specialId && error.message.includes('Agent not found');
            }
            return false;
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should not throw AgentNotFoundError for existing agent IDs', () => {
    // Generate registries with at least one agent that has a resolvable distribution
    const resolvableRegistryArb = fc
      .record({
        version: versionStringArb,
        agents: fc.array(
          fc.record({
            id: nonEmptyStringArb,
            name: nonEmptyStringArb,
            version: versionStringArb,
            description: fc.option(fc.string({ maxLength: 200 }), { nil: undefined }),
            distribution: fc.oneof(
              npxDistributionArb.map((npx) => ({ npx })),
              uvxDistributionArb.map((uvx) => ({ uvx })),
            ),
          }),
          { minLength: 1, maxLength: 5 },
        ),
      })
      .map((registry) => {
        const agents = registry.agents.map((agent, index) => ({
          ...agent,
          id: `${agent.id}-${index}`,
        }));
        return { ...registry, agents };
      });

    fc.assert(
      fc.property(resolvableRegistryArb, (registry) => {
        const index = createPopulatedRegistryIndex(registry);

        // For existing agents with npx/uvx distributions, resolve should NOT throw AgentNotFoundError
        return registry.agents.every((agent) => {
          try {
            const result = index.resolve(agent.id);
            // Should return a valid SpawnCommand
            return (
              typeof result.command === 'string' &&
              Array.isArray(result.args)
            );
          } catch (error) {
            // AgentNotFoundError should NOT be thrown for existing agents
            if (error instanceof AgentNotFoundError) {
              return false;
            }
            // Other errors (like PlatformNotSupportedError) are acceptable
            return true;
          }
        });
      }),
      { numRuns: 100 },
    );
  });
});
