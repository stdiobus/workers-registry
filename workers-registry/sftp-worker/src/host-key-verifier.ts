/**
 * Host Key Verifier - MITM protection for SFTP connections
 * 
 * Implements three verification policies:
 * - strict: Verify against known host keys, reject unknown/mismatched
 * - tofu: Trust-on-first-use, remember and verify on subsequent connections
 * - none: No verification (dev/test only)
 */

import * as crypto from 'crypto';
import { SftpError } from './types.js';

/**
 * Host key verification policy
 */
export type HostKeyPolicy = 'strict' | 'tofu' | 'none';

/**
 * Host key verification result
 */
export interface HostKeyVerificationResult {
  accepted: boolean;
  fingerprint: string;
  error?: SftpError;
}

/**
 * Host trust store interface
 * 
 * Abstracts storage of trusted host keys for TOFU policy.
 */
export interface IHostTrustStore {
  /**
   * Get trusted fingerprint for host:port
   */
  get(host: string, port: number): string | undefined;

  /**
   * Store trusted fingerprint for host:port
   */
  set(host: string, port: number, fingerprint: string): void;

  /**
   * Check if host:port has a trusted key
   */
  has(host: string, port: number): boolean;

  /**
   * Clear all trusted keys
   */
  clear(): void;
}

/**
 * In-memory host trust store
 * 
 * Stores trusted keys in memory. Keys are lost on process restart.
 * Suitable for testing and ephemeral environments.
 */
export class InMemoryHostTrustStore implements IHostTrustStore {
  private store: Map<string, string> = new Map();

  get(host: string, port: number): string | undefined {
    const key = this.makeKey(host, port);
    return this.store.get(key);
  }

  set(host: string, port: number, fingerprint: string): void {
    const key = this.makeKey(host, port);
    this.store.set(key, fingerprint);
  }

  has(host: string, port: number): boolean {
    const key = this.makeKey(host, port);
    return this.store.has(key);
  }

  clear(): void {
    this.store.clear();
  }

  private makeKey(host: string, port: number): string {
    // Normalize host to lowercase for case-insensitive comparison
    return `${host.toLowerCase()}:${port}`;
  }
}

/**
 * Host Key Verifier
 * 
 * Verifies SSH host keys according to configured policy.
 */
export class HostKeyVerifier {
  private trustStore: IHostTrustStore;

  constructor(trustStore?: IHostTrustStore) {
    this.trustStore = trustStore || new InMemoryHostTrustStore();
  }

  /**
   * Verify host key according to policy
   * 
   * @param policy - Verification policy (strict, tofu, none)
   * @param host - Server hostname
   * @param port - Server port
   * @param presentedKey - Host key presented by server (raw Buffer or fingerprint string)
   * @param knownHostKeys - Known host keys for strict policy (array of fingerprints)
   * @returns Verification result with acceptance status and fingerprint
   */
  verify(
    policy: HostKeyPolicy,
    host: string,
    port: number,
    presentedKey: Buffer | string,
    knownHostKeys?: string[]
  ): HostKeyVerificationResult {
    // Compute fingerprint from presented key
    const presentedFingerprint = this.computeFingerprint(presentedKey);

    // Policy: none - always accept
    if (policy === 'none') {
      return {
        accepted: true,
        fingerprint: presentedFingerprint,
      };
    }

    // Policy: strict - verify against knownHostKeys
    if (policy === 'strict') {
      if (!knownHostKeys || knownHostKeys.length === 0) {
        return {
          accepted: false,
          fingerprint: presentedFingerprint,
          error: new SftpError(
            -32027,
            `Host key unknown for ${host}:${port}`,
            undefined,
            {
              presentedFingerprint,
              expectedFingerprint: undefined,
            }
          ),
        };
      }

      // Check if presented key matches any known key
      const matches = knownHostKeys.some(
        (known) => this.normalizeFingerprint(known) === presentedFingerprint
      );

      if (!matches) {
        return {
          accepted: false,
          fingerprint: presentedFingerprint,
          error: new SftpError(
            -32028,
            `Host key mismatch for ${host}:${port}`,
            undefined,
            {
              presentedFingerprint,
              expectedFingerprint: knownHostKeys[0], // First known key as expected
            }
          ),
        };
      }

      return {
        accepted: true,
        fingerprint: presentedFingerprint,
      };
    }

    // Policy: tofu - trust on first use
    if (policy === 'tofu') {
      const trustedFingerprint = this.trustStore.get(host, port);

      if (!trustedFingerprint) {
        // First connection - trust and remember
        this.trustStore.set(host, port, presentedFingerprint);
        return {
          accepted: true,
          fingerprint: presentedFingerprint,
        };
      }

      // Subsequent connection - verify against trusted key
      if (trustedFingerprint !== presentedFingerprint) {
        return {
          accepted: false,
          fingerprint: presentedFingerprint,
          error: new SftpError(
            -32028,
            `Host key changed for ${host}:${port}`,
            undefined,
            {
              presentedFingerprint,
              expectedFingerprint: trustedFingerprint,
            }
          ),
        };
      }

      return {
        accepted: true,
        fingerprint: presentedFingerprint,
      };
    }

    // Unknown policy - reject
    return {
      accepted: false,
      fingerprint: presentedFingerprint,
      error: new SftpError(
        -32020,
        `Unknown host key policy: ${policy}`,
        undefined
      ),
    };
  }

  /**
   * Compute SHA256 fingerprint in OpenSSH format
   * 
   * @param key - Raw host key Buffer or existing fingerprint string
   * @returns Fingerprint in format "SHA256:base64hash"
   */
  private computeFingerprint(key: Buffer | string): string {
    // If already a fingerprint string, normalize and return
    if (typeof key === 'string') {
      return this.normalizeFingerprint(key);
    }

    // Compute SHA256 hash of raw key
    const hash = crypto.createHash('sha256').update(key).digest();

    // Convert to base64 (OpenSSH format)
    const base64Hash = hash.toString('base64');

    return `SHA256:${base64Hash}`;
  }

  /**
   * Normalize fingerprint to standard format
   * 
   * Handles various input formats:
   * - "SHA256:base64hash"
   * - "sha256:base64hash"
   * - "base64hash" (adds SHA256: prefix)
   * 
   * @param fingerprint - Fingerprint string
   * @returns Normalized fingerprint "SHA256:base64hash"
   */
  private normalizeFingerprint(fingerprint: string): string {
    const trimmed = fingerprint.trim();

    // Already in correct format
    if (trimmed.startsWith('SHA256:')) {
      return trimmed;
    }

    // Lowercase variant
    if (trimmed.startsWith('sha256:')) {
      return 'SHA256:' + trimmed.substring(7);
    }

    // Missing prefix - add it
    return 'SHA256:' + trimmed;
  }

  /**
   * Get trust store (for testing)
   */
  getTrustStore(): IHostTrustStore {
    return this.trustStore;
  }
}
