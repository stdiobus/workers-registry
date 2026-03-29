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
 * Implements proactive token refresh and concurrent refresh serialization.
 *
 * @module token-manager
 */

import type { AuthProviderId, TokenResponse, TokenStatus, StoredCredentials } from './types.js';
import type { ICredentialStore } from './storage/types.js';
import type { IAuthProvider } from './providers/types.js';

/**
 * Default token refresh threshold in milliseconds (5 minutes).
 * Tokens will be proactively refreshed when they expire within this threshold.
 */
export const DEFAULT_REFRESH_THRESHOLD_MS = 5 * 60 * 1000;

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
 * Provider resolver function type.
 * Used to get provider instances for token refresh operations.
 */
export type ProviderResolver = (providerId: AuthProviderId) => IAuthProvider | null;

/**
 * Options for creating a token manager.
 */
export interface TokenManagerOptions {
  /** Credential store for persisting tokens */
  credentialStore: ICredentialStore;
  /** Function to resolve provider instances */
  providerResolver: ProviderResolver;
  /** Token refresh threshold in milliseconds (default: 5 minutes) */
  refreshThresholdMs?: number;
}

/**
 * Token manager implementation.
 *
 * Manages token lifecycle including:
 * - Proactive token refresh when tokens are near expiration
 * - Concurrent refresh serialization (only one refresh per provider at a time)
 * - Automatic credential cleanup on refresh failure
 * - Refresh token rotation handling
 */
export class TokenManager implements ITokenManager {
  private readonly credentialStore: ICredentialStore;
  private readonly providerResolver: ProviderResolver;
  private readonly refreshThresholdMs: number;

  /**
   * Map of provider IDs to pending refresh promises.
   * Used to serialize concurrent refresh requests.
   */
  private readonly pendingRefreshes = new Map<AuthProviderId, Promise<string | null>>();

  /**
   * Create a new token manager.
   * @param options - Configuration options
   */
  constructor(options: TokenManagerOptions) {
    this.credentialStore = options.credentialStore;
    this.providerResolver = options.providerResolver;
    this.refreshThresholdMs = options.refreshThresholdMs ?? DEFAULT_REFRESH_THRESHOLD_MS;
  }

  /**
   * Get a valid access token, refreshing if necessary.
   *
   * If the token is within the refresh threshold of expiration, it will be
   * proactively refreshed before returning.
   *
   * @param providerId - The provider identifier
   * @returns The access token or null if not available
   */
  async getAccessToken(providerId: AuthProviderId): Promise<string | null> {
    const credentials = await this.credentialStore.retrieve(providerId);

    if (!credentials) {
      return null;
    }

    // Check if token needs refresh
    if (this.shouldRefresh(credentials)) {
      // Attempt proactive refresh
      const refreshedToken = await this.refreshTokenInternal(providerId, credentials);
      if (refreshedToken !== null) {
        return refreshedToken;
      }
      // If refresh failed but we still have a valid token, return it
      if (!this.isExpired(credentials)) {
        return credentials.accessToken;
      }
      return null;
    }

    return credentials.accessToken;
  }

  /**
   * Store new tokens from an OAuth response.
   *
   * Converts the token response to stored credentials format and persists them.
   * Preserves the existing refresh token if the new response doesn't include one
   * (some providers only return refresh tokens on initial auth, not on refresh).
   *
   * @param providerId - The provider identifier
   * @param tokens - The token response from the OAuth provider
   */
  async storeTokens(providerId: AuthProviderId, tokens: TokenResponse): Promise<void> {
    const now = Date.now();

    // Validate token response
    if (!tokens.accessToken || typeof tokens.accessToken !== 'string') {
      throw new Error('Invalid token response: missing or invalid accessToken');
    }
    if (tokens.expiresIn !== undefined) {
      if (typeof tokens.expiresIn !== 'number' || !Number.isFinite(tokens.expiresIn) || tokens.expiresIn < 0) {
        throw new Error('Invalid token response: expiresIn must be a non-negative finite number');
      }
    }

    // Calculate expiration timestamp if expiresIn is provided
    const expiresAt = tokens.expiresIn
      ? now + tokens.expiresIn * 1000
      : undefined;

    // Get existing credentials to preserve client info and refresh token
    const existing = await this.credentialStore.retrieve(providerId);

    // Preserve existing refresh token if new response doesn't include one
    // (some providers only return refresh tokens on initial auth, not on refresh)
    const refreshToken = tokens.refreshToken ?? existing?.refreshToken;

    const credentials: StoredCredentials = {
      providerId,
      accessToken: tokens.accessToken,
      refreshToken,
      expiresAt,
      scope: tokens.scope,
      // Preserve client info from existing credentials
      clientId: existing?.clientId,
      clientSecret: existing?.clientSecret,
      customEndpoints: existing?.customEndpoints,
      storedAt: now,
    };

    await this.credentialStore.store(providerId, credentials);
  }

  /**
   * Check if tokens exist and are valid for a provider.
   *
   * A token is considered valid if:
   * - Credentials exist for the provider
   * - The access token is not expired
   *
   * @param providerId - The provider identifier
   * @returns True if valid tokens exist
   */
  async hasValidTokens(providerId: AuthProviderId): Promise<boolean> {
    const credentials = await this.credentialStore.retrieve(providerId);

    if (!credentials) {
      return false;
    }

    return !this.isExpired(credentials);
  }

  /**
   * Force refresh tokens for a provider.
   *
   * Unlike getAccessToken, this always attempts a refresh regardless of
   * the current token's expiration status.
   *
   * @param providerId - The provider identifier
   * @returns The new access token or null if refresh failed
   */
  async forceRefresh(providerId: AuthProviderId): Promise<string | null> {
    const credentials = await this.credentialStore.retrieve(providerId);

    if (!credentials) {
      return null;
    }

    return this.refreshTokenInternal(providerId, credentials);
  }

  /**
   * Clear tokens for a provider.
   *
   * This triggers re-authentication on the next token request.
   *
   * @param providerId - The provider identifier
   */
  async clearTokens(providerId: AuthProviderId): Promise<void> {
    await this.credentialStore.delete(providerId);
  }

  /**
   * Get token status for all providers.
   *
   * @returns Map of provider IDs to their token status
   */
  async getStatus(): Promise<Map<AuthProviderId, TokenStatus>> {
    const providers = await this.credentialStore.listProviders();
    const statusMap = new Map<AuthProviderId, TokenStatus>();

    for (const providerId of providers) {
      const credentials = await this.credentialStore.retrieve(providerId);

      if (!credentials) {
        statusMap.set(providerId, 'not-configured');
        continue;
      }

      if (this.isExpired(credentials)) {
        // Check if we have a refresh token to potentially recover
        if (credentials.refreshToken) {
          statusMap.set(providerId, 'expired');
        } else {
          statusMap.set(providerId, 'refresh-failed');
        }
      } else {
        statusMap.set(providerId, 'authenticated');
      }
    }

    return statusMap;
  }

  /**
   * Check if credentials are expired.
   *
   * @param credentials - The stored credentials
   * @returns True if the token is expired
   */
  private isExpired(credentials: StoredCredentials): boolean {
    if (!credentials.expiresAt) {
      // No expiration info, assume valid
      return false;
    }

    return Date.now() >= credentials.expiresAt;
  }

  /**
   * Check if credentials should be proactively refreshed.
   *
   * Returns true if the token will expire within the refresh threshold.
   *
   * @param credentials - The stored credentials
   * @returns True if the token should be refreshed
   */
  private shouldRefresh(credentials: StoredCredentials): boolean {
    if (!credentials.expiresAt) {
      // No expiration info, don't refresh
      return false;
    }

    if (!credentials.refreshToken) {
      // No refresh token available
      return false;
    }

    const timeUntilExpiry = credentials.expiresAt - Date.now();
    return timeUntilExpiry <= this.refreshThresholdMs;
  }

  /**
   * Internal token refresh implementation with concurrent request serialization.
   *
   * Ensures only one refresh operation occurs at a time per provider.
   * If a refresh is already in progress, returns the pending promise.
   *
   * @param providerId - The provider identifier
   * @param credentials - The current stored credentials
   * @returns The new access token or null if refresh failed
   */
  private async refreshTokenInternal(
    providerId: AuthProviderId,
    credentials: StoredCredentials
  ): Promise<string | null> {
    // Check for pending refresh
    const pending = this.pendingRefreshes.get(providerId);
    if (pending) {
      return pending;
    }

    // No refresh token available
    if (!credentials.refreshToken) {
      console.error(`[TokenManager] No refresh token available for ${providerId}`);
      return null;
    }

    // Create and store the refresh promise
    const refreshPromise = this.executeRefresh(providerId, credentials.refreshToken);
    this.pendingRefreshes.set(providerId, refreshPromise);

    try {
      return await refreshPromise;
    } finally {
      // Clean up pending refresh
      this.pendingRefreshes.delete(providerId);
    }
  }

  /**
   * Execute the actual token refresh operation.
   *
   * @param providerId - The provider identifier
   * @param refreshToken - The refresh token to use
   * @returns The new access token or null if refresh failed
   */
  private async executeRefresh(
    providerId: AuthProviderId,
    refreshToken: string
  ): Promise<string | null> {
    const provider = this.providerResolver(providerId);

    if (!provider) {
      console.error(`[TokenManager] Provider not found for ${providerId}`);
      return null;
    }

    try {
      console.error(`[TokenManager] Refreshing token for ${providerId}`);

      const tokenResponse = await provider.refreshToken(refreshToken);

      // Store the new tokens (handles refresh token rotation)
      await this.storeTokens(providerId, tokenResponse);

      console.error(`[TokenManager] Token refreshed successfully for ${providerId}`);
      return tokenResponse.accessToken;
    } catch (error) {
      // Sanitize error logging to avoid leaking sensitive information
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      // Remove any potential tokens or secrets from error message
      const sanitizedMessage = errorMessage
        .replace(/[A-Za-z0-9_-]{20,}/g, '[REDACTED]')
        .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]');
      console.error(`[TokenManager] Token refresh failed for ${providerId}: ${sanitizedMessage}`);

      // Clear credentials on refresh failure (Requirement 6.3)
      // This signals that re-authentication is required
      await this.credentialStore.delete(providerId);

      return null;
    }
  }
}

/**
 * Create a token manager with the given options.
 *
 * @param options - Configuration options
 * @returns A new token manager instance
 */
export function createTokenManager(options: TokenManagerOptions): TokenManager {
  return new TokenManager(options);
}
