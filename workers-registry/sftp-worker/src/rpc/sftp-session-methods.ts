/**
 * RPC handlers for SFTP session management
 * 
 * Implements sftp/connect and sftp/disconnect methods.
 * Integrates SftpBackend and HostKeyVerifier.
 */

import { SessionManager } from '../session-manager.js';
import { SftpBackend } from '../sftp-backend.js';
import { HostKeyVerifier } from '../host-key-verifier.js';
import { ErrorMapper } from '../error-mapper.js';
import { ConnectionConfig } from '../types.js';

/**
 * Handle sftp/connect RPC method
 */
export async function handleConnect(
  params: any,
  sessionId: string,
  sessionManager: SessionManager
): Promise<any> {
  // Validate required parameters
  if (!params.host || typeof params.host !== 'string') {
    throw ErrorMapper.createRpcError(-32602, 'Invalid params: host required');
  }
  if (!params.username || typeof params.username !== 'string') {
    throw ErrorMapper.createRpcError(-32602, 'Invalid params: username required');
  }
  if (!params.authType || !['password', 'privateKey'].includes(params.authType)) {
    throw ErrorMapper.createRpcError(-32602, 'Invalid params: authType must be "password" or "privateKey"');
  }

  // Log connection attempt (safe fields only)
  console.error(`[sftp-worker] Connecting to ${params.host}:${params.port || 22} as ${params.username} (auth: ${params.authType})`);

  const config: ConnectionConfig = {
    host: params.host,
    port: params.port || 22,
    username: params.username,
    authType: params.authType,
    password: params.password,
    privateKey: params.privateKey,
    passphrase: params.passphrase,
    timeout: params.timeout || 30000,
    hostKeyPolicy: params.hostKeyPolicy || 'tofu',
    knownHostKeys: params.knownHostKeys,
  };

  try {
    const session = sessionManager.getSession(sessionId);
    if (!session) {
      throw ErrorMapper.createRpcError(-32000, 'No active session');
    }

    // Transition to connecting state
    sessionManager.transitionTo(session, 'connecting');

    // Create backend and connect
    const backend = new SftpBackend();
    const result = await backend.connect(config);

    // Store backend in session
    session.backend = backend;

    // Transition to active state
    sessionManager.transitionTo(session, 'active');

    console.error(`[sftp-worker] Connected to ${params.host}:${params.port || 22}`);

    return {
      connected: result.connected,
      serverBanner: result.serverBanner,
      hostKeyFingerprint: result.hostKeyFingerprint,
    };
  } catch (error: any) {
    // CRITICAL: Never log error.message directly - it may contain credentials
    // Only log safe connection info
    console.error(`[sftp-worker] Connection failed to ${params.host}:${params.port || 22}`);

    // Map error to appropriate RPC error code
    if (error.code) {
      throw error; // Already an RPC error
    }

    throw ErrorMapper.map(error, { method: 'sftp/connect' });
  }
}

/**
 * Handle sftp/disconnect RPC method
 */
export async function handleDisconnect(
  params: any,
  sessionId: string,
  sessionManager: SessionManager
): Promise<any> {
  const session = sessionManager.getSession(sessionId);

  // Idempotent - return success even if already disconnected
  if (!session || session.state === 'closed') {
    return { disconnected: true };
  }

  try {
    // Transition to closing state
    if (session.state === 'active') {
      sessionManager.transitionTo(session, 'closing');
    }

    // Wait for in-flight requests to complete
    // (This will be implemented when ConcurrencyQueue is added in Task 12)

    // Disconnect backend
    if (session.backend) {
      await session.backend.disconnect();
    }

    // Transition to closed and cleanup
    await sessionManager.destroySession(sessionId);

    console.error(`[sftp-worker] Disconnected session ${sessionId}`);

    return { disconnected: true };
  } catch (error: any) {
    // CRITICAL: Never log error.message directly - it may contain credentials
    console.error(`[sftp-worker] Disconnect error for session ${sessionId}`);

    // Even on error, try to cleanup
    try {
      await sessionManager.destroySession(sessionId);
    } catch { }

    // Return success anyway (idempotent)
    return { disconnected: true };
  }
}
