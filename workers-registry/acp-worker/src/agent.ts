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
 * Agent Implementation
 *
 * This module implements the ACP Agent interface using @agentclientprotocol/sdk.
 * The Agent handles all ACP protocol methods including initialization,
 * session management, and prompt processing.
 *
 * @module agent
 */

import type {
  Agent,
  AgentSideConnection,
  AuthenticateRequest,
  AuthenticateResponse,
  CancelNotification,
  ClientCapabilities,
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
import { SessionManager } from './session/manager.js';

/**
 * ACP Agent implementation for stdio Bus kernel worker.
 *
 * This class implements the Agent interface from the ACP SDK,
 * handling all protocol methods and coordinating with MCP servers
 * for tool execution.
 */
export class ACPAgent implements Agent {
  /**
   * Reference to the AgentSideConnection for sending notifications.
   * Used by prompt processing to send session updates.
   */
  private readonly _connection: AgentSideConnection;

  /**
   * Session manager for handling session lifecycle.
   * Manages session creation, lookup, cancellation, and cleanup.
   */
  private readonly _sessionManager: SessionManager;

  /**
   * Client capabilities received during initialization.
   * Used to determine what features the client supports.
   */
  private _clientCapabilities: ClientCapabilities | null = null;

  /**
   * Creates a new ACP Agent instance.
   *
   * @param connection - The AgentSideConnection for communicating with the client
   */
  constructor(connection: AgentSideConnection) {
    this._connection = connection;
    this._sessionManager = new SessionManager();
  }

  /**
   * Get the connection for sending notifications.
   * Used by prompt processing to send session updates.
   */
  get connection(): AgentSideConnection {
    return this._connection;
  }

  /**
   * Get the session manager for session operations.
   */
  get sessionManager(): SessionManager {
    return this._sessionManager;
  }

  /**
   * Get the client capabilities received during initialization.
   * Returns null if initialize() has not been called yet.
   */
  get clientCapabilities(): ClientCapabilities | null {
    return this._clientCapabilities;
  }

  /**
   * Handle ACP initialize request.
   * Returns agent capabilities and info.
   *
   * Stores client capabilities for later use and returns InitializeResponse
   * with agent info and capabilities including promptCapabilities.embeddedContext: true.
   *
   * @param params - The initialization request parameters
   * @returns Promise resolving to InitializeResponse with agent capabilities
   */
  async initialize(params: InitializeRequest): Promise<InitializeResponse> {
    // Store client capabilities for later use
    this._clientCapabilities = params.clientCapabilities ?? null;

    // Return InitializeResponse with agent info and capabilities
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentInfo: {
        name: 'stdio-bus-worker',
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

  /**
   * Handle ACP session/new request.
   * Creates a new session with MCP server connections.
   *
   * Generates a unique sessionId using crypto.randomUUID(), stores session state,
   * initializes MCP connections from the request params, and returns NewSessionResponse.
   *
   * @param params - The new session request parameters containing cwd and optional mcpServers
   * @returns Promise resolving to NewSessionResponse with session ID
   */
  async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
    // Convert ACP McpServer[] to MCPServerConfig[] for the session manager
    const mcpServers = params.mcpServers?.map((server) => {
      // Handle stdio type servers (most common for local MCP servers)
      if ('command' in server) {
        return {
          id: server.name,
          command: server.command,
          args: server.args,
          env: server.env?.reduce(
            (acc, envVar) => {
              acc[envVar.name] = envVar.value;
              return acc;
            },
            {} as Record<string, string>,
          ),
        };
      }
      // For HTTP/SSE servers, we'll need to handle them differently
      // For now, skip non-stdio servers
      return null;
    }).filter((s): s is NonNullable<typeof s> => s !== null);

    // Create a new session with the session manager
    // This generates a UUID for sessionId and stores session state
    const session = await this._sessionManager.createSession(params.cwd, mcpServers);

    // Return NewSessionResponse with the sessionId
    return {
      sessionId: session.id,
    };
  }

  /**
   * Handle ACP session/load request.
   * Loads an existing session (optional capability).
   *
   * @param params - The load session request parameters
   * @returns Promise resolving to LoadSessionResponse
   */
  async loadSession(_params: LoadSessionRequest): Promise<LoadSessionResponse> {
    // Session loading is an optional capability
    // Return empty response to indicate session not found
    return {} as LoadSessionResponse;
  }

  /**
   * Handle ACP authenticate request.
   * Processes authentication (if required).
   *
   * @param params - The authentication request parameters
   * @returns Promise resolving to AuthenticateResponse or void
   */
  async authenticate(_params: AuthenticateRequest): Promise<AuthenticateResponse | void> {
    // Authentication is optional - no auth methods are declared
    // This is a no-op implementation
  }

  /**
   * Handle ACP session/prompt request.
   * Processes user prompts and streams responses.
   *
   * Currently implements echo mode for testing - echoes user prompt as agent response.
   *
   * @param params - The prompt request parameters
   * @returns Promise resolving to PromptResponse with stop reason
   */
  async prompt(params: PromptRequest): Promise<PromptResponse> {
    // Validate session exists
    const session = this._sessionManager.getSession(params.sessionId);
    if (!session) {
      throw new Error(`Session not found: ${params.sessionId}`);
    }

    // Check for cancellation before processing
    if (session.isCancelled()) {
      return { stopReason: 'cancelled' };
    }

    // Process each content block in the prompt
    // Echo mode: echo user prompt as agent response
    for (const block of params.prompt) {
      // Check for cancellation during processing
      if (session.isCancelled()) {
        return { stopReason: 'cancelled' };
      }

      // Handle different content block types
      if (block.type === 'text') {
        // Echo text content as agent_message_chunk
        await this._connection.sessionUpdate({
          sessionId: params.sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: {
              type: 'text',
              text: block.text,
            },
          },
        });
      } else if (block.type === 'resource_link') {
        // For resource_link, try to resolve and echo the content
        const resourceLink = block as { type: 'resource_link'; uri: string; name: string };
        try {
          // Try to read the resource from MCP servers
          const result = await session.mcpManager.readResource(resourceLink.uri);
          if (result.contents.length > 0) {
            const content = result.contents[0];
            if ('text' in content) {
              await this._connection.sessionUpdate({
                sessionId: params.sessionId,
                update: {
                  sessionUpdate: 'agent_message_chunk',
                  content: {
                    type: 'text',
                    text: `[Resource: ${resourceLink.name}]\n${content.text}`,
                  },
                },
              });
            } else if ('blob' in content) {
              await this._connection.sessionUpdate({
                sessionId: params.sessionId,
                update: {
                  sessionUpdate: 'agent_message_chunk',
                  content: {
                    type: 'text',
                    text: `[Resource: ${resourceLink.name}] (binary data, ${content.blob.length} bytes)`,
                  },
                },
              });
            }
          }
        } catch {
          // If resource resolution fails, just echo the link info
          await this._connection.sessionUpdate({
            sessionId: params.sessionId,
            update: {
              sessionUpdate: 'agent_message_chunk',
              content: {
                type: 'text',
                text: `[Resource link: ${resourceLink.name} (${resourceLink.uri})]`,
              },
            },
          });
        }
      } else if (block.type === 'resource') {
        // For embedded resource, echo the content
        const resource = block as { type: 'resource'; resource: { uri: string; text?: string; blob?: string } };
        if (resource.resource.text !== undefined) {
          await this._connection.sessionUpdate({
            sessionId: params.sessionId,
            update: {
              sessionUpdate: 'agent_message_chunk',
              content: {
                type: 'text',
                text: `[Embedded resource: ${resource.resource.uri}]\n${resource.resource.text}`,
              },
            },
          });
        } else if (resource.resource.blob !== undefined) {
          await this._connection.sessionUpdate({
            sessionId: params.sessionId,
            update: {
              sessionUpdate: 'agent_message_chunk',
              content: {
                type: 'text',
                text: `[Embedded resource: ${resource.resource.uri}] (binary data)`,
              },
            },
          });
        }
      } else if (block.type === 'image') {
        // For images, echo a description
        const image = block as { type: 'image'; mimeType: string };
        await this._connection.sessionUpdate({
          sessionId: params.sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: {
              type: 'text',
              text: `[Image: ${image.mimeType}]`,
            },
          },
        });
      }
    }

    // Final cancellation check
    if (session.isCancelled()) {
      return { stopReason: 'cancelled' };
    }

    // Return end_turn as stopReason for successful completion
    return { stopReason: 'end_turn' };
  }

  /**
   * Handle ACP session/cancel notification.
   * Cancels ongoing operations for a session.
   *
   * Looks up the session by sessionId and calls session.cancel() to set
   * the cancellation flag and abort pending MCP operations.
   *
   * @param params - The cancel notification parameters containing sessionId
   */
  async cancel(params: CancelNotification): Promise<void> {
    // Look up the session by sessionId and cancel it
    // The session's cancel() method sets the cancellation flag
    // and aborts pending MCP operations
    this._sessionManager.cancelSession(params.sessionId);
  }
}
