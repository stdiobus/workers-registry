/**
 * Session
 *
 * Represents a single ACP session with its state and MCP connections.
 * Stores sessionId, cwd, MCP connections, and cancellation flag.
 *
 * @module session/session
 */

import type { HistoryEntry, SessionState } from './types.js';
import { MCPManager } from '../mcp/index.js';

/**
 * Factory function type for creating MCPManager instances.
 * Used for dependency injection in tests.
 */
export type MCPManagerFactory = () => MCPManager;

/** Default factory using the real MCPManager */
const defaultMcpManagerFactory: MCPManagerFactory = () => new MCPManager();

/**
 * Represents an ACP session.
 *
 * The Session class manages:
 * - Session identification (sessionId per requirements)
 * - Working directory context (cwd)
 * - MCP server connections via MCPManager
 * - Cancellation state for aborting operations
 * - Conversation history
 */
export class Session {
  /** Unique session identifier (SessionId type per requirements) */
  readonly id: string;

  /** Current working directory for the session */
  readonly cwd: string;

  /** Manager for MCP server connections */
  readonly mcpManager: MCPManager;

  /** Cancellation flag for aborting pending operations */
  private cancelled: boolean = false;

  /** Timestamp when the session was created */
  private createdAt: Date;

  /** Conversation history for the session */
  private history: HistoryEntry[] = [];

  /**
   * Create a new Session.
   *
   * @param id - Unique session identifier
   * @param cwd - Current working directory for the session
   * @param mcpManagerFactory - Optional factory for creating MCPManager (used in tests)
   */
  constructor(id: string, cwd: string, mcpManagerFactory?: MCPManagerFactory) {
    this.id = id;
    this.cwd = cwd;
    this.mcpManager = (mcpManagerFactory ?? defaultMcpManagerFactory)();
    this.createdAt = new Date();
  }

  /**
   * Check if the session has been cancelled.
   *
   * @returns true if the session has been cancelled
   */
  isCancelled(): boolean {
    return this.cancelled;
  }

  /**
   * Cancel the session.
   * Sets the cancellation flag and aborts pending MCP operations.
   */
  cancel(): void {
    this.cancelled = true;
    // Abort pending MCP operations by closing all connections
    // This will cause any in-flight requests to fail gracefully
    this.mcpManager.abortPendingOperations();
  }

  /**
   * Add an entry to the conversation history.
   *
   * @param role - Role of the message sender ('user' or 'agent')
   * @param content - Content of the message
   */
  addHistoryEntry(role: 'user' | 'agent', content: string): void {
    this.history.push({
      role,
      content,
      timestamp: new Date(),
    });
  }

  /**
   * Get the conversation history.
   *
   * @returns Array of history entries
   */
  getHistory(): HistoryEntry[] {
    return [...this.history];
  }

  /**
   * Clear the conversation history.
   */
  clearHistory(): void {
    this.history = [];
  }

  /**
   * Get the session state.
   *
   * @returns Current session state including id, cwd, cancelled flag, and history
   */
  getState(): SessionState {
    return {
      id: this.id,
      cwd: this.cwd,
      cancelled: this.cancelled,
      createdAt: this.createdAt,
      history: [...this.history],
    };
  }

  /**
   * Close the session and cleanup resources.
   * Closes all MCP server connections.
   */
  async close(): Promise<void> {
    await this.mcpManager.close();
  }
}
