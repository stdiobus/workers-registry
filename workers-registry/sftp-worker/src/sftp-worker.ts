#!/usr/bin/env node
/**
 * SFTP Worker Entry Point
 *
 * Wires all components into a unified pipeline:
 *   RpcDispatcher → PathNormalizer → SessionManager →
 *   CapabilityNegotiator → ConcurrencyQueue →
 *   SftpBackend / HandleManager / AtomicWriter → ErrorMapper
 *
 * Reads NDJSON from stdin, writes JSON-RPC 2.0 to stdout, logs to stderr.
 */

import { RpcDispatcher } from './rpc-dispatcher.js';
import { SessionManager } from './session-manager.js';
import { ResourceLimiter } from './resource-limiter.js';
import { CapabilityNegotiator } from './capability-negotiator.js';
import { registerRpcMethods } from './rpc/method-registry.js';
import { DEFAULT_WORKER_LIMITS } from './types.js';
import type { RpcRequest } from './types.js';

/**
 * Create sftp/initialize handler that delegates to CapabilityNegotiator.
 */
function createInitializeHandler(
  negotiator: CapabilityNegotiator,
  sessionManager: SessionManager,
) {
  return async (request: RpcRequest): Promise<unknown> => {
    const { params, sessionId } = request;

    if (!sessionId) {
      throw { code: -32602, message: 'sessionId required for sftp/initialize' };
    }

    // Ensure session exists (create if needed)
    let session = sessionManager.getSession(sessionId);
    if (!session) {
      session = sessionManager.createSession(sessionId);
    }

    // Validate that session is in idle state
    sessionManager.validateTransition(session, 'sftp/initialize');

    const result = negotiator.negotiate({
      protocolVersion: (params?.protocolVersion as string) ?? '1.0',
      clientName: (params?.clientName as string) ?? 'unknown',
      clientVersion: (params?.clientVersion as string) ?? '0.0.0',
      capabilities: params?.capabilities as any,
    });

    // Store negotiated capabilities on the session
    session.capabilities = result.capabilities;

    return result;
  };
}

/**
 * Main — build the component graph and start the dispatcher.
 */
async function main(): Promise<void> {
  // 1. Resource limiter (stateless policy helper)
  const resourceLimiter = new ResourceLimiter(DEFAULT_WORKER_LIMITS, process.stderr);

  // 2. Session manager
  const sessionManager = new SessionManager(
    DEFAULT_WORKER_LIMITS.maxConcurrentSessions,
  );

  // 3. Capability negotiator
  const negotiator = new CapabilityNegotiator();

  // 4. RPC dispatcher — reads stdin, writes stdout, logs stderr
  const dispatcher = new RpcDispatcher({
    handlers: new Map(),
    debug: process.env.DEBUG === 'true',
    onShutdown: async () => {
      // Graceful shutdown: destroy all sessions (close connections, handles, queues)
      await sessionManager.destroyAll();
    },
  });

  // 5. Register sftp/initialize (capability handshake)
  dispatcher.registerHandler(
    'sftp/initialize',
    createInitializeHandler(negotiator, sessionManager),
  );

  // 6. Register all SFTP RPC methods (connect, disconnect, file ops, chunked I/O)
  registerRpcMethods(dispatcher, { sessionManager });

  // 7. Start processing NDJSON messages from stdin
  await dispatcher.start();
}

// Bootstrap and handle fatal errors
main()
  .then(() => {
    process.exit(0);
  })
  .catch((err: Error) => {
    process.stderr.write(
      `[${new Date().toISOString()}] FATAL: ${err.message}\n${err.stack}\n`,
    );
    process.exit(1);
  });
