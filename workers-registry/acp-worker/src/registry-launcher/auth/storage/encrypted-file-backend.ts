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
 * Encrypted file storage backend.
 *
 * Uses AES-256-GCM encryption with machine-specific key derivation.
 * Stores credentials in ~/.stdio-bus/auth-credentials.enc
 *
 * File format: IV (12 bytes) + Auth Tag (16 bytes) + Encrypted JSON data
 *
 * @module storage/encrypted-file-backend
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import type { AuthProviderId, StorageBackendType, StoredCredentials } from '../types.js';
import type { IStorageBackend } from './types.js';

/** AES-256-GCM configuration constants */
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;  // 96 bits for GCM
const AUTH_TAG_LENGTH = 16;  // 128 bits
const KEY_LENGTH = 32;  // 256 bits
const PBKDF2_ITERATIONS = 100000;
const PBKDF2_DIGEST = 'sha256';

/** Static salt for key derivation (combined with machine-specific entropy) */
const STATIC_SALT = 'stdio-bus-auth-v1';

/** Default storage directory and file names */
const CONFIG_DIR_NAME = '.stdio-bus';
const CREDENTIALS_FILE_NAME = 'auth-credentials.enc';

/**
 * Internal storage format for credentials map.
 */
interface CredentialsStore {
  version: number;
  credentials: Record<string, StoredCredentials>;
}

/**
 * Encrypted file storage backend implementation.
 *
 * Uses AES-256-GCM encryption with a key derived from machine-specific
 * entropy (hostname, username) using PBKDF2.
 *
 * Requirements: 5.2, 5.3
 */
export class EncryptedFileBackend implements IStorageBackend {
  readonly type: StorageBackendType = 'encrypted-file';

  /** Cached encryption key (derived once per instance) */
  private encryptionKey: Buffer | null = null;

  /** Path to the credentials file */
  private readonly filePath: string;

  /** Path to the config directory */
  private readonly configDir: string;

  /**
   * Create a new EncryptedFileBackend instance.
   * @param customPath - Optional custom path for the credentials file (for testing)
   */
  constructor(customPath?: string) {
    if (customPath) {
      this.filePath = customPath;
      this.configDir = path.dirname(customPath);
    } else {
      this.configDir = path.join(os.homedir(), CONFIG_DIR_NAME);
      this.filePath = path.join(this.configDir, CREDENTIALS_FILE_NAME);
    }
  }

  /**
   * Check if the backend is available.
   * Tests if the config directory is writable.
   * @returns True if the file system is writable
   */
  async isAvailable(): Promise<boolean> {
    try {
      // Ensure config directory exists
      await fs.mkdir(this.configDir, { recursive: true });

      // Test write access by creating a temporary file
      const testFile = path.join(this.configDir, `.write-test-${Date.now()}`);
      await fs.writeFile(testFile, 'test');
      await fs.unlink(testFile);

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Store credentials for a provider.
   * @param providerId - The provider identifier
   * @param credentials - The credentials to store
   */
  async store(
    providerId: AuthProviderId,
    credentials: StoredCredentials
  ): Promise<void> {
    const store = await this.loadStore();
    store.credentials[providerId] = credentials;
    await this.saveStore(store);
  }

  /**
   * Retrieve credentials for a provider.
   * @param providerId - The provider identifier
   * @returns The stored credentials or null if not found
   */
  async retrieve(providerId: AuthProviderId): Promise<StoredCredentials | null> {
    const store = await this.loadStore();
    return store.credentials[providerId] ?? null;
  }

  /**
   * Delete credentials for a provider.
   * @param providerId - The provider identifier
   */
  async delete(providerId: AuthProviderId): Promise<void> {
    const store = await this.loadStore();
    delete store.credentials[providerId];
    await this.saveStore(store);
  }

  /**
   * Delete all stored credentials.
   */
  async deleteAll(): Promise<void> {
    try {
      await fs.unlink(this.filePath);
    } catch (error) {
      // Ignore if file doesn't exist
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  /**
   * List all providers with stored credentials.
   * @returns Array of provider IDs that have stored credentials
   */
  async listProviders(): Promise<AuthProviderId[]> {
    const store = await this.loadStore();
    return Object.keys(store.credentials) as AuthProviderId[];
  }

  /**
   * Derive the encryption key from machine-specific entropy.
   * Uses PBKDF2 with hostname, username, and a static salt.
   * @returns The derived 256-bit encryption key
   */
  private async deriveKey(): Promise<Buffer> {
    if (this.encryptionKey) {
      return this.encryptionKey;
    }

    // Gather machine-specific entropy
    const hostname = os.hostname();
    const username = os.userInfo().username;
    const machineEntropy = `${hostname}:${username}`;

    // Combine with static salt
    const salt = Buffer.from(`${STATIC_SALT}:${machineEntropy}`, 'utf8');

    // Derive key using PBKDF2
    this.encryptionKey = await new Promise<Buffer>((resolve, reject) => {
      crypto.pbkdf2(
        machineEntropy,
        salt,
        PBKDF2_ITERATIONS,
        KEY_LENGTH,
        PBKDF2_DIGEST,
        (err, derivedKey) => {
          if (err) {
            reject(err);
          } else {
            resolve(derivedKey);
          }
        }
      );
    });

    return this.encryptionKey;
  }

  /**
   * Encrypt data using AES-256-GCM.
   * @param plaintext - The data to encrypt
   * @returns Buffer containing IV + Auth Tag + Ciphertext
   */
  private async encrypt(plaintext: string): Promise<Buffer> {
    const key = await this.deriveKey();
    const iv = crypto.randomBytes(IV_LENGTH);

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });

    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);

    const authTag = cipher.getAuthTag();

    // Format: IV (12 bytes) + Auth Tag (16 bytes) + Encrypted data
    return Buffer.concat([iv, authTag, encrypted]);
  }

  /**
   * Decrypt data using AES-256-GCM.
   * @param data - Buffer containing IV + Auth Tag + Ciphertext
   * @returns The decrypted plaintext
   */
  private async decrypt(data: Buffer): Promise<string> {
    if (data.length < IV_LENGTH + AUTH_TAG_LENGTH) {
      throw new Error('Invalid encrypted data: too short');
    }

    const key = await this.deriveKey();

    // Extract components
    const iv = data.subarray(0, IV_LENGTH);
    const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  }

  /**
   * Load the credentials store from the encrypted file.
   * @returns The decrypted credentials store
   */
  private async loadStore(): Promise<CredentialsStore> {
    try {
      const encryptedData = await fs.readFile(this.filePath);
      const jsonData = await this.decrypt(encryptedData);
      const store = JSON.parse(jsonData) as CredentialsStore;

      // Validate store structure
      if (typeof store.version !== 'number' || typeof store.credentials !== 'object') {
        throw new Error('Invalid store format');
      }

      return store;
    } catch (error) {
      // Return empty store if file doesn't exist or is corrupted
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { version: 1, credentials: {} };
      }

      // For decryption errors or invalid format, return empty store
      // This handles cases where the machine entropy changed
      console.error('[EncryptedFileBackend] Failed to load store, starting fresh:', error);
      return { version: 1, credentials: {} };
    }
  }

  /**
   * Save the credentials store to the encrypted file.
   * @param store - The credentials store to save
   */
  private async saveStore(store: CredentialsStore): Promise<void> {
    // Ensure config directory exists
    await fs.mkdir(this.configDir, { recursive: true });

    const jsonData = JSON.stringify(store);
    const encryptedData = await this.encrypt(jsonData);

    // Write atomically using a temporary file
    const tempFile = `${this.filePath}.tmp`;
    await fs.writeFile(tempFile, encryptedData);
    await fs.rename(tempFile, this.filePath);
  }
}
