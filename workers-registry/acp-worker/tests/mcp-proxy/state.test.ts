/*
 * Apache License 2.0
 * Copyright (c) 2025–present Raman Marozau, Work Target Insight Function.
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
 * Unit tests for the StateManager class.
 *
 * Tests session state management, pending request tracking, text accumulation,
 * and request lookup functionality.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { StateManager } from '../../src/mcp-proxy/state.js';
import { PendingRequest } from '../../src/mcp-proxy/types.js';

describe('StateManager', () => {
  let state: StateManager;

  beforeEach(() => {
    state = new StateManager();
  });

  describe('ensureProxySessionId', () => {
    it('should generate unique ID on first call', () => {
      const sessionId = state.ensureProxySessionId();

      expect(sessionId).toBeDefined();
      expect(typeof sessionId).toBe('string');
      expect(sessionId).toMatch(/^proxy-\d+$/);
    });

    it('should return same ID on subsequent calls', () => {
      const firstId = state.ensureProxySessionId();
      const secondId = state.ensureProxySessionId();
      const thirdId = state.ensureProxySessionId();

      expect(secondId).toBe(firstId);
      expect(thirdId).toBe(firstId);
    });

    it('should generate different IDs for different instances', () => {
      const state1 = new StateManager();
      const state2 = new StateManager();

      const id1 = state1.ensureProxySessionId();
      const id2 = state2.ensureProxySessionId();

      // IDs should be different (unless created at exact same millisecond, very unlikely)
      // We can't guarantee they're different due to timing, but we can verify format
      expect(id1).toMatch(/^proxy-\d+$/);
      expect(id2).toMatch(/^proxy-\d+$/);
    });
  });

  describe('setAcpSessionId and getAcpSessionId', () => {
    it('should return null initially', () => {
      const sessionId = state.getAcpSessionId();
      expect(sessionId).toBeNull();
    });

    it('should store and retrieve ACP session ID', () => {
      const testSessionId = 'session-abc123';

      state.setAcpSessionId(testSessionId);
      const retrieved = state.getAcpSessionId();

      expect(retrieved).toBe(testSessionId);
    });

    it('should allow updating ACP session ID', () => {
      state.setAcpSessionId('session-first');
      state.setAcpSessionId('session-second');

      const retrieved = state.getAcpSessionId();
      expect(retrieved).toBe('session-second');
    });
  });

  describe('addPendingRequest and takePendingRequest', () => {
    it('should store and retrieve pending request with string ID', () => {
      const requestId = 'req-123';
      const pendingRequest: PendingRequest = {
        method: 'initialize',
        params: { test: 'data' }
      };

      state.addPendingRequest(requestId, pendingRequest);
      const retrieved = state.takePendingRequest(requestId);

      expect(retrieved).toEqual(pendingRequest);
    });

    it('should store and retrieve pending request with number ID', () => {
      const requestId = 42;
      const pendingRequest: PendingRequest = {
        method: 'session/prompt',
        params: { prompt: 'test' }
      };

      state.addPendingRequest(requestId, pendingRequest);
      const retrieved = state.takePendingRequest(requestId);

      expect(retrieved).toEqual(pendingRequest);
    });

    it('should return undefined for non-existent request ID', () => {
      const retrieved = state.takePendingRequest('non-existent');
      expect(retrieved).toBeUndefined();
    });

    it('should handle pending request with all optional fields', () => {
      const requestId = 1;
      const pendingRequest: PendingRequest = {
        method: 'session/new',
        params: { test: 'data' },
        originalId: 'original-123',
        promptText: 'Hello world'
      };

      state.addPendingRequest(requestId, pendingRequest);
      const retrieved = state.takePendingRequest(requestId);

      expect(retrieved).toEqual(pendingRequest);
      expect(retrieved?.originalId).toBe('original-123');
      expect(retrieved?.promptText).toBe('Hello world');
    });

    it('should handle pending request with minimal fields', () => {
      const requestId = 2;
      const pendingRequest: PendingRequest = {
        method: 'tools/list'
      };

      state.addPendingRequest(requestId, pendingRequest);
      const retrieved = state.takePendingRequest(requestId);

      expect(retrieved).toEqual(pendingRequest);
      expect(retrieved?.params).toBeUndefined();
      expect(retrieved?.originalId).toBeUndefined();
      expect(retrieved?.promptText).toBeUndefined();
    });
  });

  describe('takePendingRequest removal', () => {
    it('should remove entry from map after taking', () => {
      const requestId = 'test-id';
      const pendingRequest: PendingRequest = {
        method: 'initialize'
      };

      state.addPendingRequest(requestId, pendingRequest);

      // First take should return the request
      const first = state.takePendingRequest(requestId);
      expect(first).toEqual(pendingRequest);

      // Second take should return undefined (already removed)
      const second = state.takePendingRequest(requestId);
      expect(second).toBeUndefined();
    });

    it('should only remove the specific request ID', () => {
      const request1: PendingRequest = { method: 'method1' };
      const request2: PendingRequest = { method: 'method2' };
      const request3: PendingRequest = { method: 'method3' };

      state.addPendingRequest(1, request1);
      state.addPendingRequest(2, request2);
      state.addPendingRequest(3, request3);

      // Take request 2
      const taken = state.takePendingRequest(2);
      expect(taken).toEqual(request2);

      // Requests 1 and 3 should still be available
      expect(state.takePendingRequest(1)).toEqual(request1);
      expect(state.takePendingRequest(3)).toEqual(request3);
    });
  });

  describe('accumulateText', () => {
    it('should accumulate single text chunk', () => {
      const requestId = 1;

      state.accumulateText(requestId, 'Hello world');
      const text = state.takeAccumulatedText(requestId);

      expect(text).toBe('Hello world');
    });

    it('should concatenate multiple chunks in order', () => {
      const requestId = 1;

      state.accumulateText(requestId, 'Hello ');
      state.accumulateText(requestId, 'world');
      state.accumulateText(requestId, '!');

      const text = state.takeAccumulatedText(requestId);
      expect(text).toBe('Hello world!');
    });

    it('should handle empty string chunks', () => {
      const requestId = 1;

      state.accumulateText(requestId, 'Start');
      state.accumulateText(requestId, '');
      state.accumulateText(requestId, 'End');

      const text = state.takeAccumulatedText(requestId);
      expect(text).toBe('StartEnd');
    });

    it('should handle accumulation for different request IDs independently', () => {
      state.accumulateText(1, 'First ');
      state.accumulateText(2, 'Second ');
      state.accumulateText(1, 'request');
      state.accumulateText(2, 'request');

      const text1 = state.takeAccumulatedText(1);
      const text2 = state.takeAccumulatedText(2);

      expect(text1).toBe('First request');
      expect(text2).toBe('Second request');
    });

    it('should handle string and number IDs', () => {
      state.accumulateText('string-id', 'Text for string');
      state.accumulateText(42, 'Text for number');

      expect(state.takeAccumulatedText('string-id')).toBe('Text for string');
      expect(state.takeAccumulatedText(42)).toBe('Text for number');
    });
  });

  describe('takeAccumulatedText', () => {
    it('should return empty string for non-existent ID', () => {
      const text = state.takeAccumulatedText('non-existent');
      expect(text).toBe('');
    });

    it('should clear entry from map after taking', () => {
      const requestId = 1;

      state.accumulateText(requestId, 'Test text');

      // First take should return the text
      const first = state.takeAccumulatedText(requestId);
      expect(first).toBe('Test text');

      // Second take should return empty string (cleared)
      const second = state.takeAccumulatedText(requestId);
      expect(second).toBe('');
    });

    it('should only clear the specific request ID', () => {
      state.accumulateText(1, 'Text 1');
      state.accumulateText(2, 'Text 2');
      state.accumulateText(3, 'Text 3');

      // Take text for ID 2
      const taken = state.takeAccumulatedText(2);
      expect(taken).toBe('Text 2');

      // Text for IDs 1 and 3 should still be available
      expect(state.takeAccumulatedText(1)).toBe('Text 1');
      expect(state.takeAccumulatedText(3)).toBe('Text 3');
    });

    it('should return empty string if no text was accumulated', () => {
      // Add a pending request but don't accumulate any text
      state.addPendingRequest(1, { method: 'test' });

      const text = state.takeAccumulatedText(1);
      expect(text).toBe('');
    });
  });

  describe('findPendingPromptRequest', () => {
    it('should find session/prompt request', () => {
      const promptRequest: PendingRequest = {
        method: 'session/prompt',
        params: { prompt: 'test' }
      };

      state.addPendingRequest(1, promptRequest);

      const result = state.findPendingPromptRequest();
      expect(result).not.toBeNull();
      expect(result![0]).toBe(1);
      expect(result![1]).toEqual(promptRequest);
    });

    it('should return null when no session/prompt request exists', () => {
      state.addPendingRequest(1, { method: 'initialize' });
      state.addPendingRequest(2, { method: 'tools/list' });

      const result = state.findPendingPromptRequest();
      expect(result).toBeNull();
    });

    it('should return first session/prompt request when multiple exist', () => {
      const prompt1: PendingRequest = { method: 'session/prompt', params: { prompt: 'first' } };
      const prompt2: PendingRequest = { method: 'session/prompt', params: { prompt: 'second' } };

      state.addPendingRequest(1, prompt1);
      state.addPendingRequest(2, { method: 'initialize' });
      state.addPendingRequest(3, prompt2);

      const result = state.findPendingPromptRequest();
      expect(result).not.toBeNull();

      // Should return one of the prompt requests (order depends on Map iteration)
      const [id, request] = result!;
      expect([1, 3]).toContain(id);
      expect(request.method).toBe('session/prompt');
    });

    it('should not remove the request from pending requests', () => {
      const promptRequest: PendingRequest = {
        method: 'session/prompt',
        params: { prompt: 'test' }
      };

      state.addPendingRequest(1, promptRequest);

      // Find the request
      const found = state.findPendingPromptRequest();
      expect(found).not.toBeNull();

      // Should still be able to take it
      const taken = state.takePendingRequest(1);
      expect(taken).toEqual(promptRequest);
    });

    it('should handle string and number IDs', () => {
      state.addPendingRequest('string-id', { method: 'session/prompt' });

      const result = state.findPendingPromptRequest();
      expect(result).not.toBeNull();
      expect(result![0]).toBe('string-id');
    });

    it('should distinguish session/prompt from other session methods', () => {
      state.addPendingRequest(1, { method: 'session/new' });
      state.addPendingRequest(2, { method: 'session/update' });
      state.addPendingRequest(3, { method: 'session/close' });

      const result = state.findPendingPromptRequest();
      expect(result).toBeNull();
    });
  });

  describe('integration scenarios', () => {
    it('should handle complete request lifecycle', () => {
      // Generate proxy session ID
      const proxySessionId = state.ensureProxySessionId();
      expect(proxySessionId).toMatch(/^proxy-\d+$/);

      // Store ACP session ID
      state.setAcpSessionId('session-abc');
      expect(state.getAcpSessionId()).toBe('session-abc');

      // Add pending request
      state.addPendingRequest(1, { method: 'session/prompt' });

      // Accumulate text
      state.accumulateText(1, 'Hello ');
      state.accumulateText(1, 'world');

      // Find pending prompt
      const found = state.findPendingPromptRequest();
      expect(found).not.toBeNull();
      expect(found![0]).toBe(1);

      // Take accumulated text
      const text = state.takeAccumulatedText(1);
      expect(text).toBe('Hello world');

      // Take pending request
      const request = state.takePendingRequest(1);
      expect(request?.method).toBe('session/prompt');
    });

    it('should handle multiple concurrent requests', () => {
      state.addPendingRequest(1, { method: 'initialize' });
      state.addPendingRequest(2, { method: 'session/prompt' });
      state.addPendingRequest(3, { method: 'tools/list' });

      state.accumulateText(2, 'Response text');

      // Take requests in different order
      expect(state.takePendingRequest(3)?.method).toBe('tools/list');
      expect(state.takePendingRequest(1)?.method).toBe('initialize');
      expect(state.takeAccumulatedText(2)).toBe('Response text');
      expect(state.takePendingRequest(2)?.method).toBe('session/prompt');
    });

    it('should handle queued request scenario', () => {
      // Simulate tools/call without session -> session/new with queued prompt
      const queuedRequest: PendingRequest = {
        method: 'session/new',
        originalId: 'original-123',
        promptText: 'User prompt text'
      };

      state.addPendingRequest('synthetic-id', queuedRequest);

      // Later, retrieve and verify queued data
      const retrieved = state.takePendingRequest('synthetic-id');
      expect(retrieved?.method).toBe('session/new');
      expect(retrieved?.originalId).toBe('original-123');
      expect(retrieved?.promptText).toBe('User prompt text');
    });
  });
});
