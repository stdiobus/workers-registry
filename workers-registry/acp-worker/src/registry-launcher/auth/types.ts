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
 * Core type definitions for OAuth 2.1 authentication.
 *
 * @module types
 */

// =============================================================================
// Provider and Status Types
// =============================================================================

/**
 * Supported OAuth provider identifiers.
 */
export type AuthProviderId =
  | 'openai'
  | 'github'
  | 'google'
  | 'cognito'
  | 'azure'
  | 'anthropic';

/**
 * Storage backend types.
 */
export type StorageBackendType = 'keychain' | 'encrypted-file' | 'memory';

/**
 * Token status for a provider.
 */
export type TokenStatus =
  | 'authenticated'    // Valid tokens available
  | 'expired'          // Tokens expired, refresh needed
  | 'refresh-failed'   // Refresh attempted but failed
  | 'not-configured';  // No credentials stored

/**
 * Authentication error codes.
 */
export type AuthErrorCode =
  | 'INVALID_STATE'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'INVALID_CREDENTIALS'
  | 'STORAGE_ERROR'
  | 'PROVIDER_ERROR'
  | 'UNSUPPORTED_PROVIDER'
  | 'CALLBACK_ERROR'
  | 'TOKEN_REFRESH_FAILED';

// =============================================================================
// Token and Credential Types
// =============================================================================

/**
 * OAuth token response from provider.
 */
export interface TokenResponse {
  accessToken: string;
  tokenType: string;
  expiresIn?: number;  // Seconds until expiration
  refreshToken?: string;
  scope?: string;
  idToken?: string;
}

/**
 * Token injection method for agent requests.
 */
export interface TokenInjectionMethod {
  type: 'header' | 'query' | 'body';
  key: string;  // e.g., 'Authorization', 'x-api-key', 'access_token'
  format?: string;  // e.g., 'Bearer {token}'
}

/**
 * Custom provider endpoints (for Cognito/Azure).
 */
export interface ProviderEndpoints {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userInfoEndpoint?: string;
}

/**
 * Stored credentials in credential store.
 */
export interface StoredCredentials {
  providerId: AuthProviderId;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;  // Unix timestamp
  scope?: string;
  clientId?: string;  // For terminal auth
  clientSecret?: string;  // For terminal auth (encrypted)
  customEndpoints?: ProviderEndpoints;  // For Cognito/Azure
  storedAt: number;  // Unix timestamp
}

// =============================================================================
// Authorization Flow Types
// =============================================================================

/**
 * Authorization parameters for building auth URL.
 */
export interface AuthorizationParams {
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  responseType: 'code';
  additionalParams?: Record<string, string>;
}

/**
 * Callback result from OAuth redirect.
 */
export interface CallbackResult {
  code: string;
  state: string;
  error?: string;
  errorDescription?: string;
}

/**
 * Agent auth flow options.
 */
export interface AgentAuthOptions {
  timeoutMs?: number;  // Default: 300000 (5 minutes)
  scopes?: string[];   // Override default scopes
  clientId?: string;   // Override default client ID
}

// =============================================================================
// Result and Error Types
// =============================================================================

/**
 * Authentication error with details.
 */
export interface AuthError {
  code: AuthErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Authentication result.
 */
export interface AuthResult {
  success: boolean;
  providerId: AuthProviderId;
  error?: AuthError;
}

/**
 * Auth status for display.
 */
export interface AuthStatusEntry {
  providerId: AuthProviderId;
  status: TokenStatus;
  expiresAt?: number;
  scope?: string;
  lastRefresh?: number;
}

/**
 * Map of provider IDs to their auth status.
 */
export type AuthStatusMap = Map<AuthProviderId, AuthStatusEntry>;

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Provider configuration.
 */
export interface ProviderConfig {
  clientId: string;
  clientSecret?: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  defaultScopes: string[];
  tokenInjection: TokenInjectionMethod;
}

/**
 * Extended launcher config with auth settings.
 */
export interface AuthConfig {
  /** Default auth timeout in seconds */
  authTimeoutSec: number;
  /** Proactive token refresh threshold in seconds */
  tokenRefreshThresholdSec: number;
  /** Preferred storage backend */
  preferredStorageBackend?: StorageBackendType;
}

// =============================================================================
// ACP Protocol Types
// =============================================================================

/**
 * ACP protocol auth method advertisement.
 */
export interface AcpAuthMethod {
  id: string;
  type: 'oauth2' | 'api-key';
  providerId?: AuthProviderId;
}

// =============================================================================
// Type Guards and Validation Functions
// =============================================================================

/**
 * Valid provider IDs for runtime validation.
 */
export const VALID_PROVIDER_IDS: readonly AuthProviderId[] = [
  'openai',
  'github',
  'google',
  'cognito',
  'azure',
  'anthropic',
] as const;

/**
 * Valid storage backend types for runtime validation.
 */
export const VALID_STORAGE_BACKENDS: readonly StorageBackendType[] = [
  'keychain',
  'encrypted-file',
  'memory',
] as const;

/**
 * Valid token status values for runtime validation.
 */
export const VALID_TOKEN_STATUSES: readonly TokenStatus[] = [
  'authenticated',
  'expired',
  'refresh-failed',
  'not-configured',
] as const;

/**
 * Valid auth error codes for runtime validation.
 */
export const VALID_ERROR_CODES: readonly AuthErrorCode[] = [
  'INVALID_STATE',
  'TIMEOUT',
  'NETWORK_ERROR',
  'INVALID_CREDENTIALS',
  'STORAGE_ERROR',
  'PROVIDER_ERROR',
  'UNSUPPORTED_PROVIDER',
  'CALLBACK_ERROR',
  'TOKEN_REFRESH_FAILED',
] as const;

/**
 * Type guard to check if a value is a valid AuthProviderId.
 * @param value - The value to check
 * @returns True if the value is a valid AuthProviderId
 */
export function isValidProviderId(value: unknown): value is AuthProviderId {
  return typeof value === 'string' && VALID_PROVIDER_IDS.includes(value as AuthProviderId);
}

/**
 * Type guard to check if a value is a valid StorageBackendType.
 * @param value - The value to check
 * @returns True if the value is a valid StorageBackendType
 */
export function isValidStorageBackend(value: unknown): value is StorageBackendType {
  return typeof value === 'string' && VALID_STORAGE_BACKENDS.includes(value as StorageBackendType);
}

/**
 * Type guard to check if a value is a valid TokenStatus.
 * @param value - The value to check
 * @returns True if the value is a valid TokenStatus
 */
export function isValidTokenStatus(value: unknown): value is TokenStatus {
  return typeof value === 'string' && VALID_TOKEN_STATUSES.includes(value as TokenStatus);
}

/**
 * Type guard to check if a value is a valid AuthErrorCode.
 * @param value - The value to check
 * @returns True if the value is a valid AuthErrorCode
 */
export function isValidErrorCode(value: unknown): value is AuthErrorCode {
  return typeof value === 'string' && VALID_ERROR_CODES.includes(value as AuthErrorCode);
}
