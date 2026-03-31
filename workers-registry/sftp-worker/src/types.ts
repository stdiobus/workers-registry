/**
 * Core TypeScript types and interfaces for SFTP Worker
 * 
 * Defines JSON-RPC 2.0 message structures, SFTP operation types,
 * session state management, and configuration interfaces.
 */

// ============================================================================
// JSON-RPC 2.0 Message Types
// ============================================================================

/**
 * JSON-RPC 2.0 request message
 * 
 * All requests must include jsonrpc version, id, and method.
 * The sessionId field enables session affinity routing through stdio_bus daemon.
 */
export interface RpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
  sessionId?: string;
}

/**
 * JSON-RPC 2.0 response message
 * 
 * Must contain either result or error, but not both.
 * The sessionId is preserved from the request for routing.
 */
export interface RpcResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: RpcError;
  sessionId?: string;
}

/**
 * JSON-RPC 2.0 error object with structured data
 * 
 * The data field contains SFTP-specific error context including
 * source module, error category, path, and retry information.
 */
export interface RpcError {
  code: number;
  message: string;
  data?: {
    source: string;
    category: string;
    path?: string;
    retryable: boolean;
    reason?: 'cancelled' | 'session_closing' | 'connection_lost';
    presentedFingerprint?: string;
    expectedFingerprint?: string;
    fallbackAvailable?: boolean;
  };
}

// ============================================================================
// SFTP Error Types
// ============================================================================

/**
 * Typed SFTP error with code and optional path context
 * 
 * Used internally to represent SFTP operation failures before
 * mapping to JSON-RPC error format.
 */
export class SftpError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly path?: string,
    public readonly originalError?: unknown
  ) {
    super(message);
    this.name = 'SftpError';
  }
}

// ============================================================================
// Session State Management
// ============================================================================

/**
 * SFTP session lifecycle states
 * 
 * State transitions:
 * - idle → connecting (on sftp/connect)
 * - connecting → active (on successful connection)
 * - connecting → closed (on connection failure)
 * - active → closing (on sftp/disconnect)
 * - active → closed (on connection loss)
 * - closing → closed (when in-flight requests complete)
 */
export type SessionState = 'idle' | 'connecting' | 'active' | 'closing' | 'closed';

// ============================================================================
// Connection Configuration
// ============================================================================

/**
 * SFTP connection configuration
 * 
 * Supports both password and private key authentication.
 * Host key verification policy controls MITM protection level.
 */
export interface ConnectionConfig {
  host: string;
  port: number;           // default: 22
  username: string;
  authType: 'password' | 'privateKey';
  password?: string;
  privateKey?: string;
  passphrase?: string;
  timeout?: number;       // default: 30000ms
  hostKeyPolicy?: 'strict' | 'tofu' | 'none';
  knownHostKeys?: string[];
}

/**
 * Result of successful SFTP connection
 * 
 * Returns server banner and host key fingerprint for verification.
 */
export interface ConnectResult {
  connected: boolean;
  serverBanner?: string;
  hostKeyFingerprint: string;
}

// ============================================================================
// SFTP Operation Result Types
// ============================================================================

/**
 * File or directory metadata from stat/lstat operations
 * 
 * Times are Unix timestamps in seconds.
 * Mode is POSIX file permissions as octal number.
 */
export interface StatResult {
  type: 'file' | 'directory' | 'symlink';
  size: number;
  mtime: number;  // Unix timestamp (seconds)
  atime: number;  // Unix timestamp (seconds)
  mode: number;   // POSIX permissions
}

/**
 * Directory entry from readdir operation
 * 
 * Includes file metadata inline to reduce round-trips.
 */
export interface ReaddirEntry {
  name: string;
  type: 'file' | 'directory' | 'symlink';
  size: number;
  mtime: number;  // Unix timestamp (seconds)
  atime: number;  // Unix timestamp (seconds)
}

// ============================================================================
// Capability Negotiation
// ============================================================================

/**
 * Negotiated capabilities between client and worker
 * 
 * Determined during sftp/initialize handshake.
 * Controls which optional features are available for the session.
 */
export interface NegotiatedCapabilities {
  chunkedIO: boolean;
  atomicWrite: boolean;
  hostKeyVerification: boolean;
  maxChunkBytes: number;       // default: 1048576 (1MB)
  maxInlineFileBytes: number;  // default: 1048576 (1MB)
  cancelRequest: boolean;
}

/**
 * Baseline capabilities when sftp/initialize is not called
 * 
 * Provides minimal feature set for backward compatibility.
 */
export const BASELINE_CAPABILITIES: NegotiatedCapabilities = {
  chunkedIO: false,
  atomicWrite: false,
  hostKeyVerification: true, // tofu by default
  maxChunkBytes: 1048576,
  maxInlineFileBytes: 1048576,
  cancelRequest: false,
};

// ============================================================================
// Resource Limits
// ============================================================================

/**
 * Worker resource limits configuration
 * 
 * Controls maximum concurrent sessions, in-flight requests,
 * and open stream handles to prevent resource exhaustion.
 */
export interface WorkerLimits {
  maxConcurrentSessions: number;  // default: 10
  maxInFlightPerSession: number;  // default: 16
  maxOpenHandles: number;         // default: 32
  handleTimeoutMs: number;        // default: 60000
}

/**
 * Default resource limits
 */
export const DEFAULT_WORKER_LIMITS: WorkerLimits = {
  maxConcurrentSessions: 10,
  maxInFlightPerSession: 16,
  maxOpenHandles: 32,
  handleTimeoutMs: 60000,
};
