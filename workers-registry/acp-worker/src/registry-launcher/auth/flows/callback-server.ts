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
    // Security: Reject connections from non-loopback addresses (Requirement 8.2)
    const remoteAddress = req.socket.remoteAddress;
    if (!isLoopbackAddress(remoteAddress)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden: Only loopback connections are allowed');
      return;
    }

    const url = new URL(req.url || '/', `http://${LOOPBACK_HOST_IPV4}:${this.port}`);

    // Only handle requests to the callback path
    if (url.pathname !== this.callbackPath) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }

    // Parse query parameters
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');
    const errorDescription = url.searchParams.get('error_description');

    // Build callback result
    const result: CallbackResult = {
      code: code || '',
      state: state || '',
      error: error || undefined,
      errorDescription: errorDescription || undefined,
    };

    // Send response to browser
    if (error) {
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end(this.buildErrorPage(error, errorDescription));
    } else if (code && state) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(this.buildSuccessPage());
    } else {
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end(this.buildErrorPage('missing_params', 'Missing code or state parameter'));
      result.error = 'missing_params';
      result.errorDescription = 'Missing code or state parameter';
    }

    // Resolve the callback promise and stop accepting new connections (Requirement 8.3)
    if (this.callbackResolve) {
      this.callbackResolve(result);
      this.cleanup();
      // Immediately stop accepting new connections after processing the single expected request
      this.stopAcceptingConnections();
    }
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
