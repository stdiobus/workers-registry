/**
 * Unit tests for Session and SessionManager
 *
 * Tests session creation, cancellation, and invalid session handling.
 *
 * @module session/session.test
 */
import { type MCPManagerFactory, Session } from './session.js';
import { SessionManager } from './manager.js';
import type { MCPManager } from '../mcp/index.js';

/**
 * Create a mock MCPManager for testing.
 */
function createMockMcpManager(): MCPManager {
  return {
    connect: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
    abortPendingOperations: jest.fn(),
    listTools: jest.fn().mockResolvedValue([]),
    callTool: jest.fn(),
    listResources: jest.fn().mockResolvedValue([]),
    readResource: jest.fn(),
    getConnection: jest.fn(),
    getAllConnections: jest.fn().mockReturnValue([]),
    getServerCapabilities: jest.fn(),
    setOnServerCrash: jest.fn(),
    isServerCrashed: jest.fn().mockReturnValue(false),
    getServerCrashError: jest.fn(),
    getCrashedServers: jest.fn().mockReturnValue([]),
  } as unknown as MCPManager;
}

describe('Session', () => {
  let session: Session;
  let mockMcpManager: MCPManager;
  const testId = 'test-session-id';
  const testCwd = '/test/working/directory';

  beforeEach(() => {
    mockMcpManager = createMockMcpManager();
    const mockFactory: MCPManagerFactory = () => mockMcpManager;
    session = new Session(testId, testCwd, mockFactory);
  });

  describe('constructor', () => {
    it('should create a session with the provided id', () => {
      expect(session.id).toBe(testId);
    });

    it('should create a session with the provided cwd', () => {
      expect(session.cwd).toBe(testCwd);
    });

    it('should initialize with cancelled flag set to false', () => {
      expect(session.isCancelled()).toBe(false);
    });

    it('should initialize with empty history', () => {
      expect(session.getHistory()).toEqual([]);
    });
  });

  describe('isCancelled()', () => {
    it('should return false initially', () => {
      expect(session.isCancelled()).toBe(false);
    });

    it('should return true after cancel() is called', () => {
      session.cancel();
      expect(session.isCancelled()).toBe(true);
    });
  });

  describe('cancel()', () => {
    it('should set the cancellation flag to true', () => {
      expect(session.isCancelled()).toBe(false);
      session.cancel();
      expect(session.isCancelled()).toBe(true);
    });

    it('should call abortPendingOperations on mcpManager', () => {
      session.cancel();
      expect(session.mcpManager.abortPendingOperations).toHaveBeenCalled();
    });

    it('should remain cancelled after multiple cancel() calls', () => {
      session.cancel();
      session.cancel();
      expect(session.isCancelled()).toBe(true);
    });
  });

  describe('getState()', () => {
    it('should return correct state with id', () => {
      const state = session.getState();
      expect(state.id).toBe(testId);
    });

    it('should return correct state with cwd', () => {
      const state = session.getState();
      expect(state.cwd).toBe(testCwd);
    });

    it('should return correct cancelled flag when not cancelled', () => {
      const state = session.getState();
      expect(state.cancelled).toBe(false);
    });

    it('should return correct cancelled flag when cancelled', () => {
      session.cancel();
      const state = session.getState();
      expect(state.cancelled).toBe(true);
    });

    it('should return createdAt timestamp', () => {
      const state = session.getState();
      expect(state.createdAt).toBeInstanceOf(Date);
    });

    it('should return empty history initially', () => {
      const state = session.getState();
      expect(state.history).toEqual([]);
    });

    it('should return a copy of history (not the original array)', () => {
      session.addHistoryEntry('user', 'test message');
      const state1 = session.getState();
      const state2 = session.getState();
      expect(state1.history).not.toBe(state2.history);
      expect(state1.history).toEqual(state2.history);
    });
  });

  describe('addHistoryEntry()', () => {
    it('should add a user message to history', () => {
      session.addHistoryEntry('user', 'Hello');
      const history = session.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0].role).toBe('user');
      expect(history[0].content).toBe('Hello');
    });

    it('should add an agent message to history', () => {
      session.addHistoryEntry('agent', 'Hi there');
      const history = session.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0].role).toBe('agent');
      expect(history[0].content).toBe('Hi there');
    });

    it('should add timestamp to history entry', () => {
      const beforeAdd = new Date();
      session.addHistoryEntry('user', 'Test');
      const afterAdd = new Date();

      const history = session.getHistory();
      expect(history[0].timestamp).toBeInstanceOf(Date);
      expect(history[0].timestamp.getTime()).toBeGreaterThanOrEqual(beforeAdd.getTime());
      expect(history[0].timestamp.getTime()).toBeLessThanOrEqual(afterAdd.getTime());
    });

    it('should preserve order of multiple entries', () => {
      session.addHistoryEntry('user', 'First');
      session.addHistoryEntry('agent', 'Second');
      session.addHistoryEntry('user', 'Third');

      const history = session.getHistory();
      expect(history).toHaveLength(3);
      expect(history[0].content).toBe('First');
      expect(history[1].content).toBe('Second');
      expect(history[2].content).toBe('Third');
    });
  });

  describe('getHistory()', () => {
    it('should return empty array initially', () => {
      expect(session.getHistory()).toEqual([]);
    });

    it('should return all history entries', () => {
      session.addHistoryEntry('user', 'Message 1');
      session.addHistoryEntry('agent', 'Message 2');

      const history = session.getHistory();
      expect(history).toHaveLength(2);
    });

    it('should return a copy of history (not the original array)', () => {
      session.addHistoryEntry('user', 'Test');
      const history1 = session.getHistory();
      const history2 = session.getHistory();
      expect(history1).not.toBe(history2);
      expect(history1).toEqual(history2);
    });
  });

  describe('clearHistory()', () => {
    it('should clear all history entries', () => {
      session.addHistoryEntry('user', 'Message 1');
      session.addHistoryEntry('agent', 'Message 2');
      expect(session.getHistory()).toHaveLength(2);

      session.clearHistory();
      expect(session.getHistory()).toEqual([]);
    });

    it('should allow adding new entries after clearing', () => {
      session.addHistoryEntry('user', 'Old message');
      session.clearHistory();
      session.addHistoryEntry('user', 'New message');

      const history = session.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0].content).toBe('New message');
    });
  });

  describe('close()', () => {
    it('should call close on mcpManager', async () => {
      await session.close();
      expect(session.mcpManager.close).toHaveBeenCalled();
    });
  });
});


describe('SessionManager', () => {
  let manager: SessionManager;
  let mockMcpManager: MCPManager;
  let mockFactory: MCPManagerFactory;

  beforeEach(() => {
    mockMcpManager = createMockMcpManager();
    mockFactory = () => mockMcpManager;
    manager = new SessionManager(mockFactory);
  });

  afterEach(async () => {
    await manager.closeAll();
  });

  describe('createSession()', () => {
    it('should create a session with a unique ID', async () => {
      const session = await manager.createSession('/test/cwd');
      expect(session.id).toBeDefined();
      expect(typeof session.id).toBe('string');
      expect(session.id.length).toBeGreaterThan(0);
    });

    it('should create a session with the provided cwd', async () => {
      const cwd = '/my/working/directory';
      const session = await manager.createSession(cwd);
      expect(session.cwd).toBe(cwd);
    });

    it('should create sessions with unique IDs', async () => {
      const session1 = await manager.createSession('/cwd1');
      const session2 = await manager.createSession('/cwd2');
      const session3 = await manager.createSession('/cwd3');

      expect(session1.id).not.toBe(session2.id);
      expect(session2.id).not.toBe(session3.id);
      expect(session1.id).not.toBe(session3.id);
    });

    it('should generate UUID format session IDs', async () => {
      const session = await manager.createSession('/test');
      // UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      expect(session.id).toMatch(uuidRegex);
    });

    it('should store the session for later retrieval', async () => {
      const session = await manager.createSession('/test');
      const retrieved = manager.getSession(session.id);
      expect(retrieved).toBe(session);
    });

    it('should connect to MCP servers when provided', async () => {
      const mcpServers = [
        { id: 'server1', command: 'node', args: ['server.js'] },
      ];
      const session = await manager.createSession('/test', mcpServers);
      expect(session.mcpManager.connect).toHaveBeenCalledWith(mcpServers);
    });

    it('should not connect to MCP servers when not provided', async () => {
      const session = await manager.createSession('/test');
      expect(session.mcpManager.connect).not.toHaveBeenCalled();
    });

    it('should not connect to MCP servers when empty array provided', async () => {
      const session = await manager.createSession('/test', []);
      expect(session.mcpManager.connect).not.toHaveBeenCalled();
    });
  });

  describe('getSession()', () => {
    it('should return the correct session by ID', async () => {
      const session1 = await manager.createSession('/cwd1');
      const session2 = await manager.createSession('/cwd2');

      expect(manager.getSession(session1.id)).toBe(session1);
      expect(manager.getSession(session2.id)).toBe(session2);
    });

    it('should return undefined for unknown session ID', () => {
      const result = manager.getSession('non-existent-id');
      expect(result).toBeUndefined();
    });

    it('should return undefined for empty string ID', () => {
      const result = manager.getSession('');
      expect(result).toBeUndefined();
    });

    it('should return undefined after session is closed', async () => {
      const session = await manager.createSession('/test');
      const sessionId = session.id;

      await manager.closeSession(sessionId);
      expect(manager.getSession(sessionId)).toBeUndefined();
    });
  });

  describe('cancelSession()', () => {
    it('should cancel the session and return true', async () => {
      const session = await manager.createSession('/test');

      const result = manager.cancelSession(session.id);

      expect(result).toBe(true);
      expect(session.isCancelled()).toBe(true);
    });

    it('should return false for unknown session ID', () => {
      const result = manager.cancelSession('non-existent-id');
      expect(result).toBe(false);
    });

    it('should return false for empty string ID', () => {
      const result = manager.cancelSession('');
      expect(result).toBe(false);
    });

    it('should not affect other sessions when cancelling one', async () => {
      const session1 = await manager.createSession('/cwd1');
      const session2 = await manager.createSession('/cwd2');

      manager.cancelSession(session1.id);

      expect(session1.isCancelled()).toBe(true);
      expect(session2.isCancelled()).toBe(false);
    });

    it('should return true even if session is already cancelled', async () => {
      const session = await manager.createSession('/test');

      manager.cancelSession(session.id);
      const result = manager.cancelSession(session.id);

      expect(result).toBe(true);
    });
  });

  describe('closeSession()', () => {
    it('should close the session and return true', async () => {
      const session = await manager.createSession('/test');
      const sessionId = session.id;

      const result = await manager.closeSession(sessionId);

      expect(result).toBe(true);
      expect(session.mcpManager.close).toHaveBeenCalled();
    });

    it('should remove the session from the manager', async () => {
      const session = await manager.createSession('/test');
      const sessionId = session.id;

      await manager.closeSession(sessionId);

      expect(manager.getSession(sessionId)).toBeUndefined();
    });

    it('should return false for unknown session ID', async () => {
      const result = await manager.closeSession('non-existent-id');
      expect(result).toBe(false);
    });

    it('should return false for empty string ID', async () => {
      const result = await manager.closeSession('');
      expect(result).toBe(false);
    });

    it('should not affect other sessions when closing one', async () => {
      const session1 = await manager.createSession('/cwd1');
      const session2 = await manager.createSession('/cwd2');

      await manager.closeSession(session1.id);

      expect(manager.getSession(session1.id)).toBeUndefined();
      expect(manager.getSession(session2.id)).toBe(session2);
    });
  });

  describe('closeAll()', () => {
    it('should close all sessions', async () => {
      const session1 = await manager.createSession('/cwd1');
      const session2 = await manager.createSession('/cwd2');
      const session3 = await manager.createSession('/cwd3');

      await manager.closeAll();

      expect(session1.mcpManager.close).toHaveBeenCalled();
      expect(session2.mcpManager.close).toHaveBeenCalled();
      expect(session3.mcpManager.close).toHaveBeenCalled();
    });

    it('should remove all sessions from the manager', async () => {
      const session1 = await manager.createSession('/cwd1');
      const session2 = await manager.createSession('/cwd2');

      await manager.closeAll();

      expect(manager.getSession(session1.id)).toBeUndefined();
      expect(manager.getSession(session2.id)).toBeUndefined();
    });

    it('should handle empty manager gracefully', async () => {
      // Should not throw
      await expect(manager.closeAll()).resolves.toBeUndefined();
    });

    it('should allow creating new sessions after closeAll', async () => {
      await manager.createSession('/cwd1');
      await manager.closeAll();

      const newSession = await manager.createSession('/cwd2');
      expect(manager.getSession(newSession.id)).toBe(newSession);
    });
  });
});
