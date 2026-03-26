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

import { spawn } from 'node:child_process';
import type { IRegistryIndex } from '../registry/index.js';
import { AgentNotFoundError, PlatformNotSupportedError } from '../registry/index.js';
import type { AgentRuntimeManager } from '../runtime/manager.js';
import type { AgentRuntime } from '../runtime/types.js';
import { getAgentApiKey, getAgentEnv } from '../config/api-keys.js';
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
 * - 'oauth2': Standard OAuth 2.1 flow (client handles OAuth)
 * - 'agent': Agent handles OAuth internally (ACP-compliant, default)
 * - 'terminal': Interactive terminal auth (TUI)
 * - 'api-key': API key authentication
 */
export type AuthMethodType = 'oauth2' | 'agent' | 'terminal' | 'api-key';

/**
 * Parsed auth method with validated fields.
 * Discriminated union for type-safe handling.
 */
export type ParsedAuthMethod =
  | { kind: 'oauth2'; id: string; providerId: AuthProviderId }
  | { kind: 'agent'; id: string; providerId?: AuthProviderId }
  | { kind: 'terminal'; id: string; args?: string[]; env?: Record<string, string> }
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
  // Note: OpenAI and Anthropic are NOT OAuth providers - they use API keys
  'oauth2-github': 'github',
  'oauth2-google': 'google',
  'oauth2-cognito': 'cognito',
  'oauth2-azure': 'azure',
  // Agent auth method IDs (legacy format)
  // Note: OpenAI and Anthropic are NOT OAuth providers - they use API keys
  'agent-github': 'github',
  'agent-google': 'google',
  'agent-cognito': 'cognito',
  'agent-azure': 'azure',
  // API key method IDs - these map to providers that support API key auth
  // Note: OpenAI and Anthropic API key mappings will be handled by model-credentials module
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
const VALID_AUTH_METHOD_TYPES: readonly string[] = ['oauth2', 'agent', 'terminal', 'api-key'];

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
  if (type === 'oauth2') {
    // OAuth methods require a valid providerId
    if (!resolvedProviderId) {
      logError(`OAuth auth method ${id} has no valid providerId, skipping`);
      return null;
    }
    return {
      kind: 'oauth2',
      id,
      providerId: resolvedProviderId,
    };
  }

  if (type === 'agent') {
    // Agent auth: agent handles OAuth internally (ACP-compliant)
    // AUTH_REQUIREMENTS.md: When type is not specified, "agent" is assumed as default
    return {
      kind: 'agent',
      id,
      providerId: resolvedProviderId,  // Optional for agent auth
    };
  }

  if (type === 'terminal') {
    // Terminal auth: interactive TUI setup
    // Extract args and env from the method object
    const args = Array.isArray(obj.args) ? obj.args.filter((a): a is string => typeof a === 'string') : undefined;
    const env = obj.env && typeof obj.env === 'object' && !Array.isArray(obj.env)
      ? Object.fromEntries(
        Object.entries(obj.env as Record<string, unknown>)
          .filter(([, v]) => typeof v === 'string')
      ) as Record<string, string>
      : undefined;

    return {
      kind: 'terminal',
      id,
      args,
      env,
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
 * Filter parsed auth methods to get only Agent Auth methods.
 *
 * AUTH_REQUIREMENTS.md: Agent Auth is the default authentication method
 * where the agent manages the entire OAuth flow independently.
 *
 * @param methods - Parsed auth methods
 * @returns Only Agent Auth methods (kind: 'agent')
 */
export function getAgentAuthMethods(methods: ParsedAuthMethod[]): Array<ParsedAuthMethod & { kind: 'agent' }> {
  return methods.filter((m): m is ParsedAuthMethod & { kind: 'agent' } => m.kind === 'agent');
}

/**
 * Filter parsed auth methods to get only Terminal Auth methods.
 *
 * AUTH_REQUIREMENTS.md: Terminal Auth enables agents to run an interactive
 * setup experience within a terminal environment.
 *
 * @param methods - Parsed auth methods
 * @returns Only Terminal Auth methods (kind: 'terminal')
 */
export function getTerminalAuthMethods(methods: ParsedAuthMethod[]): Array<ParsedAuthMethod & { kind: 'terminal' }> {
  return methods.filter((m): m is ParsedAuthMethod & { kind: 'terminal' } => m.kind === 'terminal');
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
 * Pending authenticate request tracking structure.
 *
 * Tracks authenticate JSON-RPC requests sent to agents for Agent Auth flow.
 * Used to correlate authenticate responses with the original auth flow.
 *
 * AUTH_REQUIREMENTS.md: Agent Auth - client calls authenticate method on agent
 */
export interface PendingAuthenticateRequest {
  /** The authenticate request ID */
  requestId: string;
  /** The agent ID */
  agentId: string;
  /** The auth method ID from authMethods */
  authMethodId: string;
  /** Timestamp when the request was sent */
  sentAt: number;
  /** Resolve function to signal completion */
  resolve: (success: boolean, error?: string) => void;
}

/**
 * Default timeout for Agent Auth authenticate requests in milliseconds (5 minutes).
 * Matches the OAuth flow timeout from AUTH_REQUIREMENTS.md.
 */
const AGENT_AUTH_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Default timeout for Terminal Auth setup process in milliseconds (10 minutes).
 * Terminal Auth may require user interaction, so we allow more time.
 */
const TERMINAL_AUTH_TIMEOUT_MS = 10 * 60 * 1000;

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
 * Spawn function type for dependency injection in tests.
 */
export type SpawnFn = typeof spawn;

/**
 * Optional dependencies for MessageRouter (for testing).
 */
export interface MessageRouterDeps {
  /** Custom spawn function (default: child_process.spawn) */
  spawnFn?: SpawnFn;
  /** Custom function to check if stdin is TTY (default: process.stdin.isTTY) */
  isStdinTTY?: () => boolean;
  /** Custom function to check if stdout is TTY (default: process.stdout.isTTY) */
  isStdoutTTY?: () => boolean;
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

  /** Spawn function for Terminal Auth (injectable for testing) */
  private readonly spawnFn: SpawnFn;

  /** Function to check if stdin is TTY (injectable for testing) */
  private readonly isStdinTTY: () => boolean;

  /** Function to check if stdout is TTY (injectable for testing) */
  private readonly isStdoutTTY: () => boolean;
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

  /**
   * Map of authenticate request ID to pending authenticate request info.
   *
   * Tracks authenticate JSON-RPC requests sent to agents for Agent Auth flow.
   * Used to correlate authenticate responses with the original auth flow.
   *
   * AUTH_REQUIREMENTS.md: Agent Auth - client calls authenticate method on agent
   */
  private readonly pendingAuthenticateRequests: Map<string, PendingAuthenticateRequest> = new Map();

  /** Map of agent sessionId to client sessionId for notification routing */
  private readonly sessionIdMap: Map<string, string> = new Map();

  /**
   * Whether to automatically trigger OAuth browser flow when agent requires it.
   * When false, returns AUTH_REQUIRED error instead of opening browser.
   * Controlled by AUTH_AUTO_OAUTH environment variable (default: false for safety).
   */
  private readonly autoOAuth: boolean;

  /**
   * Create a new MessageRouter.
   *
   * @param registry - Registry index for agent lookup
   * @param runtimeManager - Runtime manager for agent processes
   * @param writeCallback - Callback for writing responses to stdout
   * @param apiKeys - API keys for agent authentication (optional)
   * @param authManager - AuthManager for OAuth authentication (optional, Requirements 11.2, 11.4)
   * @param autoOAuth - Whether to auto-trigger OAuth browser flow (default: from AUTH_AUTO_OAUTH env, or false)
   * @param deps - Optional dependencies for testing (spawnFn, TTY checks)
   */
  constructor(
    registry: IRegistryIndex,
    runtimeManager: AgentRuntimeManager,
    writeCallback: WriteCallback,
    apiKeys: Record<string, any> = {},
    authManager?: AuthManager,
    autoOAuth?: boolean,
    deps?: MessageRouterDeps,
  ) {
    this.registry = registry;
    this.runtimeManager = runtimeManager;
    this.writeCallback = writeCallback;
    this.apiKeys = apiKeys;
    this.authManager = authManager;
    // Default to false for safety - existing deployments won't suddenly open browsers
    // Can be enabled via AUTH_AUTO_OAUTH=true environment variable
    this.autoOAuth = autoOAuth ?? this.getAutoOAuthFromEnv();
    // Injectable dependencies for testing
    this.spawnFn = deps?.spawnFn ?? spawn;
    this.isStdinTTY = deps?.isStdinTTY ?? (() => process.stdin.isTTY ?? false);
    this.isStdoutTTY = deps?.isStdoutTTY ?? (() => process.stdout.isTTY ?? false);
  }

  /**
   * Get auto-OAuth setting from environment variable.
   * AUTH_AUTO_OAUTH=true enables auto-OAuth, any other value or unset disables it.
   */
  private getAutoOAuthFromEnv(): boolean {
    const envValue = process.env.AUTH_AUTO_OAUTH;
    return envValue === 'true' || envValue === '1' || envValue === 'yes';
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
      // Note: OpenAI and Anthropic API key support will be handled by model-credentials module
      { id: 'api-key', type: 'api-key' },
    ];

    // Add OAuth methods if AuthManager is available
    // Note: OpenAI and Anthropic are NOT OAuth providers - they use API keys
    if (this.authManager) {
      methods.push(
        { id: 'oauth2-github', type: 'oauth2', providerId: 'github' },
        { id: 'oauth2-google', type: 'oauth2', providerId: 'google' },
        { id: 'oauth2-cognito', type: 'oauth2', providerId: 'cognito' },
        { id: 'oauth2-azure', type: 'oauth2', providerId: 'azure' },
        { id: 'oauth2-oidc', type: 'oauth2', providerId: 'oidc' },
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
   * Check if api-key credentials are available for an agent.
   * This is a synchronous check for api-keys.json credentials.
   *
   * @param agentId - The agent identifier
   * @returns True if api-key credentials are available
   */
  hasCredentialsForAgent(agentId: string): boolean {
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
    // Build remediation instructions for the user
    // Use npx command (works without global install) and stdiobus (after global install)
    const remediation: Record<string, unknown> = {
      type: 'login_required',
      commands: [
        'npx @stdiobus/workers-registry acp-registry --setup',
        'stdiobus acp-registry --setup',
      ],
      hint: 'Run: npx @stdiobus/workers-registry acp-registry --setup',
      docsUrl: 'https://github.com/stdiobus/workers-registry/blob/main/docs/oauth/user-guide.md'
    };

    return createErrorResponse(
      id,
      RoutingErrorCodes.AUTH_REQUIRED,
      'Authentication required',
      {
        agentId,
        requiredMethod: requiredMethod ?? 'api-key',
        supportedMethods: this.getSupportedAuthMethods().map(m => m.id),
        remediation,
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

    // Build remediation instructions for the user
    // Use npx command (works without global install) and stdiobus (after global install)
    const remediation: Record<string, unknown> = {
      type: 'login_required',
      provider: providerId || 'unknown',
      commands: providerId
        ? [
          `npx @stdiobus/workers-registry acp-registry --login ${providerId}`,
          `stdiobus acp-registry --login ${providerId}`,
        ]
        : [
          'npx @stdiobus/workers-registry acp-registry --setup',
          'stdiobus acp-registry --setup',
        ],
      hint: providerId
        ? `Run: npx @stdiobus/workers-registry acp-registry --login ${providerId}`
        : 'Run: npx @stdiobus/workers-registry acp-registry --setup',
      docsUrl: 'https://github.com/stdiobus/workers-registry/blob/main/docs/oauth/user-guide.md'
    };

    return createErrorResponse(
      id,
      RoutingErrorCodes.AUTH_REQUIRED,
      'Authentication required',
      {
        agentId,
        requiredMethod: providerId ? `oauth2-${providerId}` : 'oauth2',
        supportedMethods: supportedMethods.map(m => m.id),
        providerId: providerId,
        remediation,
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

    // Merge env from api-keys.json into spawn command
    // This ensures credentials are passed to the agent process
    const agentEnv = getAgentEnv(this.apiKeys, agentId);
    if (Object.keys(agentEnv).length > 0) {
      spawnCommand = {
        ...spawnCommand,
        env: {
          ...spawnCommand.env,
          ...agentEnv,
        },
      };
      logInfo(`Injected ${Object.keys(agentEnv).length} env vars from api-keys.json for agent ${agentId}`);
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
   * Handles authenticate responses for Agent Auth flow (Task 35.2).
   * Forwards all responses to stdout.
   *
   * @param agentId - The agent that sent the response
   * @param response - The response object from the agent
   */
  handleAgentResponse(agentId: string, response: object): void {
    const id = extractId(response);
    let msg = response as Record<string, unknown>;
    const method = typeof msg.method === 'string' ? msg.method : undefined;

    // Task 35.2: Handle authenticate response for Agent Auth flow
    // Check if this is a response to a pending authenticate request
    if (id !== null && typeof id === 'string') {
      const pendingAuth = this.pendingAuthenticateRequests.get(id);
      if (pendingAuth && pendingAuth.agentId === agentId) {
        this.handleAuthenticateResponse(pendingAuth, msg);
        return; // Don't forward authenticate responses to client
      }
    }

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
            const apiKeyMethods = getApiKeyMethods(parsedMethods);

            // Check if agent has api-key credentials available
            // If api-key is supported AND credentials exist, don't require OAuth
            const hasApiKeyCredentials = this.hasCredentialsForAgent(agentId);

            if (oauthMethods.length > 0 && !(apiKeyMethods.length > 0 && hasApiKeyCredentials)) {
              // Store the first OAuth provider as the required provider
              // Only if api-key fallback is not available
              const requiredProviderId = oauthMethods[0].providerId;
              this.agentOAuthRequirements.set(agentId, requiredProviderId);
              logInfo(`Agent ${agentId} requires OAuth authentication with provider: ${requiredProviderId}`);
            } else if (apiKeyMethods.length > 0 && hasApiKeyCredentials) {
              logInfo(`Agent ${agentId} supports OAuth but api-key credentials available, using api-key`);
            }

            // Task 33.2: Only auto-trigger OAuth if AUTH_AUTO_OAUTH is enabled
            // Default is false for backward compatibility - existing deployments won't suddenly open browsers
            if (this.autoOAuth) {
              logInfo(`Agent ${agentId} requires authentication, attempting auto-auth with ${parsedMethods.length} valid methods`);
              this.setAuthState(agentId, 'pending');
              void this.attemptAuthentication(agentId, parsedMethods);
            } else {
              logInfo(`Agent ${agentId} requires authentication but AUTH_AUTO_OAUTH is disabled. Use --login to authenticate.`);
              // Don't set auth state to pending - let requests fail with AUTH_REQUIRED
              // This allows users to explicitly authenticate via --login command
            }
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
   * Handle an authenticate response from an agent.
   *
   * Task 35.2: Handle authenticate response
   * - On success: resolve the pending authenticate request with success
   * - On error: resolve with failure and log the error
   *
   * AUTH_REQUIREMENTS.md: Agent Auth - after agent completes OAuth flow,
   * it responds to the authenticate request.
   *
   * @param pendingAuth - The pending authenticate request
   * @param response - The response from the agent
   */
  private handleAuthenticateResponse(
    pendingAuth: PendingAuthenticateRequest,
    response: Record<string, unknown>,
  ): void {
    const { agentId, authMethodId, requestId } = pendingAuth;

    // Check for error response
    if (response.error) {
      const error = response.error as Record<string, unknown>;
      const errorCode = error.code ?? 'UNKNOWN';
      const errorMessage = typeof error.message === 'string' ? error.message : 'Unknown error';
      logError(`Agent Auth failed for ${agentId}: [${errorCode}] ${errorMessage}`);
      pendingAuth.resolve(false, errorMessage);
      return;
    }

    // Check for success response
    if (response.result !== undefined) {
      logInfo(`Agent Auth succeeded for ${agentId} (method: ${authMethodId}, request: ${requestId})`);
      pendingAuth.resolve(true);
      return;
    }

    // Unexpected response format
    logError(`Unexpected authenticate response format for ${agentId}: ${JSON.stringify(response)}`);
    pendingAuth.resolve(false, 'Unexpected response format');
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
   * Authentication method precedence (AUTH_REQUIREMENTS.md):
   * 1. Agent Auth (type: "agent" or no type) - agent handles OAuth internally
   * 2. OAuth methods (type: "oauth2") - client handles browser-based flow
   * 3. API key methods - only if no OAuth methods are present
   *
   * AUTH_REQUIREMENTS.md: Agent Auth is the default authentication method
   * where the agent manages the entire OAuth flow independently.
   *
   * @param agentId - The agent to authenticate
   * @param authMethods - Parsed and validated authentication methods (Task 21.1)
   */
  private async attemptAuthentication(
    agentId: string,
    authMethods: ParsedAuthMethod[],
  ): Promise<void> {
    // Check for Agent Auth methods first (AUTH_REQUIREMENTS.md: Agent Auth is default)
    const agentAuthMethods = getAgentAuthMethods(authMethods);

    if (agentAuthMethods.length > 0) {
      // Agent Auth: call authenticate method on agent, agent handles OAuth internally
      await this.attemptAgentAuthentication(agentId, agentAuthMethods);
      return;
    }

    // Check for Terminal Auth methods (Task 36: type: "terminal")
    // Terminal Auth: spawn agent with args/env for interactive TUI setup
    const terminalAuthMethods = getTerminalAuthMethods(authMethods);

    if (terminalAuthMethods.length > 0) {
      // Terminal Auth: spawn interactive setup process
      await this.attemptTerminalAuthentication(agentId, terminalAuthMethods);
      return;
    }

    // Check for OAuth methods (type: "oauth2") - client handles browser flow
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
   * Attempt Agent Auth authentication for an agent.
   *
   * AUTH_REQUIREMENTS.md: Agent Auth - client calls `authenticate` method on agent,
   * agent handles: HTTP server, browser launch, OAuth callback, token storage.
   *
   * Task 35.1: Call `authenticate` JSON-RPC method on agent
   * - Send: { jsonrpc: "2.0", method: "authenticate", params: { id: authMethod.id }, id: requestId }
   * - Wait for response from agent
   *
   * Task 35.2: Handle authenticate response
   * - On success: retry original request (session/new)
   * - On error: return error to client
   *
   * @param agentId - The agent to authenticate
   * @param agentAuthMethods - Agent Auth methods from agent's authMethods
   */
  private async attemptAgentAuthentication(
    agentId: string,
    agentAuthMethods: Array<ParsedAuthMethod & { kind: 'agent' }>,
  ): Promise<void> {
    // Select the first Agent Auth method
    const selectedMethod = agentAuthMethods[0];

    logInfo(`Agent ${agentId} requires Agent Auth with method: ${selectedMethod.id}`);
    logInfo(`Calling authenticate method on agent - agent will handle OAuth flow internally`);

    // Set auth state to pending while agent handles OAuth
    this.setAuthState(agentId, 'pending');

    try {
      // Get agent runtime
      let runtime: AgentRuntime;
      try {
        let spawnCommand = this.registry.resolve(agentId);
        // Merge env from api-keys.json
        const agentEnv = getAgentEnv(this.apiKeys, agentId);
        if (Object.keys(agentEnv).length > 0) {
          spawnCommand = {
            ...spawnCommand,
            env: { ...spawnCommand.env, ...agentEnv },
          };
        }
        runtime = await this.runtimeManager.getOrSpawn(agentId, spawnCommand);
      } catch (error) {
        logError(`Failed to get runtime for Agent Auth: ${(error as Error).message}`);
        this.setAuthState(agentId, 'failed');
        return;
      }

      // Call authenticate method on agent and wait for response
      const success = await this.callAgentAuthenticate(agentId, selectedMethod.id, runtime);

      if (success) {
        logInfo(`Agent Auth successful for agent ${agentId}`);
        this.setAuthState(agentId, 'authenticated');
      } else {
        logError(`Agent Auth failed for agent ${agentId}`);
        this.setAuthState(agentId, 'failed');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logError(`Agent Auth error for agent ${agentId}: ${errorMessage}`);
      this.setAuthState(agentId, 'failed');
    }
  }

  /**
   * Call the `authenticate` JSON-RPC method on an agent.
   *
   * AUTH_REQUIREMENTS.md: Agent Auth - client calls authenticate method on agent
   * Send: { jsonrpc: "2.0", method: "authenticate", params: { id: authMethod.id }, id: requestId }
   *
   * Task 35.1: Call `authenticate` JSON-RPC method on agent
   *
   * @param agentId - The agent to authenticate
   * @param authMethodId - The auth method ID from authMethods
   * @param runtime - The agent runtime
   * @returns Promise that resolves to true on success, false on failure
   */
  private callAgentAuthenticate(
    agentId: string,
    authMethodId: string,
    runtime: AgentRuntime,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const requestId = `agent-auth-${agentId}-${Date.now()}`;

      // Build authenticate request per AUTH_REQUIREMENTS.md
      const authenticateRequest = {
        jsonrpc: '2.0',
        id: requestId,
        method: 'authenticate',
        params: {
          id: authMethodId,
        },
      };

      // Track the pending authenticate request
      const pendingRequest: PendingAuthenticateRequest = {
        requestId,
        agentId,
        authMethodId,
        sentAt: Date.now(),
        resolve: (success: boolean, error?: string) => {
          // Clean up the pending request
          this.pendingAuthenticateRequests.delete(requestId);
          if (error) {
            logError(`Agent Auth response error: ${error}`);
          }
          resolve(success);
        },
      };

      this.pendingAuthenticateRequests.set(requestId, pendingRequest);

      // Set up timeout for the authenticate request
      setTimeout(() => {
        const pending = this.pendingAuthenticateRequests.get(requestId);
        if (pending) {
          logError(`Agent Auth timeout for agent ${agentId} (method: ${authMethodId})`);
          this.pendingAuthenticateRequests.delete(requestId);
          resolve(false);
        }
      }, AGENT_AUTH_TIMEOUT_MS);

      // Send authenticate request to agent
      const success = runtime.write(authenticateRequest);

      if (!success) {
        logError(`Failed to send authenticate request to agent ${agentId}`);
        this.pendingAuthenticateRequests.delete(requestId);
        resolve(false);
      } else {
        logInfo(`Sent authenticate request to agent ${agentId} (id: ${requestId}, method: ${authMethodId})`);
      }
    });
  }

  /**
   * Attempt Terminal Auth authentication for an agent.
   *
   * AUTH_REQUIREMENTS.md: Terminal Auth - client spawns agent binary with args/env
   * from authMethod for interactive TUI setup.
   *
   * Task 36.1: Parse Terminal Auth from authMethods
   * Task 36.2: Launch agent binary with args/env
   * Task 36.3: Retry after Terminal Auth
   *
   * Flow:
   * 1. Stop current agent runtime (if running)
   * 2. Spawn agent with args/env from authMethod (stdio: 'inherit' for TUI)
   * 3. Wait for process exit
   * 4. On exit code 0: restart normal runtime and verify auth
   * 5. On non-zero exit: mark as failed
   *
   * @param agentId - The agent to authenticate
   * @param terminalAuthMethods - Terminal Auth methods from agent's authMethods
   */
  private async attemptTerminalAuthentication(
    agentId: string,
    terminalAuthMethods: Array<ParsedAuthMethod & { kind: 'terminal' }>,
  ): Promise<void> {
    // Select the first Terminal Auth method
    const selectedMethod = terminalAuthMethods[0];

    logInfo(`Agent ${agentId} requires Terminal Auth with method: ${selectedMethod.id}`);

    // Check if we're in a TTY environment (required for interactive TUI)
    if (!this.isStdinTTY() || !this.isStdoutTTY()) {
      logError(`Terminal Auth requires interactive terminal (TTY). Run in a terminal with stdin/stdout connected.`);
      this.setAuthState(agentId, 'failed');
      return;
    }

    // Set auth state to pending
    this.setAuthState(agentId, 'pending');

    try {
      // Step 1: Stop current agent runtime if running
      const existingRuntime = this.runtimeManager.get(agentId);
      if (existingRuntime) {
        logInfo(`Stopping existing runtime for agent ${agentId} before Terminal Auth`);
        await this.runtimeManager.terminate(agentId);
      }

      // Step 2: Get spawn command for the agent
      const baseSpawnCommand = this.registry.resolve(agentId);

      // Build Terminal Auth spawn command using args/env from authMethod (replacement, not merge)
      const terminalArgs = selectedMethod.args ?? [];
      const terminalEnv = {
        ...process.env,  // Inherit current environment
        ...(selectedMethod.env ?? {}),  // Override with authMethod env
      };

      logInfo(`Launching Terminal Auth for ${agentId}: ${baseSpawnCommand.command} ${terminalArgs.join(' ')}`);

      // Step 3: Spawn interactive process with inherited stdio
      const exitCode = await this.runTerminalAuthProcess(
        baseSpawnCommand.command,
        terminalArgs,
        terminalEnv,
      );

      // Step 4: Handle exit code
      if (exitCode === 0) {
        logInfo(`Terminal Auth process exited successfully for ${agentId}`);

        // Restart normal runtime and verify auth
        const authVerified = await this.verifyTerminalAuthSuccess(agentId);

        if (authVerified) {
          logInfo(`Terminal Auth verified for ${agentId}`);
          this.setAuthState(agentId, 'authenticated');
        } else {
          logError(`Terminal Auth completed but verification failed for ${agentId}`);
          this.setAuthState(agentId, 'failed');
        }
      } else {
        logError(`Terminal Auth process exited with code ${exitCode} for ${agentId}`);
        this.setAuthState(agentId, 'failed');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logError(`Terminal Auth error for agent ${agentId}: ${errorMessage}`);
      this.setAuthState(agentId, 'failed');
    }
  }

  /**
   * Run the Terminal Auth process with inherited stdio for interactive TUI.
   *
   * @param command - The command to execute
   * @param args - Command-line arguments
   * @param env - Environment variables
   * @returns Promise that resolves to the exit code
   */
  private runTerminalAuthProcess(
    command: string,
    args: string[],
    env: Record<string, string | undefined>,
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      logInfo(`Spawning Terminal Auth process: ${command} ${args.join(' ')}`);

      const child = this.spawnFn(command, args, {
        env: env as NodeJS.ProcessEnv,
        stdio: 'inherit',  // Inherit stdin/stdout/stderr for interactive TUI
        shell: false,
      });

      // Set up timeout
      const timeoutId = setTimeout(() => {
        logError(`Terminal Auth process timed out after ${TERMINAL_AUTH_TIMEOUT_MS}ms`);
        child.kill('SIGTERM');
        // Give it a moment to terminate gracefully, then SIGKILL
        setTimeout(() => {
          if (!child.killed) {
            child.kill('SIGKILL');
          }
        }, 5000);
      }, TERMINAL_AUTH_TIMEOUT_MS);

      child.on('error', (error) => {
        clearTimeout(timeoutId);
        reject(error);
      });

      child.on('exit', (code, signal) => {
        clearTimeout(timeoutId);
        if (signal) {
          logError(`Terminal Auth process killed by signal: ${signal}`);
          resolve(1);  // Treat signal termination as failure
        } else {
          resolve(code ?? 1);
        }
      });
    });
  }

  /**
   * Verify that Terminal Auth was successful by restarting the agent
   * and checking if authentication is now available.
   *
   * @param agentId - The agent to verify
   * @returns true if auth is now available, false otherwise
   */
  private async verifyTerminalAuthSuccess(agentId: string): Promise<boolean> {
    try {
      // Restart the agent runtime
      let spawnCommand = this.registry.resolve(agentId);

      // Merge env from api-keys.json (credentials may have been stored by Terminal Auth)
      const agentEnv = getAgentEnv(this.apiKeys, agentId);
      if (Object.keys(agentEnv).length > 0) {
        spawnCommand = {
          ...spawnCommand,
          env: { ...spawnCommand.env, ...agentEnv },
        };
      }

      const runtime = await this.runtimeManager.getOrSpawn(agentId, spawnCommand);

      // For now, we trust that Terminal Auth stored credentials properly
      // A more robust verification would send an initialize request and check
      // if AUTH_REQUIRED is still returned, but that adds complexity.
      // The next actual request will verify auth status.
      return runtime.state === 'running';
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logError(`Failed to verify Terminal Auth for ${agentId}: ${errorMessage}`);
      return false;
    }
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
      let spawnCommand = this.registry.resolve(agentId);
      // Merge env from api-keys.json
      const agentEnv = getAgentEnv(this.apiKeys, agentId);
      if (Object.keys(agentEnv).length > 0) {
        spawnCommand = {
          ...spawnCommand,
          env: { ...spawnCommand.env, ...agentEnv },
        };
      }
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
    // Note: OpenAI and Anthropic API key methods will be handled by model-credentials module
    const SAFE_API_KEY_METHODS = [
      'api-key',
      'openai-api-key',
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
      let spawnCommand = this.registry.resolve(agentId);
      // Merge env from api-keys.json
      const agentEnv = getAgentEnv(this.apiKeys, agentId);
      if (Object.keys(agentEnv).length > 0) {
        spawnCommand = {
          ...spawnCommand,
          env: { ...spawnCommand.env, ...agentEnv },
        };
      }
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
