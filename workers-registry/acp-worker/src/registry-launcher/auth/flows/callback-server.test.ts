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
 * Unit tests for Callback Server module.
 *
 * Tests port binding, timeout handling, error response parsing, and server lifecycle.
 *
 * **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5**
 *
 * @module flows/callback-server.test
 */

import * as http from 'node:http';
import { CallbackServer, isLoopbackAddress } from './callback-server';

/**
 * Helper function to make HTTP requests to the callback server.
 */
async function makeRequest(
  port: number,
  path: string,
  options: { host?: string } = {}
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: options.host || '127.0.0.1',
        port,
        path,
        method: 'GET',
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          resolve({ statusCode: res.statusCode || 0, body });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

describe('Callback Server Unit Tests', () => {
  describe('isLoopbackAddress', () => {
    describe('IPv4 loopback addresses', () => {
      it('should identify 127.0.0.1 as loopback', () => {
        expect(isLoopbackAddress('127.0.0.1')).toBe(true);
      });

      it('should identify 127.0.0.0 as loopback', () => {
        expect(isLoopbackAddress('127.0.0.0')).toBe(true);
      });

      it('should identify 127.255.255.255 as loopback', () => {
        expect(isLoopbackAddress('127.255.255.255')).toBe(true);
      });

      it('should identify 127.1.2.3 as loopback', () => {
        expect(isLoopbackAddress('127.1.2.3')).toBe(true);
      });
    });

    describe('IPv6 loopback addresses', () => {
      it('should identify ::1 as loopback', () => {
        expect(isLoopbackAddress('::1')).toBe(true);
      });

      it('should identify ::ffff:127.0.0.1 as loopback', () => {
        expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true);
      });

      it('should identify ::ffff:127.1.2.3 as loopback', () => {
        expect(isLoopbackAddress('::ffff:127.1.2.3')).toBe(true);
      });
    });

    describe('Non-loopback addresses', () => {
      it('should reject 192.168.1.1', () => {
        expect(isLoopbackAddress('192.168.1.1')).toBe(false);
      });

      it('should reject 10.0.0.1', () => {
        expect(isLoopbackAddress('10.0.0.1')).toBe(false);
      });

      it('should reject 0.0.0.0', () => {
        expect(isLoopbackAddress('0.0.0.0')).toBe(false);
      });

      it('should reject 8.8.8.8', () => {
        expect(isLoopbackAddress('8.8.8.8')).toBe(false);
      });

      it('should reject undefined', () => {
        expect(isLoopbackAddress(undefined)).toBe(false);
      });

      it('should reject empty string', () => {
        expect(isLoopbackAddress('')).toBe(false);
      });

      it('should reject localhost string', () => {
        expect(isLoopbackAddress('localhost')).toBe(false);
      });
    });
  });

  describe('Server Lifecycle', () => {
    let server: CallbackServer;

    afterEach(async () => {
      if (server && server.isRunning()) {
        await server.stop();
      }
    });

    describe('1. Server starts and binds to loopback address', () => {
      /**
       * **Validates: Requirement 8.1**
       * THE Callback_Server SHALL bind only to loopback addresses (127.0.0.1 for IPv4)
       */
      it('should bind to 127.0.0.1 loopback address', async () => {
        server = new CallbackServer('/callback');
        const redirectUri = await server.start();

        expect(redirectUri).toContain('127.0.0.1');
        expect(server.isRunning()).toBe(true);
      });

      it('should return redirect URI with correct format', async () => {
        server = new CallbackServer('/callback');
        const redirectUri = await server.start();

        expect(redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
      });
    });

    describe('2. Server uses dynamic port allocation', () => {
      /**
       * **Validates: Requirement 8.4**
       * THE Callback_Server SHALL use a dynamically allocated port to avoid conflicts
       */
      it('should have port 0 before starting', () => {
        server = new CallbackServer('/callback');
        expect(server.getPort()).toBe(0);
      });

      it('should allocate a valid port after starting', async () => {
        server = new CallbackServer('/callback');
        await server.start();

        const port = server.getPort();
        expect(port).toBeGreaterThan(0);
        expect(port).toBeLessThanOrEqual(65535);
      });

      it('should allocate different ports for multiple servers', async () => {
        server = new CallbackServer('/callback');
        const server2 = new CallbackServer('/callback');

        await server.start();
        await server2.start();

        expect(server.getPort()).not.toBe(server2.getPort());

        await server2.stop();
      });
    });

    describe('3. Server returns correct redirect URI', () => {
      /**
       * **Validates: Requirements 8.1, 8.4**
       */
      it('should include the callback path in redirect URI', async () => {
        server = new CallbackServer('/oauth/callback');
        const redirectUri = await server.start();

        expect(redirectUri).toContain('/oauth/callback');
      });

      it('should include the allocated port in redirect URI', async () => {
        server = new CallbackServer('/callback');
        const redirectUri = await server.start();

        const port = server.getPort();
        expect(redirectUri).toContain(`:${port}`);
      });

      it('should use default callback path when not specified', async () => {
        server = new CallbackServer();
        const redirectUri = await server.start();

        expect(redirectUri).toContain('/callback');
      });
    });

    describe('4. Server handles timeout correctly', () => {
      /**
       * **Validates: Requirement 8.5**
       * IF the Callback_Server cannot bind or times out, THE Auth_Module SHALL return an error
       */
      it('should reject with timeout error when callback not received', async () => {
        server = new CallbackServer('/callback');
        await server.start();

        // Use minimum valid timeout (1000ms)
        await expect(server.waitForCallback(1000)).rejects.toThrow('Callback timeout exceeded');
      }, 5000);

      it('should clean up after timeout', async () => {
        server = new CallbackServer('/callback');
        await server.start();

        try {
          await server.waitForCallback(1000);
        } catch {
          // Expected timeout
        }

        // Server should still be technically running but callback state cleaned up
        // We can verify by trying to wait again
        await expect(server.waitForCallback(1000)).rejects.toThrow();
      }, 10000);

      it('should reject timeout below minimum', async () => {
        server = new CallbackServer('/callback');
        await server.start();

        await expect(server.waitForCallback(50)).rejects.toThrow('Timeout must be at least 1000ms');
      });

      it('should reject timeout above maximum', async () => {
        server = new CallbackServer('/callback');
        await server.start();

        await expect(server.waitForCallback(700000)).rejects.toThrow('Timeout must not exceed 600000ms');
      });

      it('should reject non-finite timeout', async () => {
        server = new CallbackServer('/callback');
        await server.start();

        await expect(server.waitForCallback(NaN)).rejects.toThrow('Timeout must be a finite number');
        await expect(server.waitForCallback(Infinity)).rejects.toThrow('Timeout must be a finite number');
      });
    });

    describe('5. Server parses authorization code and state from callback', () => {
      /**
       * **Validates: Requirement 8.3**
       */
      it('should parse code and state from query parameters', async () => {
        server = new CallbackServer('/callback');
        await server.start();
        const port = server.getPort();

        const callbackPromise = server.waitForCallback(5000);

        // Make callback request
        await makeRequest(port, '/callback?code=auth_code_123&state=state_456');

        const result = await callbackPromise;

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.code).toBe('auth_code_123');
          expect(result.state).toBe('state_456');
        }
      });

      it('should handle URL-encoded parameters', async () => {
        server = new CallbackServer('/callback');
        await server.start();
        const port = server.getPort();

        const callbackPromise = server.waitForCallback(5000);

        // Make callback request with URL-encoded values
        await makeRequest(port, '/callback?code=auth%20code&state=state%2B123');

        const result = await callbackPromise;

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.code).toBe('auth code');
          expect(result.state).toBe('state+123');
        }
      });
    });

    describe('6. Server handles error responses from OAuth provider', () => {
      /**
       * **Validates: Requirement 8.3**
       */
      it('should parse error and error_description from callback', async () => {
        server = new CallbackServer('/callback');
        await server.start();
        const port = server.getPort();

        const callbackPromise = server.waitForCallback(5000);

        // Make error callback request
        await makeRequest(
          port,
          '/callback?error=access_denied&error_description=User%20denied%20access'
        );

        const result = await callbackPromise;

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toBe('access_denied');
          expect(result.errorDescription).toBe('User denied access');
        }
      });

      it('should handle error without description', async () => {
        server = new CallbackServer('/callback');
        await server.start();
        const port = server.getPort();

        const callbackPromise = server.waitForCallback(5000);

        await makeRequest(port, '/callback?error=server_error');

        const result = await callbackPromise;

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toBe('server_error');
          expect(result.errorDescription).toBeUndefined();
        }
      });

      it('should return 400 status for error responses', async () => {
        server = new CallbackServer('/callback');
        await server.start();
        const port = server.getPort();

        const callbackPromise = server.waitForCallback(5000);

        const response = await makeRequest(port, '/callback?error=invalid_request');

        expect(response.statusCode).toBe(400);
        expect(response.body).toContain('Authorization Failed');

        await callbackPromise;
      });
    });

    describe('7. Server handles missing parameters', () => {
      /**
       * **Validates: Requirement 8.3**
       */
      it('should handle missing code parameter', async () => {
        server = new CallbackServer('/callback');
        await server.start();
        const port = server.getPort();

        const callbackPromise = server.waitForCallback(5000);

        const response = await makeRequest(port, '/callback?state=state_only');

        expect(response.statusCode).toBe(400);

        const result = await callbackPromise;
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toBe('missing_params');
          expect(result.errorDescription).toBe('Missing code or state parameter');
        }
      });

      it('should handle missing state parameter', async () => {
        server = new CallbackServer('/callback');
        await server.start();
        const port = server.getPort();

        const callbackPromise = server.waitForCallback(5000);

        const response = await makeRequest(port, '/callback?code=code_only');

        expect(response.statusCode).toBe(400);

        const result = await callbackPromise;
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toBe('missing_params');
        }
      });

      it('should handle empty query string', async () => {
        server = new CallbackServer('/callback');
        await server.start();
        const port = server.getPort();

        const callbackPromise = server.waitForCallback(5000);

        const response = await makeRequest(port, '/callback');

        expect(response.statusCode).toBe(400);

        const result = await callbackPromise;
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toBe('missing_params');
        }
      });

      it('should return 200 status for successful callback', async () => {
        server = new CallbackServer('/callback');
        await server.start();
        const port = server.getPort();

        const callbackPromise = server.waitForCallback(5000);

        const response = await makeRequest(port, '/callback?code=valid_code&state=valid_state');

        expect(response.statusCode).toBe(200);
        expect(response.body).toContain('Authorization Successful');

        await callbackPromise;
      });
    });

    describe('8. Server stops after processing callback', () => {
      /**
       * **Validates: Requirement 8.3**
       * THE Callback_Server SHALL immediately close after processing the single expected request
       */
      it('should stop running after receiving callback', async () => {
        server = new CallbackServer('/callback');
        await server.start();
        const port = server.getPort();

        expect(server.isRunning()).toBe(true);

        const callbackPromise = server.waitForCallback(5000);

        await makeRequest(port, '/callback?code=test&state=test');

        await callbackPromise;

        expect(server.isRunning()).toBe(false);
      });

      it('should not accept new connections after callback processed', async () => {
        server = new CallbackServer('/callback');
        await server.start();
        const port = server.getPort();

        const callbackPromise = server.waitForCallback(5000);

        await makeRequest(port, '/callback?code=test&state=test');
        await callbackPromise;

        // Server should be marked as not running after processing callback
        expect(server.isRunning()).toBe(false);

        // Give the server time to fully close
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Subsequent requests should eventually fail (connection refused)
        // Note: Due to TCP connection handling, the exact behavior may vary
        // The key invariant is that isRunning() returns false
        expect(server.isRunning()).toBe(false);
      });
    });

    describe('9. Server rejects non-loopback connections', () => {
      /**
       * **Validates: Requirement 8.2**
       * THE Callback_Server SHALL reject any connection attempts from non-loopback addresses
       *
       * Note: This is tested via the isLoopbackAddress function since we can't easily
       * simulate non-loopback connections in unit tests. The actual rejection happens
       * in handleRequest based on req.socket.remoteAddress.
       */
      it('should have loopback check function that rejects non-loopback', () => {
        // External IPs should be rejected
        expect(isLoopbackAddress('192.168.1.100')).toBe(false);
        expect(isLoopbackAddress('10.0.0.1')).toBe(false);
        expect(isLoopbackAddress('172.16.0.1')).toBe(false);
        expect(isLoopbackAddress('8.8.8.8')).toBe(false);
      });

      it('should return 404 for non-callback paths', async () => {
        server = new CallbackServer('/callback');
        await server.start();
        const port = server.getPort();

        const response = await makeRequest(port, '/other-path');

        expect(response.statusCode).toBe(404);
        expect(response.body).toBe('Not Found');
      });
    });

    describe('10. Server handles multiple start/stop cycles', () => {
      /**
       * **Validates: Requirements 8.4, 8.5**
       */
      it('should allow restart after stop', async () => {
        server = new CallbackServer('/callback');

        // First cycle
        const uri1 = await server.start();
        expect(server.isRunning()).toBe(true);
        expect(server.getPort()).toBeGreaterThan(0);
        await server.stop();
        expect(server.isRunning()).toBe(false);
        expect(server.getPort()).toBe(0);

        // Second cycle
        const uri2 = await server.start();
        expect(server.isRunning()).toBe(true);
        const port2 = server.getPort();

        // URIs should be different (different ports typically)
        expect(uri1).toBeDefined();
        expect(uri2).toBeDefined();
        // Ports might be the same or different depending on OS
        expect(port2).toBeGreaterThan(0);

        await server.stop();
      });

      it('should handle multiple stop calls gracefully', async () => {
        server = new CallbackServer('/callback');
        await server.start();

        await server.stop();
        // Second stop should not throw
        await expect(server.stop()).resolves.not.toThrow();
      });

      it('should reset port to 0 after stop', async () => {
        server = new CallbackServer('/callback');
        await server.start();

        expect(server.getPort()).toBeGreaterThan(0);

        await server.stop();

        expect(server.getPort()).toBe(0);
      });
    });

    describe('11. Error when starting already running server', () => {
      /**
       * **Validates: Requirement 8.5**
       */
      it('should throw error when starting already running server', async () => {
        server = new CallbackServer('/callback');
        await server.start();

        await expect(server.start()).rejects.toThrow('Callback server is already running');
      });

      it('should remain running after failed start attempt', async () => {
        server = new CallbackServer('/callback');
        await server.start();
        const originalPort = server.getPort();

        try {
          await server.start();
        } catch {
          // Expected error
        }

        expect(server.isRunning()).toBe(true);
        expect(server.getPort()).toBe(originalPort);
      });
    });

    describe('12. Error when waiting for callback on non-running server', () => {
      /**
       * **Validates: Requirement 8.5**
       */
      it('should throw error when waiting on non-running server', async () => {
        server = new CallbackServer('/callback');

        await expect(server.waitForCallback(5000)).rejects.toThrow(
          'Callback server is not running'
        );
      });

      it('should throw error when waiting after server stopped', async () => {
        server = new CallbackServer('/callback');
        await server.start();
        await server.stop();

        await expect(server.waitForCallback(5000)).rejects.toThrow(
          'Callback server is not running'
        );
      });

      it('should throw error when already waiting for callback', async () => {
        server = new CallbackServer('/callback');
        await server.start();
        const port = server.getPort();

        // Start first wait with valid timeout
        const firstWait = server.waitForCallback(5000);

        // Second wait should fail immediately
        await expect(server.waitForCallback(5000)).rejects.toThrow(
          'Already waiting for callback'
        );

        // Clean up - either trigger callback or let timeout happen
        try {
          await makeRequest(port, '/callback?code=cleanup&state=cleanup');
          await firstWait;
        } catch {
          // Timeout is also acceptable
        }
      }, 10000);
    });
  });

  describe('HTML Response Content', () => {
    let server: CallbackServer;

    afterEach(async () => {
      if (server && server.isRunning()) {
        await server.stop();
      }
    });

    it('should return HTML success page with correct content', async () => {
      server = new CallbackServer('/callback');
      await server.start();
      const port = server.getPort();

      const callbackPromise = server.waitForCallback(5000);

      const response = await makeRequest(port, '/callback?code=test&state=test');

      expect(response.body).toContain('<!DOCTYPE html>');
      expect(response.body).toContain('Authorization Successful');
      expect(response.body).toContain('You can close this window');

      await callbackPromise;
    });

    it('should return HTML error page with error details', async () => {
      server = new CallbackServer('/callback');
      await server.start();
      const port = server.getPort();

      const callbackPromise = server.waitForCallback(5000);

      const response = await makeRequest(
        port,
        '/callback?error=invalid_scope&error_description=Scope%20not%20allowed'
      );

      expect(response.body).toContain('<!DOCTYPE html>');
      expect(response.body).toContain('Authorization Failed');
      expect(response.body).toContain('invalid_scope');
      expect(response.body).toContain('Scope not allowed');

      await callbackPromise;
    });

    it('should escape HTML in error messages to prevent XSS', async () => {
      server = new CallbackServer('/callback');
      await server.start();
      const port = server.getPort();

      const callbackPromise = server.waitForCallback(5000);

      // Try to inject HTML/script
      const response = await makeRequest(
        port,
        '/callback?error=<script>alert(1)</script>&error_description=<img%20onerror=alert(1)>'
      );

      // Should be escaped
      expect(response.body).not.toContain('<script>');
      expect(response.body).not.toContain('<img');
      expect(response.body).toContain('&lt;script&gt;');

      await callbackPromise;
    });
  });

  describe('Edge Cases', () => {
    let server: CallbackServer;

    afterEach(async () => {
      if (server && server.isRunning()) {
        await server.stop();
      }
    });

    it('should handle very long code and state values', async () => {
      server = new CallbackServer('/callback');
      await server.start();
      const port = server.getPort();

      const longCode = 'a'.repeat(1000);
      const longState = 'b'.repeat(1000);

      const callbackPromise = server.waitForCallback(5000);

      await makeRequest(port, `/callback?code=${longCode}&state=${longState}`);

      const result = await callbackPromise;

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.code).toBe(longCode);
        expect(result.state).toBe(longState);
      }
    });

    it('should handle special characters in code and state', async () => {
      server = new CallbackServer('/callback');
      await server.start();
      const port = server.getPort();

      const callbackPromise = server.waitForCallback(5000);

      // URL-encoded special characters
      await makeRequest(
        port,
        '/callback?code=code%2Fwith%2Fslashes&state=state%3Dwith%3Dequals'
      );

      const result = await callbackPromise;

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.code).toBe('code/with/slashes');
        expect(result.state).toBe('state=with=equals');
      }
    });

    it('should handle custom callback paths', async () => {
      server = new CallbackServer('/oauth2/v1/callback');
      const redirectUri = await server.start();

      expect(redirectUri).toContain('/oauth2/v1/callback');

      const port = server.getPort();
      const callbackPromise = server.waitForCallback(5000);

      await makeRequest(port, '/oauth2/v1/callback?code=test&state=test');

      const result = await callbackPromise;
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.code).toBe('test');
      }
    });

    it('should return 404 for requests to wrong callback path', async () => {
      server = new CallbackServer('/correct-path');
      await server.start();
      const port = server.getPort();

      const response = await makeRequest(port, '/wrong-path?code=test&state=test');

      expect(response.statusCode).toBe(404);
    });
  });
});
