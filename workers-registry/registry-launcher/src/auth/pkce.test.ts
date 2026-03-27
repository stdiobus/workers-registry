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
 * Unit tests for PKCE (Proof Key for Code Exchange) module.
 *
 * Tests edge cases for PKCE code verifier and challenge generation.
 *
 * **Validates: Requirements 1.1, 1.2**
 *
 * @module pkce.test
 */

import { createHash } from 'crypto';
import {
  generateCodeVerifier,
  generateCodeChallenge,
  generatePKCEPair,
  validateCodeVerifier,
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

describe('PKCE Unit Tests', () => {
  describe('generateCodeVerifier', () => {
    describe('Minimum verifier length (43 characters)', () => {
      it('should generate verifier with exactly 43 characters when requested', () => {
        const verifier = generateCodeVerifier(PKCE_VERIFIER_MIN_LENGTH);
        expect(verifier.length).toBe(43);
      });

      it('should generate valid verifier at minimum length', () => {
        const verifier = generateCodeVerifier(43);
        expect(verifier).toMatch(UNRESERVED_CHARS_REGEX);
      });

      it('should generate unique verifiers at minimum length', () => {
        const verifier1 = generateCodeVerifier(43);
        const verifier2 = generateCodeVerifier(43);
        expect(verifier1).not.toBe(verifier2);
      });
    });

    describe('Maximum verifier length (128 characters)', () => {
      it('should generate verifier with exactly 128 characters when requested', () => {
        const verifier = generateCodeVerifier(PKCE_VERIFIER_MAX_LENGTH);
        expect(verifier.length).toBe(128);
      });

      it('should generate valid verifier at maximum length', () => {
        const verifier = generateCodeVerifier(128);
        expect(verifier).toMatch(UNRESERVED_CHARS_REGEX);
      });

      it('should generate unique verifiers at maximum length', () => {
        const verifier1 = generateCodeVerifier(128);
        const verifier2 = generateCodeVerifier(128);
        expect(verifier1).not.toBe(verifier2);
      });
    });

    describe('Invalid length handling', () => {
      it('should throw error for length below minimum (42)', () => {
        expect(() => generateCodeVerifier(42)).toThrow(
          `PKCE code verifier length must be between ${PKCE_VERIFIER_MIN_LENGTH} and ${PKCE_VERIFIER_MAX_LENGTH}, got 42`
        );
      });

      it('should throw error for length above maximum (129)', () => {
        expect(() => generateCodeVerifier(129)).toThrow(
          `PKCE code verifier length must be between ${PKCE_VERIFIER_MIN_LENGTH} and ${PKCE_VERIFIER_MAX_LENGTH}, got 129`
        );
      });

      it('should throw error for zero length', () => {
        expect(() => generateCodeVerifier(0)).toThrow(
          `PKCE code verifier length must be between ${PKCE_VERIFIER_MIN_LENGTH} and ${PKCE_VERIFIER_MAX_LENGTH}, got 0`
        );
      });

      it('should throw error for negative length', () => {
        expect(() => generateCodeVerifier(-1)).toThrow(
          `PKCE code verifier length must be between ${PKCE_VERIFIER_MIN_LENGTH} and ${PKCE_VERIFIER_MAX_LENGTH}, got -1`
        );
      });

      it('should throw error for very large length', () => {
        expect(() => generateCodeVerifier(1000)).toThrow(
          `PKCE code verifier length must be between ${PKCE_VERIFIER_MIN_LENGTH} and ${PKCE_VERIFIER_MAX_LENGTH}, got 1000`
        );
      });

      it('should throw error for length of 1', () => {
        expect(() => generateCodeVerifier(1)).toThrow(
          `PKCE code verifier length must be between ${PKCE_VERIFIER_MIN_LENGTH} and ${PKCE_VERIFIER_MAX_LENGTH}, got 1`
        );
      });

      it('should throw error for NaN length', () => {
        expect(() => generateCodeVerifier(NaN)).toThrow(
          'PKCE code verifier length must be a valid integer'
        );
      });

      it('should throw error for Infinity length', () => {
        expect(() => generateCodeVerifier(Infinity)).toThrow(
          'PKCE code verifier length must be a valid integer'
        );
      });

      it('should throw error for non-integer length (float)', () => {
        expect(() => generateCodeVerifier(43.5)).toThrow(
          'PKCE code verifier length must be a valid integer'
        );
      });
    });

    describe('Character set compliance', () => {
      it('should only contain unreserved URI characters', () => {
        // Generate multiple verifiers and check all characters
        for (let i = 0; i < 10; i++) {
          const verifier = generateCodeVerifier();
          expect(verifier).toMatch(UNRESERVED_CHARS_REGEX);
        }
      });

      it('should not contain reserved URI characters', () => {
        const reservedChars = ['!', '#', '$', '%', '&', "'", '(', ')', '*', '+', ',', '/', ':', ';', '=', '?', '@', '[', ']'];
        for (let i = 0; i < 10; i++) {
          const verifier = generateCodeVerifier();
          for (const char of reservedChars) {
            expect(verifier).not.toContain(char);
          }
        }
      });

      it('should not contain whitespace characters', () => {
        for (let i = 0; i < 10; i++) {
          const verifier = generateCodeVerifier();
          expect(verifier).not.toMatch(/\s/);
        }
      });

      it('should not contain control characters', () => {
        for (let i = 0; i < 10; i++) {
          const verifier = generateCodeVerifier();
          // eslint-disable-next-line no-control-regex
          expect(verifier).not.toMatch(/[\x00-\x1F\x7F]/);
        }
      });
    });

    describe('Default length behavior', () => {
      it('should use default length when no argument provided', () => {
        const verifier = generateCodeVerifier();
        expect(verifier.length).toBe(64); // Default is 64
      });

      it('should generate valid verifier with default length', () => {
        const verifier = generateCodeVerifier();
        expect(verifier).toMatch(UNRESERVED_CHARS_REGEX);
        expect(verifier.length).toBeGreaterThanOrEqual(PKCE_VERIFIER_MIN_LENGTH);
        expect(verifier.length).toBeLessThanOrEqual(PKCE_VERIFIER_MAX_LENGTH);
      });
    });

    describe('Boundary values', () => {
      it('should accept length at lower boundary (43)', () => {
        expect(() => generateCodeVerifier(43)).not.toThrow();
        expect(generateCodeVerifier(43).length).toBe(43);
      });

      it('should accept length at upper boundary (128)', () => {
        expect(() => generateCodeVerifier(128)).not.toThrow();
        expect(generateCodeVerifier(128).length).toBe(128);
      });

      it('should accept length just above lower boundary (44)', () => {
        expect(() => generateCodeVerifier(44)).not.toThrow();
        expect(generateCodeVerifier(44).length).toBe(44);
      });

      it('should accept length just below upper boundary (127)', () => {
        expect(() => generateCodeVerifier(127)).not.toThrow();
        expect(generateCodeVerifier(127).length).toBe(127);
      });
    });
  });

  describe('generateCodeChallenge', () => {
    describe('Known test vectors from RFC 7636 Appendix B', () => {
      /**
       * RFC 7636 Appendix B provides a test vector:
       * code_verifier = dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk
       * code_challenge = E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM
       */
      it('should compute correct challenge for RFC 7636 test vector', () => {
        const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
        const expectedChallenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

        const challenge = generateCodeChallenge(verifier);
        expect(challenge).toBe(expectedChallenge);
      });
    });

    describe('Empty string handling', () => {
      it('should compute challenge for empty string', () => {
        // SHA-256 of empty string is a known value
        const challenge = generateCodeChallenge('');

        // Verify it's valid base64url
        expect(challenge).toMatch(BASE64URL_NO_PADDING_REGEX);

        // SHA-256('') = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
        // Base64url encoded without padding
        const expectedHash = createHash('sha256').update('', 'ascii').digest();
        const expectedChallenge = expectedHash
          .toString('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');

        expect(challenge).toBe(expectedChallenge);
      });
    });

    describe('Base64url encoding', () => {
      it('should not contain standard base64 padding characters', () => {
        const verifier = generateCodeVerifier();
        const challenge = generateCodeChallenge(verifier);
        expect(challenge).not.toContain('=');
      });

      it('should not contain + character (replaced with -)', () => {
        // Generate many challenges to increase chance of hitting + in base64
        for (let i = 0; i < 20; i++) {
          const verifier = generateCodeVerifier();
          const challenge = generateCodeChallenge(verifier);
          expect(challenge).not.toContain('+');
        }
      });

      it('should not contain / character (replaced with _)', () => {
        // Generate many challenges to increase chance of hitting / in base64
        for (let i = 0; i < 20; i++) {
          const verifier = generateCodeVerifier();
          const challenge = generateCodeChallenge(verifier);
          expect(challenge).not.toContain('/');
        }
      });

      it('should produce 43 character challenge (SHA-256 base64url)', () => {
        const verifier = generateCodeVerifier();
        const challenge = generateCodeChallenge(verifier);
        // SHA-256 = 32 bytes = 256 bits
        // Base64url without padding: ceil(32 * 8 / 6) = 43 characters
        expect(challenge.length).toBe(43);
      });
    });

    describe('Edge cases for generateCodeChallenge', () => {
      it('should handle verifier with only alphanumeric characters', () => {
        const verifier = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrs';
        const challenge = generateCodeChallenge(verifier);
        expect(challenge).toMatch(BASE64URL_NO_PADDING_REGEX);
        expect(challenge.length).toBe(43);
      });

      it('should handle verifier with special unreserved characters', () => {
        const verifier = '-._~-._~-._~-._~-._~-._~-._~-._~-._~-._~-._';
        const challenge = generateCodeChallenge(verifier);
        expect(challenge).toMatch(BASE64URL_NO_PADDING_REGEX);
        expect(challenge.length).toBe(43);
      });

      it('should handle verifier at minimum length', () => {
        const verifier = 'a'.repeat(43);
        const challenge = generateCodeChallenge(verifier);
        expect(challenge).toMatch(BASE64URL_NO_PADDING_REGEX);
        expect(challenge.length).toBe(43);
      });

      it('should handle verifier at maximum length', () => {
        const verifier = 'z'.repeat(128);
        const challenge = generateCodeChallenge(verifier);
        expect(challenge).toMatch(BASE64URL_NO_PADDING_REGEX);
        expect(challenge.length).toBe(43);
      });

      it('should produce deterministic output for same input', () => {
        const verifier = 'test-verifier-for-determinism-check-12345678';
        const challenge1 = generateCodeChallenge(verifier);
        const challenge2 = generateCodeChallenge(verifier);
        const challenge3 = generateCodeChallenge(verifier);

        expect(challenge1).toBe(challenge2);
        expect(challenge2).toBe(challenge3);
      });

      it('should produce different output for different inputs', () => {
        const verifier1 = 'test-verifier-one-for-uniqueness-check-1234';
        const verifier2 = 'test-verifier-two-for-uniqueness-check-1234';

        const challenge1 = generateCodeChallenge(verifier1);
        const challenge2 = generateCodeChallenge(verifier2);

        expect(challenge1).not.toBe(challenge2);
      });

      it('should handle verifier with all allowed special characters', () => {
        // Mix of all unreserved URI characters
        const verifier = 'ABCabc012-._~ABCabc012-._~ABCabc012-._~ABC';
        const challenge = generateCodeChallenge(verifier);
        expect(challenge).toMatch(BASE64URL_NO_PADDING_REGEX);
      });
    });
  });

  describe('generatePKCEPair', () => {
    describe('Edge cases for generatePKCEPair', () => {
      it('should generate pair with minimum length verifier', () => {
        const { verifier, challenge } = generatePKCEPair(43);

        expect(verifier.length).toBe(43);
        expect(verifier).toMatch(UNRESERVED_CHARS_REGEX);
        expect(challenge).toMatch(BASE64URL_NO_PADDING_REGEX);
        expect(challenge.length).toBe(43);
      });

      it('should generate pair with maximum length verifier', () => {
        const { verifier, challenge } = generatePKCEPair(128);

        expect(verifier.length).toBe(128);
        expect(verifier).toMatch(UNRESERVED_CHARS_REGEX);
        expect(challenge).toMatch(BASE64URL_NO_PADDING_REGEX);
        expect(challenge.length).toBe(43);
      });

      it('should generate pair with default length when no argument', () => {
        const { verifier, challenge } = generatePKCEPair();

        expect(verifier.length).toBe(64); // Default length
        expect(verifier).toMatch(UNRESERVED_CHARS_REGEX);
        expect(challenge).toMatch(BASE64URL_NO_PADDING_REGEX);
      });

      it('should throw error for invalid length in pair generation', () => {
        expect(() => generatePKCEPair(42)).toThrow();
        expect(() => generatePKCEPair(129)).toThrow();
        expect(() => generatePKCEPair(0)).toThrow();
        expect(() => generatePKCEPair(-1)).toThrow();
      });

      it('should generate consistent verifier-challenge relationship', () => {
        const { verifier, challenge } = generatePKCEPair();

        // Independently compute challenge from verifier
        const expectedChallenge = generateCodeChallenge(verifier);

        expect(challenge).toBe(expectedChallenge);
      });

      it('should generate unique pairs on each call', () => {
        const pair1 = generatePKCEPair();
        const pair2 = generatePKCEPair();

        expect(pair1.verifier).not.toBe(pair2.verifier);
        expect(pair1.challenge).not.toBe(pair2.challenge);
      });

      it('should return object with correct structure', () => {
        const pair = generatePKCEPair();

        expect(pair).toHaveProperty('verifier');
        expect(pair).toHaveProperty('challenge');
        expect(typeof pair.verifier).toBe('string');
        expect(typeof pair.challenge).toBe('string');
      });
    });
  });

  describe('Constants', () => {
    it('should export correct minimum length constant', () => {
      expect(PKCE_VERIFIER_MIN_LENGTH).toBe(43);
    });

    it('should export correct maximum length constant', () => {
      expect(PKCE_VERIFIER_MAX_LENGTH).toBe(128);
    });

    it('should export S256 as the code challenge method', () => {
      expect(PKCE_CODE_CHALLENGE_METHOD).toBe('S256');
    });
  });

  describe('validateCodeVerifier', () => {
    describe('Valid verifiers', () => {
      it('should return true for valid verifier at minimum length', () => {
        const verifier = 'a'.repeat(43);
        expect(validateCodeVerifier(verifier)).toBe(true);
      });

      it('should return true for valid verifier at maximum length', () => {
        const verifier = 'z'.repeat(128);
        expect(validateCodeVerifier(verifier)).toBe(true);
      });

      it('should return true for verifier with all unreserved characters', () => {
        const verifier = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnop-._~';
        expect(validateCodeVerifier(verifier)).toBe(true);
      });

      it('should return true for generated verifier', () => {
        const verifier = generateCodeVerifier();
        expect(validateCodeVerifier(verifier)).toBe(true);
      });
    });

    describe('Invalid verifiers', () => {
      it('should return false for verifier too short', () => {
        const verifier = 'a'.repeat(42);
        expect(validateCodeVerifier(verifier)).toBe(false);
      });

      it('should return false for verifier too long', () => {
        const verifier = 'a'.repeat(129);
        expect(validateCodeVerifier(verifier)).toBe(false);
      });

      it('should return false for empty string', () => {
        expect(validateCodeVerifier('')).toBe(false);
      });

      it('should return false for verifier with invalid characters', () => {
        const verifier = 'a'.repeat(42) + '!';  // 43 chars but has invalid char
        expect(validateCodeVerifier(verifier)).toBe(false);
      });

      it('should return false for verifier with spaces', () => {
        const verifier = 'a'.repeat(42) + ' ';
        expect(validateCodeVerifier(verifier)).toBe(false);
      });

      it('should return false for non-string input', () => {
        expect(validateCodeVerifier(123 as unknown as string)).toBe(false);
        expect(validateCodeVerifier(null as unknown as string)).toBe(false);
        expect(validateCodeVerifier(undefined as unknown as string)).toBe(false);
      });
    });
  });

  describe('generateCodeChallenge strict mode', () => {
    it('should throw error in strict mode for invalid verifier', () => {
      expect(() => generateCodeChallenge('short', true)).toThrow(
        'Invalid PKCE code verifier format'
      );
    });

    it('should throw error in strict mode for verifier with invalid chars', () => {
      const invalidVerifier = 'a'.repeat(42) + '!';
      expect(() => generateCodeChallenge(invalidVerifier, true)).toThrow(
        'Invalid PKCE code verifier format'
      );
    });

    it('should not throw in strict mode for valid verifier', () => {
      const validVerifier = generateCodeVerifier();
      expect(() => generateCodeChallenge(validVerifier, true)).not.toThrow();
    });

    it('should not throw in non-strict mode for invalid verifier (backward compatibility)', () => {
      expect(() => generateCodeChallenge('short')).not.toThrow();
    });
  });
});
