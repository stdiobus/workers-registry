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
 * Message Router for the Registry Launcher.
 *
 * Routes incoming JSON-RPC messages to the appropriate agent based on agentId.
 * Handles agentId extraction, message transformation, and error response generation.
 *
 * @module router/message-router
 */

import type { IRegistryIndex } from '../registry/index.js';
import { AgentNotFoundError, PlatformNotSupportedError } from '../registry/index.js';
import type { AgentRuntimeManager } from '../runtime/manager.js';
import type { AgentRuntime } from '../runtime/types.js';
import { getAgentApiKey } from '../config/api-keys.js';

/**
 * JSON-RPC error codes for routing errors.
 */
export const RoutingErrorCodes = {
  /** Missing agentId in request */
  MISSING_AGENT_ID: -32600,
  /** Agent not found in registry */
  AGENT_NOT_FOUND: -32001,
  /** Platform not supported for binary distribution */
  PLATFORM_NOT_SUPPORTED: -32002,
  /** Agent spawn failed */
  SPAWN_FAILED: -32003,
} as const;

/**
 * JSON-RPC error response structure.
 */
export interface ErrorResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/**
 * Pending request tracking structure.
 */
interface PendingRequest {
  id: string | number;
  agentId: string;
  timestamp: number;
}

/**
 * Callback type for writing responses to stdout.
 */
export type WriteCallback = (message: object) => boolean;

/**
 * Log an error message to stderr with ISO 8601 timestamp.
 */
function logError(message: string): void {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] [ERROR] [router] ${message}`);
}

/**
 * Log an info message to stderr with ISO 8601 timestamp.
 */
function logInfo(message: string): void {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] [INFO] [router] ${message}`);
}


/**
 * Create a JSON-RPC error response.
 *
 * @param id - Request ID (null for notifications or unknown)
 * @param code - Error code
 * @param message - Error message
 * @param data - Optional additional error data
 * @returns Error response object
 */
export function createErrorResponse(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): ErrorResponse {
  const response: ErrorResponse = {
    jsonrpc: '2.0',
    id,
    error: { code, message },
  };

  if (data !== undefined) {
    response.error.data = data;
  }

  return response;
}

/**
 * Extract the agentId field from a message.
 *
 * @param message - The message object to extract from
 * @returns The agentId string or undefined if not present
 */
export function extractAgentId(message: object): string | undefined {
  const msg = message as Record<string, unknown>;
  const agentId = msg.agentId;

  if (typeof agentId === 'string' && agentId.length > 0) {
    return agentId;
  }

  return undefined;
}

/**
 * Extract the JSON-RPC id field from a message.
 *
 * @param message - The message object to extract from
 * @returns The id (string, number, or null)
 */
export function extractId(message: object): string | number | null {
  const msg = message as Record<string, unknown>;
  const id = msg.id;

  if (typeof id === 'string' || typeof id === 'number') {
    return id;
  }

  return null;
}

/**
 * Transform a message for forwarding to an agent.
 *
 * Removes the agentId field while preserving all other fields.
 *
 * @param message - The original message
 * @returns A new message object without the agentId field
 */
export function transformMessage(message: object): object {
  const { agentId: _, ...rest } = message as Record<string, unknown>;
  return rest;
}


/**
 * Message Router implementation.
 *
 * Routes incoming JSON-RPC messages to the appropriate agent based on agentId.
 * Handles message transformation, error generation, and request correlation.
 */
export class MessageRouter {
  /** Registry index for agent lookup and resolution */
  private readonly registry: IRegistryIndex;

  /** Runtime manager for agent process lifecycle */
  private readonly runtimeManager: AgentRuntimeManager;

  /** Callback for writing responses to stdout */
  private readonly writeCallback: WriteCallback;

  /** API keys for agent authentication */
  private readonly apiKeys: Record<string, any>;

  /** Map of request ID to pending request info for correlation */
  private readonly pendingRequests: Map<string | number, PendingRequest> = new Map();

  /** Map of agent ID to authentication state */
  private readonly authState: Map<string, 'none' | 'pending' | 'authenticated'> = new Map();

  /** Map of agent sessionId to client sessionId for notification routing */
  private readonly sessionIdMap: Map<string, string> = new Map();

  /**
   * Create a new MessageRouter.
   *
   * @param registry - Registry index for agent lookup
   * @param runtimeManager - Runtime manager for agent processes
   * @param writeCallback - Callback for writing responses to stdout
   * @param apiKeys - API keys for agent authentication (optional)
   */
  constructor(
    registry: IRegistryIndex,
    runtimeManager: AgentRuntimeManager,
    writeCallback: WriteCallback,
    apiKeys: Record<string, any> = {},
  ) {
    this.registry = registry;
    this.runtimeManager = runtimeManager;
    this.writeCallback = writeCallback;
    this.apiKeys = apiKeys;
  }

  /**
   * Inject mcpServers from registry into session/new request params.
   *
   * If the agent has mcpServers configured in the registry, they are merged
   * with any mcpServers already present in the request params.
   * Registry servers are added first, then request servers (request takes precedence for duplicates).
   *
   * @param message - The transformed message (without agentId)
   * @param agentId - The agent ID to look up in registry
   * @returns Message with mcpServers injected into params
   */
  private injectMcpServers(message: object, agentId: string): object {
    const agent = this.registry.lookup(agentId);
    if (!agent?.mcpServers || agent.mcpServers.length === 0) {
      return message;
    }

    const msg = message as Record<string, unknown>;
    const params = (msg.params as Record<string, unknown>) || {};
    const existingServers = Array.isArray(params.mcpServers) ? params.mcpServers : [];

    // Convert registry McpServerConfig to ACP McpServer format
    const registryServers = agent.mcpServers.map((server) => ({
      name: server.name,
      command: server.command,
      args: server.args,
      env: server.env ? Object.entries(server.env).map(([name, value]) => ({ name, value })) : undefined,
    }));

    // Merge: registry servers first, then existing (existing can override by name)
    const existingNames = new Set(
      existingServers
        .filter((s): s is Record<string, unknown> => s !== null && typeof s === 'object')
        .map((s) => s.name)
        .filter((n): n is string => typeof n === 'string'),
    );

    const mergedServers = [
      ...registryServers.filter((s) => !existingNames.has(s.name)),
      ...existingServers,
    ];

    logInfo(`Injecting ${registryServers.length} MCP servers from registry for agent ${agentId}`);

    return {
      ...msg,
      params: {
        ...params,
        mcpServers: mergedServers,
      },
    };
  }

  /**
   * Route an incoming message to the appropriate agent.
   *
   * Extracts agentId, resolves spawn command, and forwards message.
   *
   * @param message - The incoming JSON-RPC message
   * @returns Error response if routing fails, undefined on success
   */
  async route(message: object): Promise<ErrorResponse | undefined> {
    const id = extractId(message);
    const agentId = extractAgentId(message);

    // Return error if agentId is missing
    if (agentId === undefined) {
      logError('Missing agentId in request');
      return createErrorResponse(id, RoutingErrorCodes.MISSING_AGENT_ID, 'Missing agentId');
    }

    // Resolve agent to spawn command
    let spawnCommand;
    try {
      spawnCommand = this.registry.resolve(agentId);
    } catch (error) {
      if (error instanceof AgentNotFoundError) {
        logError(`Agent not found: ${agentId}`);
        return createErrorResponse(id, RoutingErrorCodes.AGENT_NOT_FOUND, 'Agent not found', {
          agentId,
        });
      }
      if (error instanceof PlatformNotSupportedError) {
        logError(`Platform not supported for agent: ${agentId}`);
        return createErrorResponse(
          id,
          RoutingErrorCodes.PLATFORM_NOT_SUPPORTED,
          'Platform not supported',
          { agentId, platform: (error as PlatformNotSupportedError).platform },
        );
      }
      throw error;
    }

    // Get or spawn agent runtime
    let runtime: AgentRuntime;
    try {
      runtime = await this.runtimeManager.getOrSpawn(agentId, spawnCommand);
    } catch (error) {
      logError(`Failed to spawn agent ${agentId}: ${(error as Error).message}`);
      return createErrorResponse(id, RoutingErrorCodes.SPAWN_FAILED, 'Agent spawn failed', {
        agentId,
        error: (error as Error).message,
      });
    }

    // Track pending request for correlation
    if (id !== null) {
      const msg = message as Record<string, unknown>;
      const clientSessionId = typeof msg.sessionId === 'string' ? msg.sessionId : undefined;

      this.pendingRequests.set(id, {
        id,
        agentId,
        timestamp: Date.now(),
        clientSessionId,
      } as any);
    }

    // Transform message (remove agentId) and forward to agent
    let transformedMessage = transformMessage(message);

    // For session/new requests, inject mcpServers from registry if agent has them configured
    const msg = message as Record<string, unknown>;
    if (msg.method === 'session/new') {
      transformedMessage = this.injectMcpServers(transformedMessage, agentId);
    }

    const success = runtime.write(transformedMessage);

    if (!success) {
      logError(`Failed to write to agent ${agentId}`);
      // Remove from pending if write failed
      if (id !== null) {
        this.pendingRequests.delete(id);
      }
    } else {
      logInfo(`Routed message to agent ${agentId}`);
    }

    return undefined;
  }

  /**
   * Handle a response from an agent process.
   *
   * Intercepts initialize responses to trigger automatic authentication.
   * Handles agent-to-client requests (like session/request_permission) by
   * auto-responding when they cannot be forwarded to the client.
   * Tracks sessionId mapping for proper notification routing.
   * Forwards all responses to stdout.
   *
   * @param agentId - The agent that sent the response
   * @param response - The response object from the agent
   */
  handleAgentResponse(agentId: string, response: object): void {
    const id = extractId(response);
    const msg = response as Record<string, unknown>;
    const method = typeof msg.method === 'string' ? msg.method : undefined;

    // Handle agent-to-client requests (messages with both id and method).
    // These are requests FROM the agent TO the client (e.g., session/request_permission).
    // Since we are a headless launcher we cannot forward them to a human,
    // so we auto-respond to keep the agent unblocked.
    if (id !== null && method) {
      this.handleAgentRequest(agentId, id, method, msg);
      return;
    }

    // Check if this is a response to a tracked request (has id, no method)
    if (id !== null) {
      const pending = this.pendingRequests.get(id);
      if (pending && pending.agentId === agentId) {
        const result = msg.result as Record<string, unknown> | undefined;

        // Check if this is an initialize response with authMethods
        if (result && Array.isArray(result.authMethods) && result.authMethods.length > 0) {
          logInfo(`Agent ${agentId} requires authentication, attempting auto-auth`);
          this.authState.set(agentId, 'pending');
          void this.attemptAuthentication(agentId, result.authMethods as Array<{ id: string }>);
        }

        // Check if this is a session/new response - track sessionId mapping
        // session/new responses have sessionId in result, not in params
        if (result && typeof result.sessionId === 'string') {
          const agentSessionId = result.sessionId;
          const clientSessionId = (pending as any).clientSessionId;
          if (clientSessionId) {
            this.sessionIdMap.set(agentSessionId, clientSessionId);
            logInfo(`Mapped agent sessionId ${agentSessionId} to client sessionId ${clientSessionId}`);
          }
        }

        this.pendingRequests.delete(id);
      }
    }

    // Handle notifications (no id) - map sessionId from agent to client
    if (id === null && method) {
      logInfo(`Received notification: ${method}`);
      const params = msg.params as Record<string, unknown> | undefined;
      if (params && typeof params.sessionId === 'string') {
        const agentSessionId = params.sessionId;
        const clientSessionId = this.sessionIdMap.get(agentSessionId);

        if (clientSessionId) {
          // Replace agent sessionId with client sessionId for stdio Bus routing
          const enriched = {
            ...msg,
            sessionId: clientSessionId,
            params: {
              ...params,
              sessionId: agentSessionId,  // Keep original in params for agent context
            },
          };
          logInfo(`Forwarding notification with mapped sessionId: ${clientSessionId}`);
          this.writeCallback(enriched);
          return;
        } else {
          // CRITICAL FIX: If no mapping exists, use default sessionId for routing
          // Cannot forward with unmapped agentSessionId as stdio_bus won't recognize it
          logError(`Notification with unmapped agentSessionId: ${agentSessionId}, using default sessionId`);
          const enriched = {
            ...msg,
            sessionId: 'global-notifications',
            params: {
              ...params,
              sessionId: agentSessionId,  // Keep original in params for context
            },
          };
          this.writeCallback(enriched);
          return;
        }
      } else {
        // CRITICAL FIX: Handle notifications without sessionId in params
        // Check if sessionId is at top level or if this is a global notification
        const topLevelSessionId = msg.sessionId as string | undefined;
        if (topLevelSessionId) {
          // sessionId already at top level, forward as-is
          this.writeCallback(response);
          return;
        } else {
          // Global notification without sessionId - add a default sessionId for routing
          logError(`Notification without sessionId: ${method}, adding default sessionId for routing`);
          const enriched = {
            ...msg,
            sessionId: 'global-notifications', // Default sessionId for stdio_bus routing
          };
          this.writeCallback(enriched);
          return;
        }
      }
    }

    // Forward response unchanged
    this.writeCallback(response);
  }

  /**
   * Handle a request from an agent to the client.
   *
   * Agent-to-client requests (JSON-RPC messages with both `id` and `method`)
   * require a response. Since the Registry Launcher is headless and cannot
   * forward these to a human, we auto-respond to keep the agent unblocked.
   *
   * Known methods:
   * - session/request_permission: Auto-approve with the first "allow" option
   *
   * Unknown methods get a generic success response so the agent continues.
   *
   * @param agentId - The agent that sent the request
   * @param id - The JSON-RPC request id
   * @param method - The JSON-RPC method name
   * @param msg - The full message object
   */
  private handleAgentRequest(
    agentId: string,
    id: string | number,
    method: string,
    msg: Record<string, unknown>,
  ): void {
    logInfo(`Agent ${agentId} sent request: ${method} (id=${id}), auto-responding`);

    let result: Record<string, unknown>;

    if (method === 'session/request_permission') {
      result = this.buildPermissionResponse(msg);
    } else {
      // Fallback: generic success so the agent is never stuck waiting
      logInfo(`Unknown agent request method: ${method}, sending generic success`);
      result = {};
    }

    const response = {
      jsonrpc: '2.0' as const,
      id,
      result,
    };

    // Send directly to the agent, not to stdout
    this.sendToAgent(agentId, response);
  }

  /**
   * Build an auto-approve result for session/request_permission.
   *
   * Picks the first "allow" option from the request, preferring
   * allow_always > allow_once > first option as fallback.
   *
   * @param msg - The request_permission message
   * @returns The result object for the response
   */
  private buildPermissionResponse(msg: Record<string, unknown>): Record<string, unknown> {
    const params = msg.params as Record<string, unknown> | undefined;
    const options = params?.options as Array<Record<string, unknown>> | undefined;

    if (!options || options.length === 0) {
      return { optionId: 'approved' };
    }

    // Prefer allow_always, then allow_once, then first option
    const allowAlways = options.find(o => o.kind === 'allow_always');
    if (allowAlways && typeof allowAlways.optionId === 'string') {
      logInfo(`Auto-approving permission with option: ${allowAlways.optionId} (allow_always)`);
      return { optionId: allowAlways.optionId };
    }

    const allowOnce = options.find(o => o.kind === 'allow_once');
    if (allowOnce && typeof allowOnce.optionId === 'string') {
      logInfo(`Auto-approving permission with option: ${allowOnce.optionId} (allow_once)`);
      return { optionId: allowOnce.optionId };
    }

    // Fallback to first option
    const firstOption = options[0];
    const optionId = typeof firstOption.optionId === 'string' ? firstOption.optionId : 'approved';
    logInfo(`Auto-approving permission with fallback option: ${optionId}`);
    return { optionId };
  }

  /**
   * Send a JSON-RPC message directly to an agent process.
   *
   * @param agentId - The agent to send to
   * @param message - The message to send
   */
  private sendToAgent(agentId: string, message: object): void {
    let runtime: AgentRuntime | undefined;
    try {
      runtime = this.runtimeManager.get(agentId);
    } catch {
      logError(`Failed to get runtime for agent ${agentId} to send response`);
      return;
    }

    if (!runtime) {
      logError(`No runtime found for agent ${agentId}, cannot send response`);
      return;
    }

    const success = runtime.write(message);
    if (!success) {
      logError(`Failed to write response to agent ${agentId}`);
    } else {
      logInfo(`Sent auto-response to agent ${agentId}`);
    }
  }

  /**
   * Attempt automatic authentication for an agent.
   *
   * Selects the best authentication method and sends authenticate request.
   *
   * @param agentId - The agent to authenticate
   * @param authMethods - Available authentication methods from initialize response
   */
  private async attemptAuthentication(
    agentId: string,
    authMethods: Array<{ id: string }>,
  ): Promise<void> {
    // Get API key for this agent
    const apiKey = getAgentApiKey(this.apiKeys, agentId);

    if (!apiKey) {
      logError(`No API key found for agent ${agentId}, authentication will fail`);
      this.authState.set(agentId, 'none');
      return;
    }

    // Select authentication method (prefer openai-api-key, then any api-key method)
    let selectedMethod = authMethods.find(m => m.id === 'openai-api-key');
    if (!selectedMethod) {
      selectedMethod = authMethods.find(m => m.id.includes('api-key') || m.id.includes('apikey'));
    }
    if (!selectedMethod) {
      selectedMethod = authMethods[0];
    }

    logInfo(`Authenticating agent ${agentId} with method: ${selectedMethod.id}`);

    // Get agent runtime
    let runtime: AgentRuntime;
    try {
      const spawnCommand = this.registry.resolve(agentId);
      runtime = await this.runtimeManager.getOrSpawn(agentId, spawnCommand);
    } catch (error) {
      logError(`Failed to get runtime for authentication: ${(error as Error).message}`);
      this.authState.set(agentId, 'none');
      return;
    }

    // Build authenticate request
    const authRequest = {
      jsonrpc: '2.0',
      id: `auth-${agentId}-${Date.now()}`,
      method: 'authenticate',
      params: {
        methodId: selectedMethod.id,
        credentials: {
          apiKey: apiKey,
        },
      },
    };

    // Send authenticate request to agent
    const transformed = transformMessage(authRequest);
    const serialized = JSON.stringify(transformed) + '\n';

    if (runtime.process.stdin) {
      runtime.process.stdin.write(serialized, (error) => {
        if (error) {
          logError(`Failed to send authenticate request to ${agentId}: ${error.message}`);
          this.authState.set(agentId, 'none');
        } else {
          logInfo(`Sent authenticate request to agent ${agentId}`);
          // Mark as authenticated (optimistic)
          this.authState.set(agentId, 'authenticated');
        }
      });
    }
  }

  /**
   * Get the number of pending requests.
   *
   * @returns The count of pending requests
   */
  get pendingCount(): number {
    return this.pendingRequests.size;
  }

  /**
   * Check if a request ID is pending.
   *
   * @param id - The request ID to check
   * @returns true if the request is pending, false otherwise
   */
  isPending(id: string | number): boolean {
    return this.pendingRequests.has(id);
  }

  /**
   * Clear all pending requests.
   * Useful for cleanup during shutdown.
   */
  clearPending(): void {
    this.pendingRequests.clear();
  }
}
