/**
 * Session Types
 *
 * Type definitions for session state management.
 *
 * @module session/types
 */

/**
 * Represents a history entry in a session.
 */
export interface HistoryEntry {
  /** Role of the message sender */
  role: 'user' | 'agent';
  /** Content of the message */
  content: string;
  /** Timestamp of the message */
  timestamp: Date;
}

/**
 * Represents the state of an ACP session.
 */
export interface SessionState {
  /** Unique session identifier (SessionId type per requirements) */
  id: string;
  /** Current working directory for the session */
  cwd: string;
  /** Whether the session has been cancelled */
  cancelled: boolean;
  /** When the session was created */
  createdAt: Date;
  /** Conversation history for the session */
  history: HistoryEntry[];
}
