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
 * Property-Based Tests for Configuration Parsing
 *
 * Feature: acp-registry-transit, Property 15: Config Parsing
 *
 * This test verifies that for any valid JSON configuration file containing
 * registryUrl and/or shutdownTimeoutSec fields, parsing should produce a
 * LauncherConfig with those values set correctly.
 *
 * @module registry-launcher/config/config.property.test
 */
import * as fc from 'fast-check';
import { loadConfig } from './config.js';
import { DEFAULT_CONFIG } from './types.js';
import { mkdirSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('Config Parsing Property Tests', () => {
  let testDir: string;
  let testConfigPath: string;
  const originalEnv = process.env;

  beforeEach(() => {
    // Create a unique test directory for each test
    testDir = join(tmpdir(), `config-pbt-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    testConfigPath = join(testDir, 'config.json');

    // Reset environment variables
    process.env = { ...originalEnv };
    delete process.env.ACP_REGISTRY_URL;
  });

  afterEach(() => {
    // Clean up test files
    try {
      unlinkSync(testConfigPath);
    } catch {
      // File may not exist
    }
    try {
      rmdirSync(testDir);
    } catch {
      // Directory may not exist or not be empty
    }

    // Restore environment
    process.env = originalEnv;
  });

  /**
   * Arbitrary for generating valid registry URLs.
   * URLs must be non-empty strings.
   */
  const validRegistryUrlArb = fc.webUrl().filter(url => url.length > 0);

  /**
   * Arbitrary for generating valid shutdown timeout values.
   * Must be positive finite numbers.
   */
  const validShutdownTimeoutArb = fc.double({
    min: 0.001,
    max: 3600,
    noNaN: true,
  }).filter(n => Number.isFinite(n) && n > 0);

  /**
   * Feature: acp-registry-transit, Property 15: Config Parsing
   *
   * *For any* valid JSON configuration file containing registryUrl and/or
   * shutdownTimeoutSec fields, parsing should produce a LauncherConfig with
   * those values set correctly.
   */
  describe('Property 15: Config Parsing', () => {
    it('should correctly parse config with both registryUrl and shutdownTimeoutSec', () => {
      // Suppress console.error during property tests
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      fc.assert(
        fc.property(
          validRegistryUrlArb,
          validShutdownTimeoutArb,
          (registryUrl, shutdownTimeoutSec) => {
            const config = { registryUrl, shutdownTimeoutSec };
            writeFileSync(testConfigPath, JSON.stringify(config));

            const result = loadConfig(testConfigPath);

            // Verify both values are correctly parsed
            return (
              result.registryUrl === registryUrl &&
              result.shutdownTimeoutSec === shutdownTimeoutSec
            );
          },
        ),
        { numRuns: 100 },
      );

      consoleSpy.mockRestore();
    });

    it('should correctly parse config with only registryUrl', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      fc.assert(
        fc.property(validRegistryUrlArb, (registryUrl) => {
          const config = { registryUrl };
          writeFileSync(testConfigPath, JSON.stringify(config));

          const result = loadConfig(testConfigPath);

          // Verify registryUrl is correctly parsed and shutdownTimeoutSec uses default
          return (
            result.registryUrl === registryUrl &&
            result.shutdownTimeoutSec === DEFAULT_CONFIG.shutdownTimeoutSec
          );
        }),
        { numRuns: 100 },
      );

      consoleSpy.mockRestore();
    });

    it('should correctly parse config with only shutdownTimeoutSec', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      fc.assert(
        fc.property(validShutdownTimeoutArb, (shutdownTimeoutSec) => {
          const config = { shutdownTimeoutSec };
          writeFileSync(testConfigPath, JSON.stringify(config));

          const result = loadConfig(testConfigPath);

          // Verify shutdownTimeoutSec is correctly parsed and registryUrl uses default
          return (
            result.registryUrl === DEFAULT_CONFIG.registryUrl &&
            result.shutdownTimeoutSec === shutdownTimeoutSec
          );
        }),
        { numRuns: 100 },
      );

      consoleSpy.mockRestore();
    });

    it('should preserve config values through JSON serialization round-trip', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      /**
       * Arbitrary for generating complete valid LauncherConfig objects.
       */
      const validLauncherConfigArb = fc.record({
        registryUrl: validRegistryUrlArb,
        shutdownTimeoutSec: validShutdownTimeoutArb,
      });

      fc.assert(
        fc.property(validLauncherConfigArb, (originalConfig) => {
          // Write config to file
          writeFileSync(testConfigPath, JSON.stringify(originalConfig));

          // Parse it back
          const parsedConfig = loadConfig(testConfigPath);

          // Verify round-trip preserves values
          return (
            parsedConfig.registryUrl === originalConfig.registryUrl &&
            parsedConfig.shutdownTimeoutSec === originalConfig.shutdownTimeoutSec
          );
        }),
        { numRuns: 100 },
      );

      consoleSpy.mockRestore();
    });

    it('should handle config with extra fields by ignoring them', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      /**
       * Arbitrary for generating extra fields that should be ignored.
       */
      const extraFieldsArb = fc.dictionary(
        fc.string({ minLength: 1, maxLength: 20 }).filter(
          (s) => s !== 'registryUrl' && s !== 'shutdownTimeoutSec',
        ),
        fc.jsonValue(),
      );

      fc.assert(
        fc.property(
          validRegistryUrlArb,
          validShutdownTimeoutArb,
          extraFieldsArb,
          (registryUrl, shutdownTimeoutSec, extraFields) => {
            const config = { registryUrl, shutdownTimeoutSec, ...extraFields };
            writeFileSync(testConfigPath, JSON.stringify(config));

            const result = loadConfig(testConfigPath);

            // Verify known fields are correctly parsed
            const knownFieldsCorrect =
              result.registryUrl === registryUrl &&
              result.shutdownTimeoutSec === shutdownTimeoutSec;

            // Verify extra fields are not present in result
            const resultKeys = Object.keys(result);
            const onlyKnownFields =
              resultKeys.length === 2 &&
              resultKeys.includes('registryUrl') &&
              resultKeys.includes('shutdownTimeoutSec');

            return knownFieldsCorrect && onlyKnownFields;
          },
        ),
        { numRuns: 100 },
      );

      consoleSpy.mockRestore();
    });

    it('should return valid LauncherConfig structure for any valid input', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      /**
       * Arbitrary for generating optional config fields.
       */
      const optionalConfigArb = fc.record(
        {
          registryUrl: validRegistryUrlArb,
          shutdownTimeoutSec: validShutdownTimeoutArb,
        },
        { requiredKeys: [] },
      );

      fc.assert(
        fc.property(optionalConfigArb, (config) => {
          writeFileSync(testConfigPath, JSON.stringify(config));

          const result = loadConfig(testConfigPath);

          // Verify result is a valid LauncherConfig
          const hasRegistryUrl =
            typeof result.registryUrl === 'string' && result.registryUrl.length > 0;
          const hasShutdownTimeout =
            typeof result.shutdownTimeoutSec === 'number' &&
            result.shutdownTimeoutSec > 0 &&
            Number.isFinite(result.shutdownTimeoutSec);

          return hasRegistryUrl && hasShutdownTimeout;
        }),
        { numRuns: 100 },
      );

      consoleSpy.mockRestore();
    });
  });
});
