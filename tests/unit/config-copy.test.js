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
 * Unit tests for config file copying
 * Feature: npm-package-build
 * Requirements: 1.3, 3.8
 */

import { mkdir, writeFile, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { copyWorkerConfigs } from '../../scripts/build.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const testTmpDir = join(__dirname, '..', '..', 'test-tmp-config-copy');
const testWorkerDir = join(testTmpDir, 'worker-source');
const testOutputDir = join(testTmpDir, 'worker-output');

/**
 * Setup a temporary test directory structure
 */
async function setupTestDir() {
  await rm(testTmpDir, { recursive: true, force: true });
  await mkdir(testWorkerDir, { recursive: true });
  await mkdir(testOutputDir, { recursive: true });
}

/**
 * Cleanup test directory
 */
async function cleanupTestDir() {
  await rm(testTmpDir, { recursive: true, force: true });
}

describe('Config File Copying Unit Tests', () => {
  beforeEach(async () => {
    await setupTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir();
  });

  test('should copy config file when worker has config', async () => {
    // Create a config file
    const configContent = JSON.stringify({ test: 'config' }, null, 2);
    await writeFile(join(testWorkerDir, 'test-worker-config.json'), configContent);

    // Create worker metadata
    const worker = {
      name: 'test-worker',
      path: testWorkerDir,
      type: 'typescript',
      hasConfig: true,
      configFile: 'test-worker-config.json'
    };

    // Copy config
    await copyWorkerConfigs(worker, testOutputDir);

    // Verify config was copied
    const copiedConfig = await readFile(join(testOutputDir, 'test-worker-config.json'), 'utf-8');
    expect(copiedConfig).toBe(configContent);
  });

  test('should handle worker without config gracefully', async () => {
    // Create worker metadata without config
    const worker = {
      name: 'test-worker',
      path: testWorkerDir,
      type: 'javascript',
      hasConfig: false,
      configFile: null
    };

    // Should not throw
    await expect(copyWorkerConfigs(worker, testOutputDir)).resolves.toBeUndefined();
  });

  test('should handle missing config file gracefully', async () => {
    // Create worker metadata with config that doesn't exist
    const worker = {
      name: 'test-worker',
      path: testWorkerDir,
      type: 'typescript',
      hasConfig: true,
      configFile: 'missing-config.json'
    };

    // Should not throw (logs warning instead)
    await expect(copyWorkerConfigs(worker, testOutputDir)).resolves.toBeUndefined();
  });

  test('should handle config that is a directory gracefully', async () => {
    // Create a directory with the config name
    await mkdir(join(testWorkerDir, 'test-worker-config.json'), { recursive: true });

    // Create worker metadata
    const worker = {
      name: 'test-worker',
      path: testWorkerDir,
      type: 'typescript',
      hasConfig: true,
      configFile: 'test-worker-config.json'
    };

    // Should not throw (logs warning instead)
    await expect(copyWorkerConfigs(worker, testOutputDir)).resolves.toBeUndefined();
  });

  test('should copy multiple config files for different workers', async () => {
    // Create two config files
    const config1 = JSON.stringify({ worker: 'one' }, null, 2);
    const config2 = JSON.stringify({ worker: 'two' }, null, 2);

    await writeFile(join(testWorkerDir, 'worker1-config.json'), config1);
    await writeFile(join(testWorkerDir, 'worker2-config.json'), config2);

    // Create worker metadata for first worker
    const worker1 = {
      name: 'worker1',
      path: testWorkerDir,
      type: 'typescript',
      hasConfig: true,
      configFile: 'worker1-config.json'
    };

    // Create worker metadata for second worker
    const worker2 = {
      name: 'worker2',
      path: testWorkerDir,
      type: 'javascript',
      hasConfig: true,
      configFile: 'worker2-config.json'
    };

    // Copy configs
    await copyWorkerConfigs(worker1, testOutputDir);
    await copyWorkerConfigs(worker2, testOutputDir);

    // Verify both configs were copied
    const copiedConfig1 = await readFile(join(testOutputDir, 'worker1-config.json'), 'utf-8');
    const copiedConfig2 = await readFile(join(testOutputDir, 'worker2-config.json'), 'utf-8');

    expect(copiedConfig1).toBe(config1);
    expect(copiedConfig2).toBe(config2);
  });
});
