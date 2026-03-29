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
 * Property-based tests for PKCE (Proof Key for Code Exchange) module.
 *
 * Feature: oauth-authentication
 * Properties 1-4: PKCE Code Verifier and Challenge
 *
 * @module pkce.property.test
 */

import * as fc from 'fast-check';
import { createHash } from 'crypto';
import {
  generateCodeVerifier,
  generateCodeChallenge,
  generatePKCEPair,
  PKCE_VERIFIER_MIN_LENGTH,
  PKCE_VERIFIER_MAX_LENGTH,
  PKCE_CODE_CHALLENGE_METHOD,
} from './pkce';

/**
 * Unreserved URI characters allowed in PKCE code verifier per RFC 7636.
 * Characters: A-Z, a-z, 0-9, hyphen (-), period (.), underscore (_), tilde (~)
 */
const UNRESERVED_CHARS_REGEX = /^[A-Za-z0-9\-._~]+$/;

/**
 * Base64url encoding regex (no padding).
 * Characters: A-Z, a-z, 0-9, hyphen (-), underscore (_)
 */
const BASE64URL_NO_PADDING_REGEX = /^[A-Za-z0-9\-_]+$/;

describe('PKCE Property Tests', () => {
  /**
   * Feature: oauth-authentication, Property 1: PKCE Code Verifier Format Invariant
   *
   * *For any* generated PKCE code verifier, the verifier SHALL be between 43 and 128
   * characters in length and contain only unreserved URI characters (A-Z, a-z, 0-9,
   * hyphen, period, underscore, tilde).
   *
   * **Validates: Requirements 1.1**
   */
  describe('Property 1: PKCE Code Verifier Format Invariant', () => {
    test('generated verifier length is within valid range (43-128 characters)', () => {
      fc.assert(
        fc.property(
          // Generate random lengths within valid range
          fc.integer({ min: PKCE_VERIFIER_MIN_LENGTH, max: PKCE_VERIFIER_MAX_LENGTH }),
          (length) => {
            const verifier = generateCodeVerifier(length);

            // Verify length is exactly as requested
            expect(verifier.length).toBe(length);

            // Verify length is within RFC 7636 bounds
            expect(verifier.length).toBeGreaterThanOrEqual(PKCE_VERIFIER_MIN_LENGTH);
            expect(verifier.length).toBeLessThanOrEqual(PKCE_VERIFIER_MAX_LENGTH);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('generated verifier contains only unreserved URI characters', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: PKCE_VERIFIER_MIN_LENGTH, max: PKCE_VERIFIER_MAX_LENGTH }),
          (length) => {
            const verifier = generateCodeVerifier(length);

            // Verify all characters are unreserved URI characters per RFC 7636
            expect(verifier).toMatch(UNRESERVED_CHARS_REGEX);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('default verifier (no length specified) meets format requirements', () => {
      fc.assert(
        fc.property(
          fc.constant(undefined), // No length parameter
          () => {
            const verifier = generateCodeVerifier();

            // Verify length is within valid range
            expect(verifier.length).toBeGreaterThanOrEqual(PKCE_VERIFIER_MIN_LENGTH);
            expect(verifier.length).toBeLessThanOrEqual(PKCE_VERIFIER_MAX_LENGTH);

            // Verify character set
            expect(verifier).toMatch(UNRESERVED_CHARS_REGEX);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('verifier from generatePKCEPair meets format requirements', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: PKCE_VERIFIER_MIN_LENGTH, max: PKCE_VERIFIER_MAX_LENGTH }),
          (length) => {
            const { verifier } = generatePKCEPair(length);

            // Verify length
            expect(verifier.length).toBe(length);
            expect(verifier.length).toBeGreaterThanOrEqual(PKCE_VERIFIER_MIN_LENGTH);
            expect(verifier.length).toBeLessThanOrEqual(PKCE_VERIFIER_MAX_LENGTH);

            // Verify character set
            expect(verifier).toMatch(UNRESERVED_CHARS_REGEX);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Feature: oauth-authentication, Property 2: PKCE Code Challenge Computation
   *
   * *For any* valid PKCE code verifier, the computed code challenge SHALL be a valid
   * base64url-encoded string without padding, representing the SHA-256 hash of the verifier.
   *
   * **Validates: Requirements 1.2**
   */
  describe('Property 2: PKCE Code Challenge Computation', () => {
    test('challenge is valid base64url without padding', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: PKCE_VERIFIER_MIN_LENGTH, max: PKCE_VERIFIER_MAX_LENGTH }),
          (length) => {
            const verifier = generateCodeVerifier(length);
            const challenge = generateCodeChallenge(verifier);

            // Verify base64url encoding without padding
            expect(challenge).toMatch(BASE64URL_NO_PADDING_REGEX);

            // Verify no padding characters
            expect(challenge).not.toContain('=');

            // Verify no standard base64 characters that differ from base64url
            expect(challenge).not.toContain('+');
            expect(challenge).not.toContain('/');
          }
        ),
        { numRuns: 100 }
      );
    });

    test('challenge represents SHA-256 hash of verifier', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: PKCE_VERIFIER_MIN_LENGTH, max: PKCE_VERIFIER_MAX_LENGTH }),
          (length) => {
            const verifier = generateCodeVerifier(length);
            const challenge = generateCodeChallenge(verifier);

            // Independently compute SHA-256 hash and base64url encode
            const expectedHash = createHash('sha256').update(verifier, 'ascii').digest();
            const expectedChallenge = expectedHash
              .toString('base64')
              .replace(/\+/g, '-')
              .replace(/\//g, '_')
              .replace(/=+$/, '');

            // Verify challenge matches expected computation
            expect(challenge).toBe(expectedChallenge);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('challenge has expected length for SHA-256 base64url encoding', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: PKCE_VERIFIER_MIN_LENGTH, max: PKCE_VERIFIER_MAX_LENGTH }),
          (length) => {
            const verifier = generateCodeVerifier(length);
            const challenge = generateCodeChallenge(verifier);

            // SHA-256 produces 32 bytes = 256 bits
            // Base64 encoding: ceil(32 * 4 / 3) = 43 characters (with padding)
            // Without padding: 43 characters (since 32 bytes = 256 bits, 256/6 = 42.67, ceil = 43)
            // Actually: 32 bytes -> 43 base64 chars without padding
            expect(challenge.length).toBe(43);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('challenge from generatePKCEPair is valid base64url', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: PKCE_VERIFIER_MIN_LENGTH, max: PKCE_VERIFIER_MAX_LENGTH }),
          (length) => {
            const { challenge } = generatePKCEPair(length);

            // Verify base64url encoding without padding
            expect(challenge).toMatch(BASE64URL_NO_PADDING_REGEX);
            expect(challenge).not.toContain('=');
            expect(challenge.length).toBe(43);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Feature: oauth-authentication, Property 3: PKCE S256 Method Enforcement
   *
   * *For any* generated authorization URL, the URL SHALL contain the parameter
   * `code_challenge_method=S256`.
   *
   * Note: Since authorization URL building is not yet implemented, this test verifies
   * that the challenge method constant is S256 and that the PKCE module only supports S256.
   *
   * **Validates: Requirements 1.3**
   */
  describe('Property 3: PKCE S256 Method Enforcement', () => {
    test('PKCE module uses S256 challenge method', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: PKCE_VERIFIER_MIN_LENGTH, max: PKCE_VERIFIER_MAX_LENGTH }),
          (length) => {
            const { verifier, challenge } = generatePKCEPair(length);

            // Verify the challenge is computed using S256 method
            // S256 = BASE64URL(SHA256(code_verifier))
            const expectedHash = createHash('sha256').update(verifier, 'ascii').digest();
            const expectedChallenge = expectedHash
              .toString('base64')
              .replace(/\+/g, '-')
              .replace(/\//g, '_')
              .replace(/=+$/, '');

            // If challenge matches S256 computation, S256 method is being used
            expect(challenge).toBe(expectedChallenge);

            // The challenge method constant should be S256 (from production code)
            expect(PKCE_CODE_CHALLENGE_METHOD).toBe('S256');
          }
        ),
        { numRuns: 100 }
      );
    });

    test('challenge computation is consistent with S256 specification', () => {
      fc.assert(
        fc.property(
          // Generate arbitrary valid verifier strings
          fc.stringOf(
            fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'.split('')),
            { minLength: PKCE_VERIFIER_MIN_LENGTH, maxLength: PKCE_VERIFIER_MAX_LENGTH }
          ),
          (verifier) => {
            const challenge = generateCodeChallenge(verifier);

            // S256 method: BASE64URL(SHA256(ASCII(code_verifier)))
            const sha256Hash = createHash('sha256').update(verifier, 'ascii').digest();
            const base64urlEncoded = sha256Hash
              .toString('base64')
              .replace(/\+/g, '-')
              .replace(/\//g, '_')
              .replace(/=+$/, '');

            expect(challenge).toBe(base64urlEncoded);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Feature: oauth-authentication, Property 4: PKCE Round-Trip Consistency
   *
   * *For any* valid code verifier, computing the challenge and then verifying that
   * challenge against the original verifier SHALL always succeed (deterministic transformation).
   *
   * **Validates: Requirements 1.4**
   */
  describe('Property 4: PKCE Round-Trip Consistency', () => {
    test('same verifier always produces same challenge (deterministic)', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: PKCE_VERIFIER_MIN_LENGTH, max: PKCE_VERIFIER_MAX_LENGTH }),
          (length) => {
            const verifier = generateCodeVerifier(length);

            // Compute challenge multiple times
            const challenge1 = generateCodeChallenge(verifier);
            const challenge2 = generateCodeChallenge(verifier);
            const challenge3 = generateCodeChallenge(verifier);

            // All challenges should be identical
            expect(challenge1).toBe(challenge2);
            expect(challenge2).toBe(challenge3);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('verifier can be verified against its challenge', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: PKCE_VERIFIER_MIN_LENGTH, max: PKCE_VERIFIER_MAX_LENGTH }),
          (length) => {
            const verifier = generateCodeVerifier(length);
            const challenge = generateCodeChallenge(verifier);

            // Verification: recompute challenge from verifier and compare
            const recomputedChallenge = generateCodeChallenge(verifier);

            expect(recomputedChallenge).toBe(challenge);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('different verifiers produce different challenges', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: PKCE_VERIFIER_MIN_LENGTH, max: PKCE_VERIFIER_MAX_LENGTH }),
          fc.integer({ min: PKCE_VERIFIER_MIN_LENGTH, max: PKCE_VERIFIER_MAX_LENGTH }),
          (length1, length2) => {
            const verifier1 = generateCodeVerifier(length1);
            const verifier2 = generateCodeVerifier(length2);

            // Skip if verifiers happen to be identical (extremely unlikely)
            if (verifier1 === verifier2) {
              return;
            }

            const challenge1 = generateCodeChallenge(verifier1);
            const challenge2 = generateCodeChallenge(verifier2);

            // Different verifiers should produce different challenges
            expect(challenge1).not.toBe(challenge2);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('generatePKCEPair produces consistent verifier-challenge pairs', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: PKCE_VERIFIER_MIN_LENGTH, max: PKCE_VERIFIER_MAX_LENGTH }),
          (length) => {
            const { verifier, challenge } = generatePKCEPair(length);

            // Verify the challenge matches what we'd compute from the verifier
            const expectedChallenge = generateCodeChallenge(verifier);

            expect(challenge).toBe(expectedChallenge);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('round-trip verification with arbitrary valid verifier strings', () => {
      fc.assert(
        fc.property(
          // Generate arbitrary valid verifier strings using unreserved URI characters
          fc.stringOf(
            fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'.split('')),
            { minLength: PKCE_VERIFIER_MIN_LENGTH, maxLength: PKCE_VERIFIER_MAX_LENGTH }
          ),
          (verifier) => {
            // Compute challenge
            const challenge = generateCodeChallenge(verifier);

            // Verify round-trip: recomputing challenge should give same result
            const verifiedChallenge = generateCodeChallenge(verifier);

            expect(verifiedChallenge).toBe(challenge);

            // Verify the challenge is valid base64url
            expect(challenge).toMatch(BASE64URL_NO_PADDING_REGEX);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
