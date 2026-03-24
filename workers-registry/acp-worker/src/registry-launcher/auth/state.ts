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
 * State parameter generation and validation for OAuth 2.1 CSRF protection.
 *
 * @module state
 */

import { randomBytes, timingSafeEqual } from 'crypto';

/**
 * Minimum number of random bytes for state parameter.
 * 32 bytes provides 256 bits of entropy for CSRF protection.
 */
export const STATE_MIN_BYTES = 32;

/**
 * Generate a cryptographically secure state parameter.
 *
 * Generates at least 32 bytes of cryptographic randomness using
 * Node.js crypto.randomBytes, then encodes as base64url without padding.
 *
 * @returns Base64url-encoded random bytes (at least 32 bytes)
 */
export function generateState(): string {
  // Generate 32 cryptographically random bytes
  const randomBuffer = randomBytes(STATE_MIN_BYTES);

  // Convert to base64url encoding without padding
  // base64url: replace + with -, / with _, remove = padding
  return randomBuffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Validate a returned state parameter against the expected value.
 *
 * Uses constant-time comparison to prevent timing attacks.
 * Returns false for missing, empty, or mismatched state parameters.
 *
 * @param expected - The original state parameter
 * @param received - The state parameter from the callback
 * @returns True if the states match exactly, false otherwise
 */
export function validateState(expected: string | null | undefined, received: string | null | undefined): boolean {
  // Return false for missing or empty state parameters
  if (!expected || !received) {
    return false;
  }

  // Return false if lengths don't match (can be done in constant time)
  if (expected.length !== received.length) {
    return false;
  }

  // Use constant-time comparison to prevent timing attacks
  // Convert strings to Buffers for timingSafeEqual
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const receivedBuffer = Buffer.from(received, 'utf8');

  return timingSafeEqual(expectedBuffer, receivedBuffer);
}
