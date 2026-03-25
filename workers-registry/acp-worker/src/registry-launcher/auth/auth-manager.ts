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
} from './types.js';
import { isValidProviderId, VALID_PROVIDER_IDS } from './types.js';

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
 */
export class AuthManager {
  private readonly credentialStore: ICredentialStore;
  private readonly tokenManager: ITokenManager;
  private readonly legacyApiKeys: Record<string, AgentApiKeys>;
  private readonly providerResolver: (providerId: AuthProviderId) => IAuthProvider;

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
    } else {
      // Legacy constructor
      this.credentialStore = optionsOrCredentialStore;
      this.tokenManager = tokenManager!;
      this.legacyApiKeys = legacyApiKeys ?? {};
      this.providerResolver = getProvider;
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
   * Requirement 3.1: Initiate OAuth 2.1 Authorization Code flow with PKCE
   *
   * @param providerId - The provider to authenticate with
   * @param options - Optional flow configuration
   * @returns Authentication result indicating success or failure
   */
  async authenticateAgent(
    providerId: AuthProviderId,
    options?: AgentAuthOptions
  ): Promise<AuthResult> {
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

    // Check if provider is registered
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
      const result = await terminalAuthFlow.execute(providerId);

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
    if (agentLower.includes('openai') || agentLower.includes('gpt')) {
      return 'openai';
    }
    if (agentLower.includes('anthropic') || agentLower.includes('claude')) {
      return 'anthropic';
    }
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
