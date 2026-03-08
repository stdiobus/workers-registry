import crypto from 'node:crypto';
import { Session } from './session.js';

export class SessionManager {
  private readonly sessions = new Map<string, Session>();

  createSession(cwd: string): Session {
    const id = crypto.randomUUID();
    const session = new Session(id, cwd);
    this.sessions.set(id, session);
    return session;
  }

  getSession(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  cancelSession(id: string): boolean {
    const session = this.sessions.get(id);
    if (session) {
      session.cancel();
      return true;
    }
    return false;
  }
}
