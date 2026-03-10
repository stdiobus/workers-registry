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

import { ChatCompletionsClient, classifyHttpError } from '../src/client';
import { AgentConfig } from '../src/types';

const baseConfig: AgentConfig = {
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'test-key',
  model: 'gpt-4o',
};

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
});

describe('classifyHttpError', () => {
  it('returns authentication error for HTTP 401', () => {
    const msg = classifyHttpError(401, 'https://api.example.com/v1/chat/completions');
    expect(msg).toContain('Authentication error');
    expect(msg).toContain('401');
    expect(msg).toContain('https://api.example.com/v1/chat/completions');
  });

  it('returns authentication error for HTTP 403', () => {
    const msg = classifyHttpError(403, 'https://api.example.com/v1/chat/completions');
    expect(msg).toContain('Authentication error');
    expect(msg).toContain('403');
  });

  it('returns rate limit error for HTTP 429', () => {
    const msg = classifyHttpError(429, 'https://api.example.com/v1/chat/completions');
    expect(msg).toContain('Rate limit exceeded');
    expect(msg).toContain('429');
  });

  it('returns server error for HTTP 500', () => {
    const msg = classifyHttpError(500, 'https://api.example.com/v1/chat/completions');
    expect(msg).toContain('Server error');
    expect(msg).toContain('500');
  });

  it('returns server error for HTTP 503', () => {
    const msg = classifyHttpError(503, 'https://api.example.com/v1/chat/completions');
    expect(msg).toContain('Server error');
    expect(msg).toContain('503');
  });
});

describe('ChatCompletionsClient', () => {
  const client = new ChatCompletionsClient(baseConfig);

  describe('HTTP error handling', () => {
    it('throws authentication error on 401', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 401 });
      await expect(
        client.streamCompletion(
          [{ role: 'user', content: 'hi' }],
          new AbortController().signal,
          jest.fn(),
        ),
      ).rejects.toThrow(/Authentication error/);
    });

    it('throws authentication error on 403', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 403 });
      await expect(
        client.streamCompletion(
          [{ role: 'user', content: 'hi' }],
          new AbortController().signal,
          jest.fn(),
        ),
      ).rejects.toThrow(/Authentication error/);
    });

    it('throws rate limit error on 429', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 429 });
      await expect(
        client.streamCompletion(
          [{ role: 'user', content: 'hi' }],
          new AbortController().signal,
          jest.fn(),
        ),
      ).rejects.toThrow(/Rate limit exceeded/);
    });

    it('throws server error on 500', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 500 });
      await expect(
        client.streamCompletion(
          [{ role: 'user', content: 'hi' }],
          new AbortController().signal,
          jest.fn(),
        ),
      ).rejects.toThrow(/Server error/);
    });
  });

  describe('network error', () => {
    it('throws network error when fetch fails', async () => {
      mockFetch.mockRejectedValue(new TypeError('fetch failed'));
      await expect(
        client.streamCompletion(
          [{ role: 'user', content: 'hi' }],
          new AbortController().signal,
          jest.fn(),
        ),
      ).rejects.toThrow(/Network error/);
    });
  });

  describe('successful stream', () => {
    it('parses SSE stream and calls onChunk', async () => {
      const sseLines = [
        'data: {"choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}\n',
        '\n',
        'data: {"choices":[{"index":0,"delta":{"content":" world"},"finish_reason":null}]}\n',
        '\n',
        'data: [DONE]\n',
      ].join('');

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(sseLines));
          controller.close();
        },
      });

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        body: stream,
      });

      const chunks: string[] = [];
      const result = await client.streamCompletion(
        [{ role: 'user', content: 'hi' }],
        new AbortController().signal,
        async (text) => { chunks.push(text); },
      );

      expect(result.stopReason).toBe('end_turn');
      expect(result.fullResponse).toBe('Hello world');
      expect(chunks).toEqual(['Hello', ' world']);
    });
  });

  describe('cancellation', () => {
    it('returns cancelled when fetch is aborted', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValue(abortError);

      const controller = new AbortController();
      controller.abort();

      const result = await client.streamCompletion(
        [{ role: 'user', content: 'hi' }],
        controller.signal,
        jest.fn(),
      );

      expect(result.stopReason).toBe('cancelled');
    });

    it('returns cancelled when stream read is aborted', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';

      const stream = new ReadableStream({
        start(controller) {
          // Enqueue one chunk then the reader will throw AbortError
          const encoder = new TextEncoder();
          controller.enqueue(encoder.encode('data: {"choices":[{"index":0,"delta":{"content":"Hi"},"finish_reason":null}]}\n'));
        },
        pull() {
          throw abortError;
        },
      });

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        body: stream,
      });

      const result = await client.streamCompletion(
        [{ role: 'user', content: 'hi' }],
        new AbortController().signal,
        jest.fn(),
      );

      expect(result.stopReason).toBe('cancelled');
    });
  });
});
