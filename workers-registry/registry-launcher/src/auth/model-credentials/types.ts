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
 * Type definitions for model API credentials.
 *
 * This module defines types for upstream model provider credentials (API keys).
 * These providers (OpenAI, Anthropic) do NOT offer public OAuth IdP for
 * third-party login - they use API keys instead.
 *
 * This separation clearly distinguishes:
 * - User identity (OAuth/OIDC): Google, Microsoft Entra ID, AWS Cognito, GitHub, Generic OIDC
 * - Model API access (API Keys): OpenAI, Anthropic
 *
 * Requirements: 7b.1, 7b.3
 *
 * @module model-credentials/types
 */

// =============================================================================
// Model Provider Types
// =============================================================================

/**
 * Model API provider identifiers.
 *
 * These providers use API keys for authentication, NOT OAuth.
 * They do not offer public OAuth IdP for third-party login.
 *
 * Requirements: 7b.1, 7b.2
 */
export type ModelProviderId = 'openai' | 'anthropic';

/**
 * Valid model provider IDs for runtime validation.
 */
export const VALID_MODEL_PROVIDER_IDS: readonly ModelProviderId[] = [
  'openai',
  'anthropic',
] as const;

/**
 * Type guard to check if a value is a valid ModelProviderId.
 *
 * @param value - The value to check
 * @returns True if the value is a valid ModelProviderId
 */
export function isValidModelProviderId(value: unknown): value is ModelProviderId {
  return typeof value === 'string' && VALID_MODEL_PROVIDER_IDS.includes(value as ModelProviderId);
}

// =============================================================================
// Model Credential Types
// =============================================================================

/**
 * Model credential for storing API keys.
 *
 * Represents an API key credential for a model provider.
 * These credentials are stored securely in the Credential_Store.
 *
 * Requirements: 7b.1, 7b.4
 */
export interface ModelCredential {
  /**
   * The model provider this credential is for.
   */
  providerId: ModelProviderId;

  /**
   * The API key value.
   * This is stored encrypted in the Credential_Store.
   */
  apiKey: string;

  /**
   * Optional human-readable label for this credential.
   * Useful when multiple keys are stored for the same provider.
   */
  label?: string;

  /**
   * Unix timestamp when this credential was stored.
   */
  storedAt: number;

  /**
   * Optional Unix timestamp when this credential expires.
   * Most API keys don't expire, but some providers may issue
   * time-limited keys.
   */
  expiresAt?: number;
}

// =============================================================================
// Model Credential Injection Types
// =============================================================================

/**
 * Header injection type for model credentials.
 */
export interface HeaderInjection {
  type: 'header';
  /**
   * The header name to use.
   * e.g., 'Authorization' for OpenAI, 'x-api-key' for Anthropic
   */
  headerName: string;
  /**
   * Optional format string for the header value.
   * Use '{key}' as placeholder for the API key.
   * e.g., 'Bearer {key}' for OpenAI
   * If not provided, the API key is used directly.
   */
  format?: string;
}

/**
 * Model credential injection configuration.
 *
 * Defines how API keys should be injected into requests
 * for each model provider.
 *
 * Requirements: 7b.5
 */
export type ModelCredentialInjection = HeaderInjection;

/**
 * Provider-specific injection configurations.
 *
 * OpenAI: Authorization header with Bearer token
 * Anthropic: x-api-key header with raw key
 *
 * Requirements: 7b.5
 */
export const MODEL_CREDENTIAL_INJECTION_CONFIG: Readonly<
  Record<ModelProviderId, ModelCredentialInjection>
> = {
  openai: {
    type: 'header',
    headerName: 'Authorization',
    format: 'Bearer {key}',
  },
  anthropic: {
    type: 'header',
    headerName: 'x-api-key',
    // No format - raw key is used directly
  },
} as const;

// =============================================================================
// Stored Model Credential Types
// =============================================================================

/**
 * Stored model credentials in the credential store.
 *
 * This is the format used when persisting model credentials
 * to the Credential_Store.
 *
 * Requirements: 7b.4
 */
export interface StoredModelCredential {
  /**
   * The model provider this credential is for.
   */
  providerId: ModelProviderId;

  /**
   * The encrypted API key value.
   * Encryption is handled by the storage backend.
   */
  apiKey: string;

  /**
   * Optional human-readable label.
   */
  label?: string;

  /**
   * Unix timestamp when this credential was stored.
   */
  storedAt: number;

  /**
   * Optional Unix timestamp when this credential expires.
   */
  expiresAt?: number;
}

// =============================================================================
// Model Credential Result Types
// =============================================================================

/**
 * Result of a model credential retrieval operation.
 */
export interface ModelCredentialResult {
  /**
   * Whether the credential was found.
   */
  found: boolean;

  /**
   * The credential, if found.
   */
  credential?: ModelCredential;

  /**
   * Error message if retrieval failed.
   */
  error?: string;
}

// =============================================================================
// Model Credential Status Types
// =============================================================================

/**
 * Status of a model credential.
 */
export type ModelCredentialStatus =
  | 'configured'      // API key is stored and available
  | 'not-configured'  // No API key stored
  | 'expired';        // API key has expired (if expiration is set)

/**
 * Model credential status entry for display.
 */
export interface ModelCredentialStatusEntry {
  /**
   * The model provider.
   */
  providerId: ModelProviderId;

  /**
   * Current status of the credential.
   */
  status: ModelCredentialStatus;

  /**
   * Optional label for the credential.
   */
  label?: string;

  /**
   * Unix timestamp when the credential was stored.
   */
  storedAt?: number;

  /**
   * Unix timestamp when the credential expires.
   */
  expiresAt?: number;
}

/**
 * Map of model provider IDs to their credential status.
 */
export type ModelCredentialStatusMap = Map<ModelProviderId, ModelCredentialStatusEntry>;
