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
 * Property-based tests for the ProtocolConverter class.
 *
 * Uses fast-check to verify universal properties across all inputs.
 * Tests protocol conversion logic between MCP and ACP.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import fc from 'fast-check';
import { ProtocolConverter } from '../../src/mcp-proxy/converter.js';
import { StateManager } from '../../src/mcp-proxy/state.js';
import { ProxyConfig, MCPRequest, ACPResponse } from '../../src/mcp-proxy/types.js';

describe('ProtocolConverter Properties', () => {
  let config: ProxyConfig;
  let state: StateManager;
  let converter: ProtocolConverter;

  beforeEach(() => {
    config = {
      acpHost: '127.0.0.1',
      acpPort: 9011,
      agentId: 'test-agent'
    };
    state = new StateManager();
    converter = new ProtocolConverter(config, state);
  });

  // Feature: mcp-acp-proxy-integration, Property 1: MCP Initialize Conversion Preserves Structure
  // **Validates: Requirements 3.1, 4.1**
  describe('Property 1: MCP Initialize Conversion Preserves Structure', () => {
    it('should preserve structure for any valid MCP initialize request', () => {
      fc.assert(
        fc.property(
          fc.oneof(fc.string(), fc.integer()),
          fc.record({
            capabilities: fc.object(),
            clientInfo: fc.record({
              name: fc.string(),
              version: fc.string()
            })
          }),
          (id, params) => {
            const mcpReq: MCPRequest = {
              jsonrpc: '2.0',
              id,
              method: 'initialize',
              params
            };

            const acpReq = converter.convertMCPtoACP(mcpReq);

            // Should produce an ACP request
            expect(acpReq).not.toBeNull();
            if (acpReq) {
              expect(acpReq.jsonrpc).toBe('2.0');
              expect(acpReq.id).toBe(id);
              expect(acpReq.method).toBe('initialize');
              expect(acpReq.agentId).toBe(config.agentId);
              expect(acpReq.sessionId).toBeDefined();
              expect(typeof acpReq.sessionId).toBe('string');

              // Verify params structure
              const acpParams = acpReq.params as any;
              expect(acpParams.protocolVersion).toBe(1);
              expect(acpParams.clientCapabilities).toEqual(params.capabilities);
              expect(acpParams.clientInfo).toEqual(params.clientInfo);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // Feature: mcp-acp-proxy-integration, Property 2: Request ID Preservation
  // **Validates: Requirements 3.6**
  describe('Property 2: Request ID Preservation', () => {
    it('should preserve request IDs through MCP to ACP conversion', () => {
      fc.assert(
        fc.property(
          fc.oneof(fc.string(), fc.integer()),
          fc.constantFrom('initialize', 'tools/call'),
          fc.object(),
          (id, method, params) => {
            // Set up session for tools/call
            if (method === 'tools/call') {
              state.setAcpSessionId('test-session');
            }

            const mcpReq: MCPRequest = {
              jsonrpc: '2.0',
              id,
              method,
              params
            };

            const acpReq = converter.convertMCPtoACP(mcpReq);

            if (acpReq) {
              // For tools/call with session, ID should match
              // For initialize, ID should match
              if (method === 'initialize' || (method === 'tools/call' && state.getAcpSessionId())) {
                expect(acpReq.id).toBe(id);
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should preserve request IDs through ACP to MCP conversion', () => {
      fc.assert(
        fc.property(
          fc.oneof(fc.string(), fc.integer()),
          fc.constantFrom('initialize', 'session/prompt'),
          fc.object(),
          (id, method, result) => {
            // Add pending request
            state.addPendingRequest(id, { method, params: {} });

            const acpResp: ACPResponse = {
              jsonrpc: '2.0',
              id,
              result
            };

            const mcpResp = converter.convertACPtoMCP(acpResp);

            if (mcpResp) {
              expect(mcpResp.id).toBe(id);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // Feature: mcp-acp-proxy-integration, Property 3: Tools Call Conversion
  // **Validates: Requirements 3.3, 5.2**
  describe('Property 3: Tools Call Conversion', () => {
    it('should convert tools/call to session/new when no acpSessionId exists', () => {
      fc.assert(
        fc.property(
          fc.oneof(fc.string(), fc.integer()),
          fc.string(),
          (id, promptText) => {
            const mcpReq: MCPRequest = {
              jsonrpc: '2.0',
              id,
              method: 'tools/call',
              params: {
                name: 'acp_prompt',
                arguments: { prompt: promptText }
              }
            };

            const acpReq = converter.convertMCPtoACP(mcpReq);

            expect(acpReq).not.toBeNull();
            if (acpReq) {
              expect(acpReq.method).toBe('session/new');
              expect(acpReq.agentId).toBe(config.agentId);

              // Should have queued the prompt
              const pending = state.takePendingRequest(acpReq.id);
              expect(pending).toBeDefined();
              expect(pending?.method).toBe('session/new');
              expect(pending?.promptText).toBe(promptText);
              expect(pending?.originalId).toBe(id);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should convert tools/call to session/prompt when acpSessionId exists', () => {
      fc.assert(
        fc.property(
          fc.oneof(fc.string(), fc.integer()),
          fc.string(),
          fc.string({ minLength: 1 }), // Ensure non-empty session ID
          (id, promptText, sessionId) => {
            // Set up session
            state.setAcpSessionId(sessionId);

            const mcpReq: MCPRequest = {
              jsonrpc: '2.0',
              id,
              method: 'tools/call',
              params: {
                name: 'acp_prompt',
                arguments: { prompt: promptText }
              }
            };

            const acpReq = converter.convertMCPtoACP(mcpReq);

            expect(acpReq).not.toBeNull();
            if (acpReq) {
              expect(acpReq.method).toBe('session/prompt');
              expect(acpReq.id).toBe(id);
              expect(acpReq.agentId).toBe(config.agentId);

              const acpParams = acpReq.params as any;
              expect(acpParams.sessionId).toBe(sessionId);
              expect(acpParams.prompt).toEqual([{ type: 'text', text: promptText }]);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // Feature: mcp-acp-proxy-integration, Property 4: Session State Accumulation
  // **Validates: Requirements 4.3**
  describe('Property 4: Session State Accumulation', () => {
    it('should accumulate text chunks in order for any sequence', () => {
      fc.assert(
        fc.property(
          fc.oneof(fc.string({ minLength: 1 }), fc.integer()), // Ensure non-empty ID
          fc.array(fc.string(), { minLength: 1, maxLength: 20 }),
          (id, chunks) => {
            // Create a fresh state for each test
            const freshState = new StateManager();
            const freshConverter = new ProtocolConverter(config, freshState);

            // Add pending session/prompt request
            freshState.addPendingRequest(id, { method: 'session/prompt' });

            // Send notifications for each chunk
            for (const chunk of chunks) {
              const notification = {
                jsonrpc: '2.0' as const,
                method: 'session/update',
                params: {
                  update: {
                    sessionUpdate: 'agent_message_chunk',
                    content: { text: chunk }
                  }
                }
              };
              freshConverter.handleACPNotification(notification);
            }

            // Verify accumulated text
            const accumulated = freshState.takeAccumulatedText(id);
            const expected = chunks.join('');
            expect(accumulated).toBe(expected);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // Feature: mcp-acp-proxy-integration, Property 5: Session Prompt Response Conversion
  // **Validates: Requirements 4.4**
  describe('Property 5: Session Prompt Response Conversion', () => {
    it('should convert session/prompt response with accumulated text', () => {
      fc.assert(
        fc.property(
          fc.oneof(fc.string(), fc.integer()),
          fc.string(),
          (id, accumulatedText) => {
            // Set up pending request and accumulated text
            state.addPendingRequest(id, { method: 'session/prompt' });
            if (accumulatedText) {
              state.accumulateText(id, accumulatedText);
            }

            const acpResp: ACPResponse = {
              jsonrpc: '2.0',
              id,
              result: {}
            };

            const mcpResp = converter.convertACPtoMCP(acpResp);

            expect(mcpResp).not.toBeNull();
            if (mcpResp) {
              expect(mcpResp.id).toBe(id);
              expect(mcpResp.result).toBeDefined();

              const result = mcpResp.result as any;
              expect(result.content).toBeDefined();
              expect(Array.isArray(result.content)).toBe(true);
              expect(result.content[0].type).toBe('text');

              // Should return accumulated text or 'No response' if empty
              const expectedText = accumulatedText || 'No response';
              expect(result.content[0].text).toBe(expectedText);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // Feature: mcp-acp-proxy-integration, Property 6: Notification vs Response Classification
  // **Validates: Requirements 4.6**
  describe('Property 6: Notification vs Response Classification', () => {
    it('should classify messages with id as responses', () => {
      fc.assert(
        fc.property(
          fc.oneof(fc.string(), fc.integer()),
          fc.object(),
          (id, result) => {
            // Add pending request
            state.addPendingRequest(id, { method: 'initialize' });

            const message: ACPResponse = {
              jsonrpc: '2.0',
              id,
              result
            };

            // Should be processed as response
            const mcpResp = converter.convertACPtoMCP(message);
            expect(mcpResp).not.toBeNull();
            if (mcpResp) {
              expect(mcpResp.id).toBe(id);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should classify messages without id as notifications', () => {
      fc.assert(
        fc.property(
          fc.string(),
          (text) => {
            // Add pending session/prompt request
            state.addPendingRequest(1, { method: 'session/prompt' });

            const notification = {
              jsonrpc: '2.0' as const,
              method: 'session/update',
              params: {
                update: {
                  sessionUpdate: 'agent_message_chunk',
                  content: { text }
                }
              }
            };

            // Should not throw and should accumulate text
            expect(() => converter.handleACPNotification(notification)).not.toThrow();

            const accumulated = state.takeAccumulatedText(1);
            expect(accumulated).toBe(text);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
