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
   * @param providerId - The provider to validate against
   * @param credentials - The collected credentials
   * @returns Validation result
   */
  private async validateTerminalCredentials(
    providerId: AuthProviderId,
    credentials: { clientId: string; clientSecret?: string }
  ): Promise<{ valid: boolean; error?: string; accessToken?: string }> {
    try {
      // For terminal auth, we store the client credentials directly
      // The actual token will be obtained when needed via the provider
      // For now, we just validate that the credentials are non-empty
      if (!credentials.clientId || credentials.clientId.trim().length === 0) {
        return { valid: false, error: 'Client ID is required' };
      }

      // If provider requires client secret, validate it
      const provider = this.providerResolver(providerId);
      if (provider) {
        // Basic validation passed
        return { valid: true, accessToken: '' };
      }

      return { valid: false, error: `Provider '${providerId}' is not available` };
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
   * @param agentId - The agent identifier
   * @param providerId - Optional provider to get token from
   * @returns Access token or null if not available
   */
  async getTokenForAgent(
    agentId: string,
    providerId?: AuthProviderId
  ): Promise<string | null> {
    // Step 1: Try to get OAuth token if provider is specified
    if (providerId) {
      const oauthToken = await this.tokenManager.getAccessToken(providerId);
      if (oauthToken) {
        console.error(`[AuthManager] Using OAuth token for agent ${agentId} (provider: ${providerId})`);
        return oauthToken;
      }
    }

    // Step 2: Try to find OAuth token from any configured provider
    // Check all providers that have stored credentials
    const providers = await this.credentialStore.listProviders();
    for (const pid of providers) {
      const token = await this.tokenManager.getAccessToken(pid);
      if (token) {
        console.error(`[AuthManager] Using OAuth token for agent ${agentId} (provider: ${pid})`);
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
   * @param agentId - The agent identifier
   * @param request - The request object to inject auth into
   * @returns The request object with authentication injected
   */
  async injectAuth(agentId: string, request: object): Promise<object> {
    // Find the provider with valid credentials
    const providers = await this.credentialStore.listProviders();

    for (const providerId of providers) {
      const token = await this.tokenManager.getAccessToken(providerId);
      if (token) {
        try {
          const provider = this.providerResolver(providerId);
          const injection = provider.getTokenInjection();

          return this.applyTokenInjection(request, token, injection);
        } catch {
          // Provider not available, continue to next
          continue;
        }
      }
    }

    // Fall back to legacy API key injection (Bearer header)
    const legacyKeys = this.legacyApiKeys[agentId];
    if (legacyKeys?.apiKey) {
      return this.applyTokenInjection(request, legacyKeys.apiKey, {
        type: 'header',
        key: 'Authorization',
        format: 'Bearer {token}',
      });
    }

    // No auth to inject
    return request;
  }

  /**
   * Apply token injection to a request object.
   *
   * @param request - The request object
   * @param token - The access token
   * @param injection - The injection method
   * @returns The modified request object
   */
  private applyTokenInjection(
    request: object,
    token: string,
    injection: { type: 'header' | 'query' | 'body'; key: string; format?: string }
  ): object {
    const formattedToken = injection.format
      ? injection.format.replace('{token}', token)
      : token;

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
   * @param providerId - Optional provider to logout from (all if not specified)
   */
  async logout(providerId?: AuthProviderId): Promise<void> {
    if (providerId) {
      // Logout from specific provider
      console.error(`[AuthManager] Logging out from ${providerId}`);
      await this.tokenManager.clearTokens(providerId);
      await this.credentialStore.delete(providerId);
    } else {
      // Logout from all providers
      console.error(`[AuthManager] Logging out from all providers`);
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
   * Maps agent IDs to their OAuth providers based on configuration.
   *
   * @param agentId - The agent identifier
   * @returns The provider ID or undefined if not mapped
   */
  getProviderForAgent(agentId: string): AuthProviderId | undefined {
    // This is a simple mapping based on agent ID patterns
    // In a real implementation, this would come from configuration
    const agentLower = agentId.toLowerCase();

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
