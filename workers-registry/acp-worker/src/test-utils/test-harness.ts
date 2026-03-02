/**
 * Integration Test Harness
 *
 * Provides utilities for testing full ACP/MCP protocol flows.
 * Creates mock MCP servers and ACP clients for integration testing.
 *
 * @module tests/integration/test-harness
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { ServerCapabilities } from '@modelcontextprotocol/sdk/types.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

/**
 * Mock MCP server for testing.
 * Provides configurable tools and resources.
 */
export interface MockMCPServer {
  server: Server;
  transport: [unknown, unknown];
  tools: MockTool[];
  resources: MockResource[];
  close: () => Promise<void>;
}

/**
 * Mock tool definition.
 */
export interface MockTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<{
    content: Array<{ type: string; text?: string }>;
    isError?: boolean
  }>;
}

/**
 * Mock resource definition.
 */
export interface MockResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  content: string | { blob: string };
}

/**
 * Create a mock MCP server with configurable tools and resources.
 *
 * @param name - Server name
 * @param tools - Array of mock tools
 * @param resources - Array of mock resources
 * @returns Mock MCP server instance
 */
export async function createMockMCPServer(
  name: string,
  tools: MockTool[] = [],
  resources: MockResource[] = [],
): Promise<MockMCPServer> {
  // Always declare both capabilities to avoid SDK errors
  const capabilities: ServerCapabilities = {
    tools: {},
    resources: {},
  };

  const server = new Server(
    { name, version: '1.0.0' },
    { capabilities },
  );

  // Handle tools/list using proper schema
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    };
  });

  // Handle tools/call using proper schema
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name: toolName, arguments: args } = request.params;
    const tool = tools.find((t) => t.name === toolName);
    if (!tool) {
      throw new Error(`Unknown tool: ${toolName}`);
    }
    return tool.handler((args ?? {}) as Record<string, unknown>);
  });

  // Handle resources/list using proper schema
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: resources.map((r) => ({
        uri: r.uri,
        name: r.name,
        description: r.description,
        mimeType: r.mimeType,
      })),
    };
  });

  // Handle resources/read using proper schema
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    const resource = resources.find((r) => r.uri === uri);
    if (!resource) {
      throw new Error(`Unknown resource: ${uri}`);
    }
    if (typeof resource.content === 'string') {
      return {
        contents: [{ uri, mimeType: resource.mimeType, text: resource.content }],
      };
    } else {
      return {
        contents: [{ uri, mimeType: resource.mimeType, blob: resource.content.blob }],
      };
    }
  });

  // Create in-memory transport pair using static method
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  // Connect server to one end
  await server.connect(serverTransport);

  return {
    server,
    transport: [serverTransport, clientTransport],
    tools,
    resources,
    close: async () => {
      await server.close();
    },
  };
}

/**
 * Create an MCP client connected to a mock server.
 *
 * @param mockServer - The mock server to connect to
 * @returns Connected MCP client
 */
export async function createMCPClientForMockServer(mockServer: MockMCPServer): Promise<Client> {
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(mockServer.transport[1] as Parameters<typeof client.connect>[0]);
  return client;
}

/**
 * Default echo tool for testing.
 */
export const echoTool: MockTool = {
  name: 'echo',
  description: 'Echoes the input text',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Text to echo' },
    },
    required: ['text'],
  },
  handler: async (args) => ({
    content: [{ type: 'text', text: String(args.text ?? '') }],
  }),
};

/**
 * Default error tool for testing error handling.
 */
export const errorTool: MockTool = {
  name: 'error',
  description: 'Always returns an error',
  inputSchema: {
    type: 'object',
    properties: {
      message: { type: 'string', description: 'Error message' },
    },
    required: ['message'],
  },
  handler: async (args) => ({
    content: [{ type: 'text', text: String(args.message ?? 'Error') }],
    isError: true,
  }),
};

/**
 * Default greeting resource for testing.
 */
export const greetingResource: MockResource = {
  uri: 'test://greeting',
  name: 'Greeting',
  description: 'A test greeting',
  mimeType: 'text/plain',
  content: 'Hello, World!',
};

/**
 * Default config resource for testing.
 */
export const configResource: MockResource = {
  uri: 'test://config',
  name: 'Config',
  description: 'Test configuration',
  mimeType: 'application/json',
  content: JSON.stringify({ test: true, version: '1.0.0' }),
};
