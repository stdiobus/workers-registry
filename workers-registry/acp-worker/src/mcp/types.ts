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
 * MCP Types
 *
 * Type definitions for MCP client management.
 *
 * @module mcp/types
 */

/**
 * Configuration for an MCP server connection.
 * Matches the McpServerStdio type from ACP SDK.
 */
export interface MCPServerConfig {
  /** Server identifier */
  id: string;
  /** Command to spawn the server */
  command: string;
  /** Arguments for the command */
  args?: string[];
  /** Environment variables for the server process */
  env?: Record<string, string>;
}

/**
 * Represents an MCP tool definition.
 */
export interface MCPTool {
  /** Tool name */
  name: string;
  /** Tool description */
  description?: string;
  /** JSON Schema for tool input */
  inputSchema: Record<string, unknown>;
  /** Server ID that provides this tool */
  serverId: string;
}

/**
 * Represents an MCP resource definition.
 */
export interface MCPResource {
  /** Resource URI */
  uri: string;
  /** Resource name */
  name: string;
  /** Resource description */
  description?: string;
  /** MIME type */
  mimeType?: string;
  /** Server ID that provides this resource */
  serverId: string;
}

/**
 * Content types that can be returned from a tool call.
 * Matches MCP SDK content types.
 */
export interface MCPTextContent {
  type: 'text';
  text: string;
}

export interface MCPImageContent {
  type: 'image';
  data: string;
  mimeType: string;
}

export interface MCPEmbeddedResource {
  type: 'resource';
  resource: {
    uri: string;
    mimeType?: string;
    text?: string;
    blob?: string;
  };
}

export type MCPContent = MCPTextContent | MCPImageContent | MCPEmbeddedResource;

/**
 * Result of a tool call.
 */
export interface MCPToolCallResult {
  /** Content blocks returned by the tool */
  content: MCPContent[];
  /** Whether the tool execution resulted in an error */
  isError?: boolean;
}

/**
 * Text resource contents from MCP server.
 */
export interface MCPTextResourceContents {
  /** Resource URI */
  uri: string;
  /** MIME type */
  mimeType?: string;
  /** Text content */
  text: string;
}

/**
 * Blob resource contents from MCP server.
 */
export interface MCPBlobResourceContents {
  /** Resource URI */
  uri: string;
  /** MIME type */
  mimeType?: string;
  /** Base64-encoded blob data */
  blob: string;
}

/**
 * Resource contents returned from readResource.
 */
export type MCPResourceContents = MCPTextResourceContents | MCPBlobResourceContents;

/**
 * Result of reading a resource.
 */
export interface MCPResourceReadResult {
  /** Array of resource contents (usually one, but can be multiple) */
  contents: MCPResourceContents[];
}
