#!/usr/bin/env node

/**
 * Post-build script to prepare executable entry points.
 * Adds shebang and sets executable permissions.
 */

import { chmodSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = resolve(__dirname, '../dist');

const ENTRY_POINTS = [
  'index.js',
];

const SHEBANG = '#!/usr/bin/env node\n';

function prepareExecutable(relativePath) {
  const fullPath = resolve(DIST_DIR, relativePath);
  try {
    let content = readFileSync(fullPath, 'utf-8');
    if (!content.startsWith('#!')) {
      content = SHEBANG + content;
      writeFileSync(fullPath, content, 'utf-8');
      console.log(`[shebang] ${relativePath}`);
    } else {
      console.log(`[skip]    ${relativePath} (already has shebang)`);
    }
    chmodSync(fullPath, 0o755);
    console.log(`[chmod]   ${relativePath} -> 755`);
  } catch (err) {
    console.error(`[error]   ${relativePath}: ${err.message}`);
    process.exit(1);
  }
}

console.log('Preparing executable entry points...\n');
for (const entryPoint of ENTRY_POINTS) {
  prepareExecutable(entryPoint);
}
console.log('Done.');
