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
 * Uses AES-256-GCM encryption with random salt + machine-specific key derivation.
 * Stores credentials in ~/.stdio-bus/auth-credentials.enc
 *
 * File format v2: Salt (32 bytes) + IV (12 bytes) + Auth Tag (16 bytes) + Encrypted JSON data
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
const SALT_LENGTH = 32;  // 256 bits random salt
const PBKDF2_ITERATIONS = 100000;
const PBKDF2_DIGEST = 'sha256';

/** File permission mode: owner read/write only (0600) */
const FILE_PERMISSION_MODE = 0o600;

/** Default storage directory and file names */
const CONFIG_DIR_NAME = '.stdio-bus';
const CREDENTIALS_FILE_NAME = 'auth-credentials.enc';

/**
 * Custom error for credential store corruption.
 */
export class CredentialStoreCorruptedError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = 'CredentialStoreCorruptedError';
  }
}

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
 * Uses AES-256-GCM encryption with a key derived from:
 * - Random salt (stored with file, unique per file)
 * - Machine-specific entropy (hostname, username)
 *
 * This provides both uniqueness (random salt) and machine binding (entropy).
 *
 * Requirements: 5.2, 5.3
 */
export class EncryptedFileBackend implements IStorageBackend {
  readonly type: StorageBackendType = 'encrypted-file';

  /** Cached encryption key (derived once per instance, per salt) */
  private encryptionKey: Buffer | null = null;

  /** Cached salt from current file */
  private currentSalt: Buffer | null = null;

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
      // Clear cached key and salt
      this.encryptionKey = null;
      this.currentSalt = null;
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
   * Derive the encryption key from salt and machine-specific entropy.
   * Uses PBKDF2 with random salt + hostname + username.
   * @param salt - The random salt (32 bytes)
   * @returns The derived 256-bit encryption key
   */
  private async deriveKey(salt: Buffer): Promise<Buffer> {
    // Check if we can use cached key (same salt)
    if (this.encryptionKey && this.currentSalt && salt.equals(this.currentSalt)) {
      return this.encryptionKey;
    }

    // Gather machine-specific entropy
    const hostname = os.hostname();
    const username = os.userInfo().username;
    const machineEntropy = `${hostname}:${username}`;

    // Combine random salt with machine entropy for key derivation
    const combinedSalt = Buffer.concat([salt, Buffer.from(machineEntropy, 'utf8')]);

    // Derive key using PBKDF2
    const derivedKey = await new Promise<Buffer>((resolve, reject) => {
      crypto.pbkdf2(
        machineEntropy,
        combinedSalt,
        PBKDF2_ITERATIONS,
        KEY_LENGTH,
        PBKDF2_DIGEST,
        (err, key) => {
          if (err) {
            reject(err);
          } else {
            resolve(key);
          }
        }
      );
    });

    // Cache the key and salt
    this.encryptionKey = derivedKey;
    this.currentSalt = salt;

    return derivedKey;
  }

  /**
   * Encrypt data using AES-256-GCM.
   * @param plaintext - The data to encrypt
   * @param salt - The salt to use for key derivation
   * @returns Buffer containing Salt + IV + Auth Tag + Ciphertext
   */
  private async encrypt(plaintext: string, salt: Buffer): Promise<Buffer> {
    const key = await this.deriveKey(salt);
    const iv = crypto.randomBytes(IV_LENGTH);

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });

    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);

    const authTag = cipher.getAuthTag();

    // Format: Salt (32 bytes) + IV (12 bytes) + Auth Tag (16 bytes) + Encrypted data
    return Buffer.concat([salt, iv, authTag, encrypted]);
  }

  /**
   * Decrypt data using AES-256-GCM.
   * @param data - Buffer containing Salt + IV + Auth Tag + Ciphertext
   * @returns The decrypted plaintext
   * @throws CredentialStoreCorruptedError if decryption fails
   */
  private async decrypt(data: Buffer): Promise<string> {
    const minLength = SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH;
    if (data.length < minLength) {
      throw new CredentialStoreCorruptedError(
        `Invalid encrypted data: too short (${data.length} bytes, minimum ${minLength})`
      );
    }

    // Extract components
    const salt = data.subarray(0, SALT_LENGTH);
    const iv = data.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
    const authTag = data.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = data.subarray(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);

    const key = await this.deriveKey(salt);

    try {
      const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
        authTagLength: AUTH_TAG_LENGTH,
      });
      decipher.setAuthTag(authTag);

      const decrypted = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]);

      return decrypted.toString('utf8');
    } catch (error) {
      throw new CredentialStoreCorruptedError(
        'Failed to decrypt credential store: authentication failed or data corrupted',
        error instanceof Error ? error : undefined
      );
    }
  }


  /**
   * Load the credentials store from the encrypted file.
   * @returns The decrypted credentials store
   * @throws CredentialStoreCorruptedError if the file exists but cannot be decrypted
   */
  private async loadStore(): Promise<CredentialsStore> {
    try {
      const encryptedData = await fs.readFile(this.filePath);
      const jsonData = await this.decrypt(encryptedData);

      let store: CredentialsStore;
      try {
        store = JSON.parse(jsonData) as CredentialsStore;
      } catch (parseError) {
        throw new CredentialStoreCorruptedError(
          'Failed to parse credential store: invalid JSON',
          parseError instanceof Error ? parseError : undefined
        );
      }

      // Validate store structure
      if (typeof store.version !== 'number' || typeof store.credentials !== 'object') {
        throw new CredentialStoreCorruptedError(
          'Invalid credential store format: missing version or credentials'
        );
      }

      return store;
    } catch (error) {
      // Return empty store only if file doesn't exist
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { version: 1, credentials: {} };
      }

      // Re-throw CredentialStoreCorruptedError as-is
      if (error instanceof CredentialStoreCorruptedError) {
        throw error;
      }

      // Wrap other errors
      throw new CredentialStoreCorruptedError(
        'Failed to load credential store',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Save the credentials store to the encrypted file.
   * Sets restrictive file permissions (0600 - owner read/write only).
   * @param store - The credentials store to save
   */
  private async saveStore(store: CredentialsStore): Promise<void> {
    // Ensure config directory exists
    await fs.mkdir(this.configDir, { recursive: true });

    // Generate new random salt for each save (provides forward secrecy)
    const salt = crypto.randomBytes(SALT_LENGTH);

    const jsonData = JSON.stringify(store);
    const encryptedData = await this.encrypt(jsonData, salt);

    // Write atomically using a temporary file
    const tempFile = `${this.filePath}.tmp`;
    await fs.writeFile(tempFile, encryptedData, { mode: FILE_PERMISSION_MODE });

    // Rename atomically
    await fs.rename(tempFile, this.filePath);

    // Ensure final file has correct permissions (rename may not preserve mode on all systems)
    try {
      await fs.chmod(this.filePath, FILE_PERMISSION_MODE);
    } catch {
      // Ignore chmod errors on systems that don't support it (e.g., Windows)
    }
  }
}
