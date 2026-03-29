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
 * Property-Based Tests for NDJSON Stream Parsing
 *
 * Feature: acp-registry-transit, Property 8: NDJSON Stream Parsing
 *
 *
 * This test verifies that for any sequence of data chunks that together form
 * one or more complete newline-delimited JSON messages, the NDJSON handler
 * should correctly parse and emit each message in order, regardless of how
 * the data is chunked across read operations.
 *
 * @module registry-launcher/stream/ndjson-handler.property.test
 */
import * as fc from 'fast-check';
import { Writable } from 'node:stream';
import { NDJSONHandler } from './ndjson-handler.js';

/**
 * Create a mock writable stream for testing.
 * Captures all written data for verification.
 */
function createMockWritable(): { stream: Writable; chunks: string[] } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  return { stream, chunks };
}

/**
 * Arbitrary for generating JSON-safe numbers (excluding -0 which JSON normalizes to 0).
 */
const jsonSafeNumberArb = fc.double({
  noNaN: true,
  noDefaultInfinity: true,
}).map(n => Object.is(n, -0) ? 0 : n);

/**
 * Arbitrary for generating JSON values that are safe for round-trip comparison.
 * Excludes -0 since JSON.parse normalizes it to 0.
 */
const jsonSafeValueArb: fc.Arbitrary<unknown> = fc.letrec((tie) => ({
  primitive: fc.oneof(
    fc.constant(null),
    fc.boolean(),
    jsonSafeNumberArb,
    fc.string(),
  ),
  array: fc.array(tie('value'), { maxLength: 5 }),
  object: fc.dictionary(fc.string(), tie('value'), { maxKeys: 5 }),
  value: fc.oneof(tie('primitive'), tie('array'), tie('object')),
})).value;

/**
 * Arbitrary for generating JSON objects suitable for NDJSON messages.
 * Uses JSON-safe values to ensure round-trip comparison works correctly.
 */
const jsonObjectArb = fc.oneof(
  fc.dictionary(fc.string(), jsonSafeValueArb),
  fc.array(jsonSafeValueArb, { maxLength: 5 }),
);

describe('NDJSON Stream Parsing Property Tests', () => {
  /**
   * Feature: acp-registry-transit, Property 8: NDJSON Stream Parsing
   *
   * *For any* sequence of data chunks that together form one or more complete
   * newline-delimited JSON messages, the NDJSON handler should correctly parse
   * and emit each message in order, regardless of how the data is chunked
   * across read operations.
   *
   */
  describe('Property 8: NDJSON Stream Parsing', () => {
    it('should correctly parse messages regardless of chunking', () => {
      fc.assert(
        fc.property(
          fc.array(jsonObjectArb, { minLength: 1, maxLength: 10 }),
          fc.integer({ min: 1, max: 100 }),
          (messages, chunkSize) => {
            const { stream } = createMockWritable();
            const handler = new NDJSONHandler(stream);
            const received: object[] = [];
            handler.onMessage((msg) => received.push(msg));

            // Serialize messages to NDJSON
            const ndjson = messages.map((m) => JSON.stringify(m)).join('\n') + '\n';

            // Split into chunks and process
            for (let i = 0; i < ndjson.length; i += chunkSize) {
              handler.processChunk(Buffer.from(ndjson.slice(i, i + chunkSize)));
            }

            // Verify all messages received in order
            expect(received).toEqual(messages);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('should handle single-byte chunks correctly', () => {
      fc.assert(
        fc.property(
          fc.array(jsonObjectArb, { minLength: 1, maxLength: 5 }),
          (messages) => {
            const { stream } = createMockWritable();
            const handler = new NDJSONHandler(stream);
            const received: object[] = [];
            handler.onMessage((msg) => received.push(msg));

            // Serialize messages to NDJSON
            const ndjson = messages.map((m) => JSON.stringify(m)).join('\n') + '\n';

            // Process one byte at a time (worst case chunking)
            for (let i = 0; i < ndjson.length; i++) {
              handler.processChunk(Buffer.from(ndjson[i]));
            }

            // Verify all messages received in order
            expect(received).toEqual(messages);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('should handle entire NDJSON as single chunk', () => {
      fc.assert(
        fc.property(
          fc.array(jsonObjectArb, { minLength: 1, maxLength: 10 }),
          (messages) => {
            const { stream } = createMockWritable();
            const handler = new NDJSONHandler(stream);
            const received: object[] = [];
            handler.onMessage((msg) => received.push(msg));

            // Serialize messages to NDJSON
            const ndjson = messages.map((m) => JSON.stringify(m)).join('\n') + '\n';

            // Process entire NDJSON as single chunk
            handler.processChunk(Buffer.from(ndjson));

            // Verify all messages received in order
            expect(received).toEqual(messages);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('should preserve message order across random chunk boundaries', () => {
      fc.assert(
        fc.property(
          fc.array(jsonObjectArb, { minLength: 2, maxLength: 8 }),
          fc.array(fc.integer({ min: 1, max: 50 }), { minLength: 1, maxLength: 20 }),
          (messages, chunkSizes) => {
            const { stream } = createMockWritable();
            const handler = new NDJSONHandler(stream);
            const received: object[] = [];
            handler.onMessage((msg) => received.push(msg));

            // Serialize messages to NDJSON
            const ndjson = messages.map((m) => JSON.stringify(m)).join('\n') + '\n';

            // Split into variable-sized chunks
            let offset = 0;
            let chunkIndex = 0;
            while (offset < ndjson.length) {
              const size = chunkSizes[chunkIndex % chunkSizes.length];
              const end = Math.min(offset + size, ndjson.length);
              handler.processChunk(Buffer.from(ndjson.slice(offset, end)));
              offset = end;
              chunkIndex++;
            }

            // Verify all messages received in order
            expect(received).toEqual(messages);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('should handle chunks that split in the middle of JSON', () => {
      fc.assert(
        fc.property(
          jsonObjectArb,
          fc.integer({ min: 1, max: 50 }),
          (message, splitPoint) => {
            const { stream } = createMockWritable();
            const handler = new NDJSONHandler(stream);
            const received: object[] = [];
            handler.onMessage((msg) => received.push(msg));

            // Serialize message to NDJSON
            const ndjson = JSON.stringify(message) + '\n';

            // Ensure split point is within bounds
            const actualSplitPoint = Math.min(splitPoint, ndjson.length - 1);

            // Split at the specified point
            if (actualSplitPoint > 0) {
              handler.processChunk(Buffer.from(ndjson.slice(0, actualSplitPoint)));
              handler.processChunk(Buffer.from(ndjson.slice(actualSplitPoint)));
            } else {
              handler.processChunk(Buffer.from(ndjson));
            }

            // Verify message received correctly
            expect(received).toEqual([message]);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('should handle empty lines between messages', () => {
      fc.assert(
        fc.property(
          fc.array(jsonObjectArb, { minLength: 1, maxLength: 5 }),
          fc.array(fc.integer({ min: 0, max: 3 }), { minLength: 1 }),
          fc.integer({ min: 1, max: 50 }),
          (messages, emptyLineCounts, chunkSize) => {
            const { stream } = createMockWritable();
            const handler = new NDJSONHandler(stream);
            const received: object[] = [];
            handler.onMessage((msg) => received.push(msg));

            // Build NDJSON with empty lines between messages
            let ndjson = '';
            for (let i = 0; i < messages.length; i++) {
              ndjson += JSON.stringify(messages[i]) + '\n';
              // Add empty lines after each message (except possibly the last)
              const emptyCount = emptyLineCounts[i % emptyLineCounts.length];
              for (let j = 0; j < emptyCount; j++) {
                ndjson += '\n';
              }
            }

            // Split into chunks and process
            for (let i = 0; i < ndjson.length; i += chunkSize) {
              handler.processChunk(Buffer.from(ndjson.slice(i, i + chunkSize)));
            }

            // Verify all messages received in order (empty lines should be skipped)
            expect(received).toEqual(messages);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('should handle messages with special characters', () => {
      /**
       * Arbitrary for generating strings with special characters that are safe
       * for byte-level chunking (ASCII and common UTF-8 characters).
       */
      const specialStringArb = fc.oneof(
        fc.string(),
        fc.constant(''),
        fc.constant('\t'),
        fc.constant('\\'),
        fc.constant('"'),
        fc.constant('{"nested": "json"}'),
        fc.constant('hello\tworld'),
        fc.constant('line1\\nline2'),
      );

      const specialObjectArb = fc.dictionary(fc.string(), specialStringArb);

      fc.assert(
        fc.property(
          fc.array(specialObjectArb, { minLength: 1, maxLength: 5 }),
          fc.integer({ min: 1, max: 30 }),
          (messages, chunkSize) => {
            const { stream } = createMockWritable();
            const handler = new NDJSONHandler(stream);
            const received: object[] = [];
            handler.onMessage((msg) => received.push(msg));

            // Serialize messages to NDJSON
            const ndjson = messages.map((m) => JSON.stringify(m)).join('\n') + '\n';

            // Convert to buffer first, then chunk at byte boundaries
            // This ensures we don't split multi-byte UTF-8 characters incorrectly
            const buffer = Buffer.from(ndjson, 'utf-8');
            for (let i = 0; i < buffer.length; i += chunkSize) {
              handler.processChunk(buffer.subarray(i, i + chunkSize));
            }

            // Verify all messages received in order
            expect(received).toEqual(messages);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('should handle deeply nested JSON objects', () => {
      /**
       * Arbitrary for generating nested objects up to a certain depth.
       */
      const nestedObjectArb = fc.letrec((tie) => ({
        leaf: fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)),
        node: fc.dictionary(
          fc.string({ minLength: 1, maxLength: 10 }),
          fc.oneof(tie('leaf'), tie('node')),
          { minKeys: 0, maxKeys: 3 },
        ),
      })).node;

      fc.assert(
        fc.property(
          fc.array(nestedObjectArb, { minLength: 1, maxLength: 5 }),
          fc.integer({ min: 1, max: 50 }),
          (messages, chunkSize) => {
            const { stream } = createMockWritable();
            const handler = new NDJSONHandler(stream);
            const received: object[] = [];
            handler.onMessage((msg) => received.push(msg));

            // Serialize messages to NDJSON
            const ndjson = messages.map((m) => JSON.stringify(m)).join('\n') + '\n';

            // Split into chunks and process
            for (let i = 0; i < ndjson.length; i += chunkSize) {
              handler.processChunk(Buffer.from(ndjson.slice(i, i + chunkSize)));
            }

            // Verify all messages received in order
            expect(received).toEqual(messages);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('should handle arrays as valid JSON messages', () => {
      fc.assert(
        fc.property(
          fc.array(fc.array(fc.jsonValue(), { maxLength: 5 }), { minLength: 1, maxLength: 5 }),
          fc.integer({ min: 1, max: 50 }),
          (messages, chunkSize) => {
            const { stream } = createMockWritable();
            const handler = new NDJSONHandler(stream);
            const received: object[] = [];
            handler.onMessage((msg) => received.push(msg));

            // Serialize messages to NDJSON
            const ndjson = messages.map((m) => JSON.stringify(m)).join('\n') + '\n';

            // Split into chunks and process
            for (let i = 0; i < ndjson.length; i += chunkSize) {
              handler.processChunk(Buffer.from(ndjson.slice(i, i + chunkSize)));
            }

            // Verify all messages received in order
            // Note: JSON.stringify(-0) produces "0", so we compare against the JSON round-trip
            // to account for this known JavaScript/JSON behavior
            const expectedMessages = messages.map((m) => JSON.parse(JSON.stringify(m)));
            expect(received).toEqual(expectedMessages);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('should maintain buffer state correctly across multiple processChunk calls', () => {
      fc.assert(
        fc.property(
          fc.array(jsonObjectArb, { minLength: 3, maxLength: 10 }),
          fc.array(fc.integer({ min: 1, max: 20 }), { minLength: 5, maxLength: 30 }),
          (messages, chunkSizes) => {
            const { stream } = createMockWritable();
            const handler = new NDJSONHandler(stream);
            const received: object[] = [];
            handler.onMessage((msg) => received.push(msg));

            // Serialize messages to NDJSON
            const ndjson = messages.map((m) => JSON.stringify(m)).join('\n') + '\n';

            // Process with varying chunk sizes
            let offset = 0;
            for (const size of chunkSizes) {
              if (offset >= ndjson.length) break;
              const end = Math.min(offset + size, ndjson.length);
              handler.processChunk(Buffer.from(ndjson.slice(offset, end)));
              offset = end;
            }

            // Process any remaining data
            if (offset < ndjson.length) {
              handler.processChunk(Buffer.from(ndjson.slice(offset)));
            }

            // Verify all messages received in order
            expect(received).toEqual(messages);
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
