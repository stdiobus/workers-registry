/**
 * SessionManager — управление сессиями и state machine
 * 
 * Управляет жизненным циклом SFTP-сессий через state machine:
 * idle → connecting → active → closing → closed
 */

import type { SessionState, NegotiatedCapabilities, BASELINE_CAPABILITIES } from './types.js';
import { SftpError } from './types.js';
import { NO_ACTIVE_CONNECTION, SESSION_CLOSING } from './error-codes.js';

/**
 * Session object representing an SFTP connection lifecycle
 */
export interface Session {
  sessionId: string;
  state: SessionState;
  backend: any | null; // ISftpBackend - will be typed when backend is implemented
  capabilities: NegotiatedCapabilities;
  inFlightRequests: Map<string | number, AbortController>;
  handleManager: any | null; // HandleManager - will be typed when implemented
  concurrencyQueue: any | null; // ConcurrencyQueue - will be typed when implemented
  createdAt: number;
}

/**
 * SessionManager manages SFTP session lifecycle and state machine
 * 
 * State transitions:
 * - idle → connecting (on sftp/connect)
 * - connecting → active (on successful connection)
 * - connecting → closed (on connection failure)
 * - active → closing (on sftp/disconnect)
 * - active → closed (on connection loss)
 * - closing → closed (when in-flight requests complete)
 */
export class SessionManager {
  private sessions: Map<string, Session>;
  private maxConcurrentSessions: number;

  constructor(maxConcurrentSessions: number = 10) {
    this.sessions = new Map();
    this.maxConcurrentSessions = maxConcurrentSessions;
  }

  /**
   * Create a new session in idle state
   * 
   * @param sessionId - Unique session identifier
   * @param capabilities - Negotiated capabilities (defaults to baseline)
   * @returns Created session object
   */
  createSession(
    sessionId: string,
    capabilities?: NegotiatedCapabilities
  ): Session {
    if (this.sessions.has(sessionId)) {
      throw new Error(`Session ${sessionId} already exists`);
    }

    // Import baseline capabilities dynamically to avoid circular dependency
    const baselineCapabilities: NegotiatedCapabilities = {
      chunkedIO: false,
      atomicWrite: false,
      hostKeyVerification: true,
      maxChunkBytes: 1048576,
      maxInlineFileBytes: 1048576,
      cancelRequest: false,
    };

    const session: Session = {
      sessionId,
      state: 'idle',
      backend: null,
      capabilities: capabilities || baselineCapabilities,
      inFlightRequests: new Map(),
      handleManager: null,
      concurrencyQueue: null,
      createdAt: Date.now(),
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  /**
   * Get session by ID
   * 
   * @param sessionId - Session identifier
   * @returns Session object or undefined if not found
   */
  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Validate if a method is allowed in the current session state
   * 
   * Throws SftpError if the method is not allowed.
   * 
   * State-based method acceptance:
   * - idle: only sftp/initialize and sftp/connect
   * - connecting: only $/cancelRequest
   * - active: all SFTP methods
   * - closing: nothing new (reject with SESSION_CLOSING)
   * - closed: nothing (reject with NO_ACTIVE_CONNECTION)
   * 
   * @param session - Session object
   * @param method - RPC method name
   * @throws SftpError if method not allowed in current state
   */
  validateTransition(session: Session, method: string): void {
    const { state } = session;

    switch (state) {
      case 'idle':
        // Only sftp/initialize and sftp/connect allowed
        if (method !== 'sftp/initialize' && method !== 'sftp/connect') {
          throw new SftpError(
            NO_ACTIVE_CONNECTION,
            `No active connection for session ${session.sessionId}. Call sftp/connect first.`
          );
        }
        break;

      case 'connecting':
        // Only $/cancelRequest allowed
        if (method !== '$/cancelRequest') {
          throw new SftpError(
            SESSION_CLOSING,
            `Session ${session.sessionId} is connecting. Only $/cancelRequest is allowed.`
          );
        }
        break;

      case 'active':
        // All SFTP methods allowed
        break;

      case 'closing':
        // No new requests allowed
        throw new SftpError(
          SESSION_CLOSING,
          `Session ${session.sessionId} is closing. New requests are rejected.`
        );

      case 'closed':
        // Session is closed
        throw new SftpError(
          NO_ACTIVE_CONNECTION,
          `Session ${session.sessionId} is closed.`
        );

      default:
        throw new Error(`Unknown session state: ${state}`);
    }
  }

  /**
   * Transition session to a new state
   * 
   * Valid transitions:
   * - idle → connecting
   * - connecting → active | closed
   * - active → closing | closed
   * - closing → closed
   * 
   * @param session - Session object
   * @param newState - Target state
   */
  transitionTo(session: Session, newState: SessionState): void {
    const { state: currentState, sessionId } = session;

    // Validate transition
    const validTransitions: Record<SessionState, SessionState[]> = {
      idle: ['connecting'],
      connecting: ['active', 'closed'],
      active: ['closing', 'closed'],
      closing: ['closed'],
      closed: [],
    };

    const allowed = validTransitions[currentState];
    if (!allowed.includes(newState)) {
      throw new Error(
        `Invalid state transition for session ${sessionId}: ${currentState} → ${newState}`
      );
    }

    session.state = newState;

    // Handle transition to closed state
    if (newState === 'closed') {
      this.cleanupSession(session);
    }
  }

  /**
   * Cleanup session resources
   * 
   * Called when transitioning to 'closed' state.
   * Releases all resources: handles, connections, timers, in-flight requests.
   * 
   * @param session - Session to cleanup
   */
  private cleanupSession(session: Session): void {
    const { sessionId } = session;

    // Cancel all in-flight requests
    for (const [requestId, controller] of session.inFlightRequests.entries()) {
      controller.abort();
    }
    session.inFlightRequests.clear();

    // Close backend connection
    if (session.backend) {
      // Backend cleanup will be handled by the backend itself
      session.backend = null;
    }

    // Close all handles
    if (session.handleManager) {
      // HandleManager cleanup will be handled by the manager itself
      session.handleManager = null;
    }

    // Clear concurrency queue
    if (session.concurrencyQueue) {
      // ConcurrencyQueue cleanup will be handled by the queue itself
      session.concurrencyQueue = null;
    }
  }

  /**
   * Destroy session and remove from map
   * 
   * Transitions session to 'closed' state and removes it from the session map.
   * 
   * @param sessionId - Session identifier
   */
  async destroySession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return; // Idempotent: already destroyed
    }

    // Cleanup resources and transition to closed
    if (session.state !== 'closed') {
      // For idle sessions, we can directly cleanup and mark as closed
      // without going through the state machine
      if (session.state === 'idle') {
        this.cleanupSession(session);
        session.state = 'closed';
      } else {
        // For other states, use proper state transition
        // connecting → closed, active → closed, closing → closed
        this.transitionTo(session, 'closed');
      }
    }

    // Remove from map
    this.sessions.delete(sessionId);
  }

  /**
   * Destroy all sessions (for SIGTERM graceful shutdown)
   * 
   * Closes all active sessions and waits for in-flight requests to complete.
   */
  async destroyAll(): Promise<void> {
    const sessionIds = Array.from(this.sessions.keys());

    // Destroy all sessions in parallel
    await Promise.all(
      sessionIds.map(sessionId => this.destroySession(sessionId))
    );
  }

  /**
   * Get number of active sessions
   */
  get sessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Get all session IDs
   */
  get sessionIds(): string[] {
    return Array.from(this.sessions.keys());
  }

  /**
   * Check if at max capacity
   */
  isAtCapacity(): boolean {
    return this.sessions.size >= this.maxConcurrentSessions;
  }
}
