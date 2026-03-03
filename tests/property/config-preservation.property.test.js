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
 * Property-based tests for config file preservation
 * Feature: npm-package-build
 */

import * as fc from 'fast-check';
import { mkdir, writeFile, rm, stat } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { copyWorkerConfigs } from '../../scripts/build.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const testTmpDir = join(__dirname, '..', '..', 'test-tmp-config');
const testRegistryDir = join(testTmpDir, 'workers-registry');
const testOutDir = join(testTmpDir, 'out');
const testDistDir = join(testOutDir, 'dist', 'workers');

/**
 * Setup a temporary test directory
 */
async function setupTestDir() {
  await rm(testTmpDir, { recursive: true, force: true });
  await mkdir(testRegistryDir, { recursive: true });
  await mkdir(testDistDir, { recursive: true });
  return testTmpDir;
}

/**
 * Cleanup test directory
 */
async function cleanupTestDir() {
  await rm(testTmpDir, { recursive: true, force: true });
}

/**
 * Check if a file exists
 */
async function fileExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe('Config File Preservation Property Tests', () => {
  beforeEach(async () => {
    await setupTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir();
  });

  // Feature: npm-package-build, Property 3: Worker Config File Preservation
  test('Property 3: Worker Config File Preservation - Config files are copied to correct output location', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          workerName: fc.stringMatching(/^[a-z][a-z0-9-]{2,20}$/),
          workerType: fc.constantFrom('typescript', 'javascript'),
          configFilename: fc.oneof(
            fc.constant('{name}-config.json'),
            fc.stringMatching(/^[a-z][a-z0-9-]{2,15}-config\.json$/)
          )
        }),
        async ({ workerName, workerType, configFilename }) => {
          // Create worker directory
          const workerDir = join(testRegistryDir, workerName);
          await mkdir(workerDir, { recursive: true });

          // Resolve config filename (replace {name} placeholder)
          const actualConfigFilename = configFilename === '{name}-config.json'
            ? `${workerName}-config.json`
            : configFilename;

          // Create config file with valid JSON content
          const configContent = {
            pools: [
              {
                name: 'default',
                size: 2,
                maxQueueSize: 100
              }
            ],
            limits: {
              maxMessageSize: 1048576,
              timeout: 30000
            }
          };

          await writeFile(
            join(workerDir, actualConfigFilename),
            JSON.stringify(configContent, null, 2)
          );

          // Create worker metadata object
          const worker = {
            name: workerName,
            path: workerDir,
            type: workerType,
            entrypoint: workerType === 'typescript' ? 'src/index.ts' : 'index.js',
            hasConfig: true,
            configFile: actualConfigFilename,
            hasTypes: workerType === 'typescript'
          };

          // Create output directory for the worker
          const outputDir = join(testDistDir, workerName);
          await mkdir(outputDir, { recursive: true });

          // Copy config files using the function from build.js
          await copyWorkerConfigs(worker, outputDir);

          // Verify config file was copied to correct location
          const expectedConfigPath = join(testDistDir, workerName, actualConfigFilename);
          const configExists = await fileExists(expectedConfigPath);
          expect(configExists).toBe(true);

          // Verify the content is valid JSON and matches original
          const { readFile } = await import('fs/promises');
          const copiedContent = await readFile(expectedConfigPath, 'utf-8');
          const copiedConfig = JSON.parse(copiedContent);

          expect(copiedConfig).toEqual(configContent);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Property 3 (edge case): Workers without config files are handled gracefully', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          workerName: fc.stringMatching(/^[a-z][a-z0-9-]{2,20}$/),
          workerType: fc.constantFrom('typescript', 'javascript')
        }),
        async ({ workerName, workerType }) => {
          // Create worker directory
          const workerDir = join(testRegistryDir, workerName);
          await mkdir(workerDir, { recursive: true });

          // Create worker metadata object WITHOUT config file
          const worker = {
            name: workerName,
            path: workerDir,
            type: workerType,
            entrypoint: workerType === 'typescript' ? 'src/index.ts' : 'index.js',
            hasConfig: false,
            configFile: null,
            hasTypes: workerType === 'typescript'
          };

          // Create output directory for the worker
          const outputDir = join(testDistDir, workerName);
          await mkdir(outputDir, { recursive: true });

          // Copy config files (should handle gracefully with no config)
          await expect(copyWorkerConfigs(worker, outputDir)).resolves.not.toThrow();

          // Verify no config file was created in output
          const outputFiles = await import('fs/promises').then(fs =>
            fs.readdir(outputDir).catch(() => [])
          );
          const configFiles = outputFiles.filter(f => f.endsWith('-config.json'));
          expect(configFiles).toHaveLength(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Property 3 (multiple configs): Only specified config file is copied', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          workerName: fc.stringMatching(/^[a-z][a-z0-9-]{2,20}$/),
          workerType: fc.constantFrom('typescript', 'javascript')
        }),
        async ({ workerName, workerType }) => {
          // Create worker directory
          const workerDir = join(testRegistryDir, workerName);
          await mkdir(workerDir, { recursive: true });

          // Create multiple config files
          const primaryConfig = `${workerName}-config.json`;
          const secondaryConfig = `${workerName}-alt-config.json`;

          await writeFile(
            join(workerDir, primaryConfig),
            JSON.stringify({ pools: [{ name: 'primary', size: 1 }] })
          );

          await writeFile(
            join(workerDir, secondaryConfig),
            JSON.stringify({ pools: [{ name: 'secondary', size: 2 }] })
          );

          // Create worker metadata object specifying only primary config
          const worker = {
            name: workerName,
            path: workerDir,
            type: workerType,
            entrypoint: workerType === 'typescript' ? 'src/index.ts' : 'index.js',
            hasConfig: true,
            configFile: primaryConfig,
            hasTypes: workerType === 'typescript'
          };

          // Create output directory for the worker
          const outputDir = join(testDistDir, workerName);
          await mkdir(outputDir, { recursive: true });

          // Copy config files
          await copyWorkerConfigs(worker, outputDir);

          // Verify only the primary config was copied
          const primaryExists = await fileExists(join(outputDir, primaryConfig));
          expect(primaryExists).toBe(true);

          const secondaryExists = await fileExists(join(outputDir, secondaryConfig));
          expect(secondaryExists).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});
