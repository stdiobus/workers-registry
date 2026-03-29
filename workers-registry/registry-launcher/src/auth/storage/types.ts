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
 * Storage interface definitions.
 *
 * @module storage/types
 */

import type { AuthProviderId, StorageBackendType, StoredCredentials } from '../types.js';

/**
 * Low-level storage backend interface.
 * Implemented by keychain, encrypted file, and memory backends.
 */
export interface IStorageBackend {
  /** Backend type identifier */
  readonly type: StorageBackendType;

  /** Check if the backend is available on this system */
  isAvailable(): Promise<boolean>;

  /** Store credentials for a provider */
  store(providerId: AuthProviderId, credentials: StoredCredentials): Promise<void>;

  /** Retrieve credentials for a provider */
  retrieve(providerId: AuthProviderId): Promise<StoredCredentials | null>;

  /** Delete credentials for a provider */
  delete(providerId: AuthProviderId): Promise<void>;

  /** Delete all stored credentials */
  deleteAll(): Promise<void>;

  /** List all providers with stored credentials */
  listProviders(): Promise<AuthProviderId[]>;
}

/**
 * Secure credential storage interface.
 * Facade that selects the best available backend.
 */
export interface ICredentialStore {
  /** Store credentials for a provider */
  store(providerId: AuthProviderId, credentials: StoredCredentials): Promise<void>;

  /** Retrieve credentials for a provider */
  retrieve(providerId: AuthProviderId): Promise<StoredCredentials | null>;

  /** Delete credentials for a provider */
  delete(providerId: AuthProviderId): Promise<void>;

  /** Delete all stored credentials */
  deleteAll(): Promise<void>;

  /** List all providers with stored credentials */
  listProviders(): Promise<AuthProviderId[]>;

  /** Get the active storage backend type */
  getBackendType(): StorageBackendType;
}
