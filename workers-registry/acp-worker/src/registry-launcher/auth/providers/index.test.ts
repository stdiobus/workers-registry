/*
 * Apache License 2.0
 * Copyright (c) 2025–present Raman Marozau, Target Insight Function.
 * Contact: raman@worktif.com
 */

/**
 * Unit tests for provider registry.
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
      id: 'openai',
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
      registerProvider('openai', () => new MockProvider());

      expect(hasProvider('openai')).toBe(true);
    });

    it('should allow overwriting existing provider', () => {
      const factory1 = jest.fn(() => new MockProvider());
      const factory2 = jest.fn(() => new MockProvider());

      registerProvider('openai', factory1);
      registerProvider('openai', factory2);

      getProvider('openai');

      expect(factory1).not.toHaveBeenCalled();
      expect(factory2).toHaveBeenCalled();
    });
  });

  describe('unregisterProvider', () => {
    it('should unregister a provider', () => {
      registerProvider('openai', () => new MockProvider());

      const result = unregisterProvider('openai');

      expect(result).toBe(true);
      expect(hasProvider('openai')).toBe(false);
    });

    it('should return false for non-existent provider', () => {
      const result = unregisterProvider('openai');

      expect(result).toBe(false);
    });
  });

  describe('clearProviders', () => {
    it('should clear all registered providers', () => {
      registerProvider('openai', () => new MockProvider());
      registerProvider('github', () => new MockProvider());

      clearProviders();

      expect(getRegisteredProviders()).toEqual([]);
    });
  });

  describe('getProvider', () => {
    it('should return provider instance from factory', () => {
      registerProvider('openai', () => new MockProvider());

      const provider = getProvider('openai');

      expect(provider).toBeInstanceOf(MockProvider);
      expect(provider.id).toBe('openai');
    });

    it('should call factory each time', () => {
      const factory = jest.fn(() => new MockProvider());
      registerProvider('openai', factory);

      getProvider('openai');
      getProvider('openai');

      expect(factory).toHaveBeenCalledTimes(2);
    });

    it('should throw for unregistered provider', () => {
      expect(() => getProvider('openai')).toThrow(
        "Provider 'openai' is not registered. Registered providers: none"
      );
    });

    it('should list registered providers in error message', () => {
      registerProvider('github', () => new MockProvider());

      expect(() => getProvider('openai')).toThrow(
        "Provider 'openai' is not registered. Registered providers: github"
      );
    });
  });

  describe('hasProvider', () => {
    it('should return true for registered provider', () => {
      registerProvider('openai', () => new MockProvider());

      expect(hasProvider('openai')).toBe(true);
    });

    it('should return false for unregistered provider', () => {
      expect(hasProvider('openai')).toBe(false);
    });
  });

  describe('getRegisteredProviders', () => {
    it('should return empty array when no providers registered', () => {
      expect(getRegisteredProviders()).toEqual([]);
    });

    it('should return all registered provider IDs', () => {
      registerProvider('openai', () => new MockProvider());
      registerProvider('github', () => new MockProvider());

      const providers = getRegisteredProviders();

      expect(providers).toContain('openai');
      expect(providers).toContain('github');
      expect(providers).toHaveLength(2);
    });
  });

  describe('getSupportedProviders', () => {
    it('should return all supported provider IDs', () => {
      const supported = getSupportedProviders();

      expect(supported).toEqual(SUPPORTED_PROVIDERS);
      expect(supported).toContain('openai');
      expect(supported).toContain('github');
      expect(supported).toContain('google');
      expect(supported).toContain('cognito');
      expect(supported).toContain('azure');
      expect(supported).toContain('anthropic');
    });

    it('should return readonly array', () => {
      const supported = getSupportedProviders();

      // The array is readonly at compile time
      expect(supported).toBe(SUPPORTED_PROVIDERS);
    });
  });

  describe('isValidProviderId', () => {
    it('should return true for supported provider IDs', () => {
      expect(isValidProviderId('openai')).toBe(true);
      expect(isValidProviderId('github')).toBe(true);
      expect(isValidProviderId('google')).toBe(true);
      expect(isValidProviderId('cognito')).toBe(true);
      expect(isValidProviderId('azure')).toBe(true);
      expect(isValidProviderId('anthropic')).toBe(true);
    });

    it('should return false for unsupported provider IDs', () => {
      expect(isValidProviderId('invalid')).toBe(false);
      expect(isValidProviderId('')).toBe(false);
      expect(isValidProviderId('OPENAI')).toBe(false);
    });
  });

  describe('isProviderAvailable', () => {
    it('should return true for registered and valid provider', () => {
      registerProvider('openai', () => new MockProvider());

      expect(isProviderAvailable('openai')).toBe(true);
    });

    it('should return false for valid but unregistered provider', () => {
      expect(isProviderAvailable('openai')).toBe(false);
    });

    it('should return false for invalid provider ID', () => {
      expect(isProviderAvailable('invalid')).toBe(false);
    });
  });

  describe('SUPPORTED_PROVIDERS', () => {
    it('should contain all expected providers', () => {
      expect(SUPPORTED_PROVIDERS).toHaveLength(6);
      expect(SUPPORTED_PROVIDERS).toEqual([
        'openai',
        'github',
        'google',
        'cognito',
        'azure',
        'anthropic',
      ]);
    });
  });
});
