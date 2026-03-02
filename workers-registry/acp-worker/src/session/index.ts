/**
 * Session State Management
 *
 * This module manages ACP session state including session creation,
 * lookup, and cleanup. Each session maintains its own MCP connections
 * and conversation history.
 *
 * @module session
 */

export { SessionManager } from './manager.js';
export { Session } from './session.js';
export type { SessionState, HistoryEntry } from './types.js';
