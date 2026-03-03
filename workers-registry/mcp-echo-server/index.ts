#!/usr/bin/env node

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
 * MCP Echo Server for Testing
 *
 * A simple MCP server that provides echo tools and test resources
 * for integration testing with the stdio Bus kernel worker.
 *
 * @module workers-registry/mcp-echo-server
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// Create MCP server instance
const server = new Server(
  {
    name: 'mcp-echo-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  },
);

// Define available tools
const tools = [
  {
    name: 'echo',
    description: 'Echoes the input text back',
    inputSchema: {
      type: 'object' as const,
      properties: {
        text: {
          type: 'string',
          description: 'Text to echo',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'reverse',
    description: 'Reverses the input text',
    inputSchema: {
      type: 'object' as const,
      properties: {
        text: {
          type: 'string',
          description: 'Text to reverse',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'uppercase',
    description: 'Converts input text to uppercase',
    inputSchema: {
      type: 'object' as const,
      properties: {
        text: {
          type: 'string',
          description: 'Text to convert',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'delay',
    description: 'Echoes text after a delay (for testing cancellation)',
    inputSchema: {
      type: 'object' as const,
      properties: {
        text: {
          type: 'string',
          description: 'Text to echo',
        },
        ms: {
          type: 'number',
          description: 'Delay in milliseconds',
        },
      },
      required: ['text', 'ms'],
    },
  },
  {
    name: 'error',
    description: 'Always returns an error (for testing error handling)',
    inputSchema: {
      type: 'object' as const,
      properties: {
        message: {
          type: 'string',
          description: 'Error message to return',
        },
      },
      required: ['message'],
    },
  },
];

// Define available resources
const resources = [
  {
    uri: 'test://greeting',
    name: 'Greeting',
    description: 'A simple greeting message',
    mimeType: 'text/plain',
  },
  {
    uri: 'test://config',
    name: 'Test Config',
    description: 'Test configuration in JSON format',
    mimeType: 'application/json',
  },
];

// Handle tools/list request
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

// Handle tools/call request
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params as { name: string; arguments?: Record<string, unknown> };

  switch (name) {
    case 'echo':
      return {
        content: [{ type: 'text', text: String(args?.text ?? '') }],
      };

    case 'reverse':
      const text = String(args?.text ?? '');
      return {
        content: [{ type: 'text', text: text.split('').reverse().join('') }],
      };

    case 'uppercase':
      return {
        content: [{ type: 'text', text: String(args?.text ?? '').toUpperCase() }],
      };

    case 'delay':
      const delayMs = Number(args?.ms ?? 1000);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return {
        content: [{ type: 'text', text: String(args?.text ?? '') }],
      };

    case 'error':
      return {
        content: [{ type: 'text', text: String(args?.message ?? 'Error occurred') }],
        isError: true,
      };

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

// Handle resources/list request
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return { resources };
});

// Handle resources/read request
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params as { uri: string };

  switch (uri) {
    case 'test://greeting':
      return {
        contents: [
          {
            uri,
            mimeType: 'text/plain',
            text: 'Hello from MCP Echo Server!',
          },
        ],
      };

    case 'test://config':
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify({
              version: '1.0.0',
              features: ['echo', 'reverse', 'uppercase'],
              testMode: true,
            }),
          },
        ],
      };

    default:
      throw new Error(`Unknown resource: ${uri}`);
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[MCP Echo Server] Started');
}

main().catch((error) => {
  console.error('[MCP Echo Server] Fatal error:', error);
  process.exit(1);
});
