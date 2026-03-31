/**
 * RpcDispatcher Tests
 * 
 * Tests for JSON-RPC 2.0 message parsing, validation, routing, and error handling.
 * 
 * Validates:
 * - Property 1: NDJSON JSON-RPC round-trip (Requirements 1.1, 1.2, 11.7)
 * - Property 2: sessionId preservation (Requirement 2.1)
 * - Property 3: stdout purity (Requirement 1.3)
 * - Property 14: JSON-RPC 2.0 response format compliance (Requirement 11.1)
 * - Property 15: Protocol error handling (Requirements 11.2, 11.3, 11.4, 11.5)
 * - Property 16: Notifications produce no response (Requirement 11.6)
 */

import { RpcDispatcher } from '../rpc-dispatcher.js';
import type { RpcRequest, RpcResponse } from '../types.js';
import {
  JSONRPC_PARSE_ERROR,
  JSONRPC_INVALID_REQUEST,
  JSONRPC_METHOD_NOT_FOUND,
} from '../error-codes.js';
import { Readable, Writable } from 'stream';

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

describe('RpcDispatcher', () => {
  describe('Basic message handling', () => {
    it('should handle valid JSON-RPC request and return result', async () => {
      const testHandler = jest.fn(async (req: RpcRequest) => {
        return { success: true, echo: req.params };
      });

      const { dispatcher, stdin, stdout } = createTestDispatcher(
        new Map([['test/echo', testHandler]])
      );

      const startPromise = dispatcher.start();

      await sendLine(stdin, JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'test/echo',
        params: { message: 'hello' },
      }));

      await closeStdin(stdin);
      await startPromise;

      expect(testHandler).toHaveBeenCalledTimes(1);

      const output = stdout.getOutput();
      expect(output).toHaveLength(1);

      const response: RpcResponse = JSON.parse(output[0]);
      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe(1);
      expect(response.result).toEqual({ success: true, echo: { message: 'hello' } });
      expect(response.error).toBeUndefined();
    });

    it('should preserve sessionId in response', async () => {
      const { dispatcher, stdin, stdout } = createTestDispatcher(
        new Map([['test/method', async () => ({ ok: true })]])
      );

      const startPromise = dispatcher.start();

      await sendLine(stdin, JSON.stringify({
        jsonrpc: '2.0',
        id: 'req-123',
        method: 'test/method',
        sessionId: 'sess-abc-456',
      }));

      await closeStdin(stdin);
      await startPromise;

      const output = stdout.getOutput();
      const response: RpcResponse = JSON.parse(output[0]);

      // Property 2: sessionId preservation
      expect(response.sessionId).toBe('sess-abc-456');
    });

    it('should ignore empty lines', async () => {
      const { dispatcher, stdin, stdout } = createTestDispatcher(new Map());

      const startPromise = dispatcher.start();

      await sendLine(stdin, '');
      await sendLine(stdin, '   ');
      await sendLine(stdin, '\t');

      await closeStdin(stdin);
      await startPromise;

      expect(stdout.getOutput()).toHaveLength(0);
    });
  });

  describe('Error handling', () => {
    it('should return PARSE_ERROR for invalid JSON', async () => {
      const { dispatcher, stdin, stdout } = createTestDispatcher(new Map());

      const startPromise = dispatcher.start();

      await sendLine(stdin, '{"jsonrpc":"2.0","id":1,invalid}');

      await closeStdin(stdin);
      await startPromise;

      const output = stdout.getOutput();
      expect(output).toHaveLength(1);

      const response: RpcResponse = JSON.parse(output[0]);
      expect(response.error?.code).toBe(JSONRPC_PARSE_ERROR);
      expect(response.id).toBe(1);
    });

    it('should return INVALID_REQUEST for missing jsonrpc field', async () => {
      const { dispatcher, stdin, stdout } = createTestDispatcher(new Map());

      const startPromise = dispatcher.start();

      await sendLine(stdin, JSON.stringify({
        id: 2,
        method: 'test',
      }));

      await closeStdin(stdin);
      await startPromise;

      const output = stdout.getOutput();
      const response: RpcResponse = JSON.parse(output[0]);
      expect(response.error?.code).toBe(JSONRPC_INVALID_REQUEST);
    });

    it('should return INVALID_REQUEST for wrong jsonrpc version', async () => {
      const { dispatcher, stdin, stdout } = createTestDispatcher(new Map());

      const startPromise = dispatcher.start();

      await sendLine(stdin, JSON.stringify({
        jsonrpc: '1.0',
        id: 3,
        method: 'test',
      }));

      await closeStdin(stdin);
      await startPromise;

      const output = stdout.getOutput();
      const response: RpcResponse = JSON.parse(output[0]);
      expect(response.error?.code).toBe(JSONRPC_INVALID_REQUEST);
    });

    it('should return INVALID_REQUEST for missing method field', async () => {
      const { dispatcher, stdin, stdout } = createTestDispatcher(new Map());

      const startPromise = dispatcher.start();

      await sendLine(stdin, JSON.stringify({
        jsonrpc: '2.0',
        id: 4,
      }));

      await closeStdin(stdin);
      await startPromise;

      const output = stdout.getOutput();
      const response: RpcResponse = JSON.parse(output[0]);
      expect(response.error?.code).toBe(JSONRPC_INVALID_REQUEST);
    });

    it('should return METHOD_NOT_FOUND for unknown method', async () => {
      const { dispatcher, stdin, stdout } = createTestDispatcher(new Map());

      const startPromise = dispatcher.start();

      await sendLine(stdin, JSON.stringify({
        jsonrpc: '2.0',
        id: 5,
        method: 'unknown/method',
      }));

      await closeStdin(stdin);
      await startPromise;

      const output = stdout.getOutput();
      const response: RpcResponse = JSON.parse(output[0]);
      expect(response.error?.code).toBe(JSONRPC_METHOD_NOT_FOUND);
    });

    it('should handle handler errors gracefully', async () => {
      const errorHandler = jest.fn(async () => {
        throw {
          code: -32000,
          message: 'Custom error',
          data: {
            source: 'TestHandler',
            category: 'TEST_ERROR',
            retryable: false,
          },
        };
      });

      const { dispatcher, stdin, stdout } = createTestDispatcher(
        new Map([['test/error', errorHandler]])
      );

      const startPromise = dispatcher.start();

      await sendLine(stdin, JSON.stringify({
        jsonrpc: '2.0',
        id: 6,
        method: 'test/error',
      }));

      await closeStdin(stdin);
      await startPromise;

      const output = stdout.getOutput();
      const response: RpcResponse = JSON.parse(output[0]);
      expect(response.error?.code).toBe(-32000);
      expect(response.error?.message).toBe('Custom error');
      expect(response.error?.data?.source).toBe('TestHandler');
    });
  });

  describe('Notifications', () => {
    it('should not send response for notifications (no id)', async () => {
      const handler = jest.fn(async () => ({ ok: true }));

      const { dispatcher, stdin, stdout } = createTestDispatcher(
        new Map([['test/notify', handler]])
      );

      const startPromise = dispatcher.start();

      await sendLine(stdin, JSON.stringify({
        jsonrpc: '2.0',
        method: 'test/notify',
        params: { data: 'test' },
      }));

      await closeStdin(stdin);
      await startPromise;

      // Property 16: Notifications produce no response
      expect(stdout.getOutput()).toHaveLength(0);
      expect(handler).not.toHaveBeenCalled();
    });

    it('should not send error response for invalid notification', async () => {
      const { dispatcher, stdin, stdout } = createTestDispatcher(new Map());

      const startPromise = dispatcher.start();

      await sendLine(stdin, JSON.stringify({
        jsonrpc: '2.0',
        method: 123,
      }));

      await closeStdin(stdin);
      await startPromise;

      expect(stdout.getOutput()).toHaveLength(0);
    });
  });

  describe('JSON-RPC 2.0 compliance', () => {
    it('should always include jsonrpc field in response', async () => {
      const { dispatcher, stdin, stdout } = createTestDispatcher(
        new Map([['test/method', async () => ({ data: 'test' })]])
      );

      const startPromise = dispatcher.start();

      await sendLine(stdin, JSON.stringify({
        jsonrpc: '2.0',
        id: 'test-1',
        method: 'test/method',
      }));

      await closeStdin(stdin);
      await startPromise;

      const output = stdout.getOutput();
      const response: RpcResponse = JSON.parse(output[0]);

      // Property 14: JSON-RPC 2.0 response format compliance
      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe('test-1');
      expect(response.result).toBeDefined();
      expect(response.error).toBeUndefined();
    });

    it('should include either result or error, not both', async () => {
      const { dispatcher, stdin, stdout } = createTestDispatcher(
        new Map([['test/success', async () => ({ ok: true })]])
      );

      const startPromise = dispatcher.start();

      await sendLine(stdin, JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'test/success',
      }));

      await sendLine(stdin, JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'unknown/method',
      }));

      await closeStdin(stdin);
      await startPromise;

      const output = stdout.getOutput();
      expect(output).toHaveLength(2);

      const successResponse: RpcResponse = JSON.parse(output[0]);
      expect(successResponse.result).toBeDefined();
      expect(successResponse.error).toBeUndefined();

      const errorResponse: RpcResponse = JSON.parse(output[1]);
      expect(errorResponse.result).toBeUndefined();
      expect(errorResponse.error).toBeDefined();
    });
  });
});
