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
 * Registry Launcher worker entrypoint.
 *
 * Ensures a default config file is passed when none is provided,
 * then loads the Registry Launcher implementation.
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_CONFIG_FILE = 'acp-registry-config.json';

function ensureDefaultConfigArg() {
  const hasExplicitConfig = process.argv.length > 2 && process.argv[2] && !process.argv[2].startsWith('-');
  if (hasExplicitConfig) {
    return;
  }

  const defaultConfigPath = join(__dirname, DEFAULT_CONFIG_FILE);
  process.argv.splice(2, 0, defaultConfigPath);
}

ensureDefaultConfigArg();

// Load the real Registry Launcher implementation
await import('../acp-worker/src/registry-launcher/index.ts');
