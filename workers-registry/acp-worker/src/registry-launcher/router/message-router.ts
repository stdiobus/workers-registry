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
 * Integrates with AuthManager for OAuth authentication (Requirements 11.2, 11.4).
 *
 * @module router/message-router
 */

import type { IRegistryIndex } from '../registry/index.js';
import { AgentNotFoundError, PlatformNotSupportedError } from '../registry/index.js';
import type { AgentRuntimeManager } from '../runtime/manager.js';
import type { AgentRuntime } from '../runtime/types.js';
import { getAgentApiKey } from '../config/api-keys.js';
import type { AuthManager } from '../auth/auth-manager.js';
import type { AcpAuthMethod, AuthProviderId } from '../auth/types.js';
import { isValidProviderId } from '../auth/types.js';

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
  /** Authentication required (Requirement 11.2) */
  AUTH_REQUIRED: -32004,
} as const;

// =============================================================================
// Auth Method Parsing Types and Constants (Task 21.1)
// =============================================================================

/**
 * Valid auth method types from agent responses.
 * - 'oauth2': Standard OAuth 2.1 flow
 * - 'agent': Legacy alias for OAuth 2.1 (normalized to 'oauth2')
 * - 'api-key': API key authentication
 */
export type AuthMethodType = 'oauth2' | 'agent' | 'api-key';

/**
 * Parsed auth method with validated fields.
 * Discriminated union for type-safe handling.
 */
export type ParsedAuthMethod =
  | { kind: 'oauth2'; id: string; providerId: AuthProviderId }
  | { kind: 'api-key'; id: string; providerId?: AuthProviderId };

/**
 * Explicit mapping from auth method IDs to provider IDs.
 * Security: Uses explicit allowlist mapping, no substring heuristics.
 *
 * Requirement 3.1: Support OAuth authentication with type "agent" or "oauth2"
 * Requirement 11.2: Map authMethod.id to AuthProviderId
 */
export const AUTH_METHOD_ID_TO_PROVIDER: Readonly<Record<string, AuthProviderId>> = {
  // OAuth2 method IDs
  'oauth2-openai': 'openai',
  'oauth2-github': 'github',
  'oauth2-google': 'google',
  'oauth2-cognito': 'cognito',
  'oauth2-azure': 'azure',
  'oauth2-anthropic': 'anthropic',
  // Agent auth method IDs (legacy format)
  'agent-openai': 'openai',
  'agent-github': 'github',
  'agent-google': 'google',
  'agent-cognito': 'cognito',
  'agent-azure': 'azure',
  'agent-anthropic': 'anthropic',
  // API key method IDs
  'openai-api-key': 'openai',
  'anthropic-api-key': 'anthropic',
  'github-api-key': 'github',
  'google-api-key': 'google',
  'azure-api-key': 'azure',
  'cognito-api-key': 'cognito',
} as const;

/**
 * Maximum number of auth methods to process (DoS protection).
 */
const MAX_AUTH_METHODS = 50;

/**
 * Maximum length for auth method ID strings.
 */
const MAX_METHOD_ID_LENGTH = 128;

/**
 * Valid auth method types allowlist.
 */
const VALID_AUTH_METHOD_TYPES: readonly string[] = ['oauth2', 'agent', 'api-key'];

/**
 * Parse and validate auth methods from agent initialize response.
 *
 * Extracts type and providerId from each auth method, using explicit mapping
 * for id-to-provider resolution. Validates all fields and rejects invalid methods.
 *
 * Security considerations:
 * - Uses explicit allowlist for method types
 * - Uses explicit mapping for id-to-provider (no substring heuristics)
 * - Validates providerId against known providers
 * - Limits number of methods processed (DoS protection)
 * - Deduplicates by method ID
 *
 * Requirement 3.1: Identify methods with type "oauth2" or "agent"
 * Requirement 11.2: Map authMethod.id to AuthProviderId using explicit mapping
 *
 * @param raw - Raw auth methods array from agent response (untrusted input)
 * @returns Array of validated and parsed auth methods
 */
export function parseAuthMethods(raw: unknown): ParsedAuthMethod[] {
  // Validate input is an array
  if (!Array.isArray(raw)) {
    logError('authMethods is not an array, skipping parsing');
    return [];
  }

  // Limit number of methods (DoS protection)
  const methods = raw.slice(0, MAX_AUTH_METHODS);
  const parsed: ParsedAuthMethod[] = [];
  const seenIds = new Set<string>();

  for (const method of methods) {
    const result = parseAuthMethod(method, seenIds);
    if (result) {
      parsed.push(result);
      seenIds.add(result.id);
    }
  }

  logInfo(`Parsed ${parsed.length} valid auth methods from ${methods.length} raw methods`);
  return parsed;
}

/**
 * Parse a single auth method entry.
 *
 * @param method - Raw method object from agent response
 * @param seenIds - Set of already processed method IDs (for deduplication)
 * @returns Parsed auth method or null if invalid
 */
function parseAuthMethod(method: unknown, seenIds: Set<string>): ParsedAuthMethod | null {
  // Validate method is an object
  if (method === null || typeof method !== 'object') {
    return null;
  }

  const obj = method as Record<string, unknown>;

  // Extract and validate id
  const id = obj.id;
  if (typeof id !== 'string' || id.length === 0 || id.length > MAX_METHOD_ID_LENGTH) {
    logError(`Invalid auth method id: ${typeof id === 'string' ? id.substring(0, 50) : typeof id}`);
    return null;
  }

  // Deduplicate by id
  if (seenIds.has(id)) {
    logInfo(`Skipping duplicate auth method id: ${id}`);
    return null;
  }

  // Extract and validate type
  const type = obj.type;
  if (typeof type !== 'string' || !VALID_AUTH_METHOD_TYPES.includes(type)) {
    logError(`Invalid auth method type for id ${id}: ${type}`);
    return null;
  }

  // Extract providerId from method object (if present)
  const rawProviderId = obj.providerId;
  let providerId: AuthProviderId | undefined;

  // Validate providerId if present in the method object
  if (rawProviderId !== undefined) {
    if (isValidProviderId(rawProviderId)) {
      providerId = rawProviderId;
    } else {
      logError(`Invalid providerId in auth method ${id}: ${rawProviderId}`);
      // Don't reject the method, try to resolve from id mapping
    }
  }

  // Resolve providerId from explicit id mapping
  const mappedProviderId = AUTH_METHOD_ID_TO_PROVIDER[id];

  // Check for conflicts between mapped and explicit providerId
  if (providerId && mappedProviderId && providerId !== mappedProviderId) {
    logError(`Conflict: auth method ${id} has providerId ${providerId} but maps to ${mappedProviderId}, rejecting`);
    return null;
  }

  // Use mapped providerId if explicit one not available
  const resolvedProviderId = providerId ?? mappedProviderId;

  // Build parsed method based on type
  if (type === 'oauth2' || type === 'agent') {
    // OAuth methods require a valid providerId
    if (!resolvedProviderId) {
      logError(`OAuth auth method ${id} has no valid providerId, skipping`);
      return null;
    }
    return {
      kind: 'oauth2',  // Normalize 'agent' to 'oauth2'
      id,
      providerId: resolvedProviderId,
    };
  }

  if (type === 'api-key') {
    return {
      kind: 'api-key',
      id,
      providerId: resolvedProviderId,  // Optional for api-key
    };
  }

  // Should not reach here due to type validation above
  return null;
}

/**
 * Filter parsed auth methods to get only OAuth methods.
 *
 * Requirement 3.1: Identify methods with type "oauth2" or "agent"
 *
 * @param methods - Parsed auth methods
 * @returns Only OAuth methods (kind: 'oauth2')
 */
export function getOAuthMethods(methods: ParsedAuthMethod[]): Array<ParsedAuthMethod & { kind: 'oauth2' }> {
  return methods.filter((m): m is ParsedAuthMethod & { kind: 'oauth2' } => m.kind === 'oauth2');
}

/**
 * Filter parsed auth methods to get only API key methods.
 *
 * @param methods - Parsed auth methods
 * @returns Only API key methods (kind: 'api-key')
 */
export function getApiKeyMethods(methods: ParsedAuthMethod[]): Array<ParsedAuthMethod & { kind: 'api-key' }> {
  return methods.filter((m): m is ParsedAuthMethod & { kind: 'api-key' } => m.kind === 'api-key');
}

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
  /** The JSON-RPC method name (for response correlation) */
  method?: string;
  /** Client session ID for session mapping */
  clientSessionId?: string;
}

// =============================================================================
// Auth State Machine Types (Task 21.3)
// =============================================================================

/**
 * Authentication state for an agent.
 *
 * State transitions:
 * - none → pending: OAuth flow initiated
 * - pending → authenticated: OAuth flow succeeded
 * - pending → failed: OAuth flow failed or timed out
 * - failed → pending: Retry OAuth flow
 * - authenticated → none: Logout or token invalidation
 *
 * Requirement 3.1: Track auth state during OAuth 2.1 Authorization Code flow
 * Requirement 3.5: Handle timeout transitions to failed state
 */
export type AuthState = 'none' | 'pending' | 'authenticated' | 'failed';

/**
 * Queued request structure for requests waiting on OAuth authentication.
 *
 * When an OAuth flow is pending for an agent, incoming requests are queued
 * and resumed after successful authentication.
 *
 * Requirement 3.1: Queue requests while OAuth flow is in progress
 */
export interface QueuedRequest {
  /** The original message to be routed */
  message: object;
  /** Timestamp when the request was queued */
  queuedAt: number;
  /** Resolve function to signal completion */
  resolve: (result: ErrorResponse | undefined) => void;
}

/**
 * Default timeout for queued requests in milliseconds (5 minutes).
 * Matches the OAuth flow timeout from Requirement 3.5.
 */
const QUEUED_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

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
 * Integrates with AuthManager for OAuth authentication (Requirements 11.2, 11.4).
 * Implements auth state machine for pending OAuth flows (Task 21.3).
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

  /** Optional AuthManager for OAuth authentication (Requirements 11.2, 11.4) */
  private readonly authManager?: AuthManager;

  /** Map of request ID to pending request info for correlation */
  private readonly pendingRequests: Map<string | number, PendingRequest> = new Map();

  /**
   * Map of agent ID to authentication state.
   *
   * State machine (Task 21.3):
   * - none: No authentication in progress
   * - pending: OAuth flow in progress, requests are queued
   * - authenticated: OAuth flow completed successfully
   * - failed: OAuth flow failed or timed out
   *
   * Requirement 3.1: Track auth state during OAuth 2.1 Authorization Code flow
   */
  private readonly authState: Map<string, AuthState> = new Map();

  /**
   * Map of agent ID to required OAuth provider ID.
   *
   * Tracks which agents require OAuth authentication and with which provider.
   * This is populated when we receive an initialize response with authMethods
   * containing OAuth methods.
   *
   * Requirement 11.2: Track auth requirements to block requests when OAuth
   * is required but credentials are not available.
   */
  private readonly agentOAuthRequirements: Map<string, AuthProviderId> = new Map();

  /**
   * Map of agent ID to queued requests waiting for OAuth authentication.
   *
   * When an OAuth flow is pending for an agent, incoming requests are queued
   * here and processed after successful authentication.
   *
   * Requirement 3.1: Queue incoming requests while OAuth flow is pending
   */
  private readonly requestQueue: Map<string, QueuedRequest[]> = new Map();

  /** Map of agent sessionId to client sessionId for notification routing */
  private readonly sessionIdMap: Map<string, string> = new Map();

  /**
   * Create a new MessageRouter.
   *
   * @param registry - Registry index for agent lookup
   * @param runtimeManager - Runtime manager for agent processes
   * @param writeCallback - Callback for writing responses to stdout
   * @param apiKeys - API keys for agent authentication (optional)
   * @param authManager - AuthManager for OAuth authentication (optional, Requirements 11.2, 11.4)
   */
  constructor(
    registry: IRegistryIndex,
    runtimeManager: AgentRuntimeManager,
    writeCallback: WriteCallback,
    apiKeys: Record<string, any> = {},
    authManager?: AuthManager,
  ) {
    this.registry = registry;
    this.runtimeManager = runtimeManager;
    this.writeCallback = writeCallback;
    this.apiKeys = apiKeys;
    this.authManager = authManager;
  }

  /**
   * Get supported authentication methods for ACP initialize response.
   *
   * Requirement 11.1: WHEN responding to an initialize request, THE Registry_Launcher
   * SHALL include an `authMethods` array listing supported authentication methods.
   *
   * @returns Array of supported authentication methods
   */
  getSupportedAuthMethods(): AcpAuthMethod[] {
    const methods: AcpAuthMethod[] = [
      // Legacy API key authentication
      { id: 'api-key', type: 'api-key' },
      { id: 'openai-api-key', type: 'api-key', providerId: 'openai' },
      { id: 'anthropic-api-key', type: 'api-key', providerId: 'anthropic' },
    ];

    // Add OAuth methods if AuthManager is available
    if (this.authManager) {
      methods.push(
        { id: 'oauth2-openai', type: 'oauth2', providerId: 'openai' },
        { id: 'oauth2-github', type: 'oauth2', providerId: 'github' },
        { id: 'oauth2-google', type: 'oauth2', providerId: 'google' },
        { id: 'oauth2-cognito', type: 'oauth2', providerId: 'cognito' },
        { id: 'oauth2-azure', type: 'oauth2', providerId: 'azure' },
        { id: 'oauth2-anthropic', type: 'oauth2', providerId: 'anthropic' },
      );
    }

    return methods;
  }

  /**
   * Check if authentication is available for an agent.
   *
   * Requirement 11.2: WHEN an agent requires authentication and credentials are not available,
   * THE Registry_Launcher SHALL return an AUTH_REQUIRED error response.
   *
   * @param agentId - The agent identifier
   * @returns True if authentication is available (OAuth or legacy API key)
   */
  async hasAuthenticationForAgent(agentId: string): Promise<boolean> {
    // Check OAuth credentials first (Requirement 10.3)
    if (this.authManager) {
      const token = await this.authManager.getTokenForAgent(agentId);
      if (token) {
        return true;
      }
    }

    // Fall back to legacy API key
    const apiKey = getAgentApiKey(this.apiKeys, agentId);
    return apiKey !== undefined;
  }

  /**
   * Create an AUTH_REQUIRED error response.
   *
   * Requirement 11.2: WHEN an agent requires authentication and credentials are not available,
   * THE Registry_Launcher SHALL return an AUTH_REQUIRED error response with the required
   * authentication method specified.
   *
   * @param id - The request ID
   * @param agentId - The agent identifier
   * @param requiredMethod - The required authentication method
   * @returns AUTH_REQUIRED error response
   */
  createAuthRequiredError(
    id: string | number | null,
    agentId: string,
    requiredMethod?: string
  ): ErrorResponse {
    return createErrorResponse(
      id,
      RoutingErrorCodes.AUTH_REQUIRED,
      'Authentication required',
      {
        agentId,
        requiredMethod: requiredMethod ?? 'api-key',
        supportedMethods: this.getSupportedAuthMethods().map(m => m.id),
      }
    );
  }

  /**
   * Inject authentication into a request using AuthManager.
   *
   * Requirement 11.4: WHEN authentication is successful, THE Auth_Module SHALL inject
   * the access token into agent requests according to the provider's token injection method.
   *
   * @param agentId - The agent identifier
   * @param message - The message to inject auth into
   * @returns The message with authentication injected
   */
  async injectAuthentication(agentId: string, message: object): Promise<object> {
    if (this.authManager) {
      return this.authManager.injectAuth(agentId, message);
    }
    return message;
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
   * If OAuth authentication is pending for the agent, queues the request
   * and resumes it after successful authentication (Task 21.3).
   *
   * Requirement 3.1: Queue incoming requests while OAuth flow is pending
   * Requirement 11.2: Block requests when OAuth required but not authenticated
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

    // Check auth state for this agent (Task 21.3)
    const currentAuthState = this.getAuthState(agentId);

    // If OAuth flow is pending, queue the request (Requirement 3.1)
    if (currentAuthState === 'pending') {
      logInfo(`OAuth flow pending for agent ${agentId}, queueing request (id=${id})`);
      return this.queueRequest(agentId, message);
    }

    // If auth previously failed, return AUTH_REQUIRED error
    // This allows the client to retry or handle the failure
    if (currentAuthState === 'failed') {
      logError(`Authentication failed for agent ${agentId}, returning AUTH_REQUIRED`);
      const requiredProviderId = this.agentOAuthRequirements.get(agentId);
      return this.createAuthRequiredErrorWithProvider(id, agentId, requiredProviderId);
    }

    // Task 23.1: Block requests when OAuth required but not authenticated
    // Requirement 11.2: WHEN an agent requires authentication and credentials
    // are not available, THE Registry_Launcher SHALL return an AUTH_REQUIRED error
    const requiredProviderId = this.agentOAuthRequirements.get(agentId);
    if (requiredProviderId && currentAuthState !== 'authenticated') {
      // Agent requires OAuth - check if credentials are available
      const hasCredentials = await this.hasOAuthCredentialsForAgent(agentId, requiredProviderId);
      if (!hasCredentials) {
        logError(`Agent ${agentId} requires OAuth (provider: ${requiredProviderId}) but credentials not available`);
        return this.createAuthRequiredErrorWithProvider(id, agentId, requiredProviderId);
      }
    }

    // Proceed with normal routing
    return this.routeInternal(message, agentId, id);
  }

  /**
   * Check if OAuth credentials are available for an agent.
   *
   * Requirement 11.2: Check if credentials are available before routing.
   *
   * @param agentId - The agent identifier
   * @param providerId - The OAuth provider ID
   * @returns True if OAuth credentials are available
   */
  private async hasOAuthCredentialsForAgent(agentId: string, providerId: AuthProviderId): Promise<boolean> {
    if (!this.authManager) {
      return false;
    }

    // Check if we have a valid token for this agent/provider
    const token = await this.authManager.getTokenForAgent(agentId, providerId);
    return token !== null && token !== undefined;
  }

  /**
   * Create an AUTH_REQUIRED error response with provider information.
   *
   * Requirement 11.2: WHEN an agent requires authentication and credentials are not available,
   * THE Registry_Launcher SHALL return an AUTH_REQUIRED error response with the required
   * authentication method specified.
   *
   * @param id - The request ID
   * @param agentId - The agent identifier
   * @param providerId - The required OAuth provider ID (optional)
   * @returns AUTH_REQUIRED error response with requiredMethod, supportedMethods, providerId
   */
  private createAuthRequiredErrorWithProvider(
    id: string | number | null,
    agentId: string,
    providerId?: AuthProviderId
  ): ErrorResponse {
    const supportedMethods = this.getSupportedAuthMethods();

    return createErrorResponse(
      id,
      RoutingErrorCodes.AUTH_REQUIRED,
      'Authentication required',
      {
        agentId,
        requiredMethod: providerId ? `oauth2-${providerId}` : 'oauth2',
        supportedMethods: supportedMethods.map(m => m.id),
        providerId: providerId,
      }
    );
  }

  /**
   * Internal routing logic after auth state checks.
   *
   * @param message - The incoming JSON-RPC message
   * @param agentId - The agent identifier
   * @param id - The request ID
   * @returns Error response if routing fails, undefined on success
   */
  private async routeInternal(
    message: object,
    agentId: string,
    id: string | number | null,
  ): Promise<ErrorResponse | undefined> {
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
      const method = typeof msg.method === 'string' ? msg.method : undefined;

      this.pendingRequests.set(id, {
        id,
        agentId,
        timestamp: Date.now(),
        method,
        clientSessionId,
      });
    }

    // Transform message (remove agentId) and forward to agent
    let transformedMessage = transformMessage(message);

    // For session/new requests, inject mcpServers from registry if agent has them configured
    const msg = message as Record<string, unknown>;
    if (msg.method === 'session/new') {
      transformedMessage = this.injectMcpServers(transformedMessage, agentId);
    }

    // Inject authentication into the message (Requirement 11.4)
    // This adds OAuth tokens or legacy API keys to the request
    transformedMessage = await this.injectAuthentication(agentId, transformedMessage);

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

  // =============================================================================
  // Auth State Machine Methods (Task 21.3)
  // =============================================================================

  /**
   * Get the current authentication state for an agent.
   *
   * @param agentId - The agent identifier
   * @returns The current auth state (defaults to 'none')
   */
  getAuthState(agentId: string): AuthState {
    return this.authState.get(agentId) ?? 'none';
  }

  /**
   * Set the authentication state for an agent.
   *
   * Handles state transitions and triggers appropriate actions:
   * - none → pending: OAuth flow started
   * - pending → authenticated: Resume queued requests
   * - pending → failed: Reject queued requests with AUTH_REQUIRED
   *
   * Requirement 3.1: Track auth state during OAuth flow
   * Requirement 3.5: Handle timeout transitions to failed state
   *
   * @param agentId - The agent identifier
   * @param newState - The new auth state
   */
  setAuthState(agentId: string, newState: AuthState): void {
    const oldState = this.getAuthState(agentId);

    if (oldState === newState) {
      return; // No state change
    }

    logInfo(`Auth state transition for ${agentId}: ${oldState} → ${newState}`);
    this.authState.set(agentId, newState);

    // Handle state transition side effects
    if (newState === 'authenticated' && oldState === 'pending') {
      // Resume queued requests after successful authentication
      void this.processQueuedRequests(agentId);
    } else if (newState === 'failed' && oldState === 'pending') {
      // Reject queued requests with AUTH_REQUIRED error
      void this.rejectQueuedRequests(agentId);
    }
  }

  /**
   * Queue a request while OAuth authentication is pending.
   *
   * Returns a promise that resolves when the request is processed
   * (either routed successfully or rejected with an error).
   *
   * Requirement 3.1: Queue incoming requests while OAuth flow is pending
   *
   * @param agentId - The agent identifier
   * @param message - The message to queue
   * @returns Promise that resolves with the routing result
   */
  private queueRequest(agentId: string, message: object): Promise<ErrorResponse | undefined> {
    return new Promise((resolve) => {
      const queuedRequest: QueuedRequest = {
        message,
        queuedAt: Date.now(),
        resolve,
      };

      // Get or create queue for this agent
      let queue = this.requestQueue.get(agentId);
      if (!queue) {
        queue = [];
        this.requestQueue.set(agentId, queue);
      }

      queue.push(queuedRequest);
      logInfo(`Queued request for agent ${agentId}, queue size: ${queue.length}`);

      // Set up timeout for this request (Requirement 3.5)
      setTimeout(() => {
        this.handleQueuedRequestTimeout(agentId, queuedRequest);
      }, QUEUED_REQUEST_TIMEOUT_MS);
    });
  }

  /**
   * Handle timeout for a queued request.
   *
   * If the request is still in the queue when timeout fires,
   * remove it and resolve with a timeout error.
   *
   * Requirement 3.5: Handle timeout for queued requests
   *
   * @param agentId - The agent identifier
   * @param queuedRequest - The queued request that timed out
   */
  private handleQueuedRequestTimeout(agentId: string, queuedRequest: QueuedRequest): void {
    const queue = this.requestQueue.get(agentId);
    if (!queue) {
      return; // Queue already cleared
    }

    const index = queue.indexOf(queuedRequest);
    if (index === -1) {
      return; // Request already processed
    }

    // Remove from queue
    queue.splice(index, 1);
    logError(`Queued request timed out for agent ${agentId}`);

    // Resolve with timeout error
    const id = extractId(queuedRequest.message);
    queuedRequest.resolve(
      createErrorResponse(id, RoutingErrorCodes.AUTH_REQUIRED, 'Authentication timeout', {
        agentId,
        reason: 'OAuth flow timed out while request was queued',
      })
    );
  }

  /**
   * Process queued requests after successful OAuth authentication.
   *
   * Routes all queued requests for the agent now that authentication
   * is complete.
   *
   * Requirement 3.1: Resume queued requests after successful authentication
   *
   * @param agentId - The agent identifier
   */
  private async processQueuedRequests(agentId: string): Promise<void> {
    const queue = this.requestQueue.get(agentId);
    if (!queue || queue.length === 0) {
      return;
    }

    logInfo(`Processing ${queue.length} queued requests for agent ${agentId}`);

    // Clear the queue before processing to prevent re-queueing
    this.requestQueue.delete(agentId);

    // Process each queued request
    for (const queuedRequest of queue) {
      try {
        const id = extractId(queuedRequest.message);
        const result = await this.routeInternal(queuedRequest.message, agentId, id);
        queuedRequest.resolve(result);
      } catch (error) {
        const id = extractId(queuedRequest.message);
        logError(`Error processing queued request for ${agentId}: ${(error as Error).message}`);
        queuedRequest.resolve(
          createErrorResponse(id, RoutingErrorCodes.SPAWN_FAILED, 'Failed to process queued request', {
            agentId,
            error: (error as Error).message,
          })
        );
      }
    }

    logInfo(`Completed processing queued requests for agent ${agentId}`);
  }

  /**
   * Reject all queued requests after OAuth authentication failure.
   *
   * Returns AUTH_REQUIRED error for all queued requests.
   *
   * Requirement 3.5: Handle failed authentication for queued requests
   *
   * @param agentId - The agent identifier
   */
  private async rejectQueuedRequests(agentId: string): Promise<void> {
    const queue = this.requestQueue.get(agentId);
    if (!queue || queue.length === 0) {
      return;
    }

    logInfo(`Rejecting ${queue.length} queued requests for agent ${agentId} due to auth failure`);

    // Clear the queue
    this.requestQueue.delete(agentId);

    // Reject each queued request with AUTH_REQUIRED error
    for (const queuedRequest of queue) {
      const id = extractId(queuedRequest.message);
      queuedRequest.resolve(
        this.createAuthRequiredError(id, agentId, 'oauth2')
      );
    }
  }

  /**
   * Get the number of queued requests for an agent.
   *
   * @param agentId - The agent identifier
   * @returns The number of queued requests
   */
  getQueuedRequestCount(agentId: string): number {
    const queue = this.requestQueue.get(agentId);
    return queue?.length ?? 0;
  }

  /**
   * Get the total number of queued requests across all agents.
   *
   * @returns The total number of queued requests
   */
  getTotalQueuedRequestCount(): number {
    let total = 0;
    for (const queue of this.requestQueue.values()) {
      total += queue.length;
    }
    return total;
  }

  /**
   * Handle a response from an agent process.
   *
   * Intercepts initialize responses to trigger automatic authentication and
   * inject authMethods (Requirement 11.1).
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
    let msg = response as Record<string, unknown>;
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

        // Check if this is an initialize response - inject our authMethods (Requirement 11.1)
        // Use tracked method from pending request for reliable detection
        const isInitializeResponse = pending.method === 'initialize' && result !== undefined;
        if (isInitializeResponse) {
          const ourAuthMethods = this.getSupportedAuthMethods();
          const existingAuthMethods = Array.isArray(result.authMethods) ? result.authMethods : [];

          // Merge our auth methods with agent's auth methods (ours first)
          const mergedAuthMethods = [
            ...ourAuthMethods,
            ...existingAuthMethods.filter((m: any) =>
              !ourAuthMethods.some(our => our.id === m.id)
            ),
          ];

          // Create enriched response with authMethods
          msg = {
            ...msg,
            result: {
              ...result,
              authMethods: mergedAuthMethods,
            },
          };

          logInfo(`Injected ${ourAuthMethods.length} auth methods into initialize response for ${agentId}`);
        }

        // Check if this is an initialize response with authMethods (from agent)
        // Only trigger auto-auth on initialize responses to reduce attack surface
        if (isInitializeResponse && result && Array.isArray(result.authMethods) && result.authMethods.length > 0) {
          // Parse and validate auth methods using explicit mapping (Task 21.1)
          const parsedMethods = parseAuthMethods(result.authMethods);
          if (parsedMethods.length > 0) {
            // Task 23.1: Track OAuth requirements for this agent
            // Requirement 11.2: Cache auth requirements per agent
            const oauthMethods = getOAuthMethods(parsedMethods);
            if (oauthMethods.length > 0) {
              // Store the first OAuth provider as the required provider
              const requiredProviderId = oauthMethods[0].providerId;
              this.agentOAuthRequirements.set(agentId, requiredProviderId);
              logInfo(`Agent ${agentId} requires OAuth authentication with provider: ${requiredProviderId}`);
            }

            logInfo(`Agent ${agentId} requires authentication, attempting auto-auth with ${parsedMethods.length} valid methods`);
            this.setAuthState(agentId, 'pending');
            void this.attemptAuthentication(agentId, parsedMethods);
          } else {
            logError(`Agent ${agentId} has authMethods but none are valid after parsing`);
            this.setAuthState(agentId, 'none');
          }
        }

        // Check if this is a session/new response - track sessionId mapping
        // session/new responses have sessionId in result, not in params
        if (result && typeof result.sessionId === 'string') {
          const agentSessionId = result.sessionId;
          const clientSessionId = pending.clientSessionId;
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
    this.writeCallback(msg);
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
   * Selects the best authentication method and initiates authentication.
   * Uses parsed auth methods with validated types and provider IDs.
   *
   * Authentication method precedence (Requirement 3.1, 10.3):
   * 1. OAuth methods (type: "oauth2" or "agent") - triggers browser-based flow
   * 2. API key methods - only if no OAuth methods are present
   *
   * When OAuth methods are present, this function calls AuthManager.authenticateAgent()
   * to initiate the browser-based OAuth 2.1 Authorization Code flow with PKCE.
   * It does NOT fall back to API key when agent explicitly requires OAuth.
   *
   * @param agentId - The agent to authenticate
   * @param authMethods - Parsed and validated authentication methods (Task 21.1)
   */
  private async attemptAuthentication(
    agentId: string,
    authMethods: ParsedAuthMethod[],
  ): Promise<void> {
    // Check for OAuth methods first (Requirement 3.1: OAuth takes precedence)
    const oauthMethods = getOAuthMethods(authMethods);

    if (oauthMethods.length > 0) {
      // OAuth methods present - initiate OAuth flow (Requirement 3.1, 3.2)
      // Do NOT fall back to API key when agent explicitly requires OAuth
      await this.attemptOAuthAuthentication(agentId, oauthMethods);
      return;
    }

    // No OAuth methods - try API key authentication
    await this.attemptApiKeyAuthentication(agentId, authMethods);
  }

  /**
   * Attempt OAuth authentication for an agent using browser-based flow.
   *
   * Requirement 3.1: WHEN an agent requires OAuth authentication with `type: "agent"`,
   * THE Auth_Module SHALL initiate the OAuth 2.1 Authorization Code flow with PKCE.
   *
   * Requirement 3.2: WHEN initiating the authorization flow, THE Auth_Module SHALL
   * open the system default browser to the provider's authorization URL.
   *
   * @param agentId - The agent to authenticate
   * @param oauthMethods - OAuth methods from agent's authMethods (already validated)
   */
  private async attemptOAuthAuthentication(
    agentId: string,
    oauthMethods: Array<ParsedAuthMethod & { kind: 'oauth2' }>,
  ): Promise<void> {
    // Check if AuthManager is available for OAuth
    if (!this.authManager) {
      logError(`OAuth authentication required for agent ${agentId}, but AuthManager not available`);
      this.setAuthState(agentId, 'failed');
      return;
    }

    // Select the first OAuth method (could be enhanced with user preference later)
    const selectedMethod = oauthMethods[0];
    const providerId = selectedMethod.providerId;

    logInfo(`Agent ${agentId} requires OAuth authentication with provider: ${providerId}`);
    logInfo(`Initiating OAuth 2.1 Authorization Code flow with PKCE for ${providerId}`);

    // Set auth state to pending while browser flow is in progress
    this.setAuthState(agentId, 'pending');

    try {
      // Call AuthManager.authenticateAgent to start the browser-based OAuth flow
      // This opens the system default browser and waits for the callback
      const result = await this.authManager.authenticateAgent(providerId);

      if (result.success) {
        logInfo(`OAuth authentication successful for agent ${agentId} with provider ${providerId}`);
        this.setAuthState(agentId, 'authenticated');

        // After successful OAuth, send authenticate request to agent with the token
        await this.sendOAuthCredentialsToAgent(agentId, selectedMethod);
      } else {
        const errorMsg = result.error?.message ?? 'Unknown error';
        const errorCode = result.error?.code ?? 'UNKNOWN';
        logError(`OAuth authentication failed for agent ${agentId}: [${errorCode}] ${errorMsg}`);
        this.setAuthState(agentId, 'failed');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logError(`OAuth authentication error for agent ${agentId}: ${errorMessage}`);
      this.setAuthState(agentId, 'failed');
    }
  }

  /**
   * Send OAuth credentials to agent after successful browser-based authentication.
   *
   * After the OAuth flow completes successfully, this method retrieves the token
   * from AuthManager and sends an authenticate request to the agent.
   *
   * @param agentId - The agent to send credentials to
   * @param method - The OAuth method used for authentication
   */
  private async sendOAuthCredentialsToAgent(
    agentId: string,
    method: ParsedAuthMethod & { kind: 'oauth2' },
  ): Promise<void> {
    if (!this.authManager) {
      logError(`Cannot send OAuth credentials: AuthManager not available`);
      return;
    }

    // Get the access token from AuthManager
    const token = await this.authManager.getTokenForAgent(agentId, method.providerId);
    if (!token) {
      logError(`No OAuth token available for agent ${agentId} after successful auth`);
      return;
    }

    // Get agent runtime
    let runtime: AgentRuntime;
    try {
      const spawnCommand = this.registry.resolve(agentId);
      runtime = await this.runtimeManager.getOrSpawn(agentId, spawnCommand);
    } catch (error) {
      logError(`Failed to get runtime for OAuth credential injection: ${(error as Error).message}`);
      return;
    }

    // Build authenticate request with OAuth token
    const authRequest = {
      jsonrpc: '2.0',
      id: `auth-${agentId}-${Date.now()}`,
      method: 'authenticate',
      params: {
        methodId: method.id,
        credentials: {
          accessToken: token,
        },
      },
    };

    // Send authenticate request to agent
    const transformed = transformMessage(authRequest);
    const serialized = JSON.stringify(transformed) + '\n';

    if (runtime.process.stdin) {
      runtime.process.stdin.write(serialized, (error) => {
        if (error) {
          logError(`Failed to send OAuth authenticate request to ${agentId}: ${error.message}`);
        } else {
          logInfo(`Sent OAuth authenticate request to agent ${agentId}`);
        }
      });
    }
  }

  /**
   * Attempt API key authentication for an agent.
   *
   * This is the fallback authentication method when no OAuth methods are present.
   * Uses the legacy api-keys.json configuration.
   *
   * @param agentId - The agent to authenticate
   * @param authMethods - Parsed authentication methods (already validated)
   */
  private async attemptApiKeyAuthentication(
    agentId: string,
    authMethods: ParsedAuthMethod[],
  ): Promise<void> {
    // Get API key for this agent
    const apiKey = getAgentApiKey(this.apiKeys, agentId);

    if (!apiKey) {
      logError(`No API key found for agent ${agentId}, authentication will fail`);
      this.setAuthState(agentId, 'failed');
      return;
    }

    // Get API key methods from parsed methods (already validated)
    const apiKeyMethods = getApiKeyMethods(authMethods);

    // Allowlist of safe method IDs for API key authentication
    // Only send API keys to methods we explicitly trust
    const SAFE_API_KEY_METHODS = [
      'api-key',
      'openai-api-key',
      'anthropic-api-key',
      'github-api-key',
      'google-api-key',
      'azure-api-key',
      'cognito-api-key',
    ];

    // Select authentication method from allowlist only (security: don't send API key to arbitrary methods)
    const selectedMethod = apiKeyMethods.find(m => SAFE_API_KEY_METHODS.includes(m.id));

    if (!selectedMethod) {
      // No safe API key method available - do not fall back to arbitrary methods
      logError(`No safe API key method available for agent ${agentId}, skipping auto-auth`);
      this.setAuthState(agentId, 'failed');
      return;
    }

    logInfo(`Authenticating agent ${agentId} with API key method: ${selectedMethod.id} (providerId: ${selectedMethod.providerId ?? 'none'})`);

    // Get agent runtime
    let runtime: AgentRuntime;
    try {
      const spawnCommand = this.registry.resolve(agentId);
      runtime = await this.runtimeManager.getOrSpawn(agentId, spawnCommand);
    } catch (error) {
      logError(`Failed to get runtime for authentication: ${(error as Error).message}`);
      this.setAuthState(agentId, 'failed');
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
          this.setAuthState(agentId, 'failed');
        } else {
          logInfo(`Sent authenticate request to agent ${agentId}`);
          // Mark as authenticated (optimistic)
          this.setAuthState(agentId, 'authenticated');
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

  /**
   * Clear all queued requests and auth state.
   * Useful for cleanup during shutdown.
   *
   * Rejects all queued requests with a shutdown error.
   */
  clearQueues(): void {
    // Reject all queued requests
    for (const [agentId, queue] of this.requestQueue.entries()) {
      for (const queuedRequest of queue) {
        const id = extractId(queuedRequest.message);
        queuedRequest.resolve(
          createErrorResponse(id, RoutingErrorCodes.SPAWN_FAILED, 'Router shutdown', {
            agentId,
            reason: 'Router is shutting down',
          })
        );
      }
    }

    this.requestQueue.clear();
    this.authState.clear();
    this.agentOAuthRequirements.clear();
    logInfo('Cleared all request queues, auth state, and OAuth requirements');
  }

  /**
   * Reset auth state for an agent.
   * Useful for retry scenarios or logout.
   *
   * @param agentId - The agent identifier
   */
  resetAuthState(agentId: string): void {
    this.setAuthState(agentId, 'none');
  }

  /**
   * Get the OAuth requirement for an agent.
   *
   * Requirement 11.2: Check agent auth requirements.
   *
   * @param agentId - The agent identifier
   * @returns The required OAuth provider ID, or undefined if no OAuth required
   */
  getAgentOAuthRequirement(agentId: string): AuthProviderId | undefined {
    return this.agentOAuthRequirements.get(agentId);
  }

  /**
   * Set the OAuth requirement for an agent.
   *
   * Requirement 11.2: Cache auth requirements per agent.
   *
   * @param agentId - The agent identifier
   * @param providerId - The required OAuth provider ID
   */
  setAgentOAuthRequirement(agentId: string, providerId: AuthProviderId): void {
    this.agentOAuthRequirements.set(agentId, providerId);
    logInfo(`Set OAuth requirement for agent ${agentId}: provider ${providerId}`);
  }

  /**
   * Clear the OAuth requirement for an agent.
   *
   * @param agentId - The agent identifier
   */
  clearAgentOAuthRequirement(agentId: string): void {
    this.agentOAuthRequirements.delete(agentId);
    logInfo(`Cleared OAuth requirement for agent ${agentId}`);
  }
}
