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
 * MCP Integration Tests
 *
 * Tests for MCP server connection, tool discovery, and resource access.
 *
 * @module tests/integration/mcp.test
 */
import {
  configResource,
  createMCPClientForMockServer,
  createMockMCPServer,
  echoTool,
  errorTool,
  greetingResource,
  type MockMCPServer,
} from '../../src/test-utils/test-harness.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

describe('MCP Integration', () => {
  let mockServer: MockMCPServer;
  let client: Client;

  afterEach(async () => {
    if (client) {
      await client.close();
    }
    if (mockServer) {
      await mockServer.close();
    }
  });

  describe('Server Connection', () => {
    it('should connect to MCP server successfully', async () => {
      mockServer = await createMockMCPServer('test-server', [echoTool]);
      client = await createMCPClientForMockServer(mockServer);

      // Connection should be established
      expect(client).toBeDefined();
    });

    it('should receive server capabilities', async () => {
      mockServer = await createMockMCPServer('test-server', [echoTool], [greetingResource]);
      client = await createMCPClientForMockServer(mockServer);

      const capabilities = client.getServerCapabilities();
      expect(capabilities).toBeDefined();
      expect(capabilities?.tools).toBeDefined();
      expect(capabilities?.resources).toBeDefined();
    });
  });

  describe('Tool Discovery and Invocation', () => {
    beforeEach(async () => {
      mockServer = await createMockMCPServer('test-server', [echoTool, errorTool]);
      client = await createMCPClientForMockServer(mockServer);
    });

    it('should list available tools', async () => {
      const result = await client.listTools();

      expect(result.tools).toHaveLength(2);
      expect(result.tools.map((t) => t.name)).toContain('echo');
      expect(result.tools.map((t) => t.name)).toContain('error');
    });

    it('should invoke echo tool successfully', async () => {
      const result = await client.callTool({
        name: 'echo',
        arguments: { text: 'Hello, MCP!' },
      });

      expect(result.content).toHaveLength(1);
      expect((result.content as Array<{ type: string; text: string }>)[0]).toEqual({
        type: 'text',
        text: 'Hello, MCP!',
      });
      expect(result.isError).toBeFalsy();
    });

    it('should handle tool errors', async () => {
      const result = await client.callTool({
        name: 'error',
        arguments: { message: 'Test error' },
      });

      expect(result.content).toHaveLength(1);
      expect((result.content as Array<{ type: string; text: string }>)[0]).toEqual({
        type: 'text',
        text: 'Test error',
      });
      expect(result.isError).toBe(true);
    });

    it('should throw for unknown tool', async () => {
      await expect(
        client.callTool({
          name: 'unknown',
          arguments: {},
        }),
      ).rejects.toThrow('Unknown tool: unknown');
    });
  });

  describe('Resource Access', () => {
    beforeEach(async () => {
      mockServer = await createMockMCPServer('test-server', [], [greetingResource, configResource]);
      client = await createMCPClientForMockServer(mockServer);
    });

    it('should list available resources', async () => {
      const result = await client.listResources();

      expect(result.resources).toHaveLength(2);
      expect(result.resources.map((r) => r.uri)).toContain('test://greeting');
      expect(result.resources.map((r) => r.uri)).toContain('test://config');
    });

    it('should read text resource', async () => {
      const result = await client.readResource({ uri: 'test://greeting' });

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0]).toMatchObject({
        uri: 'test://greeting',
        mimeType: 'text/plain',
        text: 'Hello, World!',
      });
    });

    it('should read JSON resource', async () => {
      const result = await client.readResource({ uri: 'test://config' });

      expect(result.contents).toHaveLength(1);
      const content = result.contents[0] as { text: string };
      const parsed = JSON.parse(content.text);
      expect(parsed).toEqual({ test: true, version: '1.0.0' });
    });

    it('should throw for unknown resource', async () => {
      await expect(client.readResource({ uri: 'test://unknown' })).rejects.toThrow('Unknown resource: test://unknown');
    });
  });

  describe('Multiple Servers', () => {
    let mockServer2: MockMCPServer;
    let client2: Client;

    afterEach(async () => {
      if (client2) {
        await client2.close();
      }
      if (mockServer2) {
        await mockServer2.close();
      }
    });

    it('should connect to multiple servers independently', async () => {
      const reverseTool = {
        name: 'reverse',
        description: 'Reverses text',
        inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
        handler: async (args: Record<string, unknown>) => ({
          content: [{ type: 'text', text: String(args.text ?? '').split('').reverse().join('') }],
        }),
      };

      mockServer = await createMockMCPServer('server1', [echoTool]);
      mockServer2 = await createMockMCPServer('server2', [reverseTool]);

      client = await createMCPClientForMockServer(mockServer);
      client2 = await createMCPClientForMockServer(mockServer2);

      // Server 1 should have echo tool
      const tools1 = await client.listTools();
      expect(tools1.tools.map((t) => t.name)).toContain('echo');
      expect(tools1.tools.map((t) => t.name)).not.toContain('reverse');

      // Server 2 should have reverse tool
      const tools2 = await client2.listTools();
      expect(tools2.tools.map((t) => t.name)).toContain('reverse');
      expect(tools2.tools.map((t) => t.name)).not.toContain('echo');

      // Both should work independently
      const echoResult = await client.callTool({ name: 'echo', arguments: { text: 'hello' } });
      expect((echoResult.content as Array<{ type: string; text: string }>)[0]).toEqual({ type: 'text', text: 'hello' });

      const reverseResult = await client2.callTool({ name: 'reverse', arguments: { text: 'hello' } });
      expect((reverseResult.content as Array<{ type: string; text: string }>)[0]).toEqual({
        type: 'text',
        text: 'olleh',
      });
    });
  });
});
