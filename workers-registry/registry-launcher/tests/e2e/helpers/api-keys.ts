/*
 * Apache License 2.0
 * Copyright (c) 2025–present Raman Marozau, Target Insight Function.
 */

/**
 * Helpers for managing temporary api-keys.json files in E2E tests.
 *
 * Creates and cleans up temporary api-keys.json files with configurable
 * agent credentials for testing the production launcher binary.
 *
 * IMPORTANT: This module works ONLY with the production binary (dist/).
 * No imports from src/ are allowed.
 *
 * @module tests/e2e/helpers/api-keys
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** Configuration for a single agent's API key entry. */
export interface AgentApiKeyConfig {
  /** API key value */
  apiKey?: string;
  /** Environment variables to inject into the agent process */
  env?: Record<string, string>;
}

/**
 * Helper for creating and managing temporary api-keys.json files.
 *
 * Tracks all created temp directories for cleanup.
 */
export class ApiKeysHelper {
  private tempDirs: string[] = [];

  /**
   * Create a temporary api-keys.json file with the given agent configs.
   *
   * @param agents - Map of agent ID to API key configuration.
   * @returns Absolute path to the created api-keys.json file.
   */
  createApiKeysFile(agents: Record<string, AgentApiKeyConfig>): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-api-keys-'));
    this.tempDirs.push(dir);

    const filePath = path.join(dir, 'api-keys.json');
    const content = {
      version: '1.0.0',
      agents,
    };

    fs.writeFileSync(filePath, JSON.stringify(content, null, 2), 'utf8');
    return filePath;
  }

  /**
   * Create an empty api-keys.json (no agents configured).
   *
   * @returns Absolute path to the created api-keys.json file.
   */
  createEmptyApiKeysFile(): string {
    return this.createApiKeysFile({});
  }

  /**
   * Clean up all temporary files and directories created by this helper.
   */
  cleanup(): void {
    for (const dir of this.tempDirs) {
      try {
        if (fs.existsSync(dir)) {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      } catch (err) {
        console.error(
          `[e2e-harness] Failed to clean up temp dir ${dir}: ${(err as Error).message}`,
        );
      }
    }
    this.tempDirs = [];
  }
}
