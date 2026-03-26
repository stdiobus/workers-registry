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
 * Property-based tests for CLI commands.
 *
 * Feature: oauth-authentication
 * Properties 20-22: Logout Credential Removal, Selective Logout Isolation,
 *                   CLI Exit Code Success
 *
 * @module cli/cli.property.test
 */

import * as fc from 'fast-check';
import { Writable, Readable } from 'stream';
import type { AuthProviderId, StoredCredentials } from '../types.js';
import { VALID_PROVIDER_IDS } from '../types.js';
import type { ICredentialStore } from '../storage/types.js';

/**
 * Mock credential store for testing.
 * Tracks all operations for verification.
 */
class MockCredentialStore implements ICredentialStore {
  private credentials = new Map<AuthProviderId, StoredCredentials>();
  public deleteCallCount = 0;
  public deleteAllCallCount = 0;

  async store(providerId: AuthProviderId, credentials: StoredCredentials): Promise<void> {
    this.credentials.set(providerId, { ...credentials });
  }

  async retrieve(providerId: AuthProviderId): Promise<StoredCredentials | null> {
    const creds = this.credentials.get(providerId);
    return creds ? { ...creds } : null;
  }

  async delete(providerId: AuthProviderId): Promise<void> {
    this.deleteCallCount++;
    this.credentials.delete(providerId);
  }

  async deleteAll(): Promise<void> {
    this.deleteAllCallCount++;
    this.credentials.clear();
  }

  async listProviders(): Promise<AuthProviderId[]> {
    return Array.from(this.credentials.keys());
  }

  getBackendType(): 'memory' {
    return 'memory';
  }

  setCredentials(providerId: AuthProviderId, credentials: StoredCredentials): void {
    this.credentials.set(providerId, { ...credentials });
  }

  hasCredentials(providerId: AuthProviderId): boolean {
    return this.credentials.has(providerId);
  }

  getAllProviders(): AuthProviderId[] {
    return Array.from(this.credentials.keys());
  }

  reset(): void {
    this.credentials.clear();
    this.deleteCallCount = 0;
    this.deleteAllCallCount = 0;
  }
}

/**
 * Create a mock writable stream that captures output.
 */
function createMockOutput(): { stream: Writable; getOutput: () => string } {
  let output = '';
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      output += chunk.toString();
      callback();
    },
  });
  return {
    stream,
    getOutput: () => output,
  };
}

/**
 * Create a mock readable stream with predefined input.
 * Exported for potential use in other tests.
 */
export function createMockInput(lines: string[]): Readable {
  let index = 0;
  return new Readable({
    read() {
      if (index < lines.length) {
        this.push(lines[index] + '\n');
        index++;
      } else {
        this.push(null);
      }
    },
  });
}

// Suppress unused variable warning - kept for future test expansion
void createMockInput;

/**
 * Arbitrary generator for valid provider IDs.
 */
const providerIdArb = fc.constantFrom(...VALID_PROVIDER_IDS);

/**
 * Arbitrary generator for non-empty subsets of provider IDs.
 */
const providerSubsetArb = fc.subarray([...VALID_PROVIDER_IDS], { minLength: 1 });

/**
 * Arbitrary generator for stored credentials.
 * Exported for potential use in other tests.
 */
export const storedCredentialsArb = (providerId: AuthProviderId) =>
  fc.record({
    providerId: fc.constant(providerId),
    accessToken: fc.string({ minLength: 10, maxLength: 50 }),
    refreshToken: fc.option(fc.string({ minLength: 10, maxLength: 50 })),
    expiresAt: fc.option(fc.integer({ min: Date.now(), max: Date.now() + 86400000 })),
    scope: fc.option(fc.string({ minLength: 5, maxLength: 30 })),
    storedAt: fc.integer({ min: Date.now() - 86400000, max: Date.now() }),
  }) as fc.Arbitrary<StoredCredentials>;

// Suppress unused variable warning - kept for future test expansion
void storedCredentialsArb;


describe('CLI Property Tests', () => {
  /**
   * Feature: oauth-authentication, Property 20: Logout Credential Removal
   *
   * *For any* logout operation without a provider specified, all stored
   * credentials SHALL be removed from the credential store.
   *
   * **Validates: Requirements 9.3**
   */
  describe('Property 20: Logout Credential Removal', () => {
    test('logout without provider removes all credentials', async () => {
      await fc.assert(
        fc.asyncProperty(
          providerSubsetArb,
          async (configuredProviders) => {
            const credentialStore = new MockCredentialStore();
            const mockOutput = createMockOutput();

            // Set up credentials for all configured providers
            const now = Date.now();
            for (const providerId of configuredProviders) {
              credentialStore.setCredentials(providerId, {
                providerId,
                accessToken: `token-${providerId}`,
                storedAt: now,
              });
            }

            // Verify credentials are set up
            const beforeProviders = credentialStore.getAllProviders();
            expect(beforeProviders.length).toBe(configuredProviders.length);

            // Import and run logout command with mocked dependencies
            // We need to test the core logic, so we'll directly test the AuthManager
            const { AuthManager } = await import('../auth-manager.js');
            const { TokenManager } = await import('../token-manager.js');

            const tokenManager = new TokenManager({
              credentialStore,
              providerResolver: () => null,
            });

            const authManager = new AuthManager({
              credentialStore,
              tokenManager,
              legacyApiKeys: {},
            });

            // Execute logout without provider (should remove all)
            await authManager.logout();

            // Verify all credentials are removed
            const afterProviders = credentialStore.getAllProviders();
            expect(afterProviders.length).toBe(0);

            // Verify deleteAll was called
            expect(credentialStore.deleteAllCallCount).toBe(1);

            mockOutput.stream.end();
          }
        ),
        { numRuns: 100 }
      );
    });

    test('logout removes credentials for all provider types', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constant([...VALID_PROVIDER_IDS]), // All providers
          async (allProviders) => {
            const credentialStore = new MockCredentialStore();

            // Set up credentials for ALL providers
            const now = Date.now();
            for (const providerId of allProviders) {
              credentialStore.setCredentials(providerId, {
                providerId,
                accessToken: `token-${providerId}`,
                storedAt: now,
              });
            }

            // Verify all providers are configured
            expect(credentialStore.getAllProviders().length).toBe(VALID_PROVIDER_IDS.length);

            const { AuthManager } = await import('../auth-manager.js');
            const { TokenManager } = await import('../token-manager.js');

            const tokenManager = new TokenManager({
              credentialStore,
              providerResolver: () => null,
            });

            const authManager = new AuthManager({
              credentialStore,
              tokenManager,
              legacyApiKeys: {},
            });

            // Execute logout
            await authManager.logout();

            // Verify ALL credentials are removed
            for (const providerId of VALID_PROVIDER_IDS) {
              expect(credentialStore.hasCredentials(providerId)).toBe(false);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });


  /**
   * Feature: oauth-authentication, Property 21: Selective Logout Isolation
   *
   * *For any* logout operation for a specific provider, only that provider's
   * credentials SHALL be removed; other providers' credentials SHALL remain unchanged.
   *
   * **Validates: Requirements 9.4**
   */
  describe('Property 21: Selective Logout Isolation', () => {
    test('selective logout removes only specified provider credentials', async () => {
      await fc.assert(
        fc.asyncProperty(
          providerSubsetArb.filter(arr => arr.length >= 2), // Need at least 2 providers
          async (configuredProviders) => {
            const credentialStore = new MockCredentialStore();

            // Set up credentials for all configured providers
            const now = Date.now();
            for (const providerId of configuredProviders) {
              credentialStore.setCredentials(providerId, {
                providerId,
                accessToken: `token-${providerId}`,
                storedAt: now,
              });
            }

            // Pick one provider to logout
            const providerToLogout = configuredProviders[0];
            const remainingProviders = configuredProviders.slice(1);

            const { AuthManager } = await import('../auth-manager.js');
            const { TokenManager } = await import('../token-manager.js');

            const tokenManager = new TokenManager({
              credentialStore,
              providerResolver: () => null,
            });

            const authManager = new AuthManager({
              credentialStore,
              tokenManager,
              legacyApiKeys: {},
            });

            // Execute selective logout
            await authManager.logout(providerToLogout);

            // Verify only the specified provider's credentials are removed
            expect(credentialStore.hasCredentials(providerToLogout)).toBe(false);

            // Verify other providers' credentials remain
            for (const providerId of remainingProviders) {
              expect(credentialStore.hasCredentials(providerId)).toBe(true);
              const creds = await credentialStore.retrieve(providerId);
              expect(creds?.accessToken).toBe(`token-${providerId}`);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    test('selective logout does not affect unrelated providers', async () => {
      await fc.assert(
        fc.asyncProperty(
          providerIdArb,
          providerSubsetArb.filter(arr => arr.length >= 1),
          async (targetProvider, otherProviders) => {
            // Ensure target is not in other providers for meaningful test
            const filteredOthers = otherProviders.filter(p => p !== targetProvider);
            fc.pre(filteredOthers.length > 0);

            const credentialStore = new MockCredentialStore();

            // Set up credentials for target and other providers
            const now = Date.now();
            credentialStore.setCredentials(targetProvider, {
              providerId: targetProvider,
              accessToken: `token-${targetProvider}`,
              storedAt: now,
            });

            for (const providerId of filteredOthers) {
              credentialStore.setCredentials(providerId, {
                providerId,
                accessToken: `token-${providerId}`,
                storedAt: now,
              });
            }

            const { AuthManager } = await import('../auth-manager.js');
            const { TokenManager } = await import('../token-manager.js');

            const tokenManager = new TokenManager({
              credentialStore,
              providerResolver: () => null,
            });

            const authManager = new AuthManager({
              credentialStore,
              tokenManager,
              legacyApiKeys: {},
            });

            // Execute selective logout for target
            await authManager.logout(targetProvider);

            // Verify target is removed
            expect(credentialStore.hasCredentials(targetProvider)).toBe(false);

            // Verify all other providers are unchanged
            for (const providerId of filteredOthers) {
              expect(credentialStore.hasCredentials(providerId)).toBe(true);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });


  /**
   * Feature: oauth-authentication, Property 22: CLI Exit Code Success
   *
   * *For any* successfully completed auth CLI command (--setup, --auth-status, --logout),
   * the process SHALL exit with code 0.
   *
   * **Validates: Requirements 9.5**
   */
  describe('Property 22: CLI Exit Code Success', () => {
    test('status command returns exit code 0 on success', async () => {
      await fc.assert(
        fc.asyncProperty(
          providerSubsetArb,
          async (_configuredProviders) => {
            const mockOutput = createMockOutput();

            // Import the status command
            const { runStatusCommand } = await import('./status-command.js');

            // Run status command
            const exitCode = await runStatusCommand({ output: mockOutput.stream });

            // Verify exit code is 0
            expect(exitCode).toBe(0);

            mockOutput.stream.end();
          }
        ),
        { numRuns: 100 }
      );
    });

    test('logout command returns exit code 0 on success', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.option(providerIdArb),
          async (providerId) => {
            const mockOutput = createMockOutput();

            // Import the logout command
            const { runLogoutCommand } = await import('./logout-command.js');

            // Run logout command (with or without provider)
            const exitCode = await runLogoutCommand(
              providerId ?? undefined,
              { output: mockOutput.stream }
            );

            // Verify exit code is 0 (even if no credentials to remove)
            expect(exitCode).toBe(0);

            mockOutput.stream.end();
          }
        ),
        { numRuns: 100 }
      );
    }, 30000);  // Increased timeout for property test

    test('logout command returns exit code 0 even when no credentials exist', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.boolean(),
          async (useSpecificProvider) => {
            const mockOutput = createMockOutput();

            const { runLogoutCommand } = await import('./logout-command.js');

            // Run logout on empty credential store
            const providerId = useSpecificProvider ? 'github' : undefined;
            const exitCode = await runLogoutCommand(providerId, { output: mockOutput.stream });

            // Should still return 0 (nothing to do is not an error)
            expect(exitCode).toBe(0);

            mockOutput.stream.end();
          }
        ),
        { numRuns: 100 }
      );
    });

    test('logout command returns exit code 1 for invalid provider', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 20 }).filter(s =>
            !VALID_PROVIDER_IDS.includes(s as AuthProviderId) &&
            s.length > 0 &&
            !s.includes('\n')
          ),
          async (invalidProvider) => {
            const mockOutput = createMockOutput();

            const { runLogoutCommand } = await import('./logout-command.js');

            // Run logout with invalid provider
            const exitCode = await runLogoutCommand(
              invalidProvider as AuthProviderId,
              { output: mockOutput.stream }
            );

            // Should return 1 for invalid provider
            expect(exitCode).toBe(1);

            // Output should mention the error
            const output = mockOutput.getOutput();
            expect(output).toContain('Invalid provider');

            mockOutput.stream.end();
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
