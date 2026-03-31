/**
 * Unit tests for CapabilityNegotiator
 * 
 * Tests protocol version checking, capability intersection logic,
 * and capability enforcement.
 */

import {
  CapabilityNegotiator,
  ClientCapabilities,
  WorkerCapabilities,
  IncompatibleProtocolError,
  UnsupportedOperationError,
  DEFAULT_WORKER_CAPABILITIES,
} from '../capability-negotiator.js';
import { BASELINE_CAPABILITIES } from '../types.js';

describe('CapabilityNegotiator', () => {
  describe('negotiate', () => {
    it('should successfully negotiate when MAJOR versions match', () => {
      const negotiator = new CapabilityNegotiator();
      const clientCaps: ClientCapabilities = {
        protocolVersion: '1.0',
        clientName: 'test-client',
        clientVersion: '1.0.0',
        capabilities: {
          chunkedIO: true,
          atomicWrite: true,
          hostKeyVerification: true,
          cancelRequest: true,
        },
      };

      const result = negotiator.negotiate(clientCaps);

      expect(result.protocolVersion).toBe('1.0');
      expect(result.workerVersion).toBe('0.1.0');
      expect(result.capabilities.chunkedIO).toBe(true);
      expect(result.capabilities.atomicWrite).toBe(true);
      expect(result.capabilities.hostKeyVerification).toBe(true);
      expect(result.capabilities.cancelRequest).toBe(true);
    });

    it('should throw IncompatibleProtocolError when MAJOR versions differ', () => {
      const negotiator = new CapabilityNegotiator();
      const clientCaps: ClientCapabilities = {
        protocolVersion: '2.0',
        clientName: 'test-client',
        clientVersion: '1.0.0',
      };

      expect(() => negotiator.negotiate(clientCaps)).toThrow(IncompatibleProtocolError);
    });

    it('should accept different MINOR versions', () => {
      const negotiator = new CapabilityNegotiator();
      const clientCaps: ClientCapabilities = {
        protocolVersion: '1.5',
        clientName: 'test-client',
        clientVersion: '1.0.0',
        capabilities: {
          chunkedIO: true,
        },
      };

      const result = negotiator.negotiate(clientCaps);
      expect(result.protocolVersion).toBe('1.0');
    });

    it('should use AND for boolean capabilities', () => {
      const negotiator = new CapabilityNegotiator();
      const clientCaps: ClientCapabilities = {
        protocolVersion: '1.0',
        clientName: 'test-client',
        clientVersion: '1.0.0',
        capabilities: {
          chunkedIO: false, // Client doesn't support
          atomicWrite: true,
        },
      };

      const result = negotiator.negotiate(clientCaps);
      expect(result.capabilities.chunkedIO).toBe(false); // AND: false && true = false
      expect(result.capabilities.atomicWrite).toBe(true); // AND: true && true = true
    });

    it('should use min for numeric capabilities', () => {
      const negotiator = new CapabilityNegotiator();
      const clientCaps: ClientCapabilities = {
        protocolVersion: '1.0',
        clientName: 'test-client',
        clientVersion: '1.0.0',
        capabilities: {
          maxChunkBytes: 524288, // 512KB (less than worker's 1MB)
          maxInlineFileBytes: 2097152, // 2MB (more than worker's 1MB)
        },
      };

      const result = negotiator.negotiate(clientCaps);
      expect(result.capabilities.maxChunkBytes).toBe(524288); // min(524288, 1048576)
      expect(result.capabilities.maxInlineFileBytes).toBe(1048576); // min(2097152, 1048576)
    });

    it('should use baseline capabilities when client provides no capabilities', () => {
      const negotiator = new CapabilityNegotiator();
      const clientCaps: ClientCapabilities = {
        protocolVersion: '1.0',
        clientName: 'test-client',
        clientVersion: '1.0.0',
        // No capabilities field
      };

      const result = negotiator.negotiate(clientCaps);
      expect(result.capabilities).toEqual(BASELINE_CAPABILITIES);
    });

    it('should default missing boolean capabilities to false', () => {
      const negotiator = new CapabilityNegotiator();
      const clientCaps: ClientCapabilities = {
        protocolVersion: '1.0',
        clientName: 'test-client',
        clientVersion: '1.0.0',
        capabilities: {
          // Only specify some capabilities
          chunkedIO: true,
          // atomicWrite, cancelRequest not specified
        },
      };

      const result = negotiator.negotiate(clientCaps);
      expect(result.capabilities.chunkedIO).toBe(true);
      expect(result.capabilities.atomicWrite).toBe(false); // false && true = false
      expect(result.capabilities.cancelRequest).toBe(false); // false && true = false
    });

    it('should default hostKeyVerification to true when not specified', () => {
      const negotiator = new CapabilityNegotiator();
      const clientCaps: ClientCapabilities = {
        protocolVersion: '1.0',
        clientName: 'test-client',
        clientVersion: '1.0.0',
        capabilities: {
          // hostKeyVerification not specified
        },
      };

      const result = negotiator.negotiate(clientCaps);
      expect(result.capabilities.hostKeyVerification).toBe(true); // true && true = true
    });

    it('should use worker defaults for numeric capabilities when client does not specify', () => {
      const negotiator = new CapabilityNegotiator();
      const clientCaps: ClientCapabilities = {
        protocolVersion: '1.0',
        clientName: 'test-client',
        clientVersion: '1.0.0',
        capabilities: {
          // No numeric capabilities specified
        },
      };

      const result = negotiator.negotiate(clientCaps);
      expect(result.capabilities.maxChunkBytes).toBe(1048576);
      expect(result.capabilities.maxInlineFileBytes).toBe(1048576);
    });
  });

  describe('getBaselineCapabilities', () => {
    it('should return baseline capabilities', () => {
      const baseline = CapabilityNegotiator.getBaselineCapabilities();
      expect(baseline).toEqual(BASELINE_CAPABILITIES);
    });

    it('should return a copy, not the original', () => {
      const baseline1 = CapabilityNegotiator.getBaselineCapabilities();
      const baseline2 = CapabilityNegotiator.getBaselineCapabilities();
      expect(baseline1).not.toBe(baseline2); // Different objects
      expect(baseline1).toEqual(baseline2); // Same values
    });
  });

  describe('enforceCapability', () => {
    it('should not throw for methods that do not require special capabilities', () => {
      const caps = BASELINE_CAPABILITIES;
      expect(() => CapabilityNegotiator.enforceCapability('sftp/readFile', caps)).not.toThrow();
      expect(() => CapabilityNegotiator.enforceCapability('sftp/writeFile', caps)).not.toThrow();
      expect(() => CapabilityNegotiator.enforceCapability('sftp/readdir', caps)).not.toThrow();
      expect(() => CapabilityNegotiator.enforceCapability('sftp/stat', caps)).not.toThrow();
      expect(() => CapabilityNegotiator.enforceCapability('sftp/mkdir', caps)).not.toThrow();
      expect(() => CapabilityNegotiator.enforceCapability('sftp/delete', caps)).not.toThrow();
      expect(() => CapabilityNegotiator.enforceCapability('sftp/rename', caps)).not.toThrow();
    });

    it('should throw UnsupportedOperationError for chunked I/O methods when chunkedIO is false', () => {
      const caps = { ...BASELINE_CAPABILITIES, chunkedIO: false };

      expect(() => CapabilityNegotiator.enforceCapability('sftp/openRead', caps))
        .toThrow(UnsupportedOperationError);
      expect(() => CapabilityNegotiator.enforceCapability('sftp/readChunk', caps))
        .toThrow(UnsupportedOperationError);
      expect(() => CapabilityNegotiator.enforceCapability('sftp/closeRead', caps))
        .toThrow(UnsupportedOperationError);
      expect(() => CapabilityNegotiator.enforceCapability('sftp/openWrite', caps))
        .toThrow(UnsupportedOperationError);
      expect(() => CapabilityNegotiator.enforceCapability('sftp/writeChunk', caps))
        .toThrow(UnsupportedOperationError);
      expect(() => CapabilityNegotiator.enforceCapability('sftp/commitWrite', caps))
        .toThrow(UnsupportedOperationError);
      expect(() => CapabilityNegotiator.enforceCapability('sftp/abortWrite', caps))
        .toThrow(UnsupportedOperationError);
    });

    it('should not throw for chunked I/O methods when chunkedIO is true', () => {
      const caps = { ...BASELINE_CAPABILITIES, chunkedIO: true };

      expect(() => CapabilityNegotiator.enforceCapability('sftp/openRead', caps)).not.toThrow();
      expect(() => CapabilityNegotiator.enforceCapability('sftp/readChunk', caps)).not.toThrow();
      expect(() => CapabilityNegotiator.enforceCapability('sftp/closeRead', caps)).not.toThrow();
      expect(() => CapabilityNegotiator.enforceCapability('sftp/openWrite', caps)).not.toThrow();
      expect(() => CapabilityNegotiator.enforceCapability('sftp/writeChunk', caps)).not.toThrow();
      expect(() => CapabilityNegotiator.enforceCapability('sftp/commitWrite', caps)).not.toThrow();
      expect(() => CapabilityNegotiator.enforceCapability('sftp/abortWrite', caps)).not.toThrow();
    });

    it('should throw UnsupportedOperationError for $/cancelRequest when cancelRequest is false', () => {
      const caps = { ...BASELINE_CAPABILITIES, cancelRequest: false };

      expect(() => CapabilityNegotiator.enforceCapability('$/cancelRequest', caps))
        .toThrow(UnsupportedOperationError);
    });

    it('should not throw for $/cancelRequest when cancelRequest is true', () => {
      const caps = { ...BASELINE_CAPABILITIES, cancelRequest: true };

      expect(() => CapabilityNegotiator.enforceCapability('$/cancelRequest', caps)).not.toThrow();
    });

    it('should include method name and required capability in error', () => {
      const caps = { ...BASELINE_CAPABILITIES, chunkedIO: false };

      try {
        CapabilityNegotiator.enforceCapability('sftp/openRead', caps);
        throw new Error('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(UnsupportedOperationError);
        const error = err as UnsupportedOperationError;
        expect(error.method).toBe('sftp/openRead');
        expect(error.requiredCapability).toBe('chunkedIO');
      }
    });
  });

  describe('version parsing', () => {
    it('should reject invalid version formats', () => {
      const negotiator = new CapabilityNegotiator();

      const invalidVersions = [
        { protocolVersion: '1', clientName: 'test', clientVersion: '1.0.0' },
        { protocolVersion: '1.0.0', clientName: 'test', clientVersion: '1.0.0' },
        { protocolVersion: 'abc', clientName: 'test', clientVersion: '1.0.0' },
        { protocolVersion: '1.x', clientName: 'test', clientVersion: '1.0.0' },
      ];

      for (const clientCaps of invalidVersions) {
        expect(() => negotiator.negotiate(clientCaps as ClientCapabilities)).toThrow();
      }
    });
  });

  describe('custom worker capabilities', () => {
    it('should use custom worker capabilities when provided', () => {
      const customWorker: WorkerCapabilities = {
        protocolVersion: '2.0',
        workerVersion: '1.0.0',
        capabilities: {
          chunkedIO: false,
          atomicWrite: false,
          hostKeyVerification: true,
          cancelRequest: false,
          maxChunkBytes: 524288,
          maxInlineFileBytes: 524288,
        },
      };

      const negotiator = new CapabilityNegotiator(customWorker);
      const clientCaps: ClientCapabilities = {
        protocolVersion: '2.0',
        clientName: 'test-client',
        clientVersion: '1.0.0',
        capabilities: {
          chunkedIO: true,
          atomicWrite: true,
        },
      };

      const result = negotiator.negotiate(clientCaps);
      expect(result.protocolVersion).toBe('2.0');
      expect(result.workerVersion).toBe('1.0.0');
      expect(result.capabilities.chunkedIO).toBe(false); // AND: true && false = false
      expect(result.capabilities.atomicWrite).toBe(false); // AND: true && false = false
      expect(result.capabilities.maxChunkBytes).toBe(524288);
    });
  });
});
