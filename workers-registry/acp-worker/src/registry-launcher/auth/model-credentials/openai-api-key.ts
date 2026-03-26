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
 * OpenAI API Key Handler.
 *
 * Handles storage, retrieval, validation, and injection of OpenAI API keys.
 * OpenAI uses the Authorization header with Bearer token format.
 *
 * Requirements: 7b.1, 7b.4, 7b.5
 *
 * @module model-credentials/openai-api-key
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

// =============================================================================
// Constants
// =============================================================================

/**
 * The provider ID for OpenAI.
 */
export const OPENAI_PROVIDER_ID: ModelProviderId = 'openai';

/**
 * OpenAI API key prefix for validation.
 * OpenAI API keys typically start with 'sk-'.
 */
export const OPENAI_API_KEY_PREFIX = 'sk-';

/**
 * Minimum length for OpenAI API keys.
 * OpenAI keys are typically 51+ characters.
 */
export const OPENAI_API_KEY_MIN_LENGTH = 20;

/**
 * Storage key prefix for OpenAI credentials.
 */
export const OPENAI_STORAGE_KEY = 'model-credential:openai';

// =============================================================================
// Storage Interface
// =============================================================================

/**
 * Interface for credential storage operations.
 * This allows the handler to work with any storage backend.
 */
export interface IModelCredentialStorage {
  /**
   * Store a model credential.
   * @param key - The storage key
   * @param credential - The credential to store
   */
  store(key: string, credential: StoredModelCredential): Promise<void>;

  /**
   * Retrieve a model credential.
   * @param key - The storage key
   * @returns The stored credential or null if not found
   */
  retrieve(key: string): Promise<StoredModelCredential | null>;

  /**
   * Delete a model credential.
   * @param key - The storage key
   */
  delete(key: string): Promise<void>;

  /**
   * Check if a credential exists.
   * @param key - The storage key
   * @returns True if the credential exists
   */
  exists(key: string): Promise<boolean>;
}

// =============================================================================
// OpenAI API Key Handler
// =============================================================================

/**
 * OpenAI API Key Handler.
 *
 * Provides methods for storing, retrieving, validating, and injecting
 * OpenAI API keys. Integrates with the Credential_Store for secure storage.
 *
 * Requirements: 7b.1, 7b.4, 7b.5
 */
export class OpenAIApiKeyHandler {
  private readonly storage: IModelCredentialStorage;

  /**
   * Create a new OpenAI API key handler.
   * @param storage - The credential storage backend
   */
  constructor(storage: IModelCredentialStorage) {
    this.storage = storage;
  }

  /**
   * Get the provider ID for this handler.
   * @returns The OpenAI provider ID
   */
  getProviderId(): ModelProviderId {
    return OPENAI_PROVIDER_ID;
  }

  /**
   * Get the injection configuration for OpenAI.
   *
   * OpenAI uses the Authorization header with Bearer token format:
   * Authorization: Bearer {key}
   *
   * Requirements: 7b.5
   *
   * @returns The header injection configuration
   */
  getInjectionConfig(): HeaderInjection {
    return MODEL_CREDENTIAL_INJECTION_CONFIG.openai;
  }

  /**
   * Validate an OpenAI API key format.
   *
   * Performs basic format validation:
   * - Must be a non-empty string
   * - Must meet minimum length requirement
   * - Optionally checks for 'sk-' prefix (warning only)
   *
   * Note: This does not validate the key against OpenAI's API.
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

    if (trimmedKey.length < OPENAI_API_KEY_MIN_LENGTH) {
      return { valid: false };
    }

    // Check for expected prefix (warning only, not a hard requirement)
    if (!trimmedKey.startsWith(OPENAI_API_KEY_PREFIX)) {
      return {
        valid: true,
        warning: `API key does not start with expected prefix '${OPENAI_API_KEY_PREFIX}'`,
      };
    }

    return { valid: true };
  }

  /**
   * Store an OpenAI API key in the credential store.
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
      throw new Error('Invalid OpenAI API key format');
    }

    const credential: StoredModelCredential = {
      providerId: OPENAI_PROVIDER_ID,
      apiKey: apiKey.trim(),
      label,
      storedAt: Date.now(),
    };

    await this.storage.store(OPENAI_STORAGE_KEY, credential);
  }

  /**
   * Retrieve the stored OpenAI API key.
   *
   * Requirements: 7b.4
   *
   * @returns The credential result with the API key if found
   */
  async retrieve(): Promise<ModelCredentialResult> {
    try {
      const stored = await this.storage.retrieve(OPENAI_STORAGE_KEY);

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
   * Delete the stored OpenAI API key.
   *
   * @returns Promise that resolves when deleted
   */
  async delete(): Promise<void> {
    await this.storage.delete(OPENAI_STORAGE_KEY);
  }

  /**
   * Check if an OpenAI API key is configured.
   *
   * @returns True if a valid API key is stored
   */
  async isConfigured(): Promise<boolean> {
    const result = await this.retrieve();
    return result.found;
  }

  /**
   * Get the status of the OpenAI API key credential.
   *
   * @returns The credential status entry
   */
  async getStatus(): Promise<ModelCredentialStatusEntry> {
    const result = await this.retrieve();

    if (!result.found) {
      return {
        providerId: OPENAI_PROVIDER_ID,
        status: 'not-configured',
      };
    }

    const credential = result.credential!;

    // Check for expiration
    if (credential.expiresAt && credential.expiresAt < Date.now()) {
      return {
        providerId: OPENAI_PROVIDER_ID,
        status: 'expired',
        label: credential.label,
        storedAt: credential.storedAt,
        expiresAt: credential.expiresAt,
      };
    }

    return {
      providerId: OPENAI_PROVIDER_ID,
      status: 'configured',
      label: credential.label,
      storedAt: credential.storedAt,
      expiresAt: credential.expiresAt,
    };
  }

  /**
   * Inject the OpenAI API key into request headers.
   *
   * Creates the Authorization header with Bearer token format:
   * Authorization: Bearer {key}
   *
   * Requirements: 7b.5
   *
   * @param headers - Existing headers object (will be modified)
   * @returns The headers object with the Authorization header added
   * @throws Error if no API key is configured
   */
  async injectHeader(headers: Record<string, string> = {}): Promise<Record<string, string>> {
    const result = await this.retrieve();

    if (!result.found || !result.credential) {
      throw new Error('No OpenAI API key configured');
    }

    const injection = this.getInjectionConfig();
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
      throw new Error('No OpenAI API key configured');
    }

    const injection = this.getInjectionConfig();
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
 * Create a new OpenAI API key handler.
 *
 * @param storage - The credential storage backend
 * @returns A new OpenAI API key handler instance
 */
export function createOpenAIApiKeyHandler(storage: IModelCredentialStorage): OpenAIApiKeyHandler {
  return new OpenAIApiKeyHandler(storage);
}
