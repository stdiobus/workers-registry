import * as fc from 'fast-check';
import { parseLine } from '../src/sse-parser';

/**
 * Property 8: SSE chunk content extraction
 * Validates: Requirements 4.2, 4.3
 *
 * For any valid SSE chunk JSON with choices[0].delta.content set to a non-empty string,
 * the parser SHALL extract the JSON payload. For any SSE chunk JSON where delta is empty
 * or has no content field, the parser SHALL return data (the extraction happens in the
 * client, not the parser — the parser just returns the JSON payload).
 */
describe('Property 8: SSE chunk content extraction', () => {
  it('extracts JSON payload from valid SSE chunks with delta.content', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }).filter(s => !s.includes('"') && !s.includes('\\')),
        (content) => {
          const chunk = {
            id: 'chatcmpl-1',
            object: 'chat.completion.chunk',
            choices: [{ index: 0, delta: { content }, finish_reason: null }],
          };
          const line = `data: ${JSON.stringify(chunk)}`;
          const result = parseLine(line);

          expect(result.type).toBe('data');
          if (result.type === 'data') {
            const payload = result.payload as { choices: Array<{ delta: { content: string } }> };
            expect(payload.choices[0].delta.content).toBe(content);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('returns data type for chunks with empty delta or no content field', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant({ id: 'chatcmpl-1', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: null }] }),
          fc.constant({ id: 'chatcmpl-1', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] }),
        ),
        (chunk) => {
          const line = `data: ${JSON.stringify(chunk)}`;
          const result = parseLine(line);

          // Parser returns data — content extraction is the client's responsibility
          expect(result.type).toBe('data');
        },
      ),
      { numRuns: 100 },
    );
  });
});


/**
 * Property 11: Invalid SSE JSON does not crash parser
 * Validates: Requirements 6.5
 *
 * For any string that is not valid JSON, when encountered as the data payload of an SSE line,
 * the parser SHALL not throw an exception and SHALL return a skip indicator.
 */
describe('Property 11: Invalid SSE JSON does not crash parser', () => {
  it('does not throw on arbitrary non-JSON strings prefixed with data: ', () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

    fc.assert(
      fc.property(
        fc.string().filter(s => {
          try { JSON.parse(s); return false; } catch { return true; }
        }),
        (invalidJson) => {
          const line = `data: ${invalidJson}`;
          const result = parseLine(line);

          expect(result.type).toBe('skip');
        },
      ),
      { numRuns: 100 },
    );

    consoleSpy.mockRestore();
  });
});

/**
 * Property 14: SSE line classification
 * Validates: Requirements 12.1, 12.2, 12.3, 12.4
 *
 * - data: {json} → type: 'data'
 * - data: [DONE] → type: 'done'
 * - empty/whitespace → type: 'skip'
 * - :comment → type: 'skip'
 */
describe('Property 14: SSE line classification', () => {
  it('classifies data: {json} lines as data', () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.string({ minLength: 1 }), fc.oneof(fc.string(), fc.integer(), fc.boolean())),
        (obj) => {
          const line = `data: ${JSON.stringify(obj)}`;
          const result = parseLine(line);
          expect(result.type).toBe('data');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('classifies data: [DONE] as done', () => {
    const result = parseLine('data: [DONE]');
    expect(result.type).toBe('done');
  });

  it('classifies empty and whitespace-only lines as skip', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(' ', '\t', '\r'), { minLength: 0, maxLength: 20 }).map(arr => arr.join('')),
        (whitespace: string) => {
          const result = parseLine(whitespace);
          expect(result.type).toBe('skip');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('classifies :comment lines as skip', () => {
    fc.assert(
      fc.property(
        fc.string(),
        (comment) => {
          const line = `:${comment}`;
          const result = parseLine(line);
          expect(result.type).toBe('skip');
        },
      ),
      { numRuns: 100 },
    );
  });
});

/**
 * Property 15: SSE content round-trip preservation
 * Validates: Requirements 12.5
 *
 * For all valid text strings, parsing a well-formed SSE chunk containing that text
 * from the data: field, extracting the content from the parsed payload, SHALL yield
 * the original text unchanged.
 */
describe('Property 15: SSE content round-trip preservation', () => {
  it('preserves content through SSE parse → extract round-trip', () => {
    fc.assert(
      fc.property(
        fc.string(),
        (originalText) => {
          // Create a valid SSE chunk with the text in choices[0].delta.content
          const chunk = {
            id: 'chatcmpl-1',
            object: 'chat.completion.chunk',
            choices: [{ index: 0, delta: { content: originalText }, finish_reason: null }],
          };
          const line = `data: ${JSON.stringify(chunk)}`;

          // Parse the SSE line
          const result = parseLine(line);
          expect(result.type).toBe('data');

          if (result.type === 'data') {
            // Extract content from parsed payload (simulating what the client does)
            const payload = result.payload as { choices: Array<{ delta: { content?: string } }> };
            const extractedContent = payload.choices[0].delta.content;

            // Round-trip: original text should be preserved exactly
            expect(extractedContent).toBe(originalText);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
