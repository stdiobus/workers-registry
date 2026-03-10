import * as fc from 'fast-check';
import { Session } from '../src/session';
import { SessionManager } from '../src/session-manager';

/**
 * Property-based tests for session and session manager modules.
 *
 * Feature: openai-acp-agent
 * Properties 2, 3, 4, 9 from design document.
 */

describe('Session property tests', () => {
  /**
   * Property 2: Session creation preserves inputs and guarantees uniqueness.
   *
   * For any cwd string, calling createSession(cwd) produces a session with
   * a unique UUID id, the given cwd stored, and an empty message history.
   * For any two sessions created, their id values are distinct.
   *
   * **Validates: Requirements 2.1, 2.2**
   */
  it('Property 2: session creation preserves cwd, has empty history, and unique IDs', () => {
    fc.assert(
      fc.property(
        fc.string(),
        (cwd) => {
          const manager = new SessionManager();
          const session = manager.createSession(cwd);

          expect(session.cwd).toBe(cwd);
          expect(session.getHistory()).toEqual([]);
          expect(session.id).toBeDefined();
          expect(typeof session.id).toBe('string');
          expect(session.id.length).toBeGreaterThan(0);

          // Verify the session is retrievable
          expect(manager.getSession(session.id)).toBe(session);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property 2: multiple sessions have distinct IDs', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string(), { minLength: 2, maxLength: 20 }),
        (cwds) => {
          const manager = new SessionManager();
          const sessions = cwds.map((cwd) => manager.createSession(cwd));
          const ids = sessions.map((s) => s.id);
          const uniqueIds = new Set(ids);

          expect(uniqueIds.size).toBe(ids.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Property 3: History accumulation preserves order and content.
   *
   * For any sequence of (role, content) pairs added to a session via
   * addHistoryEntry(), calling getHistory() returns entries in the same
   * order with identical role and content values.
   *
   * **Validates: Requirements 2.3**
   */
  it('Property 3: history accumulation preserves order and content', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.constantFrom('user' as const, 'assistant' as const),
            fc.string(),
          ),
          { minLength: 0, maxLength: 50 },
        ),
        (entries) => {
          const session = new Session('test-id', '/tmp');

          for (const [role, content] of entries) {
            session.addHistoryEntry(role, content);
          }

          const history = session.getHistory();

          expect(history.length).toBe(entries.length);
          for (let i = 0; i < entries.length; i++) {
            expect(history[i].role).toBe(entries[i][0]);
            expect(history[i].content).toBe(entries[i][1]);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Property 4: Non-existent session ID returns error.
   *
   * For any string that has not been used to create a session,
   * getSession() returns undefined.
   *
   * **Validates: Requirements 2.4**
   */
  it('Property 4: non-existent session ID returns undefined', () => {
    fc.assert(
      fc.property(
        fc.string(),
        (randomId) => {
          const manager = new SessionManager();
          // Do not create any session with this ID
          const result = manager.getSession(randomId);

          expect(result).toBeUndefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Property 9: Cancellation aborts active request.
   *
   * For any session with an active AbortController, calling cancel()
   * causes the AbortController's signal to be aborted, and isCancelled()
   * returns true. After resetCancellation(), isCancelled() returns false
   * and a fresh AbortController signal is provided.
   *
   * **Validates: Requirements 5.1, 5.3**
   */
  it('Property 9: cancel() aborts signal and isCancelled() returns true', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.string(),
        (id, cwd) => {
          const session = new Session(id, cwd);

          // Initially not cancelled
          expect(session.isCancelled()).toBe(false);
          expect(session.getAbortSignal().aborted).toBe(false);

          // Cancel the session
          session.cancel();

          expect(session.isCancelled()).toBe(true);
          expect(session.getAbortSignal().aborted).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property 9: resetCancellation() creates fresh controller', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.string(),
        (id, cwd) => {
          const session = new Session(id, cwd);

          // Cancel then reset
          session.cancel();
          expect(session.isCancelled()).toBe(true);

          const oldSignal = session.getAbortSignal();
          session.resetCancellation();

          expect(session.isCancelled()).toBe(false);
          const newSignal = session.getAbortSignal();
          expect(newSignal.aborted).toBe(false);
          // New signal is a different object from the old aborted one
          expect(newSignal).not.toBe(oldSignal);
        },
      ),
      { numRuns: 100 },
    );
  });
});
