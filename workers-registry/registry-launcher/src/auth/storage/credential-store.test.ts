/*
 * Apache License 2.0
 * Copyright (c) 2025–present Raman Marozau, Target Insight Function.
 * Contact: raman@worktif.com
 */

/**
 * Unit tests for CredentialStore.
 */

import { CredentialStore, createCredentialStore } from './credential-store.js';
import { MemoryBackend } from './memory-backend.js';
import { KeychainBackend } from './keychain-backend.js';
import { EncryptedFileBackend } from './encrypted-file-backend.js';
import type { StoredCredentials } from '../types.js';

// Mock the backends
jest.mock('./keychain-backend.js');
jest.mock('./encrypted-file-backend.js');
jest.mock('./memory-backend.js');

describe('CredentialStore', () => {
  let mockKeychainBackend: jest.Mocked<KeychainBackend>;
  let mockEncryptedFileBackend: jest.Mocked<EncryptedFileBackend>;
  let mockMemoryBackend: jest.Mocked<MemoryBackend>;

  const testCredentials: StoredCredentials = {
    providerId: 'github',
    accessToken: 'test-access-token',
    refreshToken: 'test-refresh-token',
    expiresAt: Date.now() + 3600000,
    scope: 'openid profile',
    storedAt: Date.now(),
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mock keychain backend
    mockKeychainBackend = {
      type: 'keychain',
      isAvailable: jest.fn().mockResolvedValue(false),
      store: jest.fn().mockResolvedValue(undefined),
      retrieve: jest.fn().mockResolvedValue(null),
      delete: jest.fn().mockResolvedValue(undefined),
      deleteAll: jest.fn().mockResolvedValue(undefined),
      listProviders: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<KeychainBackend>;

    // Setup mock encrypted file backend
    mockEncryptedFileBackend = {
      type: 'encrypted-file',
      isAvailable: jest.fn().mockResolvedValue(false),
      store: jest.fn().mockResolvedValue(undefined),
      retrieve: jest.fn().mockResolvedValue(null),
      delete: jest.fn().mockResolvedValue(undefined),
      deleteAll: jest.fn().mockResolvedValue(undefined),
      listProviders: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<EncryptedFileBackend>;

    // Setup mock memory backend
    mockMemoryBackend = {
      type: 'memory',
      isAvailable: jest.fn().mockResolvedValue(true),
      store: jest.fn().mockResolvedValue(undefined),
      retrieve: jest.fn().mockResolvedValue(null),
      delete: jest.fn().mockResolvedValue(undefined),
      deleteAll: jest.fn().mockResolvedValue(undefined),
      listProviders: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<MemoryBackend>;

    // Configure mocks
    (KeychainBackend as jest.Mock).mockImplementation(() => mockKeychainBackend);
    (EncryptedFileBackend as jest.Mock).mockImplementation(() => mockEncryptedFileBackend);
    (MemoryBackend as jest.Mock).mockImplementation(() => mockMemoryBackend);
  });

  describe('backend selection', () => {
    it('should prefer keychain when available', async () => {
      mockKeychainBackend.isAvailable.mockResolvedValue(true);

      const store = new CredentialStore();
      await store.store('github', testCredentials);

      expect(mockKeychainBackend.store).toHaveBeenCalledWith('github', testCredentials);
      expect(store.getBackendType()).toBe('keychain');
    });

    it('should fall back to encrypted file when keychain unavailable', async () => {
      mockKeychainBackend.isAvailable.mockResolvedValue(false);
      mockEncryptedFileBackend.isAvailable.mockResolvedValue(true);

      const store = new CredentialStore();
      await store.store('github', testCredentials);

      expect(mockEncryptedFileBackend.store).toHaveBeenCalledWith('github', testCredentials);
      expect(store.getBackendType()).toBe('encrypted-file');
    });

    it('should fall back to memory when all secure backends unavailable', async () => {
      mockKeychainBackend.isAvailable.mockResolvedValue(false);
      mockEncryptedFileBackend.isAvailable.mockResolvedValue(false);
      mockMemoryBackend.isAvailable.mockResolvedValue(true);

      const store = new CredentialStore();
      await store.store('github', testCredentials);

      expect(mockMemoryBackend.store).toHaveBeenCalledWith('github', testCredentials);
      expect(store.getBackendType()).toBe('memory');
    });

    it('should use preferred backend when specified and available', async () => {
      mockEncryptedFileBackend.isAvailable.mockResolvedValue(true);
      mockKeychainBackend.isAvailable.mockResolvedValue(true);

      const store = new CredentialStore({ preferredBackend: 'encrypted-file' });
      await store.store('github', testCredentials);

      expect(mockEncryptedFileBackend.store).toHaveBeenCalledWith('github', testCredentials);
      expect(store.getBackendType()).toBe('encrypted-file');
    });

    it('should fall back when preferred backend unavailable', async () => {
      mockKeychainBackend.isAvailable.mockResolvedValue(false);
      mockEncryptedFileBackend.isAvailable.mockResolvedValue(true);

      const store = new CredentialStore({ preferredBackend: 'keychain' });
      await store.store('github', testCredentials);

      expect(mockEncryptedFileBackend.store).toHaveBeenCalledWith('github', testCredentials);
      expect(store.getBackendType()).toBe('encrypted-file');
    });

    it('should handle backend availability check errors', async () => {
      mockKeychainBackend.isAvailable.mockRejectedValue(new Error('Check failed'));
      mockEncryptedFileBackend.isAvailable.mockResolvedValue(true);

      const store = new CredentialStore();
      await store.store('github', testCredentials);

      expect(mockEncryptedFileBackend.store).toHaveBeenCalledWith('github', testCredentials);
    });

    it('should initialize backend only once', async () => {
      mockMemoryBackend.isAvailable.mockResolvedValue(true);

      const store = new CredentialStore();
      await store.store('github', testCredentials);
      await store.store('github', testCredentials);

      // Memory backend constructor should only be called once for the actual backend
      // (plus once for each fallback check)
      expect(mockMemoryBackend.isAvailable).toHaveBeenCalledTimes(1);
    });
  });

  describe('store', () => {
    it('should delegate to backend', async () => {
      mockMemoryBackend.isAvailable.mockResolvedValue(true);

      const store = new CredentialStore();
      await store.store('github', testCredentials);

      expect(mockMemoryBackend.store).toHaveBeenCalledWith('github', testCredentials);
    });
  });

  describe('retrieve', () => {
    it('should delegate to backend', async () => {
      mockMemoryBackend.isAvailable.mockResolvedValue(true);
      mockMemoryBackend.retrieve.mockResolvedValue(testCredentials);

      const store = new CredentialStore();
      const result = await store.retrieve('github');

      expect(result).toEqual(testCredentials);
      expect(mockMemoryBackend.retrieve).toHaveBeenCalledWith('github');
    });

    it('should return null when not found', async () => {
      mockMemoryBackend.isAvailable.mockResolvedValue(true);
      mockMemoryBackend.retrieve.mockResolvedValue(null);

      const store = new CredentialStore();
      const result = await store.retrieve('github');

      expect(result).toBeNull();
    });
  });

  describe('delete', () => {
    it('should delegate to backend', async () => {
      mockMemoryBackend.isAvailable.mockResolvedValue(true);

      const store = new CredentialStore();
      await store.delete('github');

      expect(mockMemoryBackend.delete).toHaveBeenCalledWith('github');
    });
  });

  describe('deleteAll', () => {
    it('should delegate to backend', async () => {
      mockMemoryBackend.isAvailable.mockResolvedValue(true);

      const store = new CredentialStore();
      await store.deleteAll();

      expect(mockMemoryBackend.deleteAll).toHaveBeenCalled();
    });
  });

  describe('listProviders', () => {
    it('should delegate to backend', async () => {
      mockMemoryBackend.isAvailable.mockResolvedValue(true);
      mockMemoryBackend.listProviders.mockResolvedValue(['github', 'github']);

      const store = new CredentialStore();
      const result = await store.listProviders();

      expect(result).toEqual(['github', 'github']);
      expect(mockMemoryBackend.listProviders).toHaveBeenCalled();
    });
  });

  describe('getBackendType', () => {
    it('should return memory before initialization', () => {
      const store = new CredentialStore();
      expect(store.getBackendType()).toBe('memory');
    });

    it('should return actual backend type after initialization', async () => {
      mockEncryptedFileBackend.isAvailable.mockResolvedValue(true);

      const store = new CredentialStore();
      await store.store('github', testCredentials);

      expect(store.getBackendType()).toBe('encrypted-file');
    });
  });

  describe('isInitialized', () => {
    it('should return false before any operation', () => {
      const store = new CredentialStore();
      expect(store.isInitialized()).toBe(false);
    });

    it('should return true after first operation', async () => {
      mockMemoryBackend.isAvailable.mockResolvedValue(true);

      const store = new CredentialStore();
      await store.store('github', testCredentials);

      expect(store.isInitialized()).toBe(true);
    });
  });

  describe('reinitialize', () => {
    it('should reset and reinitialize backend', async () => {
      mockMemoryBackend.isAvailable.mockResolvedValue(true);

      const store = new CredentialStore();
      await store.store('github', testCredentials);

      expect(store.isInitialized()).toBe(true);

      // Now make keychain available
      mockKeychainBackend.isAvailable.mockResolvedValue(true);

      await store.reinitialize();

      expect(store.getBackendType()).toBe('keychain');
    });
  });

  describe('createCredentialStore', () => {
    it('should create a credential store with default options', () => {
      const store = createCredentialStore();
      expect(store).toBeInstanceOf(CredentialStore);
    });

    it('should create a credential store with custom options', () => {
      const store = createCredentialStore({ preferredBackend: 'memory' });
      expect(store).toBeInstanceOf(CredentialStore);
    });
  });

  describe('options passing', () => {
    it('should pass encryptedFilePath to encrypted file backend', async () => {
      mockEncryptedFileBackend.isAvailable.mockResolvedValue(true);

      const store = new CredentialStore({
        preferredBackend: 'encrypted-file',
        encryptedFilePath: '/custom/path/credentials.enc'
      });
      await store.store('github', testCredentials);

      expect(EncryptedFileBackend).toHaveBeenCalledWith('/custom/path/credentials.enc');
    });
  });
});
