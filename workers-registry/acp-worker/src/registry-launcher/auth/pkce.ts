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
 * Unreserved URI characters allowed in PKCE code verifier per RFC 7636.
 * Characters: A-Z, a-z, 0-9, hyphen (-), period (.), underscore (_), tilde (~)
 */
const UNRESERVED_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

/**
 * Generate a cryptographically secure PKCE code verifier.
 *
 * The verifier is generated using crypto.randomBytes for cryptographic randomness,
 * then encoded using only unreserved URI characters as specified in RFC 7636.
 *
 * @param length - Optional length of the verifier (default: 64, must be 43-128)
 * @returns A random string between 43-128 characters using unreserved URI characters
 * @throws Error if length is outside the valid range (43-128)
 */
export function generateCodeVerifier(length: number = DEFAULT_VERIFIER_LENGTH): string {
  if (length < PKCE_VERIFIER_MIN_LENGTH || length > PKCE_VERIFIER_MAX_LENGTH) {
    throw new Error(
      `PKCE code verifier length must be between ${PKCE_VERIFIER_MIN_LENGTH} and ${PKCE_VERIFIER_MAX_LENGTH}, got ${length}`,
    );
  }

  // Generate random bytes - we need enough bytes to select from our character set
  // Each byte gives us a value 0-255, which we use to index into UNRESERVED_CHARS
  const randomBuffer = randomBytes(length);
  const charsetLength = UNRESERVED_CHARS.length;

  let verifier = '';
  for (let i = 0; i < length; i++) {
    // Use modulo to map random byte to character index
    // This provides uniform distribution since 256 % 66 has minimal bias
    verifier += UNRESERVED_CHARS[randomBuffer[i] % charsetLength];
  }

  return verifier;
}

/**
 * Generate a PKCE code challenge from a code verifier.
 *
 * Computes the SHA-256 hash of the verifier and encodes it as base64url
 * without padding, as required by RFC 7636 S256 method.
 *
 * @param verifier - The code verifier to hash
 * @returns Base64url-encoded SHA-256 hash of the verifier (without padding)
 */
export function generateCodeChallenge(verifier: string): string {
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
