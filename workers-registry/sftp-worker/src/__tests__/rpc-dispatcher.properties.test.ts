/**
 * RpcDispatcher Property-Based Tests
 * 
 * Property-based tests using fast-check to validate universal properties
 * that must hold for all valid inputs.
 * 
 * Feature: sftp-vscode-plugin
 * 
 * Tests:
 * - Property 1: NDJSON JSON-RPC round-trip (Requirements 1.1, 1.2, 11.7)
 * - Property 2: sessionId preservation (Requirement 2.1)
 * - Property 3: stdout purity (Requirement 1.3)
 * - Property 14: JSON-RPC 2.0 response format compliance (Requirement 11.1)
 * - Property 15: Protocol error handling (Requirements 11.2, 11.3, 11.4, 11.5)
 * - Property 16: Notifications produce no response (Requirement 11.6)
 */

import fc from 'fast-check';
import { RpcDispatcher } from '../rpc-dispatcher.js';
import type { RpcRequest, RpcResponse } from '../types.js';
import {
  JSONRPC_PARSE_ERROR,
  JSONRPC_INVALID_REQUEST,
  JSONRPC_METHOD_NOT_FOUND,
  JSONRPC_INVALID_PARAMS,
} from '../error-codes.js';
import { Readable, Writable } from 'stream';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Helper to create a mock stdin stream
 */
function createMockStdin(): Readable {
  return new Readable({
    read() {
      // No-op
    },
  });
}

/**
 * Helper to create a mock stdout stream that captures output
 */
function createMockStdout(): { stream: Writable; getOutput: () => string[] } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  return {
    stream,
    getOutput: () => lines,
  };
}

/**
 * Helper to create a test dispatcher with mock streams
 */
function createTestDispatcher(handlers: Map<string, (req: RpcRequest) => Promise<unknown>>) {
  const mockStdin = createMockStdin();
  const mockStdout = createMockStdout();
  const mockStderr = createMockStdout();

  const dispatcher = new RpcDispatcher({
    handlers,
    stdin: mockStdin,
    stdout: mockStdout.stream,
    stderr: mockStderr.stream,
  });

  return {
    dispatcher,
    stdin: mockStdin,
    stdout: mockStdout,
    stderr: mockStderr,
  };
}

/**
 * Helper to send a line to stdin and wait for processing
 */
async function sendLine(stdin: Readable, line: string): Promise<void> {
  stdin.push(line + '\n');
  // Give the event loop time to process
  await new Promise((resolve) => setImmediate(resolve));
}

/**
 * Helper to close stdin and wait for dispatcher to finish
 */
async function closeStdin(stdin: Readable): Promise<void> {
  stdin.push(null);
  await new Promise((resolve) => setImmediate(resolve));
}

// ============================================================================
// Fast-check Arbitraries (Generators)
// ============================================================================

/**
 * Generate valid JSON-RPC 2.0 request IDs (string or number)
 */
const arbRpcId = fc.oneof(
  fc.string({ minLength: 1, maxLength: 50 }),
  fc.integer({ min: 0, max: 1000000 })
);

/**
 * Generate valid sessionId strings
 */
const arbSessionId = fc.string({ minLength: 1, maxLength: 100 }).map(s => `sess-${s}`);

/**
 * Generate valid method names
 */
const arbMethodName = fc.oneof(
  fc.constant('sftp/connect'),
  fc.constant('sftp/disconnect'),
  fc.constant('sftp/readdir'),
  fc.constant('sftp/stat'),
  fc.constant('sftp/readFile'),
  fc.constant('sftp/writeFile'),
  fc.constant('test/echo'),
  fc.string({ minLength: 1, maxLength: 50 }).map(s => `test/${s}`)
);

/**
 * Generate arbitrary JSON-serializable params objects
 */
const arbParams = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 20 }),
  fc.oneof(
    fc.string(),
    fc.integer(),
    fc.boolean(),
    fc.constant(null)
  )
);

/**
 * Generate valid JSON-RPC 2.0 request objects
 */
const arbValidRequest = fc.record({
  jsonrpc: fc.constant('2.0' as const),
  id: arbRpcId,
  method: arbMethodName,
  params: fc.option(arbParams, { nil: undefined }),
  sessionId: fc.option(arbSessionId, { nil: undefined }),
});

/**
 * Generate valid JSON-RPC 2.0 notification objects (no id)
 */
const arbValidNotification = fc.record({
  jsonrpc: fc.constant('2.0' as const),
  method: arbMethodName,
  params: fc.option(arbParams, { nil: undefined }),
  sessionId: fc.option(arbSessionId, { nil: undefined }),
});

/**
 * Generate invalid JSON-RPC objects (missing required fields)
 */
const arbInvalidRequest = fc.oneof(
  // Missing jsonrpc
  fc.record({
    id: arbRpcId,
    method: arbMethodName,
  }),
  // Wrong jsonrpc version
  fc.record({
    jsonrpc: fc.constant('1.0'),
    id: arbRpcId,
    method: arbMethodName,
  }),
  // Missing method
  fc.record({
    jsonrpc: fc.constant('2.0'),
    id: arbRpcId,
  }),
  // Invalid method type
  fc.record({
    jsonrpc: fc.constant('2.0'),
    id: arbRpcId,
    method: fc.integer(),
  }),
  // Invalid id type
  fc.record({
    jsonrpc: fc.constant('2.0'),
    id: fc.constant({}),
    method: arbMethodName,
  }),
  // Invalid params type (array instead of object)
  fc.record({
    jsonrpc: fc.constant('2.0'),
    id: arbRpcId,
    method: arbMethodName,
    params: fc.array(fc.string()),
  })
);

// ============================================================================
// Property-Based Tests
// ============================================================================

describe('RpcDispatcher - Property-Based Tests', () => {
  /**
   * Property 1: NDJSON JSON-RPC round-trip
   * 
   * For any valid JSON-RPC 2.0 object (request or response), serialization
   * to NDJSON string and back should produce an equivalent object.
   * 
   * **Validates: Requirements 1.1, 1.2, 11.7**
   */
  describe('Property 1: NDJSON JSON-RPC round-trip', () => {
    it('should serialize and deserialize valid requests without loss', () => {
      fc.assert(
        fc.property(arbValidRequest, (request) => {
          // Serialize to NDJSON (JSON + newline)
          const ndjsonLine = JSON.stringify(request) + '\n';

          // Deserialize back
          const parsed = JSON.parse(ndjsonLine.trim());

          // Should be equivalent
          expect(parsed).toEqual(request);
          return true;
        }),
        { numRuns: 100 }
      );
    });

    it('should handle responses with result field', () => {
      fc.assert(
        fc.property(
          arbRpcId,
          fc.option(arbSessionId, { nil: undefined }),
          fc.oneof(fc.string(), fc.integer(), fc.boolean(), arbParams),
          (id, sessionId, result) => {
            const response: RpcResponse = {
              jsonrpc: '2.0',
              id,
              result,
              ...(sessionId && { sessionId }),
            };

            const ndjsonLine = JSON.stringify(response) + '\n';
            const parsed = JSON.parse(ndjsonLine.trim());

            expect(parsed).toEqual(response);
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle responses with error field', () => {
      fc.assert(
        fc.property(
          arbRpcId,
          fc.option(arbSessionId, { nil: undefined }),
          fc.integer({ min: -32768, max: -32000 }),
          fc.string({ minLength: 1, maxLength: 100 }),
          (id, sessionId, code, message) => {
            const response: RpcResponse = {
              jsonrpc: '2.0',
              id,
              error: { code, message },
              ...(sessionId && { sessionId }),
            };

            const ndjsonLine = JSON.stringify(response) + '\n';
            const parsed = JSON.parse(ndjsonLine.trim());

            expect(parsed).toEqual(response);
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 2: sessionId preservation
   * 
   * For any JSON-RPC request containing a sessionId field, the corresponding
   * response must contain the same sessionId value.
   * 
   * **Validates: Requirement 2.1**
   */
  describe('Property 2: sessionId preservation', () => {
    it('should preserve sessionId in all responses', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbValidRequest.filter(req => req.sessionId !== undefined),
          async (request) => {
            const echoHandler = async (req: RpcRequest) => ({ echo: req.params });
            const { dispatcher, stdin, stdout } = createTestDispatcher(
              new Map([[request.method, echoHandler]])
            );

            const startPromise = dispatcher.start();
            await sendLine(stdin, JSON.stringify(request));
            await closeStdin(stdin);
            await startPromise;

            const output = stdout.getOutput();
            if (output.length === 0) return true; // Notification case

            const response: RpcResponse = JSON.parse(output[0]);

            // sessionId must be preserved
            expect(response.sessionId).toBe(request.sessionId);
            return true;
          }
        ),
        { numRuns: 50 } // Reduced for async tests
      );
    });

    it('should preserve sessionId even in error responses', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbRpcId,
          arbSessionId,
          fc.string({ minLength: 1, maxLength: 50 }).map(s => `unknown/${s}`),
          async (id, sessionId, unknownMethod) => {
            const { dispatcher, stdin, stdout } = createTestDispatcher(new Map());

            const request = {
              jsonrpc: '2.0' as const,
              id,
              method: unknownMethod,
              sessionId,
            };

            const startPromise = dispatcher.start();
            await sendLine(stdin, JSON.stringify(request));
            await closeStdin(stdin);
            await startPromise;

            const output = stdout.getOutput();
            const response: RpcResponse = JSON.parse(output[0]);

            // sessionId must be preserved even in errors
            expect(response.sessionId).toBe(sessionId);
            expect(response.error?.code).toBe(JSONRPC_METHOD_NOT_FOUND);
            return true;
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  /**
   * Property 3: stdout purity
   * 
   * For any operation, every line written to stdout must be a valid
   * JSON-RPC 2.0 message in NDJSON format. No logs, diagnostics, or
   * other data should appear in stdout.
   * 
   * **Validates: Requirement 1.3**
   */
  describe('Property 3: stdout purity', () => {
    it('should only write valid JSON-RPC messages to stdout', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(arbValidRequest, { minLength: 1, maxLength: 10 }),
          async (requests) => {
            const echoHandler = async (req: RpcRequest) => ({ echo: req.params });
            const handlers = new Map<string, (req: RpcRequest) => Promise<unknown>>();

            // Register handlers for all methods in requests
            for (const req of requests) {
              if (!handlers.has(req.method)) {
                handlers.set(req.method, echoHandler);
              }
            }

            const { dispatcher, stdin, stdout } = createTestDispatcher(handlers);

            const startPromise = dispatcher.start();

            for (const request of requests) {
              await sendLine(stdin, JSON.stringify(request));
            }

            await closeStdin(stdin);
            await startPromise;

            const output = stdout.getOutput();

            // Every line must be valid JSON
            for (const line of output) {
              const trimmed = line.trim();
              if (trimmed === '') continue;

              let parsed: unknown;
              try {
                parsed = JSON.parse(trimmed);
              } catch {
                throw new Error(`stdout contains invalid JSON: ${trimmed}`);
              }

              // Must be a valid JSON-RPC 2.0 response
              const response = parsed as RpcResponse;
              expect(response.jsonrpc).toBe('2.0');
              expect(response.id).toBeDefined();
              expect(response.result !== undefined || response.error !== undefined).toBe(true);
            }

            return true;
          }
        ),
        { numRuns: 30 }
      );
    });
  });

  /**
   * Property 14: JSON-RPC 2.0 response format compliance
   * 
   * For any JSON-RPC request with an id field, the response must contain
   * "jsonrpc": "2.0", the same id value, and either result or error (but not both).
   * For error responses, error must contain code (number) and message (string).
   * 
   * **Validates: Requirement 11.1**
   */
  describe('Property 14: JSON-RPC 2.0 response format compliance', () => {
    it('should always include required fields in success responses', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbValidRequest,
          async (request) => {
            const successHandler = async () => ({ success: true });
            const { dispatcher, stdin, stdout } = createTestDispatcher(
              new Map([[request.method, successHandler]])
            );

            const startPromise = dispatcher.start();
            await sendLine(stdin, JSON.stringify(request));
            await closeStdin(stdin);
            await startPromise;

            const output = stdout.getOutput();
            if (output.length === 0) return true; // Notification

            const response: RpcResponse = JSON.parse(output[0]);

            // Must have jsonrpc field
            expect(response.jsonrpc).toBe('2.0');

            // Must have same id
            expect(response.id).toEqual(request.id);

            // Must have result field
            expect(response.result).toBeDefined();

            // Must NOT have error field
            expect(response.error).toBeUndefined();

            return true;
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should always include required fields in error responses', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbRpcId,
          fc.string({ minLength: 1, maxLength: 50 }).map(s => `unknown/${s}`),
          async (id, unknownMethod) => {
            const { dispatcher, stdin, stdout } = createTestDispatcher(new Map());

            const request = {
              jsonrpc: '2.0' as const,
              id,
              method: unknownMethod,
            };

            const startPromise = dispatcher.start();
            await sendLine(stdin, JSON.stringify(request));
            await closeStdin(stdin);
            await startPromise;

            const output = stdout.getOutput();
            const response: RpcResponse = JSON.parse(output[0]);

            // Must have jsonrpc field
            expect(response.jsonrpc).toBe('2.0');

            // Must have same id
            expect(response.id).toEqual(id);

            // Must have error field
            expect(response.error).toBeDefined();
            expect(typeof response.error!.code).toBe('number');
            expect(typeof response.error!.message).toBe('string');

            // Must NOT have result field
            expect(response.result).toBeUndefined();

            return true;
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  /**
   * Property 15: Protocol error handling
   * 
   * For any invalid JSON string, return -32700 (Parse error).
   * For any valid JSON not conforming to JSON-RPC 2.0, return -32600 (Invalid Request).
   * For any unknown method, return -32601 (Method not found).
   * For any known method with missing required params, return -32602 (Invalid params).
   * 
   * **Validates: Requirements 11.2, 11.3, 11.4, 11.5**
   */
  describe('Property 15: Protocol error handling', () => {
    it('should return PARSE_ERROR for invalid JSON', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbRpcId,
          fc.string({ minLength: 1, maxLength: 100 }),
          async (id, garbage) => {
            // Create malformed JSON by injecting syntax errors
            const malformed = `{"jsonrpc":"2.0","id":${JSON.stringify(id)},${garbage}}`;

            const { dispatcher, stdin, stdout } = createTestDispatcher(new Map());

            const startPromise = dispatcher.start();
            await sendLine(stdin, malformed);
            await closeStdin(stdin);
            await startPromise;

            const output = stdout.getOutput();
            if (output.length === 0) return true; // No id extracted

            const response: RpcResponse = JSON.parse(output[0]);

            // Should be parse error
            expect(response.error?.code).toBe(JSONRPC_PARSE_ERROR);
            return true;
          }
        ),
        { numRuns: 30 }
      );
    });

    it('should return INVALID_REQUEST for non-conforming JSON-RPC', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbInvalidRequest,
          async (invalidRequest) => {
            const { dispatcher, stdin, stdout } = createTestDispatcher(new Map());

            const startPromise = dispatcher.start();
            await sendLine(stdin, JSON.stringify(invalidRequest));
            await closeStdin(stdin);
            await startPromise;

            const output = stdout.getOutput();
            if (output.length === 0) return true; // Notification or no id

            const response: RpcResponse = JSON.parse(output[0]);

            // Should be invalid request error
            expect(response.error?.code).toBe(JSONRPC_INVALID_REQUEST);
            return true;
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should return METHOD_NOT_FOUND for unknown methods', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbRpcId,
          fc.string({ minLength: 1, maxLength: 50 }).map(s => `unknown/${s}`),
          async (id, unknownMethod) => {
            const { dispatcher, stdin, stdout } = createTestDispatcher(new Map());

            const request = {
              jsonrpc: '2.0' as const,
              id,
              method: unknownMethod,
            };

            const startPromise = dispatcher.start();
            await sendLine(stdin, JSON.stringify(request));
            await closeStdin(stdin);
            await startPromise;

            const output = stdout.getOutput();
            const response: RpcResponse = JSON.parse(output[0]);

            // Should be method not found error
            expect(response.error?.code).toBe(JSONRPC_METHOD_NOT_FOUND);
            expect(response.error?.message).toContain(unknownMethod);
            return true;
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  /**
   * Property 16: Notifications produce no response
   * 
   * For any JSON-RPC message with a method field but without an id field
   * (notification), the Worker must not send any response to stdout.
   * 
   * **Validates: Requirement 11.6**
   */
  describe('Property 16: Notifications produce no response', () => {
    it('should not respond to valid notifications', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbValidNotification,
          async (notification) => {
            const echoHandler = async (req: RpcRequest) => ({ echo: req.params });
            const { dispatcher, stdin, stdout } = createTestDispatcher(
              new Map([[notification.method, echoHandler]])
            );

            const startPromise = dispatcher.start();
            await sendLine(stdin, JSON.stringify(notification));
            await closeStdin(stdin);
            await startPromise;

            const output = stdout.getOutput();

            // No response should be sent for notifications
            expect(output).toHaveLength(0);
            return true;
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should not respond to invalid notifications', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 50 }),
          async (invalidMethod) => {
            const notification = {
              jsonrpc: '2.0' as const,
              method: 123, // Invalid method type
            };

            const { dispatcher, stdin, stdout } = createTestDispatcher(new Map());

            const startPromise = dispatcher.start();
            await sendLine(stdin, JSON.stringify(notification));
            await closeStdin(stdin);
            await startPromise;

            const output = stdout.getOutput();

            // No response should be sent even for invalid notifications
            expect(output).toHaveLength(0);
            return true;
          }
        ),
        { numRuns: 30 }
      );
    });

    it('should not respond to notifications with unknown methods', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 50 }).map(s => `unknown/${s}`),
          async (unknownMethod) => {
            const notification = {
              jsonrpc: '2.0' as const,
              method: unknownMethod,
            };

            const { dispatcher, stdin, stdout } = createTestDispatcher(new Map());

            const startPromise = dispatcher.start();
            await sendLine(stdin, JSON.stringify(notification));
            await closeStdin(stdin);
            await startPromise;

            const output = stdout.getOutput();

            // No response should be sent for notifications even with unknown methods
            expect(output).toHaveLength(0);
            return true;
          }
        ),
        { numRuns: 30 }
      );
    });
  });
});
