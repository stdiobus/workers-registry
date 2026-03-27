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

export { LauncherHarness } from './launcher-harness';
export type { LauncherOptions } from './launcher-harness';

export { MockRegistryServer } from './registry-server';
export type { MockAgent } from './registry-server';

export { ApiKeysHelper } from './api-keys';
export type { AgentApiKeyConfig } from './api-keys';
