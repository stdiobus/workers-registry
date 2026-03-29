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
 * Supported OAuth/OIDC provider identifiers for user identity.
 *
 * Note: OpenAI and Anthropic are NOT public OAuth IdPs for third-party login.
 * They use API keys instead. See ModelProviderId and model-credentials module.
 *
 * Requirements: 7.1, 7a.1
 */
export type AuthProviderId =
  | 'google'
  | 'azure'
  | 'cognito'
  | 'github'
  | 'oidc';

/**
 * Model API providers that use API keys (NOT OAuth).
 *
 * These providers do not offer public OAuth IdP for third-party login.
 * Use API key authentication instead.
 *
 * Requirements: 7b.1, 7b.2
 */
export type ModelProviderId =
  | 'openai'
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
  | 'TOKEN_REFRESH_FAILED'
  | 'HEADLESS_ENVIRONMENT';

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
 * Successful callback result from OAuth redirect.
 */
export interface CallbackSuccess {
  success: true;
  code: string;
  state: string;
}

/**
 * Error callback result from OAuth redirect.
 */
export interface CallbackErrorResult {
  success: false;
  error: string;
  errorDescription?: string;
  state?: string;  // State may be present in error callbacks
}

/**
 * Callback result from OAuth redirect (discriminated union).
 * OAuth error redirects may not include 'code', only 'error'.
 */
export type CallbackResult = CallbackSuccess | CallbackErrorResult;

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
 * Successful authentication result.
 */
export interface AuthResultSuccess {
  success: true;
  providerId: AuthProviderId;
}

/**
 * Failed authentication result.
 */
export interface AuthResultFailure {
  success: false;
  providerId: AuthProviderId;
  error: AuthError;
}

/**
 * Authentication result (discriminated union).
 */
export type AuthResult = AuthResultSuccess | AuthResultFailure;

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
 * Authentication method types.
 * Used for method precedence selection.
 */
export type AuthMethodType = 'oauth2' | 'api-key';

/**
 * Valid authentication method types for runtime validation.
 */
export const VALID_AUTH_METHOD_TYPES: readonly AuthMethodType[] = [
  'oauth2',
  'api-key',
] as const;

/**
 * Type guard to check if a value is a valid AuthMethodType.
 * @param value - The value to check
 * @returns True if the value is a valid AuthMethodType
 */
export function isValidAuthMethodType(value: unknown): value is AuthMethodType {
  return typeof value === 'string' && VALID_AUTH_METHOD_TYPES.includes(value as AuthMethodType);
}

/**
 * Configuration for authentication method precedence.
 *
 * Defines the order in which authentication methods are attempted.
 * Default precedence: oauth2 > api-key (OAuth preferred when available)
 *
 * Requirements: 3.1, 10.3
 */
export interface AuthMethodPrecedenceConfig {
  /**
   * Ordered list of authentication methods by preference.
   * First method in the list has highest priority.
   * Default: ['oauth2', 'api-key']
   */
  methodPrecedence: AuthMethodType[];

  /**
   * Whether to fail fast when an unsupported method is encountered.
   * If true, throws an error immediately.
   * If false, skips the unsupported method and tries the next one.
   * Default: true
   */
  failFastOnUnsupported: boolean;

  /**
   * Whether to fail fast when provider ID is ambiguous.
   * Ambiguity occurs when multiple providers could match an agent.
   * If true, throws an error immediately.
   * If false, uses the first matching provider.
   * Default: true
   */
  failFastOnAmbiguous: boolean;
}

/**
 * Default authentication method precedence configuration.
 *
 * OAuth2 is preferred over API keys when both are available.
 * This aligns with Requirement 10.3: prefer OAuth credentials.
 */
export const DEFAULT_AUTH_METHOD_PRECEDENCE: AuthMethodPrecedenceConfig = {
  methodPrecedence: ['oauth2', 'api-key'],
  failFastOnUnsupported: true,
  failFastOnAmbiguous: true,
};

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
  /**
   * Authentication method precedence configuration.
   * Controls which auth method is preferred when multiple are available.
   * Default: oauth2 > api-key
   */
  methodPrecedence?: Partial<AuthMethodPrecedenceConfig>;
}

// =============================================================================
// ACP Protocol Types
// =============================================================================

/**
 * ACP protocol auth method advertisement.
 *
 * Supports all ACP Registry auth types:
 * - 'oauth2': Browser-based OAuth 2.1 flow
 * - 'api-key': Legacy API key authentication
 * - 'agent': Agent handles OAuth internally (ACP default)
 * - 'terminal': Interactive terminal setup (AUTHENTICATION.md)
 */
export interface AcpAuthMethod {
  id: string;
  type: 'oauth2' | 'api-key' | 'agent' | 'terminal';
  providerId?: AuthProviderId;
  /** CLI args for terminal auth (e.g. ['--setup']) */
  args?: string[];
  /** Environment variables for terminal auth */
  env?: Record<string, string>;
}

// =============================================================================
// Type Guards and Validation Functions
// =============================================================================

/**
 * Valid provider IDs for runtime validation.
 *
 * Note: OpenAI and Anthropic are NOT included - they use API keys, not OAuth.
 * See model-credentials module for API key handling.
 */
export const VALID_PROVIDER_IDS: readonly AuthProviderId[] = [
  'github',
  'google',
  'cognito',
  'azure',
  'oidc',
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
  'HEADLESS_ENVIRONMENT',
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

// =============================================================================
// AuthMethod ID to Provider ID Mapping
// =============================================================================

/**
 * Explicit mapping from authMethod.id to AuthProviderId.
 *
 * This mapping table provides a secure, explicit translation from
 * ACP authMethod identifiers to internal provider IDs.
 *
 * SECURITY: No substring or heuristic matching is used.
 * Only exact matches in this table are accepted.
 *
 * Note: OpenAI and Anthropic are NOT included - they use API keys, not OAuth.
 * See model-credentials module for API key handling.
 *
 * Requirements: 7.1, 13.4
 */
export const AUTH_METHOD_ID_TO_PROVIDER_ID: Readonly<Record<string, AuthProviderId>> = {
  // OAuth2 method IDs
  'oauth2-github': 'github',
  'oauth2-google': 'google',
  'oauth2-cognito': 'cognito',
  'oauth2-azure': 'azure',
  'oauth2-oidc': 'oidc',

  // Direct provider IDs (for backward compatibility)
  'github': 'github',
  'google': 'google',
  'cognito': 'cognito',
  'azure': 'azure',
  'oidc': 'oidc',
} as const;

/**
 * Valid authMethod.id values for runtime validation.
 */
export const VALID_AUTH_METHOD_IDS: readonly string[] = Object.keys(AUTH_METHOD_ID_TO_PROVIDER_ID);

/**
 * Error thrown when an unknown authMethod.id is encountered.
 *
 * Requirements: 13.4
 */
export class UnknownAuthMethodIdError extends Error {
  public readonly code = 'UNSUPPORTED_PROVIDER' as const;
  public readonly unknownMethodId: string;
  public readonly supportedMethodIds: readonly string[];
  public readonly supportedProviders: readonly AuthProviderId[];

  constructor(unknownMethodId: string) {
    const supportedMethodIds = VALID_AUTH_METHOD_IDS;
    const supportedProviders = VALID_PROVIDER_IDS;

    super(
      `Unknown authMethod.id: "${unknownMethodId}". ` +
      `Supported method IDs: ${supportedMethodIds.join(', ')}. ` +
      `Supported providers: ${supportedProviders.join(', ')}.`
    );

    this.name = 'UnknownAuthMethodIdError';
    this.unknownMethodId = unknownMethodId;
    this.supportedMethodIds = supportedMethodIds;
    this.supportedProviders = supportedProviders;

    // Maintains proper stack trace for where error was thrown (V8 engines)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, UnknownAuthMethodIdError);
    }
  }
}

/**
 * Type guard to check if a value is a valid authMethod.id.
 *
 * @param value - The value to check
 * @returns True if the value is a valid authMethod.id
 */
export function isValidAuthMethodId(value: unknown): value is string {
  return typeof value === 'string' && value in AUTH_METHOD_ID_TO_PROVIDER_ID;
}

/**
 * Resolves an authMethod.id to its corresponding AuthProviderId.
 *
 * This function uses explicit mapping only - no substring matching,
 * no heuristics, no fuzzy matching. This is a security requirement
 * to prevent provider confusion attacks.
 *
 * @param authMethodId - The authMethod.id to resolve
 * @returns The corresponding AuthProviderId
 * @throws UnknownAuthMethodIdError if the authMethod.id is not recognized
 *
 * Requirements: 7.1, 13.4
 *
 * @example
 * ```typescript
 * // Valid mappings
 * resolveAuthMethodIdToProviderId('oauth2-openai'); // returns 'openai'
 * resolveAuthMethodIdToProviderId('oauth2-github'); // returns 'github'
 * resolveAuthMethodIdToProviderId('github');        // returns 'github' (direct)
 *
 * // Invalid - throws UnknownAuthMethodIdError
 * resolveAuthMethodIdToProviderId('oauth2-unknown');
 * resolveAuthMethodIdToProviderId('openai-oauth2'); // wrong format
 * resolveAuthMethodIdToProviderId('OPENAI');        // case sensitive
 * ```
 */
export function resolveAuthMethodIdToProviderId(authMethodId: string): AuthProviderId {
  const providerId = AUTH_METHOD_ID_TO_PROVIDER_ID[authMethodId];

  if (providerId === undefined) {
    throw new UnknownAuthMethodIdError(authMethodId);
  }

  return providerId;
}

/**
 * Safely resolves an authMethod.id to its corresponding AuthProviderId.
 *
 * Unlike `resolveAuthMethodIdToProviderId`, this function returns null
 * instead of throwing an error for unknown method IDs.
 *
 * @param authMethodId - The authMethod.id to resolve
 * @returns The corresponding AuthProviderId, or null if not recognized
 *
 * Requirements: 7.1, 13.4
 */
export function tryResolveAuthMethodIdToProviderId(authMethodId: string): AuthProviderId | null {
  const providerId = AUTH_METHOD_ID_TO_PROVIDER_ID[authMethodId];
  return providerId ?? null;
}
