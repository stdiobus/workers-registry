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
 * PKCE (Proof Key for Code Exchange) implementation.
 *
 * Provides code verifier and challenge generation for OAuth 2.1 PKCE flow.
 * Implements RFC 7636 with S256 challenge method as required by OAuth 2.1.
 *
 * @module pkce
 */

import { randomBytes, createHash } from 'crypto';

/**
 * Minimum length for PKCE code verifier per RFC 7636.
 */
export const PKCE_VERIFIER_MIN_LENGTH = 43;

/**
 * Maximum length for PKCE code verifier per RFC 7636.
 */
export const PKCE_VERIFIER_MAX_LENGTH = 128;

/**
 * Default length for PKCE code verifier.
 * Using 64 characters provides good entropy while staying well within limits.
 */
const DEFAULT_VERIFIER_LENGTH = 64;

/**
 * PKCE code challenge method.
 * OAuth 2.1 requires S256 (SHA-256) method.
 */
export const PKCE_CODE_CHALLENGE_METHOD = 'S256' as const;

/**
 * Unreserved URI characters allowed in PKCE code verifier per RFC 7636.
 * Characters: A-Z, a-z, 0-9, hyphen (-), period (.), underscore (_), tilde (~)
 */
const UNRESERVED_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

/**
 * Regex pattern for validating PKCE code verifier format.
 * Only unreserved URI characters are allowed per RFC 7636.
 */
const UNRESERVED_CHARS_REGEX = /^[A-Za-z0-9\-._~]+$/;

/**
 * Generate a cryptographically secure PKCE code verifier.
 *
 * The verifier is generated using crypto.randomBytes for cryptographic randomness,
 * then encoded using only unreserved URI characters as specified in RFC 7636.
 * Uses rejection sampling to avoid modulo bias.
 *
 * @param length - Optional length of the verifier (default: 64, must be 43-128)
 * @returns A random string between 43-128 characters using unreserved URI characters
 * @throws Error if length is outside the valid range (43-128) or not a valid integer
 */
export function generateCodeVerifier(length: number = DEFAULT_VERIFIER_LENGTH): string {
  // Validate length is a valid integer
  if (!Number.isInteger(length) || !Number.isFinite(length)) {
    throw new Error(
      `PKCE code verifier length must be a valid integer, got ${length}`,
    );
  }

  if (length < PKCE_VERIFIER_MIN_LENGTH || length > PKCE_VERIFIER_MAX_LENGTH) {
    throw new Error(
      `PKCE code verifier length must be between ${PKCE_VERIFIER_MIN_LENGTH} and ${PKCE_VERIFIER_MAX_LENGTH}, got ${length}`,
    );
  }

  const charsetLength = UNRESERVED_CHARS.length; // 66 characters

  // Calculate the largest multiple of charsetLength that fits in a byte (256)
  // This is used for rejection sampling to avoid modulo bias
  // For 66 chars: 256 - (256 % 66) = 256 - 58 = 198
  const maxValidByte = 256 - (256 % charsetLength);

  let verifier = '';
  let bytesNeeded = length;

  while (verifier.length < length) {
    // Generate more random bytes than needed to account for rejections
    // On average, we reject about 22.6% of bytes (58/256), so request ~30% extra
    const randomBuffer = randomBytes(Math.ceil(bytesNeeded * 1.4));

    for (let i = 0; i < randomBuffer.length && verifier.length < length; i++) {
      const byte = randomBuffer[i];

      // Rejection sampling: only use bytes that don't cause modulo bias
      if (byte < maxValidByte) {
        verifier += UNRESERVED_CHARS[byte % charsetLength];
      }
    }

    bytesNeeded = length - verifier.length;
  }

  return verifier;
}

/**
 * Validate a PKCE code verifier format.
 *
 * Checks that the verifier meets RFC 7636 requirements:
 * - Length between 43 and 128 characters
 * - Contains only unreserved URI characters
 *
 * @param verifier - The code verifier to validate
 * @returns True if the verifier is valid, false otherwise
 */
export function validateCodeVerifier(verifier: string): boolean {
  if (typeof verifier !== 'string') {
    return false;
  }

  if (verifier.length < PKCE_VERIFIER_MIN_LENGTH || verifier.length > PKCE_VERIFIER_MAX_LENGTH) {
    return false;
  }

  return UNRESERVED_CHARS_REGEX.test(verifier);
}

/**
 * Generate a PKCE code challenge from a code verifier.
 *
 * Computes the SHA-256 hash of the verifier and encodes it as base64url
 * without padding, as required by RFC 7636 S256 method.
 *
 * @param verifier - The code verifier to hash
 * @param strict - If true, validates verifier format (default: false for backward compatibility)
 * @returns Base64url-encoded SHA-256 hash of the verifier (without padding)
 * @throws Error if strict mode is enabled and verifier format is invalid
 */
export function generateCodeChallenge(verifier: string, strict: boolean = false): string {
  if (strict && !validateCodeVerifier(verifier)) {
    throw new Error(
      `Invalid PKCE code verifier format. Must be ${PKCE_VERIFIER_MIN_LENGTH}-${PKCE_VERIFIER_MAX_LENGTH} characters using only unreserved URI characters.`,
    );
  }

  // Compute SHA-256 hash of the verifier
  const hash = createHash('sha256').update(verifier, 'ascii').digest();

  // Convert to base64url encoding without padding
  // base64url: replace + with -, / with _, remove = padding
  return hash
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Generate a PKCE pair (verifier and challenge).
 *
 * Creates a cryptographically secure code verifier and computes
 * the corresponding S256 code challenge.
 *
 * @param length - Optional length of the verifier (default: 64, must be 43-128)
 * @returns Object containing both the verifier and challenge
 */
export function generatePKCEPair(length?: number): { verifier: string; challenge: string } {
  const verifier = generateCodeVerifier(length);
  const challenge = generateCodeChallenge(verifier);

  return { verifier, challenge };
}
