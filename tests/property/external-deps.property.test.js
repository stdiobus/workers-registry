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
 * Property-based tests for SDK dependencies remaining external
 * Feature: npm-package-build
 */

import * as fc from 'fast-check';
import { mkdir, writeFile, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { build } from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));
const testTmpDir = join(__dirname, '..', '..', 'test-tmp-external-deps');
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
 * SDK package markers to check for in bundled output
 * These are specific strings that would appear if SDK source code was bundled
 */
const SDK_MARKERS = {
  acp: [
    '@agentclientprotocol/sdk',
    'AgentClientProtocol',
    'ACP_VERSION',
    'agentclientprotocol'
  ],
  mcp: [
    '@modelcontextprotocol/sdk',
    'ModelContextProtocol',
    'MCP_VERSION',
    'modelcontextprotocol'
  ]
};

describe('SDK Dependencies Remain External Property Tests', () => {
  beforeEach(async () => {
    await setupTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir();
  });

  // Feature: npm-package-build, Property 8: SDK Dependencies Remain External
  test('Property 8: SDK Dependencies Remain External - ACP SDK imports remain external in compiled output', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          workerName: fc.stringMatching(/^[a-z][a-z0-9-]{2,20}$/),
          importStyle: fc.constantFrom(
            'default',
            'named',
            'namespace',
            'mixed'
          ),
          hasAdditionalCode: fc.boolean()
        }),
        async ({ workerName, importStyle, hasAdditionalCode }) => {
          // Create worker directory
          const workerDir = join(testRegistryDir, workerName);
          await mkdir(workerDir, { recursive: true });
          await mkdir(join(workerDir, 'src'), { recursive: true });

          // Generate TypeScript code with different import styles
          let importCode = '';
          let usageCode = '';

          switch (importStyle) {
            case 'default':
              importCode = `import Agent from '@agentclientprotocol/sdk';`;
              usageCode = `const agent = new Agent();`;
              break;
            case 'named':
              importCode = `import { Agent, Session } from '@agentclientprotocol/sdk';`;
              usageCode = `const agent = new Agent(); const session = new Session();`;
              break;
            case 'namespace':
              importCode = `import * as ACP from '@agentclientprotocol/sdk';`;
              usageCode = `const agent = new ACP.Agent();`;
              break;
            case 'mixed':
              importCode = `import Agent, { Session } from '@agentclientprotocol/sdk';`;
              usageCode = `const agent = new Agent(); const session = new Session();`;
              break;
          }

          // Add additional code to make the worker more realistic
          const additionalCode = hasAdditionalCode
            ? `
function processMessage(msg: string): string {
  return msg.toUpperCase();
}

function handleRequest(data: any): void {
  console.log('Handling request:', data);
}
`
            : '';

          const workerCode = `
${importCode}

${additionalCode}

export default function ${workerName.replace(/-/g, '_')}() {
  ${usageCode}
  console.log("Worker ${workerName} initialized");
}
`;

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

          // Write worker source file
          await writeFile(join(workerDir, 'src', 'index.ts'), workerCode);

          // Build the worker with esbuild (same config as build script)
          const outputDir = join(testDistDir, workerName);
          await mkdir(outputDir, { recursive: true });

          const workerEntrypoint = join(workerDir, 'src', 'index.ts');
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

          // Read the compiled output
          const compiledCode = await readFile(outfile, 'utf-8');

          // Verify SDK source code is NOT bundled
          // The compiled output should contain import statements or require calls
          // but NOT the actual SDK implementation code

          // Check that SDK package markers are NOT present in the bundle
          // (except for import/require statements which are expected)
          const lines = compiledCode.split('\n');
          const importLines = lines.filter(line =>
            line.includes('import') || line.includes('require')
          );

          // SDK markers should only appear in import/require statements
          for (const marker of SDK_MARKERS.acp) {
            const markerOccurrences = compiledCode.split(marker).length - 1;

            if (markerOccurrences > 0) {
              // If marker appears, it should ONLY be in import/require statements
              const importOccurrences = importLines.filter(line =>
                line.includes(marker)
              ).length;

              // The marker should appear in imports but not in the actual bundled code
              // Allow for the marker to appear in import statements
              expect(markerOccurrences).toBeLessThanOrEqual(importOccurrences + 2);
            }
          }

          // Verify the output contains an import or require for the SDK
          const hasExternalReference =
            compiledCode.includes('@agentclientprotocol/sdk') ||
            compiledCode.includes('agentclientprotocol');

          expect(hasExternalReference).toBe(true);

          // Verify the bundle is relatively small (SDK source would add significant size)
          // A bundled SDK would be much larger than just the worker code
          const bundleSize = compiledCode.length;
          expect(bundleSize).toBeLessThan(50000); // 50KB threshold
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: npm-package-build, Property 8: SDK Dependencies Remain External
  test('Property 8: SDK Dependencies Remain External - MCP SDK imports remain external in compiled output', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          workerName: fc.stringMatching(/^[a-z][a-z0-9-]{2,20}$/),
          importStyle: fc.constantFrom(
            'default',
            'named',
            'namespace'
          ),
          hasAdditionalCode: fc.boolean()
        }),
        async ({ workerName, importStyle, hasAdditionalCode }) => {
          // Create worker directory
          const workerDir = join(testRegistryDir, workerName);
          await mkdir(workerDir, { recursive: true });
          await mkdir(join(workerDir, 'src'), { recursive: true });

          // Generate TypeScript code with different import styles
          let importCode = '';
          let usageCode = '';

          switch (importStyle) {
            case 'default':
              importCode = `import Server from '@modelcontextprotocol/sdk';`;
              usageCode = `const server = new Server();`;
              break;
            case 'named':
              importCode = `import { Server, Client } from '@modelcontextprotocol/sdk';`;
              usageCode = `const server = new Server(); const client = new Client();`;
              break;
            case 'namespace':
              importCode = `import * as MCP from '@modelcontextprotocol/sdk';`;
              usageCode = `const server = new MCP.Server();`;
              break;
          }

          // Add additional code to make the worker more realistic
          const additionalCode = hasAdditionalCode
            ? `
function handleTool(name: string, args: any): any {
  return { result: 'success' };
}

function listTools(): string[] {
  return ['tool1', 'tool2'];
}
`
            : '';

          const workerCode = `
${importCode}

${additionalCode}

export default function ${workerName.replace(/-/g, '_')}() {
  ${usageCode}
  console.log("Worker ${workerName} initialized");
}
`;

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

          // Write worker source file
          await writeFile(join(workerDir, 'src', 'index.ts'), workerCode);

          // Build the worker with esbuild (same config as build script)
          const outputDir = join(testDistDir, workerName);
          await mkdir(outputDir, { recursive: true });

          const workerEntrypoint = join(workerDir, 'src', 'index.ts');
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

          // Read the compiled output
          const compiledCode = await readFile(outfile, 'utf-8');

          // Verify SDK source code is NOT bundled
          const lines = compiledCode.split('\n');
          const importLines = lines.filter(line =>
            line.includes('import') || line.includes('require')
          );

          // SDK markers should only appear in import/require statements
          for (const marker of SDK_MARKERS.mcp) {
            const markerOccurrences = compiledCode.split(marker).length - 1;

            if (markerOccurrences > 0) {
              // If marker appears, it should ONLY be in import/require statements
              const importOccurrences = importLines.filter(line =>
                line.includes(marker)
              ).length;

              // The marker should appear in imports but not in the actual bundled code
              expect(markerOccurrences).toBeLessThanOrEqual(importOccurrences + 2);
            }
          }

          // Verify the output contains an import or require for the SDK
          const hasExternalReference =
            compiledCode.includes('@modelcontextprotocol/sdk') ||
            compiledCode.includes('modelcontextprotocol');

          expect(hasExternalReference).toBe(true);

          // Verify the bundle is relatively small (SDK source would add significant size)
          const bundleSize = compiledCode.length;
          expect(bundleSize).toBeLessThan(50000); // 50KB threshold
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: npm-package-build, Property 8: SDK Dependencies Remain External
  test('Property 8: SDK Dependencies Remain External - Workers importing both SDKs keep both external', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          workerName: fc.stringMatching(/^[a-z][a-z0-9-]{2,20}$/),
          acpImportStyle: fc.constantFrom('named', 'namespace'),
          mcpImportStyle: fc.constantFrom('named', 'namespace')
        }),
        async ({ workerName, acpImportStyle, mcpImportStyle }) => {
          // Create worker directory
          const workerDir = join(testRegistryDir, workerName);
          await mkdir(workerDir, { recursive: true });
          await mkdir(join(workerDir, 'src'), { recursive: true });

          // Generate TypeScript code importing both SDKs
          let acpImport = '';
          let mcpImport = '';
          let usageCode = '';

          if (acpImportStyle === 'named') {
            acpImport = `import { Agent } from '@agentclientprotocol/sdk';`;
            usageCode += `const agent = new Agent(); `;
          } else {
            acpImport = `import * as ACP from '@agentclientprotocol/sdk';`;
            usageCode += `const agent = new ACP.Agent(); `;
          }

          if (mcpImportStyle === 'named') {
            mcpImport = `import { Server } from '@modelcontextprotocol/sdk';`;
            usageCode += `const server = new Server();`;
          } else {
            mcpImport = `import * as MCP from '@modelcontextprotocol/sdk';`;
            usageCode += `const server = new MCP.Server();`;
          }

          const workerCode = `
${acpImport}
${mcpImport}

export default function ${workerName.replace(/-/g, '_')}() {
  ${usageCode}
  console.log("Worker ${workerName} with both SDKs");
}
`;

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

          // Write worker source file
          await writeFile(join(workerDir, 'src', 'index.ts'), workerCode);

          // Build the worker with esbuild
          const outputDir = join(testDistDir, workerName);
          await mkdir(outputDir, { recursive: true });

          const workerEntrypoint = join(workerDir, 'src', 'index.ts');
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

          // Read the compiled output
          const compiledCode = await readFile(outfile, 'utf-8');

          // Verify both SDKs remain external
          const hasAcpReference =
            compiledCode.includes('@agentclientprotocol/sdk') ||
            compiledCode.includes('agentclientprotocol');

          const hasMcpReference =
            compiledCode.includes('@modelcontextprotocol/sdk') ||
            compiledCode.includes('modelcontextprotocol');

          expect(hasAcpReference).toBe(true);
          expect(hasMcpReference).toBe(true);

          // Verify the bundle is small (both SDKs bundled would be very large)
          const bundleSize = compiledCode.length;
          expect(bundleSize).toBeLessThan(50000); // 50KB threshold
        }
      ),
      { numRuns: 100 }
    );
  });
});
