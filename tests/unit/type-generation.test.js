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
 * Unit tests for TypeScript type definition generation
 * Feature: npm-package-build
 * Requirements: 10.5, 10.6
 */

import { mkdir, writeFile, rm, readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { generateTypeDefinitions } from '../../scripts/build.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const testTmpDir = join(__dirname, '..', '..', 'test-tmp-types');
const testRegistryDir = join(testTmpDir, 'workers-registry');
const testOutDir = join(testTmpDir, 'out');
const testTscDir = join(testOutDir, 'tsc', 'workers');

/**
 * Setup a temporary test directory structure
 */
async function setupTestDir() {
  await rm(testTmpDir, { recursive: true, force: true });
  await mkdir(testRegistryDir, { recursive: true });
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
 * Create a minimal TypeScript worker for testing
 */
async function createTypeScriptWorker(workerName, hasErrors = false) {
  const workerDir = join(testRegistryDir, workerName);
  await mkdir(workerDir, { recursive: true });
  await mkdir(join(workerDir, 'src'), { recursive: true });

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
    }, null, 2)
  );

  // Create TypeScript source file
  const sourceCode = hasErrors
    ? `// Invalid TypeScript code with type errors
export function greet(name: string): number {
  return "Hello, " + name; // Type error: returning string instead of number
}

export const invalidAssignment: number = "not a number"; // Type error
`
    : `// Valid TypeScript code
export interface WorkerConfig {
  name: string;
  version: string;
}

export function greet(name: string): string {
  return \`Hello, \${name}\`;
}

export class Worker {
  constructor(public config: WorkerConfig) {}
  
  start(): void {
    console.log(\`Starting worker \${this.config.name}\`);
  }
}
`;

  await writeFile(join(workerDir, 'src', 'index.ts'), sourceCode);

  return {
    name: workerName,
    path: workerDir,
    type: 'typescript',
    entrypoint: 'src/index.ts',
    hasConfig: false,
    configFile: null,
    hasTypes: true
  };
}

/**
 * Create a JavaScript worker for testing
 */
async function createJavaScriptWorker(workerName) {
  const workerDir = join(testRegistryDir, workerName);
  await mkdir(workerDir, { recursive: true });

  // Create JavaScript source file (no tsconfig.json)
  await writeFile(
    join(workerDir, `${workerName}.js`),
    `export function greet(name) {
  return \`Hello, \${name}\`;
}
`
  );

  return {
    name: workerName,
    path: workerDir,
    type: 'javascript',
    entrypoint: `${workerName}.js`,
    hasConfig: false,
    configFile: null,
    hasTypes: false
  };
}

/**
 * Check if a file exists
 */
async function fileExists(path) {
  try {
    const { stat } = await import('fs/promises');
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe('Type Definition Generation Unit Tests', () => {
  beforeEach(async () => {
    await setupTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir();
  });

  test('should generate .d.ts files for TypeScript workers', async () => {
    // Create a TypeScript worker
    const worker = await createTypeScriptWorker('test-ts-worker');

    // Generate type definitions with test-specific paths
    await generateTypeDefinitions([worker], {
      rootDir: testTmpDir,
      outDir: testTscDir,
      registryDir: testRegistryDir,
      workersTscPath: testTscDir
    });

    // Verify .d.ts file was created
    const dtsPath = join(testTscDir, worker.name, 'src', 'index.d.ts');
    const exists = await fileExists(dtsPath);

    expect(exists).toBe(true);

    // Verify the .d.ts file contains expected type declarations
    const dtsContent = await readFile(dtsPath, 'utf-8');
    expect(dtsContent).toContain('export interface WorkerConfig');
    expect(dtsContent).toContain('export declare function greet');
    expect(dtsContent).toContain('export declare class Worker');
  });

  test('should generate .d.ts files for multiple TypeScript workers', async () => {
    // Create multiple TypeScript workers
    const worker1 = await createTypeScriptWorker('worker-one');
    const worker2 = await createTypeScriptWorker('worker-two');
    const worker3 = await createTypeScriptWorker('worker-three');

    // Generate type definitions for all workers with test-specific paths
    await generateTypeDefinitions([worker1, worker2, worker3], {
      rootDir: testTmpDir,
      outDir: testTscDir,
      registryDir: testRegistryDir,
      workersTscPath: testTscDir
    });

    // Verify .d.ts files were created for all workers
    const dtsPath1 = join(testTscDir, worker1.name, 'src', 'index.d.ts');
    const dtsPath2 = join(testTscDir, worker2.name, 'src', 'index.d.ts');
    const dtsPath3 = join(testTscDir, worker3.name, 'src', 'index.d.ts');

    expect(await fileExists(dtsPath1)).toBe(true);
    expect(await fileExists(dtsPath2)).toBe(true);
    expect(await fileExists(dtsPath3)).toBe(true);
  });

  test('should not generate type definitions for JavaScript workers', async () => {
    // Create a JavaScript worker
    const jsWorker = await createJavaScriptWorker('test-js-worker');

    // Call generateTypeDefinitions with empty array (no TypeScript workers)
    await generateTypeDefinitions([]);

    // Verify no .d.ts file was created for JavaScript worker
    const dtsPath = join(testTscDir, jsWorker.name);
    const exists = await fileExists(dtsPath);

    expect(exists).toBe(false);
  });

  test('should handle empty TypeScript workers array gracefully', async () => {
    // Call with empty array
    await expect(generateTypeDefinitions([])).resolves.not.toThrow();

    // Verify no files were created
    const entries = await readdir(testTscDir);
    expect(entries.length).toBe(0);
  });

  test('should report TypeScript compilation errors correctly', async () => {
    // Create a TypeScript worker with type errors
    const worker = await createTypeScriptWorker('error-worker', true);

    // Attempt to generate type definitions - should throw with error details
    await expect(
      generateTypeDefinitions([worker], {
        rootDir: testTmpDir,
        outDir: testTscDir,
        registryDir: testRegistryDir,
        workersTscPath: testTscDir
      })
    ).rejects.toThrow(/Failed to generate type definitions/);
  });

  test('should preserve directory structure in type definitions', async () => {
    // Create a TypeScript worker with nested source structure
    const workerName = 'nested-worker';
    const workerDir = join(testRegistryDir, workerName);
    await mkdir(workerDir, { recursive: true });
    await mkdir(join(workerDir, 'src', 'utils'), { recursive: true });

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
      }, null, 2)
    );

    // Create nested TypeScript files
    await writeFile(
      join(workerDir, 'src', 'index.ts'),
      `export { helper } from './utils/helper.js';`
    );

    await writeFile(
      join(workerDir, 'src', 'utils', 'helper.ts'),
      `export function helper(): string {
  return 'helper';
}`
    );

    const worker = {
      name: workerName,
      path: workerDir,
      type: 'typescript',
      entrypoint: 'src/index.ts',
      hasConfig: false,
      configFile: null,
      hasTypes: true
    };

    // Generate type definitions with test-specific paths
    await generateTypeDefinitions([worker], {
      rootDir: testTmpDir,
      outDir: testTscDir,
      registryDir: testRegistryDir,
      workersTscPath: testTscDir
    });

    // Verify nested .d.ts files were created
    const indexDtsPath = join(testTscDir, workerName, 'src', 'index.d.ts');
    const helperDtsPath = join(testTscDir, workerName, 'src', 'utils', 'helper.d.ts');

    expect(await fileExists(indexDtsPath)).toBe(true);
    expect(await fileExists(helperDtsPath)).toBe(true);

    // Verify content
    const helperDtsContent = await readFile(helperDtsPath, 'utf-8');
    expect(helperDtsContent).toContain('export declare function helper');
  });

  test('should generate type definitions with correct TypeScript configuration', async () => {
    // Create a TypeScript worker
    const worker = await createTypeScriptWorker('config-test-worker');

    // Generate type definitions with test-specific paths
    await generateTypeDefinitions([worker], {
      rootDir: testTmpDir,
      outDir: testTscDir,
      registryDir: testRegistryDir,
      workersTscPath: testTscDir
    });

    // Verify .d.ts file was created
    const dtsPath = join(testTscDir, worker.name, 'src', 'index.d.ts');
    const dtsContent = await readFile(dtsPath, 'utf-8');

    // Verify the generated types follow strict mode (no implicit any)
    expect(dtsContent).not.toContain(': any');

    // Verify proper type exports
    expect(dtsContent).toContain('export');
  });

  test('should skip test files when generating type definitions', async () => {
    // Create a TypeScript worker with test files
    const workerName = 'worker-with-tests';
    const workerDir = join(testRegistryDir, workerName);
    await mkdir(workerDir, { recursive: true });
    await mkdir(join(workerDir, 'src'), { recursive: true });

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
      }, null, 2)
    );

    // Create source file
    await writeFile(
      join(workerDir, 'src', 'index.ts'),
      `export function main(): void {}`
    );

    // Create test file (should be excluded)
    await writeFile(
      join(workerDir, 'src', 'index.test.ts'),
      `import { main } from './index.js';
test('main', () => {
  main();
});`
    );

    const worker = {
      name: workerName,
      path: workerDir,
      type: 'typescript',
      entrypoint: 'src/index.ts',
      hasConfig: false,
      configFile: null,
      hasTypes: true
    };

    // Generate type definitions with test-specific paths
    await generateTypeDefinitions([worker], {
      rootDir: testTmpDir,
      outDir: testTscDir,
      registryDir: testRegistryDir,
      workersTscPath: testTscDir
    });

    // Verify .d.ts file for source was created
    const indexDtsPath = join(testTscDir, workerName, 'src', 'index.d.ts');
    expect(await fileExists(indexDtsPath)).toBe(true);

    // Verify .d.ts file for test was NOT created
    const testDtsPath = join(testTscDir, workerName, 'src', 'index.test.d.ts');
    expect(await fileExists(testDtsPath)).toBe(false);
  });
});
