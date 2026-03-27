/*
 * Apache License 2.0
 * Copyright (c) 2025–present Raman Marozau, Target Insight Function.
 * Contact: raman@worktif.com
 */

/**
 * Property-based tests for storage backends.
 *
 * Properties tested:
 * - Property 12: Credential Storage Round-Trip
 * - Property 13: Credential Provider Isolation
 */

import * as fc from 'fast-check';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { MemoryBackend } from './memory-backend.js';
import { EncryptedFileBackend } from './encrypted-file-backend.js';
import type { IStorageBackend } from './types.js';
import type { AuthProviderId, StoredCredentials } from '../types.js';
import { VALID_PROVIDER_IDS } from '../types.js';

/**
 * Arbitrary for generating valid provider IDs.
 */
const providerIdArb = fc.constantFrom(...VALID_PROVIDER_IDS);

/**
 * Arbitrary for generating valid stored credentials.
 */
const storedCredentialsArb = (providerId: AuthProviderId): fc.Arbitrary<StoredCredentials> =>
  fc.record({
    providerId: fc.constant(providerId),
    accessToken: fc.string({ minLength: 10, maxLength: 100 }).filter(s => s.length > 0),
    refreshToken: fc.option(fc.string({ minLength: 10, maxLength: 100 }), { nil: undefined }),
    expiresAt: fc.option(fc.integer({ min: Date.now(), max: Date.now() + 86400000 }), { nil: undefined }),
    scope: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
    storedAt: fc.integer({ min: Date.now() - 86400000, max: Date.now() }),
  });

/**
 * Create a temporary directory for testing.
 */
async function createTempDir(): Promise<string> {
  const tempDir = path.join(os.tmpdir(), `storage-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(tempDir, { recursive: true });
  return tempDir;
}

/**
 * Clean up a temporary directory.
 */
async function cleanupTempDir(tempDir: string): Promise<void> {
  try {
    await fs.rm(tempDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

describe('Storage Property Tests', () => {
  /**
   * Property 12: Credential Storage Round-Trip
   *
   * For any valid credentials stored for a provider:
   * - retrieve(providerId) returns the exact same credentials
   * - The credentials are not modified during storage
   *
   * Validates: Requirements 4.5, 5.3
   */
  describe('Property 12: Credential Storage Round-Trip', () => {
    describe('MemoryBackend', () => {
      it('should preserve credentials exactly through store/retrieve cycle', async () => {
        await fc.assert(
          fc.asyncProperty(
            providerIdArb,
            fc.integer({ min: 1, max: 100 }),
            async (providerId, _seed) => {
              const backend = new MemoryBackend();
              const credentials = await fc.sample(storedCredentialsArb(providerId), 1)[0];

              // Store credentials
              await backend.store(providerId, credentials);

              // Retrieve credentials
              const retrieved = await backend.retrieve(providerId);

              // Verify exact match
              expect(retrieved).not.toBeNull();
              expect(retrieved).toEqual(credentials);
            }
          ),
          { numRuns: 100 }
        );
      });

      it('should return null for non-existent providers', async () => {
        await fc.assert(
          fc.asyncProperty(
            providerIdArb,
            async (providerId) => {
              const backend = new MemoryBackend();

              // Retrieve without storing
              const retrieved = await backend.retrieve(providerId);

              expect(retrieved).toBeNull();
            }
          ),
          { numRuns: 100 }
        );
      });
    });

    describe('EncryptedFileBackend', () => {
      let tempDir: string;

      beforeEach(async () => {
        tempDir = await createTempDir();
      });

      afterEach(async () => {
        await cleanupTempDir(tempDir);
      });

      it('should preserve credentials exactly through store/retrieve cycle', async () => {
        await fc.assert(
          fc.asyncProperty(
            providerIdArb,
            fc.integer({ min: 1, max: 100 }),
            async (providerId, _seed) => {
              const filePath = path.join(tempDir, `creds-${Date.now()}-${Math.random().toString(36).slice(2)}.enc`);
              const backend = new EncryptedFileBackend(filePath);
              const credentials = await fc.sample(storedCredentialsArb(providerId), 1)[0];

              // Store credentials
              await backend.store(providerId, credentials);

              // Retrieve credentials
              const retrieved = await backend.retrieve(providerId);

              // Verify exact match
              expect(retrieved).not.toBeNull();
              expect(retrieved).toEqual(credentials);
            }
          ),
          { numRuns: 50 }  // Fewer runs due to file I/O
        );
      });

      it('should return null for non-existent providers', async () => {
        await fc.assert(
          fc.asyncProperty(
            providerIdArb,
            async (providerId) => {
              const filePath = path.join(tempDir, `creds-${Date.now()}-${Math.random().toString(36).slice(2)}.enc`);
              const backend = new EncryptedFileBackend(filePath);

              // Retrieve without storing
              const retrieved = await backend.retrieve(providerId);

              expect(retrieved).toBeNull();
            }
          ),
          { numRuns: 50 }
        );
      });
    });
  });

  /**
   * Property 13: Credential Provider Isolation
   *
   * For any two different providers:
   * - Storing credentials for provider A does not affect provider B
   * - Deleting credentials for provider A does not affect provider B
   * - Each provider's credentials are completely independent
   *
   * Validates: Requirements 5.5
   */
  describe('Property 13: Credential Provider Isolation', () => {
    /**
     * Helper to run isolation tests on any backend.
     */
    async function testProviderIsolation(backend: IStorageBackend): Promise<void> {
      await fc.assert(
        fc.asyncProperty(
          fc.tuple(providerIdArb, providerIdArb).filter(([a, b]) => a !== b),
          fc.integer({ min: 1, max: 100 }),
          async ([providerA, providerB], _seed) => {
            const credentialsA = await fc.sample(storedCredentialsArb(providerA), 1)[0];
            const credentialsB = await fc.sample(storedCredentialsArb(providerB), 1)[0];

            // Store credentials for both providers
            await backend.store(providerA, credentialsA);
            await backend.store(providerB, credentialsB);

            // Verify both are stored correctly
            const retrievedA = await backend.retrieve(providerA);
            const retrievedB = await backend.retrieve(providerB);

            expect(retrievedA).toEqual(credentialsA);
            expect(retrievedB).toEqual(credentialsB);

            // Delete provider A
            await backend.delete(providerA);

            // Verify A is deleted but B is unaffected
            const afterDeleteA = await backend.retrieve(providerA);
            const afterDeleteB = await backend.retrieve(providerB);

            expect(afterDeleteA).toBeNull();
            expect(afterDeleteB).toEqual(credentialsB);
          }
        ),
        { numRuns: 50 }
      );
    }

    describe('MemoryBackend', () => {
      it('should isolate credentials between providers', async () => {
        const backend = new MemoryBackend();
        await testProviderIsolation(backend);
      });

      it('should list only providers with stored credentials', async () => {
        await fc.assert(
          fc.asyncProperty(
            fc.uniqueArray(providerIdArb, { minLength: 1, maxLength: 5 }),
            async (providers) => {
              const backend = new MemoryBackend();

              // Store credentials for each provider
              for (const providerId of providers) {
                const credentials = await fc.sample(storedCredentialsArb(providerId), 1)[0];
                await backend.store(providerId, credentials);
              }

              // List providers
              const listed = await backend.listProviders();

              // Verify all stored providers are listed
              expect(listed.sort()).toEqual([...providers].sort());
            }
          ),
          { numRuns: 50 }
        );
      });
    });

    describe('EncryptedFileBackend', () => {
      let tempDir: string;

      beforeEach(async () => {
        tempDir = await createTempDir();
      });

      afterEach(async () => {
        await cleanupTempDir(tempDir);
      });

      it('should isolate credentials between providers', async () => {
        const filePath = path.join(tempDir, 'isolation-test.enc');
        const backend = new EncryptedFileBackend(filePath);
        await testProviderIsolation(backend);
      }, 30000);  // Increased timeout for file I/O operations

      it('should list only providers with stored credentials', async () => {
        await fc.assert(
          fc.asyncProperty(
            fc.uniqueArray(providerIdArb, { minLength: 1, maxLength: 5 }),
            async (providers) => {
              const filePath = path.join(tempDir, `list-test-${Date.now()}.enc`);
              const backend = new EncryptedFileBackend(filePath);

              // Store credentials for each provider
              for (const providerId of providers) {
                const credentials = await fc.sample(storedCredentialsArb(providerId), 1)[0];
                await backend.store(providerId, credentials);
              }

              // List providers
              const listed = await backend.listProviders();

              // Verify all stored providers are listed
              expect(listed.sort()).toEqual([...providers].sort());
            }
          ),
          { numRuns: 30 }  // Fewer runs due to file I/O
        );
      });
    });
  });

  /**
   * Additional property: deleteAll removes all credentials
   */
  describe('Property: deleteAll removes all credentials', () => {
    it('MemoryBackend should remove all credentials on deleteAll', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uniqueArray(providerIdArb, { minLength: 1, maxLength: 5 }),
          async (providers) => {
            const backend = new MemoryBackend();

            // Store credentials for each provider
            for (const providerId of providers) {
              const credentials = await fc.sample(storedCredentialsArb(providerId), 1)[0];
              await backend.store(providerId, credentials);
            }

            // Delete all
            await backend.deleteAll();

            // Verify all are deleted
            for (const providerId of providers) {
              const retrieved = await backend.retrieve(providerId);
              expect(retrieved).toBeNull();
            }

            // Verify list is empty
            const listed = await backend.listProviders();
            expect(listed).toEqual([]);
          }
        ),
        { numRuns: 50 }
      );
    });

    it('EncryptedFileBackend should remove all credentials on deleteAll', async () => {
      const tempDir = await createTempDir();

      try {
        await fc.assert(
          fc.asyncProperty(
            fc.uniqueArray(providerIdArb, { minLength: 1, maxLength: 5 }),
            async (providers) => {
              const filePath = path.join(tempDir, `deleteall-test-${Date.now()}.enc`);
              const backend = new EncryptedFileBackend(filePath);

              // Store credentials for each provider
              for (const providerId of providers) {
                const credentials = await fc.sample(storedCredentialsArb(providerId), 1)[0];
                await backend.store(providerId, credentials);
              }

              // Delete all
              await backend.deleteAll();

              // Verify all are deleted
              for (const providerId of providers) {
                const retrieved = await backend.retrieve(providerId);
                expect(retrieved).toBeNull();
              }

              // Verify list is empty
              const listed = await backend.listProviders();
              expect(listed).toEqual([]);
            }
          ),
          { numRuns: 30 }
        );
      } finally {
        await cleanupTempDir(tempDir);
      }
    });
  });
});
