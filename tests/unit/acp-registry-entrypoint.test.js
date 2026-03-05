import { describe, it, expect } from '@jest/globals';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const entrypointPath = join(__dirname, '../../workers-registry/acp-registry/index.js');

describe('acp-registry entrypoint', () => {
  it('points to the registry launcher and injects default config', async () => {
    const content = await readFile(entrypointPath, 'utf8');
    expect(content).toContain('registry-launcher');
    expect(content).toContain('acp-registry-config.json');
  });
});
