/**
 * RpcDispatcher - Main entry point for SFTP Worker
 * 
 * Reads NDJSON from stdin, parses JSON-RPC 2.0 messages, validates format,
 * routes to handlers, and writes responses to stdout.
 * 
 * Responsibilities:
 * - NDJSON parsing from stdin (one JSON message per line)
 * - JSON-RPC 2.0 validation (jsonrpc, id, method fields)
 * - Error code mapping for protocol errors
 * - Notification handling (messages without id - no response)
 * - Response serialization to stdout
 * - Signal handling for graceful shutdown
 * - Logging to stderr only (stdout reserved for protocol)
 */

import * as readline from 'readline';
import { RpcRequest, RpcResponse, RpcError } from './types.js';
import {
  JSONRPC_PARSE_ERROR,
  JSONRPC_INVALID_REQUEST,
  JSONRPC_METHOD_NOT_FOUND,
  JSONRPC_INVALID_PARAMS,
} from './error-codes.js';

/**
 * Type for RPC method handlers
 * 
 * Handlers receive the request and return a promise that resolves to
 * the result value or rejects with an RpcError.
 */
export type RpcHandler = (request: RpcRequest) => Promise<unknown>;

/**
 * RpcDispatcher configuration
 */
export interface RpcDispatcherConfig {
  /** Map of method names to handler functions */
  handlers: Map<string, RpcHandler>;
  /** Enable debug logging to stderr */
  debug?: boolean;
  /** Input stream (default: process.stdin) */
  stdin?: NodeJS.ReadableStream;
  /** Output stream (default: process.stdout) */
  stdout?: NodeJS.WritableStream;
  /** Error stream (default: process.stderr) */
  stderr?: NodeJS.WritableStream;
  /** Callback invoked during graceful shutdown, after in-flight requests drain */
  onShutdown?: () => Promise<void>;
}

/**
 * Main RPC dispatcher class
 * 
 * Manages the lifecycle of the SFTP Worker:
 * - Reads NDJSON messages from stdin
 * - Validates JSON-RPC 2.0 format
 * - Routes to registered handlers
 * - Writes responses to stdout
 * - Handles graceful shutdown on SIGTERM/SIGINT
 */
export class RpcDispatcher {
  private handlers: Map<string, RpcHandler>;
  private debug: boolean;
  private shutdownRequested = false;
  private inFlightRequests = 0;
  private rl: readline.Interface | null = null;
  private stdin: NodeJS.ReadableStream;
  private stdout: NodeJS.WritableStream;
  private stderr: NodeJS.WritableStream;
  private onShutdown?: () => Promise<void>;

  constructor(config: RpcDispatcherConfig) {
    this.handlers = config.handlers;
    this.debug = config.debug ?? false;
    this.stdin = config.stdin ?? process.stdin;
    this.stdout = config.stdout ?? process.stdout;
    this.stderr = config.stderr ?? process.stderr;
    this.onShutdown = config.onShutdown;
  }

  /**
   * Register a new RPC method handler
   */
  registerHandler(method: string, handler: RpcHandler): void {
    this.handlers.set(method, handler);
  }

  /**
   * Start the dispatcher - read from stdin and process messages
   * 
   * Returns a promise that resolves when stdin closes or shutdown completes.
   */
  async start(): Promise<void> {
    this.logStartup();
    this.setupSignalHandlers();

    this.rl = readline.createInterface({
      input: this.stdin,
      output: undefined, // No output - we write directly to stdout
      terminal: false,
    });

    return new Promise((resolve, reject) => {
      if (!this.rl) {
        reject(new Error('readline interface not initialized'));
        return;
      }

      this.rl.on('line', (line: string) => {
        if (this.shutdownRequested) {
          return; // Ignore new messages during shutdown
        }
        this.handleLine(line);
      });

      this.rl.on('close', () => {
        this.logInfo('stdin closed, exiting gracefully');
        resolve();
      });

      this.rl.on('error', (err: Error) => {
        this.logError('stdin error', err);
        reject(err);
      });
    });
  }

  /**
   * Handle a single NDJSON line from stdin
   */
  private handleLine(line: string): void {
    // Skip empty lines
    if (line.trim() === '') {
      return;
    }

    // Parse JSON
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      // Parse error - send error response if we can extract an id
      const maybeId = this.tryExtractId(line);
      if (maybeId !== null) {
        this.sendError(maybeId, JSONRPC_PARSE_ERROR, 'Parse error: Invalid JSON', undefined);
      }
      // If no id, it's a notification - ignore per JSON-RPC 2.0 spec
      return;
    }

    // Validate JSON-RPC 2.0 format
    const validationError = this.validateRequest(parsed);
    if (validationError) {
      const req = parsed as Partial<RpcRequest>;
      if (req.id !== undefined) {
        this.sendError(
          req.id,
          validationError.code,
          validationError.message,
          req.sessionId
        );
      }
      // If no id, it's a notification - ignore
      return;
    }

    const request = parsed as RpcRequest;

    // Check if it's a notification (no id field)
    if (request.id === undefined) {
      // Notifications don't get responses - just log and ignore
      if (this.debug) {
        this.logDebug(`Received notification: ${request.method}`);
      }
      return;
    }

    // Route to handler
    this.routeRequest(request);
  }

  /**
   * Try to extract an id from a malformed JSON string
   * 
   * Best-effort attempt to find an id field for error reporting.
   * Returns null if no id can be found.
   */
  private tryExtractId(line: string): string | number | null {
    // Try to find "id": followed by a number or string
    const idMatch = line.match(/"id"\s*:\s*(?:(\d+)|"([^"]+)")/);
    if (idMatch) {
      return idMatch[1] ? parseInt(idMatch[1], 10) : idMatch[2];
    }
    return null;
  }

  /**
   * Validate JSON-RPC 2.0 request format
   * 
   * Returns an error object if validation fails, null if valid.
   */
  private validateRequest(parsed: unknown): { code: number; message: string } | null {
    if (typeof parsed !== 'object' || parsed === null) {
      return {
        code: JSONRPC_INVALID_REQUEST,
        message: 'Invalid Request: must be an object',
      };
    }

    const req = parsed as Partial<RpcRequest>;

    // Check jsonrpc field
    if (req.jsonrpc !== '2.0') {
      return {
        code: JSONRPC_INVALID_REQUEST,
        message: 'Invalid Request: jsonrpc field must be "2.0"',
      };
    }

    // Check method field
    if (typeof req.method !== 'string') {
      return {
        code: JSONRPC_INVALID_REQUEST,
        message: 'Invalid Request: method field must be a string',
      };
    }

    // Check id field (if present)
    if (req.id !== undefined && typeof req.id !== 'string' && typeof req.id !== 'number') {
      return {
        code: JSONRPC_INVALID_REQUEST,
        message: 'Invalid Request: id field must be a string or number',
      };
    }

    // Check params field (if present)
    if (req.params !== undefined && (typeof req.params !== 'object' || Array.isArray(req.params))) {
      return {
        code: JSONRPC_INVALID_REQUEST,
        message: 'Invalid Request: params field must be an object',
      };
    }

    return null;
  }

  /**
   * Route request to appropriate handler
   */
  private async routeRequest(request: RpcRequest): Promise<void> {
    const handler = this.handlers.get(request.method);

    if (!handler) {
      this.sendError(
        request.id,
        JSONRPC_METHOD_NOT_FOUND,
        `Method not found: ${request.method}`,
        request.sessionId
      );
      return;
    }

    // Track in-flight requests for graceful shutdown
    this.inFlightRequests++;

    try {
      const result = await handler(request);
      this.sendResult(request.id, result, request.sessionId);
    } catch (err) {
      // Handler threw an error - convert to RPC error
      if (this.isRpcError(err)) {
        this.sendError(request.id, err.code, err.message, request.sessionId, err.data);
      } else {
        // Unexpected error
        this.logError(`Unexpected error in handler for ${request.method}`, err);
        this.sendError(
          request.id,
          JSONRPC_INVALID_PARAMS,
          'Internal error',
          request.sessionId
        );
      }
    } finally {
      this.inFlightRequests--;
    }
  }

  /**
   * Type guard for RpcError
   */
  private isRpcError(err: unknown): err is RpcError {
    return (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      'message' in err &&
      typeof (err as RpcError).code === 'number' &&
      typeof (err as RpcError).message === 'string'
    );
  }

  /**
   * Send a successful result response
   */
  private sendResult(id: string | number, result: unknown, sessionId?: string): void {
    const response: RpcResponse = {
      jsonrpc: '2.0',
      id,
      result,
    };

    if (sessionId) {
      response.sessionId = sessionId;
    }

    this.writeResponse(response);
  }

  /**
   * Send an error response
   */
  private sendError(
    id: string | number,
    code: number,
    message: string,
    sessionId?: string,
    data?: RpcError['data']
  ): void {
    const response: RpcResponse = {
      jsonrpc: '2.0',
      id,
      error: {
        code,
        message,
        data,
      },
    };

    if (sessionId) {
      response.sessionId = sessionId;
    }

    this.writeResponse(response);
  }

  /**
   * Write a response to stdout as NDJSON
   * 
   * CRITICAL: stdout is reserved for protocol messages only.
   * All logging must go to stderr.
   */
  private writeResponse(response: RpcResponse): void {
    try {
      const line = JSON.stringify(response) + '\n';
      this.stdout.write(line);
    } catch (err) {
      this.logError('Failed to write response', err);
    }
  }

  /**
   * Setup signal handlers for graceful shutdown
   * 
   * SIGTERM and SIGINT trigger graceful shutdown:
   * - Stop accepting new messages
   * - Wait for in-flight requests to complete
   * - Exit with code 0
   */
  private setupSignalHandlers(): void {
    const shutdown = async (signal: string) => {
      if (this.shutdownRequested) {
        return; // Already shutting down
      }

      this.shutdownRequested = true;
      this.logInfo(`Received ${signal}, shutting down gracefully...`);

      // Close stdin to stop accepting new messages
      if (this.rl) {
        this.rl.close();
      }

      // Wait for in-flight requests to complete
      const maxWaitMs = 5000; // 5 seconds max wait
      const startTime = Date.now();
      while (this.inFlightRequests > 0 && Date.now() - startTime < maxWaitMs) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      if (this.inFlightRequests > 0) {
        this.logWarn(`Shutdown timeout: ${this.inFlightRequests} requests still in flight`);
      }

      // Invoke shutdown callback (e.g. SessionManager.destroyAll)
      if (this.onShutdown) {
        try {
          await this.onShutdown();
        } catch (err) {
          this.logError('Error during shutdown callback', err);
        }
      }

      this.logInfo('Shutdown complete');
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // Handle uncaught exceptions - log and exit with code 1
    process.on('uncaughtException', (err: Error) => {
      this.logError('Uncaught exception', err);
      process.exit(1);
    });

    process.on('unhandledRejection', (reason: unknown) => {
      this.logError('Unhandled rejection', reason);
      process.exit(1);
    });
  }

  /**
   * Log startup message to stderr
   */
  private logStartup(): void {
    this.logInfo('[sftp-worker] Started, waiting for NDJSON messages on stdin...');
  }

  /**
   * Log info message to stderr
   */
  private logInfo(message: string): void {
    const timestamp = new Date().toISOString();
    this.stderr.write(`[${timestamp}] INFO: ${message}\n`);
  }

  /**
   * Log warning message to stderr
   */
  private logWarn(message: string): void {
    const timestamp = new Date().toISOString();
    this.stderr.write(`[${timestamp}] WARN: ${message}\n`);
  }

  /**
   * Log error message to stderr
   */
  private logError(message: string, err: unknown): void {
    const timestamp = new Date().toISOString();
    const errorStr = err instanceof Error ? `${err.message}\n${err.stack}` : String(err);
    this.stderr.write(`[${timestamp}] ERROR: ${message}: ${errorStr}\n`);
  }

  /**
   * Log debug message to stderr (only if debug enabled)
   */
  private logDebug(message: string): void {
    if (this.debug) {
      const timestamp = new Date().toISOString();
      this.stderr.write(`[${timestamp}] DEBUG: ${message}\n`);
    }
  }
}
