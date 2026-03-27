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
 * Error handling module for OAuth 2.1 authentication.
 *
 * Provides error classes for each AuthErrorCode, provider error response parsing,
 * and error response formatting that excludes sensitive data.
 *
 * Requirements: 13.1, 13.2, 13.3, 13.4, 13.5
 *
 * @module errors
 */

import type { AuthErrorCode, AuthError, AuthProviderId } from './types.js';
import { VALID_PROVIDER_IDS } from './types.js';

// =============================================================================
// Sensitive Data Patterns
// =============================================================================

/**
 * Patterns that indicate sensitive data that should be redacted from error messages.
 * These patterns match the key and capture everything until the next key=value pair or end of string.
 */
const SENSITIVE_PATTERNS = [
  // Tokens and secrets - match until next space followed by word= or end of string
  /access_token[=:]\s*["']?[^"'\s]+["']?/gi,
  /refresh_token[=:]\s*["']?[^"'\s]+["']?/gi,
  /id_token[=:]\s*["']?[^"'\s]+["']?/gi,
  /client_secret[=:]\s*["']?[^"'\s]+["']?/gi,
  /api[_-]?key[=:]\s*["']?[^"'\s]+["']?/gi,
  /bearer\s+[^\s]+/gi,
  /authorization[=:]\s*["']?bearer\s+[^\s"']+["']?/gi,
  // Code verifier and challenge
  /code_verifier[=:]\s*["']?[^"'\s]+["']?/gi,
  // Password patterns
  /password[=:]\s*["']?[^"'\s]+["']?/gi,
  /secret[=:]\s*["']?[^"'\s]+["']?/gi,
];

/**
 * Redact sensitive data from a string.
 *
 * @param text - The text to redact
 * @returns The text with sensitive data replaced with [REDACTED]
 */
export function redactSensitiveData(text: string): string {
  let result = text;
  for (const pattern of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, (match) => {
      // Extract the key part and redact the value
      const keyMatch = match.match(/^([^=:]+[=:])/);
      if (keyMatch) {
        return `${keyMatch[1]}[REDACTED]`;
      }
      return '[REDACTED]';
    });
  }
  return result;
}

// =============================================================================
// Base Auth Error Class
// =============================================================================

/**
 * Base error class for authentication errors.
 *
 * Provides a structured error with code, message, and optional details.
 * Ensures sensitive data is never included in error messages.
 */
export class AuthenticationError extends Error {
  readonly code: AuthErrorCode;
  readonly details?: Record<string, unknown>;

  /**
   * Create a new AuthenticationError.
   *
   * @param code - The error code
   * @param message - The error message (will be redacted for sensitive data)
   * @param details - Optional additional details (will be sanitized)
   */
  constructor(code: AuthErrorCode, message: string, details?: Record<string, unknown>) {
    // Redact sensitive data from message
    const safeMessage = redactSensitiveData(message);
    super(safeMessage);

    this.name = 'AuthenticationError';
    this.code = code;
    this.details = details ? sanitizeDetails(details) : undefined;

    // Maintain proper stack trace in V8 environments
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AuthenticationError);
    }
  }

  /**
   * Convert to AuthError interface.
   */
  toAuthError(): AuthError {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}

// =============================================================================
// Specific Error Classes
// =============================================================================

/**
 * Error thrown when state parameter validation fails.
 *
 * Requirement 13.1: Parse error and return descriptive message
 */
export class InvalidStateError extends AuthenticationError {
  constructor(message = 'State parameter validation failed') {
    super('INVALID_STATE', message);
    this.name = 'InvalidStateError';
  }
}

/**
 * Error thrown when an operation times out.
 *
 * Requirement 13.1: Parse error and return descriptive message
 */
export class TimeoutError extends AuthenticationError {
  constructor(message = 'Operation timed out', details?: { timeoutMs?: number }) {
    super('TIMEOUT', message, details);
    this.name = 'TimeoutError';
  }
}

/**
 * Error thrown when a network error occurs.
 *
 * Requirement 13.2: Return error indicating network failure and affected endpoint
 */
export class NetworkError extends AuthenticationError {
  constructor(message: string, endpoint?: string) {
    const details: Record<string, unknown> = {};
    if (endpoint) {
      details.endpoint = endpoint;
    }
    super('NETWORK_ERROR', message, Object.keys(details).length > 0 ? details : undefined);
    this.name = 'NetworkError';
  }
}

/**
 * Error thrown when credentials are invalid.
 *
 * Requirement 13.1: Parse error and return descriptive message
 */
export class InvalidCredentialsError extends AuthenticationError {
  constructor(message = 'Invalid credentials') {
    super('INVALID_CREDENTIALS', message);
    this.name = 'InvalidCredentialsError';
  }
}

/**
 * Error thrown when credential storage fails.
 *
 * Requirement 13.3: Return error indicating storage backend and failure reason
 */
export class StorageError extends AuthenticationError {
  constructor(message: string, backend?: string) {
    const details: Record<string, unknown> = {};
    if (backend) {
      details.backend = backend;
    }
    super('STORAGE_ERROR', message, Object.keys(details).length > 0 ? details : undefined);
    this.name = 'StorageError';
  }
}

/**
 * Error thrown when an OAuth provider returns an error.
 *
 * Requirement 13.1: Parse error and return descriptive message including error code and description
 */
export class ProviderError extends AuthenticationError {
  constructor(
    message: string,
    details?: { errorCode?: string; errorDescription?: string; providerId?: AuthProviderId }
  ) {
    super('PROVIDER_ERROR', message, details);
    this.name = 'ProviderError';
  }
}

/**
 * Error thrown when an unsupported provider is specified.
 *
 * Requirement 13.4: Return error listing supported providers
 */
export class UnsupportedProviderError extends AuthenticationError {
  constructor(providerId: string) {
    const supportedProviders = [...VALID_PROVIDER_IDS];
    super(
      'UNSUPPORTED_PROVIDER',
      `Provider '${providerId}' is not supported`,
      { providerId, supportedProviders }
    );
    this.name = 'UnsupportedProviderError';
  }
}

/**
 * Error thrown when the callback server encounters an error.
 *
 * Requirement 13.1: Parse error and return descriptive message
 */
export class CallbackError extends AuthenticationError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('CALLBACK_ERROR', message, details);
    this.name = 'CallbackError';
  }
}

/**
 * Error thrown when token refresh fails.
 *
 * Requirement 13.1: Parse error and return descriptive message
 */
export class TokenRefreshError extends AuthenticationError {
  constructor(message = 'Token refresh failed', providerId?: AuthProviderId) {
    const details: Record<string, unknown> = {};
    if (providerId) {
      details.providerId = providerId;
    }
    super('TOKEN_REFRESH_FAILED', message, Object.keys(details).length > 0 ? details : undefined);
    this.name = 'TokenRefreshError';
  }
}

// =============================================================================
// Provider Error Response Parsing
// =============================================================================

/**
 * Standard OAuth 2.0 error response structure.
 */
export interface OAuthErrorResponse {
  error: string;
  error_description?: string;
  error_uri?: string;
}

/**
 * Check if an object is an OAuth error response.
 *
 * @param obj - The object to check
 * @returns True if the object is an OAuth error response
 */
export function isOAuthErrorResponse(obj: unknown): obj is OAuthErrorResponse {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'error' in obj &&
    typeof (obj as OAuthErrorResponse).error === 'string'
  );
}

/**
 * Parse an OAuth provider error response into an AuthError.
 *
 * Requirement 13.1: Parse error and return descriptive message including error code and description
 *
 * @param response - The error response from the provider
 * @param providerId - The provider that returned the error
 * @returns A structured AuthError
 */
export function parseProviderErrorResponse(
  response: unknown,
  providerId?: AuthProviderId
): AuthError {
  // Handle string responses
  if (typeof response === 'string') {
    // Try to parse as JSON
    try {
      const parsed = JSON.parse(response);
      return parseProviderErrorResponse(parsed, providerId);
    } catch {
      // Not JSON, treat as plain error message
      return {
        code: 'PROVIDER_ERROR',
        message: redactSensitiveData(response),
        details: providerId ? { providerId } : undefined,
      };
    }
  }

  // Handle OAuth error response format
  if (isOAuthErrorResponse(response)) {
    const errorCode = response.error;
    const errorDescription = response.error_description;

    let message = `Provider error: ${errorCode}`;
    if (errorDescription) {
      message += ` - ${errorDescription}`;
    }

    // Sanitize details to prevent sensitive data leakage
    const rawDetails = {
      errorCode,
      ...(errorDescription && { errorDescription }),
      ...(response.error_uri && { errorUri: response.error_uri }),
      ...(providerId && { providerId }),
    };

    return {
      code: 'PROVIDER_ERROR',
      message: redactSensitiveData(message),
      details: sanitizeDetails(rawDetails),
    };
  }

  // Handle generic object responses
  if (typeof response === 'object' && response !== null) {
    const obj = response as Record<string, unknown>;

    // Check for common error message fields
    const errorMessage =
      obj.message || obj.error_message || obj.errorMessage || obj.error || 'Unknown provider error';

    return {
      code: 'PROVIDER_ERROR',
      message: redactSensitiveData(String(errorMessage)),
      details: providerId ? { providerId } : undefined,
    };
  }

  // Fallback for unknown response types
  return {
    code: 'PROVIDER_ERROR',
    message: 'Unknown provider error',
    details: providerId ? { providerId } : undefined,
  };
}

/**
 * Parse an HTTP error response from a provider.
 *
 * @param status - The HTTP status code
 * @param body - The response body (string or object)
 * @param providerId - The provider that returned the error
 * @returns A structured AuthError
 */
export function parseHttpErrorResponse(
  status: number,
  body: unknown,
  providerId?: AuthProviderId
): AuthError {
  // Parse the body first
  const bodyError = parseProviderErrorResponse(body, providerId);

  // Enhance the message with HTTP status
  const statusMessage = getHttpStatusMessage(status);
  const enhancedMessage = `HTTP ${status} ${statusMessage}: ${bodyError.message}`;

  return {
    ...bodyError,
    message: enhancedMessage,
    details: {
      ...bodyError.details,
      httpStatus: status,
    },
  };
}

/**
 * Get a human-readable message for an HTTP status code.
 *
 * @param status - The HTTP status code
 * @returns A human-readable status message
 */
function getHttpStatusMessage(status: number): string {
  const messages: Record<number, string> = {
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    405: 'Method Not Allowed',
    408: 'Request Timeout',
    429: 'Too Many Requests',
    500: 'Internal Server Error',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
    504: 'Gateway Timeout',
  };
  return messages[status] || 'Error';
}

// =============================================================================
// Error Response Formatting
// =============================================================================

/**
 * Sanitize details object to remove sensitive data.
 *
 * @param details - The details object to sanitize
 * @returns A sanitized copy of the details
 */
function sanitizeDetails(details: Record<string, unknown>): Record<string, unknown> {
  const sensitiveKeys = [
    'accessToken',
    'access_token',
    'refreshToken',
    'refresh_token',
    'idToken',
    'id_token',
    'clientSecret',
    'client_secret',
    'apiKey',
    'api_key',
    'password',
    'secret',
    'codeVerifier',
    'code_verifier',
    'authorization',
  ];

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(details)) {
    const lowerKey = key.toLowerCase();

    // Check if this is a sensitive key
    if (sensitiveKeys.some((sk) => lowerKey.includes(sk.toLowerCase()))) {
      result[key] = '[REDACTED]';
      continue;
    }

    // Recursively sanitize nested objects
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      result[key] = sanitizeDetails(value as Record<string, unknown>);
    } else if (Array.isArray(value)) {
      // Recursively sanitize arrays
      result[key] = sanitizeArray(value);
    } else if (typeof value === 'string') {
      // Redact sensitive patterns in string values
      result[key] = redactSensitiveData(value);
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Sanitize an array to remove sensitive data.
 *
 * @param arr - The array to sanitize
 * @returns A sanitized copy of the array
 */
function sanitizeArray(arr: unknown[]): unknown[] {
  return arr.map((item) => {
    if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
      return sanitizeDetails(item as Record<string, unknown>);
    } else if (Array.isArray(item)) {
      return sanitizeArray(item);
    } else if (typeof item === 'string') {
      return redactSensitiveData(item);
    }
    return item;
  });
}

/**
 * Format an error for response, ensuring no sensitive data is exposed.
 *
 * Requirement 13.5: Never include sensitive information in error messages
 *
 * @param error - The error to format
 * @returns A formatted AuthError safe for response
 */
export function formatErrorResponse(error: unknown): AuthError {
  // Handle AuthenticationError instances
  if (error instanceof AuthenticationError) {
    return error.toAuthError();
  }

  // Handle standard Error instances
  if (error instanceof Error) {
    return {
      code: 'PROVIDER_ERROR',
      message: redactSensitiveData(error.message),
    };
  }

  // Handle AuthError objects
  if (isAuthError(error)) {
    return {
      code: error.code,
      message: redactSensitiveData(error.message),
      details: error.details ? sanitizeDetails(error.details) : undefined,
    };
  }

  // Handle string errors
  if (typeof error === 'string') {
    return {
      code: 'PROVIDER_ERROR',
      message: redactSensitiveData(error),
    };
  }

  // Fallback for unknown error types
  return {
    code: 'PROVIDER_ERROR',
    message: 'An unknown error occurred',
  };
}

/**
 * Type guard to check if an object is an AuthError.
 *
 * @param obj - The object to check
 * @returns True if the object is an AuthError
 */
function isAuthError(obj: unknown): obj is AuthError {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'code' in obj &&
    'message' in obj &&
    typeof (obj as AuthError).code === 'string' &&
    typeof (obj as AuthError).message === 'string'
  );
}

/**
 * Create an error for an unsupported provider.
 *
 * Requirement 13.4: Return error listing supported providers
 *
 * @param providerId - The unsupported provider ID
 * @returns An AuthError with supported providers listed
 */
export function createUnsupportedProviderError(providerId: string): AuthError {
  return {
    code: 'UNSUPPORTED_PROVIDER',
    message: `Provider '${providerId}' is not supported`,
    details: {
      providerId,
      supportedProviders: [...VALID_PROVIDER_IDS],
    },
  };
}

/**
 * Create an error for a network failure.
 *
 * Requirement 13.2: Return error indicating network failure and affected endpoint
 *
 * @param message - The error message
 * @param endpoint - The affected endpoint
 * @returns An AuthError with endpoint information
 */
export function createNetworkError(message: string, endpoint?: string): AuthError {
  return {
    code: 'NETWORK_ERROR',
    message: redactSensitiveData(message),
    details: endpoint ? { endpoint } : undefined,
  };
}

/**
 * Create an error for storage failure.
 *
 * Requirement 13.3: Return error indicating storage backend and failure reason
 *
 * @param message - The error message
 * @param backend - The storage backend that failed
 * @returns An AuthError with backend information
 */
export function createStorageError(message: string, backend?: string): AuthError {
  return {
    code: 'STORAGE_ERROR',
    message: redactSensitiveData(message),
    details: backend ? { backend } : undefined,
  };
}
