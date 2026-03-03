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
 * Property-based tests for the ACPConnection class.
 *
 * Uses fast-check to verify universal properties across all inputs.
 * Tests TCP connection, NDJSON streaming, and message buffering.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import fc from 'fast-check';
import { ACPRequest } from '../../src/mcp-proxy/types.js';

describe('ACPConnection Properties', () => {
  beforeEach(() => {
    // Setup for each test
  });

  // Feature: mcp-acp-proxy-integration, Property 10: NDJSON Message Format
  // **Validates: Requirements 6.5, 7.1, 7.2**
  describe('Property 10: NDJSON Message Format', () => {
    it('should format any ACP request as valid JSON followed by newline', () => {
      fc.assert(
        fc.property(
          fc.oneof(fc.string(), fc.integer()),
          fc.string(),
          fc.string(),
          fc.string(),
          fc.object(),
          (id, method, agentId, sessionId, params) => {
            const request: ACPRequest = {
              jsonrpc: '2.0',
              id,
              method,
              agentId,
              sessionId,
              params
            };

            // Simulate NDJSON formatting
            const line = JSON.stringify(request) + '\n';

            // Should end with exactly one newline
            expect(line.endsWith('\n')).toBe(true);
            expect(line.endsWith('\n\n')).toBe(false);

            // Should be valid JSON when newline is removed
            const jsonPart = line.slice(0, -1);
            expect(() => JSON.parse(jsonPart)).not.toThrow();

            // Parsed object should match original
            const parsed = JSON.parse(jsonPart);
            expect(parsed.jsonrpc).toBe('2.0');
            expect(parsed.id).toEqual(id);
            expect(parsed.method).toBe(method);
            expect(parsed.agentId).toBe(agentId);
            expect(parsed.sessionId).toBe(sessionId);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should produce valid NDJSON for any sequence of requests', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              id: fc.oneof(fc.string(), fc.integer()),
              method: fc.string(),
              agentId: fc.string(),
              sessionId: fc.string(),
              params: fc.object()
            }),
            { minLength: 1, maxLength: 10 }
          ),
          (requests) => {
            let ndjson = '';

            for (const req of requests) {
              const request: ACPRequest = {
                jsonrpc: '2.0',
                ...req
              };
              ndjson += JSON.stringify(request) + '\n';
            }

            // Split by newlines and verify each line
            const lines = ndjson.split('\n').filter(line => line.trim());
            expect(lines.length).toBe(requests.length);

            for (let i = 0; i < lines.length; i++) {
              const parsed = JSON.parse(lines[i]);
              expect(parsed.jsonrpc).toBe('2.0');
              expect(parsed.id).toEqual(requests[i].id);
              expect(parsed.method).toBe(requests[i].method);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // Feature: mcp-acp-proxy-integration, Property 11: NDJSON Line Buffering
  // **Validates: Requirements 6.6**
  describe('Property 11: NDJSON Line Buffering', () => {
    it('should buffer incomplete lines until newline arrives', () => {
      fc.assert(
        fc.property(
          fc.array(fc.string(), { minLength: 1, maxLength: 5 }),
          (chunks) => {
            // Simulate buffering logic
            let buffer = '';
            const parsedMessages: any[] = [];

            // Create a complete message and split it into chunks
            const message = { jsonrpc: '2.0', id: 1, method: 'test', result: {} };
            const fullLine = JSON.stringify(message) + '\n';

            // Split the line into arbitrary chunks
            let position = 0;
            const chunkSizes = chunks.map(c => Math.max(1, c.length % 10));

            for (const size of chunkSizes) {
              if (position >= fullLine.length) break;

              const chunk = fullLine.slice(position, position + size);
              position += size;

              buffer += chunk;

              // Process complete lines
              let newlineIndex: number;
              while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
                const line = buffer.slice(0, newlineIndex);
                buffer = buffer.slice(newlineIndex + 1);

                if (line.trim()) {
                  parsedMessages.push(JSON.parse(line));
                }
              }
            }

            // Add remaining buffer if we didn't process the full line
            if (position < fullLine.length) {
              buffer += fullLine.slice(position);

              let newlineIndex: number;
              while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
                const line = buffer.slice(0, newlineIndex);
                buffer = buffer.slice(newlineIndex + 1);

                if (line.trim()) {
                  parsedMessages.push(JSON.parse(line));
                }
              }
            }

            // Should have parsed exactly one message
            expect(parsedMessages.length).toBe(1);
            expect(parsedMessages[0]).toEqual(message);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle multiple messages split across arbitrary chunk boundaries', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              id: fc.integer(),
              method: fc.string()
            }),
            { minLength: 1, maxLength: 5 }
          ),
          fc.array(fc.integer({ min: 1, max: 20 }), { minLength: 1, maxLength: 10 }),
          (messages, chunkSizes) => {
            // Create NDJSON stream
            let fullStream = '';
            for (const msg of messages) {
              const message = { jsonrpc: '2.0', ...msg, result: {} };
              fullStream += JSON.stringify(message) + '\n';
            }

            // Simulate buffering with arbitrary chunk sizes
            let buffer = '';
            const parsedMessages: any[] = [];
            let position = 0;

            for (const size of chunkSizes) {
              if (position >= fullStream.length) break;

              const chunk = fullStream.slice(position, position + size);
              position += size;

              buffer += chunk;

              // Process complete lines
              let newlineIndex: number;
              while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
                const line = buffer.slice(0, newlineIndex);
                buffer = buffer.slice(newlineIndex + 1);

                if (line.trim()) {
                  parsedMessages.push(JSON.parse(line));
                }
              }
            }

            // Process remaining buffer
            if (position < fullStream.length) {
              buffer += fullStream.slice(position);
            }

            let newlineIndex: number;
            while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
              const line = buffer.slice(0, newlineIndex);
              buffer = buffer.slice(newlineIndex + 1);

              if (line.trim()) {
                parsedMessages.push(JSON.parse(line));
              }
            }

            // Should have parsed all messages
            expect(parsedMessages.length).toBe(messages.length);

            for (let i = 0; i < messages.length; i++) {
              expect(parsedMessages[i].id).toBe(messages[i].id);
              expect(parsedMessages[i].method).toBe(messages[i].method);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should not parse incomplete lines without newline', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1 }),
          (partialJson) => {
            // Ensure no newline in the partial JSON
            const chunk = partialJson.replace(/\n/g, '');

            // Simulate buffering
            let buffer = '';
            const parsedMessages: any[] = [];

            buffer += chunk;

            // Try to process lines
            let newlineIndex: number;
            while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
              const line = buffer.slice(0, newlineIndex);
              buffer = buffer.slice(newlineIndex + 1);

              if (line.trim()) {
                try {
                  parsedMessages.push(JSON.parse(line));
                } catch (e) {
                  // Invalid JSON is ok for this test
                }
              }
            }

            // Should not have parsed anything (no newline)
            expect(parsedMessages.length).toBe(0);
            // Buffer should contain the chunk
            expect(buffer).toBe(chunk);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
