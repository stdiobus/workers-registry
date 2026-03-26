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
 * Main orchestrator for OAuth authentication.
 *
 * Coordinates providers, flows, storage, and token management.
 *
 * Requirements: 3.1, 4.1, 10.3, 11.4
 *
 * @module auth-manager
 */

import type { AgentApiKeys } from '../config/api-keys.js';
import type { ICredentialStore } from './storage/types.js';
import type { ITokenManager } from './token-manager.js';
import type { IAuthProvider } from './providers/types.js';
import { getProvider, hasProvider, getRegisteredProviders } from './providers/index.js';
import { AgentAuthFlow } from './flows/agent-auth-flow.js';
import { TerminalAuthFlow } from './flows/terminal-auth-flow.js';
import type {
  AuthProviderId,
  AuthResult,
  AuthStatusMap,
  AuthStatusEntry,
  AgentAuthOptions,
  AuthMethodType,
  AuthMethodPrecedenceConfig,
} from './types.js';
import {
  isValidProviderId,
  VALID_PROVIDER_IDS,
  DEFAULT_AUTH_METHOD_PRECEDENCE,
  isValidAuthMethodType,
} from './types.js';

/**
 * Marker token used to indicate client credentials are configured but not authenticated.
 * This token should NEVER be sent in actual requests.
 */
export const CLIENT_CREDENTIALS_MARKER = '__CLIENT_CREDENTIALS_CONFIGURED__';

/**
 * Check if a token is the client credentials marker (not a real token).
 * @param token - The token to check
 * @returns True if the token is the marker
 */
export function isMarkerToken(token: string | null | undefined): boolean {
  return token === CLIENT_CREDENTIALS_MARKER;
}

/**
 * Options for creating an AuthManager.
 */
export interface AuthManagerOptions {
  /** Credential store for persisting OAuth credentials */
  credentialStore: ICredentialStore;
  /** Token manager for token lifecycle management */
  tokenManager: ITokenManager;
  /** Legacy API keys from api-keys.json */
  legacyApiKeys: Record<string, AgentApiKeys>;
  /** Optional custom provider resolver (for testing) */
  providerResolver?: (providerId: AuthProviderId) => IAuthProvider;
  /**
   * Authentication method precedence configuration.
   * Controls which auth method is preferred when multiple are available.
   * Default: oauth2 > api-key (OAuth preferred when available)
   *
   * Requirements: 3.1, 10.3
   */
  methodPrecedence?: Partial<AuthMethodPrecedenceConfig>;
}

/**
 * Result of authentication method selection.
 */
export interface AuthMethodSelectionResult {
  /** The selected authentication method type */
  methodType: AuthMethodType;
  /** The provider ID to use (for oauth2) */
  providerId?: AuthProviderId;
  /** Whether a valid credential was found */
  hasCredential: boolean;
  /** Error message if selection failed */
  error?: string;
}

/**
 * Error thrown when authentication method selection fails.
 */
export class AuthMethodSelectionError extends Error {
  constructor(
    message: string,
    public readonly code: 'UNSUPPORTED_METHOD' | 'AMBIGUOUS_PROVIDER' | 'NO_CREDENTIALS',
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AuthMethodSelectionError';
  }
}

/**
 * Main orchestrator for OAuth authentication.
 * Coordinates providers, flows, storage, and token management.
 *
 * Responsibilities:
 * - Orchestrate agent auth flow (browser-based OAuth 2.1 with PKCE)
 * - Orchestrate terminal auth flow (interactive CLI setup)
 * - Manage credential precedence (OAuth over legacy api-keys.json)
 * - Inject authentication into agent requests
 * - Report authentication status
 * - Handle logout operations
 *
 * Method Precedence Strategy (Requirements 3.1, 10.3):
 * - Default precedence: oauth2 > api-key (OAuth preferred when available)
 * - Configurable via AuthConfig.methodPrecedence
 * - Fail-fast on unsupported or ambiguous providerId (configurable)
 */
export class AuthManager {
  private readonly credentialStore: ICredentialStore;
  private readonly tokenManager: ITokenManager;
  private readonly legacyApiKeys: Record<string, AgentApiKeys>;
  private readonly providerResolver: (providerId: AuthProviderId) => IAuthProvider;
  private readonly methodPrecedenceConfig: AuthMethodPrecedenceConfig;

  /**
   * Tracks in-flight authentication flows per provider.
   * Used to implement single-flight pattern: concurrent auth requests for the same
   * provider share the same Promise and receive the same result.
   *
   * Requirements: 3.1, 6.5
   */
  private readonly inFlightAuthFlows: Map<AuthProviderId, Promise<AuthResult>> = new Map();

  /**
   * Create a new AuthManager.
   *
   * @param options - Configuration options
   */
  constructor(options: AuthManagerOptions);
  /**
   * Create a new AuthManager (legacy constructor signature).
   *
   * @param credentialStore - Credential store for persisting OAuth credentials
   * @param tokenManager - Token manager for token lifecycle management
   * @param legacyApiKeys - Legacy API keys from api-keys.json
   */
  constructor(
    credentialStore: ICredentialStore,
    tokenManager: ITokenManager,
    legacyApiKeys: Record<string, AgentApiKeys>
  );
  constructor(
    optionsOrCredentialStore: AuthManagerOptions | ICredentialStore,
    tokenManager?: ITokenManager,
    legacyApiKeys?: Record<string, AgentApiKeys>
  ) {
    if (this.isAuthManagerOptions(optionsOrCredentialStore)) {
      // New options-based constructor
      this.credentialStore = optionsOrCredentialStore.credentialStore;
      this.tokenManager = optionsOrCredentialStore.tokenManager;
      this.legacyApiKeys = optionsOrCredentialStore.legacyApiKeys;
      this.providerResolver = optionsOrCredentialStore.providerResolver ?? getProvider;
      // Merge user-provided precedence config with defaults
      this.methodPrecedenceConfig = {
        ...DEFAULT_AUTH_METHOD_PRECEDENCE,
        ...optionsOrCredentialStore.methodPrecedence,
      };
    } else {
      // Legacy constructor
      this.credentialStore = optionsOrCredentialStore;
      this.tokenManager = tokenManager!;
      this.legacyApiKeys = legacyApiKeys ?? {};
      this.providerResolver = getProvider;
      this.methodPrecedenceConfig = { ...DEFAULT_AUTH_METHOD_PRECEDENCE };
    }
  }

  /**
   * Type guard to check if the argument is AuthManagerOptions.
   */
  private isAuthManagerOptions(arg: unknown): arg is AuthManagerOptions {
    return (
      typeof arg === 'object' &&
      arg !== null &&
      'credentialStore' in arg &&
      'tokenManager' in arg &&
      'legacyApiKeys' in arg
    );
  }

  /**
   * Authenticate with a provider using agent auth flow.
   *
   * Initiates the OAuth 2.1 Authorization Code flow with PKCE.
   * Opens the system browser for user authentication.
   *
   * Implements single-flight pattern: if an auth flow is already in progress
   * for the same provider, subsequent callers wait for and share the same result.
   * This prevents multiple simultaneous browser flows for the same provider.
   *
   * Requirement 3.1: Initiate OAuth 2.1 Authorization Code flow with PKCE
   * Requirement 6.5: Concurrent auth requests share the same flow
   *
   * @param providerId - The provider to authenticate with
   * @param options - Optional flow configuration
   * @returns Authentication result indicating success or failure
   */
  async authenticateAgent(
    providerId: AuthProviderId,
    options?: AgentAuthOptions
  ): Promise<AuthResult> {
    // Validate provider ID (fast-fail before checking in-flight flows)
    if (!isValidProviderId(providerId)) {
      return {
        success: false,
        providerId,
        error: {
          code: 'UNSUPPORTED_PROVIDER',
          message: `Provider '${providerId}' is not supported.`,
          details: { supportedProviders: [...VALID_PROVIDER_IDS] },
        },
      };
    }

    // Check if provider is registered (fast-fail before checking in-flight flows)
    if (!hasProvider(providerId)) {
      return {
        success: false,
        providerId,
        error: {
          code: 'UNSUPPORTED_PROVIDER',
          message: `Provider '${providerId}' is not registered.`,
          details: { registeredProviders: getRegisteredProviders() },
        },
      };
    }

    // Check for existing in-flight flow for this provider (single-flight pattern)
    const existingFlow = this.inFlightAuthFlows.get(providerId);
    if (existingFlow) {
      console.error(`[AuthManager] Auth flow already in progress for ${providerId}, waiting for result...`);
      return existingFlow;
    }

    // Create and track new flow
    const flowPromise = this.executeAuthFlow(providerId, options);
    this.inFlightAuthFlows.set(providerId, flowPromise);

    try {
      return await flowPromise;
    } finally {
      // Only delete if this is still our promise (race protection)
      if (this.inFlightAuthFlows.get(providerId) === flowPromise) {
        this.inFlightAuthFlows.delete(providerId);
      }
    }
  }

  /**
   * Execute the actual OAuth authentication flow.
   *
   * This is the internal implementation that performs the browser-based
   * OAuth 2.1 Authorization Code flow with PKCE.
   *
   * @param providerId - The provider to authenticate with
   * @param options - Optional flow configuration
   * @returns Authentication result indicating success or failure
   */
  private async executeAuthFlow(
    providerId: AuthProviderId,
    options?: AgentAuthOptions
  ): Promise<AuthResult> {
    try {
      // Create the agent auth flow
      const agentAuthFlow = new AgentAuthFlow({
        getProvider: this.providerResolver,
        storeTokens: async (pid, tokens) => {
          await this.tokenManager.storeTokens(pid, tokens);
        },
      });

      // Execute the flow
      console.error(`[AuthManager] Starting agent auth flow for ${providerId}`);
      const result = await agentAuthFlow.execute(providerId, options);

      if (result.success) {
        console.error(`[AuthManager] Agent auth flow completed successfully for ${providerId}`);
      } else {
        console.error(`[AuthManager] Agent auth flow failed for ${providerId}: ${result.error?.message}`);
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[AuthManager] Agent auth flow error for ${providerId}: ${errorMessage}`);

      return {
        success: false,
        providerId,
        error: {
          code: 'PROVIDER_ERROR',
          message: `Authentication failed: ${errorMessage}`,
        },
      };
    }
  }

  /**
   * Run interactive terminal setup for a provider.
   *
   * Starts the Setup_Wizard interactive flow for configuring
   * OAuth credentials in headless environments.
   *
   * Requirement 4.1: Start Setup_Wizard interactive flow
   *
   * @param providerId - The provider to set up
   * @returns Authentication result indicating success or failure
   */
  async setupTerminal(providerId: AuthProviderId): Promise<AuthResult> {
    // Validate provider ID
    if (!isValidProviderId(providerId)) {
      return {
        success: false,
        providerId,
        error: {
          code: 'UNSUPPORTED_PROVIDER',
          message: `Provider '${providerId}' is not supported.`,
          details: { supportedProviders: [...VALID_PROVIDER_IDS] },
        },
      };
    }

    try {
      // Create the terminal auth flow
      const terminalAuthFlow = new TerminalAuthFlow({
        credentialStore: this.credentialStore,
        validateCredentials: async (pid, credentials) => {
          return this.validateTerminalCredentials(pid, credentials);
        },
      });

      // Execute the flow
      console.error(`[AuthManager] Starting terminal setup for ${providerId}`);
      const flowResult = await terminalAuthFlow.execute(providerId);

      // Check if user selected browser OAuth flow
      if (flowResult.useBrowserOAuth) {
        console.error(`[AuthManager] User selected browser OAuth for ${providerId}, launching browser flow`);
        return this.authenticateAgent(flowResult.providerId);
      }

      // Manual credential flow completed
      const result = flowResult.authResult;
      if (result.success) {
        console.error(`[AuthManager] Terminal setup completed successfully for ${providerId}`);
      } else {
        console.error(`[AuthManager] Terminal setup failed for ${providerId}: ${result.error?.message}`);
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[AuthManager] Terminal setup error for ${providerId}: ${errorMessage}`);

      return {
        success: false,
        providerId,
        error: {
          code: 'PROVIDER_ERROR',
          message: `Terminal setup failed: ${errorMessage}`,
        },
      };
    }
  }

  /**
   * Validate credentials collected during terminal auth flow.
   *
   * Note: Terminal auth flow stores client credentials for later use.
   * The actual token exchange happens when the credentials are used.
   * This validation ensures the credentials are properly formatted.
   *
   * @param providerId - The provider to validate against
   * @param credentials - The collected credentials
   * @returns Validation result with status indicator
   */
  private async validateTerminalCredentials(
    providerId: AuthProviderId,
    credentials: { clientId: string; clientSecret?: string }
  ): Promise<{ valid: boolean; error?: string; accessToken?: string }> {
    try {
      // Validate client ID format
      if (!credentials.clientId || credentials.clientId.trim().length === 0) {
        return { valid: false, error: 'Client ID is required' };
      }

      // Basic format validation for client ID (alphanumeric with common separators)
      if (!/^[a-zA-Z0-9._-]+$/.test(credentials.clientId.trim())) {
        return { valid: false, error: 'Client ID contains invalid characters' };
      }

      // Validate provider is available
      if (!isValidProviderId(providerId)) {
        return { valid: false, error: `Provider '${providerId}' is not supported` };
      }

      try {
        const provider = this.providerResolver(providerId);
        if (!provider) {
          return { valid: false, error: `Provider '${providerId}' is not available` };
        }
      } catch {
        return { valid: false, error: `Provider '${providerId}' is not available` };
      }

      // Terminal auth stores client credentials, not access tokens
      // Return a placeholder token to indicate "configured but not authenticated"
      // The actual token will be obtained via OAuth flow when needed
      return {
        valid: true,
        // Use a special marker to indicate this is a client credential config, not an access token
        accessToken: CLIENT_CREDENTIALS_MARKER,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { valid: false, error: errorMessage };
    }
  }

  /**
   * Get access token for an agent, preferring OAuth over legacy.
   *
   * Requirement 10.3: Prefer OAuth credentials over legacy api-keys.json
   *
   * Security: When providerId is specified, ONLY that provider is used.
   * No fallback to other providers to prevent credential confusion.
   *
   * @param agentId - The agent identifier
   * @param providerId - Optional provider to get token from (strict binding when specified)
   * @returns Access token or null if not available
   */
  async getTokenForAgent(
    agentId: string,
    providerId?: AuthProviderId
  ): Promise<string | null> {
    // Step 1: If provider is specified, ONLY use that provider (strict binding)
    if (providerId) {
      // Validate provider ID at runtime
      if (!isValidProviderId(providerId)) {
        console.error(`[AuthManager] Invalid provider ID: ${providerId}`);
        return null;
      }

      const oauthToken = await this.tokenManager.getAccessToken(providerId);
      // Filter out marker tokens - they are not real access tokens
      if (oauthToken && !isMarkerToken(oauthToken)) {
        console.error(`[AuthManager] Using OAuth token for agent ${agentId} (provider: ${providerId})`);
        return oauthToken;
      }

      // Provider specified but no token available - do NOT fall back to other providers
      // This prevents credential confusion between different services
      console.error(`[AuthManager] No OAuth token available for specified provider ${providerId}`);

      // Only fall back to legacy if the legacy key is for the same provider
      const legacyKeys = this.legacyApiKeys[agentId];
      if (legacyKeys?.apiKey) {
        // Check if this agent is associated with the requested provider
        const agentProvider = this.getProviderForAgent(agentId);
        if (agentProvider === providerId) {
          console.error(`[AuthManager] Using legacy API key for agent ${agentId} (provider: ${providerId})`);
          return legacyKeys.apiKey;
        }
      }

      return null;
    }

    // Step 2: No provider specified - try to find appropriate provider for agent
    const agentProvider = this.getProviderForAgent(agentId);
    if (agentProvider) {
      const token = await this.tokenManager.getAccessToken(agentProvider);
      // Filter out marker tokens - they are not real access tokens
      if (token && !isMarkerToken(token)) {
        console.error(`[AuthManager] Using OAuth token for agent ${agentId} (auto-detected provider: ${agentProvider})`);
        return token;
      }
    }

    // Step 3: Fall back to legacy api-keys.json
    const legacyKeys = this.legacyApiKeys[agentId];
    if (legacyKeys?.apiKey) {
      console.error(`[AuthManager] Using legacy API key for agent ${agentId}`);
      return legacyKeys.apiKey;
    }

    // No credentials available
    console.error(`[AuthManager] No credentials available for agent ${agentId}`);
    return null;
  }

  /**
   * Inject authentication into an agent request.
   *
   * Requirement 11.4: Inject access token according to provider's token injection method
   *
   * Security: Uses strict provider binding based on agent ID to prevent
   * credential confusion between different services.
   *
   * @param agentId - The agent identifier
   * @param request - The request object to inject auth into
   * @returns The request object with authentication injected
   */
  async injectAuth(agentId: string, request: object): Promise<object> {
    // Determine the appropriate provider for this agent
    const agentProvider = this.getProviderForAgent(agentId);

    // Try OAuth token for the agent's provider
    if (agentProvider) {
      const token = await this.tokenManager.getAccessToken(agentProvider);
      // Filter out marker tokens - they are not real access tokens
      if (token && !isMarkerToken(token)) {
        try {
          const provider = this.providerResolver(agentProvider);
          const injection = provider.getTokenInjection();

          // Validate injection configuration
          const validationError = this.validateInjectionConfig(injection);
          if (validationError) {
            console.error(`[AuthManager] Invalid injection config for ${agentProvider}: ${validationError}`);
            // Fall through to legacy handling
          } else {
            const result = this.applyTokenInjection(request, token, injection);
            if (result !== null) {
              return result;
            }
            // Injection failed (e.g., control chars in token), fall through to legacy
            console.error(`[AuthManager] Token injection failed for ${agentProvider}, trying legacy fallback`);
          }
        } catch (error) {
          // Log the error but don't expose details
          console.error(`[AuthManager] Provider resolution failed for ${agentProvider}`);
        }
      }
    }

    // Fall back to legacy API key injection (Bearer header)
    const legacyKeys = this.legacyApiKeys[agentId];
    if (legacyKeys?.apiKey) {
      const result = this.applyTokenInjection(request, legacyKeys.apiKey, {
        type: 'header',
        key: 'Authorization',
        format: 'Bearer {token}',
      });
      if (result !== null) {
        return result;
      }
      // Legacy key also has control chars - this is a security issue, return original request
      console.error(`[AuthManager] Legacy API key contains control characters, refusing to inject`);
    }

    // No auth to inject
    return request;
  }

  /**
   * Validate token injection configuration.
   * Prevents header injection attacks and unsafe configurations.
   *
   * @param injection - The injection configuration to validate
   * @returns Error message if invalid, null if valid
   */
  private validateInjectionConfig(
    injection: { type: 'header' | 'query' | 'body'; key: string; format?: string }
  ): string | null {
    // Validate key - must be alphanumeric with hyphens/underscores
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(injection.key)) {
      return 'Invalid injection key format';
    }

    // Prevent header injection via CR/LF
    if (injection.key.includes('\r') || injection.key.includes('\n')) {
      return 'Injection key contains invalid characters';
    }

    // Validate format if provided
    if (injection.format) {
      // Must contain {token} placeholder
      if (!injection.format.includes('{token}')) {
        return 'Injection format must contain {token} placeholder';
      }
      // Prevent CR/LF injection in format
      if (injection.format.includes('\r') || injection.format.includes('\n')) {
        return 'Injection format contains invalid characters';
      }
    }

    // Warn about query injection (tokens in URLs are risky)
    if (injection.type === 'query') {
      console.error('[AuthManager] Warning: Token injection via query parameter is less secure');
    }

    return null;
  }

  /**
   * Apply token injection to a request object.
   *
   * @param request - The request object
   * @param token - The access token
   * @param injection - The injection method
   * @returns The modified request object, or null if injection failed
   */
  private applyTokenInjection(
    request: object,
    token: string,
    injection: { type: 'header' | 'query' | 'body'; key: string; format?: string }
  ): object | null {
    const formattedToken = injection.format
      ? injection.format.replace('{token}', token)
      : token;

    // Validate formatted token for control characters (prevent header injection)
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x1f\x7f]/.test(formattedToken)) {
      console.error('[AuthManager] Token contains control characters, refusing to inject');
      return null; // Signal injection failure
    }

    const result = { ...request } as Record<string, unknown>;

    switch (injection.type) {
      case 'header': {
        const headers = (result.headers as Record<string, string>) ?? {};
        result.headers = { ...headers, [injection.key]: formattedToken };
        break;
      }
      case 'query': {
        const query = (result.query as Record<string, string>) ?? {};
        result.query = { ...query, [injection.key]: formattedToken };
        break;
      }
      case 'body': {
        const body = (result.body as Record<string, string>) ?? {};
        result.body = { ...body, [injection.key]: formattedToken };
        break;
      }
    }

    return result;
  }

  /**
   * Get authentication status for all providers.
   *
   * @returns Map of provider IDs to their authentication status
   */
  async getStatus(): Promise<AuthStatusMap> {
    const statusMap: AuthStatusMap = new Map();

    // Get token status from token manager
    const tokenStatus = await this.tokenManager.getStatus();

    // Get stored credentials for additional info
    const providers = await this.credentialStore.listProviders();

    for (const providerId of providers) {
      const status = tokenStatus.get(providerId) ?? 'not-configured';
      const credentials = await this.credentialStore.retrieve(providerId);

      const entry: AuthStatusEntry = {
        providerId,
        status,
        expiresAt: credentials?.expiresAt,
        scope: credentials?.scope,
        lastRefresh: credentials?.storedAt,
      };

      statusMap.set(providerId, entry);
    }

    // Add providers that are supported but not configured
    for (const providerId of VALID_PROVIDER_IDS) {
      if (!statusMap.has(providerId)) {
        statusMap.set(providerId, {
          providerId,
          status: 'not-configured',
        });
      }
    }

    return statusMap;
  }

  /**
   * Logout from a specific provider or all providers.
   *
   * Note: This clears OAuth credentials only. Legacy API keys from api-keys.json
   * are managed separately and are not affected by logout.
   *
   * @param providerId - Optional provider to logout from (all OAuth providers if not specified)
   * @throws Error if an invalid provider ID is specified
   */
  async logout(providerId?: AuthProviderId): Promise<void> {
    if (providerId) {
      // Validate provider ID at runtime
      if (!isValidProviderId(providerId)) {
        throw new Error(`Invalid provider ID for logout: ${providerId}`);
      }

      // Logout from specific provider
      console.error(`[AuthManager] Logging out from ${providerId}`);
      await this.tokenManager.clearTokens(providerId);
      await this.credentialStore.delete(providerId);
    } else {
      // Logout from all OAuth providers
      console.error(`[AuthManager] Logging out from all OAuth providers`);
      const providers = await this.credentialStore.listProviders();
      for (const pid of providers) {
        await this.tokenManager.clearTokens(pid);
      }
      await this.credentialStore.deleteAll();
    }
  }

  /**
   * Check if re-authentication is required for a provider.
   *
   * @param providerId - The provider to check
   * @returns True if re-authentication is required
   */
  async requiresReauth(providerId: AuthProviderId): Promise<boolean> {
    // Check if we have valid tokens
    const hasValid = await this.tokenManager.hasValidTokens(providerId);
    if (hasValid) {
      return false;
    }

    // Check if we have credentials at all
    const credentials = await this.credentialStore.retrieve(providerId);
    if (!credentials) {
      // No credentials stored, auth required
      return true;
    }

    // We have credentials but tokens are invalid
    // Try to refresh
    const refreshed = await this.tokenManager.forceRefresh(providerId);
    return refreshed === null;
  }

  /**
   * Get the provider for a given agent ID.
   *
   * Maps agent IDs to their OAuth providers based on keyword matching.
   *
   * WARNING: This is a heuristic-based mapping using keyword matching.
   * Agent IDs with ambiguous names (e.g., containing multiple provider keywords)
   * may be mapped to unexpected providers. For production use, consider
   * implementing explicit agent-to-provider configuration.
   *
   * @param agentId - The agent identifier
   * @returns The provider ID or undefined if not mapped
   */
  getProviderForAgent(agentId: string): AuthProviderId | undefined {
    // This is a simple mapping based on agent ID patterns
    // In a real implementation, this would come from configuration
    const agentLower = agentId.toLowerCase();

    // Check for provider keywords in order of specificity
    // More specific keywords first to avoid ambiguity
    // Note: OpenAI and Anthropic are NOT OAuth providers - they use API keys
    if (agentLower.includes('github') || agentLower.includes('copilot')) {
      return 'github';
    }
    if (agentLower.includes('google') || agentLower.includes('gemini')) {
      return 'google';
    }
    if (agentLower.includes('azure')) {
      return 'azure';
    }
    if (agentLower.includes('cognito') || agentLower.includes('aws')) {
      return 'cognito';
    }

    return undefined;
  }

  /**
   * Select the best authentication method for an agent based on precedence configuration.
   *
   * Method Precedence Strategy (Requirements 3.1, 10.3):
   * - Default precedence: oauth2 > api-key (OAuth preferred when available)
   * - Iterates through methods in precedence order
   * - Returns the first method with available credentials
   * - Fail-fast on unsupported or ambiguous providerId (configurable)
   *
   * @param agentId - The agent identifier
   * @param availableMethods - Optional list of methods the agent supports (from authMethods)
   * @param providerId - Optional explicit provider ID (strict binding when specified)
   * @returns Selection result with method type, provider, and credential availability
   * @throws AuthMethodSelectionError if fail-fast is enabled and an error occurs
   */
  async selectAuthMethod(
    agentId: string,
    availableMethods?: AuthMethodType[],
    providerId?: AuthProviderId
  ): Promise<AuthMethodSelectionResult> {
    const { methodPrecedence, failFastOnUnsupported, failFastOnAmbiguous } = this.methodPrecedenceConfig;

    // Validate explicit providerId if specified
    if (providerId !== undefined) {
      if (!isValidProviderId(providerId)) {
        const error = `Provider '${providerId}' is not supported. Valid providers: ${VALID_PROVIDER_IDS.join(', ')}`;
        if (failFastOnUnsupported) {
          throw new AuthMethodSelectionError(
            error,
            'UNSUPPORTED_METHOD',
            { providerId, supportedProviders: [...VALID_PROVIDER_IDS] }
          );
        }
        console.error(`[AuthManager] ${error}`);
        return {
          methodType: 'api-key',
          hasCredential: false,
          error,
        };
      }
    }

    // Determine which methods to consider
    const methodsToTry = availableMethods
      ? methodPrecedence.filter(m => availableMethods.includes(m))
      : methodPrecedence;

    // Check for ambiguous provider mapping (multiple providers could match)
    if (!providerId && failFastOnAmbiguous) {
      const ambiguityCheck = this.checkProviderAmbiguity(agentId);
      if (ambiguityCheck.isAmbiguous) {
        throw new AuthMethodSelectionError(
          `Ambiguous provider mapping for agent '${agentId}'. Multiple providers could match: ${ambiguityCheck.matchingProviders.join(', ')}. Specify an explicit providerId.`,
          'AMBIGUOUS_PROVIDER',
          { agentId, matchingProviders: ambiguityCheck.matchingProviders }
        );
      }
    }

    // Iterate through methods in precedence order
    for (const methodType of methodsToTry) {
      // Validate method type
      if (!isValidAuthMethodType(methodType)) {
        const error = `Unsupported authentication method: ${methodType}`;
        if (failFastOnUnsupported) {
          throw new AuthMethodSelectionError(
            error,
            'UNSUPPORTED_METHOD',
            { methodType, supportedMethods: ['oauth2', 'api-key'] }
          );
        }
        console.error(`[AuthManager] ${error}, skipping...`);
        continue;
      }

      const result = await this.tryAuthMethod(agentId, methodType, providerId);
      if (result.hasCredential) {
        console.error(`[AuthManager] Selected auth method '${methodType}' for agent '${agentId}'`);
        return result;
      }
    }

    // No credentials found for any method
    console.error(`[AuthManager] No credentials available for agent '${agentId}'`);
    return {
      methodType: methodPrecedence[0] ?? 'oauth2',
      hasCredential: false,
      error: `No credentials available for agent '${agentId}'`,
    };
  }

  /**
   * Try a specific authentication method for an agent.
   *
   * @param agentId - The agent identifier
   * @param methodType - The authentication method to try
   * @param providerId - Optional explicit provider ID
   * @returns Selection result for this method
   */
  private async tryAuthMethod(
    agentId: string,
    methodType: AuthMethodType,
    providerId?: AuthProviderId
  ): Promise<AuthMethodSelectionResult> {
    switch (methodType) {
      case 'oauth2': {
        // Determine provider for OAuth
        const effectiveProviderId = providerId ?? this.getProviderForAgent(agentId);
        if (!effectiveProviderId) {
          return {
            methodType: 'oauth2',
            hasCredential: false,
            error: `No OAuth provider mapping for agent '${agentId}'`,
          };
        }

        // Check for OAuth token
        const token = await this.tokenManager.getAccessToken(effectiveProviderId);
        if (token && !isMarkerToken(token)) {
          return {
            methodType: 'oauth2',
            providerId: effectiveProviderId,
            hasCredential: true,
          };
        }

        return {
          methodType: 'oauth2',
          providerId: effectiveProviderId,
          hasCredential: false,
          error: `No OAuth token available for provider '${effectiveProviderId}'`,
        };
      }

      case 'api-key': {
        // Check for legacy API key
        const legacyKeys = this.legacyApiKeys[agentId];
        if (legacyKeys?.apiKey) {
          return {
            methodType: 'api-key',
            hasCredential: true,
          };
        }

        return {
          methodType: 'api-key',
          hasCredential: false,
          error: `No API key available for agent '${agentId}'`,
        };
      }

      default: {
        // This should never happen due to type checking, but handle gracefully
        return {
          methodType: methodType as AuthMethodType,
          hasCredential: false,
          error: `Unknown authentication method: ${methodType}`,
        };
      }
    }
  }

  /**
   * Check if an agent ID has ambiguous provider mapping.
   *
   * Ambiguity occurs when multiple provider keywords match the agent ID.
   * For example, "azure-openai-agent" matches both "azure" and "openai".
   *
   * @param agentId - The agent identifier
   * @returns Ambiguity check result
   */
  private checkProviderAmbiguity(agentId: string): { isAmbiguous: boolean; matchingProviders: AuthProviderId[] } {
    const agentLower = agentId.toLowerCase();
    const matchingProviders: AuthProviderId[] = [];

    // Check each provider's keywords
    // Note: OpenAI and Anthropic are NOT OAuth providers - they use API keys
    // Note: oidc is checked last as a fallback for generic OIDC providers
    const providerKeywords: Record<AuthProviderId, string[]> = {
      github: ['github', 'copilot'],
      google: ['google', 'gemini'],
      azure: ['azure'],
      cognito: ['cognito', 'aws'],
      oidc: ['oidc', 'openid', 'auth0', 'okta', 'keycloak', 'onelogin', 'ping'],
    };

    for (const [provider, keywords] of Object.entries(providerKeywords)) {
      if (keywords.some(keyword => agentLower.includes(keyword))) {
        matchingProviders.push(provider as AuthProviderId);
      }
    }

    return {
      isAmbiguous: matchingProviders.length > 1,
      matchingProviders,
    };
  }

  /**
   * Get the current method precedence configuration.
   *
   * @returns The current method precedence configuration
   */
  getMethodPrecedenceConfig(): AuthMethodPrecedenceConfig {
    return { ...this.methodPrecedenceConfig };
  }
}

/**
 * Create an AuthManager with the given options.
 *
 * @param options - Configuration options
 * @returns A new AuthManager instance
 */
export function createAuthManager(options: AuthManagerOptions): AuthManager {
  return new AuthManager(options);
}
