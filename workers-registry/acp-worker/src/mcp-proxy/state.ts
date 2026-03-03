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
 * Session state management for the MCP-ACP protocol proxy.
 *
 * This module provides the StateManager class which manages session identifiers,
 * pending request tracking, and text accumulation for streaming responses.
 */

import { PendingRequest, SessionState } from './types.js';

/**
 * Manages session state for the MCP-ACP proxy.
 *
 * Tracks proxy session ID, ACP session ID, pending requests,
 * and accumulated text for streaming responses.
 *
 * @example
 * ```typescript
 * const state = new StateManager();
 * const sessionId = state.ensureProxySessionId();
 * state.addPendingRequest(1, { method: 'initialize', params: {} });
 * const pending = state.takePendingRequest(1);
 * ```
 */
export class StateManager {
  private state: SessionState;

  constructor() {
    this.state = {
      proxySessionId: null,
      acpSessionId: null,
      pendingRequests: new Map(),
      accumulatedText: new Map(),
    };
  }

  /**
   * Generate unique proxy session ID on first request.
   *
   * The proxy session ID is used for stdio Bus routing to ensure all
   * requests from this proxy instance are routed to the same worker.
   *
   * @returns The proxy session ID (generates new one if not exists)
   *
   * @example
   * ```typescript
   * const sessionId = state.ensureProxySessionId();
   * // First call: 'proxy-1234567890'
   * const sameId = state.ensureProxySessionId();
   * // Subsequent calls: 'proxy-1234567890' (same value)
   * ```
   */
  ensureProxySessionId(): string {
    if (!this.state.proxySessionId) {
      this.state.proxySessionId = `proxy-${Date.now()}`;
    }
    return this.state.proxySessionId;
  }

  /**
   * Store ACP session ID from session/new response.
   *
   * The ACP session ID is received from the agent and used for subsequent
   * session-specific requests like session/prompt.
   *
   * @param sessionId - The session ID from the ACP agent
   *
   * @example
   * ```typescript
   * state.setAcpSessionId('session-abc123');
   * ```
   */
  setAcpSessionId(sessionId: string): void {
    this.state.acpSessionId = sessionId;
  }

  /**
   * Get current ACP session ID.
   *
   * @returns The ACP session ID, or null if no session has been created yet
   *
   * @example
   * ```typescript
   * const sessionId = state.getAcpSessionId();
   * if (sessionId) {
   *   // Can send session/prompt requests
   * } else {
   *   // Need to create session first
   * }
   * ```
   */
  getAcpSessionId(): string | null {
    return this.state.acpSessionId;
  }

  /**
   * Track a pending request.
   *
   * Stores request information keyed by request ID for later correlation
   * with responses. Used to track method, parameters, and queued requests.
   *
   * @param id - The request ID (string or number)
   * @param request - The pending request information
   *
   * @example
   * ```typescript
   * state.addPendingRequest(1, {
   *   method: 'session/prompt',
   *   params: { prompt: 'Hello' }
   * });
   * ```
   */
  addPendingRequest(id: string | number, request: PendingRequest): void {
    this.state.pendingRequests.set(id, request);
  }

  /**
   * Retrieve and remove a pending request.
   *
   * Looks up a pending request by ID and removes it from the map.
   * Returns undefined if no request with that ID exists.
   *
   * @param id - The request ID to look up
   * @returns The pending request information, or undefined if not found
   *
   * @example
   * ```typescript
   * const pending = state.takePendingRequest(1);
   * if (pending) {
   *   console.log(`Received response for ${pending.method}`);
   * }
   * ```
   */
  takePendingRequest(id: string | number): PendingRequest | undefined {
    const pending = this.state.pendingRequests.get(id);
    if (pending) {
      this.state.pendingRequests.delete(id);
    }
    return pending;
  }

  /**
   * Accumulate text for streaming responses.
   *
   * Appends text chunks to the accumulated string for a given request ID.
   * Used to collect agent_message_chunk notifications during session/prompt.
   *
   * @param id - The request ID
   * @param text - The text chunk to append
   *
   * @example
   * ```typescript
   * state.accumulateText(1, 'Hello ');
   * state.accumulateText(1, 'world!');
   * const result = state.takeAccumulatedText(1);
   * // result: 'Hello world!'
   * ```
   */
  accumulateText(id: string | number, text: string): void {
    const current = this.state.accumulatedText.get(id) || '';
    this.state.accumulatedText.set(id, current + text);
  }

  /**
   * Retrieve and clear accumulated text.
   *
   * Returns the accumulated text for a request ID and removes it from the map.
   * Returns empty string if no text has been accumulated.
   *
   * @param id - The request ID
   * @returns The accumulated text (empty string if none)
   *
   * @example
   * ```typescript
   * state.accumulateText(1, 'Hello ');
   * state.accumulateText(1, 'world!');
   * const text = state.takeAccumulatedText(1);
   * // text: 'Hello world!'
   * const again = state.takeAccumulatedText(1);
   * // again: '' (cleared after first take)
   * ```
   */
  takeAccumulatedText(id: string | number): string {
    const text = this.state.accumulatedText.get(id) || '';
    this.state.accumulatedText.delete(id);
    return text;
  }

  /**
   * Find pending session/prompt request for notification handling.
   *
   * Searches through pending requests to find a session/prompt request.
   * Used when processing session/update notifications to determine which
   * request the notification belongs to.
   *
   * @returns Tuple of [requestId, pendingRequest] or null if not found
   *
   * @example
   * ```typescript
   * const result = state.findPendingPromptRequest();
   * if (result) {
   *   const [id, pending] = result;
   *   state.accumulateText(id, 'chunk text');
   * }
   * ```
   */
  findPendingPromptRequest(): [string | number, PendingRequest] | null {
    for (const [id, pending] of this.state.pendingRequests.entries()) {
      if (pending.method === 'session/prompt') {
        return [id, pending];
      }
    }
    return null;
  }
}
