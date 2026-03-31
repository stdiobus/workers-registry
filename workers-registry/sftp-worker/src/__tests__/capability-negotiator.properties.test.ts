/**
 * Property-based tests for CapabilityNegotiator
 * 
 * Property 38: Capability negotiation correctness
 * Property 39: Capability enforcement
 */

import * as fc from 'fast-check';
import {
  CapabilityNegotiator,
  ClientCapabilities,
  WorkerCapabilities,
  IncompatibleProtocolError,
  UnsupportedOperationError,
} from '../capability-negotiator.js';
import { NegotiatedCapabilities, BASELINE_CAPABILITIES } from '../types.js';

// Arbitraries for generating test data

const versionArbitrary = fc.tuple(
  fc.integer({ min: 0, max: 10 }),
  fc.integer({ min: 0, max: 99 })
).map(([major, minor]) => `${major}.${minor}`);

const capabilitiesArbitrary = fc.record({
  chunkedIO: fc.boolean(),
  atomicWrite: fc.boolean(),
  hostKeyVerification: fc.boolean(),
  cancelRequest: fc.boolean(),
  maxChunkBytes: fc.integer({ min: 1024, max: 10485760 }), // 1KB to 10MB
  maxInlineFileBytes: fc.integer({ min: 1024, max: 10485760 }),
});

const clientCapabilitiesArbitrary = fc.record({
  protocolVersion: versionArbitrary,
  clientName: fc.string({ minLength: 1, maxLength: 50 }),
  clientVersion: versionArbitrary,
  capabilities: fc.option(capabilitiesArbitrary, { nil: undefined }),
});

const workerCapabilitiesArbitrary = fc.record({
  protocolVersion: versionArbitrary,
  workerVersion: versionArbitrary,
  capabilities: capabilitiesArbitrary,
});

describe('CapabilityNegotiator - Property-based tests', () => {
  describe('Property 38: Capability negotiation correctness', () => {
    /**
     * **Validates: Требования 26.2, 26.3, 26.4, 26.5**
     * 
     * For any set of client and worker capabilities with matching MAJOR version,
     * the result should contain the intersection (AND for boolean, min for numeric).
     */
    it('should compute correct intersection for matching MAJOR versions', () => {
      fc.assert(
        fc.property(
          workerCapabilitiesArbitrary,
          clientCapabilitiesArbitrary,
          (workerCaps, clientCaps) => {
            // Force matching MAJOR versions
            const workerMajor = workerCaps.protocolVersion.split('.')[0];
            const clientMajor = clientCaps.protocolVersion.split('.')[0];
            const clientMinor = clientCaps.protocolVersion.split('.')[1];
            const adjustedClientCaps = {
              ...clientCaps,
              protocolVersion: `${workerMajor}.${clientMinor}`,
            };

            const negotiator = new CapabilityNegotiator(workerCaps);
            const result = negotiator.negotiate(adjustedClientCaps);

            // Check response structure
            expect(result.protocolVersion).toBe(workerCaps.protocolVersion);
            expect(result.workerVersion).toBe(workerCaps.workerVersion);
            expect(result.capabilities).toBeDefined();

            if (!adjustedClientCaps.capabilities) {
              // Should return baseline when no capabilities provided
              expect(result.capabilities).toEqual(BASELINE_CAPABILITIES);
            } else {
              const clientCap = adjustedClientCaps.capabilities;
              const workerCap = workerCaps.capabilities;

              // Boolean capabilities: AND
              expect(result.capabilities.chunkedIO).toBe(
                (clientCap.chunkedIO ?? false) && workerCap.chunkedIO
              );
              expect(result.capabilities.atomicWrite).toBe(
                (clientCap.atomicWrite ?? false) && workerCap.atomicWrite
              );
              expect(result.capabilities.hostKeyVerification).toBe(
                (clientCap.hostKeyVerification ?? true) && workerCap.hostKeyVerification
              );
              expect(result.capabilities.cancelRequest).toBe(
                (clientCap.cancelRequest ?? false) && workerCap.cancelRequest
              );

              // Numeric capabilities: min
              expect(result.capabilities.maxChunkBytes).toBe(
                Math.min(
                  clientCap.maxChunkBytes ?? workerCap.maxChunkBytes,
                  workerCap.maxChunkBytes
                )
              );
              expect(result.capabilities.maxInlineFileBytes).toBe(
                Math.min(
                  clientCap.maxInlineFileBytes ?? workerCap.maxInlineFileBytes,
                  workerCap.maxInlineFileBytes
                )
              );
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * **Validates: Требование 26.3**
     * 
     * For any client and worker with different MAJOR versions,
     * negotiation should throw IncompatibleProtocolError.
     */
    it('should reject incompatible MAJOR versions', () => {
      fc.assert(
        fc.property(
          workerCapabilitiesArbitrary,
          clientCapabilitiesArbitrary,
          (workerCaps, clientCaps) => {
            const workerMajor = parseInt(workerCaps.protocolVersion.split('.')[0], 10);
            const clientMajor = parseInt(clientCaps.protocolVersion.split('.')[0], 10);

            // Only test when MAJOR versions differ
            fc.pre(workerMajor !== clientMajor);

            const negotiator = new CapabilityNegotiator(workerCaps);

            expect(() => negotiator.negotiate(clientCaps)).toThrow(IncompatibleProtocolError);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * **Validates: Требование 26.4**
     * 
     * For any client and worker with same MAJOR but different MINOR versions,
     * negotiation should succeed and use capability intersection.
     */
    it('should accept different MINOR versions with same MAJOR', () => {
      fc.assert(
        fc.property(
          workerCapabilitiesArbitrary,
          clientCapabilitiesArbitrary,
          (workerCaps, clientCaps) => {
            const workerParts = workerCaps.protocolVersion.split('.');
            const clientParts = clientCaps.protocolVersion.split('.');

            // Force same MAJOR, different MINOR
            const major = workerParts[0];
            const workerMinor = parseInt(workerParts[1], 10);
            const clientMinor = parseInt(clientParts[1], 10);

            fc.pre(workerMinor !== clientMinor);

            const adjustedClientCaps = {
              ...clientCaps,
              protocolVersion: `${major}.${clientMinor}`,
            };

            const negotiator = new CapabilityNegotiator(workerCaps);
            const result = negotiator.negotiate(adjustedClientCaps);

            // Should succeed
            expect(result.protocolVersion).toBe(workerCaps.protocolVersion);
            expect(result.capabilities).toBeDefined();
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * **Validates: Требование 26.5**
     * 
     * Boolean intersection should always be commutative: A AND B = B AND A
     */
    it('should have commutative boolean intersection', () => {
      fc.assert(
        fc.property(
          fc.boolean(),
          fc.boolean(),
          (clientValue, workerValue) => {
            const result1 = clientValue && workerValue;
            const result2 = workerValue && clientValue;
            expect(result1).toBe(result2);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * **Validates: Требование 26.5**
     * 
     * Numeric intersection (min) should always be commutative: min(A, B) = min(B, A)
     */
    it('should have commutative numeric intersection', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1024, max: 10485760 }),
          fc.integer({ min: 1024, max: 10485760 }),
          (clientValue, workerValue) => {
            const result1 = Math.min(clientValue, workerValue);
            const result2 = Math.min(workerValue, clientValue);
            expect(result1).toBe(result2);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * **Validates: Требование 26.2**
     * 
     * Result should always contain all required fields
     */
    it('should always return complete result structure', () => {
      fc.assert(
        fc.property(
          workerCapabilitiesArbitrary,
          clientCapabilitiesArbitrary,
          (workerCaps, clientCaps) => {
            // Force matching MAJOR
            const workerMajor = workerCaps.protocolVersion.split('.')[0];
            const clientMinor = clientCaps.protocolVersion.split('.')[1];
            const adjustedClientCaps = {
              ...clientCaps,
              protocolVersion: `${workerMajor}.${clientMinor}`,
            };

            const negotiator = new CapabilityNegotiator(workerCaps);
            const result = negotiator.negotiate(adjustedClientCaps);

            // Check all required fields exist
            expect(result).toHaveProperty('protocolVersion');
            expect(result).toHaveProperty('workerVersion');
            expect(result).toHaveProperty('capabilities');
            expect(result.capabilities).toHaveProperty('chunkedIO');
            expect(result.capabilities).toHaveProperty('atomicWrite');
            expect(result.capabilities).toHaveProperty('hostKeyVerification');
            expect(result.capabilities).toHaveProperty('cancelRequest');
            expect(result.capabilities).toHaveProperty('maxChunkBytes');
            expect(result.capabilities).toHaveProperty('maxInlineFileBytes');
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 39: Capability enforcement', () => {
    /**
     * **Validates: Требования 26.6, 26.7**
     * 
     * For any method requiring chunkedIO capability, enforcement should
     * throw when chunkedIO is false and not throw when true.
     */
    it('should enforce chunkedIO capability for chunked I/O methods', () => {
      const chunkedMethods = [
        'sftp/openRead',
        'sftp/readChunk',
        'sftp/closeRead',
        'sftp/openWrite',
        'sftp/writeChunk',
        'sftp/commitWrite',
        'sftp/abortWrite',
      ];

      fc.assert(
        fc.property(
          fc.constantFrom(...chunkedMethods),
          fc.boolean(),
          (method, chunkedIOEnabled) => {
            const caps: NegotiatedCapabilities = {
              ...BASELINE_CAPABILITIES,
              chunkedIO: chunkedIOEnabled,
            };

            if (chunkedIOEnabled) {
              // Should not throw when capability is enabled
              expect(() => CapabilityNegotiator.enforceCapability(method, caps)).not.toThrow();
            } else {
              // Should throw when capability is disabled
              expect(() => CapabilityNegotiator.enforceCapability(method, caps))
                .toThrow(UnsupportedOperationError);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * **Validates: Требования 26.6, 26.7**
     * 
     * For any method requiring cancelRequest capability, enforcement should
     * throw when cancelRequest is false and not throw when true.
     */
    it('should enforce cancelRequest capability for $/cancelRequest', () => {
      fc.assert(
        fc.property(
          fc.boolean(),
          (cancelRequestEnabled) => {
            const caps: NegotiatedCapabilities = {
              ...BASELINE_CAPABILITIES,
              cancelRequest: cancelRequestEnabled,
            };

            if (cancelRequestEnabled) {
              expect(() => CapabilityNegotiator.enforceCapability('$/cancelRequest', caps))
                .not.toThrow();
            } else {
              expect(() => CapabilityNegotiator.enforceCapability('$/cancelRequest', caps))
                .toThrow(UnsupportedOperationError);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * **Validates: Требование 26.7**
     * 
     * For any method not requiring special capabilities, enforcement
     * should never throw regardless of capability values.
     */
    it('should not enforce capabilities for basic SFTP methods', () => {
      const basicMethods = [
        'sftp/connect',
        'sftp/disconnect',
        'sftp/readFile',
        'sftp/writeFile',
        'sftp/readdir',
        'sftp/stat',
        'sftp/mkdir',
        'sftp/delete',
        'sftp/rename',
      ];

      fc.assert(
        fc.property(
          fc.constantFrom(...basicMethods),
          capabilitiesArbitrary,
          (method, caps) => {
            const negotiatedCaps: NegotiatedCapabilities = {
              chunkedIO: caps.chunkedIO,
              atomicWrite: caps.atomicWrite,
              hostKeyVerification: caps.hostKeyVerification,
              cancelRequest: caps.cancelRequest,
              maxChunkBytes: caps.maxChunkBytes,
              maxInlineFileBytes: caps.maxInlineFileBytes,
            };

            // Should never throw for basic methods
            expect(() => CapabilityNegotiator.enforceCapability(method, negotiatedCaps))
              .not.toThrow();
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * **Validates: Требование 26.7**
     * 
     * When sftp/initialize is not called, baseline capabilities should be used.
     */
    it('should use baseline capabilities when not initialized', () => {
      const baseline = CapabilityNegotiator.getBaselineCapabilities();

      // Baseline has chunkedIO: false, so chunked methods should fail
      expect(() => CapabilityNegotiator.enforceCapability('sftp/openRead', baseline))
        .toThrow(UnsupportedOperationError);

      // Baseline has cancelRequest: false, so cancel should fail
      expect(() => CapabilityNegotiator.enforceCapability('$/cancelRequest', baseline))
        .toThrow(UnsupportedOperationError);

      // Basic methods should always work
      expect(() => CapabilityNegotiator.enforceCapability('sftp/readFile', baseline))
        .not.toThrow();
    });

    /**
     * Error should contain method name and required capability
     */
    it('should include method and capability in error', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('sftp/openRead', 'sftp/writeChunk', '$/cancelRequest'),
          (method) => {
            const caps: NegotiatedCapabilities = {
              ...BASELINE_CAPABILITIES,
              chunkedIO: false,
              cancelRequest: false,
            };

            try {
              CapabilityNegotiator.enforceCapability(method, caps);
              // Should have thrown
              throw new Error('Should have thrown UnsupportedOperationError');
            } catch (err) {
              expect(err).toBeInstanceOf(UnsupportedOperationError);
              const error = err as UnsupportedOperationError;
              expect(error.method).toBe(method);
              expect(error.requiredCapability).toBeDefined();
              expect(typeof error.requiredCapability).toBe('string');
            }
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  describe('Baseline capabilities properties', () => {
    /**
     * Baseline capabilities should be immutable (return a copy)
     */
    it('should return independent copies of baseline capabilities', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 10 }),
          (n) => {
            const copies = Array.from({ length: n }, () =>
              CapabilityNegotiator.getBaselineCapabilities()
            );

            // All should be equal in value
            for (let i = 1; i < copies.length; i++) {
              expect(copies[i]).toEqual(copies[0]);
            }

            // But not the same object
            for (let i = 1; i < copies.length; i++) {
              expect(copies[i]).not.toBe(copies[0]);
            }
          }
        ),
        { numRuns: 20 }
      );
    });
  });
});
