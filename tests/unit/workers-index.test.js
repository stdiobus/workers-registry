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
 * Unit tests for workers index generation
 *
 * Tests the generateWorkersIndex() function which creates:
 * - out/dist/workers-registry/index.js with workers object
 * - out/dist/workers-registry/index.d.ts with TypeScript definitions
 *
 * Requirements: 5.1, 5.2, 5.3
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdir, readFile, rm } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { generateWorkersIndex } from '../../scripts/build.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const testDir = join(__dirname, '..', '..', 'test-output-workers-index');

describe('generateWorkersIndex', () => {
  let workersDistPath;

  beforeEach(async () => {
    // Create test directory structure
    workersDistPath = join(testDir, 'dist', 'workers-registry');
    await mkdir(workersDistPath, { recursive: true });
  });

  afterEach(async () => {
    // Clean up test directory
    await rm(testDir, { recursive: true, force: true });
  });

  it('should generate index.js with workers object containing all discovered workers', async () => {
    const workers = [
      {
        name: 'acp-worker',
        type: 'typescript',
        entrypoint: 'src/index.ts',
        hasConfig: true,
        configFile: 'acp-worker-config.json'
      },
      {
        name: 'echo-worker',
        type: 'javascript',
        entrypoint: 'echo-worker.js',
        hasConfig: true,
        configFile: 'echo-worker-config.json'
      },
      {
        name: 'mcp-echo-server',
        type: 'typescript',
        entrypoint: 'mcp-echo-server.ts',
        hasConfig: true,
        configFile: 'mcp-echo-server-config.json'
      }
    ];

    await generateWorkersIndex(workers, { workersDistPath });

    // Read generated index.js
    const indexJsPath = join(workersDistPath, 'index.js');
    const indexJsContent = await readFile(indexJsPath, 'utf8');

    // Verify file contains workers export
    expect(indexJsContent).toContain('export const workers');

    // Parse and verify workers object
    // Extract the JSON object from the export statement
    const workersMatch = indexJsContent.match(/export const workers = ({[\s\S]*?});/);
    expect(workersMatch).toBeTruthy();

    const workersObject = JSON.parse(workersMatch[1]);

    // Verify all workers are present
    expect(Object.keys(workersObject)).toHaveLength(3);
    expect(workersObject).toHaveProperty('acp-worker');
    expect(workersObject).toHaveProperty('echo-worker');
    expect(workersObject).toHaveProperty('mcp-echo-server');
  });

  it('should generate correct entrypoint paths for TypeScript workers', async () => {
    const workers = [
      {
        name: 'acp-worker',
        type: 'typescript',
        entrypoint: 'src/index.ts',
        hasConfig: false,
        configFile: null
      }
    ];

    await generateWorkersIndex(workers, { workersDistPath });

    const indexJsPath = join(workersDistPath, 'index.js');
    const indexJsContent = await readFile(indexJsPath, 'utf8');

    const workersMatch = indexJsContent.match(/export const workers = ({[\s\S]*?});/);
    const workersObject = JSON.parse(workersMatch[1]);

    // TypeScript workers should have entrypoint at ./worker-name/index.js
    expect(workersObject['acp-worker'].entrypoint).toBe('./acp-worker/index.js');
  });

  it('should generate correct entrypoint paths for JavaScript workers', async () => {
    const workers = [
      {
        name: 'echo-worker',
        type: 'javascript',
        entrypoint: 'echo-worker.js',
        hasConfig: false,
        configFile: null
      }
    ];

    await generateWorkersIndex(workers, { workersDistPath });

    const indexJsPath = join(workersDistPath, 'index.js');
    const indexJsContent = await readFile(indexJsPath, 'utf8');

    const workersMatch = indexJsContent.match(/export const workers = ({[\s\S]*?});/);
    const workersObject = JSON.parse(workersMatch[1]);

    // JavaScript workers should preserve their original filename
    expect(workersObject['echo-worker'].entrypoint).toBe('./echo-worker/echo-worker.js');
  });

  it('should generate correct type paths for TypeScript workers', async () => {
    const workers = [
      {
        name: 'acp-worker',
        type: 'typescript',
        entrypoint: 'src/index.ts',
        hasConfig: false,
        configFile: null
      },
      {
        name: 'mcp-echo-server',
        type: 'typescript',
        entrypoint: 'mcp-echo-server.ts',
        hasConfig: false,
        configFile: null
      }
    ];

    await generateWorkersIndex(workers, { workersDistPath });

    const indexJsPath = join(workersDistPath, 'index.js');
    const indexJsContent = await readFile(indexJsPath, 'utf8');

    const workersMatch = indexJsContent.match(/export const workers = ({[\s\S]*?});/);
    const workersObject = JSON.parse(workersMatch[1]);

    // TypeScript workers should have types path pointing to tsc output
    expect(workersObject['acp-worker'].types)
      .toBe('../tsc/workers-registry/acp-worker/src/index.d.ts');
    expect(workersObject['mcp-echo-server'].types)
      .toBe('../tsc/workers-registry/mcp-echo-server/mcp-echo-server.d.ts');
  });

  it('should set types to null for JavaScript workers', async () => {
    const workers = [
      {
        name: 'echo-worker',
        type: 'javascript',
        entrypoint: 'echo-worker.js',
        hasConfig: false,
        configFile: null
      },
      {
        name: 'mcp-to-acp-proxy',
        type: 'javascript',
        entrypoint: 'proxy.js',
        hasConfig: false,
        configFile: null
      }
    ];

    await generateWorkersIndex(workers, { workersDistPath });

    const indexJsPath = join(workersDistPath, 'index.js');
    const indexJsContent = await readFile(indexJsPath, 'utf8');

    const workersMatch = indexJsContent.match(/export const workers = ({[\s\S]*?});/);
    const workersObject = JSON.parse(workersMatch[1]);

    // JavaScript workers should have null types
    expect(workersObject['echo-worker'].types).toBeNull();
    expect(workersObject['mcp-to-acp-proxy'].types).toBeNull();
  });

  it('should generate correct config paths when present', async () => {
    const workers = [
      {
        name: 'acp-worker',
        type: 'typescript',
        entrypoint: 'src/index.ts',
        hasConfig: true,
        configFile: 'acp-worker-config.json'
      },
      {
        name: 'echo-worker',
        type: 'javascript',
        entrypoint: 'echo-worker.js',
        hasConfig: true,
        configFile: 'echo-worker-config.json'
      }
    ];

    await generateWorkersIndex(workers, { workersDistPath });

    const indexJsPath = join(workersDistPath, 'index.js');
    const indexJsContent = await readFile(indexJsPath, 'utf8');

    const workersMatch = indexJsContent.match(/export const workers = ({[\s\S]*?});/);
    const workersObject = JSON.parse(workersMatch[1]);

    // Workers with config should have config path
    expect(workersObject['acp-worker'].config).toBe('./acp-worker/acp-worker-config.json');
    expect(workersObject['echo-worker'].config).toBe('./echo-worker/echo-worker-config.json');
  });

  it('should set config to null when not present', async () => {
    const workers = [
      {
        name: 'mcp-to-acp-proxy',
        type: 'javascript',
        entrypoint: 'proxy.js',
        hasConfig: false,
        configFile: null
      }
    ];

    await generateWorkersIndex(workers, { workersDistPath });

    const indexJsPath = join(workersDistPath, 'index.js');
    const indexJsContent = await readFile(indexJsPath, 'utf8');

    const workersMatch = indexJsContent.match(/export const workers = ({[\s\S]*?});/);
    const workersObject = JSON.parse(workersMatch[1]);

    // Workers without config should have null config
    expect(workersObject['mcp-to-acp-proxy'].config).toBeNull();
  });

  it('should include worker type in workers object', async () => {
    const workers = [
      {
        name: 'acp-worker',
        type: 'typescript',
        entrypoint: 'src/index.ts',
        hasConfig: false,
        configFile: null
      },
      {
        name: 'echo-worker',
        type: 'javascript',
        entrypoint: 'echo-worker.js',
        hasConfig: false,
        configFile: null
      }
    ];

    await generateWorkersIndex(workers, { workersDistPath });

    const indexJsPath = join(workersDistPath, 'index.js');
    const indexJsContent = await readFile(indexJsPath, 'utf8');

    const workersMatch = indexJsContent.match(/export const workers = ({[\s\S]*?});/);
    const workersObject = JSON.parse(workersMatch[1]);

    // Verify type field is present and correct
    expect(workersObject['acp-worker'].type).toBe('typescript');
    expect(workersObject['echo-worker'].type).toBe('javascript');
  });

  it('should generate index.d.ts with TypeScript definitions', async () => {
    const workers = [
      {
        name: 'acp-worker',
        type: 'typescript',
        entrypoint: 'src/index.ts',
        hasConfig: true,
        configFile: 'acp-worker-config.json'
      },
      {
        name: 'echo-worker',
        type: 'javascript',
        entrypoint: 'echo-worker.js',
        hasConfig: true,
        configFile: 'echo-worker-config.json'
      }
    ];

    await generateWorkersIndex(workers, { workersDistPath });

    // Read generated index.d.ts
    const indexDtsPath = join(workersDistPath, 'index.d.ts');
    const indexDtsContent = await readFile(indexDtsPath, 'utf8');

    // Verify TypeScript definitions are present
    expect(indexDtsContent).toContain('export interface WorkerInfo');
    expect(indexDtsContent).toContain('entrypoint: string');
    expect(indexDtsContent).toContain('types: string | null');
    expect(indexDtsContent).toContain('config: string | null');
    expect(indexDtsContent).toContain("type: 'typescript' | 'javascript'");
    expect(indexDtsContent).toContain('export const workers');
    expect(indexDtsContent).toContain("'acp-worker': WorkerInfo");
    expect(indexDtsContent).toContain("'echo-worker': WorkerInfo");
  });

  it('should generate valid JavaScript that can be parsed', async () => {
    const workers = [
      {
        name: 'test-worker',
        type: 'typescript',
        entrypoint: 'src/index.ts',
        hasConfig: true,
        configFile: 'test-worker-config.json'
      }
    ];

    await generateWorkersIndex(workers, { workersDistPath });

    const indexJsPath = join(workersDistPath, 'index.js');
    const indexJsContent = await readFile(indexJsPath, 'utf8');

    // Verify the generated JavaScript is syntactically valid
    // by attempting to parse it (this will throw if invalid)
    expect(() => {
      // Extract and parse the JSON object
      const workersMatch = indexJsContent.match(/export const workers = ({[\s\S]*?});/);
      JSON.parse(workersMatch[1]);
    }).not.toThrow();
  });

  it('should handle workers with different entrypoint structures', async () => {
    const workers = [
      {
        name: 'worker-with-src',
        type: 'typescript',
        entrypoint: 'src/index.ts',
        hasConfig: false,
        configFile: null
      },
      {
        name: 'worker-at-root',
        type: 'typescript',
        entrypoint: 'worker-at-root.ts',
        hasConfig: false,
        configFile: null
      },
      {
        name: 'worker-nested',
        type: 'typescript',
        entrypoint: 'src/lib/main.ts',
        hasConfig: false,
        configFile: null
      }
    ];

    await generateWorkersIndex(workers, { workersDistPath });

    const indexJsPath = join(workersDistPath, 'index.js');
    const indexJsContent = await readFile(indexJsPath, 'utf8');

    const workersMatch = indexJsContent.match(/export const workers = ({[\s\S]*?});/);
    const workersObject = JSON.parse(workersMatch[1]);

    // All TypeScript workers should have index.js as entrypoint
    expect(workersObject['worker-with-src'].entrypoint).toBe('./worker-with-src/index.js');
    expect(workersObject['worker-at-root'].entrypoint).toBe('./worker-at-root/index.js');
    expect(workersObject['worker-nested'].entrypoint).toBe('./worker-nested/index.js');

    // Types paths should reflect the original source structure
    expect(workersObject['worker-with-src'].types)
      .toBe('../tsc/workers-registry/worker-with-src/src/index.d.ts');
    expect(workersObject['worker-at-root'].types)
      .toBe('../tsc/workers-registry/worker-at-root/worker-at-root.d.ts');
    expect(workersObject['worker-nested'].types)
      .toBe('../tsc/workers-registry/worker-nested/src/lib/main.d.ts');
  });

  it('should handle empty workers array', async () => {
    const workers = [];

    await generateWorkersIndex(workers, { workersDistPath });

    const indexJsPath = join(workersDistPath, 'index.js');
    const indexJsContent = await readFile(indexJsPath, 'utf8');

    const workersMatch = indexJsContent.match(/export const workers = ({[\s\S]*?});/);
    const workersObject = JSON.parse(workersMatch[1]);

    // Should generate empty workers object
    expect(Object.keys(workersObject)).toHaveLength(0);
  });

  it('should generate index.d.ts with all worker names', async () => {
    const workers = [
      {
        name: 'worker1',
        type: 'typescript',
        entrypoint: 'src/index.ts',
        hasConfig: false,
        configFile: null
      },
      {
        name: 'worker2',
        type: 'javascript',
        entrypoint: 'worker2.js',
        hasConfig: false,
        configFile: null
      },
      {
        name: 'worker3',
        type: 'typescript',
        entrypoint: 'worker3.ts',
        hasConfig: false,
        configFile: null
      }
    ];

    await generateWorkersIndex(workers, { workersDistPath });

    const indexDtsPath = join(workersDistPath, 'index.d.ts');
    const indexDtsContent = await readFile(indexDtsPath, 'utf8');

    // Verify all worker names are in the type definition
    expect(indexDtsContent).toContain("'worker1': WorkerInfo");
    expect(indexDtsContent).toContain("'worker2': WorkerInfo");
    expect(indexDtsContent).toContain("'worker3': WorkerInfo");
  });

  it('should create both index.js and index.d.ts files', async () => {
    const workers = [
      {
        name: 'test-worker',
        type: 'typescript',
        entrypoint: 'src/index.ts',
        hasConfig: false,
        configFile: null
      }
    ];

    await generateWorkersIndex(workers, { workersDistPath });

    // Verify both files exist
    const indexJsPath = join(workersDistPath, 'index.js');
    const indexDtsPath = join(workersDistPath, 'index.d.ts');

    const indexJsContent = await readFile(indexJsPath, 'utf8');
    const indexDtsContent = await readFile(indexDtsPath, 'utf8');

    expect(indexJsContent).toBeTruthy();
    expect(indexDtsContent).toBeTruthy();
  });
});
