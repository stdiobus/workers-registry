import { Session } from '../src/session';
import { SessionManager } from '../src/session-manager';

describe('Session', () => {
  it('stores id and cwd on creation', () => {
    const session = new Session('test-id', '/home/user');
    expect(session.id).toBe('test-id');
    expect(session.cwd).toBe('/home/user');
  });

  it('starts with empty history', () => {
    const session = new Session('id', '/cwd');
    expect(session.getHistory()).toEqual([]);
  });

  it('adds and retrieves history entries in order', () => {
    const session = new Session('id', '/cwd');
    session.addHistoryEntry('user', 'Hello');
    session.addHistoryEntry('assistant', 'Hi there');
    session.addHistoryEntry('user', 'How are you?');

    const history = session.getHistory();
    expect(history).toEqual([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
      { role: 'user', content: 'How are you?' },
    ]);
  });

  it('returns a copy of history (not a reference)', () => {
    const session = new Session('id', '/cwd');
    session.addHistoryEntry('user', 'msg');
    const h1 = session.getHistory();
    h1.push({ role: 'assistant', content: 'injected' });
    expect(session.getHistory()).toHaveLength(1);
  });

  it('is not cancelled initially', () => {
    const session = new Session('id', '/cwd');
    expect(session.isCancelled()).toBe(false);
  });

  it('cancel sets isCancelled to true', () => {
    const session = new Session('id', '/cwd');
    session.cancel();
    expect(session.isCancelled()).toBe(true);
  });

  it('cancel aborts the AbortController signal', () => {
    const session = new Session('id', '/cwd');
    const signal = session.getAbortSignal();
    expect(signal.aborted).toBe(false);
    session.cancel();
    expect(signal.aborted).toBe(true);
  });

  it('resetCancellation clears cancelled flag and creates new AbortController', () => {
    const session = new Session('id', '/cwd');
    session.cancel();
    expect(session.isCancelled()).toBe(true);

    session.resetCancellation();
    expect(session.isCancelled()).toBe(false);
    expect(session.getAbortSignal().aborted).toBe(false);
  });

  it('old signal stays aborted after resetCancellation', () => {
    const session = new Session('id', '/cwd');
    const oldSignal = session.getAbortSignal();
    session.cancel();
    session.resetCancellation();
    expect(oldSignal.aborted).toBe(true);
    expect(session.getAbortSignal().aborted).toBe(false);
  });
});

describe('SessionManager', () => {
  it('creates sessions with unique IDs', () => {
    const manager = new SessionManager();
    const s1 = manager.createSession('/cwd1');
    const s2 = manager.createSession('/cwd2');
    expect(s1.id).not.toBe(s2.id);
  });

  it('stores cwd in created session', () => {
    const manager = new SessionManager();
    const session = manager.createSession('/my/dir');
    expect(session.cwd).toBe('/my/dir');
  });

  it('retrieves session by ID', () => {
    const manager = new SessionManager();
    const session = manager.createSession('/cwd');
    const retrieved = manager.getSession(session.id);
    expect(retrieved).toBe(session);
  });

  it('returns undefined for unknown session ID', () => {
    const manager = new SessionManager();
    expect(manager.getSession('nonexistent')).toBeUndefined();
  });

  it('cancels existing session and returns true', () => {
    const manager = new SessionManager();
    const session = manager.createSession('/cwd');
    const result = manager.cancelSession(session.id);
    expect(result).toBe(true);
    expect(session.isCancelled()).toBe(true);
  });

  it('returns false when cancelling nonexistent session', () => {
    const manager = new SessionManager();
    expect(manager.cancelSession('unknown')).toBe(false);
  });
});
