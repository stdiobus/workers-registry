#!/usr/bin/env node
/*
 * Universal Worker Launcher
 *
 * Usage:
 *   stdiobus-worker <worker-name>
 *   node index.js <worker-name>
 *
 * Examples:
 *   stdiobus-worker launcher
 *   stdiobus-worker acp-worker
 *   stdiobus-worker echo-worker
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const workerName = process.argv[2];

if (!workerName) {
  console.error('Usage: stdiobus-worker <worker-name>');
  console.error('Available workers: launcher, acp-worker, echo-worker, mcp-echo-server, mcp-to-acp-proxy');
  process.exit(1);
}

// Map worker names to their entry points
const workers = {
  'launch': './out/dist/workers/launch/index.js',
  'acp-worker': './out/dist/workers/acp-worker/index.js',
  'echo-worker': './out/dist/workers/echo-worker/echo-worker.js',
  'mcp-echo-server': './out/dist/workers/mcp-echo-server/index.js',
  'mcp-to-acp-proxy': './out/dist/workers/mcp-to-acp-proxy/proxy.js',
  'acp-registry': './out/dist/workers/acp-registry/registry-launcher-client.js',
};

const workerPath = workers[workerName];

if (!workerPath) {
  console.error(`Unknown worker: ${workerName}`);
  console.error('Available workers:', Object.keys(workers).join(', '));
  process.exit(1);
}

// Import and run the worker
const fullPath = join(__dirname, workerPath);
await import(fullPath);
