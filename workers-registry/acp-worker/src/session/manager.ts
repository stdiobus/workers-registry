/**
 * Session Manager
 *
 * Manages the lifecycle of ACP sessions.
 *
 * @module session/manager
 */

import { type MCPManagerFactory, Session } from './session.js';
import type { MCPServerConfig } from '../mcp/types.js';

/**
 * Manages ACP sessions.
 */
export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private mcpManagerFactory?: MCPManagerFactory;

  /**
   * Create a new SessionManager.
   *
   * @param mcpManagerFactory - Optional factory for creating MCPManager instances (used in tests)
   */
  constructor(mcpManagerFactory?: MCPManagerFactory) {
    this.mcpManagerFactory = mcpManagerFactory;
  }

  /**
   * Create a new session.
   */
  async createSession(cwd: string, mcpServers?: MCPServerConfig[]): Promise<Session> {
    // TODO: Implement in task 21.2
    const id = this.generateSessionId();
    const session = new Session(id, cwd, this.mcpManagerFactory);

    if (mcpServers && mcpServers.length > 0) {
      await session.mcpManager.connect(mcpServers);
    }

    this.sessions.set(id, session);
    return session;
  }

  /**
   * Get a session by ID.
   */
  getSession(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  /**
   * Cancel a session.
   */
  cancelSession(id: string): boolean {
    const session = this.sessions.get(id);
    if (session) {
      session.cancel();
      return true;
    }
    return false;
  }

  /**
   * Close and remove a session.
   */
  async closeSession(id: string): Promise<boolean> {
    const session = this.sessions.get(id);
    if (session) {
      await session.close();
      this.sessions.delete(id);
      return true;
    }
    return false;
  }

  /**
   * Close all sessions.
   */
  async closeAll(): Promise<void> {
    for (const session of this.sessions.values()) {
      await session.close();
    }
    this.sessions.clear();
  }

  /**
   * Get all sessions.
   *
   * @returns Array of all sessions
   */
  getAllSessions(): Session[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Remove a session from the manager without closing it.
   *
   * @param id - Session ID to remove
   * @returns true if session was removed, false if not found
   */
  removeSession(id: string): boolean {
    return this.sessions.delete(id);
  }

  /**
   * Generate a unique session ID using crypto.randomUUID().
   *
   * Generate unique sessionId using UUID
   *
   * @returns A unique UUID string for the session
   */
  private generateSessionId(): string {
    return crypto.randomUUID();
  }
}
