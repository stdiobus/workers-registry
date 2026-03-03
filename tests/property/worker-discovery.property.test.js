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
 * Property-based tests for worker discovery
 * Feature: npm-package-build
 */

import * as fc from 'fast-check';
import { mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { discoverWorkers, analyzeWorker } from '../../scripts/build.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const testTmpDir = join(__dirname, '..', '..', 'test-tmp');

/**
 * Setup a temporary test directory
 */
async function setupTestDir() {
  await rm(testTmpDir, { recursive: true, force: true });
  await mkdir(testTmpDir, { recursive: true });
  return testTmpDir;
}

/**
 * Cleanup test directory
 */
async function cleanupTestDir() {
  await rm(testTmpDir, { recursive: true, force: true });
}

describe('Worker Discovery Property Tests', () => {
  beforeEach(async () => {
    await setupTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir();
  });

  // Feature: npm-package-build, Property 4: Automatic Worker Discovery
  test('Property 4: Automatic Worker Discovery - TypeScript workers with tsconfig.json are discovered', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          workerName: fc.stringMatching(/^[a-z][a-z0-9-]{2,20}$/),
          hasEntrypoint: fc.boolean(),
          entrypointType: fc.constantFrom('src/index.ts', 'index.ts', '{name}.ts')
        }),
        async ({ workerName, hasEntrypoint, entrypointType }) => {
          // Create worker directory
          const workerDir = join(testTmpDir, workerName);
          await mkdir(workerDir, { recursive: true });

          // Create tsconfig.json
          await writeFile(
            join(workerDir, 'tsconfig.json'),
            JSON.stringify({ compilerOptions: { target: 'ES2022' } })
          );

          // Create entrypoint if specified
          if (hasEntrypoint) {
            const entrypoint = entrypointType === '{name}.ts'
              ? `${workerName}.ts`
              : entrypointType;

            if (entrypoint.includes('/')) {
              await mkdir(join(workerDir, dirname(entrypoint)), { recursive: true });
            }

            await writeFile(
              join(workerDir, entrypoint),
              'export default function() { console.log("worker"); }'
            );
          }

          // Analyze the worker
          if (hasEntrypoint) {
            const worker = await analyzeWorker(workerName, workerDir);

            // Worker should be discovered and classified as TypeScript
            expect(worker).not.toBeNull();
            expect(worker.type).toBe('typescript');
            expect(worker.name).toBe(workerName);
            expect(worker.hasTypes).toBe(true);
          } else {
            // Should throw error for missing entrypoint
            await expect(analyzeWorker(workerName, workerDir)).rejects.toThrow();
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: npm-package-build, Property 4: Automatic Worker Discovery
  test('Property 4: Automatic Worker Discovery - JavaScript workers with .js files are discovered', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          workerName: fc.stringMatching(/^[a-z][a-z0-9-]{2,20}$/),
          entrypointType: fc.constantFrom('index.js', '{name}.js', 'worker.js')
        }),
        async ({ workerName, entrypointType }) => {
          // Create worker directory
          const workerDir = join(testTmpDir, workerName);
          await mkdir(workerDir, { recursive: true });

          // Create JavaScript entrypoint
          const entrypoint = entrypointType === '{name}.js'
            ? `${workerName}.js`
            : entrypointType;

          await writeFile(
            join(workerDir, entrypoint),
            'export default function() { console.log("worker"); }'
          );

          // Analyze the worker
          const worker = await analyzeWorker(workerName, workerDir);

          // Worker should be discovered and classified as JavaScript
          expect(worker).not.toBeNull();
          expect(worker.type).toBe('javascript');
          expect(worker.name).toBe(workerName);
          expect(worker.hasTypes).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: npm-package-build, Property 4: Automatic Worker Discovery
  test('Property 4: Automatic Worker Discovery - Workers without valid entrypoints are not discovered', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.stringMatching(/^[a-z][a-z0-9-]{2,20}$/),
        async (workerName) => {
          // Create worker directory with no valid files
          const workerDir = join(testTmpDir, workerName);
          await mkdir(workerDir, { recursive: true });

          // Create some non-entrypoint files
          await writeFile(join(workerDir, 'README.md'), '# Worker');
          await writeFile(join(workerDir, 'config.json'), '{}');

          // Analyze the worker
          const worker = await analyzeWorker(workerName, workerDir);

          // Worker should not be discovered (returns null)
          expect(worker).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: npm-package-build, Property 5: TypeScript Worker Type Detection
  test('Property 5: TypeScript Worker Type Detection - Directories with tsconfig.json are classified as typescript', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          workerName: fc.stringMatching(/^[a-z][a-z0-9-]{2,20}$/),
          entrypointType: fc.constantFrom('src/index.ts', 'index.ts', '{name}.ts'),
          tsconfigContent: fc.record({
            compilerOptions: fc.record({
              target: fc.constantFrom('ES2022', 'ES2020', 'ESNext'),
              module: fc.constantFrom('ESNext', 'CommonJS', 'NodeNext'),
              strict: fc.boolean()
            })
          })
        }),
        async ({ workerName, entrypointType, tsconfigContent }) => {
          // Create worker directory
          const workerDir = join(testTmpDir, workerName);
          await mkdir(workerDir, { recursive: true });

          // Create tsconfig.json with random valid content
          await writeFile(
            join(workerDir, 'tsconfig.json'),
            JSON.stringify(tsconfigContent, null, 2)
          );

          // Create entrypoint file
          const entrypoint = entrypointType === '{name}.ts'
            ? `${workerName}.ts`
            : entrypointType;

          if (entrypoint.includes('/')) {
            await mkdir(join(workerDir, dirname(entrypoint)), { recursive: true });
          }

          await writeFile(
            join(workerDir, entrypoint),
            'export default function() { console.log("worker"); }'
          );

          // Analyze the worker
          const worker = await analyzeWorker(workerName, workerDir);

          // Worker should be classified as TypeScript
          expect(worker).not.toBeNull();
          expect(worker.type).toBe('typescript');
          expect(worker.hasTypes).toBe(true);
          expect(worker.name).toBe(workerName);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: npm-package-build, Property 6: JavaScript Worker Type Detection
  test('Property 6: JavaScript Worker Type Detection - Directories with .js files but no tsconfig.json are classified as javascript', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          workerName: fc.stringMatching(/^[a-z][a-z0-9-]{2,20}$/),
          entrypointType: fc.constantFrom('index.js', '{name}.js', 'worker.js'),
          additionalJsFiles: fc.array(
            fc.stringMatching(/^[a-z][a-z0-9-]{1,15}\.js$/),
            { maxLength: 3 }
          )
        }),
        async ({ workerName, entrypointType, additionalJsFiles }) => {
          // Create worker directory
          const workerDir = join(testTmpDir, workerName);
          await mkdir(workerDir, { recursive: true });

          // Create JavaScript entrypoint (NO tsconfig.json)
          const entrypoint = entrypointType === '{name}.js'
            ? `${workerName}.js`
            : entrypointType;

          await writeFile(
            join(workerDir, entrypoint),
            'export default function() { console.log("worker"); }'
          );

          // Create additional JavaScript files to test discovery
          for (const jsFile of additionalJsFiles) {
            // Avoid duplicate filenames
            if (jsFile !== entrypoint) {
              await writeFile(
                join(workerDir, jsFile),
                'export function helper() { return true; }'
              );
            }
          }

          // Analyze the worker
          const worker = await analyzeWorker(workerName, workerDir);

          // Worker should be classified as JavaScript
          expect(worker).not.toBeNull();
          expect(worker.type).toBe('javascript');
          expect(worker.hasTypes).toBe(false);
          expect(worker.name).toBe(workerName);
          expect(worker.entrypoint).toBeTruthy();
          expect(worker.entrypoint).toMatch(/\.js$/);
        }
      ),
      { numRuns: 100 }
    );
  });
});
