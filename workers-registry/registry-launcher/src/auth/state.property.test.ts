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
 * Property-based tests for State parameter module.
 *
 * Feature: oauth-authentication
 * Properties 5-7: State Parameter Generation and Validation
 *
 * @module state.property.test
 */

import * as fc from 'fast-check';
import { generateState, validateState, STATE_MIN_BYTES } from './state';

/**
 * Base64url encoding regex (no padding).
 * Characters: A-Z, a-z, 0-9, hyphen (-), underscore (_)
 */
const BASE64URL_NO_PADDING_REGEX = /^[A-Za-z0-9\-_]+$/;

describe('State Parameter Property Tests', () => {
  /**
   * Feature: oauth-authentication, Property 5: State Parameter Minimum Entropy
   *
   * *For any* generated state parameter, when decoded from base64url, the resulting
   * bytes SHALL be at least 32 bytes in length.
   *
   * **Validates: Requirements 2.1**
   */
  describe('Property 5: State Parameter Minimum Entropy', () => {
    test('generated state decodes to at least 32 bytes', () => {
      fc.assert(
        fc.property(
          fc.constant(undefined), // No parameters needed
          () => {
            const state = generateState();

            // Decode from base64url to get the raw bytes
            // First, convert base64url to standard base64
            const base64 = state
              .replace(/-/g, '+')
              .replace(/_/g, '/');

            // Add padding if needed
            const paddedBase64 = base64 + '='.repeat((4 - (base64.length % 4)) % 4);

            // Decode to buffer
            const decodedBytes = Buffer.from(paddedBase64, 'base64');

            // Verify at least 32 bytes (256 bits of entropy)
            expect(decodedBytes.length).toBeGreaterThanOrEqual(STATE_MIN_BYTES);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('STATE_MIN_BYTES constant is at least 32', () => {
      fc.assert(
        fc.property(
          fc.constant(undefined),
          () => {
            // Verify the constant meets the minimum requirement
            expect(STATE_MIN_BYTES).toBeGreaterThanOrEqual(32);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('generated state is valid base64url without padding', () => {
      fc.assert(
        fc.property(
          fc.constant(undefined),
          () => {
            const state = generateState();

            // Verify base64url encoding without padding
            expect(state).toMatch(BASE64URL_NO_PADDING_REGEX);

            // Verify no padding characters
            expect(state).not.toContain('=');

            // Verify no standard base64 characters that differ from base64url
            expect(state).not.toContain('+');
            expect(state).not.toContain('/');
          }
        ),
        { numRuns: 100 }
      );
    });

    test('generated state has expected minimum length for 32 bytes base64url', () => {
      fc.assert(
        fc.property(
          fc.constant(undefined),
          () => {
            const state = generateState();

            // 32 bytes = 256 bits
            // Base64 encoding: ceil(32 * 4 / 3) = 43 characters (with padding)
            // Without padding: 43 characters
            // Minimum expected length for 32 bytes
            expect(state.length).toBeGreaterThanOrEqual(43);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Feature: oauth-authentication, Property 6: State Parameter Validation
   *
   * *For any* auth session with a generated state parameter, validating with the exact
   * same state SHALL return true, and validating with any different state (including
   * empty/missing) SHALL return false.
   *
   * **Validates: Requirements 2.2, 2.3**
   */
  describe('Property 6: State Parameter Validation', () => {
    test('validating state with exact same value returns true', () => {
      fc.assert(
        fc.property(
          fc.constant(undefined),
          () => {
            const state = generateState();

            // Validating with the exact same state should return true
            expect(validateState(state, state)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('validating state with different value returns false', () => {
      fc.assert(
        fc.property(
          fc.constant(undefined),
          () => {
            const state1 = generateState();
            const state2 = generateState();

            // Two different generated states should not match
            // (extremely unlikely to be equal due to cryptographic randomness)
            if (state1 !== state2) {
              expect(validateState(state1, state2)).toBe(false);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    test('validating state with empty string returns false', () => {
      fc.assert(
        fc.property(
          fc.constant(undefined),
          () => {
            const state = generateState();

            // Empty received state should return false
            expect(validateState(state, '')).toBe(false);

            // Empty expected state should return false
            expect(validateState('', state)).toBe(false);

            // Both empty should return false
            expect(validateState('', '')).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('validating state with null/undefined returns false', () => {
      fc.assert(
        fc.property(
          fc.constant(undefined),
          () => {
            const state = generateState();

            // Null received state should return false
            expect(validateState(state, null)).toBe(false);

            // Undefined received state should return false
            expect(validateState(state, undefined)).toBe(false);

            // Null expected state should return false
            expect(validateState(null, state)).toBe(false);

            // Undefined expected state should return false
            expect(validateState(undefined, state)).toBe(false);

            // Both null should return false
            expect(validateState(null, null)).toBe(false);

            // Both undefined should return false
            expect(validateState(undefined, undefined)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('validating state with arbitrary different strings returns false', () => {
      fc.assert(
        fc.property(
          // Generate arbitrary strings that could be attempted as state values
          fc.string({ minLength: 1, maxLength: 100 }),
          (arbitraryString) => {
            const state = generateState();

            // Skip if the arbitrary string happens to match (extremely unlikely)
            if (arbitraryString === state) {
              return;
            }

            // Any different string should return false
            expect(validateState(state, arbitraryString)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('validating state with modified state returns false', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 100 }), // Position to modify
          fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'.split('')),
          (position, newChar) => {
            const state = generateState();
            const modPosition = position % state.length;

            // Only test if the character at position is different
            if (state[modPosition] === newChar) {
              return;
            }

            // Create a modified state by changing one character
            const modifiedState =
              state.substring(0, modPosition) +
              newChar +
              state.substring(modPosition + 1);

            // Modified state should not validate
            expect(validateState(state, modifiedState)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Feature: oauth-authentication, Property 7: State Parameter Uniqueness
   *
   * *For any* set of N generated state parameters (where N > 1), all N parameters
   * SHALL be unique (no collisions).
   *
   * **Validates: Requirements 2.4**
   */
  describe('Property 7: State Parameter Uniqueness', () => {
    test('multiple generated states are all unique', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 2, max: 50 }), // Number of states to generate
          (n) => {
            const states: string[] = [];

            // Generate N state parameters
            for (let i = 0; i < n; i++) {
              states.push(generateState());
            }

            // Create a Set to check for uniqueness
            const uniqueStates = new Set(states);

            // All states should be unique (Set size equals array length)
            expect(uniqueStates.size).toBe(states.length);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('consecutive state generations produce unique values', () => {
      fc.assert(
        fc.property(
          fc.constant(undefined),
          () => {
            // Generate states in quick succession
            const state1 = generateState();
            const state2 = generateState();
            const state3 = generateState();
            const state4 = generateState();
            const state5 = generateState();

            const states = [state1, state2, state3, state4, state5];
            const uniqueStates = new Set(states);

            // All should be unique
            expect(uniqueStates.size).toBe(5);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('large batch of generated states has no collisions', () => {
      fc.assert(
        fc.property(
          fc.constant(undefined),
          () => {
            const batchSize = 100;
            const states: string[] = [];

            // Generate a large batch of states
            for (let i = 0; i < batchSize; i++) {
              states.push(generateState());
            }

            // Check for uniqueness
            const uniqueStates = new Set(states);

            // All states should be unique
            expect(uniqueStates.size).toBe(batchSize);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('states generated in different test runs are unique', () => {
      // Store states across multiple property runs
      const allStates = new Set<string>();

      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 10 }),
          (count) => {
            for (let i = 0; i < count; i++) {
              const state = generateState();

              // Each state should not have been seen before
              expect(allStates.has(state)).toBe(false);

              allStates.add(state);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
