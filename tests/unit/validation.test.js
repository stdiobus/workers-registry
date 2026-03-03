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
 * Unit tests for build validation
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { validateBuild } from '../../scripts/build.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const testDir = join(__dirname, '..', '..', 'test-output-validation');

describe('validateBuild', () => {
  beforeEach(async () => {
    // Create test directory structure
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up test directory
    await rm(testDir, { recursive: true, force: true });
  });

  it('should pass validation when all required files exist', async () => {
    // Setup: Create test output structure
    const distPath = join(testDir, 'dist', 'workers');
    const tscPath = join(testDir, 'tsc', 'workers');

    // Create TypeScript worker output
    await mkdir(join(distPath, 'ts-worker'), { recursive: true });
    await mkdir(join(tscPath, 'ts-worker', 'src'), { recursive: true });
    await writeFile(join(distPath, 'ts-worker', 'index.js'), '// compiled');
    await writeFile(join(tscPath, 'ts-worker', 'src', 'index.d.ts'), '// types');
    await writeFile(join(distPath, 'ts-worker', 'ts-worker-config.json'), '{}');

    // Create JavaScript worker output
    await mkdir(join(distPath, 'js-worker'), { recursive: true });
    await writeFile(join(distPath, 'js-worker', 'worker.js'), '// js worker');
    await writeFile(join(distPath, 'js-worker', 'js-worker-config.json'), '{}');

    const workers = [
      {
        name: 'ts-worker',
        type: 'typescript',
        entrypoint: 'src/index.ts',
        hasConfig: true,
        configFile: 'ts-worker-config.json'
      },
      {
        name: 'js-worker',
        type: 'javascript',
        entrypoint: 'worker.js',
        hasConfig: true,
        configFile: 'js-worker-config.json'
      }
    ];

    const result = await validateBuild(workers, { distPath, tscPath });

    expect(result.success).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.checkedFiles).toHaveLength(5); // 2 entrypoints + 1 types + 2 configs
  });

  it('should fail validation when entrypoint is missing', async () => {
    const distPath = join(testDir, 'dist', 'workers');
    const tscPath = join(testDir, 'tsc', 'workers');

    await mkdir(distPath, { recursive: true });

    const workers = [
      {
        name: 'missing-worker',
        type: 'javascript',
        entrypoint: 'worker.js',
        hasConfig: false
      }
    ];

    const result = await validateBuild(workers, { distPath, tscPath });

    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Missing entrypoint for missing-worker');
  });

  it('should fail validation when TypeScript type definitions are missing', async () => {
    const distPath = join(testDir, 'dist', 'workers');
    const tscPath = join(testDir, 'tsc', 'workers');

    // Create entrypoint but not types
    await mkdir(join(distPath, 'ts-worker'), { recursive: true });
    await writeFile(join(distPath, 'ts-worker', 'index.js'), '// compiled');

    const workers = [
      {
        name: 'ts-worker',
        type: 'typescript',
        entrypoint: 'src/index.ts',
        hasConfig: false
      }
    ];

    const result = await validateBuild(workers, { distPath, tscPath });

    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Missing type definitions for ts-worker');
  });

  it('should fail validation when config file is missing', async () => {
    const distPath = join(testDir, 'dist', 'workers');
    const tscPath = join(testDir, 'tsc', 'workers');

    // Create entrypoint but not config
    await mkdir(join(distPath, 'js-worker'), { recursive: true });
    await writeFile(join(distPath, 'js-worker', 'worker.js'), '// js worker');

    const workers = [
      {
        name: 'js-worker',
        type: 'javascript',
        entrypoint: 'worker.js',
        hasConfig: true,
        configFile: 'js-worker-config.json'
      }
    ];

    const result = await validateBuild(workers, { distPath, tscPath });

    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Missing config file for js-worker');
  });

  it('should fail validation when config is a directory instead of a file', async () => {
    const distPath = join(testDir, 'dist', 'workers');
    const tscPath = join(testDir, 'tsc', 'workers');

    // Create entrypoint and config as directory
    await mkdir(join(distPath, 'js-worker'), { recursive: true });
    await writeFile(join(distPath, 'js-worker', 'worker.js'), '// js worker');
    await mkdir(join(distPath, 'js-worker', 'js-worker-config.json'), { recursive: true });

    const workers = [
      {
        name: 'js-worker',
        type: 'javascript',
        entrypoint: 'worker.js',
        hasConfig: true,
        configFile: 'js-worker-config.json'
      }
    ];

    const result = await validateBuild(workers, { distPath, tscPath });

    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Config for js-worker is not a file');
  });

  it('should pass validation for workers without config files', async () => {
    const distPath = join(testDir, 'dist', 'workers');
    const tscPath = join(testDir, 'tsc', 'workers');

    // Create worker without config
    await mkdir(join(distPath, 'js-worker'), { recursive: true });
    await writeFile(join(distPath, 'js-worker', 'worker.js'), '// js worker');

    const workers = [
      {
        name: 'js-worker',
        type: 'javascript',
        entrypoint: 'worker.js',
        hasConfig: false,
        configFile: null
      }
    ];

    const result = await validateBuild(workers, { distPath, tscPath });

    expect(result.success).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.checkedFiles).toHaveLength(1); // Only entrypoint
  });

  it('should handle TypeScript workers with different entrypoint structures', async () => {
    const distPath = join(testDir, 'dist', 'workers');
    const tscPath = join(testDir, 'tsc', 'workers');

    // Worker with entrypoint at root level (e.g., mcp-echo-server.ts)
    await mkdir(join(distPath, 'mcp-server'), { recursive: true });
    await mkdir(join(tscPath, 'mcp-server'), { recursive: true });
    await writeFile(join(distPath, 'mcp-server', 'index.js'), '// compiled');
    await writeFile(join(tscPath, 'mcp-server', 'mcp-server.d.ts'), '// types');

    const workers = [
      {
        name: 'mcp-server',
        type: 'typescript',
        entrypoint: 'mcp-server.ts',
        hasConfig: false
      }
    ];

    const result = await validateBuild(workers, { distPath, tscPath });

    expect(result.success).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.checkedFiles).toHaveLength(2); // entrypoint + types
  });

  it('should report multiple errors when multiple files are missing', async () => {
    const distPath = join(testDir, 'dist', 'workers');
    const tscPath = join(testDir, 'tsc', 'workers');

    await mkdir(distPath, { recursive: true });

    const workers = [
      {
        name: 'worker1',
        type: 'javascript',
        entrypoint: 'worker1.js',
        hasConfig: true,
        configFile: 'worker1-config.json'
      },
      {
        name: 'worker2',
        type: 'typescript',
        entrypoint: 'src/index.ts',
        hasConfig: false
      }
    ];

    const result = await validateBuild(workers, { distPath, tscPath });

    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3); // At least 3 errors
    expect(result.errors.some(e => e.includes('worker1'))).toBe(true);
    expect(result.errors.some(e => e.includes('worker2'))).toBe(true);
  });
});
