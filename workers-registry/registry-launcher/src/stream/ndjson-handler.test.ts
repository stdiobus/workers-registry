/*
 * Apache License 2.0
 * Copyright (c) 2025–present Raman Marozau, Target Insight Function.
 * Contact: raman@worktif.com
 *
 * This file is part of the stdio bus protocol reference implementation:
 *   stdio_bus_kernel_workers (target: <target_stdio_bus_kernel_workers>).
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit Tests for NDJSON Handler Edge Cases
 *
 * Tests for edge cases in NDJSON stream handling including empty lines,
 * malformed JSON, very large messages, and buffer boundary conditions.
 *
 * @module registry-launcher/stream/ndjson-handler.test
 */
import { Writable } from 'node:stream';
import { NDJSONHandler } from './ndjson-handler.js';

/**
 * Create a mock writable stream for testing.
 * Captures all written data for verification.
 */
function createMockWritable(): { stream: Writable; chunks: string[]; writable: boolean } {
  const state = { writable: true };
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });

  // Override writable getter to allow testing non-writable state
  Object.defineProperty(stream, 'writable', {
    get() {
      return state.writable;
    },
  });

  return {
    stream, chunks, get writable() {
      return state.writable;
    }, set writable(v) {
      state.writable = v;
    },
  };
}

/**
 * Create a non-writable stream for testing write failures.
 */
function createNonWritableStream(): Writable {
  const stream = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  Object.defineProperty(stream, 'writable', {
    get() {
      return false;
    },
  });
  return stream;
}

describe('NDJSONHandler Unit Tests', () => {
  describe('Empty lines handling', () => {
    /**
     * Skip malformed lines
     */
    it('should skip empty lines', () => {
      const { stream } = createMockWritable();
      const handler = new NDJSONHandler(stream);
      const received: object[] = [];
      handler.onMessage((msg) => received.push(msg));

      handler.processChunk(Buffer.from('\n\n{"a":1}\n\n\n'));

      expect(received).toEqual([{ a: 1 }]);
    });

    it('should skip multiple consecutive empty lines', () => {
      const { stream } = createMockWritable();
      const handler = new NDJSONHandler(stream);
      const received: object[] = [];
      handler.onMessage((msg) => received.push(msg));

      handler.processChunk(Buffer.from('\n\n\n\n\n{"a":1}\n\n\n\n\n{"b":2}\n\n\n'));

      expect(received).toEqual([{ a: 1 }, { b: 2 }]);
    });

    it('should handle only empty lines', () => {
      const { stream } = createMockWritable();
      const handler = new NDJSONHandler(stream);
      const received: object[] = [];
      handler.onMessage((msg) => received.push(msg));

      handler.processChunk(Buffer.from('\n\n\n\n\n'));

      expect(received).toEqual([]);
    });
  });

  describe('Whitespace-only lines handling', () => {
    /**
     * Skip malformed lines
     */
    it('should skip whitespace-only lines', () => {
      const { stream } = createMockWritable();
      const handler = new NDJSONHandler(stream);
      const received: object[] = [];
      handler.onMessage((msg) => received.push(msg));

      handler.processChunk(Buffer.from('   \n{"a":1}\n\t\t\n{"b":2}\n  \t  \n'));

      expect(received).toEqual([{ a: 1 }, { b: 2 }]);
    });

    it('should skip lines with only tabs', () => {
      const { stream } = createMockWritable();
      const handler = new NDJSONHandler(stream);
      const received: object[] = [];
      handler.onMessage((msg) => received.push(msg));

      handler.processChunk(Buffer.from('\t\t\t\n{"a":1}\n'));

      expect(received).toEqual([{ a: 1 }]);
    });

    it('should skip lines with mixed whitespace', () => {
      const { stream } = createMockWritable();
      const handler = new NDJSONHandler(stream);
      const received: object[] = [];
      handler.onMessage((msg) => received.push(msg));

      handler.processChunk(Buffer.from(' \t \t \n{"a":1}\n'));

      expect(received).toEqual([{ a: 1 }]);
    });
  });

  describe('Malformed JSON handling', () => {
    /**
     * Log error and skip malformed lines
     */
    it('should trigger error callback for malformed JSON and skip the line', () => {
      const { stream } = createMockWritable();
      const handler = new NDJSONHandler(stream);
      const received: object[] = [];
      const errors: { error: Error; line: string }[] = [];

      handler.onMessage((msg) => received.push(msg));
      handler.onError((error, line) => errors.push({ error, line }));

      handler.processChunk(Buffer.from('{ invalid json }\n{"valid":true}\n'));

      expect(received).toEqual([{ valid: true }]);
      expect(errors).toHaveLength(1);
      expect(errors[0].line).toBe('{ invalid json }');
    });

    it('should handle multiple malformed lines', () => {
      const { stream } = createMockWritable();
      const handler = new NDJSONHandler(stream);
      const received: object[] = [];
      const errors: { error: Error; line: string }[] = [];

      handler.onMessage((msg) => received.push(msg));
      handler.onError((error, line) => errors.push({ error, line }));

      handler.processChunk(Buffer.from('bad1\n{"a":1}\nbad2\n{"b":2}\nbad3\n'));

      expect(received).toEqual([{ a: 1 }, { b: 2 }]);
      expect(errors).toHaveLength(3);
      expect(errors.map((e) => e.line)).toEqual(['bad1', 'bad2', 'bad3']);
    });

    it('should handle truncated JSON', () => {
      const { stream } = createMockWritable();
      const handler = new NDJSONHandler(stream);
      const errors: { error: Error; line: string }[] = [];

      handler.onError((error, line) => errors.push({ error, line }));

      handler.processChunk(Buffer.from('{"incomplete":\n'));

      expect(errors).toHaveLength(1);
      expect(errors[0].line).toBe('{"incomplete":');
    });

    it('should handle JSON with trailing comma', () => {
      const { stream } = createMockWritable();
      const handler = new NDJSONHandler(stream);
      const errors: { error: Error; line: string }[] = [];

      handler.onError((error, line) => errors.push({ error, line }));

      handler.processChunk(Buffer.from('{"a":1,}\n'));

      expect(errors).toHaveLength(1);
      expect(errors[0].line).toBe('{"a":1,}');
    });

    it('should handle unquoted keys', () => {
      const { stream } = createMockWritable();
      const handler = new NDJSONHandler(stream);
      const errors: { error: Error; line: string }[] = [];

      handler.onError((error, line) => errors.push({ error, line }));

      handler.processChunk(Buffer.from('{unquoted: "value"}\n'));

      expect(errors).toHaveLength(1);
      expect(errors[0].line).toBe('{unquoted: "value"}');
    });
  });

  describe('JSON primitives handling', () => {
    /**
     * Only objects/arrays are valid messages
     */
    it('should trigger error callback for JSON string primitive', () => {
      const { stream } = createMockWritable();
      const handler = new NDJSONHandler(stream);
      const received: object[] = [];
      const errors: { error: Error; line: string }[] = [];

      handler.onMessage((msg) => received.push(msg));
      handler.onError((error, line) => errors.push({ error, line }));

      handler.processChunk(Buffer.from('"just a string"\n'));

      expect(received).toEqual([]);
      expect(errors).toHaveLength(1);
      expect(errors[0].line).toBe('"just a string"');
      expect(errors[0].error.message).toContain('not an object');
    });

    it('should trigger error callback for JSON number primitive', () => {
      const { stream } = createMockWritable();
      const handler = new NDJSONHandler(stream);
      const received: object[] = [];
      const errors: { error: Error; line: string }[] = [];

      handler.onMessage((msg) => received.push(msg));
      handler.onError((error, line) => errors.push({ error, line }));

      handler.processChunk(Buffer.from('42\n'));

      expect(received).toEqual([]);
      expect(errors).toHaveLength(1);
      expect(errors[0].line).toBe('42');
    });

    it('should trigger error callback for JSON boolean primitive', () => {
      const { stream } = createMockWritable();
      const handler = new NDJSONHandler(stream);
      const received: object[] = [];
      const errors: { error: Error; line: string }[] = [];

      handler.onMessage((msg) => received.push(msg));
      handler.onError((error, line) => errors.push({ error, line }));

      handler.processChunk(Buffer.from('true\n'));

      expect(received).toEqual([]);
      expect(errors).toHaveLength(1);
      expect(errors[0].line).toBe('true');
    });

    it('should trigger error callback for JSON null', () => {
      const { stream } = createMockWritable();
      const handler = new NDJSONHandler(stream);
      const received: object[] = [];
      const errors: { error: Error; line: string }[] = [];

      handler.onMessage((msg) => received.push(msg));
      handler.onError((error, line) => errors.push({ error, line }));

      handler.processChunk(Buffer.from('null\n'));

      expect(received).toEqual([]);
      expect(errors).toHaveLength(1);
      expect(errors[0].line).toBe('null');
    });

    it('should accept JSON arrays as valid messages', () => {
      const { stream } = createMockWritable();
      const handler = new NDJSONHandler(stream);
      const received: object[] = [];

      handler.onMessage((msg) => received.push(msg));

      handler.processChunk(Buffer.from('[1, 2, 3]\n'));

      expect(received).toEqual([[1, 2, 3]]);
    });
  });

  describe('Very large messages handling', () => {
    /**
     * Handle large messages correctly
     */
    it('should handle very large JSON objects', () => {
      const { stream } = createMockWritable();
      const handler = new NDJSONHandler(stream);
      const received: object[] = [];

      handler.onMessage((msg) => received.push(msg));

      // Create a large object with many keys
      const largeObject: Record<string, string> = {};
      for (let i = 0; i < 1000; i++) {
        largeObject[`key${i}`] = `value${i}`.repeat(10);
      }

      handler.processChunk(Buffer.from(JSON.stringify(largeObject) + '\n'));

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual(largeObject);
    });

    it('should handle very large JSON arrays', () => {
      const { stream } = createMockWritable();
      const handler = new NDJSONHandler(stream);
      const received: object[] = [];

      handler.onMessage((msg) => received.push(msg));

      // Create a large array
      const largeArray = Array.from({ length: 10000 }, (_, i) => i);

      handler.processChunk(Buffer.from(JSON.stringify(largeArray) + '\n'));

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual(largeArray);
    });

    it('should handle deeply nested JSON', () => {
      const { stream } = createMockWritable();
      const handler = new NDJSONHandler(stream);
      const received: object[] = [];

      handler.onMessage((msg) => received.push(msg));

      // Create deeply nested object
      let nested: Record<string, unknown> = { value: 'deep' };
      for (let i = 0; i < 50; i++) {
        nested = { nested };
      }

      handler.processChunk(Buffer.from(JSON.stringify(nested) + '\n'));

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual(nested);
    });

    it('should handle message with very long string value', () => {
      const { stream } = createMockWritable();
      const handler = new NDJSONHandler(stream);
      const received: object[] = [];

      handler.onMessage((msg) => received.push(msg));

      const longString = 'x'.repeat(100000);
      const message = { data: longString };

      handler.processChunk(Buffer.from(JSON.stringify(message) + '\n'));

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual(message);
    });
  });

  describe('Buffer boundary conditions', () => {
    /**
     * Buffer management for partial reads
     */
    it('should handle partial message across two chunks', () => {
      const { stream } = createMockWritable();
      const handler = new NDJSONHandler(stream);
      const received: object[] = [];

      handler.onMessage((msg) => received.push(msg));

      // Split message in the middle
      handler.processChunk(Buffer.from('{"key":"val'));
      expect(received).toEqual([]);

      handler.processChunk(Buffer.from('ue"}\n'));
      expect(received).toEqual([{ key: 'value' }]);
    });

    it('should handle message split at newline boundary', () => {
      const { stream } = createMockWritable();
      const handler = new NDJSONHandler(stream);
      const received: object[] = [];

      handler.onMessage((msg) => received.push(msg));

      // First chunk ends without newline
      handler.processChunk(Buffer.from('{"a":1}'));
      expect(received).toEqual([]);

      // Second chunk starts with newline
      handler.processChunk(Buffer.from('\n{"b":2}\n'));
      expect(received).toEqual([{ a: 1 }, { b: 2 }]);
    });

    it('should handle multiple messages in single chunk', () => {
      const { stream } = createMockWritable();
      const handler = new NDJSONHandler(stream);
      const received: object[] = [];

      handler.onMessage((msg) => received.push(msg));

      handler.processChunk(Buffer.from('{"a":1}\n{"b":2}\n{"c":3}\n'));

      expect(received).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
    });

    it('should handle incomplete message at end of chunk', () => {
      const { stream } = createMockWritable();
      const handler = new NDJSONHandler(stream);
      const received: object[] = [];

      handler.onMessage((msg) => received.push(msg));

      handler.processChunk(Buffer.from('{"a":1}\n{"incomplete":'));
      expect(received).toEqual([{ a: 1 }]);

      handler.processChunk(Buffer.from('"value"}\n'));
      expect(received).toEqual([{ a: 1 }, { incomplete: 'value' }]);
    });

    it('should handle single byte chunks', () => {
      const { stream } = createMockWritable();
      const handler = new NDJSONHandler(stream);
      const received: object[] = [];

      handler.onMessage((msg) => received.push(msg));

      const message = '{"a":1}\n';
      for (const char of message) {
        handler.processChunk(Buffer.from(char));
      }

      expect(received).toEqual([{ a: 1 }]);
    });

    it('should handle chunk ending exactly at newline', () => {
      const { stream } = createMockWritable();
      const handler = new NDJSONHandler(stream);
      const received: object[] = [];

      handler.onMessage((msg) => received.push(msg));

      handler.processChunk(Buffer.from('{"a":1}\n'));
      handler.processChunk(Buffer.from('{"b":2}\n'));

      expect(received).toEqual([{ a: 1 }, { b: 2 }]);
    });

    it('should handle empty chunks', () => {
      const { stream } = createMockWritable();
      const handler = new NDJSONHandler(stream);
      const received: object[] = [];

      handler.onMessage((msg) => received.push(msg));

      handler.processChunk(Buffer.from(''));
      handler.processChunk(Buffer.from('{"a":1}\n'));
      handler.processChunk(Buffer.from(''));

      expect(received).toEqual([{ a: 1 }]);
    });
  });

  describe('Write method', () => {
    /**
     * Append newline after each JSON message
     */
    it('should return false when stream is not writable', () => {
      const stream = createNonWritableStream();
      const handler = new NDJSONHandler(stream);

      const result = handler.write({ test: 'message' });

      expect(result).toBe(false);
    });

    it('should return true when write is successful', () => {
      const { stream } = createMockWritable();
      const handler = new NDJSONHandler(stream);

      const result = handler.write({ test: 'message' });

      expect(result).toBe(true);
    });

    it('should append newline to written message', () => {
      const { stream, chunks } = createMockWritable();
      const handler = new NDJSONHandler(stream);

      handler.write({ test: 'message' });

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBe('{"test":"message"}\n');
    });

    it('should correctly serialize complex objects', () => {
      const { stream, chunks } = createMockWritable();
      const handler = new NDJSONHandler(stream);

      const complexObject = {
        string: 'value',
        number: 42,
        boolean: true,
        null: null,
        array: [1, 2, 3],
        nested: { a: { b: { c: 'deep' } } },
      };

      handler.write(complexObject);

      expect(chunks).toHaveLength(1);
      expect(JSON.parse(chunks[0].trim())).toEqual(complexObject);
    });

    it('should handle writing empty object', () => {
      const { stream, chunks } = createMockWritable();
      const handler = new NDJSONHandler(stream);

      handler.write({});

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBe('{}\n');
    });

    it('should handle writing empty array', () => {
      const { stream, chunks } = createMockWritable();
      const handler = new NDJSONHandler(stream);

      handler.write([]);

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBe('[]\n');
    });
  });

  describe('Callback registration', () => {
    it('should work without message callback registered', () => {
      const { stream } = createMockWritable();
      const handler = new NDJSONHandler(stream);

      // Should not throw
      expect(() => {
        handler.processChunk(Buffer.from('{"a":1}\n'));
      }).not.toThrow();
    });

    it('should work without error callback registered', () => {
      const { stream } = createMockWritable();
      const handler = new NDJSONHandler(stream);
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      // Should not throw, just log to stderr
      expect(() => {
        handler.processChunk(Buffer.from('invalid json\n'));
      }).not.toThrow();

      consoleSpy.mockRestore();
    });

    it('should allow replacing message callback', () => {
      const { stream } = createMockWritable();
      const handler = new NDJSONHandler(stream);
      const received1: object[] = [];
      const received2: object[] = [];

      handler.onMessage((msg) => received1.push(msg));
      handler.processChunk(Buffer.from('{"a":1}\n'));

      handler.onMessage((msg) => received2.push(msg));
      handler.processChunk(Buffer.from('{"b":2}\n'));

      expect(received1).toEqual([{ a: 1 }]);
      expect(received2).toEqual([{ b: 2 }]);
    });
  });

  describe('Special characters in JSON', () => {
    it('should handle escaped newlines in strings', () => {
      const { stream } = createMockWritable();
      const handler = new NDJSONHandler(stream);
      const received: object[] = [];

      handler.onMessage((msg) => received.push(msg));

      handler.processChunk(Buffer.from('{"text":"line1\\nline2"}\n'));

      expect(received).toEqual([{ text: 'line1\nline2' }]);
    });

    it('should handle escaped quotes in strings', () => {
      const { stream } = createMockWritable();
      const handler = new NDJSONHandler(stream);
      const received: object[] = [];

      handler.onMessage((msg) => received.push(msg));

      handler.processChunk(Buffer.from('{"text":"say \\"hello\\""}\n'));

      expect(received).toEqual([{ text: 'say "hello"' }]);
    });

    it('should handle unicode characters', () => {
      const { stream } = createMockWritable();
      const handler = new NDJSONHandler(stream);
      const received: object[] = [];

      handler.onMessage((msg) => received.push(msg));

      handler.processChunk(Buffer.from('{"emoji":"🎉","chinese":"中文"}\n'));

      expect(received).toEqual([{ emoji: '🎉', chinese: '中文' }]);
    });

    it('should handle backslashes in strings', () => {
      const { stream } = createMockWritable();
      const handler = new NDJSONHandler(stream);
      const received: object[] = [];

      handler.onMessage((msg) => received.push(msg));

      handler.processChunk(Buffer.from('{"path":"C:\\\\Users\\\\test"}\n'));

      expect(received).toEqual([{ path: 'C:\\Users\\test' }]);
    });
  });
});
