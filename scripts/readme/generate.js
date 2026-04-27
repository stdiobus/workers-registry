#!/usr/bin/env node

/*
 * Apache License 2.0
 * Copyright (c) 2025–present Raman Marozau, Target Insight Function.
 *
 * README Badge Generator for stdio Bus Workers Registry
 *
 * Architecture:
 *   README.template.md  →  (this script)  →  README.md
 *   (source of truth)       (generator)       (generated artifact)
 *
 * The template contains placeholders in the format {{PLACEHOLDER_NAME}}.
 * This script resolves each placeholder to a real value and writes README.md.
 * The template is never modified — placeholders persist across runs.
 *
 * Supported placeholders:
 *   {{TESTS_COUNT}}    — total test count aggregated from all Jest suites
 *   {{WORKERS_COUNT}}  — number of buildable workers (same logic as build.js)
 *
 * Adding new placeholders:
 *   1. Add {{MY_PLACEHOLDER}} anywhere in README.template.md
 *   2. Add a resolver function in the RESOLVERS map below
 *   That's it. No regex changes needed.
 *
 * Usage:
 *   node scripts/update-readme-badges.js          # Generate README.md from template
 *   node scripts/update-readme-badges.js --dry    # Print what would change, don't write
 *   node scripts/update-readme-badges.js --check  # Exit 1 if README.md is outdated
 */

import { readFile, writeFile, readdir, stat } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..', '..');
const templatePath = join(__dirname, 'README.template.md');
const readmePath = join(rootDir, 'README.md');
const registryPath = join(rootDir, 'workers-registry');

// ─── Placeholder pattern ────────────────────────────────────────────────────
// Matches {{ANYTHING_HERE}} — universal, doesn't care about context around it.
const PLACEHOLDER_PATTERN = /\{\{([A-Z_][A-Z0-9_]*)\}\}/g;

// ─── Resolver functions ─────────────────────────────────────────────────────
// Each resolver returns a string value for its placeholder.
// Add new resolvers here to support new placeholders.

const RESOLVERS = {
  TESTS_COUNT: resolveTotalTestCount,
  WORKERS_COUNT: resolveWorkerCount,
};

// ─── Configuration ──────────────────────────────────────────────────────────

// Directories to exclude from worker count (infrastructure, not workers)
const EXCLUDED_DIRS = ['launch'];

// Jest suites to aggregate for test count
const JEST_SUITES = [
  { name: 'root', cwd: rootDir },
  { name: 'openai-agent', cwd: join(registryPath, 'openai-agent') },
  { name: 'acp-worker', cwd: join(registryPath, 'acp-worker') },
  { name: 'registry-launcher', cwd: join(registryPath, 'registry-launcher') },
];

// ─── Resolvers implementation ───────────────────────────────────────────────

/**
 * Resolve total test count across all Jest suites.
 */
async function resolveTotalTestCount() {
  console.error('[badges] Resolving {{TESTS_COUNT}}...');
  let total = 0;

  for (const suite of JEST_SUITES) {
    const jestCount = await runJestJson(suite);

    if (jestCount !== null) {
      console.error(`[badges]   ${suite.name}: ${jestCount} tests (jest --json)`);
      total += jestCount;
    } else {
      const grepCount = await countTestsByGrep(suite.cwd);
      console.error(`[badges]   ${suite.name}: ${grepCount} tests (grep fallback)`);
      total += grepCount;
    }
  }

  console.error(`[badges]   Total: ${total}`);
  return String(total);
}

/**
 * Resolve worker count using build.js discovery logic.
 */
async function resolveWorkerCount() {
  console.error('[badges] Resolving {{WORKERS_COUNT}}...');
  let count = 0;

  const entries = await readdir(registryPath, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (EXCLUDED_DIRS.includes(entry.name)) continue;

    const workerPath = join(registryPath, entry.name);

    // Valid worker = has tsconfig.json OR has .js entrypoint files
    const hasTsConfig = await fileExists(join(workerPath, 'tsconfig.json'));
    if (hasTsConfig) {
      count++;
      continue;
    }

    const jsFiles = await findJsFiles(workerPath);
    if (jsFiles.length > 0) {
      count++;
      continue;
    }
  }

  console.error(`[badges]   Total: ${count}`);
  return String(count);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Run Jest with --json and return numTotalTests.
 * Returns null if the suite cannot be run.
 */
async function runJestJson(suite) {
  const localJest = join(suite.cwd, 'node_modules', '.bin', 'jest');
  const rootJest = join(rootDir, 'node_modules', 'jest', 'bin', 'jest.js');

  let jestBin;
  try {
    await stat(localJest);
    jestBin = localJest;
  } catch {
    jestBin = rootJest;
  }

  const args = ['--json', '--forceExit'];

  if (jestBin === rootJest && suite.cwd !== rootDir) {
    const configFile = await findJestConfig(suite.cwd);
    if (!configFile) return null;
    args.push('--config', configFile, '--rootDir', suite.cwd);
  }

  const nodeArgs = ['--experimental-vm-modules', jestBin, ...args];

  try {
    const { stdout } = await execFileAsync('node', nodeArgs, {
      cwd: suite.cwd,
      timeout: 120_000,
      env: { ...process.env, NODE_OPTIONS: '' },
      maxBuffer: 50 * 1024 * 1024,
    });
    const json = JSON.parse(stdout);
    return json.numTotalTests || 0;
  } catch (error) {
    const output = error.stdout || '';
    if (output) {
      try {
        const json = JSON.parse(output);
        return json.numTotalTests || 0;
      } catch {
        // not valid JSON
      }
    }
    return null;
  }
}

/**
 * Fallback: count test cases by grepping it()/test() patterns.
 */
async function countTestsByGrep(dir) {
  const testDirs = ['src', 'tests'];
  let total = 0;

  for (const subdir of testDirs) {
    const targetDir = join(dir, subdir);
    try {
      await stat(targetDir);
    } catch {
      continue;
    }

    try {
      const { stdout } = await execFileAsync('grep', [
        '-rEc',
        '^\\s*(it|test)\\(',
        targetDir,
      ], { timeout: 30_000 });

      for (const line of stdout.trim().split('\n')) {
        const parts = line.split(':');
        const count = parseInt(parts[parts.length - 1], 10);
        if (!isNaN(count)) total += count;
      }
    } catch {
      // grep returns exit 1 if no matches
    }
  }

  return total;
}

async function findJestConfig(dir) {
  for (const name of ['jest.config.cjs', 'jest.config.js', 'jest.config.ts']) {
    try {
      await stat(join(dir, name));
      return join(dir, name);
    } catch {
      continue;
    }
  }
  return null;
}

async function fileExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function findJsFiles(dirPath) {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    return entries
      .filter(e => e.isFile() && e.name.endsWith('.js'))
      .map(e => e.name);
  } catch {
    return [];
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry');
  const checkMode = args.includes('--check');

  console.error('[badges] stdio Bus Workers Registry – README Generator');
  console.error(`[badges] Mode: ${checkMode ? 'check' : dryRun ? 'dry-run' : 'generate'}`);
  console.error(`[badges] Template: README.template.md → README.md`);

  // Read template
  let template;
  try {
    template = await readFile(templatePath, 'utf8');
  } catch (error) {
    console.error(`[badges] ERROR: Cannot read README.template.md: ${error.message}`);
    process.exit(1);
  }

  // Find all placeholders used in template
  const usedPlaceholders = new Set();
  let match;
  while ((match = PLACEHOLDER_PATTERN.exec(template)) !== null) {
    usedPlaceholders.add(match[1]);
  }

  if (usedPlaceholders.size === 0) {
    console.error('[badges] No placeholders found in template. Nothing to do.');
    process.exit(0);
  }

  console.error(`[badges] Found placeholders: ${[...usedPlaceholders].join(', ')}`);

  // Resolve all placeholder values
  const values = {};
  for (const name of usedPlaceholders) {
    const resolver = RESOLVERS[name];
    if (!resolver) {
      console.error(`[badges] WARNING: No resolver for {{${name}}} — leaving as-is`);
      continue;
    }
    values[name] = await resolver();
  }

  // Replace placeholders in template
  const readme = template.replace(PLACEHOLDER_PATTERN, (fullMatch, name) => {
    if (name in values) {
      return values[name];
    }
    return fullMatch; // Leave unresolved placeholders as-is
  });

  // Compare with existing README.md
  let existingReadme = '';
  try {
    existingReadme = await readFile(readmePath, 'utf8');
  } catch {
    // README.md doesn't exist yet — that's fine
  }

  if (readme === existingReadme) {
    console.error('[badges] README.md is up to date. No changes needed.');
    process.exit(0);
  }

  // Show resolved values
  console.error('[badges] Resolved values:');
  for (const [name, value] of Object.entries(values)) {
    console.error(`[badges]   {{${name}}} → ${value}`);
  }

  if (checkMode) {
    console.error('[badges] README.md is outdated. Run `node scripts/update-readme-badges.js` to regenerate.');
    process.exit(1);
  }

  if (dryRun) {
    console.error('[badges] Dry run — README.md not written.');
    process.exit(0);
  }

  // Write generated README.md
  await writeFile(readmePath, readme, 'utf8');
  console.error('[badges] README.md generated successfully.');
}

main().catch((error) => {
  console.error('[badges] ERROR:', error.message);
  process.exit(1);
});
