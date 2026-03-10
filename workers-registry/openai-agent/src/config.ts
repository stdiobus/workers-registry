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

import { AgentConfig } from './types.js';

export function loadConfig(): AgentConfig {
  const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  const apiKey = process.env.OPENAI_API_KEY || '';
  const model = process.env.OPENAI_MODEL || 'gpt-4o';
  const systemPrompt = process.env.OPENAI_SYSTEM_PROMPT || undefined;

  let maxTokens: number | undefined;
  const maxTokensStr = process.env.OPENAI_MAX_TOKENS;
  if (maxTokensStr !== undefined) {
    const parsed = parseInt(maxTokensStr, 10);
    maxTokens = Number.isNaN(parsed) ? undefined : parsed;
  }

  let temperature: number | undefined;
  const temperatureStr = process.env.OPENAI_TEMPERATURE;
  if (temperatureStr !== undefined) {
    const parsed = parseFloat(temperatureStr);
    temperature = Number.isNaN(parsed) ? undefined : parsed;
  }

  if (!apiKey) {
    console.error('[openai-agent] Warning: OPENAI_API_KEY is not set. This may be fine for local endpoints like Ollama.');
  }

  return { baseUrl, apiKey, model, systemPrompt, maxTokens, temperature };
}
