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
 * Property-based tests for Callback Server module.
 *
 * Feature: oauth-authentication
 * Properties 9, 18, 19: Callback Server Loopback Binding, Single-Request Lifecycle, Dynamic Port
 *
 * @module flows/callback-server.property.test
 */

import * as fc from 'fast-check';
import { isLoopbackAddress, CallbackServer } from './callback-server';

describe('Callback Server Property Tests', () => {
  /**
   * Feature: oauth-authentication, Property 9: Callback Server Loopback Binding
   *
   * *For any* started callback server, the server SHALL bind only to loopback addresses
   * (127.0.0.1 or ::1) and SHALL reject connection attempts from non-loopback addresses.
   *
   * This property tests the isLoopbackAddress function with various IP addresses to verify
   * it correctly identifies loopback addresses.
   *
   * **Validates: Requirements 3.3, 8.1, 8.2**
   */
  describe('Property 9: Callback Server Loopback Binding', () => {
    test('IPv4 loopback addresses (127.x.x.x) are correctly identified', () => {
      fc.assert(
        fc.property(
          // Generate any valid IPv4 address in the 127.0.0.0/8 range
          fc.integer({ min: 0, max: 255 }),
          fc.integer({ min: 0, max: 255 }),
          fc.integer({ min: 0, max: 255 }),
          (octet2, octet3, octet4) => {
            const address = `127.${octet2}.${octet3}.${octet4}`;
            expect(isLoopbackAddress(address)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('IPv6 loopback address (::1) is correctly identified', () => {
      fc.assert(
        fc.property(
          fc.constant('::1'),
          (address) => {
            expect(isLoopbackAddress(address)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('IPv4-mapped IPv6 loopback addresses (::ffff:127.x.x.x) are correctly identified', () => {
      fc.assert(
        fc.property(
          // Generate any valid IPv4-mapped IPv6 loopback address
          fc.integer({ min: 0, max: 255 }),
          fc.integer({ min: 0, max: 255 }),
          fc.integer({ min: 0, max: 255 }),
          (octet2, octet3, octet4) => {
            const address = `::ffff:127.${octet2}.${octet3}.${octet4}`;
            expect(isLoopbackAddress(address)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('non-loopback IPv4 addresses are correctly rejected', () => {
      fc.assert(
        fc.property(
          // Generate IPv4 addresses that don't start with 127
          fc.integer({ min: 0, max: 126 }), // First octet 0-126
          fc.integer({ min: 0, max: 255 }),
          fc.integer({ min: 0, max: 255 }),
          fc.integer({ min: 0, max: 255 }),
          (octet1, octet2, octet3, octet4) => {
            const address = `${octet1}.${octet2}.${octet3}.${octet4}`;
            expect(isLoopbackAddress(address)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('non-loopback IPv4 addresses with first octet > 127 are correctly rejected', () => {
      fc.assert(
        fc.property(
          // Generate IPv4 addresses with first octet 128-255
          fc.integer({ min: 128, max: 255 }),
          fc.integer({ min: 0, max: 255 }),
          fc.integer({ min: 0, max: 255 }),
          fc.integer({ min: 0, max: 255 }),
          (octet1, octet2, octet3, octet4) => {
            const address = `${octet1}.${octet2}.${octet3}.${octet4}`;
            expect(isLoopbackAddress(address)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('non-loopback IPv6 addresses are correctly rejected', () => {
      fc.assert(
        fc.property(
          // Generate random IPv6 addresses that are not ::1
          fc.hexaString({ minLength: 1, maxLength: 4 }),
          fc.hexaString({ minLength: 1, maxLength: 4 }),
          fc.hexaString({ minLength: 1, maxLength: 4 }),
          fc.hexaString({ minLength: 1, maxLength: 4 }),
          (seg1, seg2, seg3, seg4) => {
            // Construct a non-loopback IPv6 address
            const address = `${seg1}:${seg2}:${seg3}:${seg4}::`;
            // Skip if it happens to be ::1 (extremely unlikely)
            if (address === '::1') {
              return;
            }
            expect(isLoopbackAddress(address)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('common non-loopback addresses are correctly rejected', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(
            '0.0.0.0',
            '192.168.1.1',
            '10.0.0.1',
            '172.16.0.1',
            '8.8.8.8',
            '255.255.255.255',
            '::',
            '::ffff:192.168.1.1',
            '::ffff:10.0.0.1',
            'fe80::1',
            '2001:db8::1',
            'fc00::1'
          ),
          (address) => {
            expect(isLoopbackAddress(address)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('undefined and empty addresses are correctly rejected', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(undefined, '', null as unknown as string),
          (address) => {
            expect(isLoopbackAddress(address)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('malformed addresses without loopback prefix are correctly rejected', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(
            'localhost',
            'loopback',
            '127',  // No dot after 127
            'not-an-ip',
            '999.999.999.999',
            '::1::1',
            '192.168.127.1',  // 127 not in first octet
            '1.127.0.1'  // 127 not in first octet
          ),
          (address) => {
            // These should not be identified as loopback
            // Note: '127' alone doesn't match '127.' prefix (requires the dot)
            expect(isLoopbackAddress(address)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('addresses starting with 127. prefix are identified as loopback', () => {
      fc.assert(
        fc.property(
          // Even malformed addresses starting with 127. are considered loopback
          // This is by design - the function uses prefix matching for security
          fc.constantFrom(
            '127.',
            '127.0',
            '127.0.0',
            '127.0.0.1.1',
            '127.anything'
          ),
          (address) => {
            // Addresses starting with '127.' are considered loopback by prefix matching
            expect(isLoopbackAddress(address)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('loopback identification is consistent across multiple calls', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            // Loopback addresses
            fc.tuple(
              fc.constant(127),
              fc.integer({ min: 0, max: 255 }),
              fc.integer({ min: 0, max: 255 }),
              fc.integer({ min: 0, max: 255 })
            ).map(([o1, o2, o3, o4]) => `${o1}.${o2}.${o3}.${o4}`),
            fc.constant('::1'),
            // Non-loopback addresses
            fc.tuple(
              fc.integer({ min: 1, max: 126 }),
              fc.integer({ min: 0, max: 255 }),
              fc.integer({ min: 0, max: 255 }),
              fc.integer({ min: 0, max: 255 })
            ).map(([o1, o2, o3, o4]) => `${o1}.${o2}.${o3}.${o4}`)
          ),
          (address) => {
            // Call multiple times to verify consistency
            const result1 = isLoopbackAddress(address);
            const result2 = isLoopbackAddress(address);
            const result3 = isLoopbackAddress(address);

            expect(result1).toBe(result2);
            expect(result2).toBe(result3);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Feature: oauth-authentication, Property 18: Callback Server Single-Request Lifecycle
   *
   * *For any* callback server that receives an authorization callback, the server SHALL
   * stop accepting new connections after processing the callback.
   *
   * **Validates: Requirements 8.3**
   */
  describe('Property 18: Callback Server Single-Request Lifecycle', () => {
    test('server stops running after receiving callback', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constant(undefined),
          async () => {
            const server = new CallbackServer('/callback');
            const redirectUri = await server.start();

            expect(server.isRunning()).toBe(true);
            expect(redirectUri).toContain('127.0.0.1');
            expect(redirectUri).toContain('/callback');

            // Simulate a callback by making an HTTP request
            const port = server.getPort();
            expect(port).toBeGreaterThan(0);

            // Start waiting for callback (with short timeout)
            const callbackPromise = server.waitForCallback(5000);

            // Make HTTP request to simulate OAuth callback
            const http = await import('node:http');
            await new Promise<void>((resolve, reject) => {
              const req = http.request(
                {
                  hostname: '127.0.0.1',
                  port: port,
                  path: '/callback?code=test_code&state=test_state',
                  method: 'GET',
                },
                (res) => {
                  res.on('data', () => { });
                  res.on('end', resolve);
                }
              );
              req.on('error', reject);
              req.end();
            });

            // Wait for callback to be processed
            const result = await callbackPromise;

            // Verify callback was received (discriminated union check)
            expect(result.success).toBe(true);
            if (result.success) {
              expect(result.code).toBe('test_code');
              expect(result.state).toBe('test_state');
            }

            // Server should no longer be running after processing callback
            expect(server.isRunning()).toBe(false);

            // Clean up
            await server.stop();
          }
        ),
        { numRuns: 10 } // Reduced iterations for async server tests
      );
    });
  });

  /**
   * Feature: oauth-authentication, Property 19: Callback Server Dynamic Port
   *
   * *For any* started callback server, the server SHALL use a dynamically allocated port
   * (not a hardcoded port).
   *
   * **Validates: Requirements 8.4**
   */
  describe('Property 19: Callback Server Dynamic Port', () => {
    test('server uses dynamically allocated port', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constant(undefined),
          async () => {
            const server = new CallbackServer('/callback');

            // Port should be 0 before starting
            expect(server.getPort()).toBe(0);

            const redirectUri = await server.start();

            // Port should be dynamically allocated (non-zero)
            const port = server.getPort();
            expect(port).toBeGreaterThan(0);
            expect(port).toBeLessThanOrEqual(65535);

            // Redirect URI should contain the allocated port
            expect(redirectUri).toContain(`:${port}`);

            await server.stop();
          }
        ),
        { numRuns: 10 } // Reduced iterations for async server tests
      );
    });

    test('multiple servers get different ports', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constant(undefined),
          async () => {
            const server1 = new CallbackServer('/callback');
            const server2 = new CallbackServer('/callback');

            await server1.start();
            await server2.start();

            const port1 = server1.getPort();
            const port2 = server2.getPort();

            // Both ports should be valid
            expect(port1).toBeGreaterThan(0);
            expect(port2).toBeGreaterThan(0);

            // Ports should be different (dynamic allocation)
            expect(port1).not.toBe(port2);

            await server1.stop();
            await server2.stop();
          }
        ),
        { numRuns: 10 } // Reduced iterations for async server tests
      );
    });

    test('server binds to loopback address with dynamic port', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constant(undefined),
          async () => {
            const server = new CallbackServer('/callback');
            const redirectUri = await server.start();

            // Verify the redirect URI uses loopback address
            expect(redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);

            // Verify port is in valid range
            const port = server.getPort();
            expect(port).toBeGreaterThan(0);
            expect(port).toBeLessThanOrEqual(65535);

            await server.stop();
          }
        ),
        { numRuns: 10 } // Reduced iterations for async server tests
      );
    });
  });
});
