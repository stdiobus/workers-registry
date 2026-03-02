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
 * MCP Manager
 *
 * Manages multiple MCP server connections for a session.
 * Handles connection lifecycle, tool discovery, and tool invocation.
 *
 * @module mcp/manager
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { ServerCapabilities } from '@modelcontextprotocol/sdk/types.js';
import type {
  MCPBlobResourceContents,
  MCPContent,
  MCPResource,
  MCPResourceContents,
  MCPResourceReadResult,
  MCPServerConfig,
  MCPTextResourceContents,
  MCPTool,
  MCPToolCallResult,
} from './types.js';

/**
 * Represents an active MCP connection with its client and transport.
 */
export interface MCPConnection {
  /** The MCP SDK client instance */
  client: Client;
  /** The stdio transport for the connection */
  transport: StdioClientTransport;
  /** Server configuration */
  config: MCPServerConfig;
  /** Whether the connection is active */
  connected: boolean;
  /** Server capabilities from initialization handshake */
  capabilities?: ServerCapabilities;
  /** Error message if the server crashed */
  crashError?: string;
}

/**
 * Factory functions for creating MCP SDK instances.
 * Used for dependency injection in tests.
 */
export interface MCPFactories {
  /** Factory for creating Client instances */
  createClient: (options: { name: string; version: string }) => Client;
  /** Factory for creating StdioClientTransport instances */
  createTransport: (options: {
    command: string;
    args?: string[];
    env?: Record<string, string>
  }) => StdioClientTransport;
}

/** Default factories using the real MCP SDK */
const defaultFactories: MCPFactories = {
  createClient: (options) => new Client(options),
  createTransport: (options) => new StdioClientTransport(options),
};

/**
 * Manages MCP server connections for a session.
 */
export class MCPManager {
  /** Active connections keyed by server ID */
  private connections: Map<string, MCPConnection> = new Map();

  /** Map from tool name to server ID for routing tool calls */
  private toolToServer: Map<string, string> = new Map();

  /** Callback for server crash notifications */
  private onServerCrash?: (serverId: string, error: string) => void;

  /** Factory functions for creating SDK instances (injectable for testing) */
  private factories: MCPFactories;

  /**
   * Create a new MCPManager instance.
   *
   * @param factories - Optional factory functions for dependency injection (used in tests)
   */
  constructor(factories?: Partial<MCPFactories>) {
    this.factories = { ...defaultFactories, ...factories };
  }

  /**
   * Set a callback to be notified when a server crashes.
   *
   * @param callback - Function to call when a server crashes
   */
  setOnServerCrash(callback: (serverId: string, error: string) => void): void {
    this.onServerCrash = callback;
  }

  /**
   * Connect to MCP servers specified in the configuration.
   *
   * @param servers - Array of MCP server configurations
   */
  async connect(servers: MCPServerConfig[]): Promise<void> {
    for (const serverConfig of servers) {
      try {
        // Create stdio transport for subprocess MCP server
        // Use StdioClientTransport
        const transport = this.factories.createTransport({
          command: serverConfig.command,
          args: serverConfig.args,
          env: serverConfig.env,
        });

        // Create MCP client
        // Use Client class
        const client = this.factories.createClient({
          name: 'stdio-bus-worker',
          version: '1.0.0',
        });

        // Connect client to transport
        // SDK sends initialize and notifications/initialized
        await client.connect(transport);

        // Get and store server capabilities
        // Store server capabilities for feature detection
        const capabilities = client.getServerCapabilities();

        // Store the connection
        const connection: MCPConnection = {
          client,
          transport,
          config: serverConfig,
          connected: true,
          capabilities,
        };
        this.connections.set(serverConfig.id, connection);

        // Set up crash detection via transport close event
        // Detect server process exit
        this.setupCrashDetection(serverConfig.id, client);

        // Log successful connection to stderr
        console.error(`[MCP] Connected to server: ${serverConfig.id}`);
      } catch (error) {
        // Handle connection errors gracefully
        console.error(`[MCP] Failed to connect to server ${serverConfig.id}:`, error);
        // Continue with other servers
      }
    }
  }

  /**
   * Set up crash detection for an MCP server connection.
   *
   * @param serverId - The server ID
   * @param client - The MCP client
   */
  private setupCrashDetection(serverId: string, client: Client): void {
    // Listen for client close event which indicates server disconnection
    client.onclose = () => {
      const connection = this.connections.get(serverId);
      if (connection && connection.connected) {
        // Mark server as crashed
        connection.connected = false;
        connection.crashError = 'Server process exited unexpectedly';

        // Remove tools from this server from the routing map
        for (const [toolName, toolServerId] of this.toolToServer.entries()) {
          if (toolServerId === serverId) {
            this.toolToServer.delete(toolName);
          }
        }

        // Log the crash
        console.error(`[MCP] Server ${serverId} crashed: ${connection.crashError}`);

        // Notify callback if set
        if (this.onServerCrash) {
          this.onServerCrash(serverId, connection.crashError);
        }
      }
    };
  }

  /**
   * Get all available tools from connected MCP servers.
   *
   * @returns Combined list of tools from all connected servers
   */
  async listTools(): Promise<MCPTool[]> {
    const allTools: MCPTool[] = [];

    // Clear the toolToServer map before repopulating
    this.toolToServer.clear();

    // Iterate through all connected MCP servers
    for (const [serverId, connection] of this.connections) {
      if (!connection.connected) {
        continue;
      }

      try {
        // Handle pagination - keep fetching while there's a nextCursor
        let cursor: string | undefined;
        do {
          // Call client.listTools() on each connection
          // Use client.listTools() to discover available tools
          const result = await connection.client.listTools(cursor ? { cursor } : undefined);

          // Map the results to MCPTool[] format with serverId included
          // Store tool definitions (name, description, inputSchema)
          for (const tool of result.tools) {
            allTools.push({
              name: tool.name,
              description: tool.description,
              inputSchema: tool.inputSchema as Record<string, unknown>,
              serverId,
            });

            // Track which server provides this tool for routing
            this.toolToServer.set(tool.name, serverId);
          }

          // Handle pagination if the server returns nextCursor
          cursor = result.nextCursor;
        } while (cursor);
      } catch (error) {
        // Log error but continue with other servers
        console.error(`[MCP] Failed to list tools from server ${serverId}:`, error);
      }
    }

    return allTools;
  }

  /**
   * Invoke a tool on the appropriate MCP server.
   * - Finds the server that provides the tool
   * - Calls client.callTool({ name, arguments }) on the appropriate connection
   * - Handles CallToolResult response
   * - Checks isError flag for failures
   * - Returns errors for calls to crashed server
   *
   * @param name - The name of the tool to invoke
   * @param args - The arguments to pass to the tool
   * @param serverId - Optional server ID to call the tool on (if known)
   * @returns The tool call result with content and error status
   * @throws Error if tool is not found or server is not connected
   */
  async callTool(name: string, args: Record<string, unknown>, serverId?: string): Promise<MCPToolCallResult> {
    // Determine which server to call
    const targetServerId = serverId ?? this.toolToServer.get(name);

    if (!targetServerId) {
      throw new Error(`Tool "${name}" not found. Call listTools() first to discover available tools.`);
    }

    // Get the connection for the target server
    const connection = this.connections.get(targetServerId);

    if (!connection) {
      throw new Error(`Server "${targetServerId}" not found.`);
    }

    if (!connection.connected) {
      // Return errors for calls to crashed server
      const crashMessage = connection.crashError || 'Server is not connected';
      throw new Error(`Server "${targetServerId}" is unavailable: ${crashMessage}`);
    }

    try {
      // Call client.callTool() on the appropriate connection
      // Use client.callTool() to invoke tools
      const result = await connection.client.callTool({
        name,
        arguments: args,
      });

      // Map the SDK result to our MCPToolCallResult type
      // Use SDK content types from result
      const content: MCPContent[] = (result.content as Array<{ type: string; [key: string]: unknown }>).map((item) => {
        if (item.type === 'text') {
          return {
            type: 'text' as const,
            text: item.text as string,
          };
        } else if (item.type === 'image') {
          return {
            type: 'image' as const,
            data: item.data as string,
            mimeType: item.mimeType as string,
          };
        } else if (item.type === 'resource') {
          const resource = item.resource as { uri: string; mimeType?: string; text?: string; blob?: string };
          return {
            type: 'resource' as const,
            resource: {
              uri: resource.uri,
              mimeType: resource.mimeType,
              text: resource.text,
              blob: resource.blob,
            },
          };
        }
        // Default to text for unknown types
        return {
          type: 'text' as const,
          text: JSON.stringify(item),
        };
      });

      // Check CallToolResult.isError for tool failures
      return {
        content,
        isError: result.isError === true,
      };
    } catch (error) {
      // Log error and re-throw
      console.error(`[MCP] Failed to call tool "${name}" on server ${targetServerId}:`, error);
      throw error;
    }
  }

  /**
   * Get all available resources from connected MCP servers.
   * - Calls client.listResources() to discover available resources
   * - Stores resource definitions (uri, name, description, mimeType)
   * - Handles pagination via nextCursor if present
   *
   * @returns Combined list of resources from all connected servers
   */
  async listResources(): Promise<MCPResource[]> {
    const allResources: MCPResource[] = [];

    // Iterate through all connected MCP servers
    for (const [serverId, connection] of this.connections) {
      if (!connection.connected) {
        continue;
      }

      try {
        // Handle pagination - keep fetching while there's a nextCursor
        let cursor: string | undefined;
        do {
          // Call client.listResources() on each connection
          // Use client.listResources() to discover resources
          const result = await connection.client.listResources(cursor ? { cursor } : undefined);

          // Map the results to MCPResource[] format with serverId included
          for (const resource of result.resources) {
            allResources.push({
              uri: resource.uri,
              name: resource.name,
              description: resource.description,
              mimeType: resource.mimeType,
              serverId,
            });
          }

          // Handle pagination if the server returns nextCursor
          cursor = result.nextCursor;
        } while (cursor);
      } catch (error) {
        // Log error but continue with other servers
        console.error(`[MCP] Failed to list resources from server ${serverId}:`, error);
      }
    }

    return allResources;
  }

  /**
   * Read a resource from the appropriate MCP server.
   * - Calls client.readResource({ uri }) on the appropriate connection
   * - Handles TextResourceContents and BlobResourceContents
   * - Determines which server handles the URI based on resource list
   *
   * @param uri - The URI of the resource to read
   * @param serverId - Optional server ID to read from (if known)
   * @returns The resource contents
   * @throws Error if resource server is not found or not connected
   */
  async readResource(uri: string, serverId?: string): Promise<MCPResourceReadResult> {
    // Determine which server to use
    let targetServerId = serverId;

    // If no server ID provided, try to find the server that provides this resource
    if (!targetServerId) {
      // Search through all connected servers' resources to find the one with this URI
      for (const [, connection] of this.connections) {
        if (!connection.connected) {
          continue;
        }

        try {
          // Try to read from this server - if it has the resource, it will succeed
          const result = await connection.client.readResource({ uri });

          // Map the SDK result to our MCPResourceReadResult type
          const contents: MCPResourceContents[] = result.contents.map((item) => {
            const resourceItem = item as { uri: string; mimeType?: string; text?: string; blob?: string };
            if ('text' in resourceItem && resourceItem.text !== undefined) {
              return {
                uri: resourceItem.uri,
                mimeType: resourceItem.mimeType,
                text: resourceItem.text,
              } as MCPTextResourceContents;
            } else if ('blob' in resourceItem && resourceItem.blob !== undefined) {
              return {
                uri: resourceItem.uri,
                mimeType: resourceItem.mimeType,
                blob: resourceItem.blob,
              } as MCPBlobResourceContents;
            }
            // Default to text with empty content for unknown types
            return {
              uri: resourceItem.uri,
              mimeType: resourceItem.mimeType,
              text: '',
            } as MCPTextResourceContents;
          });

          return { contents };
        } catch {
          // This server doesn't have the resource, try the next one
          continue;
        }
      }

      throw new Error(`Resource "${uri}" not found on any connected server.`);
    }

    // Get the connection for the target server
    const connection = this.connections.get(targetServerId);

    if (!connection) {
      throw new Error(`Server "${targetServerId}" not found.`);
    }

    if (!connection.connected) {
      throw new Error(`Server "${targetServerId}" is not connected.`);
    }

    try {
      // Call client.readResource() on the appropriate connection
      // Use client.readResource() to read resources
      const result = await connection.client.readResource({ uri });

      // Map the SDK result to our MCPResourceReadResult type
      // Handle TextResourceContents and BlobResourceContents
      const contents: MCPResourceContents[] = result.contents.map((item) => {
        const resourceItem = item as { uri: string; mimeType?: string; text?: string; blob?: string };
        if ('text' in resourceItem && resourceItem.text !== undefined) {
          return {
            uri: resourceItem.uri,
            mimeType: resourceItem.mimeType,
            text: resourceItem.text,
          } as MCPTextResourceContents;
        } else if ('blob' in resourceItem && resourceItem.blob !== undefined) {
          return {
            uri: resourceItem.uri,
            mimeType: resourceItem.mimeType,
            blob: resourceItem.blob,
          } as MCPBlobResourceContents;
        }
        // Default to text with empty content for unknown types
        return {
          uri: resourceItem.uri,
          mimeType: resourceItem.mimeType,
          text: '',
        } as MCPTextResourceContents;
      });

      return { contents };
    } catch (error) {
      // Log error and re-throw
      console.error(`[MCP] Failed to read resource "${uri}" from server ${targetServerId}:`, error);
      throw error;
    }
  }

  /**
   * Get a connection by server ID.
   *
   * @param serverId - The server ID to look up
   * @returns The connection or undefined if not found
   */
  getConnection(serverId: string): MCPConnection | undefined {
    return this.connections.get(serverId);
  }

  /**
   * Get all active connections.
   *
   * @returns Array of all active connections
   */
  getAllConnections(): MCPConnection[] {
    return Array.from(this.connections.values()).filter((conn) => conn.connected);
  }

  /**
   * Get server capabilities for a specific server.
   *
   * @param serverId - The server ID to look up
   * @returns The server capabilities or undefined if not found/connected
   */
  getServerCapabilities(serverId: string): ServerCapabilities | undefined {
    const connection = this.connections.get(serverId);
    return connection?.connected ? connection.capabilities : undefined;
  }

  /**
   * Close all MCP server connections.
   */
  async close(): Promise<void> {
    for (const connection of this.connections.values()) {
      try {
        await connection.client.close();
        connection.connected = false;
      } catch (error) {
        console.error(`[MCP] Error closing connection ${connection.config.id}:`, error);
      }
    }
    this.connections.clear();
    this.toolToServer.clear();
  }

  /**
   * Abort all pending MCP operations.
   * Called when a session is cancelled to stop in-flight requests.
   */
  abortPendingOperations(): void {
    // Mark all connections as not connected to prevent new operations
    for (const connection of this.connections.values()) {
      connection.connected = false;
    }
  }

  /**
   * Check if a server has crashed.
   *
   * @param serverId - The server ID to check
   * @returns True if the server has crashed
   */
  isServerCrashed(serverId: string): boolean {
    const connection = this.connections.get(serverId);
    return connection !== undefined && !connection.connected && connection.crashError !== undefined;
  }

  /**
   * Get the crash error for a server.
   *
   * @param serverId - The server ID to check
   * @returns The crash error message or undefined if not crashed
   */
  getServerCrashError(serverId: string): string | undefined {
    const connection = this.connections.get(serverId);
    return connection?.crashError;
  }

  /**
   * Get all crashed servers.
   *
   * @returns Array of crashed server IDs with their error messages
   */
  getCrashedServers(): Array<{ serverId: string; error: string }> {
    const crashed: Array<{ serverId: string; error: string }> = [];
    for (const [serverId, connection] of this.connections) {
      if (!connection.connected && connection.crashError) {
        crashed.push({ serverId, error: connection.crashError });
      }
    }
    return crashed;
  }
}
