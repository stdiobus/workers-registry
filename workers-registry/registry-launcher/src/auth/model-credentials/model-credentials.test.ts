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
 * Unit tests for Model Credentials module.
 *
 * Tests API key storage, retrieval, header injection, and separation from OAuth flow.
 *
 * **Validates: Requirements 7b.1-7b.5**
 *
 * @module model-credentials.test
 */

import {
  OpenAIApiKeyHandler,
  createOpenAIApiKeyHandler,
  OPENAI_PROVIDER_ID,
  OPENAI_API_KEY_PREFIX,
  OPENAI_API_KEY_MIN_LENGTH,
  OPENAI_STORAGE_KEY,
} from './openai-api-key';

import {
  AnthropicApiKeyHandler,
  createAnthropicApiKeyHandler,
  ANTHROPIC_PROVIDER_ID,
  ANTHROPIC_API_KEY_PREFIX,
  ANTHROPIC_API_KEY_MIN_LENGTH,
  ANTHROPIC_STORAGE_KEY,
} from './anthropic-api-key';

import type { IModelCredentialStorage } from './openai-api-key';
import type { StoredModelCredential } from './types';

import {
  isValidModelProviderId,
  VALID_MODEL_PROVIDER_IDS,
  MODEL_CREDENTIAL_INJECTION_CONFIG,
} from './types';

// =============================================================================
// Mock Storage Implementation
// =============================================================================

/**
 * Mock implementation of IModelCredentialStorage for testing.
 */
class MockModelCredentialStorage implements IModelCredentialStorage {
  private _storage = new Map<string, StoredModelCredential>();

  async store(key: string, credential: StoredModelCredential): Promise<void> {
    this._storage.set(key, { ...credential });
  }

  async retrieve(key: string): Promise<StoredModelCredential | null> {
    const cred = this._storage.get(key);
    return cred ? { ...cred } : null;
  }

  async delete(key: string): Promise<void> {
    this._storage.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    return this._storage.has(key);
  }

  // Test helper methods
  clear(): void {
    this._storage.clear();
  }

  size(): number {
    return this._storage.size;
  }
}

// =============================================================================
// Type Validation Tests
// =============================================================================

describe('Model Credentials Type Validation', () => {
  describe('isValidModelProviderId', () => {
    it('should return true for valid provider IDs', () => {
      expect(isValidModelProviderId('openai')).toBe(true);
      expect(isValidModelProviderId('anthropic')).toBe(true);
    });

    it('should return false for invalid provider IDs', () => {
      expect(isValidModelProviderId('invalid')).toBe(false);
      expect(isValidModelProviderId('google')).toBe(false);
      expect(isValidModelProviderId('github')).toBe(false);
      expect(isValidModelProviderId('')).toBe(false);
    });

    it('should return false for non-string values', () => {
      expect(isValidModelProviderId(null)).toBe(false);
      expect(isValidModelProviderId(undefined)).toBe(false);
      expect(isValidModelProviderId(123)).toBe(false);
      expect(isValidModelProviderId({})).toBe(false);
      expect(isValidModelProviderId([])).toBe(false);
    });
  });

  describe('VALID_MODEL_PROVIDER_IDS', () => {
    it('should contain openai and anthropic', () => {
      expect(VALID_MODEL_PROVIDER_IDS).toContain('openai');
      expect(VALID_MODEL_PROVIDER_IDS).toContain('anthropic');
    });

    it('should have exactly 2 providers', () => {
      expect(VALID_MODEL_PROVIDER_IDS.length).toBe(2);
    });
  });

  describe('MODEL_CREDENTIAL_INJECTION_CONFIG', () => {
    it('should have correct OpenAI configuration', () => {
      const openaiConfig = MODEL_CREDENTIAL_INJECTION_CONFIG.openai;
      expect(openaiConfig.type).toBe('header');
      expect(openaiConfig.headerName).toBe('Authorization');
      expect(openaiConfig.format).toBe('Bearer {key}');
    });

    it('should have correct Anthropic configuration', () => {
      const anthropicConfig = MODEL_CREDENTIAL_INJECTION_CONFIG.anthropic;
      expect(anthropicConfig.type).toBe('header');
      expect(anthropicConfig.headerName).toBe('x-api-key');
      expect(anthropicConfig.format).toBeUndefined();
    });
  });
});


// =============================================================================
// OpenAI API Key Handler Tests
// =============================================================================

describe('OpenAI API Key Handler', () => {
  let storage: MockModelCredentialStorage;
  let handler: OpenAIApiKeyHandler;

  beforeEach(() => {
    storage = new MockModelCredentialStorage();
    handler = new OpenAIApiKeyHandler(storage);
  });

  afterEach(() => {
    storage.clear();
  });

  describe('Constants', () => {
    it('should have correct provider ID', () => {
      expect(OPENAI_PROVIDER_ID).toBe('openai');
    });

    it('should have correct API key prefix', () => {
      expect(OPENAI_API_KEY_PREFIX).toBe('sk-');
    });

    it('should have correct minimum key length', () => {
      expect(OPENAI_API_KEY_MIN_LENGTH).toBe(20);
    });

    it('should have correct storage key', () => {
      expect(OPENAI_STORAGE_KEY).toBe('model-credential:openai');
    });
  });

  describe('getProviderId', () => {
    it('should return openai provider ID', () => {
      expect(handler.getProviderId()).toBe('openai');
    });
  });

  describe('getInjectionConfig', () => {
    it('should return correct injection configuration', () => {
      const config = handler.getInjectionConfig();
      expect(config.type).toBe('header');
      expect(config.headerName).toBe('Authorization');
      expect(config.format).toBe('Bearer {key}');
    });
  });

  describe('validateFormat', () => {
    it('should validate keys with sk- prefix and sufficient length', () => {
      const validKey = 'sk-' + 'a'.repeat(50);
      const result = handler.validateFormat(validKey);
      expect(result.valid).toBe(true);
      expect(result.warning).toBeUndefined();
    });

    it('should return valid with warning for keys without sk- prefix', () => {
      const keyWithoutPrefix = 'a'.repeat(50);
      const result = handler.validateFormat(keyWithoutPrefix);
      expect(result.valid).toBe(true);
      expect(result.warning).toContain('sk-');
    });

    it('should reject keys that are too short', () => {
      const shortKey = 'sk-short';
      const result = handler.validateFormat(shortKey);
      expect(result.valid).toBe(false);
    });

    it('should reject empty strings', () => {
      expect(handler.validateFormat('').valid).toBe(false);
    });

    it('should reject null/undefined values', () => {
      expect(handler.validateFormat(null as unknown as string).valid).toBe(false);
      expect(handler.validateFormat(undefined as unknown as string).valid).toBe(false);
    });

    it('should reject non-string values', () => {
      expect(handler.validateFormat(123 as unknown as string).valid).toBe(false);
      expect(handler.validateFormat({} as unknown as string).valid).toBe(false);
    });

    it('should trim whitespace before validation', () => {
      const keyWithWhitespace = '  sk-' + 'a'.repeat(50) + '  ';
      const result = handler.validateFormat(keyWithWhitespace);
      expect(result.valid).toBe(true);
    });

    it('should validate minimum length boundary', () => {
      // Exactly at minimum length
      const minLengthKey = 'a'.repeat(OPENAI_API_KEY_MIN_LENGTH);
      expect(handler.validateFormat(minLengthKey).valid).toBe(true);

      // One below minimum length
      const belowMinKey = 'a'.repeat(OPENAI_API_KEY_MIN_LENGTH - 1);
      expect(handler.validateFormat(belowMinKey).valid).toBe(false);
    });
  });


  describe('store and retrieve', () => {
    const validApiKey = 'sk-' + 'a'.repeat(50);

    it('should store and retrieve API key successfully', async () => {
      await handler.store(validApiKey);
      const result = await handler.retrieve();

      expect(result.found).toBe(true);
      expect(result.credential).toBeDefined();
      expect(result.credential!.apiKey).toBe(validApiKey);
      expect(result.credential!.providerId).toBe('openai');
    });

    it('should store API key with label', async () => {
      await handler.store(validApiKey, 'My OpenAI Key');
      const result = await handler.retrieve();

      expect(result.found).toBe(true);
      expect(result.credential!.label).toBe('My OpenAI Key');
    });

    it('should set storedAt timestamp', async () => {
      const beforeStore = Date.now();
      await handler.store(validApiKey);
      const afterStore = Date.now();

      const result = await handler.retrieve();
      expect(result.credential!.storedAt).toBeGreaterThanOrEqual(beforeStore);
      expect(result.credential!.storedAt).toBeLessThanOrEqual(afterStore);
    });

    it('should return not found when no key stored', async () => {
      const result = await handler.retrieve();
      expect(result.found).toBe(false);
      expect(result.credential).toBeUndefined();
    });

    it('should reject invalid format on store', async () => {
      await expect(handler.store('invalid-short')).rejects.toThrow('Invalid OpenAI API key format');
    });

    it('should trim whitespace when storing', async () => {
      const keyWithWhitespace = '  ' + validApiKey + '  ';
      await handler.store(keyWithWhitespace);
      const result = await handler.retrieve();

      expect(result.credential!.apiKey).toBe(validApiKey);
    });

    it('should overwrite existing key on re-store', async () => {
      const firstKey = 'sk-' + 'a'.repeat(50);
      const secondKey = 'sk-' + 'b'.repeat(50);

      await handler.store(firstKey);
      await handler.store(secondKey);

      const result = await handler.retrieve();
      expect(result.credential!.apiKey).toBe(secondKey);
    });
  });

  describe('delete', () => {
    const validApiKey = 'sk-' + 'a'.repeat(50);

    it('should delete stored API key', async () => {
      await handler.store(validApiKey);
      await handler.delete();

      const result = await handler.retrieve();
      expect(result.found).toBe(false);
    });

    it('should not throw when deleting non-existent key', async () => {
      await expect(handler.delete()).resolves.not.toThrow();
    });
  });

  describe('isConfigured', () => {
    const validApiKey = 'sk-' + 'a'.repeat(50);

    it('should return true when API key is stored', async () => {
      await handler.store(validApiKey);
      expect(await handler.isConfigured()).toBe(true);
    });

    it('should return false when no API key is stored', async () => {
      expect(await handler.isConfigured()).toBe(false);
    });

    it('should return false after deletion', async () => {
      await handler.store(validApiKey);
      await handler.delete();
      expect(await handler.isConfigured()).toBe(false);
    });
  });


  describe('getStatus', () => {
    const validApiKey = 'sk-' + 'a'.repeat(50);

    it('should return not-configured when no key stored', async () => {
      const status = await handler.getStatus();
      expect(status.providerId).toBe('openai');
      expect(status.status).toBe('not-configured');
    });

    it('should return configured when key is stored', async () => {
      await handler.store(validApiKey, 'Test Key');
      const status = await handler.getStatus();

      expect(status.providerId).toBe('openai');
      expect(status.status).toBe('configured');
      expect(status.label).toBe('Test Key');
      expect(status.storedAt).toBeDefined();
    });

    it('should return not-configured when key has expired (expired treated as not found)', async () => {
      // Store a credential with past expiration directly via storage
      // Note: The implementation treats expired credentials as "not found" in retrieve()
      // so getStatus returns 'not-configured' for expired credentials
      const expiredCredential: StoredModelCredential = {
        providerId: 'openai',
        apiKey: validApiKey,
        storedAt: Date.now() - 10000,
        expiresAt: Date.now() - 5000, // Expired 5 seconds ago
      };
      await storage.store(OPENAI_STORAGE_KEY, expiredCredential);

      const status = await handler.getStatus();
      // Expired credentials are treated as not-configured since retrieve() returns found: false
      expect(status.status).toBe('not-configured');
    });
  });

  describe('injectHeader', () => {
    const validApiKey = 'sk-' + 'a'.repeat(50);

    it('should inject Authorization header with Bearer token', async () => {
      await handler.store(validApiKey);
      const headers = await handler.injectHeader();

      expect(headers['Authorization']).toBe(`Bearer ${validApiKey}`);
    });

    it('should preserve existing headers', async () => {
      await handler.store(validApiKey);
      const existingHeaders = { 'Content-Type': 'application/json' };
      const headers = await handler.injectHeader(existingHeaders);

      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['Authorization']).toBe(`Bearer ${validApiKey}`);
    });

    it('should throw when no API key configured', async () => {
      await expect(handler.injectHeader()).rejects.toThrow('No OpenAI API key configured');
    });

    it('should throw when API key has expired', async () => {
      const expiredCredential: StoredModelCredential = {
        providerId: 'openai',
        apiKey: validApiKey,
        storedAt: Date.now() - 10000,
        expiresAt: Date.now() - 5000,
      };
      await storage.store(OPENAI_STORAGE_KEY, expiredCredential);

      await expect(handler.injectHeader()).rejects.toThrow('No OpenAI API key configured');
    });
  });

  describe('getHeaderInjection', () => {
    const validApiKey = 'sk-' + 'a'.repeat(50);

    it('should return header name and value', async () => {
      await handler.store(validApiKey);
      const injection = await handler.getHeaderInjection();

      expect(injection.headerName).toBe('Authorization');
      expect(injection.headerValue).toBe(`Bearer ${validApiKey}`);
    });

    it('should throw when no API key configured', async () => {
      await expect(handler.getHeaderInjection()).rejects.toThrow('No OpenAI API key configured');
    });
  });

  describe('createOpenAIApiKeyHandler factory', () => {
    it('should create handler instance', () => {
      const newHandler = createOpenAIApiKeyHandler(storage);
      expect(newHandler).toBeInstanceOf(OpenAIApiKeyHandler);
    });
  });
});


// =============================================================================
// Anthropic API Key Handler Tests
// =============================================================================

describe('Anthropic API Key Handler', () => {
  let storage: MockModelCredentialStorage;
  let handler: AnthropicApiKeyHandler;

  beforeEach(() => {
    storage = new MockModelCredentialStorage();
    handler = new AnthropicApiKeyHandler(storage);
  });

  afterEach(() => {
    storage.clear();
  });

  describe('Constants', () => {
    it('should have correct provider ID', () => {
      expect(ANTHROPIC_PROVIDER_ID).toBe('anthropic');
    });

    it('should have correct API key prefix', () => {
      expect(ANTHROPIC_API_KEY_PREFIX).toBe('sk-ant-');
    });

    it('should have correct minimum key length', () => {
      expect(ANTHROPIC_API_KEY_MIN_LENGTH).toBe(20);
    });

    it('should have correct storage key', () => {
      expect(ANTHROPIC_STORAGE_KEY).toBe('model-credential:anthropic');
    });
  });

  describe('getProviderId', () => {
    it('should return anthropic provider ID', () => {
      expect(handler.getProviderId()).toBe('anthropic');
    });
  });

  describe('getInjectionConfig', () => {
    it('should return correct injection configuration', () => {
      const config = handler.getInjectionConfig();
      expect(config.type).toBe('header');
      expect(config.headerName).toBe('x-api-key');
      expect(config.format).toBeUndefined(); // Anthropic uses raw key
    });
  });

  describe('validateFormat', () => {
    it('should validate keys with sk-ant- prefix and sufficient length', () => {
      const validKey = 'sk-ant-' + 'a'.repeat(50);
      const result = handler.validateFormat(validKey);
      expect(result.valid).toBe(true);
      expect(result.warning).toBeUndefined();
    });

    it('should return valid with warning for keys without sk-ant- prefix', () => {
      const keyWithoutPrefix = 'a'.repeat(50);
      const result = handler.validateFormat(keyWithoutPrefix);
      expect(result.valid).toBe(true);
      expect(result.warning).toContain('sk-ant-');
    });

    it('should reject keys that are too short', () => {
      const shortKey = 'sk-ant-short';
      const result = handler.validateFormat(shortKey);
      expect(result.valid).toBe(false);
    });

    it('should reject empty strings', () => {
      expect(handler.validateFormat('').valid).toBe(false);
    });

    it('should reject null/undefined values', () => {
      expect(handler.validateFormat(null as unknown as string).valid).toBe(false);
      expect(handler.validateFormat(undefined as unknown as string).valid).toBe(false);
    });

    it('should validate minimum length boundary', () => {
      // Exactly at minimum length
      const minLengthKey = 'a'.repeat(ANTHROPIC_API_KEY_MIN_LENGTH);
      expect(handler.validateFormat(minLengthKey).valid).toBe(true);

      // One below minimum length
      const belowMinKey = 'a'.repeat(ANTHROPIC_API_KEY_MIN_LENGTH - 1);
      expect(handler.validateFormat(belowMinKey).valid).toBe(false);
    });
  });


  describe('store and retrieve', () => {
    const validApiKey = 'sk-ant-' + 'a'.repeat(50);

    it('should store and retrieve API key successfully', async () => {
      await handler.store(validApiKey);
      const result = await handler.retrieve();

      expect(result.found).toBe(true);
      expect(result.credential).toBeDefined();
      expect(result.credential!.apiKey).toBe(validApiKey);
      expect(result.credential!.providerId).toBe('anthropic');
    });

    it('should store API key with label', async () => {
      await handler.store(validApiKey, 'My Anthropic Key');
      const result = await handler.retrieve();

      expect(result.found).toBe(true);
      expect(result.credential!.label).toBe('My Anthropic Key');
    });

    it('should set storedAt timestamp', async () => {
      const beforeStore = Date.now();
      await handler.store(validApiKey);
      const afterStore = Date.now();

      const result = await handler.retrieve();
      expect(result.credential!.storedAt).toBeGreaterThanOrEqual(beforeStore);
      expect(result.credential!.storedAt).toBeLessThanOrEqual(afterStore);
    });

    it('should return not found when no key stored', async () => {
      const result = await handler.retrieve();
      expect(result.found).toBe(false);
      expect(result.credential).toBeUndefined();
    });

    it('should reject invalid format on store', async () => {
      await expect(handler.store('invalid-short')).rejects.toThrow('Invalid Anthropic API key format');
    });
  });

  describe('delete', () => {
    const validApiKey = 'sk-ant-' + 'a'.repeat(50);

    it('should delete stored API key', async () => {
      await handler.store(validApiKey);
      await handler.delete();

      const result = await handler.retrieve();
      expect(result.found).toBe(false);
    });

    it('should not throw when deleting non-existent key', async () => {
      await expect(handler.delete()).resolves.not.toThrow();
    });
  });

  describe('isConfigured', () => {
    const validApiKey = 'sk-ant-' + 'a'.repeat(50);

    it('should return true when API key is stored', async () => {
      await handler.store(validApiKey);
      expect(await handler.isConfigured()).toBe(true);
    });

    it('should return false when no API key is stored', async () => {
      expect(await handler.isConfigured()).toBe(false);
    });
  });

  describe('getStatus', () => {
    const validApiKey = 'sk-ant-' + 'a'.repeat(50);

    it('should return not-configured when no key stored', async () => {
      const status = await handler.getStatus();
      expect(status.providerId).toBe('anthropic');
      expect(status.status).toBe('not-configured');
    });

    it('should return configured when key is stored', async () => {
      await handler.store(validApiKey, 'Test Key');
      const status = await handler.getStatus();

      expect(status.providerId).toBe('anthropic');
      expect(status.status).toBe('configured');
      expect(status.label).toBe('Test Key');
    });

    it('should return not-configured when key has expired (expired treated as not found)', async () => {
      // Note: The implementation treats expired credentials as "not found" in retrieve()
      // so getStatus returns 'not-configured' for expired credentials
      const expiredCredential: StoredModelCredential = {
        providerId: 'anthropic',
        apiKey: validApiKey,
        storedAt: Date.now() - 10000,
        expiresAt: Date.now() - 5000,
      };
      await storage.store(ANTHROPIC_STORAGE_KEY, expiredCredential);

      const status = await handler.getStatus();
      // Expired credentials are treated as not-configured since retrieve() returns found: false
      expect(status.status).toBe('not-configured');
    });
  });


  describe('injectHeader', () => {
    const validApiKey = 'sk-ant-' + 'a'.repeat(50);

    it('should inject x-api-key header with raw key (no Bearer)', async () => {
      await handler.store(validApiKey);
      const headers = await handler.injectHeader();

      // Anthropic uses raw key, NOT Bearer format
      expect(headers['x-api-key']).toBe(validApiKey);
      expect(headers['Authorization']).toBeUndefined();
    });

    it('should preserve existing headers', async () => {
      await handler.store(validApiKey);
      const existingHeaders = { 'Content-Type': 'application/json' };
      const headers = await handler.injectHeader(existingHeaders);

      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['x-api-key']).toBe(validApiKey);
    });

    it('should throw when no API key configured', async () => {
      await expect(handler.injectHeader()).rejects.toThrow('No Anthropic API key configured');
    });

    it('should throw when API key has expired', async () => {
      const expiredCredential: StoredModelCredential = {
        providerId: 'anthropic',
        apiKey: validApiKey,
        storedAt: Date.now() - 10000,
        expiresAt: Date.now() - 5000,
      };
      await storage.store(ANTHROPIC_STORAGE_KEY, expiredCredential);

      await expect(handler.injectHeader()).rejects.toThrow('No Anthropic API key configured');
    });
  });

  describe('getHeaderInjection', () => {
    const validApiKey = 'sk-ant-' + 'a'.repeat(50);

    it('should return header name and value (raw key)', async () => {
      await handler.store(validApiKey);
      const injection = await handler.getHeaderInjection();

      expect(injection.headerName).toBe('x-api-key');
      expect(injection.headerValue).toBe(validApiKey); // Raw key, no Bearer
    });

    it('should throw when no API key configured', async () => {
      await expect(handler.getHeaderInjection()).rejects.toThrow('No Anthropic API key configured');
    });
  });

  describe('createAnthropicApiKeyHandler factory', () => {
    it('should create handler instance', () => {
      const newHandler = createAnthropicApiKeyHandler(storage);
      expect(newHandler).toBeInstanceOf(AnthropicApiKeyHandler);
    });
  });
});


// =============================================================================
// Separation from OAuth Flow Tests
// =============================================================================

describe('Model Credentials Separation from OAuth', () => {
  let storage: MockModelCredentialStorage;

  beforeEach(() => {
    storage = new MockModelCredentialStorage();
  });

  afterEach(() => {
    storage.clear();
  });

  it('should use different storage keys for OpenAI and Anthropic', () => {
    expect(OPENAI_STORAGE_KEY).not.toBe(ANTHROPIC_STORAGE_KEY);
    expect(OPENAI_STORAGE_KEY).toContain('openai');
    expect(ANTHROPIC_STORAGE_KEY).toContain('anthropic');
  });

  it('should store OpenAI and Anthropic credentials independently', async () => {
    const openaiHandler = new OpenAIApiKeyHandler(storage);
    const anthropicHandler = new AnthropicApiKeyHandler(storage);

    const openaiKey = 'sk-' + 'a'.repeat(50);
    const anthropicKey = 'sk-ant-' + 'b'.repeat(50);

    await openaiHandler.store(openaiKey);
    await anthropicHandler.store(anthropicKey);

    const openaiResult = await openaiHandler.retrieve();
    const anthropicResult = await anthropicHandler.retrieve();

    expect(openaiResult.credential!.apiKey).toBe(openaiKey);
    expect(anthropicResult.credential!.apiKey).toBe(anthropicKey);
    expect(storage.size()).toBe(2);
  });

  it('should delete OpenAI without affecting Anthropic', async () => {
    const openaiHandler = new OpenAIApiKeyHandler(storage);
    const anthropicHandler = new AnthropicApiKeyHandler(storage);

    const openaiKey = 'sk-' + 'a'.repeat(50);
    const anthropicKey = 'sk-ant-' + 'b'.repeat(50);

    await openaiHandler.store(openaiKey);
    await anthropicHandler.store(anthropicKey);

    await openaiHandler.delete();

    expect(await openaiHandler.isConfigured()).toBe(false);
    expect(await anthropicHandler.isConfigured()).toBe(true);
  });

  it('should delete Anthropic without affecting OpenAI', async () => {
    const openaiHandler = new OpenAIApiKeyHandler(storage);
    const anthropicHandler = new AnthropicApiKeyHandler(storage);

    const openaiKey = 'sk-' + 'a'.repeat(50);
    const anthropicKey = 'sk-ant-' + 'b'.repeat(50);

    await openaiHandler.store(openaiKey);
    await anthropicHandler.store(anthropicKey);

    await anthropicHandler.delete();

    expect(await openaiHandler.isConfigured()).toBe(true);
    expect(await anthropicHandler.isConfigured()).toBe(false);
  });

  it('should use different header injection methods', async () => {
    const openaiHandler = new OpenAIApiKeyHandler(storage);
    const anthropicHandler = new AnthropicApiKeyHandler(storage);

    const openaiKey = 'sk-' + 'a'.repeat(50);
    const anthropicKey = 'sk-ant-' + 'b'.repeat(50);

    await openaiHandler.store(openaiKey);
    await anthropicHandler.store(anthropicKey);

    const openaiHeaders = await openaiHandler.injectHeader();
    const anthropicHeaders = await anthropicHandler.injectHeader();

    // OpenAI uses Authorization: Bearer {key}
    expect(openaiHeaders['Authorization']).toBe(`Bearer ${openaiKey}`);
    expect(openaiHeaders['x-api-key']).toBeUndefined();

    // Anthropic uses x-api-key: {key} (raw, no Bearer)
    expect(anthropicHeaders['x-api-key']).toBe(anthropicKey);
    expect(anthropicHeaders['Authorization']).toBeUndefined();
  });

  it('should have distinct provider IDs', () => {
    const openaiHandler = new OpenAIApiKeyHandler(storage);
    const anthropicHandler = new AnthropicApiKeyHandler(storage);

    expect(openaiHandler.getProviderId()).toBe('openai');
    expect(anthropicHandler.getProviderId()).toBe('anthropic');
    expect(openaiHandler.getProviderId()).not.toBe(anthropicHandler.getProviderId());
  });

  it('model provider IDs should not overlap with OAuth provider IDs', () => {
    // OAuth providers (from auth/types.ts)
    const oauthProviders = ['google', 'azure', 'cognito', 'github', 'oidc'];

    // Model providers should be distinct
    for (const modelProvider of VALID_MODEL_PROVIDER_IDS) {
      expect(oauthProviders).not.toContain(modelProvider);
    }
  });
});


// =============================================================================
// Error Handling Tests
// =============================================================================

describe('Model Credentials Error Handling', () => {
  describe('OpenAI Handler Error Handling', () => {
    it('should return error message when storage retrieve fails', async () => {
      const failingStorage: IModelCredentialStorage = {
        store: jest.fn(),
        retrieve: jest.fn().mockRejectedValue(new Error('Storage failure')),
        delete: jest.fn(),
        exists: jest.fn(),
      };

      const handler = new OpenAIApiKeyHandler(failingStorage);
      const result = await handler.retrieve();

      expect(result.found).toBe(false);
      expect(result.error).toBe('Storage failure');
    });

    it('should handle generic error in retrieve', async () => {
      const failingStorage: IModelCredentialStorage = {
        store: jest.fn(),
        retrieve: jest.fn().mockRejectedValue('Non-Error rejection'),
        delete: jest.fn(),
        exists: jest.fn(),
      };

      const handler = new OpenAIApiKeyHandler(failingStorage);
      const result = await handler.retrieve();

      expect(result.found).toBe(false);
      expect(result.error).toBe('Failed to retrieve credential');
    });
  });

  describe('Anthropic Handler Error Handling', () => {
    it('should return error message when storage retrieve fails', async () => {
      const failingStorage: IModelCredentialStorage = {
        store: jest.fn(),
        retrieve: jest.fn().mockRejectedValue(new Error('Storage failure')),
        delete: jest.fn(),
        exists: jest.fn(),
      };

      const handler = new AnthropicApiKeyHandler(failingStorage);
      const result = await handler.retrieve();

      expect(result.found).toBe(false);
      expect(result.error).toBe('Storage failure');
    });
  });
});

// =============================================================================
// Edge Cases Tests
// =============================================================================

describe('Model Credentials Edge Cases', () => {
  let storage: MockModelCredentialStorage;

  beforeEach(() => {
    storage = new MockModelCredentialStorage();
  });

  afterEach(() => {
    storage.clear();
  });

  describe('OpenAI Edge Cases', () => {
    it('should handle API key with only whitespace', () => {
      const handler = new OpenAIApiKeyHandler(storage);
      const result = handler.validateFormat('   ');
      expect(result.valid).toBe(false);
    });

    it('should handle very long API keys', () => {
      const handler = new OpenAIApiKeyHandler(storage);
      const longKey = 'sk-' + 'a'.repeat(1000);
      const result = handler.validateFormat(longKey);
      expect(result.valid).toBe(true);
    });

    it('should handle special characters in API key', () => {
      const handler = new OpenAIApiKeyHandler(storage);
      // OpenAI keys can contain alphanumeric and some special chars
      const keyWithSpecialChars = 'sk-' + 'a'.repeat(20) + '-_' + 'b'.repeat(20);
      const result = handler.validateFormat(keyWithSpecialChars);
      expect(result.valid).toBe(true);
    });
  });

  describe('Anthropic Edge Cases', () => {
    it('should handle API key with only whitespace', () => {
      const handler = new AnthropicApiKeyHandler(storage);
      const result = handler.validateFormat('   ');
      expect(result.valid).toBe(false);
    });

    it('should handle very long API keys', () => {
      const handler = new AnthropicApiKeyHandler(storage);
      const longKey = 'sk-ant-' + 'a'.repeat(1000);
      const result = handler.validateFormat(longKey);
      expect(result.valid).toBe(true);
    });

    it('should handle keys with sk- prefix but not sk-ant-', () => {
      const handler = new AnthropicApiKeyHandler(storage);
      // sk- prefix without ant- should give warning but still be valid
      const keyWithSkPrefix = 'sk-' + 'a'.repeat(50);
      const result = handler.validateFormat(keyWithSkPrefix);
      expect(result.valid).toBe(true);
      expect(result.warning).toContain('sk-ant-');
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle concurrent stores to same handler', async () => {
      const handler = new OpenAIApiKeyHandler(storage);
      const key1 = 'sk-' + 'a'.repeat(50);
      const key2 = 'sk-' + 'b'.repeat(50);

      // Store concurrently
      await Promise.all([
        handler.store(key1),
        handler.store(key2),
      ]);

      // One of them should win
      const result = await handler.retrieve();
      expect(result.found).toBe(true);
      expect([key1, key2]).toContain(result.credential!.apiKey);
    });

    it('should handle concurrent operations on different handlers', async () => {
      const openaiHandler = new OpenAIApiKeyHandler(storage);
      const anthropicHandler = new AnthropicApiKeyHandler(storage);

      const openaiKey = 'sk-' + 'a'.repeat(50);
      const anthropicKey = 'sk-ant-' + 'b'.repeat(50);

      // Store concurrently
      await Promise.all([
        openaiHandler.store(openaiKey),
        anthropicHandler.store(anthropicKey),
      ]);

      // Both should be stored
      const openaiResult = await openaiHandler.retrieve();
      const anthropicResult = await anthropicHandler.retrieve();

      expect(openaiResult.credential!.apiKey).toBe(openaiKey);
      expect(anthropicResult.credential!.apiKey).toBe(anthropicKey);
    });
  });
});
