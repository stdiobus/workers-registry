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
 * Unit tests for the ProtocolConverter class.
 *
 * Tests protocol conversion between MCP and ACP, including:
 * - MCP request to ACP request conversion
 * - ACP response to MCP response conversion
 * - Session management and request queuing
 * - Error handling and unknown methods
 * - Notification handling for streaming text
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { ProtocolConverter } from '../../src/mcp-proxy/converter.js';
import { StateManager } from '../../src/mcp-proxy/state.js';
import { ProxyConfig, MCPRequest, ACPResponse, ACPNotification, ACPRequest } from '../../src/mcp-proxy/types.js';

describe('ProtocolConverter', () => {
  let config: ProxyConfig;
  let state: StateManager;
  let converter: ProtocolConverter;
  let sendACPCallback: jest.Mock<(request: ACPRequest) => void>;

  beforeEach(() => {
    config = {
      acpHost: '127.0.0.1',
      acpPort: 9011,
      agentId: 'test-agent'
    };
    state = new StateManager();
    sendACPCallback = jest.fn();
    converter = new ProtocolConverter(config, state, sendACPCallback);
  });

  describe('MCP initialize → ACP initialize conversion', () => {
    it('should convert MCP initialize to ACP initialize', () => {
      const mcpReq: MCPRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          capabilities: { tools: {} },
          clientInfo: { name: 'test-client', version: '1.0.0' }
        }
      };

      const acpReq = converter.convertMCPtoACP(mcpReq);

      expect(acpReq).not.toBeNull();
      expect(acpReq!.jsonrpc).toBe('2.0');
      expect(acpReq!.id).toBe(1);
      expect(acpReq!.method).toBe('initialize');
      expect(acpReq!.agentId).toBe('test-agent');
      expect(acpReq!.sessionId).toMatch(/^proxy-\d+$/);
      expect((acpReq!.params as any).protocolVersion).toBe(1);
      expect((acpReq!.params as any).clientCapabilities).toEqual({ tools: {} });
      expect((acpReq!.params as any).clientInfo).toEqual({ name: 'test-client', version: '1.0.0' });
    });

    it('should use default clientInfo if not provided', () => {
      const mcpReq: MCPRequest = {
        jsonrpc: '2.0',
        id: 2,
        method: 'initialize',
        params: {}
      };

      const acpReq = converter.convertMCPtoACP(mcpReq);

      expect(acpReq).not.toBeNull();
      expect((acpReq!.params as any).clientInfo).toEqual({ name: 'mcp-proxy', version: '1.0.0' });
    });

    it('should preserve request ID', () => {
      const mcpReq: MCPRequest = {
        jsonrpc: '2.0',
        id: 'string-id-123',
        method: 'initialize',
        params: {}
      };

      const acpReq = converter.convertMCPtoACP(mcpReq);

      expect(acpReq!.id).toBe('string-id-123');
    });
  });

  describe('MCP tools/list returns acp_prompt tool', () => {
    it('should return static tool list with acp_prompt', () => {
      // Mock stdout.write and stderr to capture output
      const originalWrite = process.stdout.write;
      const originalError = console.error;
      let capturedOutput = '';
      process.stdout.write = ((chunk: any) => {
        capturedOutput += chunk.toString();
        return true;
      }) as any;
      console.error = (() => { }) as any;

      const mcpReq: MCPRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list'
      };

      const acpReq = converter.convertMCPtoACP(mcpReq);

      // Restore stdout and stderr
      process.stdout.write = originalWrite;
      console.error = originalError;

      // Should return null (response sent directly)
      expect(acpReq).toBeNull();

      // Parse captured output
      const response = JSON.parse(capturedOutput.trim());
      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe(1);
      expect(response.result.tools).toHaveLength(1);
      expect(response.result.tools[0].name).toBe('acp_prompt');
      expect(response.result.tools[0].description).toBe('Send prompt to test-agent');
      expect(response.result.tools[0].inputSchema.properties.prompt).toBeDefined();
    });

    it('should remove pending request after sending response', () => {
      const originalWrite = process.stdout.write;
      const originalError = console.error;
      process.stdout.write = (() => true) as any;
      console.error = (() => { }) as any;

      const mcpReq: MCPRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list'
      };

      converter.convertMCPtoACP(mcpReq);

      process.stdout.write = originalWrite;
      console.error = originalError;

      // Pending request should be removed
      const pending = state.takePendingRequest(1);
      expect(pending).toBeUndefined();
    });
  });

  describe('MCP tools/call → ACP session/prompt conversion (with session)', () => {
    it('should convert tools/call to session/prompt when session exists', () => {
      // Set up existing session
      state.ensureProxySessionId();
      state.setAcpSessionId('session-abc123');

      const mcpReq: MCPRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'acp_prompt',
          arguments: { prompt: 'Hello world' }
        }
      };

      const acpReq = converter.convertMCPtoACP(mcpReq);

      expect(acpReq).not.toBeNull();
      expect(acpReq!.method).toBe('session/prompt');
      expect(acpReq!.id).toBe(1);
      expect(acpReq!.agentId).toBe('test-agent');
      expect((acpReq!.params as any).sessionId).toBe('session-abc123');
      expect((acpReq!.params as any).prompt).toEqual([{ type: 'text', text: 'Hello world' }]);
    });

    it('should handle empty prompt text', () => {
      state.ensureProxySessionId();
      state.setAcpSessionId('session-abc123');

      const mcpReq: MCPRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'acp_prompt',
          arguments: { prompt: '' }
        }
      };

      const acpReq = converter.convertMCPtoACP(mcpReq);

      expect(acpReq).not.toBeNull();
      expect((acpReq!.params as any).prompt).toEqual([{ type: 'text', text: '' }]);
    });
  });

  describe('MCP tools/call → ACP session/new conversion (without session)', () => {
    it('should create session/new request when no session exists', () => {
      const mcpReq: MCPRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'acp_prompt',
          arguments: { prompt: 'Hello world' }
        }
      };

      const acpReq = converter.convertMCPtoACP(mcpReq);

      expect(acpReq).not.toBeNull();
      expect(acpReq!.method).toBe('session/new');
      expect(acpReq!.id).toBe('sess-1');
      expect(acpReq!.agentId).toBe('test-agent');
      expect((acpReq!.params as any).cwd).toBeDefined();
      expect((acpReq!.params as any).mcpServers).toEqual([]);
    });

    it('should queue prompt text in pending request', () => {
      const mcpReq: MCPRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'acp_prompt',
          arguments: { prompt: 'Queued prompt' }
        }
      };

      converter.convertMCPtoACP(mcpReq);

      // Check that session/new request has queued data
      const pending = state.takePendingRequest('sess-1');
      expect(pending).toBeDefined();
      expect(pending!.method).toBe('session/new');
      expect(pending!.originalId).toBe(1);
      expect(pending!.promptText).toBe('Queued prompt');
    });
  });

  describe('MCP resources/list returns empty array', () => {
    it('should return empty resources array', () => {
      const originalWrite = process.stdout.write;
      const originalError = console.error;
      let capturedOutput = '';
      process.stdout.write = ((chunk: any) => {
        capturedOutput += chunk.toString();
        return true;
      }) as any;
      console.error = (() => { }) as any;

      const mcpReq: MCPRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'resources/list'
      };

      const acpReq = converter.convertMCPtoACP(mcpReq);

      process.stdout.write = originalWrite;
      console.error = originalError;

      expect(acpReq).toBeNull();

      const response = JSON.parse(capturedOutput.trim());
      expect(response.result.resources).toEqual([]);
    });
  });

  describe('MCP prompts/list returns empty array', () => {
    it('should return empty prompts array', () => {
      const originalWrite = process.stdout.write;
      const originalError = console.error;
      let capturedOutput = '';
      process.stdout.write = ((chunk: any) => {
        capturedOutput += chunk.toString();
        return true;
      }) as any;
      console.error = (() => { }) as any;

      const mcpReq: MCPRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'prompts/list'
      };

      const acpReq = converter.convertMCPtoACP(mcpReq);

      process.stdout.write = originalWrite;
      console.error = originalError;

      expect(acpReq).toBeNull();

      const response = JSON.parse(capturedOutput.trim());
      expect(response.result.prompts).toEqual([]);
    });
  });

  describe('Unknown method returns -32601 error', () => {
    it('should return error for unknown method', () => {
      const originalWrite = process.stdout.write;
      const originalError = console.error;
      let capturedOutput = '';
      process.stdout.write = ((chunk: any) => {
        capturedOutput += chunk.toString();
        return true;
      }) as any;
      console.error = (() => { }) as any;

      const mcpReq: MCPRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'unknown/method'
      };

      const acpReq = converter.convertMCPtoACP(mcpReq);

      process.stdout.write = originalWrite;
      console.error = originalError;

      expect(acpReq).toBeNull();

      const response = JSON.parse(capturedOutput.trim());
      expect(response.error).toBeDefined();
      expect(response.error.code).toBe(-32601);
      expect(response.error.message).toContain('unknown/method');
    });
  });

  describe('ACP initialize response → MCP initialize response conversion', () => {
    it('should convert ACP initialize response to MCP format', () => {
      // First send initialize request to track it
      const mcpReq: MCPRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {}
      };
      converter.convertMCPtoACP(mcpReq);

      // Now convert response
      const acpResp: ACPResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: {
          agentInfo: { name: 'test-agent', version: '2.0.0' }
        }
      };

      const mcpResp = converter.convertACPtoMCP(acpResp);

      expect(mcpResp).not.toBeNull();
      expect(mcpResp!.id).toBe(1);
      expect(mcpResp!.result).toBeDefined();
      expect((mcpResp!.result as any).protocolVersion).toBe('2024-11-05');
      expect((mcpResp!.result as any).capabilities).toEqual({ tools: {}, resources: {} });
      expect((mcpResp!.result as any).serverInfo).toEqual({ name: 'test-agent', version: '2.0.0' });
    });

    it('should use default agentInfo if not provided', () => {
      const mcpReq: MCPRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {}
      };
      converter.convertMCPtoACP(mcpReq);

      const acpResp: ACPResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: {}
      };

      const mcpResp = converter.convertACPtoMCP(acpResp);

      expect((mcpResp!.result as any).serverInfo).toEqual({ name: 'acp-agent', version: '1.0.0' });
    });
  });

  describe('ACP session/new response stores acpSessionId', () => {
    it('should store ACP session ID from session/new response', () => {
      // Create session/new request
      const mcpReq: MCPRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'acp_prompt',
          arguments: { prompt: 'Test' }
        }
      };
      converter.convertMCPtoACP(mcpReq);

      // Simulate session/new response
      const acpResp: ACPResponse = {
        jsonrpc: '2.0',
        id: 'sess-1',
        result: {
          sessionId: 'session-xyz789'
        }
      };

      converter.convertACPtoMCP(acpResp);

      // Verify session ID was stored
      expect(state.getAcpSessionId()).toBe('session-xyz789');
    });
  });

  describe('ACP session/new response sends queued prompt', () => {
    it('should send queued prompt after session creation', () => {
      // Create tools/call without session (triggers session/new)
      const mcpReq: MCPRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'acp_prompt',
          arguments: { prompt: 'Queued prompt text' }
        }
      };
      converter.convertMCPtoACP(mcpReq);

      // Simulate session/new response
      const acpResp: ACPResponse = {
        jsonrpc: '2.0',
        id: 'sess-1',
        result: {
          sessionId: 'session-new123'
        }
      };

      converter.convertACPtoMCP(acpResp);

      // Verify callback was called with session/prompt
      expect(sendACPCallback).toHaveBeenCalledTimes(1);
      const sentRequest = sendACPCallback.mock.calls[0][0];
      expect(sentRequest.method).toBe('session/prompt');
      expect(sentRequest.id).toBe(1); // Original request ID
      expect((sentRequest.params as any).sessionId).toBe('session-new123');
      expect((sentRequest.params as any).prompt).toEqual([{ type: 'text', text: 'Queued prompt text' }]);
    });

    it('should not send prompt if no queued prompt exists', () => {
      // Manually add session/new request without queued prompt
      state.addPendingRequest('sess-1', { method: 'session/new' });

      const acpResp: ACPResponse = {
        jsonrpc: '2.0',
        id: 'sess-1',
        result: {
          sessionId: 'session-abc'
        }
      };

      converter.convertACPtoMCP(acpResp);

      // Callback should not be called
      expect(sendACPCallback).not.toHaveBeenCalled();
    });
  });

  describe('ACP session/prompt response returns accumulated text', () => {
    it('should return accumulated text in MCP format', () => {
      // Set up session/prompt request
      state.addPendingRequest(1, { method: 'session/prompt' });
      state.accumulateText(1, 'Hello ');
      state.accumulateText(1, 'world!');

      const acpResp: ACPResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: {}
      };

      const mcpResp = converter.convertACPtoMCP(acpResp);

      expect(mcpResp).not.toBeNull();
      expect(mcpResp!.id).toBe(1);
      expect((mcpResp!.result as any).content).toEqual([{ type: 'text', text: 'Hello world!' }]);
    });

    it('should return "No response" if no text accumulated', () => {
      state.addPendingRequest(1, { method: 'session/prompt' });

      const acpResp: ACPResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: {}
      };

      const mcpResp = converter.convertACPtoMCP(acpResp);

      expect((mcpResp!.result as any).content).toEqual([{ type: 'text', text: 'No response' }]);
    });

    it('should clear accumulated text after taking', () => {
      state.addPendingRequest(1, { method: 'session/prompt' });
      state.accumulateText(1, 'Test text');

      const acpResp: ACPResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: {}
      };

      converter.convertACPtoMCP(acpResp);

      // Text should be cleared
      const text = state.takeAccumulatedText(1);
      expect(text).toBe('');
    });
  });

  describe('session/update notification accumulates text', () => {
    it('should accumulate text from agent_message_chunk notification', () => {
      // Set up pending session/prompt request
      state.addPendingRequest(1, { method: 'session/prompt' });

      const notification: ACPNotification = {
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { text: 'Chunk 1' }
          }
        }
      };

      converter.handleACPNotification(notification);

      // Verify text was accumulated
      const text = state.takeAccumulatedText(1);
      expect(text).toBe('Chunk 1');
    });

    it('should accumulate multiple chunks', () => {
      state.addPendingRequest(1, { method: 'session/prompt' });

      const notification1: ACPNotification = {
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { text: 'First ' }
          }
        }
      };

      const notification2: ACPNotification = {
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { text: 'Second ' }
          }
        }
      };

      const notification3: ACPNotification = {
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { text: 'Third' }
          }
        }
      };

      converter.handleACPNotification(notification1);
      converter.handleACPNotification(notification2);
      converter.handleACPNotification(notification3);

      const text = state.takeAccumulatedText(1);
      expect(text).toBe('First Second Third');
    });

    it('should ignore notifications when no pending prompt request', () => {
      const notification: ACPNotification = {
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { text: 'Should be ignored' }
          }
        }
      };

      // Should not throw
      converter.handleACPNotification(notification);
    });

    it('should ignore non-agent_message_chunk updates', () => {
      state.addPendingRequest(1, { method: 'session/prompt' });

      const notification: ACPNotification = {
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          update: {
            sessionUpdate: 'other_update_type',
            content: { text: 'Should be ignored' }
          }
        }
      };

      converter.handleACPNotification(notification);

      const text = state.takeAccumulatedText(1);
      expect(text).toBe('');
    });
  });

  describe('ACP error → MCP error conversion', () => {
    it('should convert ACP error to MCP error', () => {
      state.addPendingRequest(1, { method: 'initialize' });

      const acpResp: ACPResponse = {
        jsonrpc: '2.0',
        id: 1,
        error: {
          code: -32000,
          message: 'ACP error message'
        }
      };

      const mcpResp = converter.convertACPtoMCP(acpResp);

      expect(mcpResp).not.toBeNull();
      expect(mcpResp!.error).toBeDefined();
      expect(mcpResp!.error!.code).toBe(-32000);
      expect(mcpResp!.error!.message).toBe('ACP error message');
      expect(mcpResp!.result).toBeUndefined();
    });

    it('should use default error code if not provided', () => {
      state.addPendingRequest(1, { method: 'initialize' });

      const acpResp: ACPResponse = {
        jsonrpc: '2.0',
        id: 1,
        error: {
          code: 0,
          message: 'Error'
        }
      };

      const mcpResp = converter.convertACPtoMCP(acpResp);

      expect(mcpResp!.error!.code).toBe(-32603);
    });

    it('should clear accumulated text on error', () => {
      state.addPendingRequest(1, { method: 'session/prompt' });
      state.accumulateText(1, 'Some text');

      const acpResp: ACPResponse = {
        jsonrpc: '2.0',
        id: 1,
        error: {
          code: -32000,
          message: 'Error occurred'
        }
      };

      converter.convertACPtoMCP(acpResp);

      // Text should be cleared
      const text = state.takeAccumulatedText(1);
      expect(text).toBe('');
    });
  });

  describe('MCP error → ACP error conversion', () => {
    it('should handle unknown method as MCP error', () => {
      const originalWrite = process.stdout.write;
      const originalError = console.error;
      let capturedOutput = '';
      process.stdout.write = ((chunk: any) => {
        capturedOutput += chunk.toString();
        return true;
      }) as any;
      console.error = (() => { }) as any;

      const mcpReq: MCPRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'invalid/method'
      };

      converter.convertMCPtoACP(mcpReq);

      process.stdout.write = originalWrite;
      console.error = originalError;

      const response = JSON.parse(capturedOutput.trim());
      expect(response.error).toBeDefined();
      expect(response.error.code).toBe(-32601);
      expect(response.error.message).toContain('invalid/method');
    });
  });

  describe('Edge cases and integration', () => {
    it('should handle response for unknown request ID', () => {
      const originalError = console.error;
      const errorLogs: string[] = [];
      console.error = ((...args: any[]) => {
        errorLogs.push(args.join(' '));
      }) as any;

      const acpResp: ACPResponse = {
        jsonrpc: '2.0',
        id: 999,
        result: {}
      };

      const mcpResp = converter.convertACPtoMCP(acpResp);

      console.error = originalError;

      expect(mcpResp).toBeNull();
      expect(errorLogs.some(log => log.includes('No pending request'))).toBe(true);
    });

    it('should handle complete tools/call flow with session', () => {
      // Initialize session
      state.ensureProxySessionId();
      state.setAcpSessionId('session-123');

      // Send tools/call
      const mcpReq: MCPRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'acp_prompt',
          arguments: { prompt: 'Test prompt' }
        }
      };

      const acpReq = converter.convertMCPtoACP(mcpReq);
      expect(acpReq!.method).toBe('session/prompt');

      // Simulate streaming chunks
      const notification1: ACPNotification = {
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { text: 'Response ' }
          }
        }
      };

      const notification2: ACPNotification = {
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { text: 'text' }
          }
        }
      };

      converter.handleACPNotification(notification1);
      converter.handleACPNotification(notification2);

      // Receive final response
      const acpResp: ACPResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: {}
      };

      const mcpResp = converter.convertACPtoMCP(acpResp);

      expect(mcpResp).not.toBeNull();
      expect((mcpResp!.result as any).content[0].text).toBe('Response text');
    });

    it('should handle complete tools/call flow without session', () => {
      // Send tools/call without session
      const mcpReq: MCPRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'acp_prompt',
          arguments: { prompt: 'Test prompt' }
        }
      };

      const acpReq = converter.convertMCPtoACP(mcpReq);
      expect(acpReq!.method).toBe('session/new');
      expect(acpReq!.id).toBe('sess-1');

      // Receive session/new response
      const sessionResp: ACPResponse = {
        jsonrpc: '2.0',
        id: 'sess-1',
        result: {
          sessionId: 'new-session-456'
        }
      };

      converter.convertACPtoMCP(sessionResp);

      // Verify session stored and prompt queued
      expect(state.getAcpSessionId()).toBe('new-session-456');
      expect(sendACPCallback).toHaveBeenCalledTimes(1);

      const queuedPrompt = sendACPCallback.mock.calls[0][0];
      expect(queuedPrompt.method).toBe('session/prompt');
      expect(queuedPrompt.id).toBe(1);
    });

    it('should handle resources/templates/list', () => {
      const originalWrite = process.stdout.write;
      const originalError = console.error;
      let capturedOutput = '';
      process.stdout.write = ((chunk: any) => {
        capturedOutput += chunk.toString();
        return true;
      }) as any;
      console.error = (() => { }) as any;

      const mcpReq: MCPRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'resources/templates/list'
      };

      const acpReq = converter.convertMCPtoACP(mcpReq);

      process.stdout.write = originalWrite;
      console.error = originalError;

      expect(acpReq).toBeNull();

      const response = JSON.parse(capturedOutput.trim());
      expect(response.result.resourceTemplates).toEqual([]);
    });
  });
});
