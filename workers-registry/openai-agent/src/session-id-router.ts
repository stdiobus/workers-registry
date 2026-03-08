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
 * Session ID routing helper for stdio Bus ↔ ACP messages.
 *
 * Tracks request IDs to restore stdio Bus sessionId on responses,
 * and maps ACP sessionId to stdio Bus sessionId for notifications.
 */

type JsonRecord = Record<string, unknown>;

export class SessionIdRouter {
  private readonly requestSessionIdMap = new Map<string | number, string>();
  private readonly acpSessionIdMap = new Map<string, string>();

  /**
   * Process a single inbound (stdin) line.
   *
   * - Saves stdio Bus sessionId for request/response correlation
   * - Tracks ACP sessionId ↔ stdio Bus sessionId mapping when available
   * - Strips stdio Bus sessionId before passing to ACP SDK
   */
  processIncomingLine(line: string): string {
    if (!line.trim()) {
      return line;
    }

    try {
      const msg = JSON.parse(line) as JsonRecord;
      const routingSessionId = this.readSessionId(msg.sessionId);
      const hasId = msg.id !== undefined && msg.id !== null;

      if (hasId && routingSessionId) {
        this.requestSessionIdMap.set(msg.id as string | number, routingSessionId);
        console.error(`[worker] Saved sessionId="${routingSessionId}" for request id=${msg.id}`);
      }

      const paramsSessionId = this.readSessionId((msg.params as JsonRecord | undefined)?.sessionId);
      if (routingSessionId && paramsSessionId) {
        this.setAcpSessionMapping(paramsSessionId, routingSessionId, 'request');
      }

      if (hasId && routingSessionId) {
        const { sessionId: _sessionId, ...msgWithoutSession } = msg;
        return JSON.stringify(msgWithoutSession);
      }

      return line;
    } catch {
      return line;
    }
  }

  /**
   * Process a single outbound (stdout) line.
   *
   * - Restores stdio Bus sessionId on responses using request mapping
   * - Maps ACP sessionId to stdio Bus sessionId for notifications
   */
  processOutgoingLine(line: string): string {
    if (!line.trim()) {
      return line;
    }

    try {
      const msg = JSON.parse(line) as JsonRecord;
      const hasId = msg.id !== undefined && msg.id !== null;

      if (hasId && this.requestSessionIdMap.has(msg.id as string | number)) {
        const routingSessionId = this.requestSessionIdMap.get(msg.id as string | number);
        this.requestSessionIdMap.delete(msg.id as string | number);

        if (routingSessionId) {
          const resultSessionId = this.readSessionId(
            (msg.result as JsonRecord | undefined)?.sessionId,
          );
          if (resultSessionId) {
            this.setAcpSessionMapping(resultSessionId, routingSessionId, 'response');
          }

          const msgWithSession = { ...msg, sessionId: routingSessionId };
          console.error(
            `[worker] Restored sessionId="${routingSessionId}" for response id=${msg.id}`,
          );
          return JSON.stringify(msgWithSession);
        }
      }

      if (!hasId && !this.readSessionId(msg.sessionId)) {
        const paramsSessionId = this.readSessionId(
          (msg.params as JsonRecord | undefined)?.sessionId,
        );
        if (paramsSessionId) {
          const routingSessionId = this.acpSessionIdMap.get(paramsSessionId);
          if (routingSessionId) {
            const msgWithSession = { ...msg, sessionId: routingSessionId };
            return JSON.stringify(msgWithSession);
          }
        }
      }

      return line;
    } catch {
      return line;
    }
  }

  private readSessionId(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  private setAcpSessionMapping(
    acpSessionId: string,
    routingSessionId: string,
    source: 'request' | 'response',
  ): void {
    const existing = this.acpSessionIdMap.get(acpSessionId);
    if (existing === routingSessionId) {
      return;
    }

    this.acpSessionIdMap.set(acpSessionId, routingSessionId);
    console.error(
      `[worker] Mapped ACP sessionId="${acpSessionId}" ` +
      `to routing sessionId="${routingSessionId}" (${source})`,
    );
  }
}
