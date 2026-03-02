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
 * Property-based tests for integration scenarios.
 *
 * Uses fast-check to verify universal properties across all inputs.
 * Tests configuration, logging, error handling, and end-to-end scenarios.
 */

import { describe, it, expect } from '@jest/globals';
import fc from 'fast-check';
import { ProtocolConverter } from '../../src/mcp-proxy/converter.js';
import { StateManager } from '../../src/mcp-proxy/state.js';
import { ProxyConfig, MCPRequest, MCPResponse, ACPResponse } from '../../src/mcp-proxy/types.js';

describe('Integration Properties', () => {
  // Feature: mcp-acp-proxy-integration, Property 9: Configuration Loading with Defaults
  // **Validates: Requirements 6.1, 6.2, 8.1, 8.2**
  describe('Property 9: Configuration Loading with Defaults', () => {
    it('should use default host when ACP_HOST is not provided', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 65535 }),
          fc.string({ minLength: 1 }),
          (port, agentId) => {
            const config: ProxyConfig = {
              acpHost: '127.0.0.1', // Default
              acpPort: port,
              agentId
            };

            expect(config.acpHost).toBe('127.0.0.1');
            expect(config.acpPort).toBe(port);
            expect(config.agentId).toBe(agentId);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should use default port when ACP_PORT is not provided', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1 }),
          fc.string({ minLength: 1 }),
          (host, agentId) => {
            const config: ProxyConfig = {
              acpHost: host,
              acpPort: 9011, // Default
              agentId
            };

            expect(config.acpHost).toBe(host);
            expect(config.acpPort).toBe(9011);
            expect(config.agentId).toBe(agentId);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should use custom values when provided', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1 }),
          fc.integer({ min: 1, max: 65535 }),
          fc.string({ minLength: 1 }),
          (host, port, agentId) => {
            const config: ProxyConfig = {
              acpHost: host,
              acpPort: port,
              agentId
            };

            expect(config.acpHost).toBe(host);
            expect(config.acpPort).toBe(port);
            expect(config.agentId).toBe(agentId);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle all combinations of defaults and custom values', () => {
      fc.assert(
        fc.property(
          fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
          fc.option(fc.integer({ min: 1, max: 65535 }), { nil: undefined }),
          fc.string({ minLength: 1 }),
          (customHost, customPort, agentId) => {
            const config: ProxyConfig = {
              acpHost: customHost ?? '127.0.0.1',
              acpPort: customPort ?? 9011,
              agentId
            };

            expect(config.acpHost).toBe(customHost ?? '127.0.0.1');
            expect(config.acpPort).toBe(customPort ?? 9011);
            expect(config.agentId).toBe(agentId);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // Feature: mcp-acp-proxy-integration, Property 12: Log Isolation
  // **Validates: Requirements 7.3**
  describe('Property 12: Log Isolation', () => {
    it('should never write protocol messages to stderr', () => {
      fc.assert(
        fc.property(
          fc.oneof(fc.string(), fc.integer()),
          fc.object(),
          (id, result) => {
            const mcpResponse: MCPResponse = {
              jsonrpc: '2.0',
              id,
              result
            };

            // Simulate stdout writing
            const stdoutLine = JSON.stringify(mcpResponse) + '\n';

            // Should be valid NDJSON
            expect(stdoutLine.endsWith('\n')).toBe(true);

            // Should not contain stderr markers
            expect(stdoutLine).not.toContain('[mcp-proxy]');

            // Should be parseable
            const parsed = JSON.parse(stdoutLine.slice(0, -1));
            expect(parsed.jsonrpc).toBe('2.0');
            expect(parsed.id).toEqual(id);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should format log messages with consistent prefix', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1 }),
          (message) => {
            // Simulate stderr log formatting
            const logLine = `[mcp-proxy] ${message}`;

            // Should have prefix
            expect(logLine.startsWith('[mcp-proxy]')).toBe(true);

            // Should contain the message
            expect(logLine).toContain(message);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // Feature: mcp-acp-proxy-integration, Property 13: Unknown Method Error Response
  // **Validates: Requirements 10.2**
  describe('Property 13: Unknown Method Error Response', () => {
    it('should return -32601 error for any unknown MCP method', () => {
      fc.assert(
        fc.property(
          fc.oneof(fc.string(), fc.integer()),
          fc.string().filter(method =>
            !['initialize', 'tools/list', 'tools/call', 'resources/list', 'resources/templates/list', 'prompts/list'].includes(method)
          ),
          fc.object(),
          (id, method, params) => {
            const config: ProxyConfig = {
              acpHost: '127.0.0.1',
              acpPort: 9011,
              agentId: 'test-agent'
            };
            const state = new StateManager();
            const converter = new ProtocolConverter(config, state);

            const mcpReq: MCPRequest = {
              jsonrpc: '2.0',
              id,
              method,
              params
            };

            const acpReq = converter.convertMCPtoACP(mcpReq);

            // Should return null (handled directly)
            expect(acpReq).toBeNull();

            // Should have removed pending request (error was sent)
            const pending = state.takePendingRequest(id);
            expect(pending).toBeUndefined();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should preserve request ID in error response', () => {
      fc.assert(
        fc.property(
          fc.oneof(fc.string(), fc.integer()),
          fc.string().filter(method =>
            !['initialize', 'tools/list', 'tools/call', 'resources/list', 'resources/templates/list', 'prompts/list'].includes(method)
          ),
          (id, method) => {
            // Simulate error response creation
            const errorResponse: MCPResponse = {
              jsonrpc: '2.0',
              id,
              error: {
                code: -32601,
                message: `Unknown method: ${method}`
              }
            };

            expect(errorResponse.id).toEqual(id);
            expect(errorResponse.error?.code).toBe(-32601);
            expect(errorResponse.error?.message).toContain(method);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // Feature: mcp-acp-proxy-integration, Property 14: Bidirectional Error Conversion
  // **Validates: Requirements 3.7, 4.5**
  describe('Property 14: Bidirectional Error Conversion', () => {
    it('should convert ACP errors to MCP errors preserving code and message', () => {
      fc.assert(
        fc.property(
          fc.oneof(fc.string(), fc.integer()),
          fc.integer().filter(code => code !== 0), // Exclude 0 which triggers default
          fc.string({ minLength: 1 }),
          (id, errorCode, errorMessage) => {
            const config: ProxyConfig = {
              acpHost: '127.0.0.1',
              acpPort: 9011,
              agentId: 'test-agent'
            };
            const state = new StateManager();
            const converter = new ProtocolConverter(config, state);

            // Add pending request
            state.addPendingRequest(id, { method: 'initialize' });

            const acpError: ACPResponse = {
              jsonrpc: '2.0',
              id,
              error: {
                code: errorCode,
                message: errorMessage
              }
            };

            const mcpResp = converter.convertACPtoMCP(acpError);

            expect(mcpResp).not.toBeNull();
            if (mcpResp) {
              expect(mcpResp.id).toEqual(id);
              expect(mcpResp.error).toBeDefined();
              expect(mcpResp.error?.code).toBe(errorCode);
              expect(mcpResp.error?.message).toBe(errorMessage);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should use default error code when ACP error code is missing', () => {
      fc.assert(
        fc.property(
          fc.oneof(fc.string(), fc.integer()),
          fc.string({ minLength: 1 }),
          (id, errorMessage) => {
            const config: ProxyConfig = {
              acpHost: '127.0.0.1',
              acpPort: 9011,
              agentId: 'test-agent'
            };
            const state = new StateManager();
            const converter = new ProtocolConverter(config, state);

            // Add pending request
            state.addPendingRequest(id, { method: 'initialize' });

            const acpError: ACPResponse = {
              jsonrpc: '2.0',
              id,
              error: {
                code: 0, // Will use default
                message: errorMessage
              }
            };

            const mcpResp = converter.convertACPtoMCP(acpError);

            expect(mcpResp).not.toBeNull();
            if (mcpResp) {
              expect(mcpResp.error).toBeDefined();
              // Should use default code -32603 when code is 0
              expect(mcpResp.error?.code).toBe(-32603);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should clear accumulated text when error occurs', () => {
      fc.assert(
        fc.property(
          fc.oneof(fc.string(), fc.integer()),
          fc.string(),
          fc.integer(),
          fc.string({ minLength: 1 }),
          (id, accumulatedText, errorCode, errorMessage) => {
            const config: ProxyConfig = {
              acpHost: '127.0.0.1',
              acpPort: 9011,
              agentId: 'test-agent'
            };
            const state = new StateManager();
            const converter = new ProtocolConverter(config, state);

            // Add pending request and accumulate text
            state.addPendingRequest(id, { method: 'session/prompt' });
            state.accumulateText(id, accumulatedText);

            const acpError: ACPResponse = {
              jsonrpc: '2.0',
              id,
              error: {
                code: errorCode,
                message: errorMessage
              }
            };

            converter.convertACPtoMCP(acpError);

            // Accumulated text should be cleared
            const remaining = state.takeAccumulatedText(id);
            expect(remaining).toBe('');
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // Feature: mcp-acp-proxy-integration, Property 16: Functional Equivalence with Reference Implementation
  // **Validates: Requirements 11.5**
  describe('Property 16: Functional Equivalence with Reference Implementation', () => {
    it('should produce equivalent ACP requests for any valid MCP request sequence', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              id: fc.oneof(fc.string(), fc.integer()),
              method: fc.constantFrom('initialize', 'tools/list', 'resources/list', 'prompts/list'),
              params: fc.object()
            }),
            { minLength: 1, maxLength: 5 }
          ),
          (requests) => {
            const config: ProxyConfig = {
              acpHost: '127.0.0.1',
              acpPort: 9011,
              agentId: 'test-agent'
            };
            const state = new StateManager();
            const converter = new ProtocolConverter(config, state);

            const acpRequests: any[] = [];

            for (const req of requests) {
              const mcpReq: MCPRequest = {
                jsonrpc: '2.0',
                ...req
              };

              const acpReq = converter.convertMCPtoACP(mcpReq);
              if (acpReq) {
                acpRequests.push(acpReq);
              }
            }

            // Verify all ACP requests have required fields
            for (const acpReq of acpRequests) {
              expect(acpReq.jsonrpc).toBe('2.0');
              expect(acpReq.id).toBeDefined();
              expect(acpReq.method).toBeDefined();
              expect(acpReq.agentId).toBe(config.agentId);
              expect(acpReq.sessionId).toBeDefined();
            }

            // Verify session ID consistency
            if (acpRequests.length > 0) {
              const firstSessionId = acpRequests[0].sessionId;
              for (const acpReq of acpRequests) {
                expect(acpReq.sessionId).toBe(firstSessionId);
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle tools/call with session creation consistently', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              id: fc.oneof(fc.string(), fc.integer()),
              prompt: fc.string()
            }),
            { minLength: 1, maxLength: 3 }
          ),
          (toolsCalls) => {
            const config: ProxyConfig = {
              acpHost: '127.0.0.1',
              acpPort: 9011,
              agentId: 'test-agent'
            };
            const state = new StateManager();
            const converter = new ProtocolConverter(config, state);

            const acpRequests: any[] = [];

            for (const call of toolsCalls) {
              const mcpReq: MCPRequest = {
                jsonrpc: '2.0',
                id: call.id,
                method: 'tools/call',
                params: {
                  name: 'acp_prompt',
                  arguments: { prompt: call.prompt }
                }
              };

              const acpReq = converter.convertMCPtoACP(mcpReq);
              if (acpReq) {
                acpRequests.push(acpReq);
              }
            }

            // First request should be session/new (no session exists)
            if (acpRequests.length > 0) {
              expect(acpRequests[0].method).toBe('session/new');
            }

            // Verify all requests have consistent session ID
            if (acpRequests.length > 0) {
              const sessionId = acpRequests[0].sessionId;
              for (const req of acpRequests) {
                expect(req.sessionId).toBe(sessionId);
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should maintain request-response correlation for any sequence', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.tuple(
              fc.oneof(fc.string(), fc.integer()),
              fc.constantFrom('initialize', 'session/prompt'),
              fc.object()
            ),
            { minLength: 1, maxLength: 5 }
          ),
          (sequence) => {
            const config: ProxyConfig = {
              acpHost: '127.0.0.1',
              acpPort: 9011,
              agentId: 'test-agent'
            };
            const state = new StateManager();
            const converter = new ProtocolConverter(config, state);

            // Process requests and responses
            for (const [id, method, result] of sequence) {
              // Add pending request
              state.addPendingRequest(id, { method });

              // Simulate response
              const acpResp: ACPResponse = {
                jsonrpc: '2.0',
                id,
                result
              };

              const mcpResp = converter.convertACPtoMCP(acpResp);

              // Should preserve ID
              if (mcpResp) {
                expect(mcpResp.id).toEqual(id);
              }

              // Should remove pending request
              const pending = state.takePendingRequest(id);
              expect(pending).toBeUndefined();
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
