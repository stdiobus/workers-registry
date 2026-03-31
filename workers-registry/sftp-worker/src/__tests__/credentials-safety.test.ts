/**
 * Property-based tests for credentials safety
 * 
 * Property 4: Credentials never leak to logs
 * 
 * For any sftp/connect operation with any values of password, privateKey,
 * and passphrase, stderr output must NOT contain these values.
 * stderr MUST contain host, port, username, and authType.
 */

import * as fc from 'fast-check';
import { SessionManager } from '../session-manager.js';
import { handleConnect } from '../rpc/sftp-session-methods.js';

describe('Property 4: Credentials never leak to logs', () => {
  let consoleErrorSpy: jest.SpyInstance;
  let loggedMessages: string[];

  beforeEach(() => {
    // Capture all console.error calls
    loggedMessages = [];
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((...args: any[]) => {
      loggedMessages.push(args.join(' '));
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('should never log password in any log message', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          host: fc.domain().filter(h => h.length > 2),
          port: fc.integer({ min: 1, max: 65535 }),
          username: fc.string({ minLength: 2, maxLength: 32 }).filter(u => u.trim().length > 1),
          password: fc.hexaString({ minLength: 16, maxLength: 64 }).map(s => `pwd_${s}`),
        }),
        async ({ host, port, username, password }) => {
          loggedMessages = []; // Clear for each iteration

          const sessionManager = new SessionManager();
          const sessionId = `test-${Date.now()}-${Math.random()}`;
          sessionManager.createSession(sessionId);

          const params = {
            host,
            port,
            username,
            authType: 'password' as const,
            password,
            timeout: 100, // Fast timeout to avoid hanging
          };

          try {
            await handleConnect(params, sessionId, sessionManager);
          } catch (error) {
            // Expected to fail - no real SFTP server
          }

          // Collect all logged messages
          const allLogs = loggedMessages.join('\n');

          // MUST NOT contain password
          expect(allLogs).not.toContain(password);

          // MUST contain safe fields
          expect(allLogs).toContain(host);
          expect(allLogs).toContain(String(port));
          expect(allLogs).toContain(username);
          expect(allLogs).toContain('password'); // authType
        }
      ),
      { numRuns: 20 }
    );
  }, 120000); // 120 second timeout for property test

  it('should never log privateKey in any log message', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          host: fc.domain().filter(h => h.length > 2),
          port: fc.integer({ min: 1, max: 65535 }),
          username: fc.string({ minLength: 2, maxLength: 32 }).filter(u => u.trim().length > 1),
          privateKey: fc.hexaString({ minLength: 64, maxLength: 256 }).map(s => `key_${s}`),
        }),
        async ({ host, port, username, privateKey }) => {
          loggedMessages = [];

          const sessionManager = new SessionManager();
          const sessionId = `test-${Date.now()}-${Math.random()}`;
          sessionManager.createSession(sessionId);

          const params = {
            host,
            port,
            username,
            authType: 'privateKey' as const,
            privateKey,
            timeout: 100,
          };

          try {
            await handleConnect(params, sessionId, sessionManager);
          } catch (error) {
            // Expected to fail
          }

          const allLogs = loggedMessages.join('\n');

          // MUST NOT contain privateKey
          expect(allLogs).not.toContain(privateKey);

          // MUST contain safe fields
          expect(allLogs).toContain(host);
          expect(allLogs).toContain(String(port));
          expect(allLogs).toContain(username);
          expect(allLogs).toContain('privateKey'); // authType
        }
      ),
      { numRuns: 20 }
    );
  }, 120000);

  it('should never log passphrase in any log message', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          host: fc.domain().filter(h => h.length > 2),
          port: fc.integer({ min: 1, max: 65535 }),
          username: fc.string({ minLength: 2, maxLength: 32 }).filter(u => u.trim().length > 1),
          privateKey: fc.hexaString({ minLength: 64, maxLength: 256 }).map(s => `key_${s}`),
          passphrase: fc.hexaString({ minLength: 16, maxLength: 64 }).map(s => `pass_${s}`),
        }),
        async ({ host, port, username, privateKey, passphrase }) => {
          loggedMessages = [];

          const sessionManager = new SessionManager();
          const sessionId = `test-${Date.now()}-${Math.random()}`;
          sessionManager.createSession(sessionId);

          const params = {
            host,
            port,
            username,
            authType: 'privateKey' as const,
            privateKey,
            passphrase,
            timeout: 100,
          };

          try {
            await handleConnect(params, sessionId, sessionManager);
          } catch (error) {
            // Expected to fail
          }

          const allLogs = loggedMessages.join('\n');

          // MUST NOT contain passphrase or privateKey
          expect(allLogs).not.toContain(passphrase);
          expect(allLogs).not.toContain(privateKey);

          // MUST contain safe fields
          expect(allLogs).toContain(host);
          expect(allLogs).toContain(String(port));
          expect(allLogs).toContain(username);
        }
      ),
      { numRuns: 20 }
    );
  }, 120000);

  it('should log safe fields for connection attempts', async () => {
    loggedMessages = [];

    const sessionManager = new SessionManager();
    const sessionId = 'test-session';
    sessionManager.createSession(sessionId);

    const params = {
      host: 'nonexistent-host-12345.invalid',
      port: 2222,
      username: 'testuser',
      authType: 'password' as const,
      password: 'super-secret-password-12345',
      timeout: 100, // Fast fail
    };

    try {
      await handleConnect(params, sessionId, sessionManager);
    } catch (error) {
      // Expected to fail
    }

    const allLogs = loggedMessages.join('\n');

    // Verify safe fields are logged
    expect(allLogs).toContain('nonexistent-host-12345.invalid');
    expect(allLogs).toContain('2222');
    expect(allLogs).toContain('testuser');
    expect(allLogs).toContain('password'); // authType

    // Verify password is NOT logged
    expect(allLogs).not.toContain('super-secret-password-12345');
  });
});
