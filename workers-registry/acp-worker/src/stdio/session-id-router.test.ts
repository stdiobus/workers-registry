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

import { SessionIdRouter } from './session-id-router';

describe('SessionIdRouter', () => {
  it('restores routing sessionId and maps session/new responses for notifications', () => {
    const router = new SessionIdRouter();

    const incoming = router.processIncomingLine(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'session/new',
      sessionId: 'client-1',
      params: { cwd: '/' },
    }));

    expect(JSON.parse(incoming)).not.toHaveProperty('sessionId');

    const response = router.processOutgoingLine(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      result: { sessionId: 'acp-1' },
    }));

    expect(JSON.parse(response).sessionId).toBe('client-1');

    const notification = router.processOutgoingLine(JSON.stringify({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 'acp-1',
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hi' } },
      },
    }));

    expect(JSON.parse(notification).sessionId).toBe('client-1');
  });

  it('maps ACP sessionId from session/prompt request params for notifications', () => {
    const router = new SessionIdRouter();

    const incoming = router.processIncomingLine(JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'session/prompt',
      sessionId: 'client-2',
      params: {
        sessionId: 'acp-2',
        prompt: [{ type: 'text', text: 'hello' }],
      },
    }));

    expect(JSON.parse(incoming)).not.toHaveProperty('sessionId');

    const notification = router.processOutgoingLine(JSON.stringify({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 'acp-2',
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hello' } },
      },
    }));

    expect(JSON.parse(notification).sessionId).toBe('client-2');
  });

  it('passes through invalid JSON without modification', () => {
    const router = new SessionIdRouter();
    const line = '{not-json';

    expect(router.processIncomingLine(line)).toBe(line);
    expect(router.processOutgoingLine(line)).toBe(line);
  });
});



