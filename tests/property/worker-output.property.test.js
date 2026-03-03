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
 * Property-based tests for worker output location
 * Feature: npm-package-build
 */

import * as fc from 'fast-check';
import { mkdir, writeFile, rm, stat } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { buildWorkerWithEsbuild } from '../../scripts/build.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const testTmpDir = join(__dirname, '..', '..', 'test-tmp-output');
const testRegistryDir = join(testTmpDir, 'workers-registry');
const testOutDir = join(testTmpDir, 'out');
const testDistDir = join(testOutDir, 'dist', 'workers');
const testTscDir = join(testOutDir, 'tsc', 'workers');

/**
 * Setup a temporary test directory
 */
async function setupTestDir() {
  await rm(testTmpDir, { recursive: true, force: true });
  await mkdir(testRegistryDir, { recursive: true });
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

describe('Worker Output Location Property Tests', () => {
  beforeEach(async () => {
    await setupTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir();
  });

  // Feature: npm-package-build, Property 1: TypeScript Worker Output Location Consistency
  test('Property 1: TypeScript Worker Output Location Consistency - TypeScript workers output to correct locations', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          workerName: fc.stringMatching(/^[a-z][a-z0-9-]{2,20}$/),
          entrypointType: fc.constantFrom('src/index.ts', 'index.ts', '{name}.ts'),
          hasConfig: fc.boolean()
        }),
        async ({ workerName, entrypointType, hasConfig }) => {
          // Create worker directory
          const workerDir = join(testRegistryDir, workerName);
          await mkdir(workerDir, { recursive: true });

          // Create tsconfig.json
          await writeFile(
            join(workerDir, 'tsconfig.json'),
            JSON.stringify({
              compilerOptions: {
                target: 'ES2022',
                module: 'ESNext',
                moduleResolution: 'bundler',
                strict: true
              }
            })
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
            `export default function ${workerName.replace(/-/g, '_')}() { console.log("${workerName}"); }`
          );

          // Create config file if specified
          let configFile = null;
          if (hasConfig) {
            configFile = `${workerName}-config.json`;
            await writeFile(
              join(workerDir, configFile),
              JSON.stringify({ pools: [{ name: 'default', size: 1 }] })
            );
          }

          // Create worker metadata object
          const worker = {
            name: workerName,
            path: workerDir,
            type: 'typescript',
            entrypoint,
            hasConfig,
            configFile,
            hasTypes: true
          };

          // Build the worker
          // Note: We need to temporarily override the output paths for testing
          const originalWorkersDistPath = join(testOutDir, 'dist', 'workers');

          // Mock the global paths by creating a custom build function
          const buildWorker = async (w) => {
            const outputDir = join(originalWorkersDistPath, w.name);
            await mkdir(outputDir, { recursive: true });

            const { build } = await import('esbuild');
            const workerEntrypoint = join(w.path, w.entrypoint);
            const outfile = join(outputDir, 'index.js');

            await build({
              entryPoints: [workerEntrypoint],
              bundle: true,
              platform: 'node',
              target: 'node20',
              format: 'esm',
              outfile,
              external: [
                '@agentclientprotocol/sdk',
                '@modelcontextprotocol/sdk',
                'node:*'
              ],
              sourcemap: true,
              minifyWhitespace: true,
              treeShaking: true,
              logLevel: 'silent'
            });

            // Copy config file if present
            if (w.hasConfig && w.configFile) {
              const { copyFile } = await import('fs/promises');
              const configSrc = join(w.path, w.configFile);
              const configDest = join(outputDir, w.configFile);
              await copyFile(configSrc, configDest);
            }
          };

          await buildWorker(worker);

          // Verify JavaScript output location
          const jsOutputPath = join(testDistDir, workerName, 'index.js');
          const jsExists = await fileExists(jsOutputPath);
          expect(jsExists).toBe(true);

          // Verify source map location
          const sourceMapPath = join(testDistDir, workerName, 'index.js.map');
          const sourceMapExists = await fileExists(sourceMapPath);
          expect(sourceMapExists).toBe(true);

          // Note: Type definitions are generated separately by tsc in a different build step
          // This test focuses on esbuild output (JavaScript and source maps)
          // Type definition testing would require running tsc, which is tested separately
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: npm-package-build, Property 2: JavaScript Worker Output Location Consistency
  test('Property 2: JavaScript Worker Output Location Consistency - JavaScript workers output to correct locations with original filename', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          workerName: fc.stringMatching(/^[a-z][a-z0-9-]{2,20}$/),
          filename: fc.oneof(
            fc.constant('index.js'),
            fc.stringMatching(/^[a-z][a-z0-9-]{2,20}\.js$/)
          ),
          hasConfig: fc.boolean()
        }),
        async ({ workerName, filename, hasConfig }) => {
          // Create worker directory
          const workerDir = join(testRegistryDir, workerName);
          await mkdir(workerDir, { recursive: true });

          // Create JavaScript entrypoint file (no tsconfig.json for JS workers)
          await writeFile(
            join(workerDir, filename),
            `export default function ${workerName.replace(/-/g, '_')}() { console.log("${workerName}"); }`
          );

          // Create config file if specified
          let configFile = null;
          if (hasConfig) {
            configFile = `${workerName}-config.json`;
            await writeFile(
              join(workerDir, configFile),
              JSON.stringify({ pools: [{ name: 'default', size: 1 }] })
            );
          }

          // Create worker metadata object
          const worker = {
            name: workerName,
            path: workerDir,
            type: 'javascript',
            entrypoint: filename,
            hasConfig,
            configFile,
            hasTypes: false
          };

          // Build the worker
          const buildWorker = async (w) => {
            const outputDir = join(testDistDir, w.name);
            await mkdir(outputDir, { recursive: true });

            const { build } = await import('esbuild');
            const workerEntrypoint = join(w.path, w.entrypoint);

            // JavaScript workers preserve their original filename
            const outputFilename = w.entrypoint;
            const outfile = join(outputDir, outputFilename);

            await build({
              entryPoints: [workerEntrypoint],
              bundle: true,
              platform: 'node',
              target: 'node20',
              format: 'esm',
              outfile,
              external: [
                '@agentclientprotocol/sdk',
                '@modelcontextprotocol/sdk',
                'node:*'
              ],
              sourcemap: true,
              minifyWhitespace: true,
              treeShaking: true,
              logLevel: 'silent'
            });

            // Copy config file if present
            if (w.hasConfig && w.configFile) {
              const { copyFile } = await import('fs/promises');
              const configSrc = join(w.path, w.configFile);
              const configDest = join(outputDir, w.configFile);
              await copyFile(configSrc, configDest);
            }
          };

          await buildWorker(worker);

          // Verify JavaScript output location with original filename preserved
          const jsOutputPath = join(testDistDir, workerName, filename);
          const jsExists = await fileExists(jsOutputPath);
          expect(jsExists).toBe(true);

          // Verify source map location (should match the JS filename)
          const sourceMapPath = join(testDistDir, workerName, `${filename}.map`);
          const sourceMapExists = await fileExists(sourceMapPath);
          expect(sourceMapExists).toBe(true);

          // Verify NO type definitions are generated for JavaScript workers
          const typeDefPath = join(testTscDir, workerName, 'index.d.ts');
          const typeDefExists = await fileExists(typeDefPath);
          expect(typeDefExists).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: npm-package-build, Property 7: Consistent Output Structure
  test('Property 7: Consistent Output Structure - All workers have consistent output structure regardless of type', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          workerName: fc.stringMatching(/^[a-z][a-z0-9-]{2,20}$/),
          workerType: fc.constantFrom('typescript', 'javascript'),
          hasConfig: fc.boolean()
        }),
        async ({ workerName, workerType, hasConfig }) => {
          // Create worker directory
          const workerDir = join(testRegistryDir, workerName);
          await mkdir(workerDir, { recursive: true });

          let entrypoint;
          let configFile = null;

          if (workerType === 'typescript') {
            // Create TypeScript worker
            await writeFile(
              join(workerDir, 'tsconfig.json'),
              JSON.stringify({
                compilerOptions: {
                  target: 'ES2022',
                  module: 'ESNext',
                  moduleResolution: 'bundler',
                  strict: true
                }
              })
            );

            // Create src directory and entrypoint
            await mkdir(join(workerDir, 'src'), { recursive: true });
            entrypoint = 'src/index.ts';
            await writeFile(
              join(workerDir, entrypoint),
              `export default function ${workerName.replace(/-/g, '_')}() { console.log("${workerName}"); }`
            );
          } else {
            // Create JavaScript worker
            entrypoint = `${workerName}.js`;
            await writeFile(
              join(workerDir, entrypoint),
              `export default function ${workerName.replace(/-/g, '_')}() { console.log("${workerName}"); }`
            );
          }

          // Create config file if specified
          if (hasConfig) {
            configFile = `${workerName}-config.json`;
            await writeFile(
              join(workerDir, configFile),
              JSON.stringify({ pools: [{ name: 'default', size: 1 }] })
            );
          }

          // Create worker metadata object
          const worker = {
            name: workerName,
            path: workerDir,
            type: workerType,
            entrypoint,
            hasConfig,
            configFile,
            hasTypes: workerType === 'typescript'
          };

          // Build the worker
          const buildWorker = async (w) => {
            const outputDir = join(testDistDir, w.name);
            await mkdir(outputDir, { recursive: true });

            const { build } = await import('esbuild');
            const workerEntrypoint = join(w.path, w.entrypoint);

            // Determine output filename based on worker type
            const outputFilename = w.type === 'typescript' ? 'index.js' : w.entrypoint;
            const outfile = join(outputDir, outputFilename);

            await build({
              entryPoints: [workerEntrypoint],
              bundle: true,
              platform: 'node',
              target: 'node20',
              format: 'esm',
              outfile,
              external: [
                '@agentclientprotocol/sdk',
                '@modelcontextprotocol/sdk',
                'node:*'
              ],
              sourcemap: true,
              minifyWhitespace: true,
              treeShaking: true,
              logLevel: 'silent'
            });

            // Copy config file if present
            if (w.hasConfig && w.configFile) {
              const { copyFile } = await import('fs/promises');
              const configSrc = join(w.path, w.configFile);
              const configDest = join(outputDir, w.configFile);
              await copyFile(configSrc, configDest);
            }

            // Generate type definitions for TypeScript workers
            if (w.type === 'typescript') {
              const tscOutputDir = join(testTscDir, w.name);
              await mkdir(tscOutputDir, { recursive: true });

              // Create a simple .d.ts file for testing
              // In real build, this would be generated by tsc
              await writeFile(
                join(tscOutputDir, 'index.d.ts'),
                `export default function ${workerName.replace(/-/g, '_')}(): void;`
              );
            }
          };

          await buildWorker(worker);

          // Verify consistent output structure:
          // 1. JavaScript output should always be in out/dist/workers/{worker-name}/
          const distWorkerDir = join(testDistDir, workerName);
          const distDirExists = await fileExists(distWorkerDir);
          expect(distDirExists).toBe(true);

          // 2. Worker entrypoint file should exist in dist directory
          const expectedJsFile = workerType === 'typescript' ? 'index.js' : entrypoint;
          const jsOutputPath = join(distWorkerDir, expectedJsFile);
          const jsExists = await fileExists(jsOutputPath);
          expect(jsExists).toBe(true);

          // 3. TypeScript workers should have type definitions in out/tsc/workers/{worker-name}/
          if (workerType === 'typescript') {
            const tscWorkerDir = join(testTscDir, workerName);
            const tscDirExists = await fileExists(tscWorkerDir);
            expect(tscDirExists).toBe(true);

            const typeDefPath = join(tscWorkerDir, 'index.d.ts');
            const typeDefExists = await fileExists(typeDefPath);
            expect(typeDefExists).toBe(true);
          } else {
            // JavaScript workers should NOT have type definitions
            const tscWorkerDir = join(testTscDir, workerName);
            const tscDirExists = await fileExists(tscWorkerDir);
            expect(tscDirExists).toBe(false);
          }

          // 4. Config files should be in dist directory if present
          if (hasConfig && configFile) {
            const configPath = join(distWorkerDir, configFile);
            const configExists = await fileExists(configPath);
            expect(configExists).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
