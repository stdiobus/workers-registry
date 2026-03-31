/**
 * RPC Method Registry
 * 
 * Registers all SFTP RPC methods with the dispatcher.
 * Provides dependency injection for handlers.
 * 
 * This module acts as the wiring layer between RpcDispatcher (generic)
 * and concrete SFTP method handlers.
 */

import { RpcDispatcher, RpcHandler } from '../rpc-dispatcher.js';
import { SessionManager } from '../session-manager.js';
import { handleConnect, handleDisconnect } from './sftp-session-methods.js';
import {
  handleReaddir,
  handleStat,
  handleReadFile,
  handleWriteFile,
  handleMkdir,
  handleDelete,
  handleRename,
} from './sftp-file-methods.js';
import {
  handleOpenRead,
  handleReadChunk,
  handleCloseRead,
  handleOpenWrite,
  handleWriteChunk,
  handleCommitWrite,
  handleAbortWrite,
} from './sftp-chunked-methods.js';
import { RpcRequest } from '../types.js';

/**
 * Dependencies required by RPC handlers
 */
export interface RpcHandlerDependencies {
  sessionManager: SessionManager;
}

/**
 * Register all SFTP RPC methods with the dispatcher
 * 
 * @param dispatcher - RpcDispatcher instance
 * @param deps - Handler dependencies (SessionManager, etc.)
 */
export function registerRpcMethods(
  dispatcher: RpcDispatcher,
  deps: RpcHandlerDependencies
): void {
  const { sessionManager } = deps;

  // Register sftp/connect
  dispatcher.registerHandler('sftp/connect', createConnectHandler(sessionManager));

  // Register sftp/disconnect
  dispatcher.registerHandler('sftp/disconnect', createDisconnectHandler(sessionManager));

  // Register file operation methods
  dispatcher.registerHandler('sftp/readdir', createFileMethodHandler(handleReaddir, sessionManager));
  dispatcher.registerHandler('sftp/stat', createFileMethodHandler(handleStat, sessionManager));
  dispatcher.registerHandler('sftp/readFile', createFileMethodHandler(handleReadFile, sessionManager));
  dispatcher.registerHandler('sftp/writeFile', createFileMethodHandler(handleWriteFile, sessionManager));

  // Register mkdir, delete, rename methods
  dispatcher.registerHandler('sftp/mkdir', createFileMethodHandler(handleMkdir, sessionManager));
  dispatcher.registerHandler('sftp/delete', createFileMethodHandler(handleDelete, sessionManager));
  dispatcher.registerHandler('sftp/rename', createFileMethodHandler(handleRename, sessionManager));

  // Chunked I/O methods (Task 17)
  dispatcher.registerHandler('sftp/openRead', createFileMethodHandler(handleOpenRead, sessionManager));
  dispatcher.registerHandler('sftp/readChunk', createFileMethodHandler(handleReadChunk, sessionManager));
  dispatcher.registerHandler('sftp/closeRead', createFileMethodHandler(handleCloseRead, sessionManager));
  dispatcher.registerHandler('sftp/openWrite', createFileMethodHandler(handleOpenWrite, sessionManager));
  dispatcher.registerHandler('sftp/writeChunk', createFileMethodHandler(handleWriteChunk, sessionManager));
  dispatcher.registerHandler('sftp/commitWrite', createFileMethodHandler(handleCommitWrite, sessionManager));
  dispatcher.registerHandler('sftp/abortWrite', createFileMethodHandler(handleAbortWrite, sessionManager));
}

/**
 * Create sftp/connect handler with dependency injection
 */
function createConnectHandler(sessionManager: SessionManager): RpcHandler {
  return async (request: RpcRequest): Promise<unknown> => {
    const { params, sessionId } = request;

    if (!sessionId) {
      throw new Error('sessionId required for sftp/connect');
    }

    // Ensure session exists
    let session = sessionManager.getSession(sessionId);
    if (!session) {
      session = sessionManager.createSession(sessionId);
    }

    return await handleConnect(params || {}, sessionId, sessionManager);
  };
}

/**
 * Create sftp/disconnect handler with dependency injection
 */
function createDisconnectHandler(sessionManager: SessionManager): RpcHandler {
  return async (request: RpcRequest): Promise<unknown> => {
    const { params, sessionId } = request;

    if (!sessionId) {
      throw new Error('sessionId required for sftp/disconnect');
    }

    return await handleDisconnect(params || {}, sessionId, sessionManager);
  };
}

/**
 * Create a file method handler with dependency injection
 * 
 * Generic factory for sftp/readdir, sftp/stat, sftp/readFile, sftp/writeFile
 */
function createFileMethodHandler(
  handler: (params: any, sessionId: string, sessionManager: SessionManager) => Promise<unknown>,
  sessionManager: SessionManager
): RpcHandler {
  return async (request: RpcRequest): Promise<unknown> => {
    const { params, sessionId } = request;

    if (!sessionId) {
      throw new Error('sessionId required');
    }

    return await handler(params || {}, sessionId, sessionManager);
  };
}
