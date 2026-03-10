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

import type {
  Agent,
  AgentSideConnection,
  AuthenticateRequest,
  AuthenticateResponse,
  CancelNotification,
  ContentBlock,
  InitializeRequest,
  InitializeResponse,
  LoadSessionRequest,
  LoadSessionResponse,
  NewSessionRequest,
  NewSessionResponse,
  PromptRequest,
  PromptResponse,
} from '@agentclientprotocol/sdk';
import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import { loadConfig } from './config.js';
import { SessionManager } from './session-manager.js';
import { ChatCompletionsClient } from './client.js';
import type { OpenAIMessage } from './types.js';

/**
 * Convert ACP content blocks to a single user message string.
 */
export function convertContentBlocks(blocks: ContentBlock[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.type === 'text') {
      parts.push(block.text);
    } else if (block.type === 'resource_link') {
      parts.push(`[Resource: ${block.name}] ${block.uri}`);
    } else if (block.type === 'resource') {
      const text = 'text' in block.resource ? block.resource.text : '';
      parts.push(`[Resource: ${block.resource.uri}]\n${text}`);
    } else if (block.type === 'image') {
      parts.push(`[Image: ${block.mimeType}]`);
    }
  }
  return parts.join('\n');
}

/**
 * Build the full messages array for the Chat Completions API.
 */
export function buildMessages(
  systemPrompt: string | undefined,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  userMessage: string,
): OpenAIMessage[] {
  const messages: OpenAIMessage[] = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  for (const entry of history) {
    messages.push({ role: entry.role, content: entry.content });
  }
  messages.push({ role: 'user', content: userMessage });
  return messages;
}

export class OpenAIAgent implements Agent {
  private readonly connection: AgentSideConnection;
  private readonly sessionManager: SessionManager;
  private readonly client: ChatCompletionsClient;
  private readonly config;

  constructor(connection: AgentSideConnection) {
    this.connection = connection;
    this.sessionManager = new SessionManager();
    this.config = loadConfig();
    this.client = new ChatCompletionsClient(this.config);
  }

  async initialize(_params: InitializeRequest): Promise<InitializeResponse> {
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentInfo: {
        name: 'openai-agent',
        version: '1.0.0',
      },
      agentCapabilities: {
        promptCapabilities: {
          embeddedContext: true,
        },
      },
      authMethods: [],
    };
  }

  async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
    const session = this.sessionManager.createSession(params.cwd);
    return { sessionId: session.id };
  }

  async loadSession(_params: LoadSessionRequest): Promise<LoadSessionResponse> {
    throw new Error('Session loading is not supported');
  }

  async authenticate(_params: AuthenticateRequest): Promise<AuthenticateResponse | void> {
    // No authentication needed at ACP level
  }

  async prompt(params: PromptRequest): Promise<PromptResponse> {
    const session = this.sessionManager.getSession(params.sessionId);
    if (!session) {
      throw new Error(`Session not found: ${params.sessionId}`);
    }

    if (session.isCancelled()) {
      return { stopReason: 'cancelled' };
    }

    session.resetCancellation();

    const userMessage = convertContentBlocks(params.prompt);
    session.addHistoryEntry('user', userMessage);

    const messages = buildMessages(
      this.config.systemPrompt,
      session.getHistory().slice(0, -1),
      userMessage,
    );

    try {
      const result = await this.client.streamCompletion(
        messages,
        session.getAbortSignal(),
        async (text) => {
          await this.connection.sessionUpdate({
            sessionId: params.sessionId,
            update: {
              sessionUpdate: 'agent_message_chunk',
              content: { type: 'text', text },
            },
          });
        },
      );

      if (result.stopReason === 'cancelled') {
        return { stopReason: 'cancelled' };
      }

      if (result.fullResponse) {
        session.addHistoryEntry('assistant', result.fullResponse);
      }

      return { stopReason: 'end_turn' };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.connection.sessionUpdate({
        sessionId: params.sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: errorMessage },
        },
      });
      return { stopReason: 'end_turn' };
    }
  }

  async cancel(params: CancelNotification): Promise<void> {
    this.sessionManager.cancelSession(params.sessionId);
  }
}
