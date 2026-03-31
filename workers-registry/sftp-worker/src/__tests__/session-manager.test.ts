/**
 * Unit tests for SessionManager
 * 
 * Tests session lifecycle, state machine transitions, and resource cleanup.
 */

import { SessionManager } from '../session-manager.js';
import { SftpError } from '../types.js';
import { NO_ACTIVE_CONNECTION, SESSION_CLOSING } from '../error-codes.js';

describe('SessionManager', () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager(10);
  });

  describe('createSession', () => {
    it('should create a session in idle state', () => {
      const session = manager.createSession('sess-1');

      expect(session.sessionId).toBe('sess-1');
      expect(session.state).toBe('idle');
      expect(session.backend).toBeNull();
      expect(session.inFlightRequests.size).toBe(0);
      expect(session.createdAt).toBeGreaterThan(0);
    });

    it('should use baseline capabilities by default', () => {
      const session = manager.createSession('sess-1');

      expect(session.capabilities).toEqual({
        chunkedIO: false,
        atomicWrite: false,
        hostKeyVerification: true,
        maxChunkBytes: 1048576,
        maxInlineFileBytes: 1048576,
        cancelRequest: false,
      });
    });

    it('should accept custom capabilities', () => {
      const customCaps = {
        chunkedIO: true,
        atomicWrite: true,
        hostKeyVerification: true,
        maxChunkBytes: 2097152,
        maxInlineFileBytes: 2097152,
        cancelRequest: true,
      };

      const session = manager.createSession('sess-1', customCaps);

      expect(session.capabilities).toEqual(customCaps);
    });

    it('should throw if session already exists', () => {
      manager.createSession('sess-1');

      expect(() => manager.createSession('sess-1')).toThrow(
        'Session sess-1 already exists'
      );
    });
  });

  describe('getSession', () => {
    it('should return session if exists', () => {
      const created = manager.createSession('sess-1');
      const retrieved = manager.getSession('sess-1');

      expect(retrieved).toBe(created);
    });

    it('should return undefined if session does not exist', () => {
      const retrieved = manager.getSession('nonexistent');

      expect(retrieved).toBeUndefined();
    });
  });

  describe('validateTransition - idle state', () => {
    it('should allow sftp/initialize in idle state', () => {
      const session = manager.createSession('sess-1');

      expect(() => manager.validateTransition(session, 'sftp/initialize')).not.toThrow();
    });

    it('should allow sftp/connect in idle state', () => {
      const session = manager.createSession('sess-1');

      expect(() => manager.validateTransition(session, 'sftp/connect')).not.toThrow();
    });

    it('should reject other methods in idle state with NO_ACTIVE_CONNECTION', () => {
      const session = manager.createSession('sess-1');

      const methods = [
        'sftp/readdir',
        'sftp/readFile',
        'sftp/writeFile',
        'sftp/stat',
        'sftp/mkdir',
        'sftp/delete',
        'sftp/rename',
        'sftp/disconnect',
      ];

      for (const method of methods) {
        try {
          manager.validateTransition(session, method);
          throw new Error(`Expected ${method} to throw in idle state`);
        } catch (err) {
          expect(err).toBeInstanceOf(SftpError);
          expect((err as SftpError).code).toBe(NO_ACTIVE_CONNECTION);
          expect((err as SftpError).message).toContain('No active connection');
        }
      }
    });
  });

  describe('validateTransition - connecting state', () => {
    it('should allow $/cancelRequest in connecting state', () => {
      const session = manager.createSession('sess-1');
      manager.transitionTo(session, 'connecting');

      expect(() => manager.validateTransition(session, '$/cancelRequest')).not.toThrow();
    });

    it('should reject other methods in connecting state with SESSION_CLOSING', () => {
      const session = manager.createSession('sess-1');
      manager.transitionTo(session, 'connecting');

      const methods = [
        'sftp/initialize',
        'sftp/connect',
        'sftp/readdir',
        'sftp/disconnect',
      ];

      for (const method of methods) {
        try {
          manager.validateTransition(session, method);
          throw new Error(`Expected ${method} to throw in connecting state`);
        } catch (err) {
          expect(err).toBeInstanceOf(SftpError);
          expect((err as SftpError).code).toBe(SESSION_CLOSING);
          expect((err as SftpError).message).toContain('is connecting');
        }
      }
    });
  });

  describe('validateTransition - active state', () => {
    it('should allow all SFTP methods in active state', () => {
      const session = manager.createSession('sess-1');
      manager.transitionTo(session, 'connecting');
      manager.transitionTo(session, 'active');

      const methods = [
        'sftp/readdir',
        'sftp/readFile',
        'sftp/writeFile',
        'sftp/stat',
        'sftp/mkdir',
        'sftp/delete',
        'sftp/rename',
        'sftp/disconnect',
        'sftp/openRead',
        'sftp/readChunk',
        'sftp/closeRead',
      ];

      for (const method of methods) {
        expect(() => manager.validateTransition(session, method)).not.toThrow();
      }
    });
  });

  describe('validateTransition - closing state', () => {
    it('should reject all new requests in closing state with SESSION_CLOSING', () => {
      const session = manager.createSession('sess-1');
      manager.transitionTo(session, 'connecting');
      manager.transitionTo(session, 'active');
      manager.transitionTo(session, 'closing');

      const methods = [
        'sftp/readdir',
        'sftp/readFile',
        'sftp/disconnect',
        '$/cancelRequest',
      ];

      for (const method of methods) {
        try {
          manager.validateTransition(session, method);
          throw new Error(`Expected ${method} to throw in closing state`);
        } catch (err) {
          expect(err).toBeInstanceOf(SftpError);
          expect((err as SftpError).code).toBe(SESSION_CLOSING);
          expect((err as SftpError).message).toContain('is closing');
        }
      }
    });
  });

  describe('validateTransition - closed state', () => {
    it('should reject all requests in closed state with NO_ACTIVE_CONNECTION', () => {
      const session = manager.createSession('sess-1');
      manager.transitionTo(session, 'connecting');
      manager.transitionTo(session, 'closed');

      const methods = [
        'sftp/connect',
        'sftp/readdir',
        'sftp/disconnect',
      ];

      for (const method of methods) {
        try {
          manager.validateTransition(session, method);
          throw new Error(`Expected ${method} to throw in closed state`);
        } catch (err) {
          expect(err).toBeInstanceOf(SftpError);
          expect((err as SftpError).code).toBe(NO_ACTIVE_CONNECTION);
          expect((err as SftpError).message).toContain('is closed');
        }
      }
    });
  });

  describe('transitionTo', () => {
    it('should allow idle → connecting', () => {
      const session = manager.createSession('sess-1');

      manager.transitionTo(session, 'connecting');

      expect(session.state).toBe('connecting');
    });

    it('should allow connecting → active', () => {
      const session = manager.createSession('sess-1');
      manager.transitionTo(session, 'connecting');

      manager.transitionTo(session, 'active');

      expect(session.state).toBe('active');
    });

    it('should allow connecting → closed', () => {
      const session = manager.createSession('sess-1');
      manager.transitionTo(session, 'connecting');

      manager.transitionTo(session, 'closed');

      expect(session.state).toBe('closed');
    });

    it('should allow active → closing', () => {
      const session = manager.createSession('sess-1');
      manager.transitionTo(session, 'connecting');
      manager.transitionTo(session, 'active');

      manager.transitionTo(session, 'closing');

      expect(session.state).toBe('closing');
    });

    it('should allow active → closed', () => {
      const session = manager.createSession('sess-1');
      manager.transitionTo(session, 'connecting');
      manager.transitionTo(session, 'active');

      manager.transitionTo(session, 'closed');

      expect(session.state).toBe('closed');
    });

    it('should allow closing → closed', () => {
      const session = manager.createSession('sess-1');
      manager.transitionTo(session, 'connecting');
      manager.transitionTo(session, 'active');
      manager.transitionTo(session, 'closing');

      manager.transitionTo(session, 'closed');

      expect(session.state).toBe('closed');
    });

    it('should reject invalid transitions', () => {
      const session = manager.createSession('sess-1');

      // idle → active (must go through connecting)
      expect(() => manager.transitionTo(session, 'active')).toThrow(
        'Invalid state transition'
      );

      // idle → closing
      expect(() => manager.transitionTo(session, 'closing')).toThrow(
        'Invalid state transition'
      );
    });

    it('should cleanup resources when transitioning to closed', () => {
      const session = manager.createSession('sess-1');
      manager.transitionTo(session, 'connecting');
      manager.transitionTo(session, 'active');

      // Add some in-flight requests
      const controller1 = new AbortController();
      const controller2 = new AbortController();
      session.inFlightRequests.set(1, controller1);
      session.inFlightRequests.set(2, controller2);

      // Mock backend
      session.backend = { connected: true };

      manager.transitionTo(session, 'closed');

      // Verify cleanup
      expect(session.inFlightRequests.size).toBe(0);
      expect(session.backend).toBeNull();
      expect(controller1.signal.aborted).toBe(true);
      expect(controller2.signal.aborted).toBe(true);
    });
  });

  describe('destroySession', () => {
    it('should remove session from map', async () => {
      manager.createSession('sess-1');

      await manager.destroySession('sess-1');

      expect(manager.getSession('sess-1')).toBeUndefined();
      expect(manager.sessionCount).toBe(0);
    });

    it('should transition to closed before removing', async () => {
      const session = manager.createSession('sess-1');
      manager.transitionTo(session, 'connecting');
      manager.transitionTo(session, 'active');

      await manager.destroySession('sess-1');

      // Session should be removed
      expect(manager.getSession('sess-1')).toBeUndefined();
    });

    it('should be idempotent', async () => {
      manager.createSession('sess-1');

      await manager.destroySession('sess-1');
      await manager.destroySession('sess-1'); // Second call should not throw

      expect(manager.getSession('sess-1')).toBeUndefined();
    });
  });

  describe('destroyAll', () => {
    it('should destroy all sessions', async () => {
      manager.createSession('sess-1');
      manager.createSession('sess-2');
      manager.createSession('sess-3');

      expect(manager.sessionCount).toBe(3);

      await manager.destroyAll();

      expect(manager.sessionCount).toBe(0);
      expect(manager.getSession('sess-1')).toBeUndefined();
      expect(manager.getSession('sess-2')).toBeUndefined();
      expect(manager.getSession('sess-3')).toBeUndefined();
    });

    it('should handle empty session map', async () => {
      await manager.destroyAll();

      expect(manager.sessionCount).toBe(0);
    });
  });

  describe('capacity management', () => {
    it('should track session count', () => {
      expect(manager.sessionCount).toBe(0);

      manager.createSession('sess-1');
      expect(manager.sessionCount).toBe(1);

      manager.createSession('sess-2');
      expect(manager.sessionCount).toBe(2);
    });

    it('should check if at capacity', () => {
      const smallManager = new SessionManager(2);

      expect(smallManager.isAtCapacity()).toBe(false);

      smallManager.createSession('sess-1');
      expect(smallManager.isAtCapacity()).toBe(false);

      smallManager.createSession('sess-2');
      expect(smallManager.isAtCapacity()).toBe(true);
    });

    it('should list all session IDs', () => {
      manager.createSession('sess-1');
      manager.createSession('sess-2');
      manager.createSession('sess-3');

      const ids = manager.sessionIds;

      expect(ids).toHaveLength(3);
      expect(ids).toContain('sess-1');
      expect(ids).toContain('sess-2');
      expect(ids).toContain('sess-3');
    });
  });

  describe('connection loss scenario', () => {
    it('should handle connection loss by transitioning to closed', () => {
      const session = manager.createSession('sess-1');
      manager.transitionTo(session, 'connecting');
      manager.transitionTo(session, 'active');

      // Simulate connection loss
      manager.transitionTo(session, 'closed');

      expect(session.state).toBe('closed');
      expect(session.backend).toBeNull();
    });

    it('should abort in-flight requests on connection loss', () => {
      const session = manager.createSession('sess-1');
      manager.transitionTo(session, 'connecting');
      manager.transitionTo(session, 'active');

      const controller = new AbortController();
      session.inFlightRequests.set(1, controller);

      // Simulate connection loss
      manager.transitionTo(session, 'closed');

      expect(controller.signal.aborted).toBe(true);
      expect(session.inFlightRequests.size).toBe(0);
    });
  });
});
