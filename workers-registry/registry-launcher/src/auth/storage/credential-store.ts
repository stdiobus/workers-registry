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
 * Main credential store facade.
 *
 * Selects the best available storage backend (keychain > encrypted file > memory).
 * Provides a unified interface for credential storage regardless of the underlying backend.
 *
 * @module storage/credential-store
 */

import type { AuthProviderId, StorageBackendType, StoredCredentials } from '../types.js';
import type { ICredentialStore, IStorageBackend } from './types.js';
import { KeychainBackend } from './keychain-backend.js';
import { EncryptedFileBackend } from './encrypted-file-backend.js';
import { MemoryBackend } from './memory-backend.js';

/**
 * Options for creating a credential store.
 */
export interface CredentialStoreOptions {
  /** Preferred storage backend (overrides automatic selection) */
  preferredBackend?: StorageBackendType;
  /** Custom path for encrypted file storage */
  encryptedFilePath?: string;
}

/**
 * Credential store implementation.
 *
 * Automatically selects the best available storage backend:
 * 1. Keychain (most secure, OS-level protection)
 * 2. Encrypted file (secure, portable)
 * 3. Memory (testing only, not persistent)
 *
 * The backend selection happens lazily on first use.
 */
export class CredentialStore implements ICredentialStore {
  private backend: IStorageBackend | null = null;
  private backendInitialized = false;
  private readonly options: CredentialStoreOptions;

  /**
   * Create a new credential store.
   * @param options - Configuration options
   */
  constructor(options: CredentialStoreOptions = {}) {
    this.options = options;
  }

  /**
   * Initialize the storage backend.
   * Selects the best available backend based on system capabilities.
   */
  private async initializeBackend(): Promise<IStorageBackend> {
    if (this.backendInitialized && this.backend) {
      return this.backend;
    }

    this.backendInitialized = true;

    // If a preferred backend is specified, try to use it
    if (this.options.preferredBackend) {
      const preferred = await this.createBackend(this.options.preferredBackend);
      if (preferred && await preferred.isAvailable()) {
        this.backend = preferred;
        console.error(`[CredentialStore] Using preferred backend: ${preferred.type}`);
        return this.backend;
      }
      console.error(`[CredentialStore] Preferred backend ${this.options.preferredBackend} not available, falling back`);
    }

    // Try backends in order of preference
    const backends: IStorageBackend[] = [
      new KeychainBackend(),
      new EncryptedFileBackend(this.options.encryptedFilePath),
      new MemoryBackend(),
    ];

    for (const backend of backends) {
      try {
        if (await backend.isAvailable()) {
          this.backend = backend;
          console.error(`[CredentialStore] Using backend: ${backend.type}`);
          return this.backend;
        }
      } catch (error) {
        console.error(`[CredentialStore] Backend ${backend.type} check failed: ${error}`);
      }
    }

    // Fallback to memory backend (always available)
    this.backend = new MemoryBackend();
    console.error(`[CredentialStore] Falling back to memory backend`);
    return this.backend;
  }

  /**
   * Create a specific backend by type.
   */
  private async createBackend(type: StorageBackendType): Promise<IStorageBackend | null> {
    switch (type) {
      case 'keychain':
        return new KeychainBackend();
      case 'encrypted-file':
        return new EncryptedFileBackend(this.options.encryptedFilePath);
      case 'memory':
        return new MemoryBackend();
      default:
        return null;
    }
  }

  /**
   * Get the initialized backend.
   */
  private async getBackend(): Promise<IStorageBackend> {
    return this.initializeBackend();
  }

  /**
   * Store credentials for a provider.
   * @param providerId - The provider identifier
   * @param credentials - The credentials to store
   */
  async store(providerId: AuthProviderId, credentials: StoredCredentials): Promise<void> {
    const backend = await this.getBackend();
    await backend.store(providerId, credentials);
  }

  /**
   * Retrieve credentials for a provider.
   * @param providerId - The provider identifier
   * @returns The stored credentials or null if not found
   */
  async retrieve(providerId: AuthProviderId): Promise<StoredCredentials | null> {
    const backend = await this.getBackend();
    return backend.retrieve(providerId);
  }

  /**
   * Delete credentials for a provider.
   * @param providerId - The provider identifier
   */
  async delete(providerId: AuthProviderId): Promise<void> {
    const backend = await this.getBackend();
    await backend.delete(providerId);
  }

  /**
   * Delete all stored credentials.
   */
  async deleteAll(): Promise<void> {
    const backend = await this.getBackend();
    await backend.deleteAll();
  }

  /**
   * List all providers with stored credentials.
   * @returns Array of provider identifiers
   */
  async listProviders(): Promise<AuthProviderId[]> {
    const backend = await this.getBackend();
    return backend.listProviders();
  }

  /**
   * Get the active storage backend type.
   * @returns The backend type currently in use
   */
  getBackendType(): StorageBackendType {
    if (!this.backend) {
      // Return 'memory' as default before initialization
      return 'memory';
    }
    return this.backend.type;
  }

  /**
   * Check if the store has been initialized.
   * @returns True if a backend has been selected
   */
  isInitialized(): boolean {
    return this.backendInitialized;
  }

  /**
   * Force re-initialization of the backend.
   * Useful for testing or when system capabilities change.
   */
  async reinitialize(): Promise<void> {
    this.backend = null;
    this.backendInitialized = false;
    await this.initializeBackend();
  }
}

/**
 * Create a credential store with default options.
 * @returns A new credential store instance
 */
export function createCredentialStore(options?: CredentialStoreOptions): CredentialStore {
  return new CredentialStore(options);
}
