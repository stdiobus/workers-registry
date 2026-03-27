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
 * In-memory storage backend for testing.
 *
 * This backend stores credentials in a Map and is primarily intended
 * for testing purposes. All operations are synchronous but return
 * Promises for interface compatibility with other backends.
 *
 * @module storage/memory-backend
 */

import type { AuthProviderId, StorageBackendType, StoredCredentials } from '../types.js';
import type { IStorageBackend } from './types.js';

/**
 * In-memory storage backend implementation.
 *
 * Uses a Map<AuthProviderId, StoredCredentials> for storage.
 * This backend is always available and is primarily used for testing.
 */
export class MemoryBackend implements IStorageBackend {
  readonly type: StorageBackendType = 'memory';

  /** Internal storage map */
  private readonly storage: Map<AuthProviderId, StoredCredentials> = new Map();

  /**
   * Check if the backend is available.
   * Memory backend is always available.
   * @returns Always resolves to true
   */
  async isAvailable(): Promise<boolean> {
    return true;
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
    this.storage.set(providerId, credentials);
  }

  /**
   * Retrieve credentials for a provider.
   * @param providerId - The provider identifier
   * @returns The stored credentials or null if not found
   */
  async retrieve(providerId: AuthProviderId): Promise<StoredCredentials | null> {
    return this.storage.get(providerId) ?? null;
  }

  /**
   * Delete credentials for a provider.
   * @param providerId - The provider identifier
   */
  async delete(providerId: AuthProviderId): Promise<void> {
    this.storage.delete(providerId);
  }

  /**
   * Delete all stored credentials.
   */
  async deleteAll(): Promise<void> {
    this.storage.clear();
  }

  /**
   * List all providers with stored credentials.
   * @returns Array of provider IDs that have stored credentials
   */
  async listProviders(): Promise<AuthProviderId[]> {
    return Array.from(this.storage.keys());
  }
}
