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
 * Unit tests for state parameter generation and validation module.
 *
 * Tests edge cases for state parameter handling including empty/null values,
 * timing-safe comparison, and various string edge cases.
 *
 * **Validates: Requirements 2.2, 2.3**
 *
 * @module state.test
 */

import { generateState, validateState, STATE_MIN_BYTES } from './state';

/**
 * Base64url encoding regex (no padding).
 * Characters: A-Z, a-z, 0-9, hyphen (-), underscore (_)
 */
const BASE64URL_NO_PADDING_REGEX = /^[A-Za-z0-9\-_]+$/;

describe('State Parameter Unit Tests', () => {
  describe('generateState', () => {
    describe('Basic generation', () => {
      it('should generate a non-empty state parameter', () => {
        const state = generateState();
        expect(state).toBeTruthy();
        expect(state.length).toBeGreaterThan(0);
      });

      it('should generate valid base64url encoded string', () => {
        const state = generateState();
        expect(state).toMatch(BASE64URL_NO_PADDING_REGEX);
      });

      it('should generate unique states on each call', () => {
        const state1 = generateState();
        const state2 = generateState();
        expect(state1).not.toBe(state2);
      });

      it('should generate state with sufficient entropy (at least 32 bytes decoded)', () => {
        const state = generateState();
        // Base64url encoding: 4 characters = 3 bytes
        // 32 bytes = ceil(32 * 4 / 3) = 43 characters minimum
        expect(state.length).toBeGreaterThanOrEqual(43);
      });
    });

    describe('Encoding compliance', () => {
      it('should not contain standard base64 padding characters', () => {
        for (let i = 0; i < 10; i++) {
          const state = generateState();
          expect(state).not.toContain('=');
        }
      });

      it('should not contain + character (replaced with -)', () => {
        for (let i = 0; i < 10; i++) {
          const state = generateState();
          expect(state).not.toContain('+');
        }
      });

      it('should not contain / character (replaced with _)', () => {
        for (let i = 0; i < 10; i++) {
          const state = generateState();
          expect(state).not.toContain('/');
        }
      });
    });
  });

  describe('validateState', () => {
    describe('Empty string handling', () => {
      it('should return false when expected is empty string', () => {
        const result = validateState('', 'some-state');
        expect(result).toBe(false);
      });

      it('should return false when received is empty string', () => {
        const result = validateState('some-state', '');
        expect(result).toBe(false);
      });

      it('should return false when both are empty strings', () => {
        const result = validateState('', '');
        expect(result).toBe(false);
      });
    });

    describe('Null handling', () => {
      it('should return false when expected is null', () => {
        const result = validateState(null, 'some-state');
        expect(result).toBe(false);
      });

      it('should return false when received is null', () => {
        const result = validateState('some-state', null);
        expect(result).toBe(false);
      });

      it('should return false when both are null', () => {
        const result = validateState(null, null);
        expect(result).toBe(false);
      });
    });

    describe('Undefined handling', () => {
      it('should return false when expected is undefined', () => {
        const result = validateState(undefined, 'some-state');
        expect(result).toBe(false);
      });

      it('should return false when received is undefined', () => {
        const result = validateState('some-state', undefined);
        expect(result).toBe(false);
      });

      it('should return false when both are undefined', () => {
        const result = validateState(undefined, undefined);
        expect(result).toBe(false);
      });
    });

    describe('Mixed null/undefined/empty handling', () => {
      it('should return false for null expected and undefined received', () => {
        const result = validateState(null, undefined);
        expect(result).toBe(false);
      });

      it('should return false for undefined expected and null received', () => {
        const result = validateState(undefined, null);
        expect(result).toBe(false);
      });

      it('should return false for empty expected and null received', () => {
        const result = validateState('', null);
        expect(result).toBe(false);
      });

      it('should return false for null expected and empty received', () => {
        const result = validateState(null, '');
        expect(result).toBe(false);
      });

      it('should return false for empty expected and undefined received', () => {
        const result = validateState('', undefined);
        expect(result).toBe(false);
      });

      it('should return false for undefined expected and empty received', () => {
        const result = validateState(undefined, '');
        expect(result).toBe(false);
      });
    });

    describe('Timing-safe comparison verification', () => {
      it('should return true for identical strings', () => {
        const state = 'abc123-xyz789_test';
        const result = validateState(state, state);
        expect(result).toBe(true);
      });

      it('should return true for same content different string instances', () => {
        const expected = 'test-state-parameter-12345';
        const received = 'test-state-parameter-12345';
        const result = validateState(expected, received);
        expect(result).toBe(true);
      });

      it('should return false for same length but different content', () => {
        const expected = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
        const received = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab';
        const result = validateState(expected, received);
        expect(result).toBe(false);
      });

      it('should return false for same length strings differing at start', () => {
        const expected = 'Xbcdefghijklmnopqrstuvwxyz0123456789abcdef';
        const received = 'Ybcdefghijklmnopqrstuvwxyz0123456789abcdef';
        const result = validateState(expected, received);
        expect(result).toBe(false);
      });

      it('should return false for same length strings differing at end', () => {
        const expected = 'abcdefghijklmnopqrstuvwxyz0123456789abcdeX';
        const received = 'abcdefghijklmnopqrstuvwxyz0123456789abcdeY';
        const result = validateState(expected, received);
        expect(result).toBe(false);
      });

      it('should return false for same length strings differing in middle', () => {
        const expected = 'abcdefghijklmnopqrsXuvwxyz0123456789abcdef';
        const received = 'abcdefghijklmnopqrsYuvwxyz0123456789abcdef';
        const result = validateState(expected, received);
        expect(result).toBe(false);
      });

      it('should handle comparison of generated states correctly', () => {
        const state = generateState();
        expect(validateState(state, state)).toBe(true);
        expect(validateState(state, state + 'x')).toBe(false);
        expect(validateState(state + 'x', state)).toBe(false);
      });
    });

    describe('Different length strings', () => {
      it('should return false when received is longer than expected', () => {
        const expected = 'short';
        const received = 'short-but-longer';
        const result = validateState(expected, received);
        expect(result).toBe(false);
      });

      it('should return false when expected is longer than received', () => {
        const expected = 'longer-expected-state';
        const received = 'short';
        const result = validateState(expected, received);
        expect(result).toBe(false);
      });

      it('should return false when received is prefix of expected', () => {
        const expected = 'test-state-full';
        const received = 'test-state';
        const result = validateState(expected, received);
        expect(result).toBe(false);
      });

      it('should return false when expected is prefix of received', () => {
        const expected = 'test-state';
        const received = 'test-state-full';
        const result = validateState(expected, received);
        expect(result).toBe(false);
      });

      it('should return false for single character difference in length', () => {
        const expected = 'abcdefghijklmnopqrstuvwxyz0123456789abcdef';
        const received = 'abcdefghijklmnopqrstuvwxyz0123456789abcde';
        const result = validateState(expected, received);
        expect(result).toBe(false);
      });
    });

    describe('Case sensitivity', () => {
      it('should return false for same string with different case', () => {
        const expected = 'Test-State-Parameter';
        const received = 'test-state-parameter';
        const result = validateState(expected, received);
        expect(result).toBe(false);
      });

      it('should return false for uppercase vs lowercase', () => {
        const expected = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        const received = 'abcdefghijklmnopqrstuvwxyz';
        const result = validateState(expected, received);
        expect(result).toBe(false);
      });

      it('should return false for mixed case differences', () => {
        const expected = 'AbCdEfGhIjKlMnOpQrStUvWxYz';
        const received = 'aBcDeFgHiJkLmNoPqRsTuVwXyZ';
        const result = validateState(expected, received);
        expect(result).toBe(false);
      });

      it('should return true for identical case', () => {
        const expected = 'MixedCaseState123';
        const received = 'MixedCaseState123';
        const result = validateState(expected, received);
        expect(result).toBe(true);
      });
    });

    describe('Whitespace handling', () => {
      it('should return false when expected has leading whitespace', () => {
        const expected = ' test-state';
        const received = 'test-state';
        const result = validateState(expected, received);
        expect(result).toBe(false);
      });

      it('should return false when received has leading whitespace', () => {
        const expected = 'test-state';
        const received = ' test-state';
        const result = validateState(expected, received);
        expect(result).toBe(false);
      });

      it('should return false when expected has trailing whitespace', () => {
        const expected = 'test-state ';
        const received = 'test-state';
        const result = validateState(expected, received);
        expect(result).toBe(false);
      });

      it('should return false when received has trailing whitespace', () => {
        const expected = 'test-state';
        const received = 'test-state ';
        const result = validateState(expected, received);
        expect(result).toBe(false);
      });

      it('should return false for tab character differences', () => {
        const expected = 'test\tstate';
        const received = 'test state';
        const result = validateState(expected, received);
        expect(result).toBe(false);
      });

      it('should return false for newline character differences', () => {
        const expected = 'test\nstate';
        const received = 'teststate';
        const result = validateState(expected, received);
        expect(result).toBe(false);
      });

      it('should return true when both have identical whitespace', () => {
        const expected = 'test state with spaces';
        const received = 'test state with spaces';
        const result = validateState(expected, received);
        expect(result).toBe(true);
      });

      it('should return false for whitespace-only strings vs empty', () => {
        const expected = '   ';
        const received = '';
        const result = validateState(expected, received);
        expect(result).toBe(false);
      });
    });

    describe('Special characters in state', () => {
      it('should handle hyphen characters correctly', () => {
        const state = 'test-state-with-hyphens';
        expect(validateState(state, state)).toBe(true);
        expect(validateState(state, 'test_state_with_hyphens')).toBe(false);
      });

      it('should handle underscore characters correctly', () => {
        const state = 'test_state_with_underscores';
        expect(validateState(state, state)).toBe(true);
        expect(validateState(state, 'test-state-with-underscores')).toBe(false);
      });

      it('should handle mixed special characters correctly', () => {
        const state = 'test-state_with-mixed_chars';
        expect(validateState(state, state)).toBe(true);
      });

      it('should handle base64url special characters (- and _)', () => {
        const state = 'abc-def_ghi-jkl_mno';
        expect(validateState(state, state)).toBe(true);
        expect(validateState(state, 'abc+def/ghi+jkl/mno')).toBe(false);
      });

      it('should handle numeric characters correctly', () => {
        const state = '0123456789';
        expect(validateState(state, state)).toBe(true);
        expect(validateState(state, '0123456780')).toBe(false);
      });

      it('should handle alphanumeric mix correctly', () => {
        const state = 'abc123XYZ789';
        expect(validateState(state, state)).toBe(true);
      });
    });

    describe('Very long state strings', () => {
      it('should handle very long identical strings', () => {
        const longState = 'a'.repeat(10000);
        const result = validateState(longState, longState);
        expect(result).toBe(true);
      });

      it('should handle very long different strings', () => {
        const expected = 'a'.repeat(10000);
        const received = 'a'.repeat(9999) + 'b';
        const result = validateState(expected, received);
        expect(result).toBe(false);
      });

      it('should handle very long strings with difference at start', () => {
        const expected = 'b' + 'a'.repeat(9999);
        const received = 'a'.repeat(10000);
        const result = validateState(expected, received);
        expect(result).toBe(false);
      });

      it('should handle very long strings with difference in middle', () => {
        const expected = 'a'.repeat(5000) + 'X' + 'a'.repeat(4999);
        const received = 'a'.repeat(5000) + 'Y' + 'a'.repeat(4999);
        const result = validateState(expected, received);
        expect(result).toBe(false);
      });

      it('should handle 1MB strings', () => {
        const megabyteState = 'x'.repeat(1024 * 1024);
        const result = validateState(megabyteState, megabyteState);
        expect(result).toBe(true);
      });

      it('should handle 1MB strings with single character difference', () => {
        const expected = 'x'.repeat(1024 * 1024);
        const received = 'x'.repeat(1024 * 1024 - 1) + 'y';
        const result = validateState(expected, received);
        expect(result).toBe(false);
      });
    });

    describe('Unicode characters', () => {
      /**
       * Note: The validateState function compares byte lengths (not string lengths)
       * before calling timingSafeEqual. This correctly handles Unicode characters
       * with different byte lengths.
       *
       * For OAuth state parameters which should only contain base64url characters
       * (ASCII), Unicode characters indicate potential tampering or encoding issues.
       * The function returns false for any mismatch, never throws.
       */

      it('should return false for ASCII vs Unicode lookalikes with same string length', () => {
        // 'a' (U+0061, 1 byte) vs 'а' (Cyrillic, U+0430, 2 bytes in UTF-8)
        // Both have string length 1, but different byte lengths
        const expected = 'test-state-a';
        const received = 'test-state-\u0430';
        // Different byte length returns false (no throw)
        expect(validateState(expected, received)).toBe(false);
      });

      it('should return false for different Unicode characters with same byte length', () => {
        // Both é (U+00E9) and è (U+00E8) are 2 bytes in UTF-8
        const expected = 'test-\u00e9-state'; // é
        const received = 'test-\u00e8-state'; // è
        const result = validateState(expected, received);
        expect(result).toBe(false);
      });

      it('should return true for identical Unicode strings', () => {
        const state = 'test-\u00e9\u00e8\u00ea-state';
        const result = validateState(state, state);
        expect(result).toBe(true);
      });

      it('should handle emoji characters with identical content', () => {
        const state = 'test-😀-state';
        expect(validateState(state, state)).toBe(true);
      });

      it('should return false for different emojis', () => {
        // 😀 (U+1F600) and 😁 (U+1F601) both are 4 bytes
        const state1 = 'test-😀-state';
        const state2 = 'test-😁-state';
        expect(validateState(state1, state2)).toBe(false);
      });

      it('should handle multi-byte Unicode characters with identical content', () => {
        const state = '日本語テスト';
        expect(validateState(state, state)).toBe(true);
      });

      it('should return false for different multi-byte characters with same byte length', () => {
        // 日 and 本 are both 3 bytes in UTF-8
        const expected = '日';
        const received = '本';
        expect(validateState(expected, received)).toBe(false);
      });

      it('should return false for combining characters vs precomposed (different byte length)', () => {
        // 'é' can be represented as single char (U+00E9) or e + combining acute (U+0065 U+0301)
        const composed = '\u00e9'; // é as single character (2 bytes)
        const decomposed = 'e\u0301'; // e + combining acute accent (3 bytes)
        // Different byte lengths, returns false
        expect(validateState(composed, decomposed)).toBe(false);
      });

      it('should return false for zero-width characters (different byte length)', () => {
        const expected = 'test\u200Bstate'; // zero-width space
        const received = 'teststate';
        const result = validateState(expected, received);
        expect(result).toBe(false);
      });

      it('should handle right-to-left characters with identical content', () => {
        const state = 'test-\u0627\u0644\u0639\u0631\u0628\u064A\u0629-state'; // Arabic
        expect(validateState(state, state)).toBe(true);
      });

      it('should return false for different Arabic characters with same byte length', () => {
        // Arabic characters are typically 2 bytes each in UTF-8
        const expected = 'test-\u0627-state'; // ا (alef)
        const received = 'test-\u0628-state'; // ب (ba)
        expect(validateState(expected, received)).toBe(false);
      });
    });

    describe('Integration with generateState', () => {
      it('should validate generated state against itself', () => {
        const state = generateState();
        expect(validateState(state, state)).toBe(true);
      });

      it('should reject modified generated state', () => {
        const state = generateState();
        const modified = state.slice(0, -1) + (state.slice(-1) === 'a' ? 'b' : 'a');
        expect(validateState(state, modified)).toBe(false);
      });

      it('should reject truncated generated state', () => {
        const state = generateState();
        const truncated = state.slice(0, -1);
        expect(validateState(state, truncated)).toBe(false);
      });

      it('should reject extended generated state', () => {
        const state = generateState();
        const extended = state + 'x';
        expect(validateState(state, extended)).toBe(false);
      });

      it('should reject different generated states', () => {
        const state1 = generateState();
        const state2 = generateState();
        expect(validateState(state1, state2)).toBe(false);
      });
    });
  });

  describe('Constants', () => {
    it('should export correct minimum bytes constant', () => {
      expect(STATE_MIN_BYTES).toBe(32);
    });
  });
});
