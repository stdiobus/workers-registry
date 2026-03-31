/**
 * Capability Negotiator for SFTP Worker
 * 
 * Handles sftp/initialize handshake and capability negotiation between
 * client and worker. Validates protocol version compatibility and computes
 * the intersection of supported capabilities.
 */

import { INCOMPATIBLE_PROTOCOL, UNSUPPORTED_OPERATION } from './error-codes.js';
import { NegotiatedCapabilities, BASELINE_CAPABILITIES } from './types.js';

/**
 * Client capabilities sent during sftp/initialize
 */
export interface ClientCapabilities {
  protocolVersion: string; // "MAJOR.MINOR"
  clientName: string;
  clientVersion: string;
  capabilities?: {
    chunkedIO?: boolean;
    atomicWrite?: boolean;
    hostKeyVerification?: boolean;
    cancelRequest?: boolean;
    maxChunkBytes?: number;
    maxInlineFileBytes?: number;
  };
}

/**
 * Worker capabilities (what the worker supports)
 */
export interface WorkerCapabilities {
  protocolVersion: string; // "MAJOR.MINOR"
  workerVersion: string;
  capabilities: {
    chunkedIO: boolean;
    atomicWrite: boolean;
    hostKeyVerification: boolean;
    cancelRequest: boolean;
    maxChunkBytes: number;
    maxInlineFileBytes: number;
  };
}

/**
 * Result of sftp/initialize handshake
 */
export interface InitializeResult {
  protocolVersion: string;
  workerVersion: string;
  capabilities: NegotiatedCapabilities;
}

/**
 * Error thrown when protocol versions are incompatible
 */
export class IncompatibleProtocolError extends Error {
  constructor(
    public readonly clientVersion: string,
    public readonly workerVersion: string
  ) {
    super(`Incompatible protocol version: client ${clientVersion}, worker ${workerVersion}`);
    this.name = 'IncompatibleProtocolError';
  }
}

/**
 * Error thrown when a method requires an unsupported capability
 */
export class UnsupportedOperationError extends Error {
  constructor(
    public readonly method: string,
    public readonly requiredCapability: string
  ) {
    super(`Method ${method} requires capability: ${requiredCapability}`);
    this.name = 'UnsupportedOperationError';
  }
}

/**
 * Default worker capabilities
 */
export const DEFAULT_WORKER_CAPABILITIES: WorkerCapabilities = {
  protocolVersion: '1.0',
  workerVersion: '0.1.0',
  capabilities: {
    chunkedIO: true,
    atomicWrite: true,
    hostKeyVerification: true,
    cancelRequest: true,
    maxChunkBytes: 1048576,      // 1MB
    maxInlineFileBytes: 1048576, // 1MB
  },
};

/**
 * CapabilityNegotiator handles protocol version checking and capability intersection
 */
export class CapabilityNegotiator {
  private workerCapabilities: WorkerCapabilities;

  constructor(workerCapabilities: WorkerCapabilities = DEFAULT_WORKER_CAPABILITIES) {
    this.workerCapabilities = workerCapabilities;
  }

  /**
   * Parse protocol version string into MAJOR and MINOR components
   */
  private parseVersion(version: string): { major: number; minor: number } {
    const parts = version.split('.');
    if (parts.length !== 2) {
      throw new Error(`Invalid protocol version format: ${version}`);
    }
    const major = parseInt(parts[0], 10);
    const minor = parseInt(parts[1], 10);
    if (isNaN(major) || isNaN(minor)) {
      throw new Error(`Invalid protocol version format: ${version}`);
    }
    return { major, minor };
  }

  /**
   * Check if client and worker protocol versions are compatible
   * 
   * Requirement 26.3: MAJOR version must match, MINOR can differ
   */
  private checkVersionCompatibility(clientVersion: string, workerVersion: string): void {
    const client = this.parseVersion(clientVersion);
    const worker = this.parseVersion(workerVersion);

    if (client.major !== worker.major) {
      throw new IncompatibleProtocolError(clientVersion, workerVersion);
    }
  }

  /**
   * Compute intersection of client and worker capabilities
   * 
   * Requirements 26.2, 26.4, 26.5:
   * - Boolean flags: AND (both must support)
   * - Numeric limits: min (most restrictive)
   */
  private intersectCapabilities(
    clientCaps: ClientCapabilities['capabilities'],
    workerCaps: WorkerCapabilities['capabilities']
  ): NegotiatedCapabilities {
    // If client doesn't provide capabilities, use baseline
    if (!clientCaps) {
      return { ...BASELINE_CAPABILITIES };
    }

    return {
      // Boolean flags: AND operation
      chunkedIO: (clientCaps.chunkedIO ?? false) && workerCaps.chunkedIO,
      atomicWrite: (clientCaps.atomicWrite ?? false) && workerCaps.atomicWrite,
      hostKeyVerification: (clientCaps.hostKeyVerification ?? true) && workerCaps.hostKeyVerification,
      cancelRequest: (clientCaps.cancelRequest ?? false) && workerCaps.cancelRequest,

      // Numeric limits: min (most restrictive)
      maxChunkBytes: Math.min(
        clientCaps.maxChunkBytes ?? workerCaps.maxChunkBytes,
        workerCaps.maxChunkBytes
      ),
      maxInlineFileBytes: Math.min(
        clientCaps.maxInlineFileBytes ?? workerCaps.maxInlineFileBytes,
        workerCaps.maxInlineFileBytes
      ),
    };
  }

  /**
   * Handle sftp/initialize handshake
   * 
   * Requirement 26.1: First RPC call before any working operations
   * Requirement 26.2: Return negotiated capabilities
   * Requirement 26.3: Check MAJOR version compatibility
   * Requirement 26.4: Use capability intersection when MINOR differs
   * 
   * @throws IncompatibleProtocolError if MAJOR versions don't match
   */
  negotiate(clientCaps: ClientCapabilities): InitializeResult {
    // Check protocol version compatibility
    this.checkVersionCompatibility(
      clientCaps.protocolVersion,
      this.workerCapabilities.protocolVersion
    );

    // Compute capability intersection
    const negotiated = this.intersectCapabilities(
      clientCaps.capabilities,
      this.workerCapabilities.capabilities
    );

    return {
      protocolVersion: this.workerCapabilities.protocolVersion,
      workerVersion: this.workerCapabilities.workerVersion,
      capabilities: negotiated,
    };
  }

  /**
   * Get baseline capabilities when sftp/initialize is not called
   * 
   * Requirement 26.7: Use baseline capabilities by default
   */
  static getBaselineCapabilities(): NegotiatedCapabilities {
    return { ...BASELINE_CAPABILITIES };
  }

  /**
   * Check if a method is supported by negotiated capabilities
   * 
   * Requirement 26.6: Enforce capability requirements for methods
   * 
   * @throws UnsupportedOperationError if method requires unsupported capability
   */
  static enforceCapability(
    method: string,
    capabilities: NegotiatedCapabilities
  ): void {
    // Map methods to required capabilities
    const methodCapabilityMap: Record<string, keyof NegotiatedCapabilities> = {
      'sftp/openRead': 'chunkedIO',
      'sftp/readChunk': 'chunkedIO',
      'sftp/closeRead': 'chunkedIO',
      'sftp/openWrite': 'chunkedIO',
      'sftp/writeChunk': 'chunkedIO',
      'sftp/commitWrite': 'chunkedIO',
      'sftp/abortWrite': 'chunkedIO',
      '$/cancelRequest': 'cancelRequest',
    };

    const requiredCapability = methodCapabilityMap[method];
    if (!requiredCapability) {
      // Method doesn't require special capability
      return;
    }

    const capabilityValue = capabilities[requiredCapability];

    // For boolean capabilities, check if enabled
    if (typeof capabilityValue === 'boolean' && !capabilityValue) {
      throw new UnsupportedOperationError(method, requiredCapability);
    }
  }
}
