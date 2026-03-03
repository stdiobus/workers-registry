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
 * Build script for stdio Bus Workers Registry
 *
 * This script orchestrates the build process:
 * 1. Clean previous build artifacts
 * 2. Discover workers from workers-registry directory
 * 3. Compile all workers with esbuild to out/dist/
 * 4. Generate TypeScript type definitions with tsc to out/tsc/
 * 5. Copy config files
 * 6. Generate workers index module
 * 7. Validate build output
 */

import { build } from 'esbuild';
import { readdir, copyFile, mkdir, rm } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const registryPath = join(rootDir, 'workers-registry');
const outPath = join(rootDir, 'out');
const distPath = join(outPath, 'dist');
const tscPath = join(outPath, 'tsc');
const workersDistPath = join(distPath, 'workers');
const workersTscPath = join(tscPath, 'workers-registry');

/**
 * Check if a file exists
 * @param {string} path - Path to check
 * @returns {Promise<boolean>}
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

/**
 * Find JavaScript files in a directory
 * @param {string} dirPath - Directory to search
 * @returns {Promise<string[]>} - Array of .js filenames
 */
async function findJsFiles(dirPath) {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    return entries
      .filter(entry => entry.isFile() && entry.name.endsWith('.js'))
      .map(entry => entry.name);
  } catch {
    return [];
  }
}

/**
 * Find entrypoint file from a list of candidates
 * @param {string} workerPath - Path to worker directory
 * @param {string[]} candidates - List of candidate filenames
 * @returns {Promise<string|null>} - Relative path to entrypoint or null
 */
async function findEntrypoint(workerPath, candidates) {
  for (const candidate of candidates) {
    const fullPath = join(workerPath, candidate);
    if (await fileExists(fullPath)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Find config file for a worker
 * @param {string} workerPath - Path to worker directory
 * @param {string} workerName - Name of the worker
 * @returns {Promise<string|null>} - Config filename or null
 */
async function findConfigFile(workerPath, workerName) {
  try {
    const { stat } = await import('fs/promises');
    const entries = await readdir(workerPath);
    const configFiles = [];

    // Filter for actual config files (not directories)
    for (const entry of entries) {
      if (entry.endsWith('-config.json')) {
        const fullPath = join(workerPath, entry);
        try {
          const stats = await stat(fullPath);
          if (stats.isFile()) {
            configFiles.push(entry);
          }
        } catch {
          // Skip entries that can't be stat'd
        }
      }
    }

    // Prefer {worker-name}-config.json
    const preferredConfig = `${workerName}-config.json`;
    if (configFiles.includes(preferredConfig)) {
      return preferredConfig;
    }

    // Return first config file found
    return configFiles.length > 0 ? configFiles[0] : null;
  } catch {
    return null;
  }
}

/**
 * Analyze a worker directory to determine its type and metadata
 * @param {string} name - Worker name (directory name)
 * @param {string} path - Absolute path to worker directory
 * @returns {Promise<Object|null>} - WorkerMetadata object or null if invalid
 */
async function analyzeWorker(name, path) {
  // Check for TypeScript worker
  const hasTsConfig = await fileExists(join(path, 'tsconfig.json'));

  if (hasTsConfig) {
    // TypeScript worker - look for src/index.ts or {name}.ts
    const entrypoint = await findEntrypoint(path, [
      'src/index.ts',
      `${name}.ts`,
      'index.ts'
    ]);

    if (!entrypoint) {
      throw new Error(`TypeScript worker ${name} has no valid entrypoint`);
    }

    const configFile = await findConfigFile(path, name);

    return {
      name,
      path,
      type: 'typescript',
      entrypoint,
      hasConfig: configFile !== null,
      configFile,
      hasTypes: true
    };
  }

  // Check for JavaScript worker
  const jsFiles = await findJsFiles(path);

  if (jsFiles.length > 0) {
    // JavaScript worker - look for {name}.js or index.js
    const entrypoint = jsFiles.find(f =>
      f === `${name}.js` || f === 'index.js'
    ) || jsFiles[0];

    const configFile = await findConfigFile(path, name);

    return {
      name,
      path,
      type: 'javascript',
      entrypoint,
      hasConfig: configFile !== null,
      configFile,
      hasTypes: false
    };
  }

  // Not a valid worker
  console.error(`[warn] Skipping ${name}: no valid entrypoint found`);
  return null;
}

/**
 * Discover all workers in the workers-registry directory
 * @returns {Promise<Array>} - Array of WorkerMetadata objects
 */
async function discoverWorkers() {
  console.error('[build] Discovering workers...');

  const workers = [];

  try {
    const entries = await readdir(registryPath, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const workerPath = join(registryPath, entry.name);
      const worker = await analyzeWorker(entry.name, workerPath);

      if (worker) {
        workers.push(worker);
        console.error(`[build] Found ${worker.type} worker: ${worker.name}`);
      }
    }
  } catch (error) {
    throw new Error(`Failed to discover workers: ${error.message}`);
  }

  if (workers.length === 0) {
    throw new Error('No workers found in workers-registry directory');
  }

  console.error(`[build] Discovered ${workers.length} worker(s)`);
  return workers;
}

/**
 * Add shebang to a file and make it executable
 * @param {string} filePath - Path to the file
 * @returns {Promise<void>}
 */
async function addShebang(filePath) {
  const { readFile, writeFile, chmod } = await import('fs/promises');

  try {
    let content = await readFile(filePath, 'utf8');

    // Check if shebang already exists
    if (!content.startsWith('#!')) {
      content = '#!/usr/bin/env node\n' + content;
      await writeFile(filePath, content, 'utf8');
    }

    // Make executable (chmod +x)
    await chmod(filePath, 0o755);
  } catch (error) {
    console.error(`[warn] Could not add shebang to ${filePath}: ${error.message}`);
  }
}

/**
 * Build a worker with esbuild
 * @param {Object} worker - WorkerMetadata object
 * @returns {Promise<void>}
 */
async function buildWorkerWithEsbuild(worker) {
  console.error(`[build] Building ${worker.name}...`);

  // Determine output filename based on worker type
  let outputFilename;
  if (worker.type === 'typescript') {
    // TypeScript workers always output to index.js
    outputFilename = 'index.js';
  } else {
    // JavaScript workers preserve their original filename
    outputFilename = worker.entrypoint;
  }

  // Construct full paths
  const workerEntrypoint = join(worker.path, worker.entrypoint);

  // Special case: launcher goes to root launcher/ directory for npm package
  let outputDir;
  if (worker.name === 'launcher') {
    outputDir = join(rootDir, 'launcher');
  } else {
    outputDir = join(workersDistPath, worker.name);
  }

  const outfile = join(outputDir, outputFilename);

  // Ensure output directory exists
  await mkdir(outputDir, { recursive: true });

  try {
    // Build with esbuild
    await build({
      entryPoints: [workerEntrypoint],
      bundle: true,
      platform: 'node',
      target: 'node20',
      format: 'esm',
      outfile,
      external: [
        'node:*'
      ],
      // Add require polyfill for ESM
      banner: {
        js: `import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);`
      },
      sourcemap: true,
      minifyWhitespace: true,
      treeShaking: true,
      logLevel: 'info',
      metafile: true
    });

    console.error(`[build] Built ${worker.name} → ${outputFilename}`);
  } catch (error) {
    throw new Error(`Failed to build ${worker.name}: ${error.message}`);
  }

  // Add shebang to make executable
  await addShebang(outfile);

  // Copy config file if present
  await copyWorkerConfigs(worker, outputDir);
}
/**
 * Copy config files for a worker
 * @param {Object} worker - WorkerMetadata object
 * @param {string} outputDir - Output directory for the worker
 * @returns {Promise<void>}
 */
async function copyWorkerConfigs(worker, outputDir) {
  if (!worker.hasConfig || !worker.configFile) {
    // No config file to copy - this is not an error
    return;
  }

  const configSrc = join(worker.path, worker.configFile);
  const configDest = join(outputDir, worker.configFile);

  try {
    // Verify the config source is actually a file before copying
    const { stat } = await import('fs/promises');
    const stats = await stat(configSrc);

    if (stats.isFile()) {
      await copyFile(configSrc, configDest);
      console.error(`[build] Copied config for ${worker.name}`);
    } else {
      console.error(`[warn] Skipping config for ${worker.name}: not a file`);
    }
  } catch (error) {
    // Log warning but don't fail the build for missing config files
    console.error(`[warn] Could not copy config for ${worker.name}: ${error.message}`);
  }
}


/**
 * Generate TypeScript type definitions for TypeScript workers
 * @param {Array} tsWorkers - Array of TypeScript WorkerMetadata objects
 * @param {Object} options - Optional configuration for testing
 * @param {string} options.rootDir - Root directory for tsconfig (defaults to module rootDir)
 * @param {string} options.outDir - Output directory for type definitions (defaults to module tscPath)
 * @param {string} options.registryDir - Workers registry directory (defaults to module registryPath)
 * @returns {Promise<void>}
 */
async function generateTypeDefinitions(tsWorkers, options = {}) {
  if (tsWorkers.length === 0) {
    console.error('[build] No TypeScript workers to generate types for');
    return;
  }

  console.error(`[build] Generating type definitions for ${tsWorkers.length} TypeScript worker(s)...`);

  // Use provided options or defaults
  const configRootDir = options.rootDir || rootDir;
  const configOutDir = options.outDir || join(outPath, 'tsc', 'workers-registry');
  const configRegistryDir = options.registryDir || registryPath;
  const configWorkersTscPath = options.workersTscPath || workersTscPath;

  // Ensure output directory exists
  await mkdir(configWorkersTscPath, { recursive: true });

  // Create temporary tsconfig.json for type generation
  const tsconfigPath = join(configRootDir, 'tsconfig.types.json');
  const tsconfigForTypes = {
    compilerOptions: {
      declaration: true,
      emitDeclarationOnly: true,
      outDir: configOutDir,
      rootDir: configRegistryDir,
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'bundler',
      strict: true,
      skipLibCheck: true
    },
    include: tsWorkers.map(w => join(w.path, '**/*.ts')),
    exclude: ['**/*.test.ts', '**/*.property.test.ts', '**/*.property.ts', '**/tests/**', '**/node_modules']
  };

  try {
    // Write temporary tsconfig
    const { writeFile } = await import('fs/promises');
    await writeFile(tsconfigPath, JSON.stringify(tsconfigForTypes, null, 2));

    // Execute tsc command
    console.error('[build] Running tsc for type generation...');
    const { stdout, stderr } = await execAsync(`npx tsc --project ${tsconfigPath}`);

    if (stdout) {
      console.error(stdout);
    }
    if (stderr) {
      console.error(stderr);
    }

    console.error('[build] Type definitions generated successfully');

    // Clean up temporary tsconfig
    await rm(tsconfigPath, { force: true });
  } catch (error) {
    // Clean up temporary tsconfig on error
    try {
      await rm(tsconfigPath, { force: true });
    } catch {
      // Ignore cleanup errors
    }

    // Include stderr/stdout in error message if available
    const errorDetails = error.stderr || error.stdout || error.message;
    throw new Error(`Failed to generate type definitions: ${errorDetails}`);
  }
}

/**
 * Validate build output
 * @param {Array} workers - Array of WorkerMetadata objects
 * @param {Object} paths - Paths configuration
 * @param {string} paths.distPath - Path to dist output directory
 * @param {string} paths.tscPath - Path to tsc output directory
 * @returns {Promise<Object>} - ValidationResult with success, errors, and checkedFiles
 */
async function validateBuild(workers, paths = {}) {
  console.error('[build] Validating build output...');

  const configDistPath = paths.distPath || workersDistPath;
  const configTscPath = paths.tscPath || workersTscPath;

  const errors = [];
  const checkedFiles = [];

  for (const worker of workers) {
    // Determine expected entrypoint filename
    let entrypointFilename;
    if (worker.type === 'typescript') {
      entrypointFilename = 'index.js';
    } else {
      entrypointFilename = worker.entrypoint;
    }

    // Check 1: Verify worker entrypoint exists
    // Special case: launcher is in root launcher/ directory
    let entrypointPath;
    if (worker.name === 'launcher') {
      entrypointPath = join(rootDir, 'launcher', entrypointFilename);
    } else {
      entrypointPath = join(configDistPath, worker.name, entrypointFilename);
    }
    checkedFiles.push(entrypointPath);

    if (!await fileExists(entrypointPath)) {
      errors.push(`Missing entrypoint for ${worker.name}: ${entrypointPath}`);
    }

    // Check 2: Verify type definitions exist for TypeScript workers in out/tsc/workers/{worker-name}/
    if (worker.type === 'typescript') {
      // Type definitions are generated based on the source file structure
      // For src/index.ts -> src/index.d.ts
      // For {name}.ts -> {name}.d.ts
      const typeDefPath = worker.entrypoint.replace(/\.ts$/, '.d.ts');
      const typesPath = join(configTscPath, worker.name, typeDefPath);
      checkedFiles.push(typesPath);

      if (!await fileExists(typesPath)) {
        errors.push(`Missing type definitions for ${worker.name}: ${typesPath}`);
      }
    }

    // Check 3: Verify config files copied when present
    if (worker.hasConfig && worker.configFile) {
      const configPath = join(configDistPath, worker.name, worker.configFile);
      checkedFiles.push(configPath);

      // Verify it's actually a file (not a directory)
      try {
        const { stat } = await import('fs/promises');
        const stats = await stat(configPath);
        if (!stats.isFile()) {
          errors.push(`Config for ${worker.name} is not a file: ${configPath}`);
        }
      } catch (error) {
        errors.push(`Missing config file for ${worker.name}: ${configPath}`);
      }
    }
  }

  const success = errors.length === 0;

  if (success) {
    console.error(`[build] Validation passed: ${checkedFiles.length} file(s) verified`);
  } else {
    console.error(`[build] Validation failed with ${errors.length} error(s):`);
    errors.forEach(error => console.error(`  - ${error}`));
  }

  return {
    success,
    errors,
    checkedFiles
  };
}

/**
 * Generate workers index module
 * @param {Array} workers - Array of WorkerMetadata objects
 * @param {Object} options - Optional configuration for testing
 * @param {string} options.workersDistPath - Path to workers dist directory (defaults to module workersDistPath)
 * @returns {Promise<void>}
 */
async function generateWorkersIndex(workers, options = {}) {
  console.error('[build] Generating workers index module...');

  const { writeFile } = await import('fs/promises');

  // Use provided path or default
  const outputPath = options.workersDistPath || workersDistPath;

  // Build the workers object
  const workersObject = {};
  for (const worker of workers) {
    // Determine entrypoint path relative to index.js location
    let entrypointPath;
    if (worker.type === 'typescript') {
      entrypointPath = `./${worker.name}/index.js`;
    } else {
      entrypointPath = `./${worker.name}/${worker.entrypoint}`;
    }

    // Determine types path (relative to index.js, pointing to tsc output)
    let typesPath = null;
    if (worker.type === 'typescript') {
      // Types are in ../tsc/workers-registry/{worker-name}/
      const typeDefPath = worker.entrypoint.replace(/\.ts$/, '.d.ts');
      typesPath = `../tsc/workers-registry/${worker.name}/${typeDefPath}`;
    }

    // Determine config path
    let configPath = null;
    if (worker.hasConfig && worker.configFile) {
      configPath = `./${worker.name}/${worker.configFile}`;
    }

    workersObject[worker.name] = {
      entrypoint: entrypointPath,
      types: typesPath,
      config: configPath,
      type: worker.type
    };
  }

  // Generate index.js content
  const indexJsContent = `// Auto-generated by build script
export const workers = ${JSON.stringify(workersObject, null, 2)};
`;

  // Generate index.d.ts content
  const indexDtsContent = `// Auto-generated by build script
export interface WorkerInfo {
  entrypoint: string;
  types: string | null;
  config: string | null;
  type: 'typescript' | 'javascript';
}

export const workers: {
${workers.map(w => `  '${w.name}': WorkerInfo;`).join('\n')}
};
`;

  // Write index.js
  const indexJsPath = join(outputPath, 'index.js');
  await writeFile(indexJsPath, indexJsContent, 'utf8');
  console.error(`[build] Generated ${indexJsPath}`);

  // Write index.d.ts
  const indexDtsPath = join(outputPath, 'index.d.ts');
  await writeFile(indexDtsPath, indexDtsContent, 'utf8');
  console.error(`[build] Generated ${indexDtsPath}`);
}

/**
 * Clean the out/ directory
 * Removes all build artifacts from previous builds
 * @returns {Promise<void>}
 */
async function cleanOut() {
  console.error('[build] Cleaning out/ directory...');

  try {
    await rm(outPath, { recursive: true, force: true });
    console.error('[build] Cleaned out/ directory');
  } catch (error) {
    // If directory doesn't exist, that's fine
    if (error.code !== 'ENOENT') {
      throw new Error(`Failed to clean out/ directory: ${error.message}`);
    }
    console.error('[build] out/ directory does not exist (nothing to clean)');
  }
}

/**
 * Main build function
 */
async function buildPackage() {
  try {
    console.error('[build] Starting build process...');

    // Step 1: Clean previous build artifacts
    await cleanOut();

    // Step 2: Discover workers
    const workers = await discoverWorkers();

    // Step 3: Create output directories
    await mkdir(workersDistPath, { recursive: true });

    // Step 4: Build all workers with esbuild (parallel)
    console.error('[build] Compiling workers...');
    await Promise.all(workers.map(worker => buildWorkerWithEsbuild(worker)));

    // Step 5: Generate TypeScript type definitions
    const tsWorkers = workers.filter(w => w.type === 'typescript');
    if (tsWorkers.length > 0) {
      await generateTypeDefinitions(tsWorkers);
    }

    // Step 6: Generate workers index module
    await generateWorkersIndex(workers);

    // Step 7: Validate build output
    const validationResult = await validateBuild(workers);
    if (!validationResult.success) {
      throw new Error(`Build validation failed with ${validationResult.errors.length} error(s)`);
    }

    console.error('[build] Build completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('[ERROR] Build failed:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run build if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  buildPackage();
}

export {
  buildPackage,
  cleanOut,
  discoverWorkers,
  analyzeWorker,
  buildWorkerWithEsbuild,
  generateTypeDefinitions,
  generateWorkersIndex,
  copyWorkerConfigs,
  validateBuild,
  fileExists,
  findJsFiles,
  findEntrypoint,
  findConfigFile
};
