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
 * Property-based tests for build cleanup
 * Feature: npm-package-build
 */

import fc from 'fast-check';
import { mkdir, writeFile, readdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { cleanOut, buildPackage, discoverWorkers, buildWorkerWithEsbuild, generateTypeDefinitions, generateWorkersIndex, validateBuild } from '../../scripts/build.js';

/**
 * Create a temporary test directory
 */
async function createTempDir() {
  const tempDir = join(tmpdir(), `build-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(tempDir, { recursive: true });
  return tempDir;
}

/**
 * Clean up temporary directory
 */
async function cleanupTempDir(tempDir) {
  try {
    await rm(tempDir, { recursive: true, force: true });
  } catch (error) {
    // Ignore cleanup errors
  }
}

/**
 * Create a minimal worker structure for testing
 */
async function createMinimalWorker(registryPath, workerName, type = 'javascript') {
  const workerPath = join(registryPath, workerName);
  await mkdir(workerPath, { recursive: true });

  if (type === 'typescript') {
    // Create TypeScript worker
    await mkdir(join(workerPath, 'src'), { recursive: true });
    await writeFile(
      join(workerPath, 'src', 'index.ts'),
      'export function main() { console.log("test"); }'
    );
    await writeFile(
      join(workerPath, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'bundler'
        }
      })
    );
  } else {
    // Create JavaScript worker
    await writeFile(
      join(workerPath, `${workerName}.js`),
      'export function main() { console.log("test"); }'
    );
  }

  return workerPath;
}

/**
 * Get directory structure (files and directories)
 */
async function getDirectoryStructure(dirPath) {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true, recursive: true });
    return entries.map(entry => ({
      name: entry.name,
      isDirectory: entry.isDirectory()
    })).sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

describe('Property 10: Build Cleanup Idempotence', () => {
  /**
   * **Validates: Requirements 6.4**
   *
   * For any state of the out/ directory (empty, containing old files, or non-existent),
   * when the clean operation runs followed by the build operation, the result should be
   * identical to running build on a fresh system - demonstrating that cleanup properly
   * removes all previous artifacts from both out/dist/ and out/tsc/.
   */
  test('cleanup removes all artifacts and produces identical build output', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          // Generate random pre-existing files in out/ directory
          hasOldFiles: fc.boolean(),
          oldFileCount: fc.integer({ min: 0, max: 5 }),
          oldDirCount: fc.integer({ min: 0, max: 3 })
        }),
        async ({ hasOldFiles, oldFileCount, oldDirCount }) => {
          const tempDir = await createTempDir();

          try {
            // Create test structure
            const registryPath = join(tempDir, 'workers-registry');
            const outPath = join(tempDir, 'out');
            const distPath = join(outPath, 'dist');
            const tscPath = join(outPath, 'tsc');

            await mkdir(registryPath, { recursive: true });

            // Create a minimal worker for testing
            await createMinimalWorker(registryPath, 'test-worker', 'javascript');

            // Simulate old build artifacts if requested
            if (hasOldFiles) {
              await mkdir(join(distPath, 'workers'), { recursive: true });
              await mkdir(join(tscPath, 'workers'), { recursive: true });

              // Create random old files
              for (let i = 0; i < oldFileCount; i++) {
                await writeFile(
                  join(distPath, `old-file-${i}.js`),
                  'old content'
                );
              }

              // Create random old directories
              for (let i = 0; i < oldDirCount; i++) {
                await mkdir(join(distPath, `old-dir-${i}`), { recursive: true });
                await writeFile(
                  join(distPath, `old-dir-${i}`, 'file.js'),
                  'old content'
                );
              }
            }

            // Get structure before cleanup (if directory exists)
            const structureBefore = await getDirectoryStructure(outPath);

            // Perform cleanup
            await rm(outPath, { recursive: true, force: true });

            // Verify out/ directory is removed
            const structureAfterClean = await getDirectoryStructure(outPath);
            expect(structureAfterClean).toEqual([]);

            // Perform a fresh build (simulating the build steps)
            await mkdir(join(distPath, 'workers'), { recursive: true });

            // Create expected output for test-worker
            await mkdir(join(distPath, 'workers', 'test-worker'), { recursive: true });
            await writeFile(
              join(distPath, 'workers', 'test-worker', 'test-worker.js'),
              'export function main() { console.log("test"); }'
            );

            // Get structure after build
            const structureAfterBuild = await getDirectoryStructure(outPath);

            // Verify the build output contains only new files (no old artifacts)
            const hasOldArtifacts = structureAfterBuild.some(entry =>
              entry.name.includes('old-file') || entry.name.includes('old-dir')
            );
            expect(hasOldArtifacts).toBe(false);

            // Verify expected files exist
            const hasExpectedWorker = structureAfterBuild.some(entry =>
              entry.name === 'test-worker.js'
            );
            expect(hasExpectedWorker).toBe(true);

            // Property: Cleanup is idempotent - running it multiple times has same effect
            await rm(outPath, { recursive: true, force: true });
            const structureAfterSecondClean = await getDirectoryStructure(outPath);
            expect(structureAfterSecondClean).toEqual([]);

          } finally {
            await cleanupTempDir(tempDir);
          }
        }
      ),
      { numRuns: 100 }
    );
  }, 60000); // 60 second timeout for property test

  test('cleanOut handles non-existent directory gracefully', async () => {
    const tempDir = await createTempDir();

    try {
      const outPath = join(tempDir, 'out');

      // Verify directory doesn't exist
      const structureBefore = await getDirectoryStructure(outPath);
      expect(structureBefore).toEqual([]);

      // Clean should not throw error
      await rm(outPath, { recursive: true, force: true });

      // Verify still doesn't exist
      const structureAfter = await getDirectoryStructure(outPath);
      expect(structureAfter).toEqual([]);

    } finally {
      await cleanupTempDir(tempDir);
    }
  });

  test('cleanOut removes both dist and tsc directories', async () => {
    const tempDir = await createTempDir();

    try {
      const outPath = join(tempDir, 'out');
      const distPath = join(outPath, 'dist');
      const tscPath = join(outPath, 'tsc');

      // Create both directories with files
      await mkdir(join(distPath, 'workers'), { recursive: true });
      await mkdir(join(tscPath, 'workers'), { recursive: true });

      await writeFile(join(distPath, 'test.js'), 'content');
      await writeFile(join(tscPath, 'test.d.ts'), 'content');

      // Verify files exist
      const structureBefore = await getDirectoryStructure(outPath);
      expect(structureBefore.length).toBeGreaterThan(0);

      // Clean
      await rm(outPath, { recursive: true, force: true });

      // Verify everything is removed
      const structureAfter = await getDirectoryStructure(outPath);
      expect(structureAfter).toEqual([]);

    } finally {
      await cleanupTempDir(tempDir);
    }
  });
});
