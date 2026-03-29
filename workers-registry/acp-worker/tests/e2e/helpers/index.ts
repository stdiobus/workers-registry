/*
 * Apache License 2.0
 * Copyright (c) 2025–present Raman Marozau, Target Insight Function.
 */

/**
 * E2E test helper infrastructure.
 *
 * Provides helpers for spawning the production launcher binary,
 * serving mock registries, and managing temporary api-keys files.
 *
 * IMPORTANT: These helpers work ONLY with the production binary (dist/).
 * No imports from src/ are allowed.
 *
 * @module tests/e2e/helpers
 */

export { LauncherHarness } from './launcher-harness.js';
export type { LauncherOptions } from './launcher-harness.js';

export { MockRegistryServer } from './registry-server.js';
export type { MockAgent } from './registry-server.js';

export { ApiKeysHelper } from './api-keys.js';
export type { AgentApiKeyConfig } from './api-keys.js';
