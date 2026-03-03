#!/usr/bin/env node

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
 * Universal worker launcher for stdio Bus Workers Registry
 * 
 * Usage:
 *   node index.js <worker-name>
 *   node index.js acp-worker
 *   node index.js echo-worker
 *   node index.js mcp-echo-server
 * 
 * This script dynamically imports and runs the specified worker from the compiled output.
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFile } from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Worker configuration mapping worker names to their entry points
 */
interface WorkerConfig {
  readonly path: string;
  readonly description: string;
}

/**
 * Available workers mapping
 */
const WORKERS: Readonly<Record<string, WorkerConfig>> = {
  'acp-worker': {
    path: '../out/dist/workers/acp-worker/index.js',
    description: 'Full ACP protocol implementation with MCP integration'
  },
  'acp-registry': {
    path: '../out/dist/workers/acp-registry/registry-launcher-client.js',
    description: 'Registry Launcher for ACP Registry agents'
  },
  'echo-worker': {
    path: '../out/dist/workers/echo-worker/echo-worker.js',
    description: 'Simple echo worker for testing NDJSON protocol'
  },
  'mcp-echo-server': {
    path: '../out/dist/workers/mcp-echo-server/index.js',
    description: 'MCP server example for testing'
  },
  'mcp-to-acp-proxy': {
    path: '../out/dist/workers/mcp-to-acp-proxy/proxy.js',
    description: 'MCP-to-ACP protocol bridge'
  }
} as const;

/**
 * Worker name type
 */
type WorkerName = keyof typeof WORKERS;

/**
 * Display usage information
 */
function showUsage(): void {
  console.error('Usage: node index.js <worker-name>');
  console.error('');
  console.error('Available workers:');

  for (const [name, config] of Object.entries(WORKERS)) {
    console.error(`  - ${name.padEnd(20)} ${config.description}`);
  }

  console.error('');
  console.error('Examples:');
  console.error('  node index.js acp-worker');
  console.error('  node index.js echo-worker');
  console.error('  node index.js mcp-echo-server');
}

/**
 * Validate worker name
 */
function isValidWorkerName(name: string): name is WorkerName {
  return name in WORKERS;
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const workerName = process.argv[2];

  // Check if worker name is provided
  if (!workerName) {
    console.error('Error: Worker name is required\n');
    showUsage();
    process.exit(1);
  }

  // Check if worker exists
  if (!isValidWorkerName(workerName)) {
    console.error(`Error: Unknown worker "${workerName}"\n`);
    showUsage();
    process.exit(1);
  }

  const workerConfig = WORKERS[workerName];
  const workerPath = workerConfig.path;

  // Resolve absolute path
  const absolutePath = join(__dirname, workerPath);

  try {
    // Verify the worker file exists
    await readFile(absolutePath);

    // Import and run the worker
    console.error(`[launcher] Starting worker: ${workerName}`);
    console.error(`[launcher] Description: ${workerConfig.description}`);
    console.error(`[launcher] Path: ${absolutePath}`);

    await import(absolutePath);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      console.error(`Error: Worker file not found: ${absolutePath}`);
      console.error('');
      console.error('Please run "npm run build" first to compile the workers.');
      process.exit(1);
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    console.error(`Error loading worker "${workerName}":`, errorMessage);
    if (errorStack) {
      console.error(errorStack);
    }
    process.exit(1);
  }
}

// Run main function
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
