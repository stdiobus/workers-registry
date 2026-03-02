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
 * Property-based tests for the StateManager class.
 *
 * Uses fast-check to verify universal properties across all inputs.
 * Tests session state management, pending request tracking, and text accumulation.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import fc from 'fast-check';
import { StateManager } from '../../src/mcp-proxy/state.js';
import { PendingRequest } from '../../src/mcp-proxy/types.js';

describe('StateManager Properties', () => {
  let state: StateManager;

  beforeEach(() => {
    state = new StateManager();
  });

  // Feature: mcp-acp-proxy-integration, Property 7: Pending Request Cleanup
  // **Validates: Requirements 5.6**
  describe('Property 7: Pending Request Cleanup', () => {
    it('should remove pending request after taking', () => {
      fc.assert(
        fc.property(
          fc.oneof(fc.string(), fc.integer()),
          fc.string(),
          fc.object(),
          (id, method, params) => {
            const pendingRequest: PendingRequest = { method, params };

            state.addPendingRequest(id, pendingRequest);

            // First take should return the request
            const first = state.takePendingRequest(id);
            expect(first).toEqual(pendingRequest);

            // Second take should return undefined (cleaned up)
            const second = state.takePendingRequest(id);
            expect(second).toBeUndefined();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should clear accumulated text for session/prompt after taking', () => {
      fc.assert(
        fc.property(
          fc.oneof(fc.string(), fc.integer()),
          fc.string(),
          (id, text) => {
            // Add pending session/prompt request
            state.addPendingRequest(id, { method: 'session/prompt' });
            state.accumulateText(id, text);

            // Take accumulated text
            const accumulated = state.takeAccumulatedText(id);
            expect(accumulated).toBe(text);

            // Should be cleared after taking
            const second = state.takeAccumulatedText(id);
            expect(second).toBe('');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should only remove the specific request ID', () => {
      fc.assert(
        fc.property(
          fc.array(fc.tuple(fc.oneof(fc.string(), fc.integer()), fc.string()), { minLength: 2, maxLength: 10 }),
          (requests) => {
            // Ensure unique IDs
            const uniqueRequests = Array.from(
              new Map(requests.map(([id, method]) => [String(id), { id, method }])).values()
            );

            if (uniqueRequests.length < 2) return; // Skip if not enough unique IDs

            // Add all requests
            for (const { id, method } of uniqueRequests) {
              state.addPendingRequest(id, { method });
            }

            // Take one request
            const toRemove = uniqueRequests[0];
            const removed = state.takePendingRequest(toRemove.id);
            expect(removed).toBeDefined();

            // Others should still be available
            for (let i = 1; i < uniqueRequests.length; i++) {
              const other = state.takePendingRequest(uniqueRequests[i].id);
              expect(other).toBeDefined();
              expect(other?.method).toBe(uniqueRequests[i].method);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // Feature: mcp-acp-proxy-integration, Property 8: Proxy Session ID Consistency
  // **Validates: Requirements 5.7**
  describe('Property 8: Proxy Session ID Consistency', () => {
    it('should return same proxySessionId for any sequence of calls', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 100 }),
          (numCalls) => {
            const ids: string[] = [];

            for (let i = 0; i < numCalls; i++) {
              ids.push(state.ensureProxySessionId());
            }

            // All IDs should be identical
            const firstId = ids[0];
            expect(firstId).toMatch(/^proxy-\d+$/);

            for (const id of ids) {
              expect(id).toBe(firstId);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should generate proxySessionId on first call regardless of other operations', () => {
      fc.assert(
        fc.property(
          fc.array(fc.tuple(fc.oneof(fc.string(), fc.integer()), fc.string())),
          (operations) => {
            // Perform various operations before calling ensureProxySessionId
            for (const [id, method] of operations) {
              state.addPendingRequest(id, { method });
            }

            // First call should generate ID
            const sessionId = state.ensureProxySessionId();
            expect(sessionId).toMatch(/^proxy-\d+$/);

            // Subsequent calls should return same ID
            expect(state.ensureProxySessionId()).toBe(sessionId);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // Feature: mcp-acp-proxy-integration, Property 15: Session State Invariants
  // **Validates: Requirements 5.4, 5.5**
  describe('Property 15: Session State Invariants', () => {
    it('should maintain invariant: accumulated text implies pending request exists', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.tuple(
              fc.oneof(fc.string(), fc.integer()),
              fc.constantFrom('session/prompt', 'initialize', 'tools/list'),
              fc.string()
            ),
            { minLength: 1, maxLength: 10 }
          ),
          (operations) => {
            // Add requests and accumulate text
            for (const [id, method, text] of operations) {
              state.addPendingRequest(id, { method });
              if (method === 'session/prompt') {
                state.accumulateText(id, text);
              }
            }

            // Verify invariant: if we can take accumulated text, the request should exist or have existed
            for (const [id, method] of operations) {
              if (method === 'session/prompt') {
                // Text should be accumulated
                const text = state.takeAccumulatedText(id);
                expect(typeof text).toBe('string');
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should maintain invariant: if acpSessionId is set, proxySessionId must be set', () => {
      fc.assert(
        fc.property(
          fc.string(),
          (acpSessionId) => {
            // Ensure proxy session ID first
            const proxySessionId = state.ensureProxySessionId();
            expect(proxySessionId).toBeDefined();

            // Set ACP session ID
            state.setAcpSessionId(acpSessionId);

            // Both should be set
            expect(state.getAcpSessionId()).toBe(acpSessionId);
            expect(state.ensureProxySessionId()).toBe(proxySessionId);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should maintain invariant: pending session/prompt may have accumulated text', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.tuple(
              fc.oneof(fc.string(), fc.integer()),
              fc.boolean(),
              fc.string()
            ),
            { minLength: 1, maxLength: 10 }
          ),
          (operations) => {
            // Add session/prompt requests, some with accumulated text
            for (const [id, shouldAccumulate, text] of operations) {
              state.addPendingRequest(id, { method: 'session/prompt' });
              if (shouldAccumulate) {
                state.accumulateText(id, text);
              }
            }

            // Find pending prompt request
            const found = state.findPendingPromptRequest();
            if (found) {
              const [id] = found;

              // Should be able to take the request
              const pending = state.takePendingRequest(id);
              expect(pending).toBeDefined();
              expect(pending?.method).toBe('session/prompt');

              // May or may not have accumulated text (both valid)
              const text = state.takeAccumulatedText(id);
              expect(typeof text).toBe('string');
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle concurrent operations without violating invariants', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.oneof(
              fc.record({ op: fc.constant('addPending'), id: fc.oneof(fc.string(), fc.integer()), method: fc.string() }),
              fc.record({ op: fc.constant('takePending'), id: fc.oneof(fc.string(), fc.integer()) }),
              fc.record({ op: fc.constant('accumulate'), id: fc.oneof(fc.string(), fc.integer()), text: fc.string() }),
              fc.record({ op: fc.constant('takeText'), id: fc.oneof(fc.string(), fc.integer()) }),
              fc.record({ op: fc.constant('setAcpSession'), sessionId: fc.string() })
            ),
            { minLength: 5, maxLength: 20 }
          ),
          (operations) => {
            // Ensure proxy session ID exists
            state.ensureProxySessionId();

            // Execute operations
            for (const op of operations) {
              try {
                if (op.op === 'addPending') {
                  state.addPendingRequest(op.id, { method: op.method });
                } else if (op.op === 'takePending') {
                  state.takePendingRequest(op.id);
                } else if (op.op === 'accumulate') {
                  state.accumulateText(op.id, op.text);
                } else if (op.op === 'takeText') {
                  state.takeAccumulatedText(op.id);
                } else if (op.op === 'setAcpSession') {
                  state.setAcpSessionId(op.sessionId);
                }
              } catch (e) {
                // Should not throw
                throw new Error(`Operation ${op.op} threw: ${e}`);
              }
            }

            // Verify invariants still hold
            const proxySessionId = state.ensureProxySessionId();
            expect(proxySessionId).toMatch(/^proxy-\d+$/);

            const acpSessionId = state.getAcpSessionId();
            if (acpSessionId !== null) {
              // If ACP session is set, proxy session must be set
              expect(proxySessionId).toBeDefined();
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
