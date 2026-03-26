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
 * Anthropic API Key Handler.
 *
 * Handles storage, retrieval, validation, and injection of Anthropic API keys.
 * Anthropic uses the x-api-key header with the raw key (no Bearer prefix).
 *
 * Requirements: 7b.1, 7b.4, 7b.5
 *
 * @module model-credentials/anthropic-api-key
 */

import type {
  ModelCredential,
  ModelProviderId,
  StoredModelCredential,
  ModelCredentialResult,
  ModelCredentialStatusEntry,
  HeaderInjection,
} from './types.js';
import { MODEL_CREDENTIAL_INJECTION_CONFIG } from './types.js';
import type { IModelCredentialStorage } from './openai-api-key.js';

// =============================================================================
// Constants
// =============================================================================

/**
 * The provider ID for Anthropic.
 */
export const ANTHROPIC_PROVIDER_ID: ModelProviderId = 'anthropic';

/**
 * Anthropic API key prefix for validation.
 * Anthropic API keys typically start with 'sk-ant-'.
 */
export const ANTHROPIC_API_KEY_PREFIX = 'sk-ant-';

/**
 * Minimum length for Anthropic API keys.
 * Anthropic keys are typically 40+ characters.
 */
export const ANTHROPIC_API_KEY_MIN_LENGTH = 20;

/**
 * Storage key prefix for Anthropic credentials.
 */
export const ANTHROPIC_STORAGE_KEY = 'model-credential:anthropic';

// =============================================================================
// Anthropic API Key Handler
// =============================================================================

/**
 * Anthropic API Key Handler.
 *
 * Provides methods for storing, retrieving, validating, and injecting
 * Anthropic API keys. Integrates with the Credential_Store for secure storage.
 *
 * Requirements: 7b.1, 7b.4, 7b.5
 */
export class AnthropicApiKeyHandler {
  private readonly storage: IModelCredentialStorage;

  /**
   * Create a new Anthropic API key handler.
   * @param storage - The credential storage backend
   */
  constructor(storage: IModelCredentialStorage) {
    this.storage = storage;
  }

  /**
   * Get the provider ID for this handler.
   * @returns The Anthropic provider ID
   */
  getProviderId(): ModelProviderId {
    return ANTHROPIC_PROVIDER_ID;
  }

  /**
   * Get the injection configuration for Anthropic.
   *
   * Anthropic uses the x-api-key header with the raw key:
   * x-api-key: {key}
   *
   * Requirements: 7b.5
   *
   * @returns The header injection configuration
   */
  getInjectionConfig(): HeaderInjection {
    return MODEL_CREDENTIAL_INJECTION_CONFIG.anthropic;
  }

  /**
   * Validate an Anthropic API key format.
   *
   * Performs basic format validation:
   * - Must be a non-empty string
   * - Must meet minimum length requirement
   * - Optionally checks for 'sk-ant-' prefix (warning only)
   *
   * Note: This does not validate the key against Anthropic's API.
   * Use validateWithApi() for full validation.
   *
   * @param apiKey - The API key to validate
   * @returns Validation result with success flag and optional warning
   */
  validateFormat(apiKey: string): { valid: boolean; warning?: string } {
    if (!apiKey || typeof apiKey !== 'string') {
      return { valid: false };
    }

    const trimmedKey = apiKey.trim();

    if (trimmedKey.length < ANTHROPIC_API_KEY_MIN_LENGTH) {
      return { valid: false };
    }

    // Check for expected prefix (warning only, not a hard requirement)
    if (!trimmedKey.startsWith(ANTHROPIC_API_KEY_PREFIX)) {
      return {
        valid: true,
        warning: `API key does not start with expected prefix '${ANTHROPIC_API_KEY_PREFIX}'`,
      };
    }

    return { valid: true };
  }

  /**
   * Store an Anthropic API key in the credential store.
   *
   * The key is stored with encryption handled by the storage backend.
   *
   * Requirements: 7b.4
   *
   * @param apiKey - The API key to store
   * @param label - Optional human-readable label
   * @returns Promise that resolves when stored
   * @throws Error if the API key format is invalid
   */
  async store(apiKey: string, label?: string): Promise<void> {
    const validation = this.validateFormat(apiKey);
    if (!validation.valid) {
      throw new Error('Invalid Anthropic API key format');
    }

    const credential: StoredModelCredential = {
      providerId: ANTHROPIC_PROVIDER_ID,
      apiKey: apiKey.trim(),
      label,
      storedAt: Date.now(),
    };

    await this.storage.store(ANTHROPIC_STORAGE_KEY, credential);
  }

  /**
   * Retrieve the stored Anthropic API key.
   *
   * Requirements: 7b.4
   *
   * @returns The credential result with the API key if found
   */
  async retrieve(): Promise<ModelCredentialResult> {
    try {
      const stored = await this.storage.retrieve(ANTHROPIC_STORAGE_KEY);

      if (!stored) {
        return { found: false };
      }

      // Check for expiration if set
      if (stored.expiresAt && stored.expiresAt < Date.now()) {
        return {
          found: false,
          error: 'API key has expired',
        };
      }

      const credential: ModelCredential = {
        providerId: stored.providerId,
        apiKey: stored.apiKey,
        label: stored.label,
        storedAt: stored.storedAt,
        expiresAt: stored.expiresAt,
      };

      return { found: true, credential };
    } catch (error) {
      return {
        found: false,
        error: error instanceof Error ? error.message : 'Failed to retrieve credential',
      };
    }
  }

  /**
   * Delete the stored Anthropic API key.
   *
   * @returns Promise that resolves when deleted
   */
  async delete(): Promise<void> {
    await this.storage.delete(ANTHROPIC_STORAGE_KEY);
  }

  /**
   * Check if an Anthropic API key is configured.
   *
   * @returns True if a valid API key is stored
   */
  async isConfigured(): Promise<boolean> {
    const result = await this.retrieve();
    return result.found;
  }

  /**
   * Get the status of the Anthropic API key credential.
   *
   * @returns The credential status entry
   */
  async getStatus(): Promise<ModelCredentialStatusEntry> {
    const result = await this.retrieve();

    if (!result.found) {
      return {
        providerId: ANTHROPIC_PROVIDER_ID,
        status: 'not-configured',
      };
    }

    const credential = result.credential!;

    // Check for expiration
    if (credential.expiresAt && credential.expiresAt < Date.now()) {
      return {
        providerId: ANTHROPIC_PROVIDER_ID,
        status: 'expired',
        label: credential.label,
        storedAt: credential.storedAt,
        expiresAt: credential.expiresAt,
      };
    }

    return {
      providerId: ANTHROPIC_PROVIDER_ID,
      status: 'configured',
      label: credential.label,
      storedAt: credential.storedAt,
      expiresAt: credential.expiresAt,
    };
  }

  /**
   * Inject the Anthropic API key into request headers.
   *
   * Creates the x-api-key header with the raw key:
   * x-api-key: {key}
   *
   * Requirements: 7b.5
   *
   * @param headers - Existing headers object (will be modified)
   * @returns The headers object with the x-api-key header added
   * @throws Error if no API key is configured
   */
  async injectHeader(headers: Record<string, string> = {}): Promise<Record<string, string>> {
    const result = await this.retrieve();

    if (!result.found || !result.credential) {
      throw new Error('No Anthropic API key configured');
    }

    const injection = this.getInjectionConfig();
    // Anthropic uses raw key without format transformation
    const headerValue = injection.format
      ? injection.format.replace('{key}', result.credential.apiKey)
      : result.credential.apiKey;

    return {
      ...headers,
      [injection.headerName]: headerValue,
    };
  }

  /**
   * Get the header injection for a request.
   *
   * Returns the header name and value for injecting the API key.
   * This is useful when you need the header separately from the request.
   *
   * Requirements: 7b.5
   *
   * @returns Object with headerName and headerValue
   * @throws Error if no API key is configured
   */
  async getHeaderInjection(): Promise<{ headerName: string; headerValue: string }> {
    const result = await this.retrieve();

    if (!result.found || !result.credential) {
      throw new Error('No Anthropic API key configured');
    }

    const injection = this.getInjectionConfig();
    // Anthropic uses raw key without format transformation
    const headerValue = injection.format
      ? injection.format.replace('{key}', result.credential.apiKey)
      : result.credential.apiKey;

    return {
      headerName: injection.headerName,
      headerValue,
    };
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new Anthropic API key handler.
 *
 * @param storage - The credential storage backend
 * @returns A new Anthropic API key handler instance
 */
export function createAnthropicApiKeyHandler(storage: IModelCredentialStorage): AnthropicApiKeyHandler {
  return new AnthropicApiKeyHandler(storage);
}
