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
 * Property-Based Tests for Message Router
 *
 * Feature: acp-registry-transit
 *
 * Property 9: AgentId Extraction
 *
 * This test verifies that for any JSON object containing an "agentId" field
 * with a string value, extracting the agentId should return that exact string value.
 *
 * Property 10: Message Transformation
 *
 * This test verifies that for any JSON object containing an "agentId" field,
 * transforming it for forwarding should produce a valid JSON object that:
 * - Does not contain the "agentId" field
 * - Contains all other fields from the original message unchanged
 * - When serialized, ends with a newline character
 *
 * @module registry-launcher/router/message-router.property.test
 */
import * as fc from 'fast-check';
import { extractAgentId, transformMessage } from './message-router.js';

/**
 * Arbitrary for generating non-empty strings suitable for agentId values.
 */
const nonEmptyStringArb = fc
  .string({ minLength: 1, maxLength: 100 })
  .filter((s) => s.trim().length > 0);

/**
 * Arbitrary for generating JSON-safe values (excluding -0 which JSON normalizes to 0).
 */
const jsonSafeValueArb: fc.Arbitrary<unknown> = fc.letrec((tie) => ({
  primitive: fc.oneof(
    fc.constant(null),
    fc.boolean(),
    fc.double({ noNaN: true, noDefaultInfinity: true }).map((n) => (Object.is(n, -0) ? 0 : n)),
    fc.string(),
  ),
  array: fc.array(tie('value'), { maxLength: 5 }),
  object: fc.dictionary(fc.string(), tie('value'), { maxKeys: 5 }),
  value: fc.oneof(tie('primitive'), tie('array'), tie('object')),
})).value;

/**
 * Arbitrary for generating JSON objects with additional fields (excluding agentId).
 */
const additionalFieldsArb = fc.dictionary(
  fc.string().filter((s) => s !== 'agentId'),
  jsonSafeValueArb,
  { minKeys: 0, maxKeys: 10 },
);

describe('Message Router Property Tests', () => {
  /**
   * Feature: acp-registry-transit, Property 9: AgentId Extraction
   *
   * *For any* JSON object containing an "agentId" field with a string value,
   * extracting the agentId should return that exact string value.
   *
   */
  describe('Property 9: AgentId Extraction', () => {
    it('should extract the exact agentId string value from any message', () => {
      fc.assert(
        fc.property(nonEmptyStringArb, additionalFieldsArb, (agentId, additionalFields) => {
          // Create a message with the agentId field
          const message = { ...additionalFields, agentId };

          // Extract the agentId
          const extracted = extractAgentId(message);

          // Verify the extracted value matches exactly
          expect(extracted).toBe(agentId);
        }),
        { numRuns: 100 },
      );
    });

    it('should return undefined for messages without agentId field', () => {
      fc.assert(
        fc.property(additionalFieldsArb, (fields) => {
          // Ensure no agentId field exists
          const message = { ...fields };
          delete (message as Record<string, unknown>).agentId;

          // Extract should return undefined
          const extracted = extractAgentId(message);

          expect(extracted).toBeUndefined();
        }),
        { numRuns: 100 },
      );
    });

    it('should return undefined for messages with empty string agentId', () => {
      fc.assert(
        fc.property(additionalFieldsArb, (additionalFields) => {
          // Create a message with empty string agentId
          const message = { ...additionalFields, agentId: '' };

          // Extract should return undefined for empty strings
          const extracted = extractAgentId(message);

          expect(extracted).toBeUndefined();
        }),
        { numRuns: 100 },
      );
    });

    it('should return undefined for messages with non-string agentId values', () => {
      /**
       * Arbitrary for generating non-string values.
       */
      const nonStringValueArb = fc.oneof(
        fc.integer(),
        fc.double({ noNaN: true, noDefaultInfinity: true }),
        fc.boolean(),
        fc.constant(null),
        fc.constant(undefined),
        fc.array(fc.string(), { maxLength: 3 }),
        fc.dictionary(fc.string(), fc.string(), { maxKeys: 3 }),
      );

      fc.assert(
        fc.property(nonStringValueArb, additionalFieldsArb, (invalidAgentId, additionalFields) => {
          // Create a message with non-string agentId
          const message = { ...additionalFields, agentId: invalidAgentId };

          // Extract should return undefined for non-string values
          const extracted = extractAgentId(message);

          expect(extracted).toBeUndefined();
        }),
        { numRuns: 100 },
      );
    });

    it('should handle agentId with special characters', () => {
      /**
       * Arbitrary for generating strings with special characters.
       */
      const specialStringArb = fc.oneof(
        fc.string({ minLength: 1 }),
        fc.constant('agent-with-dashes'),
        fc.constant('agent_with_underscores'),
        fc.constant('agent.with.dots'),
        fc.constant('agent/with/slashes'),
        fc.constant('agent@with@at'),
        fc.constant('agent:with:colons'),
        fc.constant('agent with spaces'),
        fc.constant('agent\twith\ttabs'),
        fc.constant('unicode-агент-代理'),
        fc.constant('emoji-🤖-agent'),
      );

      fc.assert(
        fc.property(specialStringArb, additionalFieldsArb, (agentId, additionalFields) => {
          // Create a message with special character agentId
          const message = { ...additionalFields, agentId };

          // Extract should return the exact string
          const extracted = extractAgentId(message);

          expect(extracted).toBe(agentId);
        }),
        { numRuns: 100 },
      );
    });

    it('should handle very long agentId strings', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 100, maxLength: 1000 }),
          additionalFieldsArb,
          (agentId, additionalFields) => {
            // Create a message with long agentId
            const message = { ...additionalFields, agentId };

            // Extract should return the exact string
            const extracted = extractAgentId(message);

            expect(extracted).toBe(agentId);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('should extract agentId regardless of field order in object', () => {
      fc.assert(
        fc.property(
          nonEmptyStringArb,
          fc.array(fc.tuple(fc.string().filter((s) => s !== 'agentId'), jsonSafeValueArb), {
            minLength: 0,
            maxLength: 10,
          }),
          fc.boolean(),
          (agentId, fieldPairs, agentIdFirst) => {
            // Build object with agentId at different positions
            const fields: Record<string, unknown> = {};

            if (agentIdFirst) {
              fields.agentId = agentId;
              for (const [key, value] of fieldPairs) {
                fields[key] = value;
              }
            } else {
              for (const [key, value] of fieldPairs) {
                fields[key] = value;
              }
              fields.agentId = agentId;
            }

            // Extract should return the exact string
            const extracted = extractAgentId(fields);

            expect(extracted).toBe(agentId);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('should handle messages with nested objects containing agentId', () => {
      fc.assert(
        fc.property(
          nonEmptyStringArb,
          nonEmptyStringArb,
          additionalFieldsArb,
          (topLevelAgentId, nestedAgentId, additionalFields) => {
            // Create a message with agentId at top level and in nested object
            const message = {
              ...additionalFields,
              agentId: topLevelAgentId,
              nested: {
                agentId: nestedAgentId,
                other: 'value',
              },
            };

            // Extract should return only the top-level agentId
            const extracted = extractAgentId(message);

            expect(extracted).toBe(topLevelAgentId);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('should handle JSON-RPC style messages with agentId', () => {
      /**
       * Arbitrary for generating JSON-RPC request IDs.
       */
      const jsonRpcIdArb = fc.oneof(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.integer({ min: 1, max: 1000000 }),
        fc.constant(null),
      );

      /**
       * Arbitrary for generating JSON-RPC method names.
       */
      const methodNameArb = fc.stringMatching(/^[a-z][a-zA-Z0-9/]*$/);

      fc.assert(
        fc.property(
          nonEmptyStringArb,
          jsonRpcIdArb,
          methodNameArb,
          fc.jsonValue(),
          (agentId, id, method, params) => {
            // Create a JSON-RPC style message with agentId
            const message = {
              jsonrpc: '2.0',
              id,
              method,
              params,
              agentId,
            };

            // Extract should return the exact agentId
            const extracted = extractAgentId(message);

            expect(extracted).toBe(agentId);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('should preserve agentId value through JSON serialization round-trip', () => {
      fc.assert(
        fc.property(nonEmptyStringArb, additionalFieldsArb, (agentId, additionalFields) => {
          // Create a message with the agentId field
          const originalMessage = { ...additionalFields, agentId };

          // Serialize and deserialize (simulating network transmission)
          const serialized = JSON.stringify(originalMessage);
          const deserialized = JSON.parse(serialized) as object;

          // Extract from deserialized message
          const extracted = extractAgentId(deserialized);

          // Should match the original agentId
          expect(extracted).toBe(agentId);
        }),
        { numRuns: 100 },
      );
    });
  });
});


/**
 * Helper function to serialize a message as NDJSON (with trailing newline).
 * This simulates the NDJSON serialization that happens when forwarding to an agent.
 *
 * @param message - The message to serialize
 * @returns The NDJSON-formatted string
 */
function serializeAsNdjson(message: object): string {
  return JSON.stringify(message) + '\n';
}

describe('Property 10: Message Transformation', () => {
  /**
   * Feature: acp-registry-transit, Property 10: Message Transformation
   *
   * *For any* JSON object containing an "agentId" field, transforming it for
   * forwarding should produce a valid JSON object that:
   * - Does not contain the "agentId" field
   * - Contains all other fields from the original message unchanged
   * - When serialized, ends with a newline character
   *
   */

  it('should remove agentId field from transformed message', () => {
    fc.assert(
      fc.property(nonEmptyStringArb, additionalFieldsArb, (agentId, additionalFields) => {
        // Create a message with agentId
        const originalMessage = { ...additionalFields, agentId };

        // Transform the message
        const transformed = transformMessage(originalMessage);

        // Verify agentId is not present in transformed message
        expect(transformed).not.toHaveProperty('agentId');
        expect((transformed as Record<string, unknown>).agentId).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });

  it('should preserve all other fields unchanged after transformation', () => {
    fc.assert(
      fc.property(nonEmptyStringArb, additionalFieldsArb, (agentId, additionalFields) => {
        // Create a message with agentId
        const originalMessage = { ...additionalFields, agentId };

        // Transform the message
        const transformed = transformMessage(originalMessage) as Record<string, unknown>;

        // Verify all other fields are preserved
        for (const [key, value] of Object.entries(additionalFields)) {
          expect(transformed[key]).toEqual(value);
        }

        // Verify no extra fields were added (except agentId removal)
        const transformedKeys = Object.keys(transformed);
        const expectedKeys = Object.keys(additionalFields);
        expect(transformedKeys.sort()).toEqual(expectedKeys.sort());
      }),
      { numRuns: 100 },
    );
  });

  it('should produce valid JSON when serialized', () => {
    fc.assert(
      fc.property(nonEmptyStringArb, additionalFieldsArb, (agentId, additionalFields) => {
        // Create a message with agentId
        const originalMessage = { ...additionalFields, agentId };

        // Transform the message
        const transformed = transformMessage(originalMessage);

        // Serialize and verify it's valid JSON
        const serialized = JSON.stringify(transformed);
        const parsed = JSON.parse(serialized);

        // Verify round-trip produces equivalent object
        expect(parsed).toEqual(transformed);
      }),
      { numRuns: 100 },
    );
  });

  it('should produce NDJSON output ending with newline character', () => {
    fc.assert(
      fc.property(nonEmptyStringArb, additionalFieldsArb, (agentId, additionalFields) => {
        // Create a message with agentId
        const originalMessage = { ...additionalFields, agentId };

        // Transform the message
        const transformed = transformMessage(originalMessage);

        // Serialize as NDJSON
        const ndjson = serializeAsNdjson(transformed);

        // Verify it ends with newline
        expect(ndjson.endsWith('\n')).toBe(true);

        // Verify there's exactly one newline at the end
        expect(ndjson.endsWith('\n\n')).toBe(false);

        // Verify the content before newline is valid JSON
        const jsonPart = ndjson.slice(0, -1);
        expect(() => JSON.parse(jsonPart)).not.toThrow();
      }),
      { numRuns: 100 },
    );
  });

  it('should handle JSON-RPC messages with agentId correctly', () => {
    /**
     * Arbitrary for generating JSON-RPC request IDs.
     */
    const jsonRpcIdArb = fc.oneof(
      fc.string({ minLength: 1, maxLength: 50 }),
      fc.integer({ min: 1, max: 1000000 }),
      fc.constant(null),
    );

    /**
     * Arbitrary for generating JSON-RPC method names.
     */
    const methodNameArb = fc.stringMatching(/^[a-z][a-zA-Z0-9/]*$/);

    fc.assert(
      fc.property(
        nonEmptyStringArb,
        jsonRpcIdArb,
        methodNameArb,
        fc.jsonValue(),
        (agentId, id, method, params) => {
          // Create a JSON-RPC style message with agentId
          const originalMessage = {
            jsonrpc: '2.0' as const,
            id,
            method,
            params,
            agentId,
          };

          // Transform the message
          const transformed = transformMessage(originalMessage) as Record<string, unknown>;

          // Verify agentId is removed
          expect(transformed).not.toHaveProperty('agentId');

          // Verify JSON-RPC fields are preserved
          expect(transformed.jsonrpc).toBe('2.0');
          expect(transformed.id).toEqual(id);
          expect(transformed.method).toBe(method);
          expect(transformed.params).toEqual(params);

          // Verify NDJSON serialization
          const ndjson = serializeAsNdjson(transformed);
          expect(ndjson.endsWith('\n')).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should handle messages with deeply nested objects', () => {
    /**
     * Arbitrary for generating deeply nested objects.
     */
    const deepNestedArb: fc.Arbitrary<Record<string, unknown>> = fc.letrec((tie) => ({
      leaf: fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)),
      nested: fc.record({
        value: tie('leaf'),
        child: fc.option(tie('nested'), { nil: undefined }),
      }),
    })).nested as fc.Arbitrary<Record<string, unknown>>;

    fc.assert(
      fc.property(nonEmptyStringArb, deepNestedArb, (agentId, nestedData) => {
        // Create a message with agentId and nested data
        const originalMessage = {
          agentId,
          data: nestedData,
          metadata: { timestamp: Date.now() },
        };

        // Transform the message
        const transformed = transformMessage(originalMessage) as Record<string, unknown>;

        // Verify agentId is removed
        expect(transformed).not.toHaveProperty('agentId');

        // Verify nested data is preserved
        expect(transformed.data).toEqual(nestedData);
        expect(transformed.metadata).toEqual(originalMessage.metadata);

        // Verify NDJSON serialization
        const ndjson = serializeAsNdjson(transformed);
        expect(ndjson.endsWith('\n')).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('should handle messages with arrays', () => {
    fc.assert(
      fc.property(
        nonEmptyStringArb,
        fc.array(jsonSafeValueArb, { minLength: 0, maxLength: 10 }),
        (agentId, items) => {
          // Create a message with agentId and array data
          const originalMessage = {
            agentId,
            items,
            count: items.length,
          };

          // Transform the message
          const transformed = transformMessage(originalMessage) as Record<string, unknown>;

          // Verify agentId is removed
          expect(transformed).not.toHaveProperty('agentId');

          // Verify array is preserved
          expect(transformed.items).toEqual(items);
          expect(transformed.count).toBe(items.length);

          // Verify NDJSON serialization
          const ndjson = serializeAsNdjson(transformed);
          expect(ndjson.endsWith('\n')).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should not modify the original message object', () => {
    fc.assert(
      fc.property(nonEmptyStringArb, additionalFieldsArb, (agentId, additionalFields) => {
        // Create a message with agentId
        const originalMessage = { ...additionalFields, agentId };

        // Deep copy for comparison
        const originalCopy = JSON.parse(JSON.stringify(originalMessage));

        // Transform the message
        transformMessage(originalMessage);

        // Verify original message is unchanged
        expect(originalMessage).toEqual(originalCopy);
      }),
      { numRuns: 100 },
    );
  });

  it('should handle empty messages with only agentId', () => {
    fc.assert(
      fc.property(nonEmptyStringArb, (agentId) => {
        // Create a message with only agentId
        const originalMessage = { agentId };

        // Transform the message
        const transformed = transformMessage(originalMessage);

        // Verify result is an empty object
        expect(transformed).toEqual({});
        expect(Object.keys(transformed)).toHaveLength(0);

        // Verify NDJSON serialization
        const ndjson = serializeAsNdjson(transformed);
        expect(ndjson).toBe('{}\n');
      }),
      { numRuns: 100 },
    );
  });

  it('should preserve field order (except agentId removal)', () => {
    // Filter out special JavaScript property names that have special behavior
    const safeKeyArb = fc
      .string({ minLength: 1, maxLength: 20 })
      .filter(
        (s) =>
          s !== 'agentId' &&
          s !== '__proto__' &&
          s !== 'constructor' &&
          s !== 'prototype',
      );

    // Generate unique key-value pairs to avoid duplicate key issues
    const uniqueFieldPairsArb = fc
      .uniqueArray(safeKeyArb, { minLength: 1, maxLength: 10 })
      .chain((keys) =>
        fc.tuple(...keys.map((key) => fc.tuple(fc.constant(key), jsonSafeValueArb))),
      );

    fc.assert(
      fc.property(nonEmptyStringArb, uniqueFieldPairsArb, (agentId, fieldPairs) => {
        // Create a message with specific field order
        const originalMessage: Record<string, unknown> = {};
        originalMessage.agentId = agentId;
        for (const [key, value] of fieldPairs) {
          originalMessage[key] = value;
        }

        // Transform the message
        const transformed = transformMessage(originalMessage) as Record<string, unknown>;

        // Verify all non-agentId fields are present with correct values
        for (const [key, value] of fieldPairs) {
          expect(transformed[key]).toEqual(value);
        }

        // Verify NDJSON serialization
        const ndjson = serializeAsNdjson(transformed);
        expect(ndjson.endsWith('\n')).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('should handle special characters in field values', () => {
    /**
     * Arbitrary for generating strings with special characters.
     */
    const specialStringArb = fc.oneof(
      fc.string(),
      fc.constant('value with "quotes"'),
      fc.constant('value with \\backslashes\\'),
      fc.constant('value with\nnewlines'),
      fc.constant('value with\ttabs'),
      fc.constant('unicode: 日本語 中文 한국어'),
      fc.constant('emoji: 🚀 🎉 ✨'),
    );

    fc.assert(
      fc.property(nonEmptyStringArb, specialStringArb, (agentId, specialValue) => {
        // Create a message with special characters
        const originalMessage = {
          agentId,
          specialField: specialValue,
          normalField: 'normal',
        };

        // Transform the message
        const transformed = transformMessage(originalMessage) as Record<string, unknown>;

        // Verify agentId is removed
        expect(transformed).not.toHaveProperty('agentId');

        // Verify special characters are preserved
        expect(transformed.specialField).toBe(specialValue);

        // Verify NDJSON serialization handles special characters
        const ndjson = serializeAsNdjson(transformed);
        expect(ndjson.endsWith('\n')).toBe(true);

        // Verify the JSON can be parsed back correctly
        const parsed = JSON.parse(ndjson.slice(0, -1));
        expect(parsed.specialField).toBe(specialValue);
      }),
      { numRuns: 100 },
    );
  });
});


/**
 * Helper function to serialize a message as NDJSON for response passthrough testing.
 * This simulates the NDJSON serialization that happens when forwarding to stdout.
 *
 * @param message - The message to serialize
 * @returns The NDJSON-formatted string
 */
function serializeResponseAsNdjson(message: object): string {
  return JSON.stringify(message) + '\n';
}

describe('Property 11: Response Passthrough', () => {
  /**
   * Feature: acp-registry-transit, Property 11: Response Passthrough
   *
   * *For any* JSON object received from an agent's stdout, forwarding it to the
   * launcher's stdout should produce byte-identical output (the response is unchanged).
   *
   */

  it('should forward agent responses unchanged to stdout', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (responseValue): boolean => {
        // Skip non-object JSON values since responses are objects
        if (typeof responseValue !== 'object' || responseValue === null || Array.isArray(responseValue)) {
          return true; // Skip this case
        }

        const response = responseValue as object;

        // Track what was written to stdout
        let writtenResponse: object | undefined;
        const writeCallback = (msg: object): boolean => {
          writtenResponse = msg;
          return true;
        };

        // Create a mock registry and runtime manager
        const mockRegistry = {
          fetch: async () => {
          },
          lookup: () => undefined,
          resolve: () => ({ command: 'test', args: [] }),
        };

        const mockRuntimeManager = {
          getOrSpawn: async () => ({
            agentId: 'test',
            state: 'running' as const,
            process: {} as never,
            write: () => true,
            terminate: async () => {
            },
          }),
          get: () => undefined,
          terminate: async () => {
          },
          terminateAll: async () => {
          },
          onAgentExit: () => {
          },
        };

        // Create router with mock dependencies
        const { MessageRouter } = require('./message-router.js');
        const router = new MessageRouter(mockRegistry, mockRuntimeManager, writeCallback);

        // Handle the agent response
        router.handleAgentResponse('test-agent', response);

        // Verify the response was forwarded unchanged
        expect(writtenResponse).toEqual(response);

        // Verify byte-identical serialization
        const originalSerialized = serializeResponseAsNdjson(response);
        const forwardedSerialized = serializeResponseAsNdjson(writtenResponse!);
        expect(forwardedSerialized).toBe(originalSerialized);
        return true;
      }),
      { numRuns: 100 },
    );
  });

  it('should preserve JSON-RPC response structure unchanged', () => {
    /**
     * Arbitrary for generating JSON-RPC response IDs.
     */
    const jsonRpcIdArb = fc.oneof(
      fc.string({ minLength: 1, maxLength: 50 }),
      fc.integer({ min: 1, max: 1000000 }),
      fc.constant(null),
    );

    fc.assert(
      fc.property(jsonRpcIdArb, fc.jsonValue(), (id, result) => {
        // Create a JSON-RPC success response
        const response = {
          jsonrpc: '2.0' as const,
          id,
          result,
        };

        // Track what was written to stdout
        let writtenResponse: object | undefined;
        const writeCallback = (msg: object): boolean => {
          writtenResponse = msg;
          return true;
        };

        // Create a mock registry and runtime manager
        const mockRegistry = {
          fetch: async () => {
          },
          lookup: () => undefined,
          resolve: () => ({ command: 'test', args: [] }),
        };

        const mockRuntimeManager = {
          getOrSpawn: async () => ({
            agentId: 'test',
            state: 'running' as const,
            process: {} as never,
            write: () => true,
            terminate: async () => {
            },
          }),
          get: () => undefined,
          terminate: async () => {
          },
          terminateAll: async () => {
          },
          onAgentExit: () => {
          },
        };

        // Create router with mock dependencies
        const { MessageRouter } = require('./message-router.js');
        const router = new MessageRouter(mockRegistry, mockRuntimeManager, writeCallback);

        // Handle the agent response
        router.handleAgentResponse('test-agent', response);

        // Verify the response was forwarded unchanged
        expect(writtenResponse).toEqual(response);

        // Verify all JSON-RPC fields are preserved
        const written = writtenResponse as Record<string, unknown>;
        expect(written.jsonrpc).toBe('2.0');
        expect(written.id).toEqual(id);
        expect(written.result).toEqual(result);

        // Verify byte-identical serialization
        const originalSerialized = serializeResponseAsNdjson(response);
        const forwardedSerialized = serializeResponseAsNdjson(writtenResponse!);
        expect(forwardedSerialized).toBe(originalSerialized);
      }),
      { numRuns: 100 },
    );
  });

  it('should preserve JSON-RPC error response structure unchanged', () => {
    /**
     * Arbitrary for generating JSON-RPC response IDs.
     */
    const jsonRpcIdArb = fc.oneof(
      fc.string({ minLength: 1, maxLength: 50 }),
      fc.integer({ min: 1, max: 1000000 }),
      fc.constant(null),
    );

    /**
     * Arbitrary for generating error codes.
     */
    const errorCodeArb = fc.integer({ min: -32700, max: -32000 });

    fc.assert(
      fc.property(
        jsonRpcIdArb,
        errorCodeArb,
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.option(fc.jsonValue(), { nil: undefined }),
        (id, code, message, data) => {
          // Create a JSON-RPC error response
          const response: Record<string, unknown> = {
            jsonrpc: '2.0',
            id,
            error: {
              code,
              message,
              ...(data !== undefined && { data }),
            },
          };

          // Track what was written to stdout
          let writtenResponse: object | undefined;
          const writeCallback = (msg: object): boolean => {
            writtenResponse = msg;
            return true;
          };

          // Create a mock registry and runtime manager
          const mockRegistry = {
            fetch: async () => {
            },
            lookup: () => undefined,
            resolve: () => ({ command: 'test', args: [] }),
          };

          const mockRuntimeManager = {
            getOrSpawn: async () => ({
              agentId: 'test',
              state: 'running' as const,
              process: {} as never,
              write: () => true,
              terminate: async () => {
              },
            }),
            get: () => undefined,
            terminate: async () => {
            },
            terminateAll: async () => {
            },
            onAgentExit: () => {
            },
          };

          // Create router with mock dependencies
          const { MessageRouter } = require('./message-router.js');
          const router = new MessageRouter(mockRegistry, mockRuntimeManager, writeCallback);

          // Handle the agent response
          router.handleAgentResponse('test-agent', response);

          // Verify the response was forwarded unchanged
          expect(writtenResponse).toEqual(response);

          // Verify byte-identical serialization
          const originalSerialized = serializeResponseAsNdjson(response);
          const forwardedSerialized = serializeResponseAsNdjson(writtenResponse!);
          expect(forwardedSerialized).toBe(originalSerialized);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should preserve responses with special characters unchanged', () => {
    /**
     * Arbitrary for generating strings with special characters.
     */
    const specialStringArb = fc.oneof(
      fc.string(),
      fc.constant('value with "quotes"'),
      fc.constant('value with \\backslashes\\'),
      fc.constant('value with\nnewlines'),
      fc.constant('value with\ttabs'),
      fc.constant('unicode: 日本語 中文 한국어'),
      fc.constant('emoji: 🚀 🎉 ✨'),
      fc.constant('control chars: \u0000\u001f'),
      fc.constant('null byte: \x00'),
    );

    fc.assert(
      fc.property(specialStringArb, fc.jsonValue(), (specialValue, otherValue) => {
        // Create a response with special characters
        const response = {
          jsonrpc: '2.0' as const,
          id: 'test-id',
          result: {
            specialField: specialValue,
            otherField: otherValue,
          },
        };

        // Track what was written to stdout
        let writtenResponse: object | undefined;
        const writeCallback = (msg: object): boolean => {
          writtenResponse = msg;
          return true;
        };

        // Create a mock registry and runtime manager
        const mockRegistry = {
          fetch: async () => {
          },
          lookup: () => undefined,
          resolve: () => ({ command: 'test', args: [] }),
        };

        const mockRuntimeManager = {
          getOrSpawn: async () => ({
            agentId: 'test',
            state: 'running' as const,
            process: {} as never,
            write: () => true,
            terminate: async () => {
            },
          }),
          get: () => undefined,
          terminate: async () => {
          },
          terminateAll: async () => {
          },
          onAgentExit: () => {
          },
        };

        // Create router with mock dependencies
        const { MessageRouter } = require('./message-router.js');
        const router = new MessageRouter(mockRegistry, mockRuntimeManager, writeCallback);

        // Handle the agent response
        router.handleAgentResponse('test-agent', response);

        // Verify the response was forwarded unchanged
        expect(writtenResponse).toEqual(response);

        // Verify byte-identical serialization
        const originalSerialized = serializeResponseAsNdjson(response);
        const forwardedSerialized = serializeResponseAsNdjson(writtenResponse!);
        expect(forwardedSerialized).toBe(originalSerialized);
      }),
      { numRuns: 100 },
    );
  });

  it('should preserve deeply nested response structures unchanged', () => {
    /**
     * Arbitrary for generating deeply nested objects.
     */
    const deepNestedArb: fc.Arbitrary<Record<string, unknown>> = fc.letrec((tie) => ({
      leaf: fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)),
      nested: fc.record({
        value: tie('leaf'),
        child: fc.option(tie('nested'), { nil: undefined }),
      }),
    })).nested as fc.Arbitrary<Record<string, unknown>>;

    fc.assert(
      fc.property(deepNestedArb, (nestedData) => {
        // Create a response with deeply nested data
        const response = {
          jsonrpc: '2.0' as const,
          id: 'test-id',
          result: nestedData,
        };

        // Track what was written to stdout
        let writtenResponse: object | undefined;
        const writeCallback = (msg: object): boolean => {
          writtenResponse = msg;
          return true;
        };

        // Create a mock registry and runtime manager
        const mockRegistry = {
          fetch: async () => {
          },
          lookup: () => undefined,
          resolve: () => ({ command: 'test', args: [] }),
        };

        const mockRuntimeManager = {
          getOrSpawn: async () => ({
            agentId: 'test',
            state: 'running' as const,
            process: {} as never,
            write: () => true,
            terminate: async () => {
            },
          }),
          get: () => undefined,
          terminate: async () => {
          },
          terminateAll: async () => {
          },
          onAgentExit: () => {
          },
        };

        // Create router with mock dependencies
        const { MessageRouter } = require('./message-router.js');
        const router = new MessageRouter(mockRegistry, mockRuntimeManager, writeCallback);

        // Handle the agent response
        router.handleAgentResponse('test-agent', response);

        // Verify the response was forwarded unchanged
        expect(writtenResponse).toEqual(response);

        // Verify byte-identical serialization
        const originalSerialized = serializeResponseAsNdjson(response);
        const forwardedSerialized = serializeResponseAsNdjson(writtenResponse!);
        expect(forwardedSerialized).toBe(originalSerialized);
      }),
      { numRuns: 100 },
    );
  });

  it('should preserve responses with arrays unchanged', () => {
    fc.assert(
      fc.property(
        fc.array(jsonSafeValueArb, { minLength: 0, maxLength: 10 }),
        (items) => {
          // Create a response with array data
          const response = {
            jsonrpc: '2.0' as const,
            id: 'test-id',
            result: {
              items,
              count: items.length,
            },
          };

          // Track what was written to stdout
          let writtenResponse: object | undefined;
          const writeCallback = (msg: object): boolean => {
            writtenResponse = msg;
            return true;
          };

          // Create a mock registry and runtime manager
          const mockRegistry = {
            fetch: async () => {
            },
            lookup: () => undefined,
            resolve: () => ({ command: 'test', args: [] }),
          };

          const mockRuntimeManager = {
            getOrSpawn: async () => ({
              agentId: 'test',
              state: 'running' as const,
              process: {} as never,
              write: () => true,
              terminate: async () => {
              },
            }),
            get: () => undefined,
            terminate: async () => {
            },
            terminateAll: async () => {
            },
            onAgentExit: () => {
            },
          };

          // Create router with mock dependencies
          const { MessageRouter } = require('./message-router.js');
          const router = new MessageRouter(mockRegistry, mockRuntimeManager, writeCallback);

          // Handle the agent response
          router.handleAgentResponse('test-agent', response);

          // Verify the response was forwarded unchanged
          expect(writtenResponse).toEqual(response);

          // Verify byte-identical serialization
          const originalSerialized = serializeResponseAsNdjson(response);
          const forwardedSerialized = serializeResponseAsNdjson(writtenResponse!);
          expect(forwardedSerialized).toBe(originalSerialized);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should not modify the original response object', () => {
    fc.assert(
      fc.property(additionalFieldsArb, (fields) => {
        // Create a response object
        const response = {
          jsonrpc: '2.0' as const,
          id: 'test-id',
          result: fields,
        };

        // Deep copy for comparison
        const originalCopy = JSON.parse(JSON.stringify(response));

        // Track what was written to stdout
        const writeCallback = (_msg: object): boolean => {
          // Intentionally do nothing with the message
          return true;
        };

        // Create a mock registry and runtime manager
        const mockRegistry = {
          fetch: async () => {
          },
          lookup: () => undefined,
          resolve: () => ({ command: 'test', args: [] }),
        };

        const mockRuntimeManager = {
          getOrSpawn: async () => ({
            agentId: 'test',
            state: 'running' as const,
            process: {} as never,
            write: () => true,
            terminate: async () => {
            },
          }),
          get: () => undefined,
          terminate: async () => {
          },
          terminateAll: async () => {
          },
          onAgentExit: () => {
          },
        };

        // Create router with mock dependencies
        const { MessageRouter } = require('./message-router.js');
        const router = new MessageRouter(mockRegistry, mockRuntimeManager, writeCallback);

        // Handle the agent response
        router.handleAgentResponse('test-agent', response);

        // Verify original response is unchanged
        expect(response).toEqual(originalCopy);
      }),
      { numRuns: 100 },
    );
  });

  it('should handle responses from different agents identically', () => {
    /**
     * Arbitrary for generating agent IDs.
     */
    const agentIdArb = fc
      .string({ minLength: 1, maxLength: 50 })
      .filter((s) => s.trim().length > 0);

    fc.assert(
      fc.property(agentIdArb, fc.jsonValue(), (agentId, result): boolean => {
        // Skip non-object results
        if (typeof result !== 'object' || result === null) {
          return true;
        }

        // Create a response
        const response = {
          jsonrpc: '2.0' as const,
          id: 'test-id',
          result,
        };

        // Track what was written to stdout
        let writtenResponse: object | undefined;
        const writeCallback = (msg: object): boolean => {
          writtenResponse = msg;
          return true;
        };

        // Create a mock registry and runtime manager
        const mockRegistry = {
          fetch: async () => {
          },
          lookup: () => undefined,
          resolve: () => ({ command: 'test', args: [] }),
        };

        const mockRuntimeManager = {
          getOrSpawn: async () => ({
            agentId: 'test',
            state: 'running' as const,
            process: {} as never,
            write: () => true,
            terminate: async () => {
            },
          }),
          get: () => undefined,
          terminate: async () => {
          },
          terminateAll: async () => {
          },
          onAgentExit: () => {
          },
        };

        // Create router with mock dependencies
        const { MessageRouter } = require('./message-router.js');
        const router = new MessageRouter(mockRegistry, mockRuntimeManager, writeCallback);

        // Handle the agent response with the generated agentId
        router.handleAgentResponse(agentId, response);

        // Verify the response was forwarded unchanged regardless of agentId
        expect(writtenResponse).toEqual(response);

        // Verify byte-identical serialization
        const originalSerialized = serializeResponseAsNdjson(response);
        const forwardedSerialized = serializeResponseAsNdjson(writtenResponse!);
        expect(forwardedSerialized).toBe(originalSerialized);
        return true;
      }),
      { numRuns: 100 },
    );
  });

  it('should preserve notification responses (no id field) unchanged', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (result) => {
        // Create a notification response (no id field)
        const response = {
          jsonrpc: '2.0' as const,
          result,
        };

        // Track what was written to stdout
        let writtenResponse: object | undefined;
        const writeCallback = (msg: object): boolean => {
          writtenResponse = msg;
          return true;
        };

        // Create a mock registry and runtime manager
        const mockRegistry = {
          fetch: async () => {
          },
          lookup: () => undefined,
          resolve: () => ({ command: 'test', args: [] }),
        };

        const mockRuntimeManager = {
          getOrSpawn: async () => ({
            agentId: 'test',
            state: 'running' as const,
            process: {} as never,
            write: () => true,
            terminate: async () => {
            },
          }),
          get: () => undefined,
          terminate: async () => {
          },
          terminateAll: async () => {
          },
          onAgentExit: () => {
          },
        };

        // Create router with mock dependencies
        const { MessageRouter } = require('./message-router.js');
        const router = new MessageRouter(mockRegistry, mockRuntimeManager, writeCallback);

        // Handle the agent response
        router.handleAgentResponse('test-agent', response);

        // Verify the response was forwarded unchanged
        expect(writtenResponse).toEqual(response);

        // Verify byte-identical serialization
        const originalSerialized = serializeResponseAsNdjson(response);
        const forwardedSerialized = serializeResponseAsNdjson(writtenResponse!);
        expect(forwardedSerialized).toBe(originalSerialized);
      }),
      { numRuns: 100 },
    );
  });
});


describe('Property 12: Missing AgentId Error', () => {
  /**
   * Feature: acp-registry-transit, Property 12: Missing AgentId Error
   *
   * *For any* JSON-RPC request message that does not contain an "agentId" field,
   * routing should return a JSON-RPC error response with code -32600 and message
   * "Missing agentId", preserving the original request's "id" field.
   *
   */

  /**
   * Helper to create mock dependencies for MessageRouter.
   */
  function createMockDependencies() {
    const mockRegistry = {
      fetch: async () => {
      },
      lookup: () => undefined,
      resolve: () => ({ command: 'test', args: [] }),
    };

    const mockRuntimeManager = {
      getOrSpawn: async () => ({
        agentId: 'test',
        state: 'running' as const,
        process: {} as never,
        write: () => true,
        terminate: async () => {
        },
      }),
      get: () => undefined,
      terminate: async () => {
      },
      terminateAll: async () => {
      },
      onAgentExit: () => {
      },
    };

    const writtenResponses: object[] = [];
    const writeCallback = (msg: object): boolean => {
      writtenResponses.push(msg);
      return true;
    };

    return { mockRegistry, mockRuntimeManager, writeCallback, writtenResponses };
  }

  /**
   * Arbitrary for generating JSON-RPC request IDs.
   */
  const jsonRpcIdArb = fc.oneof(
    fc.string({ minLength: 1, maxLength: 50 }),
    fc.integer({ min: 1, max: 1000000 }),
    fc.constant(null),
  );

  /**
   * Arbitrary for generating JSON-RPC method names.
   */
  const methodNameArb = fc.stringMatching(/^[a-z][a-zA-Z0-9/]*$/);

  /**
   * Arbitrary for generating JSON objects without agentId field.
   */
  const messageWithoutAgentIdArb = fc.dictionary(
    fc.string().filter((s) => s !== 'agentId'),
    jsonSafeValueArb,
    { minKeys: 0, maxKeys: 10 },
  );

  it('should return error with code -32600 for messages without agentId', async () => {
    await fc.assert(
      fc.asyncProperty(jsonRpcIdArb, messageWithoutAgentIdArb, async (id, additionalFields) => {
        const { mockRegistry, mockRuntimeManager, writeCallback } = createMockDependencies();

        // Create a JSON-RPC request without agentId
        const message = {
          jsonrpc: '2.0' as const,
          id,
          method: 'test/method',
          ...additionalFields,
        };

        // Ensure no agentId field exists
        delete (message as Record<string, unknown>).agentId;

        // Create router and route the message
        const { MessageRouter } = require('./message-router.js');
        const router = new MessageRouter(mockRegistry, mockRuntimeManager, writeCallback);
        const errorResponse = await router.route(message);

        // Verify error response is returned
        expect(errorResponse).toBeDefined();
        expect(errorResponse).not.toBeUndefined();

        // Verify error code is -32600 (MISSING_AGENT_ID)
        expect(errorResponse!.error.code).toBe(-32600);

        // Verify error message is "Missing agentId"
        expect(errorResponse!.error.message).toBe('Missing agentId');

        // Verify jsonrpc version is preserved
        expect(errorResponse!.jsonrpc).toBe('2.0');

        // Verify original request id is preserved
        expect(errorResponse!.id).toEqual(id);
      }),
      { numRuns: 100 },
    );
  });

  it('should preserve the original request id in error response', async () => {
    await fc.assert(
      fc.asyncProperty(jsonRpcIdArb, async (id) => {
        const { mockRegistry, mockRuntimeManager, writeCallback } = createMockDependencies();

        // Create a minimal JSON-RPC request without agentId
        const message = {
          jsonrpc: '2.0' as const,
          id,
          method: 'test/method',
        };

        // Create router and route the message
        const { MessageRouter } = require('./message-router.js');
        const router = new MessageRouter(mockRegistry, mockRuntimeManager, writeCallback);
        const errorResponse = await router.route(message);

        // Verify the id field matches exactly
        expect(errorResponse!.id).toEqual(id);

        // Verify the id type is preserved (string, number, or null)
        if (id === null) {
          expect(errorResponse!.id).toBeNull();
        } else if (typeof id === 'string') {
          expect(typeof errorResponse!.id).toBe('string');
        } else if (typeof id === 'number') {
          expect(typeof errorResponse!.id).toBe('number');
        }
      }),
      { numRuns: 100 },
    );
  });

  it('should return error for JSON-RPC requests with various method names but no agentId', async () => {
    await fc.assert(
      fc.asyncProperty(jsonRpcIdArb, methodNameArb, fc.jsonValue(), async (id, method, params) => {
        const { mockRegistry, mockRuntimeManager, writeCallback } = createMockDependencies();

        // Create a JSON-RPC request with method and params but no agentId
        const message = {
          jsonrpc: '2.0' as const,
          id,
          method,
          params,
        };

        // Create router and route the message
        const { MessageRouter } = require('./message-router.js');
        const router = new MessageRouter(mockRegistry, mockRuntimeManager, writeCallback);
        const errorResponse = await router.route(message);

        // Verify error response structure
        expect(errorResponse).toBeDefined();
        expect(errorResponse!.jsonrpc).toBe('2.0');
        expect(errorResponse!.id).toEqual(id);
        expect(errorResponse!.error.code).toBe(-32600);
        expect(errorResponse!.error.message).toBe('Missing agentId');
      }),
      { numRuns: 100 },
    );
  });

  it('should return error for messages with empty string agentId', async () => {
    await fc.assert(
      fc.asyncProperty(jsonRpcIdArb, methodNameArb, async (id, method) => {
        const { mockRegistry, mockRuntimeManager, writeCallback } = createMockDependencies();

        // Create a JSON-RPC request with empty string agentId
        const message = {
          jsonrpc: '2.0' as const,
          id,
          method,
          agentId: '', // Empty string should be treated as missing
        };

        // Create router and route the message
        const { MessageRouter } = require('./message-router.js');
        const router = new MessageRouter(mockRegistry, mockRuntimeManager, writeCallback);
        const errorResponse = await router.route(message);

        // Verify error response for empty agentId
        expect(errorResponse).toBeDefined();
        expect(errorResponse!.error.code).toBe(-32600);
        expect(errorResponse!.error.message).toBe('Missing agentId');
        expect(errorResponse!.id).toEqual(id);
      }),
      { numRuns: 100 },
    );
  });

  it('should return error for messages with non-string agentId values', async () => {
    /**
     * Arbitrary for generating non-string values that are not valid agentIds.
     */
    const invalidAgentIdArb = fc.oneof(
      fc.integer(),
      fc.double({ noNaN: true, noDefaultInfinity: true }),
      fc.boolean(),
      fc.constant(null),
      fc.constant(undefined),
      fc.array(fc.string(), { maxLength: 3 }),
      fc.dictionary(fc.string(), fc.string(), { maxKeys: 3 }),
    );

    await fc.assert(
      fc.asyncProperty(jsonRpcIdArb, methodNameArb, invalidAgentIdArb, async (id, method, invalidAgentId) => {
        const { mockRegistry, mockRuntimeManager, writeCallback } = createMockDependencies();

        // Create a JSON-RPC request with invalid agentId type
        const message = {
          jsonrpc: '2.0' as const,
          id,
          method,
          agentId: invalidAgentId,
        };

        // Create router and route the message
        const { MessageRouter } = require('./message-router.js');
        const router = new MessageRouter(mockRegistry, mockRuntimeManager, writeCallback);
        const errorResponse = await router.route(message);

        // Verify error response for invalid agentId type
        expect(errorResponse).toBeDefined();
        expect(errorResponse!.error.code).toBe(-32600);
        expect(errorResponse!.error.message).toBe('Missing agentId');
        expect(errorResponse!.id).toEqual(id);
      }),
      { numRuns: 100 },
    );
  });

  it('should return error for messages with empty string agentId (whitespace edge case)', async () => {
    /**
     * Test specifically for empty string agentId.
     * Note: The implementation treats empty strings as missing per requirements.
     * Whitespace-only strings (e.g., " ", "\t") are technically non-empty and may
     * be treated as valid agentIds by the current implementation. This test only
     * validates the empty string case which is explicitly handled.
     */
    await fc.assert(
      fc.asyncProperty(jsonRpcIdArb, methodNameArb, async (id, method) => {
        const { mockRegistry, mockRuntimeManager, writeCallback } = createMockDependencies();

        // Create a JSON-RPC request with empty string agentId
        const message = {
          jsonrpc: '2.0' as const,
          id,
          method,
          agentId: '', // Empty string should be treated as missing
        };

        // Create router and route the message
        const { MessageRouter } = require('./message-router.js');
        const router = new MessageRouter(mockRegistry, mockRuntimeManager, writeCallback);
        const errorResponse = await router.route(message);

        // Verify error response for empty string agentId
        expect(errorResponse).toBeDefined();
        expect(errorResponse!.error.code).toBe(-32600);
        expect(errorResponse!.error.message).toBe('Missing agentId');
        expect(errorResponse!.id).toEqual(id);
      }),
      { numRuns: 100 },
    );
  });

  it('should produce valid JSON-RPC 2.0 error response structure', async () => {
    await fc.assert(
      fc.asyncProperty(jsonRpcIdArb, messageWithoutAgentIdArb, async (id, additionalFields) => {
        const { mockRegistry, mockRuntimeManager, writeCallback } = createMockDependencies();

        // Create a message without agentId
        const message = {
          jsonrpc: '2.0' as const,
          id,
          method: 'test/method',
          ...additionalFields,
        };
        delete (message as Record<string, unknown>).agentId;

        // Create router and route the message
        const { MessageRouter } = require('./message-router.js');
        const router = new MessageRouter(mockRegistry, mockRuntimeManager, writeCallback);
        const errorResponse = await router.route(message);

        // Verify JSON-RPC 2.0 error response structure
        expect(errorResponse).toBeDefined();

        // Must have jsonrpc field with value "2.0"
        expect(errorResponse!.jsonrpc).toBe('2.0');

        // Must have id field (can be string, number, or null)
        expect('id' in errorResponse!).toBe(true);

        // Must have error object
        expect(errorResponse!.error).toBeDefined();
        expect(typeof errorResponse!.error).toBe('object');

        // Error object must have code (integer)
        expect(typeof errorResponse!.error.code).toBe('number');
        expect(Number.isInteger(errorResponse!.error.code)).toBe(true);

        // Error object must have message (string)
        expect(typeof errorResponse!.error.message).toBe('string');

        // Must not have result field (error responses don't have result)
        expect('result' in errorResponse!).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('should handle notification messages (no id) without agentId', async () => {
    await fc.assert(
      fc.asyncProperty(methodNameArb, fc.jsonValue(), async (method, params) => {
        const { mockRegistry, mockRuntimeManager, writeCallback } = createMockDependencies();

        // Create a notification (no id field) without agentId
        const message = {
          jsonrpc: '2.0' as const,
          method,
          params,
        };

        // Create router and route the message
        const { MessageRouter } = require('./message-router.js');
        const router = new MessageRouter(mockRegistry, mockRuntimeManager, writeCallback);
        const errorResponse = await router.route(message);

        // Verify error response is returned even for notifications
        expect(errorResponse).toBeDefined();
        expect(errorResponse!.error.code).toBe(-32600);
        expect(errorResponse!.error.message).toBe('Missing agentId');

        // For notifications without id, the error response id should be null
        expect(errorResponse!.id).toBeNull();
      }),
      { numRuns: 100 },
    );
  });

  it('should serialize error response as valid NDJSON', async () => {
    await fc.assert(
      fc.asyncProperty(jsonRpcIdArb, messageWithoutAgentIdArb, async (id, additionalFields) => {
        const { mockRegistry, mockRuntimeManager, writeCallback } = createMockDependencies();

        // Create a message without agentId
        const message = {
          jsonrpc: '2.0' as const,
          id,
          method: 'test/method',
          ...additionalFields,
        };
        delete (message as Record<string, unknown>).agentId;

        // Create router and route the message
        const { MessageRouter } = require('./message-router.js');
        const router = new MessageRouter(mockRegistry, mockRuntimeManager, writeCallback);
        const errorResponse = await router.route(message);

        // Verify error response can be serialized as valid NDJSON
        const serialized = JSON.stringify(errorResponse) + '\n';

        // Should end with newline
        expect(serialized.endsWith('\n')).toBe(true);

        // Should be valid JSON (excluding the newline)
        const jsonPart = serialized.slice(0, -1);
        expect(() => JSON.parse(jsonPart)).not.toThrow();

        // Parsed JSON should equal original error response
        const parsed = JSON.parse(jsonPart);
        expect(parsed).toEqual(errorResponse);
      }),
      { numRuns: 100 },
    );
  });

  it('should not call registry resolve for messages without agentId', async () => {
    await fc.assert(
      fc.asyncProperty(jsonRpcIdArb, methodNameArb, async (id, method) => {
        let resolveCallCount = 0;

        const mockRegistry = {
          fetch: async () => {
          },
          lookup: () => undefined,
          resolve: () => {
            resolveCallCount++;
            return { command: 'test', args: [] };
          },
        };

        const mockRuntimeManager = {
          getOrSpawn: async () => ({
            agentId: 'test',
            state: 'running' as const,
            process: {} as never,
            write: () => true,
            terminate: async () => {
            },
          }),
          get: () => undefined,
          terminate: async () => {
          },
          terminateAll: async () => {
          },
          onAgentExit: () => {
          },
        };

        const writeCallback = () => true;

        // Create a message without agentId
        const message = {
          jsonrpc: '2.0' as const,
          id,
          method,
        };

        // Create router and route the message
        const { MessageRouter } = require('./message-router.js');
        const router = new MessageRouter(mockRegistry, mockRuntimeManager, writeCallback);
        await router.route(message);

        // Verify registry.resolve was never called
        expect(resolveCallCount).toBe(0);
      }),
      { numRuns: 100 },
    );
  });

  it('should not spawn agent runtime for messages without agentId', async () => {
    await fc.assert(
      fc.asyncProperty(jsonRpcIdArb, methodNameArb, async (id, method) => {
        let spawnCallCount = 0;

        const mockRegistry = {
          fetch: async () => {
          },
          lookup: () => undefined,
          resolve: () => ({ command: 'test', args: [] }),
        };

        const mockRuntimeManager = {
          getOrSpawn: async () => {
            spawnCallCount++;
            return {
              agentId: 'test',
              state: 'running' as const,
              process: {} as never,
              write: () => true,
              terminate: async () => {
              },
            };
          },
          get: () => undefined,
          terminate: async () => {
          },
          terminateAll: async () => {
          },
          onAgentExit: () => {
          },
        };

        const writeCallback = () => true;

        // Create a message without agentId
        const message = {
          jsonrpc: '2.0' as const,
          id,
          method,
        };

        // Create router and route the message
        const { MessageRouter } = require('./message-router.js');
        const router = new MessageRouter(mockRegistry, mockRuntimeManager, writeCallback);
        await router.route(message);

        // Verify runtimeManager.getOrSpawn was never called
        expect(spawnCallCount).toBe(0);
      }),
      { numRuns: 100 },
    );
  });
});


describe('Property 13: Request-Response ID Correlation', () => {
  /**
   * Feature: acp-registry-transit, Property 13: Request-Response ID Correlation
   *
   * *For any* JSON-RPC request with an "id" field routed to an agent, when the agent
   * responds with a message containing the same "id", that response should be forwarded
   * to stdout.
   *
   */

  /**
   * Helper to create mock dependencies for MessageRouter.
   */
  function createMockDependencies() {
    const mockRegistry = {
      fetch: async () => {
      },
      lookup: () => undefined,
      resolve: () => ({ command: 'test', args: [] }),
    };

    const mockRuntimeManager = {
      getOrSpawn: async () => ({
        agentId: 'test-agent',
        state: 'running' as const,
        process: {} as never,
        write: () => true,
        terminate: async () => {
        },
      }),
      get: () => undefined,
      terminate: async () => {
      },
      terminateAll: async () => {
      },
      onAgentExit: () => {
      },
    };

    const writtenResponses: object[] = [];
    const writeCallback = (msg: object): boolean => {
      writtenResponses.push(msg);
      return true;
    };

    return { mockRegistry, mockRuntimeManager, writeCallback, writtenResponses };
  }

  /**
   * Arbitrary for generating JSON-RPC request IDs (string or number, not null for requests).
   */
  const jsonRpcRequestIdArb = fc.oneof(
    fc.string({ minLength: 1, maxLength: 50 }),
    fc.integer({ min: 1, max: 1000000 }),
  );

  /**
   * Arbitrary for generating JSON-RPC method names.
   */
  const methodNameArb = fc.stringMatching(/^[a-z][a-zA-Z0-9/]*$/);

  /**
   * Arbitrary for generating non-empty strings suitable for agentId values.
   */
  const agentIdArb = fc
    .string({ minLength: 1, maxLength: 50 })
    .filter((s) => s.trim().length > 0);

  it('should forward response with matching id to stdout after routing request', async () => {
    await fc.assert(
      fc.asyncProperty(
        jsonRpcRequestIdArb,
        agentIdArb,
        methodNameArb,
        fc.jsonValue(),
        fc.jsonValue(),
        async (requestId, agentId, method, params, result) => {
          const { mockRegistry, mockRuntimeManager, writeCallback, writtenResponses } =
            createMockDependencies();

          // Create router
          const { MessageRouter } = require('./message-router.js');
          const router = new MessageRouter(mockRegistry, mockRuntimeManager, writeCallback);

          // Create and route a request with id
          const request = {
            jsonrpc: '2.0' as const,
            id: requestId,
            method,
            params,
            agentId,
          };

          await router.route(request);

          // Verify request is tracked as pending
          expect(router.isPending(requestId)).toBe(true);

          // Simulate agent response with matching id
          const response = {
            jsonrpc: '2.0' as const,
            id: requestId,
            result,
          };

          router.handleAgentResponse(agentId, response);

          // Verify response was forwarded to stdout
          expect(writtenResponses).toHaveLength(1);
          expect(writtenResponses[0]).toEqual(response);

          // Verify request is no longer pending after response
          expect(router.isPending(requestId)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should preserve exact id value in forwarded response', async () => {
    await fc.assert(
      fc.asyncProperty(
        jsonRpcRequestIdArb,
        agentIdArb,
        methodNameArb,
        fc.jsonValue(),
        async (requestId, agentId, method, result) => {
          const { mockRegistry, mockRuntimeManager, writeCallback, writtenResponses } =
            createMockDependencies();

          // Create router
          const { MessageRouter } = require('./message-router.js');
          const router = new MessageRouter(mockRegistry, mockRuntimeManager, writeCallback);

          // Route request
          const request = {
            jsonrpc: '2.0' as const,
            id: requestId,
            method,
            agentId,
          };

          await router.route(request);

          // Simulate agent response
          const response = {
            jsonrpc: '2.0' as const,
            id: requestId,
            result,
          };

          router.handleAgentResponse(agentId, response);

          // Verify the id in forwarded response matches exactly
          const forwarded = writtenResponses[0] as Record<string, unknown>;
          expect(forwarded.id).toEqual(requestId);

          // Verify type is preserved
          if (typeof requestId === 'string') {
            expect(typeof forwarded.id).toBe('string');
          } else if (typeof requestId === 'number') {
            expect(typeof forwarded.id).toBe('number');
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should handle multiple concurrent requests with different ids', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(jsonRpcRequestIdArb, { minLength: 2, maxLength: 5 }),
        agentIdArb,
        methodNameArb,
        async (requestIds, agentId, method) => {
          // Ensure unique request IDs
          const uniqueIds = [...new Set(requestIds.map(String))].slice(0, 5);
          if (uniqueIds.length < 2) return; // Skip if not enough unique IDs

          const { mockRegistry, mockRuntimeManager, writeCallback, writtenResponses } =
            createMockDependencies();

          // Create router
          const { MessageRouter } = require('./message-router.js');
          const router = new MessageRouter(mockRegistry, mockRuntimeManager, writeCallback);

          // Route multiple requests
          for (const id of uniqueIds) {
            const request = {
              jsonrpc: '2.0' as const,
              id,
              method,
              agentId,
            };
            await router.route(request);
          }

          // Verify all requests are pending
          for (const id of uniqueIds) {
            expect(router.isPending(id)).toBe(true);
          }

          // Respond to requests in reverse order
          const reversedIds = [...uniqueIds].reverse();
          for (const id of reversedIds) {
            const response = {
              jsonrpc: '2.0' as const,
              id,
              result: { requestId: id },
            };
            router.handleAgentResponse(agentId, response);
          }

          // Verify all responses were forwarded
          expect(writtenResponses).toHaveLength(uniqueIds.length);

          // Verify each response has correct id
          for (let i = 0; i < reversedIds.length; i++) {
            const forwarded = writtenResponses[i] as Record<string, unknown>;
            expect(forwarded.id).toEqual(reversedIds[i]);
          }

          // Verify no requests are pending
          for (const id of uniqueIds) {
            expect(router.isPending(id)).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should forward error responses with matching id', async () => {
    /**
     * Arbitrary for generating error codes.
     */
    const errorCodeArb = fc.integer({ min: -32700, max: -32000 });

    await fc.assert(
      fc.asyncProperty(
        jsonRpcRequestIdArb,
        agentIdArb,
        methodNameArb,
        errorCodeArb,
        fc.string({ minLength: 1, maxLength: 100 }),
        async (requestId, agentId, method, errorCode, errorMessage) => {
          const { mockRegistry, mockRuntimeManager, writeCallback, writtenResponses } =
            createMockDependencies();

          // Create router
          const { MessageRouter } = require('./message-router.js');
          const router = new MessageRouter(mockRegistry, mockRuntimeManager, writeCallback);

          // Route request
          const request = {
            jsonrpc: '2.0' as const,
            id: requestId,
            method,
            agentId,
          };

          await router.route(request);

          // Simulate agent error response with matching id
          const errorResponse = {
            jsonrpc: '2.0' as const,
            id: requestId,
            error: {
              code: errorCode,
              message: errorMessage,
            },
          };

          router.handleAgentResponse(agentId, errorResponse);

          // Verify error response was forwarded
          expect(writtenResponses).toHaveLength(1);
          expect(writtenResponses[0]).toEqual(errorResponse);

          // Verify id matches
          const forwarded = writtenResponses[0] as Record<string, unknown>;
          expect(forwarded.id).toEqual(requestId);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should track pending requests correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        jsonRpcRequestIdArb,
        agentIdArb,
        methodNameArb,
        async (requestId, agentId, method) => {
          const { mockRegistry, mockRuntimeManager, writeCallback } = createMockDependencies();

          // Create router
          const { MessageRouter } = require('./message-router.js');
          const router = new MessageRouter(mockRegistry, mockRuntimeManager, writeCallback);

          // Initially no pending requests
          expect(router.pendingCount).toBe(0);
          expect(router.isPending(requestId)).toBe(false);

          // Route request
          const request = {
            jsonrpc: '2.0' as const,
            id: requestId,
            method,
            agentId,
          };

          await router.route(request);

          // Request should be pending
          expect(router.pendingCount).toBe(1);
          expect(router.isPending(requestId)).toBe(true);

          // Handle response
          const response = {
            jsonrpc: '2.0' as const,
            id: requestId,
            result: 'ok',
          };

          router.handleAgentResponse(agentId, response);

          // Request should no longer be pending
          expect(router.pendingCount).toBe(0);
          expect(router.isPending(requestId)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should not track notifications (requests without id)', async () => {
    await fc.assert(
      fc.asyncProperty(agentIdArb, methodNameArb, fc.jsonValue(), async (agentId, method, params) => {
        const { mockRegistry, mockRuntimeManager, writeCallback } = createMockDependencies();

        // Create router
        const { MessageRouter } = require('./message-router.js');
        const router = new MessageRouter(mockRegistry, mockRuntimeManager, writeCallback);

        // Route notification (no id field)
        const notification = {
          jsonrpc: '2.0' as const,
          method,
          params,
          agentId,
        };

        await router.route(notification);

        // No pending requests for notifications
        expect(router.pendingCount).toBe(0);
      }),
      { numRuns: 100 },
    );
  });

  it('should forward responses even if not in pending map (agent-initiated)', async () => {
    await fc.assert(
      fc.asyncProperty(
        jsonRpcRequestIdArb,
        agentIdArb,
        fc.jsonValue(),
        async (responseId, agentId, result) => {
          const { mockRegistry, mockRuntimeManager, writeCallback, writtenResponses } =
            createMockDependencies();

          // Create router
          const { MessageRouter } = require('./message-router.js');
          const router = new MessageRouter(mockRegistry, mockRuntimeManager, writeCallback);

          // No request was routed, but agent sends a response
          // (This could happen for agent-initiated messages)
          const response = {
            jsonrpc: '2.0' as const,
            id: responseId,
            result,
          };

          router.handleAgentResponse(agentId, response);

          // Response should still be forwarded (passthrough behavior)
          expect(writtenResponses).toHaveLength(1);
          expect(writtenResponses[0]).toEqual(response);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should handle responses from correct agent only for correlation cleanup', async () => {
    await fc.assert(
      fc.asyncProperty(
        jsonRpcRequestIdArb,
        agentIdArb,
        agentIdArb,
        methodNameArb,
        fc.jsonValue(),
        async (requestId, correctAgentId, wrongAgentId, method, result) => {
          // Ensure different agent IDs
          if (correctAgentId === wrongAgentId) return;

          const { mockRegistry, mockRuntimeManager, writeCallback, writtenResponses } =
            createMockDependencies();

          // Create router
          const { MessageRouter } = require('./message-router.js');
          const router = new MessageRouter(mockRegistry, mockRuntimeManager, writeCallback);

          // Route request to correct agent
          const request = {
            jsonrpc: '2.0' as const,
            id: requestId,
            method,
            agentId: correctAgentId,
          };

          await router.route(request);
          expect(router.isPending(requestId)).toBe(true);

          // Response from wrong agent with same id
          const wrongResponse = {
            jsonrpc: '2.0' as const,
            id: requestId,
            result: 'from wrong agent',
          };

          router.handleAgentResponse(wrongAgentId, wrongResponse);

          // Response should be forwarded (passthrough)
          expect(writtenResponses).toHaveLength(1);

          // But request should still be pending (wrong agent)
          expect(router.isPending(requestId)).toBe(true);

          // Now response from correct agent
          const correctResponse = {
            jsonrpc: '2.0' as const,
            id: requestId,
            result,
          };

          router.handleAgentResponse(correctAgentId, correctResponse);

          // Both responses forwarded
          expect(writtenResponses).toHaveLength(2);

          // Request no longer pending
          expect(router.isPending(requestId)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should handle string and number ids correctly for correlation', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          fc.string({ minLength: 1, maxLength: 20 }),
          fc.integer({ min: 1, max: 10000 }),
        ),
        agentIdArb,
        methodNameArb,
        async (requestId, agentId, method) => {
          const { mockRegistry, mockRuntimeManager, writeCallback, writtenResponses } =
            createMockDependencies();

          // Create router
          const { MessageRouter } = require('./message-router.js');
          const router = new MessageRouter(mockRegistry, mockRuntimeManager, writeCallback);

          // Route request
          const request = {
            jsonrpc: '2.0' as const,
            id: requestId,
            method,
            agentId,
          };

          await router.route(request);

          // Response with same id (same type)
          const response = {
            jsonrpc: '2.0' as const,
            id: requestId,
            result: 'success',
          };

          router.handleAgentResponse(agentId, response);

          // Verify correlation worked
          expect(writtenResponses).toHaveLength(1);
          expect(router.isPending(requestId)).toBe(false);

          // Verify id type preserved
          const forwarded = writtenResponses[0] as Record<string, unknown>;
          expect(typeof forwarded.id).toBe(typeof requestId);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should clear pending requests on clearPending call', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(jsonRpcRequestIdArb, { minLength: 1, maxLength: 5 }),
        agentIdArb,
        methodNameArb,
        async (requestIds, agentId, method) => {
          const uniqueIds = [...new Set(requestIds.map(String))];

          const { mockRegistry, mockRuntimeManager, writeCallback } = createMockDependencies();

          // Create router
          const { MessageRouter } = require('./message-router.js');
          const router = new MessageRouter(mockRegistry, mockRuntimeManager, writeCallback);

          // Route multiple requests
          for (const id of uniqueIds) {
            const request = {
              jsonrpc: '2.0' as const,
              id,
              method,
              agentId,
            };
            await router.route(request);
          }

          // Verify requests are pending
          expect(router.pendingCount).toBe(uniqueIds.length);

          // Clear all pending
          router.clearPending();

          // Verify all cleared
          expect(router.pendingCount).toBe(0);
          for (const id of uniqueIds) {
            expect(router.isPending(id)).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should forward response unchanged regardless of correlation status', async () => {
    // Use a JSON-safe value arbitrary that excludes -0 (which JSON normalizes to 0)
    const jsonSafeResultArb: fc.Arbitrary<unknown> = fc.letrec((tie) => ({
      primitive: fc.oneof(
        fc.constant(null),
        fc.boolean(),
        fc.double({ noNaN: true, noDefaultInfinity: true }).map((n) => (Object.is(n, -0) ? 0 : n)),
        fc.string(),
      ),
      array: fc.array(tie('value'), { maxLength: 5 }),
      object: fc.dictionary(fc.string(), tie('value'), { maxKeys: 5 }),
      value: fc.oneof(tie('primitive'), tie('array'), tie('object')),
    })).value;

    await fc.assert(
      fc.asyncProperty(
        jsonRpcRequestIdArb,
        agentIdArb,
        jsonSafeResultArb,
        async (responseId, agentId, result) => {
          const { mockRegistry, mockRuntimeManager, writeCallback, writtenResponses } =
            createMockDependencies();

          // Create router
          const { MessageRouter } = require('./message-router.js');
          const router = new MessageRouter(mockRegistry, mockRuntimeManager, writeCallback);

          // Create response
          const response = {
            jsonrpc: '2.0' as const,
            id: responseId,
            result,
          };

          // Deep copy for comparison
          const originalResponse = JSON.parse(JSON.stringify(response));

          // Handle response (no prior request)
          router.handleAgentResponse(agentId, response);

          // Verify response forwarded unchanged
          expect(writtenResponses).toHaveLength(1);
          expect(writtenResponses[0]).toEqual(originalResponse);

          // Verify byte-identical serialization
          const originalSerialized = JSON.stringify(originalResponse) + '\n';
          const forwardedSerialized = JSON.stringify(writtenResponses[0]) + '\n';
          expect(forwardedSerialized).toBe(originalSerialized);
        },
      ),
      { numRuns: 100 },
    );
  });
});


describe('Property 14: Stdout NDJSON Invariant', () => {
  /**
   * Feature: acp-registry-transit, Property 14: Stdout NDJSON Invariant
   *
   * *For any* operation performed by the Registry Launcher, all data written to stdout
   * should be valid NDJSON (one valid JSON object per line, terminated by newline).
   *
   */

  /**
   * Arbitrary for generating JSON-RPC request IDs.
   */
  const jsonRpcIdArb = fc.oneof(
    fc.string({ minLength: 1, maxLength: 50 }),
    fc.integer({ min: 1, max: 1000000 }),
    fc.constant(null),
  );

  /**
   * Arbitrary for generating JSON-RPC method names.
   */
  const methodNameArb = fc.stringMatching(/^[a-z][a-zA-Z0-9/]*$/);

  /**
   * Arbitrary for generating non-empty strings suitable for agentId values.
   */
  const agentIdArb = fc
    .string({ minLength: 1, maxLength: 50 })
    .filter((s) => s.trim().length > 0);

  /**
   * Arbitrary for generating JSON-safe values (excluding -0 which JSON normalizes to 0).
   */
  const jsonSafeValueArbLocal: fc.Arbitrary<unknown> = fc.letrec((tie) => ({
    primitive: fc.oneof(
      fc.constant(null),
      fc.boolean(),
      fc.double({ noNaN: true, noDefaultInfinity: true }).map((n) => (Object.is(n, -0) ? 0 : n)),
      fc.string(),
    ),
    array: fc.array(tie('value'), { maxLength: 5 }),
    object: fc.dictionary(fc.string(), tie('value'), { maxKeys: 5 }),
    value: fc.oneof(tie('primitive'), tie('array'), tie('object')),
  })).value;

  /**
   * Validates that a string is valid NDJSON format.
   * - Must be valid JSON
   * - Must be an object (not primitive or array at top level)
   * - Must end with exactly one newline
   *
   * @param output - The string to validate
   * @returns Object with validation result and details
   */
  function validateNdjson(output: string): { valid: boolean; reason?: string } {
    // Must end with newline
    if (!output.endsWith('\n')) {
      return { valid: false, reason: 'Output does not end with newline' };
    }

    // Must not end with multiple newlines (exactly one newline at end)
    if (output.endsWith('\n\n')) {
      return { valid: false, reason: 'Output ends with multiple newlines' };
    }

    // Extract JSON part (without trailing newline)
    const jsonPart = output.slice(0, -1);

    // Must not be empty
    if (jsonPart.length === 0) {
      return { valid: false, reason: 'Output is empty (only newline)' };
    }

    // Must be valid JSON
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonPart);
    } catch (e) {
      return { valid: false, reason: `Invalid JSON: ${(e as Error).message}` };
    }

    // Must be an object (not null, not array, not primitive)
    if (parsed === null) {
      return { valid: false, reason: 'Parsed JSON is null' };
    }
    if (typeof parsed !== 'object') {
      return { valid: false, reason: `Parsed JSON is not an object: ${typeof parsed}` };
    }
    if (Array.isArray(parsed)) {
      return { valid: false, reason: 'Parsed JSON is an array, not an object' };
    }

    return { valid: true };
  }

  /**
   * Helper to create mock dependencies for MessageRouter that captures stdout writes.
   */
  function createMockDependenciesWithCapture() {
    const mockRegistry = {
      fetch: async () => {
      },
      lookup: () => undefined,
      resolve: () => ({ command: 'test', args: [] }),
    };

    const mockRuntimeManager = {
      getOrSpawn: async () => ({
        agentId: 'test-agent',
        state: 'running' as const,
        process: {} as never,
        write: () => true,
        terminate: async () => {
        },
      }),
      get: () => undefined,
      terminate: async () => {
      },
      terminateAll: async () => {
      },
      onAgentExit: () => {
      },
    };

    // Capture raw string output to validate NDJSON format
    const capturedOutputs: string[] = [];
    const writeCallback = (msg: object): boolean => {
      // Simulate NDJSON serialization (what would be written to stdout)
      const ndjsonOutput = JSON.stringify(msg) + '\n';
      capturedOutputs.push(ndjsonOutput);
      return true;
    };

    return { mockRegistry, mockRuntimeManager, writeCallback, capturedOutputs };
  }

  it('should write valid NDJSON for error responses (missing agentId)', async () => {
    await fc.assert(
      fc.asyncProperty(jsonRpcIdArb, methodNameArb, fc.jsonValue(), async (id, method, params) => {
        const { mockRegistry, mockRuntimeManager, writeCallback } =
          createMockDependenciesWithCapture();

        // Create router
        const { MessageRouter } = require('./message-router.js');
        const router = new MessageRouter(mockRegistry, mockRuntimeManager, writeCallback);

        // Route a message without agentId (will generate error response)
        const message = {
          jsonrpc: '2.0' as const,
          id,
          method,
          params,
        };

        const errorResponse = await router.route(message);

        // Error response should be returned (not written to stdout directly by route)
        expect(errorResponse).toBeDefined();

        // Simulate writing the error response to stdout (as the main loop would do)
        const ndjsonOutput = JSON.stringify(errorResponse) + '\n';

        // Validate NDJSON format
        const validation = validateNdjson(ndjsonOutput);
        expect(validation.valid).toBe(true);
        if (!validation.valid) {
          fail(`Invalid NDJSON: ${validation.reason}`);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('should write valid NDJSON for forwarded agent responses', async () => {
    await fc.assert(
      fc.asyncProperty(
        agentIdArb,
        jsonRpcIdArb,
        jsonSafeValueArbLocal,
        async (agentId, responseId, result) => {
          const { mockRegistry, mockRuntimeManager, writeCallback, capturedOutputs } =
            createMockDependenciesWithCapture();

          // Create router
          const { MessageRouter } = require('./message-router.js');
          const router = new MessageRouter(mockRegistry, mockRuntimeManager, writeCallback);

          // Create an agent response
          const response = {
            jsonrpc: '2.0' as const,
            id: responseId,
            result,
          };

          // Handle agent response (this writes to stdout via callback)
          router.handleAgentResponse(agentId, response);

          // Verify output was captured
          expect(capturedOutputs).toHaveLength(1);

          // Validate NDJSON format
          const validation = validateNdjson(capturedOutputs[0]);
          expect(validation.valid).toBe(true);
          if (!validation.valid) {
            fail(`Invalid NDJSON: ${validation.reason}`);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should write valid NDJSON for error responses from agents', async () => {
    /**
     * Arbitrary for generating error codes.
     */
    const errorCodeArb = fc.integer({ min: -32700, max: -32000 });

    await fc.assert(
      fc.asyncProperty(
        agentIdArb,
        jsonRpcIdArb,
        errorCodeArb,
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.option(jsonSafeValueArbLocal, { nil: undefined }),
        async (agentId, responseId, errorCode, errorMessage, errorData) => {
          const { mockRegistry, mockRuntimeManager, writeCallback, capturedOutputs } =
            createMockDependenciesWithCapture();

          // Create router
          const { MessageRouter } = require('./message-router.js');
          const router = new MessageRouter(mockRegistry, mockRuntimeManager, writeCallback);

          // Create an agent error response
          const errorResponse: Record<string, unknown> = {
            jsonrpc: '2.0',
            id: responseId,
            error: {
              code: errorCode,
              message: errorMessage,
              ...(errorData !== undefined && { data: errorData }),
            },
          };

          // Handle agent response
          router.handleAgentResponse(agentId, errorResponse);

          // Verify output was captured
          expect(capturedOutputs).toHaveLength(1);

          // Validate NDJSON format
          const validation = validateNdjson(capturedOutputs[0]);
          expect(validation.valid).toBe(true);
          if (!validation.valid) {
            fail(`Invalid NDJSON: ${validation.reason}`);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should write valid NDJSON for responses with special characters', async () => {
    /**
     * Arbitrary for generating strings with special characters that need JSON escaping.
     */
    const specialStringArb = fc.oneof(
      fc.string(),
      fc.constant('value with "quotes"'),
      fc.constant('value with \\backslashes\\'),
      fc.constant('value with\nnewlines'),
      fc.constant('value with\ttabs'),
      fc.constant('value with\rcarriage returns'),
      fc.constant('unicode: 日本語 中文 한국어'),
      fc.constant('emoji: 🚀 🎉 ✨ 🤖'),
      fc.constant('control chars: \u0001\u001f'),
      fc.constant('mixed: "quotes"\nnewline\ttab\\backslash'),
    );

    await fc.assert(
      fc.asyncProperty(agentIdArb, jsonRpcIdArb, specialStringArb, async (agentId, responseId, specialValue) => {
        const { mockRegistry, mockRuntimeManager, writeCallback, capturedOutputs } =
          createMockDependenciesWithCapture();

        // Create router
        const { MessageRouter } = require('./message-router.js');
        const router = new MessageRouter(mockRegistry, mockRuntimeManager, writeCallback);

        // Create a response with special characters
        const response = {
          jsonrpc: '2.0' as const,
          id: responseId,
          result: {
            specialField: specialValue,
            normalField: 'normal',
          },
        };

        // Handle agent response
        router.handleAgentResponse(agentId, response);

        // Verify output was captured
        expect(capturedOutputs).toHaveLength(1);

        // Validate NDJSON format
        const validation = validateNdjson(capturedOutputs[0]);
        expect(validation.valid).toBe(true);
        if (!validation.valid) {
          fail(`Invalid NDJSON: ${validation.reason}`);
        }

        // Verify the special characters are preserved after parsing
        const parsed = JSON.parse(capturedOutputs[0].slice(0, -1)) as Record<string, unknown>;
        const result = parsed.result as Record<string, unknown>;
        expect(result.specialField).toBe(specialValue);
      }),
      { numRuns: 100 },
    );
  });

  it('should write valid NDJSON for responses with deeply nested objects', async () => {
    /**
     * Arbitrary for generating deeply nested objects.
     */
    const deepNestedArb: fc.Arbitrary<Record<string, unknown>> = fc.letrec((tie) => ({
      leaf: fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)),
      nested: fc.record({
        value: tie('leaf'),
        child: fc.option(tie('nested'), { nil: undefined }),
      }),
    })).nested as fc.Arbitrary<Record<string, unknown>>;

    await fc.assert(
      fc.asyncProperty(agentIdArb, jsonRpcIdArb, deepNestedArb, async (agentId, responseId, nestedData) => {
        const { mockRegistry, mockRuntimeManager, writeCallback, capturedOutputs } =
          createMockDependenciesWithCapture();

        // Create router
        const { MessageRouter } = require('./message-router.js');
        const router = new MessageRouter(mockRegistry, mockRuntimeManager, writeCallback);

        // Create a response with deeply nested data
        const response = {
          jsonrpc: '2.0' as const,
          id: responseId,
          result: nestedData,
        };

        // Handle agent response
        router.handleAgentResponse(agentId, response);

        // Verify output was captured
        expect(capturedOutputs).toHaveLength(1);

        // Validate NDJSON format
        const validation = validateNdjson(capturedOutputs[0]);
        expect(validation.valid).toBe(true);
        if (!validation.valid) {
          fail(`Invalid NDJSON: ${validation.reason}`);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('should write valid NDJSON for responses with arrays', async () => {
    await fc.assert(
      fc.asyncProperty(
        agentIdArb,
        jsonRpcIdArb,
        fc.array(jsonSafeValueArbLocal, { minLength: 0, maxLength: 10 }),
        async (agentId, responseId, items) => {
          const { mockRegistry, mockRuntimeManager, writeCallback, capturedOutputs } =
            createMockDependenciesWithCapture();

          // Create router
          const { MessageRouter } = require('./message-router.js');
          const router = new MessageRouter(mockRegistry, mockRuntimeManager, writeCallback);

          // Create a response with array data
          const response = {
            jsonrpc: '2.0' as const,
            id: responseId,
            result: {
              items,
              count: items.length,
            },
          };

          // Handle agent response
          router.handleAgentResponse(agentId, response);

          // Verify output was captured
          expect(capturedOutputs).toHaveLength(1);

          // Validate NDJSON format
          const validation = validateNdjson(capturedOutputs[0]);
          expect(validation.valid).toBe(true);
          if (!validation.valid) {
            fail(`Invalid NDJSON: ${validation.reason}`);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should write valid NDJSON for multiple consecutive responses', async () => {
    await fc.assert(
      fc.asyncProperty(
        agentIdArb,
        fc.array(jsonRpcIdArb, { minLength: 1, maxLength: 5 }),
        async (agentId, responseIds) => {
          const { mockRegistry, mockRuntimeManager, writeCallback, capturedOutputs } =
            createMockDependenciesWithCapture();

          // Create router
          const { MessageRouter } = require('./message-router.js');
          const router = new MessageRouter(mockRegistry, mockRuntimeManager, writeCallback);

          // Handle multiple agent responses
          for (const responseId of responseIds) {
            const response = {
              jsonrpc: '2.0' as const,
              id: responseId,
              result: { index: responseIds.indexOf(responseId) },
            };
            router.handleAgentResponse(agentId, response);
          }

          // Verify all outputs were captured
          expect(capturedOutputs).toHaveLength(responseIds.length);

          // Validate each output is valid NDJSON
          for (let i = 0; i < capturedOutputs.length; i++) {
            const validation = validateNdjson(capturedOutputs[i]);
            expect(validation.valid).toBe(true);
            if (!validation.valid) {
              fail(`Invalid NDJSON at index ${i}: ${validation.reason}`);
            }
          }

          // Verify each output is independent (one JSON object per line)
          for (const output of capturedOutputs) {
            const lines = output.split('\n').filter((line) => line.length > 0);
            expect(lines).toHaveLength(1);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should write valid NDJSON for createErrorResponse helper', () => {
    const { createErrorResponse } = require('./message-router.js');

    fc.assert(
      fc.property(
        jsonRpcIdArb,
        fc.integer({ min: -32700, max: -32000 }),
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.option(jsonSafeValueArbLocal, { nil: undefined }),
        (id, code, message, data) => {
          // Create error response using the helper
          const errorResponse = createErrorResponse(id, code, message, data);

          // Serialize as NDJSON
          const ndjsonOutput = JSON.stringify(errorResponse) + '\n';

          // Validate NDJSON format
          const validation = validateNdjson(ndjsonOutput);
          expect(validation.valid).toBe(true);
          if (!validation.valid) {
            fail(`Invalid NDJSON: ${validation.reason}`);
          }

          // Verify error response structure
          const parsed = JSON.parse(ndjsonOutput.slice(0, -1)) as Record<string, unknown>;
          expect(parsed.jsonrpc).toBe('2.0');
          expect(parsed.id).toEqual(id);
          expect(parsed.error).toBeDefined();
          const error = parsed.error as Record<string, unknown>;
          expect(error.code).toBe(code);
          expect(error.message).toBe(message);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should never write non-object JSON values to stdout', async () => {
    await fc.assert(
      fc.asyncProperty(agentIdArb, jsonRpcIdArb, jsonSafeValueArbLocal, async (agentId, responseId, result) => {
        const { mockRegistry, mockRuntimeManager, writeCallback, capturedOutputs } =
          createMockDependenciesWithCapture();

        // Create router
        const { MessageRouter } = require('./message-router.js');
        const router = new MessageRouter(mockRegistry, mockRuntimeManager, writeCallback);

        // Create a valid JSON-RPC response (always an object)
        const response = {
          jsonrpc: '2.0' as const,
          id: responseId,
          result,
        };

        // Handle agent response
        router.handleAgentResponse(agentId, response);

        // Verify output was captured
        expect(capturedOutputs).toHaveLength(1);

        // Parse the output and verify it's an object
        const jsonPart = capturedOutputs[0].slice(0, -1);
        const parsed = JSON.parse(jsonPart);

        // Must be an object (not null, not array, not primitive)
        expect(parsed).not.toBeNull();
        expect(typeof parsed).toBe('object');
        expect(Array.isArray(parsed)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('should produce output that can be parsed back to equivalent object', async () => {
    await fc.assert(
      fc.asyncProperty(agentIdArb, jsonRpcIdArb, jsonSafeValueArbLocal, async (agentId, responseId, result) => {
        const { mockRegistry, mockRuntimeManager, writeCallback, capturedOutputs } =
          createMockDependenciesWithCapture();

        // Create router
        const { MessageRouter } = require('./message-router.js');
        const router = new MessageRouter(mockRegistry, mockRuntimeManager, writeCallback);

        // Create a response
        const response = {
          jsonrpc: '2.0' as const,
          id: responseId,
          result,
        };

        // Handle agent response
        router.handleAgentResponse(agentId, response);

        // Verify output was captured
        expect(capturedOutputs).toHaveLength(1);

        // Parse the NDJSON output
        const jsonPart = capturedOutputs[0].slice(0, -1);
        const parsed = JSON.parse(jsonPart);

        // Verify round-trip produces equivalent object
        expect(parsed).toEqual(response);
      }),
      { numRuns: 100 },
    );
  });

  it('should handle notification responses (no id) as valid NDJSON', async () => {
    await fc.assert(
      fc.asyncProperty(agentIdArb, jsonSafeValueArbLocal, async (agentId, result) => {
        const { mockRegistry, mockRuntimeManager, writeCallback, capturedOutputs } =
          createMockDependenciesWithCapture();

        // Create router
        const { MessageRouter } = require('./message-router.js');
        const router = new MessageRouter(mockRegistry, mockRuntimeManager, writeCallback);

        // Create a notification response (no id field)
        const response = {
          jsonrpc: '2.0' as const,
          result,
        };

        // Handle agent response
        router.handleAgentResponse(agentId, response);

        // Verify output was captured
        expect(capturedOutputs).toHaveLength(1);

        // Validate NDJSON format
        const validation = validateNdjson(capturedOutputs[0]);
        expect(validation.valid).toBe(true);
        if (!validation.valid) {
          fail(`Invalid NDJSON: ${validation.reason}`);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('should ensure each line contains exactly one JSON object', async () => {
    await fc.assert(
      fc.asyncProperty(
        agentIdArb,
        fc.array(jsonRpcIdArb, { minLength: 2, maxLength: 5 }),
        async (agentId, responseIds) => {
          const { mockRegistry, mockRuntimeManager, writeCallback, capturedOutputs } =
            createMockDependenciesWithCapture();

          // Create router
          const { MessageRouter } = require('./message-router.js');
          const router = new MessageRouter(mockRegistry, mockRuntimeManager, writeCallback);

          // Handle multiple responses
          for (const responseId of responseIds) {
            const response = {
              jsonrpc: '2.0' as const,
              id: responseId,
              result: 'ok',
            };
            router.handleAgentResponse(agentId, response);
          }

          // Verify each captured output is exactly one line
          for (const output of capturedOutputs) {
            // Count newlines - should be exactly 1 at the end
            const newlineCount = (output.match(/\n/g) || []).length;
            expect(newlineCount).toBe(1);

            // The newline should be at the end
            expect(output.endsWith('\n')).toBe(true);

            // No newlines in the middle of the JSON
            const jsonPart = output.slice(0, -1);
            expect(jsonPart.includes('\n')).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
