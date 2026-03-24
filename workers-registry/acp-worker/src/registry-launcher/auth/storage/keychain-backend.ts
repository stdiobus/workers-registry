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
 * OS keychain storage backend.
 *
 * Uses macOS Keychain, Windows Credential Manager, or Linux Secret Service
 * via the keytar package for secure credential storage.
 *
 * @module storage/keychain-backend
 */

import type { AuthProviderId, StorageBackendType, StoredCredentials } from '../types.js';
import type { IStorageBackend } from './types.js';

/** Service name for keychain entries */
const SERVICE_NAME = 'stdio-bus-registry-launcher';

/** Account prefix for provider entries */
const ACCOUNT_PREFIX = 'oauth-';

/** Special account for tracking stored providers */
const PROVIDERS_LIST_ACCOUNT = '__providers_list__';

/**
 * Keytar module interface (subset of keytar API we use).
 */
export interface KeytarModule {
  setPassword(service: string, account: string, password: string): Promise<void>;
  getPassword(service: string, account: string): Promise<string | null>;
  deletePassword(service: string, account: string): Promise<boolean>;
  findCredentials(service: string): Promise<Array<{ account: string; password: string }>>;
}

/**
 * Keychain storage backend implementation.
 *
 * Uses the system keychain for secure credential storage:
 * - macOS: Keychain Access
 * - Windows: Credential Manager
 * - Linux: Secret Service (libsecret)
 *
 * Handles keychain unavailability gracefully by returning false from isAvailable().
 */
export class KeychainBackend implements IStorageBackend {
  readonly type: StorageBackendType = 'keychain';

  private keytar: KeytarModule | null = null;
  private keytarLoadAttempted = false;
  private keytarLoadError: Error | null = null;

  /**
   * Lazily load keytar module.
   * Uses dynamic import to handle cases where keytar is not installed.
   */
  private async loadKeytar(): Promise<KeytarModule | null> {
    if (this.keytarLoadAttempted) {
      return this.keytar;
    }

    this.keytarLoadAttempted = true;

    try {
      // Dynamic import to handle missing keytar gracefully
      // Use a variable to prevent TypeScript from resolving the module at compile time
      const moduleName = 'keytar';
      const keytarModule = await import(/* webpackIgnore: true */ moduleName) as { default?: KeytarModule } & KeytarModule;
      this.keytar = keytarModule.default || keytarModule;
      return this.keytar;
    } catch (error) {
      this.keytarLoadError = error instanceof Error ? error : new Error(String(error));
      console.error(`[KeychainBackend] Failed to load keytar: ${this.keytarLoadError.message}`);
      return null;
    }
  }

  /**
   * Get account name for a provider.
   */
  private getAccountName(providerId: AuthProviderId): string {
    return `${ACCOUNT_PREFIX}${providerId}`;
  }

  /**
   * Check if the keychain backend is available on this system.
   * Returns false if keytar is not installed or keychain access fails.
   */
  async isAvailable(): Promise<boolean> {
    const keytar = await this.loadKeytar();
    if (!keytar) {
      return false;
    }

    try {
      // Test keychain access by attempting to read a non-existent entry
      await keytar.getPassword(SERVICE_NAME, '__availability_check__');
      return true;
    } catch (error) {
      console.error(`[KeychainBackend] Keychain access check failed: ${error}`);
      return false;
    }
  }

  /**
   * Store credentials for a provider in the system keychain.
   */
  async store(providerId: AuthProviderId, credentials: StoredCredentials): Promise<void> {
    const keytar = await this.loadKeytar();
    if (!keytar) {
      throw new Error('Keychain backend is not available');
    }

    const account = this.getAccountName(providerId);
    const serialized = JSON.stringify(credentials);

    try {
      await keytar.setPassword(SERVICE_NAME, account, serialized);
      // Update providers list
      await this.addToProvidersList(providerId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to store credentials in keychain: ${message}`);
    }
  }

  /**
   * Retrieve credentials for a provider from the system keychain.
   */
  async retrieve(providerId: AuthProviderId): Promise<StoredCredentials | null> {
    const keytar = await this.loadKeytar();
    if (!keytar) {
      return null;
    }

    const account = this.getAccountName(providerId);

    try {
      const serialized = await keytar.getPassword(SERVICE_NAME, account);
      if (!serialized) {
        return null;
      }

      const credentials = JSON.parse(serialized) as StoredCredentials;
      return credentials;
    } catch (error) {
      console.error(`[KeychainBackend] Failed to retrieve credentials: ${error}`);
      return null;
    }
  }

  /**
   * Delete credentials for a provider from the system keychain.
   */
  async delete(providerId: AuthProviderId): Promise<void> {
    const keytar = await this.loadKeytar();
    if (!keytar) {
      return;
    }

    const account = this.getAccountName(providerId);

    try {
      await keytar.deletePassword(SERVICE_NAME, account);
      // Update providers list
      await this.removeFromProvidersList(providerId);
    } catch (error) {
      // Ignore errors when deleting (entry might not exist)
      console.error(`[KeychainBackend] Failed to delete credentials: ${error}`);
    }
  }

  /**
   * Delete all stored credentials from the system keychain.
   */
  async deleteAll(): Promise<void> {
    const keytar = await this.loadKeytar();
    if (!keytar) {
      return;
    }

    try {
      const credentials = await keytar.findCredentials(SERVICE_NAME);
      for (const cred of credentials) {
        await keytar.deletePassword(SERVICE_NAME, cred.account);
      }
    } catch (error) {
      console.error(`[KeychainBackend] Failed to delete all credentials: ${error}`);
    }
  }

  /**
   * List all providers with stored credentials.
   */
  async listProviders(): Promise<AuthProviderId[]> {
    const keytar = await this.loadKeytar();
    if (!keytar) {
      return [];
    }

    try {
      const credentials = await keytar.findCredentials(SERVICE_NAME);
      const providers: AuthProviderId[] = [];

      for (const cred of credentials) {
        if (cred.account.startsWith(ACCOUNT_PREFIX)) {
          const providerId = cred.account.slice(ACCOUNT_PREFIX.length) as AuthProviderId;
          providers.push(providerId);
        }
      }

      return providers;
    } catch (error) {
      console.error(`[KeychainBackend] Failed to list providers: ${error}`);
      return [];
    }
  }

  /**
   * Add a provider to the internal providers list.
   */
  private async addToProvidersList(providerId: AuthProviderId): Promise<void> {
    const keytar = this.keytar;
    if (!keytar) return;

    try {
      const existing = await keytar.getPassword(SERVICE_NAME, PROVIDERS_LIST_ACCOUNT);
      const providers: AuthProviderId[] = existing ? JSON.parse(existing) : [];

      if (!providers.includes(providerId)) {
        providers.push(providerId);
        await keytar.setPassword(SERVICE_NAME, PROVIDERS_LIST_ACCOUNT, JSON.stringify(providers));
      }
    } catch {
      // Ignore errors updating providers list
    }
  }

  /**
   * Remove a provider from the internal providers list.
   */
  private async removeFromProvidersList(providerId: AuthProviderId): Promise<void> {
    const keytar = this.keytar;
    if (!keytar) return;

    try {
      const existing = await keytar.getPassword(SERVICE_NAME, PROVIDERS_LIST_ACCOUNT);
      if (existing) {
        const providers: AuthProviderId[] = JSON.parse(existing);
        const filtered = providers.filter(p => p !== providerId);
        await keytar.setPassword(SERVICE_NAME, PROVIDERS_LIST_ACCOUNT, JSON.stringify(filtered));
      }
    } catch {
      // Ignore errors updating providers list
    }
  }
}
