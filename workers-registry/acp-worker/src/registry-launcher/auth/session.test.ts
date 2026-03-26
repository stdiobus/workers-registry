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

import { AuthSession, DEFAULT_SESSION_TIMEOUT_MS, SessionManager } from './session.js';
import { generatePKCEPair } from './pkce.js';
import { generateState } from './state.js';

describe('AuthSession', () => {
  // Helper to create a valid session
  const createTestSession = (timeoutMs?: number) => {
    const { verifier, challenge } = generatePKCEPair();
    const state = generateState();
    return new AuthSession('github', verifier, challenge, state, timeoutMs);
  };

  describe('constructor', () => {
    it('should create a session with all required properties', () => {
      const verifier = 'test-verifier-12345678901234567890123456789012345';
      const challenge = 'test-challenge';
      const state = 'test-state';

      const session = new AuthSession('github', verifier, challenge, state);

      expect(session.sessionId).toBeDefined();
      expect(session.sessionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(session.providerId).toBe('github');
      expect(session.codeVerifier).toBe(verifier);
      expect(session.codeChallenge).toBe(challenge);
      expect(session.state).toBe(state);
      expect(session.timeoutMs).toBe(DEFAULT_SESSION_TIMEOUT_MS);
      expect(session.startedAt).toBeLessThanOrEqual(Date.now());
    });

    it('should use default timeout when not specified', () => {
      const session = createTestSession();
      expect(session.timeoutMs).toBe(DEFAULT_SESSION_TIMEOUT_MS);
    });

    it('should use custom timeout when specified', () => {
      const customTimeout = 60000; // 1 minute
      const session = createTestSession(customTimeout);
      expect(session.timeoutMs).toBe(customTimeout);
    });

    it('should generate unique session IDs', () => {
      const session1 = createTestSession();
      const session2 = createTestSession();
      expect(session1.sessionId).not.toBe(session2.sessionId);
    });

    it('should support all valid provider IDs', () => {
      const providers = ['github', 'google', 'cognito', 'azure'] as const;
      const { verifier, challenge } = generatePKCEPair();
      const state = generateState();

      for (const providerId of providers) {
        const session = new AuthSession(providerId, verifier, challenge, state);
        expect(session.providerId).toBe(providerId);
      }
    });
  });

  describe('isExpired', () => {
    it('should return false for a newly created session', () => {
      const session = createTestSession();
      expect(session.isExpired()).toBe(false);
    });

    it('should return true when timeout has elapsed', () => {
      // Create session with very short timeout
      const session = createTestSession(1);

      // Wait for timeout to elapse
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(session.isExpired()).toBe(true);
          resolve();
        }, 10);
      });
    });

    it('should return false when timeout has not elapsed', () => {
      const session = createTestSession(60000); // 1 minute
      expect(session.isExpired()).toBe(false);
    });
  });

  describe('remainingTime', () => {
    it('should return approximately the timeout for a newly created session', () => {
      const timeout = 60000;
      const session = createTestSession(timeout);

      const remaining = session.remainingTime();
      // Allow 100ms tolerance for test execution time
      expect(remaining).toBeGreaterThan(timeout - 100);
      expect(remaining).toBeLessThanOrEqual(timeout);
    });

    it('should return 0 when session has expired', () => {
      const session = createTestSession(1);

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(session.remainingTime()).toBe(0);
          resolve();
        }, 10);
      });
    });

    it('should decrease over time', () => {
      const session = createTestSession(60000);
      const initial = session.remainingTime();

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const later = session.remainingTime();
          expect(later).toBeLessThan(initial);
          resolve();
        }, 50);
      });
    });

    it('should never return negative values', () => {
      const session = createTestSession(1);

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(session.remainingTime()).toBe(0);
          expect(session.remainingTime()).toBeGreaterThanOrEqual(0);
          resolve();
        }, 100);
      });
    });
  });

  describe('validateState', () => {
    it('should return true for matching state', () => {
      const { verifier, challenge } = generatePKCEPair();
      const state = generateState();
      const session = new AuthSession('github', verifier, challenge, state);

      expect(session.validateState(state)).toBe(true);
    });

    it('should return false for non-matching state', () => {
      const session = createTestSession();
      const differentState = generateState();

      expect(session.validateState(differentState)).toBe(false);
    });

    it('should return false for empty state', () => {
      const session = createTestSession();
      expect(session.validateState('')).toBe(false);
    });

    it('should return false for partial state match', () => {
      const { verifier, challenge } = generatePKCEPair();
      const state = 'abcdefghijklmnopqrstuvwxyz123456789012345678';
      const session = new AuthSession('github', verifier, challenge, state);

      // Try with partial state
      expect(session.validateState('abcdefghijklmnopqrstuvwxyz')).toBe(false);
    });

    it('should be case-sensitive', () => {
      const { verifier, challenge } = generatePKCEPair();
      const state = 'AbCdEfGhIjKlMnOpQrStUvWxYz123456789012345678';
      const session = new AuthSession('github', verifier, challenge, state);

      expect(session.validateState(state.toLowerCase())).toBe(false);
      expect(session.validateState(state.toUpperCase())).toBe(false);
      expect(session.validateState(state)).toBe(true);
    });
  });

  describe('DEFAULT_SESSION_TIMEOUT_MS', () => {
    it('should be 5 minutes in milliseconds', () => {
      expect(DEFAULT_SESSION_TIMEOUT_MS).toBe(5 * 60 * 1000);
      expect(DEFAULT_SESSION_TIMEOUT_MS).toBe(300000);
    });
  });
});


describe('createSession', () => {
  // Import createSession dynamically to test it
  let createSession: typeof import('./session.js').createSession;

  beforeAll(async () => {
    const sessionModule = await import('./session.js');
    createSession = sessionModule.createSession;
  });

  it('should create a session with generated PKCE and state parameters', () => {
    const session = createSession('github');

    expect(session.sessionId).toBeDefined();
    expect(session.providerId).toBe('github');
    expect(session.codeVerifier).toBeDefined();
    expect(session.codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(session.codeChallenge).toBeDefined();
    expect(session.state).toBeDefined();
    expect(session.timeoutMs).toBe(DEFAULT_SESSION_TIMEOUT_MS);
  });

  it('should use custom timeout when specified', () => {
    const customTimeout = 120000; // 2 minutes
    const session = createSession('github', customTimeout);

    expect(session.timeoutMs).toBe(customTimeout);
  });

  it('should generate unique sessions', () => {
    const session1 = createSession('github');
    const session2 = createSession('github');

    expect(session1.sessionId).not.toBe(session2.sessionId);
    expect(session1.codeVerifier).not.toBe(session2.codeVerifier);
    expect(session1.state).not.toBe(session2.state);
  });
});


describe('SessionManager', () => {
  let manager: SessionManager;

  beforeEach(() => {
    // Create manager without auto-start cleanup to avoid timer issues in tests
    manager = new SessionManager(1000, false);
  });

  afterEach(() => {
    manager.clear();
  });

  describe('constructor', () => {
    it('should create a manager with default cleanup interval', () => {
      const defaultManager = new SessionManager(undefined, false);
      expect(defaultManager).toBeDefined();
      defaultManager.clear();
    });

    it('should auto-start cleanup when autoStartCleanup is true', () => {
      const autoManager = new SessionManager(1000, true);
      expect(autoManager.isCleanupRunning()).toBe(true);
      autoManager.clear();
    });

    it('should not auto-start cleanup when autoStartCleanup is false', () => {
      expect(manager.isCleanupRunning()).toBe(false);
    });
  });

  describe('create', () => {
    it('should create and register a new session', () => {
      const session = manager.create('github');

      expect(session).toBeDefined();
      expect(session.providerId).toBe('github');
      expect(session.sessionId).toBeDefined();
      expect(manager.size()).toBe(1);
    });

    it('should create session with custom timeout', () => {
      const customTimeout = 120000;
      const session = manager.create('github', customTimeout);

      expect(session.timeoutMs).toBe(customTimeout);
    });

    it('should create multiple unique sessions', () => {
      const session1 = manager.create('github');
      const session2 = manager.create('github');
      const session3 = manager.create('github');

      expect(manager.size()).toBe(3);
      expect(session1.sessionId).not.toBe(session2.sessionId);
      expect(session1.sessionId).not.toBe(session3.sessionId);
      expect(session2.sessionId).not.toBe(session3.sessionId);
    });
  });

  describe('get', () => {
    it('should return session by session ID', () => {
      const created = manager.create('github');
      const retrieved = manager.get(created.sessionId);

      expect(retrieved).toBe(created);
    });

    it('should return undefined for non-existent session ID', () => {
      const retrieved = manager.get('non-existent-id');
      expect(retrieved).toBeUndefined();
    });

    it('should return undefined and remove expired session', async () => {
      const session = manager.create('github', 1); // 1ms timeout

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 10));

      const retrieved = manager.get(session.sessionId);
      expect(retrieved).toBeUndefined();
      expect(manager.size()).toBe(0);
    });
  });

  describe('getByState', () => {
    it('should return session by state parameter', () => {
      const created = manager.create('github');
      const retrieved = manager.getByState(created.state);

      expect(retrieved).toBe(created);
    });

    it('should return undefined for non-existent state', () => {
      const retrieved = manager.getByState('non-existent-state');
      expect(retrieved).toBeUndefined();
    });

    it('should return undefined and remove expired session', async () => {
      const session = manager.create('github', 1); // 1ms timeout
      const state = session.state;

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 10));

      const retrieved = manager.getByState(state);
      expect(retrieved).toBeUndefined();
      expect(manager.size()).toBe(0);
    });
  });

  describe('remove', () => {
    it('should remove session by session ID', () => {
      const session = manager.create('github');
      const removed = manager.remove(session.sessionId);

      expect(removed).toBe(true);
      expect(manager.size()).toBe(0);
      expect(manager.get(session.sessionId)).toBeUndefined();
    });

    it('should return false for non-existent session', () => {
      const removed = manager.remove('non-existent-id');
      expect(removed).toBe(false);
    });

    it('should also remove state mapping', () => {
      const session = manager.create('github');
      manager.remove(session.sessionId);

      expect(manager.getByState(session.state)).toBeUndefined();
    });
  });

  describe('removeByState', () => {
    it('should remove session by state parameter', () => {
      const session = manager.create('github');
      const removed = manager.removeByState(session.state);

      expect(removed).toBe(true);
      expect(manager.size()).toBe(0);
    });

    it('should return false for non-existent state', () => {
      const removed = manager.removeByState('non-existent-state');
      expect(removed).toBe(false);
    });
  });

  describe('list', () => {
    it('should return all active sessions', () => {
      manager.create('github');
      manager.create('github');
      manager.create('google');

      const sessions = manager.list();
      expect(sessions.length).toBe(3);
    });

    it('should return empty array when no sessions', () => {
      const sessions = manager.list();
      expect(sessions).toEqual([]);
    });

    it('should filter out and remove expired sessions', async () => {
      manager.create('github', 1); // Will expire
      manager.create('github', 60000); // Won't expire

      // Wait for first session to expire
      await new Promise((resolve) => setTimeout(resolve, 10));

      const sessions = manager.list();
      expect(sessions.length).toBe(1);
      expect(sessions[0].providerId).toBe('github');
      expect(manager.size()).toBe(1);
    });
  });

  describe('size', () => {
    it('should return 0 for empty manager', () => {
      expect(manager.size()).toBe(0);
    });

    it('should return correct count', () => {
      manager.create('github');
      manager.create('github');
      expect(manager.size()).toBe(2);
    });
  });

  describe('has', () => {
    it('should return true for existing session', () => {
      const session = manager.create('github');
      expect(manager.has(session.sessionId)).toBe(true);
    });

    it('should return false for non-existent session', () => {
      expect(manager.has('non-existent-id')).toBe(false);
    });

    it('should return false for expired session', async () => {
      const session = manager.create('github', 1);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(manager.has(session.sessionId)).toBe(false);
    });
  });

  describe('hasByState', () => {
    it('should return true for existing state', () => {
      const session = manager.create('github');
      expect(manager.hasByState(session.state)).toBe(true);
    });

    it('should return false for non-existent state', () => {
      expect(manager.hasByState('non-existent-state')).toBe(false);
    });
  });

  describe('cleanup', () => {
    it('should remove expired sessions', async () => {
      manager.create('github', 1); // Will expire
      manager.create('github', 1); // Will expire
      manager.create('google', 60000); // Won't expire

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 10));

      const removed = manager.cleanup();
      expect(removed).toBe(2);
      expect(manager.size()).toBe(1);
    });

    it('should return 0 when no expired sessions', () => {
      manager.create('github', 60000);
      manager.create('github', 60000);

      const removed = manager.cleanup();
      expect(removed).toBe(0);
      expect(manager.size()).toBe(2);
    });

    it('should return 0 when no sessions', () => {
      const removed = manager.cleanup();
      expect(removed).toBe(0);
    });
  });

  describe('startCleanup / stopCleanup', () => {
    it('should start cleanup timer', () => {
      expect(manager.isCleanupRunning()).toBe(false);
      manager.startCleanup();
      expect(manager.isCleanupRunning()).toBe(true);
    });

    it('should stop cleanup timer', () => {
      manager.startCleanup();
      expect(manager.isCleanupRunning()).toBe(true);
      manager.stopCleanup();
      expect(manager.isCleanupRunning()).toBe(false);
    });

    it('should not start multiple timers', () => {
      manager.startCleanup();
      manager.startCleanup();
      expect(manager.isCleanupRunning()).toBe(true);
      manager.stopCleanup();
      expect(manager.isCleanupRunning()).toBe(false);
    });

    it('should handle stop when not running', () => {
      expect(manager.isCleanupRunning()).toBe(false);
      manager.stopCleanup();
      expect(manager.isCleanupRunning()).toBe(false);
    });
  });

  describe('clear', () => {
    it('should remove all sessions', () => {
      manager.create('github');
      manager.create('github');
      manager.create('google');

      manager.clear();

      expect(manager.size()).toBe(0);
      expect(manager.list()).toEqual([]);
    });

    it('should stop cleanup timer', () => {
      manager.startCleanup();
      manager.clear();
      expect(manager.isCleanupRunning()).toBe(false);
    });
  });

  describe('automatic cleanup', () => {
    it('should automatically clean up expired sessions', async () => {
      // Create manager with very short cleanup interval
      const autoManager = new SessionManager(50, true);

      autoManager.create('github', 1); // Will expire immediately
      autoManager.create('github', 60000); // Won't expire

      // Wait for cleanup to run
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(autoManager.size()).toBe(1);
      autoManager.clear();
    });
  });

  describe('DEFAULT_CLEANUP_INTERVAL_MS', () => {
    it('should be 1 minute in milliseconds', () => {
      expect(SessionManager.DEFAULT_CLEANUP_INTERVAL_MS).toBe(60 * 1000);
      expect(SessionManager.DEFAULT_CLEANUP_INTERVAL_MS).toBe(60000);
    });
  });
});
