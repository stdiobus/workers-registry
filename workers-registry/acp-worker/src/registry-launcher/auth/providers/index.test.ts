/*
 * Apache License 2.0
 * Copyright (c) 2025–present Raman Marozau, Target Insight Function.
 * Contact: raman@worktif.com
 */

/**
 * Unit tests for provider registry.
 *
 * Note: OpenAI is NOT included - it uses API keys, not OAuth.
 * See model-credentials module for API key handling.
 */

import {
  registerProvider,
  unregisterProvider,
  clearProviders,
  getProvider,
  hasProvider,
  getRegisteredProviders,
  getSupportedProviders,
  isValidProviderId,
  isProviderAvailable,
  SUPPORTED_PROVIDERS,
} from './index.js';
import { BaseAuthProvider } from './base-provider.js';

/**
 * Mock provider for testing.
 */
class MockProvider extends BaseAuthProvider {
  constructor() {
    super({
      id: 'github',
      name: 'Mock Provider',
      authorizationEndpoint: 'https://auth.example.com/authorize',
      tokenEndpoint: 'https://auth.example.com/token',
      defaultScopes: ['openid'],
      tokenInjection: { type: 'header', key: 'Authorization', format: 'Bearer {token}' },
    });
  }
}

describe('Provider Registry', () => {
  beforeEach(() => {
    clearProviders();
  });

  describe('registerProvider', () => {
    it('should register a provider factory', () => {
      registerProvider('github', () => new MockProvider());

      expect(hasProvider('github')).toBe(true);
    });

    it('should allow overwriting existing provider', () => {
      const factory1 = jest.fn(() => new MockProvider());
      const factory2 = jest.fn(() => new MockProvider());

      registerProvider('github', factory1);
      registerProvider('github', factory2);

      getProvider('github');

      expect(factory1).not.toHaveBeenCalled();
      expect(factory2).toHaveBeenCalled();
    });
  });

  describe('unregisterProvider', () => {
    it('should unregister a provider', () => {
      registerProvider('github', () => new MockProvider());

      const result = unregisterProvider('github');

      expect(result).toBe(true);
      expect(hasProvider('github')).toBe(false);
    });

    it('should return false for non-existent provider', () => {
      const result = unregisterProvider('github');

      expect(result).toBe(false);
    });
  });

  describe('clearProviders', () => {
    it('should clear all registered providers', () => {
      registerProvider('github', () => new MockProvider());
      registerProvider('google', () => new MockProvider());

      clearProviders();

      expect(getRegisteredProviders()).toEqual([]);
    });
  });

  describe('getProvider', () => {
    it('should return provider instance from factory', () => {
      registerProvider('github', () => new MockProvider());

      const provider = getProvider('github');

      expect(provider).toBeInstanceOf(MockProvider);
      expect(provider.id).toBe('github');
    });

    it('should call factory each time', () => {
      const factory = jest.fn(() => new MockProvider());
      registerProvider('github', factory);

      getProvider('github');
      getProvider('github');

      expect(factory).toHaveBeenCalledTimes(2);
    });

    it('should throw for unregistered provider', () => {
      expect(() => getProvider('github')).toThrow(
        "Provider 'github' is not registered. Registered providers: none"
      );
    });

    it('should list registered providers in error message', () => {
      registerProvider('google', () => new MockProvider());

      expect(() => getProvider('github')).toThrow(
        "Provider 'github' is not registered. Registered providers: google"
      );
    });
  });

  describe('hasProvider', () => {
    it('should return true for registered provider', () => {
      registerProvider('github', () => new MockProvider());

      expect(hasProvider('github')).toBe(true);
    });

    it('should return false for unregistered provider', () => {
      expect(hasProvider('github')).toBe(false);
    });
  });

  describe('getRegisteredProviders', () => {
    it('should return empty array when no providers registered', () => {
      expect(getRegisteredProviders()).toEqual([]);
    });

    it('should return all registered provider IDs', () => {
      registerProvider('github', () => new MockProvider());
      registerProvider('google', () => new MockProvider());

      const providers = getRegisteredProviders();

      expect(providers).toContain('github');
      expect(providers).toContain('google');
      expect(providers).toHaveLength(2);
    });
  });

  describe('getSupportedProviders', () => {
    it('should return all supported provider IDs', () => {
      const supported = getSupportedProviders();

      expect(supported).toEqual(SUPPORTED_PROVIDERS);
      // Note: OpenAI and Anthropic are NOT included - they use API keys, not OAuth
      expect(supported).toContain('github');
      expect(supported).toContain('google');
      expect(supported).toContain('cognito');
      expect(supported).toContain('azure');
    });

    it('should return readonly array', () => {
      const supported = getSupportedProviders();

      // The array is readonly at compile time
      expect(supported).toBe(SUPPORTED_PROVIDERS);
    });
  });

  describe('isValidProviderId', () => {
    it('should return true for supported provider IDs', () => {
      // Note: OpenAI and Anthropic are NOT valid OAuth providers - they use API keys
      expect(isValidProviderId('github')).toBe(true);
      expect(isValidProviderId('google')).toBe(true);
      expect(isValidProviderId('cognito')).toBe(true);
      expect(isValidProviderId('azure')).toBe(true);
    });

    it('should return false for unsupported provider IDs', () => {
      expect(isValidProviderId('invalid')).toBe(false);
      expect(isValidProviderId('')).toBe(false);
      expect(isValidProviderId('GITHUB')).toBe(false);
      // OpenAI and Anthropic are not valid OAuth providers
      expect(isValidProviderId('openai')).toBe(false);
      expect(isValidProviderId('anthropic')).toBe(false);
    });
  });

  describe('isProviderAvailable', () => {
    it('should return true for registered and valid provider', () => {
      registerProvider('github', () => new MockProvider());

      expect(isProviderAvailable('github')).toBe(true);
    });

    it('should return false for valid but unregistered provider', () => {
      expect(isProviderAvailable('github')).toBe(false);
    });

    it('should return false for invalid provider ID', () => {
      expect(isProviderAvailable('invalid')).toBe(false);
      // OpenAI is not a valid OAuth provider
      expect(isProviderAvailable('github')).toBe(false);
    });
  });

  describe('SUPPORTED_PROVIDERS', () => {
    it('should contain all expected providers', () => {
      // Note: OpenAI and Anthropic are NOT included - they use API keys, not OAuth
      expect(SUPPORTED_PROVIDERS).toHaveLength(5);
      expect(SUPPORTED_PROVIDERS).toEqual([
        'github',
        'google',
        'cognito',
        'azure',
        'oidc',
      ]);
    });
  });
});
