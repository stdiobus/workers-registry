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
 * Auth session management for OAuth 2.1 authorization flows.
 *
 * Tracks in-progress OAuth authorization sessions including PKCE parameters,
 * state for CSRF protection, and timeout handling.
 *
 * @module session
 */

import { randomUUID } from 'crypto';
import type { AuthProviderId } from './types.js';
import { validateState, generateState } from './state.js';
import { generatePKCEPair } from './pkce.js';

/**
 * Represents an in-progress OAuth authorization flow.
 */
export interface IAuthSession {
  /** Unique session identifier */
  readonly sessionId: string;

  /** Provider being authenticated */
  readonly providerId: AuthProviderId;

  /** PKCE code verifier (kept secret) */
  readonly codeVerifier: string;

  /** PKCE code challenge (sent to provider) */
  readonly codeChallenge: string;

  /** State parameter for CSRF protection */
  readonly state: string;

  /** Session start timestamp */
  readonly startedAt: number;

  /** Session timeout in milliseconds */
  readonly timeoutMs: number;

  /** Check if session has expired */
  isExpired(): boolean;

  /** Get remaining time in milliseconds */
  remainingTime(): number;

  /** Validate returned state parameter */
  validateState(returnedState: string): boolean;
}

/**
 * Default session timeout in milliseconds (5 minutes).
 */
export const DEFAULT_SESSION_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Maximum allowed session timeout in milliseconds (1 hour).
 */
export const MAX_SESSION_TIMEOUT_MS = 60 * 60 * 1000;

/**
 * Validate and normalize a timeout value.
 *
 * Ensures the timeout is a finite positive number within allowed bounds.
 * Returns the default timeout for invalid values (NaN, Infinity, negative, zero).
 *
 * @param timeoutMs - The timeout value to validate
 * @returns A valid timeout value within bounds
 */
export function validateTimeout(timeoutMs: number): number {
  // Check for NaN, Infinity, or non-finite values
  if (!Number.isFinite(timeoutMs)) {
    return DEFAULT_SESSION_TIMEOUT_MS;
  }

  // Check for non-positive values
  if (timeoutMs <= 0) {
    return DEFAULT_SESSION_TIMEOUT_MS;
  }

  // Clamp to maximum allowed
  if (timeoutMs > MAX_SESSION_TIMEOUT_MS) {
    return MAX_SESSION_TIMEOUT_MS;
  }

  // Round to integer (floor to avoid extending timeout)
  return Math.floor(timeoutMs);
}

/**
 * Represents an in-progress OAuth authorization flow.
 *
 * Implements the IAuthSession interface from the design document.
 * Tracks all PKCE and state parameters needed for a secure OAuth 2.1 flow.
 */
export class AuthSession implements IAuthSession {
  /** Unique session identifier */
  readonly sessionId: string;

  /** Provider being authenticated */
  readonly providerId: AuthProviderId;

  /** PKCE code verifier (kept secret) */
  readonly codeVerifier: string;

  /** PKCE code challenge (sent to provider) */
  readonly codeChallenge: string;

  /** State parameter for CSRF protection */
  readonly state: string;

  /** Session start timestamp (Unix milliseconds) */
  readonly startedAt: number;

  /** Session timeout in milliseconds */
  readonly timeoutMs: number;

  /**
   * Create a new auth session.
   *
   * @param providerId - The OAuth provider being authenticated
   * @param codeVerifier - PKCE code verifier (kept secret)
   * @param codeChallenge - PKCE code challenge (sent to provider)
   * @param state - State parameter for CSRF protection
   * @param timeoutMs - Session timeout in milliseconds (default: 5 minutes)
   */
  constructor(
    providerId: AuthProviderId,
    codeVerifier: string,
    codeChallenge: string,
    state: string,
    timeoutMs: number = DEFAULT_SESSION_TIMEOUT_MS,
  ) {
    this.sessionId = randomUUID();
    this.providerId = providerId;
    this.codeVerifier = codeVerifier;
    this.codeChallenge = codeChallenge;
    this.state = state;
    this.startedAt = Date.now();
    this.timeoutMs = validateTimeout(timeoutMs);
  }

  /**
   * Check if the session has expired.
   *
   * A session is expired if the current time exceeds startedAt + timeoutMs.
   *
   * @returns True if the session has expired, false otherwise
   */
  isExpired(): boolean {
    return this.remainingTime() <= 0;
  }

  /**
   * Get the remaining time until session expiration.
   *
   * Returns the number of milliseconds until the session expires.
   * Returns 0 if the session has already expired.
   *
   * @returns Remaining time in milliseconds (0 if expired)
   */
  remainingTime(): number {
    const elapsed = Date.now() - this.startedAt;
    const remaining = this.timeoutMs - elapsed;
    return Math.max(0, remaining);
  }

  /**
   * Validate a returned state parameter against this session's state.
   *
   * Uses constant-time comparison via the validateState function
   * to prevent timing attacks.
   *
   * @param returnedState - The state parameter from the OAuth callback
   * @returns True if the state matches, false otherwise
   */
  validateState(returnedState: string): boolean {
    return validateState(this.state, returnedState);
  }
}

/**
 * Factory function to create a new auth session.
 *
 * Generates PKCE parameters and state, then creates a new AuthSession.
 * This is a convenience function that handles all the cryptographic
 * parameter generation.
 *
 * @param providerId - The OAuth provider to authenticate with
 * @param timeoutMs - Session timeout in milliseconds (default: 5 minutes)
 * @returns A new AuthSession with generated PKCE and state parameters
 */
export function createSession(
  providerId: AuthProviderId,
  timeoutMs: number = DEFAULT_SESSION_TIMEOUT_MS,
): AuthSession {
  const { verifier, challenge } = generatePKCEPair();
  const state = generateState();

  return new AuthSession(providerId, verifier, challenge, state, validateTimeout(timeoutMs));
}

/**
 * Session manager for tracking and cleaning up OAuth authorization sessions.
 *
 * Provides centralized management of active auth sessions including:
 * - Session storage and retrieval by session ID or state parameter
 * - Automatic cleanup of expired sessions
 * - Session lifecycle management (create, get, remove, list)
 *
 * The manager uses a configurable cleanup interval to periodically remove
 * expired sessions, preventing memory leaks in long-running processes.
 */
export class SessionManager {
  /** Map of session ID to AuthSession */
  private readonly sessions: Map<string, AuthSession> = new Map();

  /** Map of state parameter to session ID for quick lookup */
  private readonly stateToSessionId: Map<string, string> = new Map();

  /** Cleanup interval timer reference */
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  /** Default cleanup interval in milliseconds (1 minute) */
  static readonly DEFAULT_CLEANUP_INTERVAL_MS = 60 * 1000;

  /**
   * Create a new SessionManager.
   *
   * @param cleanupIntervalMs - Interval for automatic cleanup (default: 1 minute)
   * @param autoStartCleanup - Whether to start automatic cleanup immediately (default: true)
   */
  constructor(
    private readonly cleanupIntervalMs: number = SessionManager.DEFAULT_CLEANUP_INTERVAL_MS,
    autoStartCleanup: boolean = true,
  ) {
    // Validate cleanup interval - use default for invalid values
    if (!Number.isFinite(this.cleanupIntervalMs) || this.cleanupIntervalMs <= 0) {
      // TypeScript doesn't allow reassigning readonly in constructor after initial assignment,
      // so we use Object.defineProperty to override
      Object.defineProperty(this, 'cleanupIntervalMs', {
        value: SessionManager.DEFAULT_CLEANUP_INTERVAL_MS,
        writable: false,
      });
    }

    if (autoStartCleanup) {
      this.startCleanup();
    }
  }

  /**
   * Create and register a new auth session.
   *
   * Generates PKCE parameters and state, creates a new AuthSession,
   * and registers it with the manager for tracking.
   *
   * @param providerId - The OAuth provider to authenticate with
   * @param timeoutMs - Session timeout in milliseconds (default: 5 minutes)
   * @returns The newly created and registered AuthSession
   */
  create(
    providerId: AuthProviderId,
    timeoutMs: number = DEFAULT_SESSION_TIMEOUT_MS,
  ): AuthSession {
    const session = createSession(providerId, validateTimeout(timeoutMs));
    this.sessions.set(session.sessionId, session);
    this.stateToSessionId.set(session.state, session.sessionId);
    return session;
  }

  /**
   * Get a session by its session ID.
   *
   * @param sessionId - The unique session identifier
   * @returns The session if found and not expired, undefined otherwise
   */
  get(sessionId: string): AuthSession | undefined {
    const session = this.sessions.get(sessionId);
    if (session && session.isExpired()) {
      this.remove(sessionId);
      return undefined;
    }
    return session;
  }

  /**
   * Get a session by its state parameter.
   *
   * Useful for looking up sessions during OAuth callback handling.
   *
   * @param state - The state parameter from the OAuth callback
   * @returns The session if found and not expired, undefined otherwise
   */
  getByState(state: string): AuthSession | undefined {
    const sessionId = this.stateToSessionId.get(state);
    if (!sessionId) {
      return undefined;
    }
    return this.get(sessionId);
  }

  /**
   * Remove a session by its session ID.
   *
   * Cleans up both the session and its state parameter mapping.
   *
   * @param sessionId - The unique session identifier
   * @returns True if the session was removed, false if it didn't exist
   */
  remove(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    this.stateToSessionId.delete(session.state);
    this.sessions.delete(sessionId);
    return true;
  }

  /**
   * Remove a session by its state parameter.
   *
   * @param state - The state parameter
   * @returns True if the session was removed, false if it didn't exist
   */
  removeByState(state: string): boolean {
    const sessionId = this.stateToSessionId.get(state);
    if (!sessionId) {
      return false;
    }
    return this.remove(sessionId);
  }

  /**
   * List all active (non-expired) sessions.
   *
   * This method also performs cleanup of any expired sessions found.
   *
   * @returns Array of active AuthSession objects
   */
  list(): AuthSession[] {
    const activeSessions: AuthSession[] = [];
    const expiredSessionIds: string[] = [];

    for (const [sessionId, session] of this.sessions) {
      if (session.isExpired()) {
        expiredSessionIds.push(sessionId);
      } else {
        activeSessions.push(session);
      }
    }

    // Clean up expired sessions found during listing
    for (const sessionId of expiredSessionIds) {
      this.remove(sessionId);
    }

    return activeSessions;
  }

  /**
   * Get the count of active sessions.
   *
   * Note: This may include sessions that have expired but not yet been cleaned up.
   * Use list().length for an accurate count of non-expired sessions.
   *
   * @returns The number of tracked sessions
   */
  size(): number {
    return this.sessions.size;
  }

  /**
   * Check if a session exists by session ID.
   *
   * @param sessionId - The unique session identifier
   * @returns True if the session exists and is not expired
   */
  has(sessionId: string): boolean {
    return this.get(sessionId) !== undefined;
  }

  /**
   * Check if a session exists by state parameter.
   *
   * @param state - The state parameter
   * @returns True if a session with this state exists and is not expired
   */
  hasByState(state: string): boolean {
    return this.getByState(state) !== undefined;
  }

  /**
   * Remove all expired sessions.
   *
   * This is called automatically by the cleanup timer, but can also
   * be called manually to force immediate cleanup.
   *
   * @returns The number of expired sessions that were removed
   */
  cleanup(): number {
    const expiredSessionIds: string[] = [];

    for (const [sessionId, session] of this.sessions) {
      if (session.isExpired()) {
        expiredSessionIds.push(sessionId);
      }
    }

    for (const sessionId of expiredSessionIds) {
      this.remove(sessionId);
    }

    return expiredSessionIds.length;
  }

  /**
   * Start the automatic cleanup timer.
   *
   * If cleanup is already running, this method does nothing.
   */
  startCleanup(): void {
    if (this.cleanupTimer !== null) {
      return;
    }

    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.cleanupIntervalMs);

    // Ensure the timer doesn't prevent Node.js from exiting
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Stop the automatic cleanup timer.
   *
   * Call this method when shutting down to clean up resources.
   */
  stopCleanup(): void {
    if (this.cleanupTimer !== null) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Clear all sessions and stop cleanup.
   *
   * Use this for cleanup during shutdown or testing.
   */
  clear(): void {
    this.stopCleanup();
    this.sessions.clear();
    this.stateToSessionId.clear();
  }

  /**
   * Check if automatic cleanup is running.
   *
   * @returns True if the cleanup timer is active
   */
  isCleanupRunning(): boolean {
    return this.cleanupTimer !== null;
  }
}
