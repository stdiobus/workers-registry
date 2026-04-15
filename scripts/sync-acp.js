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
 * ACP Registry Sync Script
 *
 * Fetches the latest ACP Registry and synchronizes the local api-keys.json
 * to ensure all registered agents have entries. Existing keys and env values
 * are preserved — only new agents are added with empty defaults.
 *
 * Exit codes:
 *   0 - No changes needed (api-keys.json is already up to date)
 *   1 - Changes were made (new agents added to api-keys.json)
 *   2 - Error occurred (fetch failure, parse error, etc.)
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

/** Default ACP Registry URL */
const REGISTRY_URL = process.env.ACP_REGISTRY_URL
  || 'https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json';

/** Path to local api-keys.json */
const API_KEYS_PATH = join(rootDir, 'api-keys.json');

/**
 * Fetch the ACP Registry from the remote URL.
 * @returns {Promise<Object>} Parsed registry JSON
 */
async function fetchRegistry() {
  console.error(`[sync-acp] Fetching registry from ${REGISTRY_URL}`);

  const response = await fetch(REGISTRY_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch registry: HTTP ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  if (!data || !Array.isArray(data.agents)) {
    throw new Error('Invalid registry format: missing "agents" array');
  }

  console.error(`[sync-acp] Registry loaded: version ${data.version}, ${data.agents.length} agents`);
  return data;
}

/**
 * Load the local api-keys.json file.
 * @returns {Object} Parsed api-keys data
 */
function loadApiKeys() {
  try {
    const content = readFileSync(API_KEYS_PATH, 'utf-8');
    const parsed = JSON.parse(content);

    if (!parsed.agents || typeof parsed.agents !== 'object') {
      console.error('[sync-acp] Warning: api-keys.json has no valid "agents" object, initializing empty');
      return { agents: {}, version: parsed.version || '1.0.0' };
    }

    return parsed;
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.error('[sync-acp] api-keys.json not found, creating new file');
      return { agents: {}, version: '1.0.0' };
    }
    throw error;
  }
}

/**
 * Build the default agent entry for api-keys.json.
 * Preserves any default env vars from the registry distribution.
 *
 * @param {Object} agent - Registry agent entry
 * @returns {Object} Default api-keys entry
 */
function buildDefaultEntry(agent) {
  const env = {};

  // Extract default env vars from distribution methods
  const distribution = agent.distribution || {};

  for (const distType of ['npx', 'uvx']) {
    const dist = distribution[distType];
    if (dist && dist.env && typeof dist.env === 'object') {
      Object.assign(env, dist.env);
    }
  }

  // Binary distributions may also have env vars (use first platform found)
  if (distribution.binary && typeof distribution.binary === 'object') {
    for (const target of Object.values(distribution.binary)) {
      if (target && target.env && typeof target.env === 'object') {
        Object.assign(env, target.env);
        break; // Use env from first platform only
      }
    }
  }

  return { apiKey: '', env };
}

/**
 * Synchronize api-keys.json with the ACP Registry.
 *
 * - Adds new agents from the registry with empty apiKey and default env
 * - Preserves existing agent entries (keys and env values are never overwritten)
 * - Removes agents that are no longer in the registry (cleanup)
 * - Sorts agents alphabetically for consistent diffs
 *
 * @returns {Promise<void>}
 */
async function syncAcp() {
  // Fetch remote registry
  const registry = await fetchRegistry();

  // Load local api-keys
  const apiKeys = loadApiKeys();

  // Build set of registry agent IDs
  const registryAgentIds = new Set();
  const registryAgentsMap = new Map();

  for (const agent of registry.agents) {
    if (agent.id && typeof agent.id === 'string') {
      registryAgentIds.add(agent.id);
      registryAgentsMap.set(agent.id, agent);
    }
  }

  // Track changes
  const added = [];
  const removed = [];

  // Add new agents from registry
  for (const [agentId, agent] of registryAgentsMap) {
    if (!apiKeys.agents[agentId]) {
      apiKeys.agents[agentId] = buildDefaultEntry(agent);
      added.push(agentId);
    }
  }

  // Remove agents no longer in registry
  for (const agentId of Object.keys(apiKeys.agents)) {
    if (!registryAgentIds.has(agentId)) {
      delete apiKeys.agents[agentId];
      removed.push(agentId);
    }
  }

  // Sort agents alphabetically for consistent output
  const sortedAgents = {};
  for (const key of Object.keys(apiKeys.agents).sort()) {
    sortedAgents[key] = apiKeys.agents[key];
  }
  apiKeys.agents = sortedAgents;

  // Report changes
  const hasChanges = added.length > 0 || removed.length > 0;

  if (added.length > 0) {
    console.error(`[sync-acp] Added ${added.length} new agent(s): ${added.join(', ')}`);
  }

  if (removed.length > 0) {
    console.error(`[sync-acp] Removed ${removed.length} stale agent(s): ${removed.join(', ')}`);
  }

  if (!hasChanges) {
    console.error(`[sync-acp] No changes needed — api-keys.json is up to date (${Object.keys(apiKeys.agents).length} agents)`);
    process.exit(0);
  }

  // Write updated api-keys.json
  writeFileSync(API_KEYS_PATH, JSON.stringify(apiKeys, null, 2) + '\n', 'utf-8');
  console.error(`[sync-acp] Updated api-keys.json (${Object.keys(apiKeys.agents).length} agents total)`);

  // Exit with code 1 to signal changes were made (used by CI workflow)
  process.exit(1);
}

// Run
syncAcp().catch((error) => {
  console.error(`[sync-acp] Error: ${error.message}`);
  process.exit(2);
});
