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
 * Post-build script to prepare executable entry points.
 *
 * This script:
 * 1. Adds shebang (#!/usr/bin/env node) to configured entry points
 * 2. Sets executable permissions (chmod +x)
 *
 * Configuration is declarative - add/remove entry points in ENTRY_POINTS array.
 */

import { chmodSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = resolve(__dirname, '../dist');

/**
 * ENTRY POINTS CONFIGURATION
 *
 * Add paths relative to dist/ for files that should be executable.
 * These files will get:
 * - Shebang: #!/usr/bin/env node
 * - Permissions: -rwxr-xr-x (755)
 */
const ENTRY_POINTS = [
  'index.js',                           // Main worker entry point
  'mcp-proxy/index.js',                 // MCP-ACP Proxy entry point
];

const SHEBANG = '#!/usr/bin/env node\n';

function prepareExecutable(relativePath) {
  const fullPath = resolve(DIST_DIR, relativePath);

  try {
    let content = readFileSync(fullPath, 'utf-8');

    // Add shebang if not present
    if (!content.startsWith('#!')) {
      content = SHEBANG + content;
      writeFileSync(fullPath, content, 'utf-8');
      console.log(`[shebang] ${relativePath}`);
    } else {
      console.log(`[skip]    ${relativePath} (already has shebang)`);
    }

    // Set executable permissions (755)
    chmodSync(fullPath, 0o755);
    console.log(`[chmod]   ${relativePath} -> 755`);

  } catch (err) {
    console.error(`[error]   ${relativePath}: ${err.message}`);
    process.exit(1);
  }
}

console.log('Preparing executable entry points...\n');
console.log(`Entry points configured: ${ENTRY_POINTS.length}`);
console.log('---');

for (const entryPoint of ENTRY_POINTS) {
  prepareExecutable(entryPoint);
}

console.log('---');
console.log('Done.');
