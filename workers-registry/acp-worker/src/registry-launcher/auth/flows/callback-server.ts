/*
 * Apache License 2.0
 * Copyright (c) 2025–present Raman Marozau, Target Insight Function.
 * Contact: raman@worktif.com
 *
 * This file is part of the stdio bus protocol reference implementation:
 *   stdio_bus_kernel_workers (target: <target_stdio_bus_kernel_workers>).
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Loopback HTTP server for OAuth callbacks.
 *
 * @module flows/callback-server
 */

import * as http from 'node:http';
import { URL } from 'node:url';
import type { CallbackResult } from '../types.js';

/**
 * Loopback HTTP server for OAuth callbacks.
 */
export interface ICallbackServer {
  /** Start the server and return the redirect URI */
  start(): Promise<string>;

  /** Wait for the authorization callback */
  waitForCallback(timeoutMs: number): Promise<CallbackResult>;

  /** Stop the server and clean up resources */
  stop(): Promise<void>;

  /** Get the current server port (0 if not started) */
  getPort(): number;

  /** Check if server is running */
  isRunning(): boolean;
}

/**
 * Default callback path for OAuth redirects.
 */
const DEFAULT_CALLBACK_PATH = '/callback';

/**
 * Loopback address for binding the server (IPv4).
 */
const LOOPBACK_HOST_IPV4 = '127.0.0.1';

/**
 * Maximum URL length to prevent memory abuse (8KB).
 */
const MAX_URL_LENGTH = 8192;

/**
 * Maximum header size to prevent memory abuse (8KB).
 */
const MAX_HEADER_SIZE = 8192;

/**
 * Security response headers for browser-facing responses.
 */
const SECURITY_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-store',
  'Pragma': 'no-cache',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
};

/**
 * Check if an address is a loopback address.
 * Supports both IPv4 (127.x.x.x) and IPv6 (::1) loopback addresses.
 *
 * @param address - The IP address to check
 * @returns True if the address is a loopback address
 */
export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) {
    return false;
  }

  // IPv4 loopback: 127.0.0.0/8 (any address starting with 127.)
  if (address.startsWith('127.')) {
    return true;
  }

  // IPv6 loopback: ::1
  if (address === '::1') {
    return true;
  }

  // IPv4-mapped IPv6 loopback: ::ffff:127.x.x.x
  if (address.startsWith('::ffff:127.')) {
    return true;
  }

  return false;
}

/**
 * Validate the Host header against allowed loopback hosts.
 * Prevents DNS rebinding and host confusion attacks.
 *
 * @param hostHeader - The Host header value from the request
 * @param expectedPort - The expected port number
 * @returns True if the Host header is valid
 */
export function isValidHostHeader(hostHeader: string | undefined, expectedPort: number): boolean {
  if (!hostHeader) {
    return false;
  }

  // Allowed host patterns for loopback
  const allowedHosts = [
    `127.0.0.1:${expectedPort}`,
    `localhost:${expectedPort}`,
    `[::1]:${expectedPort}`,
  ];

  return allowedHosts.includes(hostHeader.toLowerCase());
}

/**
 * Check if a query parameter appears multiple times (potential injection).
 *
 * @param url - The parsed URL object
 * @param paramName - The parameter name to check
 * @returns True if the parameter appears more than once
 */
function hasDuplicateParam(url: URL, paramName: string): boolean {
  return url.searchParams.getAll(paramName).length > 1;
}


/**
 * Callback server implementation.
 * Creates an HTTP server on a loopback address with dynamic port allocation
 * to receive OAuth authorization callbacks.
 *
 * @implements {ICallbackServer}
 */
export class CallbackServer implements ICallbackServer {
  private server: http.Server | null = null;
  private port = 0;
  private running = false;
  private callbackPath: string;
  private callbackPromise: Promise<CallbackResult> | null = null;
  private callbackResolve: ((result: CallbackResult) => void) | null = null;
  private callbackReject: ((error: Error) => void) | null = null;
  private timeoutId: NodeJS.Timeout | null = null;
  private callbackHandled = false; // One-shot guard to prevent multiple callbacks

  /** Minimum timeout in milliseconds (1 second) */
  private static readonly MIN_TIMEOUT_MS = 1000;
  /** Maximum timeout in milliseconds (10 minutes) */
  private static readonly MAX_TIMEOUT_MS = 600000;

  /**
   * Creates a new CallbackServer instance.
   * @param callbackPath - The path to listen for callbacks (default: '/callback')
   */
  constructor(callbackPath: string = DEFAULT_CALLBACK_PATH) {
    this.callbackPath = callbackPath;
  }

  /**
   * Start the server and return the redirect URI.
   * The server binds to a loopback address (127.0.0.1) with a dynamically allocated port.
   *
   * @returns The redirect URI to use for OAuth callbacks
   * @throws Error if the server is already running or fails to start
   */
  async start(): Promise<string> {
    if (this.running) {
      throw new Error('Callback server is already running');
    }

    return new Promise<string>((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      // Handle server errors
      this.server.on('error', (error) => {
        this.running = false;
        reject(new Error(`Failed to start callback server: ${error.message}`));
      });

      // Bind to loopback address with dynamic port (port 0)
      this.server.listen(0, LOOPBACK_HOST_IPV4, () => {
        const address = this.server?.address();
        if (address && typeof address === 'object') {
          this.port = address.port;
          this.running = true;
          const redirectUri = `http://${LOOPBACK_HOST_IPV4}:${this.port}${this.callbackPath}`;
          resolve(redirectUri);
        } else {
          reject(new Error('Failed to get server address'));
        }
      });
    });
  }

  /**
   * Wait for the authorization callback.
   * Returns when a callback is received or the timeout is reached.
   *
   * @param timeoutMs - Maximum time to wait for the callback in milliseconds
   * @returns The callback result containing the authorization code and state
   * @throws Error if the server is not running, timeout is reached, or callback fails
   */
  async waitForCallback(timeoutMs: number): Promise<CallbackResult> {
    if (!this.running) {
      throw new Error('Callback server is not running');
    }

    if (this.callbackPromise) {
      throw new Error('Already waiting for callback');
    }

    // Validate timeout parameter
    if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs)) {
      throw new Error('Timeout must be a finite number');
    }
    if (timeoutMs < CallbackServer.MIN_TIMEOUT_MS) {
      throw new Error(`Timeout must be at least ${CallbackServer.MIN_TIMEOUT_MS}ms`);
    }
    if (timeoutMs > CallbackServer.MAX_TIMEOUT_MS) {
      throw new Error(`Timeout must not exceed ${CallbackServer.MAX_TIMEOUT_MS}ms`);
    }

    // Reset one-shot guard for new wait
    this.callbackHandled = false;

    this.callbackPromise = new Promise<CallbackResult>((resolve, reject) => {
      this.callbackResolve = resolve;
      this.callbackReject = reject;

      // Set up timeout
      this.timeoutId = setTimeout(() => {
        this.callbackReject?.(new Error('Callback timeout exceeded'));
        this.cleanup();
      }, timeoutMs);
    });

    try {
      return await this.callbackPromise;
    } finally {
      this.callbackPromise = null;
    }
  }

  /**
   * Stop the server and clean up resources.
   */
  async stop(): Promise<void> {
    this.cleanup();

    if (this.server) {
      return new Promise<void>((resolve, reject) => {
        this.server?.close((error) => {
          // Ignore "Server is not running" errors if already closed by stopAcceptingConnections
          if (error && !error.message.includes('Server is not running')) {
            reject(new Error(`Failed to stop callback server: ${error.message}`));
          } else {
            this.server = null;
            this.port = 0;
            this.running = false;
            resolve();
          }
        });
      });
    }
  }

  /**
   * Get the current server port.
   * @returns The port number, or 0 if the server is not started
   */
  getPort(): number {
    return this.port;
  }

  /**
   * Check if the server is running.
   * @returns True if the server is running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Handle incoming HTTP requests.
   * Parses the callback URL and extracts the authorization code and state.
   * Rejects connections from non-loopback addresses for security.
   */
  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    // Security: Only accept GET requests (Requirement 8.2)
    if (req.method !== 'GET') {
      this.sendErrorResponse(res, 405, 'Method Not Allowed', 'Only GET requests are accepted');
      return;
    }

    // Security: Reject connections from non-loopback addresses (Requirement 8.2)
    const remoteAddress = req.socket.remoteAddress;
    if (!isLoopbackAddress(remoteAddress)) {
      this.sendErrorResponse(res, 403, 'Forbidden', 'Only loopback connections are allowed');
      return;
    }

    // Security: Validate Host header to prevent DNS rebinding attacks (Requirement 8.2)
    const hostHeader = req.headers.host;
    if (!isValidHostHeader(hostHeader, this.port)) {
      this.sendErrorResponse(res, 400, 'Bad Request', 'Invalid Host header');
      return;
    }

    // Security: Enforce max URL length to prevent memory abuse
    const rawUrl = req.url || '/';
    if (rawUrl.length > MAX_URL_LENGTH) {
      this.sendErrorResponse(res, 414, 'URI Too Long', 'Request URL exceeds maximum length');
      return;
    }

    // Security: Check total header size
    const headerSize = Object.entries(req.headers).reduce(
      (sum, [key, value]) => sum + key.length + (Array.isArray(value) ? value.join('').length : (value?.length || 0)),
      0
    );
    if (headerSize > MAX_HEADER_SIZE) {
      this.sendErrorResponse(res, 431, 'Request Header Fields Too Large', 'Headers exceed maximum size');
      return;
    }

    let url: URL;
    try {
      url = new URL(rawUrl, `http://${LOOPBACK_HOST_IPV4}:${this.port}`);
    } catch {
      this.sendErrorResponse(res, 400, 'Bad Request', 'Invalid URL format');
      return;
    }

    // Only handle requests to the callback path
    if (url.pathname !== this.callbackPath) {
      this.sendErrorResponse(res, 404, 'Not Found', 'Invalid callback path');
      return;
    }

    // One-shot guard: reject duplicate callbacks (Requirement 8.3)
    if (this.callbackHandled) {
      this.sendErrorResponse(res, 409, 'Conflict', 'Callback already processed');
      return;
    }

    // Security: Reject duplicate query parameters (potential injection)
    const sensitiveParams = ['code', 'state', 'error', 'error_description'];
    for (const param of sensitiveParams) {
      if (hasDuplicateParam(url, param)) {
        this.sendErrorResponse(res, 400, 'Bad Request', `Duplicate parameter: ${param}`);
        return;
      }
    }

    // Mark callback as handled atomically before any processing
    this.callbackHandled = true;

    // Parse query parameters
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');
    const errorDescription = url.searchParams.get('error_description');

    // Build callback result based on whether it's success or error
    let result: CallbackResult;

    try {
      // Send response to browser
      if (error) {
        // OAuth error response - state is optional in error responses
        result = {
          success: false,
          error: error,
          errorDescription: errorDescription || undefined,
          state: state || undefined,
        };
        this.sendHtmlResponse(res, 400, this.buildErrorPage(error, errorDescription));
      } else if (code && state) {
        // Successful authorization - both code and state are required
        result = {
          success: true,
          code: code,
          state: state,
        };
        this.sendHtmlResponse(res, 200, this.buildSuccessPage());
      } else {
        // Missing required parameters
        result = {
          success: false,
          error: 'missing_params',
          errorDescription: 'Missing code or state parameter',
          state: state || undefined,
        };
        this.sendHtmlResponse(res, 400, this.buildErrorPage('missing_params', 'Missing code or state parameter'));
      }

      // Resolve the callback promise and stop accepting new connections (Requirement 8.3)
      if (this.callbackResolve) {
        this.callbackResolve(result);
      }
    } finally {
      // Always cleanup and stop accepting connections, even on exceptions
      this.cleanup();
      this.stopAcceptingConnections();
    }
  }

  /**
   * Send an error response with security headers.
   */
  private sendErrorResponse(res: http.ServerResponse, statusCode: number, _statusMessage: string, body: string): void {
    res.writeHead(statusCode, {
      'Content-Type': 'text/plain',
      ...SECURITY_HEADERS,
    });
    res.end(body);
  }

  /**
   * Send an HTML response with security headers.
   */
  private sendHtmlResponse(res: http.ServerResponse, statusCode: number, html: string): void {
    res.writeHead(statusCode, {
      'Content-Type': 'text/html; charset=utf-8',
      ...SECURITY_HEADERS,
    });
    res.end(html);
  }

  /**
   * Stop accepting new connections without fully closing the server.
   * This ensures the server stops accepting new requests after processing the callback
   * while allowing the current response to complete.
   * 
   * @remarks
   * This implements Requirement 8.3: The Callback_Server SHALL immediately close
   * after processing the single expected request.
   */
  private stopAcceptingConnections(): void {
    if (this.server) {
      // Close the server to stop accepting new connections
      // This allows existing connections to finish but rejects new ones
      this.server.close();
      this.running = false;
    }
  }

  /**
   * Clean up timeout and callback state.
   */
  private cleanup(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    this.callbackResolve = null;
    this.callbackReject = null;
  }

  /**
   * Build a success HTML page to display in the browser.
   */
  private buildSuccessPage(): string {
    return `<!DOCTYPE html>
<html>
<head>
  <title>Authorization Successful</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
           display: flex; justify-content: center; align-items: center; height: 100vh; 
           margin: 0; background: #f5f5f5; }
    .container { text-align: center; padding: 40px; background: white; 
                 border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    h1 { color: #22c55e; margin-bottom: 16px; }
    p { color: #666; }
  </style>
</head>
<body>
  <div class="container">
    <h1>✓ Authorization Successful</h1>
    <p>You can close this window and return to the application.</p>
  </div>
</body>
</html>`;
  }

  /**
   * Build an error HTML page to display in the browser.
   */
  private buildErrorPage(error: string, description?: string | null): string {
    const safeError = this.escapeHtml(error);
    const safeDescription = description ? this.escapeHtml(description) : 'An error occurred during authorization.';

    return `<!DOCTYPE html>
<html>
<head>
  <title>Authorization Failed</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
           display: flex; justify-content: center; align-items: center; height: 100vh; 
           margin: 0; background: #f5f5f5; }
    .container { text-align: center; padding: 40px; background: white; 
                 border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    h1 { color: #ef4444; margin-bottom: 16px; }
    p { color: #666; }
    .error-code { font-family: monospace; background: #f5f5f5; padding: 4px 8px; 
                  border-radius: 4px; color: #333; }
  </style>
</head>
<body>
  <div class="container">
    <h1>✗ Authorization Failed</h1>
    <p>${safeDescription}</p>
    <p>Error code: <span class="error-code">${safeError}</span></p>
  </div>
</body>
</html>`;
  }

  /**
   * Escape HTML special characters to prevent XSS.
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
