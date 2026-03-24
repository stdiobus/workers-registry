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
 * Property-based tests for Auth Session module.
 *
 * Feature: oauth-authentication
 * Properties 10, 28: Auth Session Timeout Behavior and Time Tracking
 *
 * @module session.property.test
 */

import * as fc from 'fast-check';
import {
  createSession,
  SessionManager,
  DEFAULT_SESSION_TIMEOUT_MS,
} from './session';
import { VALID_PROVIDER_IDS } from './types';

/**
 * Arbitrary generator for valid provider IDs.
 */
const providerIdArb = fc.constantFrom(...VALID_PROVIDER_IDS);

/**
 * Arbitrary generator for valid timeout values in milliseconds.
 * Range: 100ms to 10 minutes (reasonable for testing)
 */
const timeoutMsArb = fc.integer({ min: 100, max: 10 * 60 * 1000 });

describe('Auth Session Property Tests', () => {
  /**
   * Feature: oauth-authentication, Property 10: Auth Session Timeout Behavior
   *
   * *For any* auth session with a configured timeout, after the timeout period elapses,
   * the session SHALL report as expired, the callback server SHALL be terminated,
   * and a timeout error SHALL be returned.
   *
   * **Validates: Requirements 3.5, 12.2, 12.3**
   */
  describe('Property 10: Auth Session Timeout Behavior', () => {
    test('session reports as expired after timeout period elapses', async () => {
      // Use very small timeouts (5-15ms) for fast async tests
      const verySmallTimeoutArb = fc.integer({ min: 5, max: 15 });

      await fc.assert(
        fc.asyncProperty(
          providerIdArb,
          verySmallTimeoutArb,
          async (providerId, timeoutMs) => {
            const session = createSession(providerId, timeoutMs);

            // Session should not be expired immediately
            expect(session.isExpired()).toBe(false);

            // Wait for timeout to elapse (add small buffer for timing)
            await new Promise(resolve => setTimeout(resolve, timeoutMs + 10));

            // Session should now report as expired
            expect(session.isExpired()).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    }, 30000);

    test('session remainingTime returns 0 after timeout', async () => {
      const verySmallTimeoutArb = fc.integer({ min: 5, max: 15 });

      await fc.assert(
        fc.asyncProperty(
          providerIdArb,
          verySmallTimeoutArb,
          async (providerId, timeoutMs) => {
            const session = createSession(providerId, timeoutMs);

            // Wait for timeout to elapse
            await new Promise(resolve => setTimeout(resolve, timeoutMs + 10));

            // Remaining time should be 0 (not negative)
            expect(session.remainingTime()).toBe(0);
          }
        ),
        { numRuns: 100 }
      );
    }, 30000);

    test('SessionManager removes expired sessions on cleanup', async () => {
      const verySmallTimeoutArb = fc.integer({ min: 5, max: 15 });

      await fc.assert(
        fc.asyncProperty(
          providerIdArb,
          verySmallTimeoutArb,
          async (providerId, timeoutMs) => {
            // Create manager without auto-cleanup to control timing
            const manager = new SessionManager(60000, false);

            try {
              // Create a session with short timeout
              const session = manager.create(providerId, timeoutMs);
              const sessionId = session.sessionId;

              // Session should exist initially
              expect(manager.has(sessionId)).toBe(true);

              // Wait for timeout to elapse
              await new Promise(resolve => setTimeout(resolve, timeoutMs + 10));

              // Cleanup should remove expired sessions
              const removedCount = manager.cleanup();
              expect(removedCount).toBeGreaterThanOrEqual(1);

              // Session should no longer exist
              expect(manager.has(sessionId)).toBe(false);
            } finally {
              manager.clear();
            }
          }
        ),
        { numRuns: 100 }
      );
    }, 30000);

    test('SessionManager.get returns undefined for expired sessions', async () => {
      const verySmallTimeoutArb = fc.integer({ min: 5, max: 15 });

      await fc.assert(
        fc.asyncProperty(
          providerIdArb,
          verySmallTimeoutArb,
          async (providerId, timeoutMs) => {
            const manager = new SessionManager(60000, false);

            try {
              const session = manager.create(providerId, timeoutMs);
              const sessionId = session.sessionId;

              // Session should be retrievable initially
              expect(manager.get(sessionId)).toBeDefined();

              // Wait for timeout to elapse
              await new Promise(resolve => setTimeout(resolve, timeoutMs + 10));

              // get() should return undefined for expired session
              expect(manager.get(sessionId)).toBeUndefined();
            } finally {
              manager.clear();
            }
          }
        ),
        { numRuns: 100 }
      );
    }, 30000);

    test('SessionManager.getByState returns undefined for expired sessions', async () => {
      const verySmallTimeoutArb = fc.integer({ min: 5, max: 15 });

      await fc.assert(
        fc.asyncProperty(
          providerIdArb,
          verySmallTimeoutArb,
          async (providerId, timeoutMs) => {
            const manager = new SessionManager(60000, false);

            try {
              const session = manager.create(providerId, timeoutMs);
              const state = session.state;

              // Session should be retrievable by state initially
              expect(manager.getByState(state)).toBeDefined();

              // Wait for timeout to elapse
              await new Promise(resolve => setTimeout(resolve, timeoutMs + 10));

              // getByState() should return undefined for expired session
              expect(manager.getByState(state)).toBeUndefined();
            } finally {
              manager.clear();
            }
          }
        ),
        { numRuns: 100 }
      );
    }, 30000);

    test('expired sessions are excluded from list()', async () => {
      const verySmallTimeoutArb = fc.integer({ min: 5, max: 15 });

      await fc.assert(
        fc.asyncProperty(
          providerIdArb,
          verySmallTimeoutArb,
          async (providerId, timeoutMs) => {
            const manager = new SessionManager(60000, false);

            try {
              // Create a session with short timeout
              const session = manager.create(providerId, timeoutMs);
              const sessionId = session.sessionId;

              // Session should be in list initially
              const initialList = manager.list();
              expect(initialList.some(s => s.sessionId === sessionId)).toBe(true);

              // Wait for timeout to elapse
              await new Promise(resolve => setTimeout(resolve, timeoutMs + 10));

              // Expired session should not be in list
              const afterList = manager.list();
              expect(afterList.some(s => s.sessionId === sessionId)).toBe(false);
            } finally {
              manager.clear();
            }
          }
        ),
        { numRuns: 100 }
      );
    }, 30000);

    test('session with zero timeout is immediately expired', () => {
      fc.assert(
        fc.property(
          providerIdArb,
          (providerId) => {
            // Create session with 0 timeout
            const session = createSession(providerId, 0);

            // Should be expired immediately
            expect(session.isExpired()).toBe(true);
            expect(session.remainingTime()).toBe(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('session with negative timeout is immediately expired', () => {
      fc.assert(
        fc.property(
          providerIdArb,
          fc.integer({ min: -1000, max: -1 }),
          (providerId, negativeTimeout) => {
            // Create session with negative timeout
            const session = createSession(providerId, negativeTimeout);

            // Should be expired immediately
            expect(session.isExpired()).toBe(true);
            expect(session.remainingTime()).toBe(0);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Feature: oauth-authentication, Property 28: Session Time Tracking
   *
   * *For any* auth session, the remaining time SHALL decrease monotonically and
   * SHALL equal (timeout - elapsed time since start).
   *
   * **Validates: Requirements 12.1, 12.4**
   */
  describe('Property 28: Session Time Tracking', () => {
    test('remaining time equals (timeout - elapsed time)', () => {
      fc.assert(
        fc.property(
          providerIdArb,
          timeoutMsArb,
          (providerId, timeoutMs) => {
            const beforeCreate = Date.now();
            const session = createSession(providerId, timeoutMs);
            const afterCreate = Date.now();

            // Get remaining time
            const remaining = session.remainingTime();

            // Calculate expected remaining time
            // Account for timing variance between beforeCreate and afterCreate
            const minElapsed = 0;
            const maxElapsed = afterCreate - beforeCreate + 1; // +1 for rounding

            const maxExpectedRemaining = timeoutMs - minElapsed;
            const minExpectedRemaining = Math.max(0, timeoutMs - maxElapsed);

            // Remaining time should be within expected bounds
            expect(remaining).toBeLessThanOrEqual(maxExpectedRemaining);
            expect(remaining).toBeGreaterThanOrEqual(minExpectedRemaining);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('remaining time decreases monotonically over time', async () => {
      // Use small timeouts and few samples for faster tests
      const smallTimeoutArb = fc.integer({ min: 50, max: 100 });
      const sampleCountArb = fc.integer({ min: 3, max: 5 });

      await fc.assert(
        fc.asyncProperty(
          providerIdArb,
          smallTimeoutArb,
          sampleCountArb,
          async (providerId, timeoutMs, sampleCount) => {
            const session = createSession(providerId, timeoutMs);
            const samples: number[] = [];

            // Collect remaining time samples
            for (let i = 0; i < sampleCount; i++) {
              samples.push(session.remainingTime());
              await new Promise(resolve => setTimeout(resolve, 5));
            }

            // Verify monotonic decrease (each sample <= previous)
            for (let i = 1; i < samples.length; i++) {
              expect(samples[i]).toBeLessThanOrEqual(samples[i - 1]);
            }
          }
        ),
        { numRuns: 100 }
      );
    }, 30000);

    test('remaining time never goes negative', async () => {
      const verySmallTimeoutArb = fc.integer({ min: 5, max: 15 });

      await fc.assert(
        fc.asyncProperty(
          providerIdArb,
          verySmallTimeoutArb,
          async (providerId, timeoutMs) => {
            const session = createSession(providerId, timeoutMs);

            // Check immediately
            expect(session.remainingTime()).toBeGreaterThanOrEqual(0);

            // Wait for timeout to elapse
            await new Promise(resolve => setTimeout(resolve, timeoutMs + 20));

            // Should still be >= 0, not negative
            expect(session.remainingTime()).toBeGreaterThanOrEqual(0);
            expect(session.remainingTime()).toBe(0);
          }
        ),
        { numRuns: 100 }
      );
    }, 30000);

    test('initial remaining time equals configured timeout', () => {
      fc.assert(
        fc.property(
          providerIdArb,
          timeoutMsArb,
          (providerId, timeoutMs) => {
            const beforeCreate = Date.now();
            const session = createSession(providerId, timeoutMs);
            const afterCreate = Date.now();

            const remaining = session.remainingTime();

            // Account for time elapsed during session creation
            const maxElapsed = afterCreate - beforeCreate;

            // Initial remaining should be close to timeout (within creation time)
            expect(remaining).toBeLessThanOrEqual(timeoutMs);
            expect(remaining).toBeGreaterThanOrEqual(timeoutMs - maxElapsed - 1);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('session tracks startedAt timestamp correctly', () => {
      fc.assert(
        fc.property(
          providerIdArb,
          timeoutMsArb,
          (providerId, timeoutMs) => {
            const beforeCreate = Date.now();
            const session = createSession(providerId, timeoutMs);
            const afterCreate = Date.now();

            // startedAt should be between before and after creation
            expect(session.startedAt).toBeGreaterThanOrEqual(beforeCreate);
            expect(session.startedAt).toBeLessThanOrEqual(afterCreate);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('session stores configured timeout correctly', () => {
      fc.assert(
        fc.property(
          providerIdArb,
          timeoutMsArb,
          (providerId, timeoutMs) => {
            const session = createSession(providerId, timeoutMs);

            // timeoutMs should match configured value
            expect(session.timeoutMs).toBe(timeoutMs);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('isExpired is consistent with remainingTime', () => {
      fc.assert(
        fc.property(
          providerIdArb,
          timeoutMsArb,
          (providerId, timeoutMs) => {
            const session = createSession(providerId, timeoutMs);

            // isExpired should be true iff remainingTime is 0
            const remaining = session.remainingTime();
            const expired = session.isExpired();

            if (remaining > 0) {
              expect(expired).toBe(false);
            } else {
              expect(expired).toBe(true);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    test('default timeout is used when not specified', () => {
      fc.assert(
        fc.property(
          providerIdArb,
          (providerId) => {
            const session = createSession(providerId);

            // Should use DEFAULT_SESSION_TIMEOUT_MS
            expect(session.timeoutMs).toBe(DEFAULT_SESSION_TIMEOUT_MS);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('remaining time calculation is consistent across multiple calls', () => {
      fc.assert(
        fc.property(
          providerIdArb,
          timeoutMsArb,
          (providerId, timeoutMs) => {
            const session = createSession(providerId, timeoutMs);

            // Multiple calls in quick succession should return similar values
            const remaining1 = session.remainingTime();
            const remaining2 = session.remainingTime();
            const remaining3 = session.remainingTime();

            // Values should be monotonically decreasing or equal
            expect(remaining2).toBeLessThanOrEqual(remaining1);
            expect(remaining3).toBeLessThanOrEqual(remaining2);

            // Difference should be minimal (within a few ms)
            expect(remaining1 - remaining3).toBeLessThan(10);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('remaining time formula: timeout - (now - startedAt)', () => {
      fc.assert(
        fc.property(
          providerIdArb,
          timeoutMsArb,
          (providerId, timeoutMs) => {
            const session = createSession(providerId, timeoutMs);

            // Get current time and remaining time
            const now = Date.now();
            const remaining = session.remainingTime();

            // Calculate expected remaining using the formula
            const elapsed = now - session.startedAt;
            const expectedRemaining = Math.max(0, timeoutMs - elapsed);

            // Allow for small timing variance (1ms)
            expect(Math.abs(remaining - expectedRemaining)).toBeLessThanOrEqual(1);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
