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
 * Protocol conversion logic for the MCP-ACP protocol proxy.
 *
 * This module provides the ProtocolConverter class which handles bidirectional
 * conversion between Model Context Protocol (MCP) and Agent Client Protocol (ACP).
 *
 * The converter:
 * - Converts MCP requests to ACP requests
 * - Converts ACP responses back to MCP responses
 * - Handles ACP notifications (e.g., streaming text chunks)
 * - Manages session creation and request queuing
 */

import { ACPNotification, ACPRequest, ACPResponse, MCPRequest, MCPResponse, ProxyConfig } from './types.js';
import { StateManager } from './state.js';

/**
 * Protocol converter for MCP ↔ ACP translation.
 *
 * Handles all protocol conversion logic, including:
 * - MCP method routing (initialize, tools/list, tools/call, etc.)
 * - ACP response conversion based on pending request method
 * - Session creation and queuing for tools/call without session
 * - Text accumulation for streaming responses
 *
 * @example
 * ```typescript
 * const config = { acpHost: '127.0.0.1', acpPort: 9011, agentId: 'my-agent' };
 * const state = new StateManager();
 * const converter = new ProtocolConverter(config, state);
 *
 * const mcpReq = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
 * const acpReq = converter.convertMCPtoACP(mcpReq);
 * ```
 */
export class ProtocolConverter {
  constructor(
    private config: ProxyConfig,
    private state: StateManager,
    private sendACPCallback?: (request: ACPRequest) => void,
  ) {
  }

  /**
   * Convert MCP request to ACP request.
   *
   * Routes MCP methods to appropriate conversion handlers. Some methods
   * (like tools/list) return null because they're handled directly without
   * forwarding to ACP.
   *
   * @param mcpReq - The MCP request to convert
   * @returns ACP request to send, or null if response should be sent directly to MCP client
   *
   * @example
   * ```typescript
   * const mcpReq = { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} };
   * const acpReq = converter.convertMCPtoACP(mcpReq);
   * // Returns ACP initialize request
   * ```
   */
  convertMCPtoACP(mcpReq: MCPRequest): ACPRequest | null {
    const { id, method, params } = mcpReq;

    // Ensure proxy session ID exists
    const proxySessionId = this.state.ensureProxySessionId();

    // Track pending request
    this.state.addPendingRequest(id, { method, params });

    switch (method) {
      case 'initialize':
        return this.convertInitialize(id, proxySessionId, params);

      case 'tools/list':
        return this.handleToolsList(id);

      case 'tools/call':
        return this.convertToolsCall(id, proxySessionId, params);

      case 'resources/list':
        return this.handleResourcesList(id);

      case 'resources/templates/list':
        return this.handleResourceTemplatesList(id);

      case 'prompts/list':
        return this.handlePromptsList(id);

      default:
        return this.handleUnknownMethod(id, method);
    }
  }

  /**
   * Convert ACP response to MCP response.
   *
   * Looks up the pending request to determine how to convert the response.
   * Different ACP methods require different conversion logic.
   *
   * @param acpResp - The ACP response to convert
   * @returns MCP response to send, or null if no response should be sent
   *
   * @example
   * ```typescript
   * const acpResp = { jsonrpc: '2.0', id: 1, result: { agentInfo: {...} } };
   * const mcpResp = converter.convertACPtoMCP(acpResp);
   * // Returns MCP initialize response
   * ```
   */
  convertACPtoMCP(acpResp: ACPResponse): MCPResponse | null {
    const { id, result, error } = acpResp;

    const pending = this.state.takePendingRequest(id);
    if (!pending) {
      console.error(`[mcp-proxy] No pending request for id=${id}`);
      return null;
    }

    if (error) {
      this.state.takeAccumulatedText(id); // Clear accumulated text
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: error.code || -32603,
          message: error.message || 'ACP error',
        },
      };
    }

    switch (pending.method) {
      case 'initialize':
        return this.convertInitializeResponse(id, result);

      case 'session/new':
        return this.handleSessionNewResponse(id, result, pending);

      case 'session/prompt':
        return this.convertSessionPromptResponse(id, result);

      default:
        console.error(`[mcp-proxy] Unhandled method ${pending.method}`);
        return { jsonrpc: '2.0', id, result: result || {} };
    }
  }

  /**
   * Handle ACP notifications (messages without id field).
   *
   * Processes notifications like session/update which contain streaming
   * text chunks from the agent.
   *
   * @param notification - The ACP notification to handle
   *
   * @example
   * ```typescript
   * const notification = {
   *   jsonrpc: '2.0',
   *   method: 'session/update',
   *   params: { update: { sessionUpdate: 'agent_message_chunk', content: { text: 'Hello' } } }
   * };
   * converter.handleACPNotification(notification);
   * ```
   */
  handleACPNotification(notification: ACPNotification): void {
    const { method, params } = notification;

    if (method === 'session/update' && params && typeof params === 'object' && 'update' in params) {
      this.handleSessionUpdate((params as any).update);
    }
  }

  // Private helper methods for specific conversions

  /**
   * Convert MCP initialize request to ACP initialize request.
   */
  private convertInitialize(id: string | number, proxySessionId: string, params: unknown): ACPRequest {
    const mcpParams = params as any || {};
    return {
      jsonrpc: '2.0',
      id,
      method: 'initialize',
      agentId: this.config.agentId,
      sessionId: proxySessionId,
      params: {
        protocolVersion: 1,
        clientCapabilities: mcpParams.capabilities || {},
        clientInfo: mcpParams.clientInfo || { name: 'mcp-proxy', version: '1.0.0' },
      },
    };
  }

  /**
   * Handle MCP tools/list request.
   * Returns static tool list directly to MCP client without forwarding to ACP.
   */
  private handleToolsList(id: string | number): null {
    const response: MCPResponse = {
      jsonrpc: '2.0',
      id,
      result: {
        tools: [{
          name: 'acp_prompt',
          description: `Send prompt to ${this.config.agentId}`,
          inputSchema: {
            type: 'object',
            properties: {
              prompt: { type: 'string', description: 'Prompt text' },
            },
            required: ['prompt'],
          },
        }],
      },
    };
    this.sendMCPDirect(response);
    this.state.takePendingRequest(id); // Remove from pending
    return null;
  }

  /**
   * Convert MCP tools/call request to ACP session/prompt request.
   * If no ACP session exists, creates session/new request first and queues the prompt.
   */
  private convertToolsCall(id: string | number, proxySessionId: string, params: unknown): ACPRequest {
    const mcpParams = params as any || {};
    const promptText = mcpParams.arguments?.prompt || '';

    const acpSessionId = this.state.getAcpSessionId();

    if (!acpSessionId) {
      // No ACP session exists yet - need to create one first
      // Generate synthetic request ID for session/new (prefixed with 'sess-')
      const sessionReqId = `sess-${id}`;

      // Store pending request with original ID and prompt text
      // When session/new response arrives, we'll send the queued prompt
      this.state.addPendingRequest(sessionReqId, {
        method: 'session/new',
        originalId: id,        // Original MCP request ID
        promptText,             // Prompt to send after session creation
      });

      return {
        jsonrpc: '2.0',
        id: sessionReqId,
        method: 'session/new',
        agentId: this.config.agentId,
        sessionId: proxySessionId,
        params: { cwd: process.cwd(), mcpServers: [] },
      };
    }

    // Session exists - can send prompt directly
    // Replace pending request method from 'tools/call' to 'session/prompt'
    // This ensures correct response handling when ACP responds
    this.state.takePendingRequest(id);
    this.state.addPendingRequest(id, { method: 'session/prompt', params });

    return {
      jsonrpc: '2.0',
      id,
      method: 'session/prompt',
      agentId: this.config.agentId,
      sessionId: proxySessionId,
      params: {
        sessionId: acpSessionId,  // Use stored ACP session ID
        prompt: [{ type: 'text', text: promptText }],
      },
    };
  }

  /**
   * Handle MCP resources/list request.
   * Returns empty resources array directly to MCP client.
   */
  private handleResourcesList(id: string | number): null {
    const response: MCPResponse = {
      jsonrpc: '2.0',
      id,
      result: { resources: [] },
    };
    this.sendMCPDirect(response);
    this.state.takePendingRequest(id);
    return null;
  }

  /**
   * Handle MCP resources/templates/list request.
   * Returns empty resource templates array directly to MCP client.
   */
  private handleResourceTemplatesList(id: string | number): null {
    const response: MCPResponse = {
      jsonrpc: '2.0',
      id,
      result: { resourceTemplates: [] },
    };
    this.sendMCPDirect(response);
    this.state.takePendingRequest(id);
    return null;
  }

  /**
   * Handle MCP prompts/list request.
   * Returns empty prompts array directly to MCP client.
   */
  private handlePromptsList(id: string | number): null {
    const response: MCPResponse = {
      jsonrpc: '2.0',
      id,
      result: { prompts: [] },
    };
    this.sendMCPDirect(response);
    this.state.takePendingRequest(id);
    return null;
  }

  /**
   * Handle unknown MCP method.
   * Returns JSON-RPC error -32601 (method not found).
   */
  private handleUnknownMethod(id: string | number, method: string): null {
    const response: MCPResponse = {
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Unknown method: ${method}` },
    };
    this.sendMCPDirect(response);
    this.state.takePendingRequest(id);
    return null;
  }

  /**
   * Convert ACP initialize response to MCP initialize response.
   */
  private convertInitializeResponse(id: string | number, result: unknown): MCPResponse {
    const acpResult = result as any || {};
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {}, resources: {} },
        serverInfo: acpResult.agentInfo || { name: 'acp-agent', version: '1.0.0' },
      },
    };
  }

  /**
   * Handle ACP session/new response.
   * Stores the ACP session ID and sends queued prompt if exists.
   */
  private handleSessionNewResponse(_id: string | number, result: unknown, pending: any): null {
    const acpResult = result as any || {};
    const acpSessionId = acpResult.sessionId;

    // Store the ACP session ID for future session/prompt requests
    if (acpSessionId) {
      this.state.setAcpSessionId(acpSessionId);
      console.error(`[mcp-proxy] ACP session: ${acpSessionId}`);
    }

    // Check if there's a queued prompt waiting for session creation
    // This happens when tools/call was received before any session existed
    if (pending.originalId && pending.promptText) {
      const proxySessionId = this.state.ensureProxySessionId();

      // Build session/prompt request with the original MCP request ID
      // This ensures the MCP client receives the response with the correct ID
      const promptReq: ACPRequest = {
        jsonrpc: '2.0',
        id: pending.originalId,  // Use original MCP request ID, not session/new ID
        method: 'session/prompt',
        agentId: this.config.agentId,
        sessionId: proxySessionId,
        params: {
          sessionId: acpSessionId,  // Use newly created ACP session ID
          prompt: [{ type: 'text', text: pending.promptText }],
        },
      };

      // Track the queued prompt request
      this.state.addPendingRequest(pending.originalId, { method: 'session/prompt' });

      console.error(`[mcp-proxy] → ACP: ${JSON.stringify(promptReq)}`);
      this.sendACPDirect(promptReq);
    }

    // Don't send MCP response for session/new - it's internal to the proxy
    return null;
  }

  /**
   * Convert ACP session/prompt response to MCP tool call result.
   * Returns accumulated text from streaming notifications.
   */
  private convertSessionPromptResponse(id: string | number, result: unknown): MCPResponse {
    const accumulated = this.state.takeAccumulatedText(id) || '';
    const fallbackText = accumulated ? null : this.extractTextFromResult(result);
    const finalText = accumulated || fallbackText || 'No response';
    const source = accumulated ? 'accumulated' : (fallbackText ? 'fallback' : 'empty');
    console.error(
      `[mcp-proxy] Returning ${source} text (${finalText.length} chars): "${finalText.substring(0, 50)}..."`,
    );
    return {
      jsonrpc: '2.0',
      id,
      result: {
        content: [{ type: 'text', text: finalText }],
      },
    };
  }

  private extractTextFromResult(result: unknown): string | null {
    if (!result || typeof result !== 'object') {
      return null;
    }

    const directText = this.readText((result as any).text);
    if (directText) {
      return directText;
    }

    const contentText = this.extractTextFromContentBlocks((result as any).content);
    if (contentText) {
      return contentText;
    }

    const message = (result as any).message;
    if (message && typeof message === 'object') {
      const messageText = this.readText((message as any).text);
      if (messageText) {
        return messageText;
      }

      const messageContent = this.extractTextFromContentBlocks((message as any).content);
      if (messageContent) {
        return messageContent;
      }
    }

    const meta = (result as any)._meta;
    if (meta && typeof meta === 'object') {
      const metaText = this.readText((meta as any).text) || this.readText((meta as any).output_text);
      if (metaText) {
        return metaText;
      }
    }

    return null;
  }

  private extractTextFromContentBlocks(content: unknown): string | null {
    if (!Array.isArray(content)) {
      return null;
    }

    const textParts = content
      .filter((block) => block && typeof block === 'object' && (block as any).type === 'text')
      .map((block) => (block as any).text)
      .filter((text) => typeof text === 'string' && text.length > 0);

    if (textParts.length === 0) {
      return null;
    }

    return textParts.join('');
  }

  private readText(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  /**
   * Handle session/update notification.
   * Accumulates text chunks for agent_message_chunk updates.
   */
  private handleSessionUpdate(update: any): void {
    // Find the pending session/prompt request that this notification belongs to
    // There should only be one active session/prompt at a time
    const result = this.state.findPendingPromptRequest();
    if (result) {
      const [reqId] = result;

      // Accumulate text chunks from agent_message_chunk notifications
      // These chunks will be concatenated and returned when session/prompt completes
      if (update.sessionUpdate === 'agent_message_chunk' && update.content?.text) {
        this.state.accumulateText(reqId, update.content.text);
      }
    }
  }

  /**
   * Send MCP response directly to stdout.
   * Used for methods that don't require ACP forwarding.
   */
  private sendMCPDirect(response: MCPResponse): void {
    console.error(`[mcp-proxy] → MCP: ${JSON.stringify(response)}`);
    process.stdout.write(JSON.stringify(response) + '\n');
  }

  /**
   * Send ACP request directly to TCP socket.
   * Used for queued requests (session/new -> session/prompt).
   */
  private sendACPDirect(request: ACPRequest): void {
    if (this.sendACPCallback) {
      this.sendACPCallback(request);
    }
  }
}
