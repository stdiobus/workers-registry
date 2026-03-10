import * as fc from 'fast-check';
import { convertContentBlocks, buildMessages } from '../src/agent';

/**
 * Property-based tests for content block conversion and request construction.
 *
 * Feature: openai-acp-agent
 * Properties 5, 6, 7 from design document.
 */

// --- Arbitrary generators for ACP content blocks ---

const arbTextBlock = fc.record({
  type: fc.constant('text' as const),
  text: fc.string({ minLength: 1 }),
});

const arbResourceLinkBlock = fc.record({
  type: fc.constant('resource_link' as const),
  uri: fc.string({ minLength: 1 }),
  name: fc.string({ minLength: 1 }),
});

const arbResourceBlock = fc.record({
  type: fc.constant('resource' as const),
  resource: fc.record({
    uri: fc.string({ minLength: 1 }),
    text: fc.string(),
  }),
});

const arbImageBlock = fc.record({
  type: fc.constant('image' as const),
  mimeType: fc.string({ minLength: 1 }),
});

const arbContentBlock = fc.oneof(arbTextBlock, arbResourceLinkBlock, arbResourceBlock, arbImageBlock);

// --- Arbitrary generators for history entries ---

const arbHistoryEntry = fc.record({
  role: fc.constantFrom('user' as const, 'assistant' as const),
  content: fc.string({ minLength: 1 }),
});

describe('Conversion property tests', () => {
  /**
   * Property 5: Content block conversion produces valid OpenAI messages.
   *
   * For any array of ACP content blocks (text, resource_link, resource, image),
   * the conversion function produces a non-empty string for each block, and the
   * concatenated result is a valid OpenAI user message containing all text content
   * from the input blocks.
   *
   * **Validates: Requirements 3.1, 3.8**
   */
  it('Property 5: each content block type produces a non-empty string', () => {
    fc.assert(
      fc.property(
        arbContentBlock,
        (block) => {
          const result = convertContentBlocks([block as any]);
          expect(typeof result).toBe('string');
          expect(result.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property 5: multiple blocks produce a combined non-empty string', () => {
    fc.assert(
      fc.property(
        fc.array(arbContentBlock, { minLength: 1, maxLength: 20 }),
        (blocks) => {
          const result = convertContentBlocks(blocks as any[]);
          expect(typeof result).toBe('string');
          expect(result.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property 5: text block content is preserved in output', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        (text) => {
          const block = { type: 'text' as const, text };
          const result = convertContentBlocks([block as any]);
          expect(result).toContain(text);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Property 6: Request construction includes full session history.
   *
   * For any session with N history entries, the constructed messages array
   * contains all N history entries as OpenAI messages in the correct order,
   * plus the new user message, and optionally a system prompt as the first message.
   *
   * **Validates: Requirements 3.2, 7.4**
   */
  it('Property 6: buildMessages includes all history entries in order plus user message', () => {
    fc.assert(
      fc.property(
        fc.array(arbHistoryEntry, { minLength: 0, maxLength: 30 }),
        fc.string({ minLength: 1 }),
        (history, userMessage) => {
          const messages = buildMessages(undefined, history, userMessage);

          // Should have N history entries + 1 user message
          expect(messages.length).toBe(history.length + 1);

          // History entries are in order
          for (let i = 0; i < history.length; i++) {
            expect(messages[i].role).toBe(history[i].role);
            expect(messages[i].content).toBe(history[i].content);
          }

          // Last message is the new user message
          const last = messages[messages.length - 1];
          expect(last.role).toBe('user');
          expect(last.content).toBe(userMessage);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property 6: system prompt is first message when present', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.array(arbHistoryEntry, { minLength: 0, maxLength: 20 }),
        fc.string({ minLength: 1 }),
        (systemPrompt, history, userMessage) => {
          const messages = buildMessages(systemPrompt, history, userMessage);

          // Should have 1 system + N history + 1 user
          expect(messages.length).toBe(1 + history.length + 1);

          // First message is system prompt
          expect(messages[0].role).toBe('system');
          expect(messages[0].content).toBe(systemPrompt);

          // History entries follow in order
          for (let i = 0; i < history.length; i++) {
            expect(messages[i + 1].role).toBe(history[i].role);
            expect(messages[i + 1].content).toBe(history[i].content);
          }

          // Last message is the new user message
          const last = messages[messages.length - 1];
          expect(last.role).toBe('user');
          expect(last.content).toBe(userMessage);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Property 7: Request construction invariants.
   *
   * For any config and message array, the constructed messages array always
   * has the system prompt first (when present) and user message last.
   * The buildMessages function produces a valid OpenAI messages structure.
   *
   * **Validates: Requirements 3.5, 3.6, 4.1**
   */
  it('Property 7: system prompt is always first when provided', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.array(arbHistoryEntry, { minLength: 0, maxLength: 20 }),
        fc.string({ minLength: 1 }),
        (systemPrompt, history, userMessage) => {
          const messages = buildMessages(systemPrompt, history, userMessage);

          // System prompt is always first
          expect(messages[0].role).toBe('system');
          expect(messages[0].content).toBe(systemPrompt);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property 7: user message is always last', () => {
    fc.assert(
      fc.property(
        fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
        fc.array(arbHistoryEntry, { minLength: 0, maxLength: 20 }),
        fc.string({ minLength: 1 }),
        (systemPrompt, history, userMessage) => {
          const messages = buildMessages(systemPrompt, history, userMessage);

          // User message is always last
          const last = messages[messages.length - 1];
          expect(last.role).toBe('user');
          expect(last.content).toBe(userMessage);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property 7: all messages have valid roles', () => {
    fc.assert(
      fc.property(
        fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
        fc.array(arbHistoryEntry, { minLength: 0, maxLength: 20 }),
        fc.string({ minLength: 1 }),
        (systemPrompt, history, userMessage) => {
          const messages = buildMessages(systemPrompt, history, userMessage);

          const validRoles = new Set(['system', 'user', 'assistant']);
          for (const msg of messages) {
            expect(validRoles.has(msg.role)).toBe(true);
            expect(typeof msg.content).toBe('string');
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property 7: messages array length is correct', () => {
    fc.assert(
      fc.property(
        fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
        fc.array(arbHistoryEntry, { minLength: 0, maxLength: 20 }),
        fc.string({ minLength: 1 }),
        (systemPrompt, history, userMessage) => {
          const messages = buildMessages(systemPrompt, history, userMessage);

          const expectedLength = (systemPrompt ? 1 : 0) + history.length + 1;
          expect(messages.length).toBe(expectedLength);
        },
      ),
      { numRuns: 100 },
    );
  });
});
