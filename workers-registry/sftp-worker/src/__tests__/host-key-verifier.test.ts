/**
 * Tests for HostKeyVerifier
 * 
 * Tests host key verification policies: strict, tofu, none
 * Validates error data completeness and fingerprint format
 */

import fc from 'fast-check';
import * as crypto from 'crypto';
import {
  HostKeyVerifier,
  InMemoryHostTrustStore,
  IHostTrustStore,
} from '../host-key-verifier.js';
import { SftpError } from '../types.js';

describe('HostKeyVerifier', () => {
  let verifier: HostKeyVerifier;
  let trustStore: IHostTrustStore;

  beforeEach(() => {
    trustStore = new InMemoryHostTrustStore();
    verifier = new HostKeyVerifier(trustStore);
  });

  // ==========================================================================
  // Helper Functions
  // ==========================================================================

  function generateHostKey(): Buffer {
    return crypto.randomBytes(32);
  }

  function computeFingerprint(key: Buffer): string {
    const hash = crypto.createHash('sha256').update(key).digest();
    return `SHA256:${hash.toString('base64')}`;
  }

  // ==========================================================================
  // Policy: none
  // ==========================================================================

  describe('Policy: none', () => {
    it('should always accept any host key', () => {
      const key = generateHostKey();
      const result = verifier.verify('none', 'example.com', 22, key);

      expect(result.accepted).toBe(true);
      expect(result.fingerprint).toMatch(/^SHA256:/);
      expect(result.error).toBeUndefined();
    });

    it('should accept without known host keys', () => {
      const key = generateHostKey();
      const result = verifier.verify('none', 'example.com', 22, key, []);

      expect(result.accepted).toBe(true);
    });

    it('should accept even with mismatched known keys', () => {
      const key1 = generateHostKey();
      const key2 = generateHostKey();
      const fp1 = computeFingerprint(key1);

      const result = verifier.verify('none', 'example.com', 22, key2, [fp1]);

      expect(result.accepted).toBe(true);
    });
  });

  // ==========================================================================
  // Policy: strict
  // ==========================================================================

  describe('Policy: strict', () => {
    it('should accept when key matches known host keys', () => {
      const key = generateHostKey();
      const fingerprint = computeFingerprint(key);

      const result = verifier.verify('strict', 'example.com', 22, key, [fingerprint]);

      expect(result.accepted).toBe(true);
      expect(result.fingerprint).toBe(fingerprint);
      expect(result.error).toBeUndefined();
    });

    it('should accept when key matches one of multiple known keys', () => {
      const key1 = generateHostKey();
      const key2 = generateHostKey();
      const key3 = generateHostKey();
      const fp1 = computeFingerprint(key1);
      const fp2 = computeFingerprint(key2);
      const fp3 = computeFingerprint(key3);

      const result = verifier.verify('strict', 'example.com', 22, key2, [fp1, fp2, fp3]);

      expect(result.accepted).toBe(true);
      expect(result.fingerprint).toBe(fp2);
    });

    it('should reject when no known host keys provided', () => {
      const key = generateHostKey();

      const result = verifier.verify('strict', 'example.com', 22, key, []);

      expect(result.accepted).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.code).toBe(-32027); // HOST_KEY_UNKNOWN
      expect(result.error?.message).toContain('Host key unknown');
    });

    it('should reject when key does not match known keys', () => {
      const key1 = generateHostKey();
      const key2 = generateHostKey();
      const fp1 = computeFingerprint(key1);

      const result = verifier.verify('strict', 'example.com', 22, key2, [fp1]);

      expect(result.accepted).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.code).toBe(-32028); // HOST_KEY_MISMATCH
      expect(result.error?.message).toContain('Host key mismatch');
    });

    it('should include presentedFingerprint in error data for unknown key', () => {
      const key = generateHostKey();
      const fingerprint = computeFingerprint(key);

      const result = verifier.verify('strict', 'example.com', 22, key, []);

      expect(result.error).toBeDefined();
      expect((result.error as any).originalError?.presentedFingerprint).toBe(fingerprint);
    });

    it('should include both fingerprints in error data for mismatch', () => {
      const key1 = generateHostKey();
      const key2 = generateHostKey();
      const fp1 = computeFingerprint(key1);
      const fp2 = computeFingerprint(key2);

      const result = verifier.verify('strict', 'example.com', 22, key2, [fp1]);

      expect(result.error).toBeDefined();
      const errorData = (result.error as any).originalError;
      expect(errorData?.presentedFingerprint).toBe(fp2);
      expect(errorData?.expectedFingerprint).toBe(fp1);
    });
  });

  // ==========================================================================
  // Policy: tofu
  // ==========================================================================

  describe('Policy: tofu', () => {
    it('should accept first connection and remember key', () => {
      const key = generateHostKey();
      const fingerprint = computeFingerprint(key);

      const result = verifier.verify('tofu', 'example.com', 22, key);

      expect(result.accepted).toBe(true);
      expect(result.fingerprint).toBe(fingerprint);
      expect(trustStore.has('example.com', 22)).toBe(true);
      expect(trustStore.get('example.com', 22)).toBe(fingerprint);
    });

    it('should accept subsequent connection with same key', () => {
      const key = generateHostKey();
      const fingerprint = computeFingerprint(key);

      // First connection
      const result1 = verifier.verify('tofu', 'example.com', 22, key);
      expect(result1.accepted).toBe(true);

      // Second connection with same key
      const result2 = verifier.verify('tofu', 'example.com', 22, key);
      expect(result2.accepted).toBe(true);
      expect(result2.fingerprint).toBe(fingerprint);
    });

    it('should reject subsequent connection with different key', () => {
      const key1 = generateHostKey();
      const key2 = generateHostKey();
      const fp1 = computeFingerprint(key1);
      const fp2 = computeFingerprint(key2);

      // First connection
      const result1 = verifier.verify('tofu', 'example.com', 22, key1);
      expect(result1.accepted).toBe(true);

      // Second connection with different key
      const result2 = verifier.verify('tofu', 'example.com', 22, key2);
      expect(result2.accepted).toBe(false);
      expect(result2.error?.code).toBe(-32028); // HOST_KEY_MISMATCH
      expect(result2.error?.message).toContain('Host key changed');
    });

    it('should include both fingerprints in error data for key change', () => {
      const key1 = generateHostKey();
      const key2 = generateHostKey();
      const fp1 = computeFingerprint(key1);
      const fp2 = computeFingerprint(key2);

      verifier.verify('tofu', 'example.com', 22, key1);
      const result = verifier.verify('tofu', 'example.com', 22, key2);

      expect(result.error).toBeDefined();
      const errorData = (result.error as any).originalError;
      expect(errorData?.presentedFingerprint).toBe(fp2);
      expect(errorData?.expectedFingerprint).toBe(fp1);
    });

    it('should track keys separately per host:port', () => {
      const key1 = generateHostKey();
      const key2 = generateHostKey();

      // Different hosts
      const result1 = verifier.verify('tofu', 'host1.com', 22, key1);
      const result2 = verifier.verify('tofu', 'host2.com', 22, key2);

      expect(result1.accepted).toBe(true);
      expect(result2.accepted).toBe(true);

      // Different ports
      const result3 = verifier.verify('tofu', 'host1.com', 2222, key2);
      expect(result3.accepted).toBe(true);
    });
  });

  // ==========================================================================
  // Fingerprint Format
  // ==========================================================================

  describe('Fingerprint format', () => {
    it('should return fingerprint in SHA256:base64 format', () => {
      const key = generateHostKey();
      const result = verifier.verify('none', 'example.com', 22, key);

      expect(result.fingerprint).toMatch(/^SHA256:[A-Za-z0-9+/]+=*$/);
    });

    it('should accept fingerprint string as input', () => {
      const key = generateHostKey();
      const fingerprint = computeFingerprint(key);

      const result = verifier.verify('strict', 'example.com', 22, fingerprint, [fingerprint]);

      expect(result.accepted).toBe(true);
      expect(result.fingerprint).toBe(fingerprint);
    });

    it('should normalize fingerprint with lowercase prefix', () => {
      const key = generateHostKey();
      const fingerprint = computeFingerprint(key);
      const lowercaseFingerprint = fingerprint.replace('SHA256:', 'sha256:');

      const result = verifier.verify('strict', 'example.com', 22, key, [lowercaseFingerprint]);

      expect(result.accepted).toBe(true);
    });

    it('should normalize fingerprint without prefix', () => {
      const key = generateHostKey();
      const fingerprint = computeFingerprint(key);
      const base64Only = fingerprint.replace('SHA256:', '');

      const result = verifier.verify('strict', 'example.com', 22, key, [base64Only]);

      expect(result.accepted).toBe(true);
    });
  });

  // ==========================================================================
  // InMemoryHostTrustStore
  // ==========================================================================

  describe('InMemoryHostTrustStore', () => {
    it('should store and retrieve fingerprints', () => {
      const store = new InMemoryHostTrustStore();
      const fingerprint = 'SHA256:test123';

      store.set('example.com', 22, fingerprint);

      expect(store.has('example.com', 22)).toBe(true);
      expect(store.get('example.com', 22)).toBe(fingerprint);
    });

    it('should return undefined for unknown host', () => {
      const store = new InMemoryHostTrustStore();

      expect(store.has('example.com', 22)).toBe(false);
      expect(store.get('example.com', 22)).toBeUndefined();
    });

    it('should clear all entries', () => {
      const store = new InMemoryHostTrustStore();

      store.set('host1.com', 22, 'SHA256:fp1');
      store.set('host2.com', 22, 'SHA256:fp2');

      store.clear();

      expect(store.has('host1.com', 22)).toBe(false);
      expect(store.has('host2.com', 22)).toBe(false);
    });

    it('should normalize host to lowercase', () => {
      const store = new InMemoryHostTrustStore();
      const fingerprint = 'SHA256:test123';

      store.set('Example.COM', 22, fingerprint);

      expect(store.get('example.com', 22)).toBe(fingerprint);
      expect(store.get('EXAMPLE.COM', 22)).toBe(fingerprint);
    });
  });

  // ==========================================================================
  // Property-Based Tests
  // ==========================================================================

  describe('Property 33: Host key verification policies', () => {
    it('strict policy accepts only matching keys', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.uint8Array({ minLength: 32, maxLength: 32 }), { minLength: 1, maxLength: 5 }),
          fc.integer({ min: 0, max: 10 }),
          async (keys, selectedIndex) => {
            const testVerifier = new HostKeyVerifier();
            const keyBuffers = keys.map((k) => Buffer.from(k));
            const fingerprints = keyBuffers.map(computeFingerprint);

            // Test with key at selectedIndex
            const testKeyIndex = selectedIndex % keys.length;
            const testKey = keyBuffers[testKeyIndex];
            const testFingerprint = fingerprints[testKeyIndex];

            // Should accept if test key is in known keys
            const result = testVerifier.verify('strict', 'test.com', 22, testKey, fingerprints);

            return result.accepted === true && result.fingerprint === testFingerprint;
          }
        ),
        { numRuns: 50 }
      );
    });

    it('strict policy rejects unknown keys', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uint8Array({ minLength: 32, maxLength: 32 }),
          fc.uint8Array({ minLength: 32, maxLength: 32 }),
          async (key1Bytes, key2Bytes) => {
            // Ensure keys are different
            if (Buffer.from(key1Bytes).equals(Buffer.from(key2Bytes))) {
              return true; // Skip this case
            }

            const testVerifier = new HostKeyVerifier();
            const key1 = Buffer.from(key1Bytes);
            const key2 = Buffer.from(key2Bytes);
            const fp1 = computeFingerprint(key1);

            // Try to verify key2 with only key1 in known keys
            const result = testVerifier.verify('strict', 'test.com', 22, key2, [fp1]);

            return result.accepted === false && result.error?.code === -32028;
          }
        ),
        { numRuns: 50 }
      );
    });

    it('tofu policy accepts first key and rejects changes', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uint8Array({ minLength: 32, maxLength: 32 }),
          fc.uint8Array({ minLength: 32, maxLength: 32 }),
          async (key1Bytes, key2Bytes) => {
            // Ensure keys are different
            if (Buffer.from(key1Bytes).equals(Buffer.from(key2Bytes))) {
              return true; // Skip this case
            }

            const testStore = new InMemoryHostTrustStore();
            const testVerifier = new HostKeyVerifier(testStore);
            const key1 = Buffer.from(key1Bytes);
            const key2 = Buffer.from(key2Bytes);

            // First connection - should accept
            const result1 = testVerifier.verify('tofu', 'test.com', 22, key1);

            // Second connection with same key - should accept
            const result2 = testVerifier.verify('tofu', 'test.com', 22, key1);

            // Third connection with different key - should reject
            const result3 = testVerifier.verify('tofu', 'test.com', 22, key2);

            return (
              result1.accepted === true &&
              result2.accepted === true &&
              result3.accepted === false &&
              result3.error?.code === -32028
            );
          }
        ),
        { numRuns: 50 }
      );
    });

    it('none policy always accepts', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uint8Array({ minLength: 32, maxLength: 32 }),
          async (keyBytes) => {
            const testVerifier = new HostKeyVerifier();
            const key = Buffer.from(keyBytes);

            const result = testVerifier.verify('none', 'test.com', 22, key);

            return result.accepted === true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 34: Host key error data completeness', () => {
    it('error data contains presentedFingerprint for unknown key', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uint8Array({ minLength: 32, maxLength: 32 }),
          async (keyBytes) => {
            const testVerifier = new HostKeyVerifier();
            const key = Buffer.from(keyBytes);
            const fingerprint = computeFingerprint(key);

            const result = testVerifier.verify('strict', 'test.com', 22, key, []);

            const errorData = (result.error as any)?.originalError;
            return (
              result.accepted === false &&
              result.error?.code === -32027 &&
              errorData?.presentedFingerprint === fingerprint &&
              errorData?.presentedFingerprint.startsWith('SHA256:')
            );
          }
        ),
        { numRuns: 100 }
      );
    });

    it('error data contains both fingerprints for mismatch', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uint8Array({ minLength: 32, maxLength: 32 }),
          fc.uint8Array({ minLength: 32, maxLength: 32 }),
          async (key1Bytes, key2Bytes) => {
            // Ensure keys are different
            if (Buffer.from(key1Bytes).equals(Buffer.from(key2Bytes))) {
              return true; // Skip this case
            }

            const testVerifier = new HostKeyVerifier();
            const key1 = Buffer.from(key1Bytes);
            const key2 = Buffer.from(key2Bytes);
            const fp1 = computeFingerprint(key1);
            const fp2 = computeFingerprint(key2);

            const result = testVerifier.verify('strict', 'test.com', 22, key2, [fp1]);

            const errorData = (result.error as any)?.originalError;
            return (
              result.accepted === false &&
              result.error?.code === -32028 &&
              errorData?.presentedFingerprint === fp2 &&
              errorData?.expectedFingerprint === fp1 &&
              errorData?.presentedFingerprint.startsWith('SHA256:') &&
              errorData?.expectedFingerprint.startsWith('SHA256:')
            );
          }
        ),
        { numRuns: 50 }
      );
    });
  });
});
