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
 * Token lifecycle management.
 *
 * Handles token storage, refresh, and expiration.
 *
 * @module token-manager
 */

import type { AuthProviderId, TokenResponse, TokenStatus } from './types.js';

// TODO: Implement in Task 12.1

/**
 * Token lifecycle management interface.
 */
export interface ITokenManager {
  /** Get a valid access token, refreshing if necessary */
  getAccessToken(providerId: AuthProviderId): Promise<string | null>;

  /** Store new tokens from an OAuth response */
  storeTokens(providerId: AuthProviderId, tokens: TokenResponse): Promise<void>;

  /** Check if tokens exist and are valid for a provider */
  hasValidTokens(providerId: AuthProviderId): Promise<boolean>;

  /** Force refresh tokens for a provider */
  forceRefresh(providerId: AuthProviderId): Promise<string | null>;

  /** Clear tokens for a provider (triggers re-auth) */
  clearTokens(providerId: AuthProviderId): Promise<void>;

  /** Get token status for all providers */
  getStatus(): Promise<Map<AuthProviderId, TokenStatus>>;
}

/**
 * Token manager implementation.
 */
export class TokenManager implements ITokenManager {
  async getAccessToken(_providerId: AuthProviderId): Promise<string | null> {
    throw new Error('Not implemented - Task 12.1');
  }

  async storeTokens(
    _providerId: AuthProviderId,
    _tokens: TokenResponse
  ): Promise<void> {
    throw new Error('Not implemented - Task 12.1');
  }

  async hasValidTokens(_providerId: AuthProviderId): Promise<boolean> {
    throw new Error('Not implemented - Task 12.1');
  }

  async forceRefresh(_providerId: AuthProviderId): Promise<string | null> {
    throw new Error('Not implemented - Task 12.1');
  }

  async clearTokens(_providerId: AuthProviderId): Promise<void> {
    throw new Error('Not implemented - Task 12.1');
  }

  async getStatus(): Promise<Map<AuthProviderId, TokenStatus>> {
    throw new Error('Not implemented - Task 12.1');
  }
}
