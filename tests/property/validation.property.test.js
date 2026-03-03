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
 * Property-based tests for build output validation
 * Feature: npm-package-build
 */

import * as fc from 'fast-check';
import { mkdir, writeFile, rm, stat } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { validateBuild } from '../../scripts/build.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const testTmpDir = join(__dirname, '..', '..', 'test-tmp-validation');
const testOutDir = join(testTmpDir, 'out');
const testDistDir = join(testOutDir, 'dist', 'workers');
const testTscDir = join(testOutDir, 'tsc', 'workers');

/**
 * Setup a temporary test directory
 */
async function setupTestDir() {
  await rm(testTmpDir, { recursive: true, force: true });
  await mkdir(testDistDir, { recursive: true });
  await mkdir(testTscDir, { recursive: true });
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

describe('Build Output Validation Property Tests', () => {
  beforeEach(async () => {
    await setupTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir();
  });

  // Feature: npm-package-build, Property 9: Build Output Validation Completeness
  test('Property 9: Build Output Validation Completeness - Validation checks all required files', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            workerName: fc.stringMatching(/^[a-z][a-z0-9-]{2,20}$/),
            workerType: fc.constantFrom('typescript', 'javascript'),
            hasConfig: fc.boolean(),
            configFilename: fc.stringMatching(/^[a-z][a-z0-9-]{2,15}-config\.json$/)
          }),
          { minLength: 1, maxLength: 5 }
        ),
        async (workerSpecs) => {
          // Create unique worker names to avoid conflicts
          const uniqueWorkers = [];
          const seenNames = new Set();

          for (const spec of workerSpecs) {
            if (!seenNames.has(spec.workerName)) {
              seenNames.add(spec.workerName);
              uniqueWorkers.push(spec);
            }
          }

          if (uniqueWorkers.length === 0) {
            return; // Skip if no unique workers
          }

          // Build worker metadata array
          const workers = uniqueWorkers.map(spec => ({
            name: spec.workerName,
            path: join(testTmpDir, 'workers-registry', spec.workerName),
            type: spec.workerType,
            entrypoint: spec.workerType === 'typescript' ? 'src/index.ts' : `${spec.workerName}.js`,
            hasConfig: spec.hasConfig,
            configFile: spec.hasConfig ? `${spec.workerName}-config.json` : null,
            hasTypes: spec.workerType === 'typescript'
          }));

          // Create all required files for each worker
          for (const worker of workers) {
            // Create worker entrypoint in dist
            const entrypointFilename = worker.type === 'typescript' ? 'index.js' : worker.entrypoint;
            const entrypointPath = join(testDistDir, worker.name, entrypointFilename);
            await mkdir(join(testDistDir, worker.name), { recursive: true });
            await writeFile(entrypointPath, '// Worker entrypoint\nexport default {};');

            // Create type definitions for TypeScript workers
            if (worker.type === 'typescript') {
              const typeDefPath = worker.entrypoint.replace(/\.ts$/, '.d.ts');
              const typesPath = join(testTscDir, worker.name, typeDefPath);
              await mkdir(dirname(typesPath), { recursive: true });
              await writeFile(typesPath, 'export default {};\n');
            }

            // Create config file if worker has one
            if (worker.hasConfig && worker.configFile) {
              const configPath = join(testDistDir, worker.name, worker.configFile);
              await writeFile(
                configPath,
                JSON.stringify({ pools: [{ name: 'default', size: 1 }] })
              );
            }
          }

          // Run validation
          const result = await validateBuild(workers, {
            distPath: testDistDir,
            tscPath: testTscDir
          });

          // Validation should pass since all files exist
          expect(result.success).toBe(true);
          expect(result.errors).toHaveLength(0);

          // Verify validation checked all required files
          const expectedFileCount = workers.reduce((count, worker) => {
            let files = 1; // entrypoint
            if (worker.type === 'typescript') files++; // type definitions
            if (worker.hasConfig) files++; // config file
            return count + files;
          }, 0);

          expect(result.checkedFiles.length).toBe(expectedFileCount);

          // Verify each worker's files were checked
          for (const worker of workers) {
            const entrypointFilename = worker.type === 'typescript' ? 'index.js' : worker.entrypoint;
            const entrypointPath = join(testDistDir, worker.name, entrypointFilename);
            expect(result.checkedFiles).toContain(entrypointPath);

            if (worker.type === 'typescript') {
              const typeDefPath = worker.entrypoint.replace(/\.ts$/, '.d.ts');
              const typesPath = join(testTscDir, worker.name, typeDefPath);
              expect(result.checkedFiles).toContain(typesPath);
            }

            if (worker.hasConfig && worker.configFile) {
              const configPath = join(testDistDir, worker.name, worker.configFile);
              expect(result.checkedFiles).toContain(configPath);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Property 9 (missing entrypoint): Validation detects missing worker entrypoints', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            workerName: fc.stringMatching(/^[a-z][a-z0-9-]{2,20}$/),
            workerType: fc.constantFrom('typescript', 'javascript'),
            hasConfig: fc.boolean()
          }),
          { minLength: 1, maxLength: 3 }
        ),
        fc.integer({ min: 0, max: 2 }), // Index of worker to have missing entrypoint
        async (workerSpecs, missingIndex) => {
          // Create unique worker names
          const uniqueWorkers = [];
          const seenNames = new Set();

          for (const spec of workerSpecs) {
            if (!seenNames.has(spec.workerName)) {
              seenNames.add(spec.workerName);
              uniqueWorkers.push(spec);
            }
          }

          if (uniqueWorkers.length === 0) {
            return; // Skip if no unique workers
          }

          const actualMissingIndex = missingIndex % uniqueWorkers.length;

          // Build worker metadata array
          const workers = uniqueWorkers.map(spec => ({
            name: spec.workerName,
            path: join(testTmpDir, 'workers-registry', spec.workerName),
            type: spec.workerType,
            entrypoint: spec.workerType === 'typescript' ? 'src/index.ts' : `${spec.workerName}.js`,
            hasConfig: spec.hasConfig,
            configFile: spec.hasConfig ? `${spec.workerName}-config.json` : null,
            hasTypes: spec.workerType === 'typescript'
          }));

          // Create files for all workers EXCEPT the one at missingIndex
          for (let i = 0; i < workers.length; i++) {
            const worker = workers[i];

            if (i !== actualMissingIndex) {
              // Create entrypoint
              const entrypointFilename = worker.type === 'typescript' ? 'index.js' : worker.entrypoint;
              const entrypointPath = join(testDistDir, worker.name, entrypointFilename);
              await mkdir(join(testDistDir, worker.name), { recursive: true });
              await writeFile(entrypointPath, '// Worker entrypoint\nexport default {};');
            } else {
              // Create directory but no entrypoint file
              await mkdir(join(testDistDir, worker.name), { recursive: true });
            }

            // Create type definitions for TypeScript workers
            if (worker.type === 'typescript') {
              const typeDefPath = worker.entrypoint.replace(/\.ts$/, '.d.ts');
              const typesPath = join(testTscDir, worker.name, typeDefPath);
              await mkdir(dirname(typesPath), { recursive: true });
              await writeFile(typesPath, 'export default {};\n');
            }

            // Create config file if worker has one
            if (worker.hasConfig && worker.configFile) {
              const configPath = join(testDistDir, worker.name, worker.configFile);
              await writeFile(
                configPath,
                JSON.stringify({ pools: [{ name: 'default', size: 1 }] })
              );
            }
          }

          // Run validation
          const result = await validateBuild(workers, {
            distPath: testDistDir,
            tscPath: testTscDir
          });

          // Validation should fail due to missing entrypoint
          expect(result.success).toBe(false);
          expect(result.errors.length).toBeGreaterThan(0);

          // Verify error mentions the missing entrypoint
          const missingWorker = workers[actualMissingIndex];
          const hasEntrypointError = result.errors.some(error =>
            error.includes(missingWorker.name) && error.includes('entrypoint')
          );
          expect(hasEntrypointError).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Property 9 (missing types): Validation detects missing TypeScript type definitions', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            workerName: fc.stringMatching(/^[a-z][a-z0-9-]{2,20}$/),
            hasConfig: fc.boolean()
          }),
          { minLength: 1, maxLength: 3 }
        ),
        fc.integer({ min: 0, max: 2 }), // Index of worker to have missing types
        async (workerSpecs, missingIndex) => {
          // Create unique worker names - all TypeScript workers
          const uniqueWorkers = [];
          const seenNames = new Set();

          for (const spec of workerSpecs) {
            if (!seenNames.has(spec.workerName)) {
              seenNames.add(spec.workerName);
              uniqueWorkers.push(spec);
            }
          }

          if (uniqueWorkers.length === 0) {
            return; // Skip if no unique workers
          }

          const actualMissingIndex = missingIndex % uniqueWorkers.length;

          // Build worker metadata array - all TypeScript
          const workers = uniqueWorkers.map(spec => ({
            name: spec.workerName,
            path: join(testTmpDir, 'workers-registry', spec.workerName),
            type: 'typescript',
            entrypoint: 'src/index.ts',
            hasConfig: spec.hasConfig,
            configFile: spec.hasConfig ? `${spec.workerName}-config.json` : null,
            hasTypes: true
          }));

          // Create files for all workers
          for (let i = 0; i < workers.length; i++) {
            const worker = workers[i];

            // Create entrypoint
            const entrypointPath = join(testDistDir, worker.name, 'index.js');
            await mkdir(join(testDistDir, worker.name), { recursive: true });
            await writeFile(entrypointPath, '// Worker entrypoint\nexport default {};');

            // Create type definitions EXCEPT for the one at missingIndex
            if (i !== actualMissingIndex) {
              const typeDefPath = worker.entrypoint.replace(/\.ts$/, '.d.ts');
              const typesPath = join(testTscDir, worker.name, typeDefPath);
              await mkdir(dirname(typesPath), { recursive: true });
              await writeFile(typesPath, 'export default {};\n');
            } else {
              // Create directory but no type definition file
              await mkdir(join(testTscDir, worker.name, 'src'), { recursive: true });
            }

            // Create config file if worker has one
            if (worker.hasConfig && worker.configFile) {
              const configPath = join(testDistDir, worker.name, worker.configFile);
              await writeFile(
                configPath,
                JSON.stringify({ pools: [{ name: 'default', size: 1 }] })
              );
            }
          }

          // Run validation
          const result = await validateBuild(workers, {
            distPath: testDistDir,
            tscPath: testTscDir
          });

          // Validation should fail due to missing type definitions
          expect(result.success).toBe(false);
          expect(result.errors.length).toBeGreaterThan(0);

          // Verify error mentions the missing type definitions
          const missingWorker = workers[actualMissingIndex];
          const hasTypeError = result.errors.some(error =>
            error.includes(missingWorker.name) && error.includes('type')
          );
          expect(hasTypeError).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Property 9 (missing config): Validation detects missing config files', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            workerName: fc.stringMatching(/^[a-z][a-z0-9-]{2,20}$/),
            workerType: fc.constantFrom('typescript', 'javascript')
          }),
          { minLength: 1, maxLength: 3 }
        ),
        fc.integer({ min: 0, max: 2 }), // Index of worker to have missing config
        async (workerSpecs, missingIndex) => {
          // Create unique worker names - all with config files
          const uniqueWorkers = [];
          const seenNames = new Set();

          for (const spec of workerSpecs) {
            if (!seenNames.has(spec.workerName)) {
              seenNames.add(spec.workerName);
              uniqueWorkers.push(spec);
            }
          }

          if (uniqueWorkers.length === 0) {
            return; // Skip if no unique workers
          }

          const actualMissingIndex = missingIndex % uniqueWorkers.length;

          // Build worker metadata array - all with config files
          const workers = uniqueWorkers.map(spec => ({
            name: spec.workerName,
            path: join(testTmpDir, 'workers-registry', spec.workerName),
            type: spec.workerType,
            entrypoint: spec.workerType === 'typescript' ? 'src/index.ts' : `${spec.workerName}.js`,
            hasConfig: true,
            configFile: `${spec.workerName}-config.json`,
            hasTypes: spec.workerType === 'typescript'
          }));

          // Create files for all workers
          for (let i = 0; i < workers.length; i++) {
            const worker = workers[i];

            // Create entrypoint
            const entrypointFilename = worker.type === 'typescript' ? 'index.js' : worker.entrypoint;
            const entrypointPath = join(testDistDir, worker.name, entrypointFilename);
            await mkdir(join(testDistDir, worker.name), { recursive: true });
            await writeFile(entrypointPath, '// Worker entrypoint\nexport default {};');

            // Create type definitions for TypeScript workers
            if (worker.type === 'typescript') {
              const typeDefPath = worker.entrypoint.replace(/\.ts$/, '.d.ts');
              const typesPath = join(testTscDir, worker.name, typeDefPath);
              await mkdir(dirname(typesPath), { recursive: true });
              await writeFile(typesPath, 'export default {};\n');
            }

            // Create config file EXCEPT for the one at missingIndex
            if (i !== actualMissingIndex) {
              const configPath = join(testDistDir, worker.name, worker.configFile);
              await writeFile(
                configPath,
                JSON.stringify({ pools: [{ name: 'default', size: 1 }] })
              );
            }
            // For missing config, we don't create the file
          }

          // Run validation
          const result = await validateBuild(workers, {
            distPath: testDistDir,
            tscPath: testTscDir
          });

          // Validation should fail due to missing config file
          expect(result.success).toBe(false);
          expect(result.errors.length).toBeGreaterThan(0);

          // Verify error mentions the missing config
          const missingWorker = workers[actualMissingIndex];
          const hasConfigError = result.errors.some(error =>
            error.includes(missingWorker.name) && error.includes('config')
          );
          expect(hasConfigError).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});
