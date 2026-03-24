/*
 * Apache License 2.0
 * Copyright (c) 2025–present Raman Marozau, Target Insight Function.
 * Contact: raman@worktif.com
 */

/**
 * Unit tests for KeychainBackend.
 */

import { KeychainBackend, KeytarModule } from './keychain-backend.js';
import type { StoredCredentials } from '../types.js';

describe('KeychainBackend', () => {
  let backend: KeychainBackend;
  let mockKeytar: jest.Mocked<KeytarModule>;

  const testCredentials: StoredCredentials = {
    providerId: 'openai',
    accessToken: 'test-access-token',
    refreshToken: 'test-refresh-token',
    expiresAt: Date.now() + 3600000,
    scope: 'openid profile',
    storedAt: Date.now(),
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock keytar
    mockKeytar = {
      setPassword: jest.fn().mockResolvedValue(undefined),
      getPassword: jest.fn().mockResolvedValue(null),
      deletePassword: jest.fn().mockResolvedValue(true),
      findCredentials: jest.fn().mockResolvedValue([]),
    };

    backend = new KeychainBackend();
  });

  /**
   * Helper to inject mock keytar into backend.
   */
  function injectMockKeytar(): void {
    // Access private properties to inject mock
    (backend as unknown as { keytar: KeytarModule }).keytar = mockKeytar;
    (backend as unknown as { keytarLoadAttempted: boolean }).keytarLoadAttempted = true;
  }

  /**
   * Helper to simulate keytar not available.
   */
  function simulateKeytarUnavailable(): void {
    (backend as unknown as { keytar: null }).keytar = null;
    (backend as unknown as { keytarLoadAttempted: boolean }).keytarLoadAttempted = true;
  }

  describe('type', () => {
    it('should return "keychain" as the backend type', () => {
      expect(backend.type).toBe('keychain');
    });
  });

  describe('isAvailable', () => {
    it('should return true when keytar is available and keychain access works', async () => {
      injectMockKeytar();
      mockKeytar.getPassword.mockResolvedValue(null);

      const result = await backend.isAvailable();

      expect(result).toBe(true);
      expect(mockKeytar.getPassword).toHaveBeenCalledWith(
        'stdio-bus-registry-launcher',
        '__availability_check__'
      );
    });

    it('should return false when keychain access fails', async () => {
      injectMockKeytar();
      mockKeytar.getPassword.mockRejectedValue(new Error('Keychain locked'));

      const result = await backend.isAvailable();

      expect(result).toBe(false);
    });

    it('should return false when keytar is not available', async () => {
      simulateKeytarUnavailable();

      const result = await backend.isAvailable();

      expect(result).toBe(false);
    });
  });

  describe('store', () => {
    it('should store credentials in keychain', async () => {
      injectMockKeytar();

      await backend.store('openai', testCredentials);

      expect(mockKeytar.setPassword).toHaveBeenCalledWith(
        'stdio-bus-registry-launcher',
        'oauth-openai',
        JSON.stringify(testCredentials)
      );
    });

    it('should update providers list when storing', async () => {
      injectMockKeytar();
      mockKeytar.getPassword.mockResolvedValue(null);

      await backend.store('openai', testCredentials);

      // Should update providers list
      expect(mockKeytar.setPassword).toHaveBeenCalledWith(
        'stdio-bus-registry-launcher',
        '__providers_list__',
        JSON.stringify(['openai'])
      );
    });

    it('should append to existing providers list', async () => {
      injectMockKeytar();
      mockKeytar.getPassword.mockResolvedValue(JSON.stringify(['github']));

      await backend.store('openai', testCredentials);

      expect(mockKeytar.setPassword).toHaveBeenCalledWith(
        'stdio-bus-registry-launcher',
        '__providers_list__',
        JSON.stringify(['github', 'openai'])
      );
    });

    it('should not duplicate provider in list', async () => {
      injectMockKeytar();
      mockKeytar.getPassword.mockResolvedValue(JSON.stringify(['openai']));

      await backend.store('openai', testCredentials);

      // Should not add duplicate
      expect(mockKeytar.setPassword).not.toHaveBeenCalledWith(
        'stdio-bus-registry-launcher',
        '__providers_list__',
        JSON.stringify(['openai', 'openai'])
      );
    });

    it('should throw error when keytar is not available', async () => {
      simulateKeytarUnavailable();

      await expect(backend.store('openai', testCredentials))
        .rejects.toThrow('Keychain backend is not available');
    });

    it('should throw error when setPassword fails', async () => {
      injectMockKeytar();
      mockKeytar.setPassword.mockRejectedValue(new Error('Access denied'));

      await expect(backend.store('openai', testCredentials))
        .rejects.toThrow('Failed to store credentials in keychain: Access denied');
    });
  });

  describe('retrieve', () => {
    it('should retrieve credentials from keychain', async () => {
      injectMockKeytar();
      mockKeytar.getPassword.mockResolvedValue(JSON.stringify(testCredentials));

      const result = await backend.retrieve('openai');

      expect(result).toEqual(testCredentials);
      expect(mockKeytar.getPassword).toHaveBeenCalledWith(
        'stdio-bus-registry-launcher',
        'oauth-openai'
      );
    });

    it('should return null when credentials not found', async () => {
      injectMockKeytar();
      mockKeytar.getPassword.mockResolvedValue(null);

      const result = await backend.retrieve('openai');

      expect(result).toBeNull();
    });

    it('should return null when keytar is not available', async () => {
      simulateKeytarUnavailable();

      const result = await backend.retrieve('openai');

      expect(result).toBeNull();
    });

    it('should return null when getPassword fails', async () => {
      injectMockKeytar();
      mockKeytar.getPassword.mockRejectedValue(new Error('Keychain locked'));

      const result = await backend.retrieve('openai');

      expect(result).toBeNull();
    });

    it('should return null when JSON parsing fails', async () => {
      injectMockKeytar();
      mockKeytar.getPassword.mockResolvedValue('invalid json');

      const result = await backend.retrieve('openai');

      expect(result).toBeNull();
    });
  });

  describe('delete', () => {
    it('should delete credentials from keychain', async () => {
      injectMockKeytar();
      mockKeytar.getPassword.mockResolvedValue(JSON.stringify(['openai']));

      await backend.delete('openai');

      expect(mockKeytar.deletePassword).toHaveBeenCalledWith(
        'stdio-bus-registry-launcher',
        'oauth-openai'
      );
    });

    it('should update providers list when deleting', async () => {
      injectMockKeytar();
      mockKeytar.getPassword.mockResolvedValue(JSON.stringify(['openai', 'github']));

      await backend.delete('openai');

      expect(mockKeytar.setPassword).toHaveBeenCalledWith(
        'stdio-bus-registry-launcher',
        '__providers_list__',
        JSON.stringify(['github'])
      );
    });

    it('should not throw when keytar is not available', async () => {
      simulateKeytarUnavailable();

      await expect(backend.delete('openai')).resolves.toBeUndefined();
    });

    it('should not throw when deletePassword fails', async () => {
      injectMockKeytar();
      mockKeytar.deletePassword.mockRejectedValue(new Error('Access denied'));

      await expect(backend.delete('openai')).resolves.toBeUndefined();
    });
  });

  describe('deleteAll', () => {
    it('should delete all credentials from keychain', async () => {
      injectMockKeytar();
      mockKeytar.findCredentials.mockResolvedValue([
        { account: 'oauth-openai', password: '{}' },
        { account: 'oauth-github', password: '{}' },
        { account: '__providers_list__', password: '[]' },
      ]);

      await backend.deleteAll();

      expect(mockKeytar.deletePassword).toHaveBeenCalledTimes(3);
      expect(mockKeytar.deletePassword).toHaveBeenCalledWith(
        'stdio-bus-registry-launcher',
        'oauth-openai'
      );
      expect(mockKeytar.deletePassword).toHaveBeenCalledWith(
        'stdio-bus-registry-launcher',
        'oauth-github'
      );
      expect(mockKeytar.deletePassword).toHaveBeenCalledWith(
        'stdio-bus-registry-launcher',
        '__providers_list__'
      );
    });

    it('should not throw when keytar is not available', async () => {
      simulateKeytarUnavailable();

      await expect(backend.deleteAll()).resolves.toBeUndefined();
    });

    it('should not throw when findCredentials fails', async () => {
      injectMockKeytar();
      mockKeytar.findCredentials.mockRejectedValue(new Error('Access denied'));

      await expect(backend.deleteAll()).resolves.toBeUndefined();
    });
  });

  describe('listProviders', () => {
    it('should list all providers with stored credentials', async () => {
      injectMockKeytar();
      mockKeytar.findCredentials.mockResolvedValue([
        { account: 'oauth-openai', password: '{}' },
        { account: 'oauth-github', password: '{}' },
        { account: '__providers_list__', password: '[]' },
      ]);

      const result = await backend.listProviders();

      expect(result).toEqual(['openai', 'github']);
    });

    it('should return empty array when no credentials stored', async () => {
      injectMockKeytar();
      mockKeytar.findCredentials.mockResolvedValue([]);

      const result = await backend.listProviders();

      expect(result).toEqual([]);
    });

    it('should return empty array when keytar is not available', async () => {
      simulateKeytarUnavailable();

      const result = await backend.listProviders();

      expect(result).toEqual([]);
    });

    it('should return empty array when findCredentials fails', async () => {
      injectMockKeytar();
      mockKeytar.findCredentials.mockRejectedValue(new Error('Access denied'));

      const result = await backend.listProviders();

      expect(result).toEqual([]);
    });

    it('should filter out non-provider accounts', async () => {
      injectMockKeytar();
      mockKeytar.findCredentials.mockResolvedValue([
        { account: 'oauth-openai', password: '{}' },
        { account: 'some-other-account', password: '{}' },
        { account: '__providers_list__', password: '[]' },
      ]);

      const result = await backend.listProviders();

      expect(result).toEqual(['openai']);
    });
  });

  describe('provider isolation', () => {
    it('should store credentials for different providers independently', async () => {
      injectMockKeytar();
      mockKeytar.getPassword.mockResolvedValue(null);

      const openaiCreds: StoredCredentials = { ...testCredentials, providerId: 'openai' };
      const githubCreds: StoredCredentials = { ...testCredentials, providerId: 'github' };

      await backend.store('openai', openaiCreds);
      await backend.store('github', githubCreds);

      expect(mockKeytar.setPassword).toHaveBeenCalledWith(
        'stdio-bus-registry-launcher',
        'oauth-openai',
        JSON.stringify(openaiCreds)
      );
      expect(mockKeytar.setPassword).toHaveBeenCalledWith(
        'stdio-bus-registry-launcher',
        'oauth-github',
        JSON.stringify(githubCreds)
      );
    });

    it('should retrieve credentials for specific provider only', async () => {
      injectMockKeytar();
      const openaiCreds: StoredCredentials = { ...testCredentials, providerId: 'openai' };
      mockKeytar.getPassword.mockResolvedValue(JSON.stringify(openaiCreds));

      const result = await backend.retrieve('openai');

      expect(result).toEqual(openaiCreds);
      expect(mockKeytar.getPassword).toHaveBeenCalledWith(
        'stdio-bus-registry-launcher',
        'oauth-openai'
      );
    });

    it('should delete credentials for specific provider only', async () => {
      injectMockKeytar();
      mockKeytar.getPassword.mockResolvedValue(JSON.stringify(['openai', 'github']));

      await backend.delete('openai');

      expect(mockKeytar.deletePassword).toHaveBeenCalledWith(
        'stdio-bus-registry-launcher',
        'oauth-openai'
      );
      expect(mockKeytar.deletePassword).not.toHaveBeenCalledWith(
        'stdio-bus-registry-launcher',
        'oauth-github'
      );
    });
  });

  describe('error handling', () => {
    it('should handle corrupted JSON in providers list gracefully', async () => {
      injectMockKeytar();
      mockKeytar.getPassword.mockResolvedValue('not valid json');

      // Should not throw when storing
      await expect(backend.store('openai', testCredentials)).resolves.toBeUndefined();
    });

    it('should handle empty providers list', async () => {
      injectMockKeytar();
      mockKeytar.getPassword.mockResolvedValue('[]');

      await backend.delete('openai');

      // Should update with empty list minus the provider (still empty)
      expect(mockKeytar.setPassword).toHaveBeenCalledWith(
        'stdio-bus-registry-launcher',
        '__providers_list__',
        JSON.stringify([])
      );
    });
  });
});
