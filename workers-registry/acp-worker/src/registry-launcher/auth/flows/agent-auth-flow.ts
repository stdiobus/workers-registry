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
 * Browser-based OAuth 2.1 Authorization Code flow with PKCE.
 *
 * Orchestrates the complete agent authentication flow:
 * 1. Generate PKCE code verifier and challenge
 * 2. Generate state parameter for CSRF protection
 * 3. Start the callback server on loopback address
 * 4. Build the authorization URL with all required parameters
 * 5. Launch the system default browser to the authorization URL
 * 6. Wait for the callback with the authorization code
 * 7. Validate the state parameter
 * 8. Exchange the authorization code for tokens
 * 9. Return the authentication result
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4
 *
 * @module flows/agent-auth-flow
 */

import type {
  AuthProviderId,
  AuthResult,
  AgentAuthOptions,
  AuthorizationParams,
  TokenResponse,
} from '../types.js';
import { createSession, DEFAULT_SESSION_TIMEOUT_MS } from '../session.js';
import type { AuthSession } from '../session.js';
import { CallbackServer } from './callback-server.js';
import type { IAuthProvider } from '../providers/types.js';

/**
 * Default timeout for the agent auth flow in milliseconds (5 minutes).
 */
export const DEFAULT_AUTH_TIMEOUT_MS = DEFAULT_SESSION_TIMEOUT_MS;

/**
 * Dependencies for the agent auth flow.
 */
export interface AgentAuthFlowDependencies {
  /** Function to get a provider by ID */
  getProvider: (providerId: AuthProviderId) => IAuthProvider;
  /** Function to store tokens after successful authentication */
  storeTokens: (providerId: AuthProviderId, tokens: TokenResponse) => Promise<void>;
  /** Optional custom browser launcher (for testing) */
  launchBrowser?: (url: string) => Promise<void>;
}

/**
 * Agent auth flow - browser-based OAuth 2.1 Authorization Code flow with PKCE.
 *
 * This class orchestrates the complete OAuth 2.1 agent authentication flow,
 * handling PKCE generation, browser launch, callback handling, and token exchange.
 */
export class AgentAuthFlow {
  private readonly getProvider: (providerId: AuthProviderId) => IAuthProvider;
  private readonly storeTokens: (providerId: AuthProviderId, tokens: TokenResponse) => Promise<void>;
  private readonly launchBrowser: (url: string) => Promise<void>;

  /**
   * Create a new agent auth flow.
   *
   * @param dependencies - Flow dependencies including provider resolver and token storage
   */
  constructor(dependencies: AgentAuthFlowDependencies) {
    this.getProvider = dependencies.getProvider;
    this.storeTokens = dependencies.storeTokens;
    this.launchBrowser = dependencies.launchBrowser ?? openSystemBrowser;
  }

  /**
   * Execute the agent auth flow.
   *
   * Performs the complete OAuth 2.1 Authorization Code flow with PKCE:
   * 1. Creates an auth session with PKCE and state parameters
   * 2. Starts a callback server on loopback address
   * 3. Builds and opens the authorization URL in the system browser
   * 4. Waits for the OAuth callback
   * 5. Validates the state parameter
   * 6. Exchanges the authorization code for tokens
   * 7. Stores the tokens and returns the result
   *
   * @param providerId - The provider to authenticate with
   * @param options - Optional flow configuration
   * @returns Authentication result indicating success or failure
   */
  async execute(
    providerId: AuthProviderId,
    options?: AgentAuthOptions
  ): Promise<AuthResult> {
    const timeoutMs = options?.timeoutMs ?? DEFAULT_AUTH_TIMEOUT_MS;
    let callbackServer: CallbackServer | null = null;
    let session: AuthSession | null = null;

    try {
      // Step 1: Get the provider
      const provider = this.getProvider(providerId);

      // Step 2: Create auth session with PKCE and state parameters
      // (Requirement 3.1: Initiate OAuth 2.1 Authorization Code flow with PKCE)
      session = createSession(providerId, timeoutMs);
      console.error(`[AgentAuthFlow] Created auth session ${session.sessionId} for ${providerId}`);

      // Step 3: Start the callback server on loopback address
      // (Requirement 3.3: Start Callback_Server on loopback address)
      callbackServer = new CallbackServer();
      const redirectUri = await callbackServer.start();
      console.error(`[AgentAuthFlow] Callback server started at ${redirectUri}`);

      // Step 4: Build the authorization URL with all required parameters
      // (Requirement 3.2: Open browser with required OAuth parameters)
      const clientId = options?.clientId ?? this.getDefaultClientId(providerId);
      const scopes = options?.scopes ?? [...provider.defaultScopes];

      const authParams: AuthorizationParams = {
        clientId,
        redirectUri,
        scope: scopes.join(' '),
        state: session.state,
        codeChallenge: session.codeChallenge,
        codeChallengeMethod: 'S256',
        responseType: 'code',
      };

      const authorizationUrl = provider.buildAuthorizationUrl(authParams);
      console.error(`[AgentAuthFlow] Authorization URL built for ${providerId}`);

      // Step 5: Launch the system default browser to the authorization URL
      // (Requirement 3.2: Open system default browser)
      await this.launchBrowser(authorizationUrl);
      console.error(`[AgentAuthFlow] Browser launched for ${providerId} authentication`);

      // Step 6: Wait for the callback with the authorization code
      // (Requirement 3.4: Receive authorization code via callback)
      const callbackResult = await callbackServer.waitForCallback(session.remainingTime());

      // Check for OAuth error in callback (discriminated union check)
      if (!callbackResult.success) {
        console.error(`[AgentAuthFlow] OAuth error: ${callbackResult.error} - ${callbackResult.errorDescription}`);
        return {
          success: false,
          providerId,
          error: {
            code: 'PROVIDER_ERROR',
            message: callbackResult.errorDescription || callbackResult.error,
            details: {
              oauthError: callbackResult.error,
              oauthErrorDescription: callbackResult.errorDescription,
            },
          },
        };
      }

      // Step 7: Validate the state parameter
      // (Requirement 2.2, 2.3: Validate state parameter)
      if (!session.validateState(callbackResult.state)) {
        console.error(`[AgentAuthFlow] State validation failed for ${providerId}`);
        return {
          success: false,
          providerId,
          error: {
            code: 'INVALID_STATE',
            message: 'State parameter validation failed. The authorization response may have been tampered with.',
          },
        };
      }

      // Step 8: Exchange the authorization code for tokens
      // (Requirement 3.4: Exchange code for tokens with code verifier)
      // Note: callbackResult.code is guaranteed to exist here due to discriminated union
      console.error(`[AgentAuthFlow] Exchanging authorization code for tokens`);
      const tokenResponse = await provider.exchangeCode(
        callbackResult.code,
        session.codeVerifier,
        redirectUri
      );

      // Step 9: Store the tokens
      await this.storeTokens(providerId, tokenResponse);
      console.error(`[AgentAuthFlow] Tokens stored successfully for ${providerId}`);

      return {
        success: true,
        providerId,
      };
    } catch (error) {
      console.error(`[AgentAuthFlow] Authentication failed for ${providerId}: ${error}`);

      // Determine error type
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Check for timeout
      if (errorMessage.includes('timeout') || errorMessage.includes('Timeout')) {
        return {
          success: false,
          providerId,
          error: {
            code: 'TIMEOUT',
            message: 'Authentication flow timed out. Please try again.',
          },
        };
      }

      // Check for network errors
      if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('ENOTFOUND') || errorMessage.includes('fetch')) {
        return {
          success: false,
          providerId,
          error: {
            code: 'NETWORK_ERROR',
            message: `Network error during authentication: ${errorMessage}`,
          },
        };
      }

      // Generic error
      return {
        success: false,
        providerId,
        error: {
          code: 'PROVIDER_ERROR',
          message: errorMessage,
        },
      };
    } finally {
      // Clean up: Stop the callback server
      if (callbackServer) {
        try {
          await callbackServer.stop();
          console.error(`[AgentAuthFlow] Callback server stopped`);
        } catch (stopError) {
          console.error(`[AgentAuthFlow] Error stopping callback server: ${stopError}`);
        }
      }
    }
  }

  /**
   * Get the default client ID for a provider.
   *
   * This is a placeholder that should be overridden with actual client IDs
   * from configuration or environment variables.
   *
   * @param providerId - The provider identifier
   * @returns The default client ID for the provider
   */
  private getDefaultClientId(providerId: AuthProviderId): string {
    // In a real implementation, these would come from configuration
    // For now, return a placeholder that indicates configuration is needed
    const envKey = `OAUTH_${providerId.toUpperCase()}_CLIENT_ID`;
    const clientId = process.env[envKey];

    if (!clientId) {
      throw new Error(
        `No client ID configured for ${providerId}. ` +
        `Set the ${envKey} environment variable or provide clientId in options.`
      );
    }

    return clientId;
  }
}

/**
 * Open a URL in the system default browser.
 *
 * Uses platform-specific commands to launch the browser:
 * - macOS: `open`
 * - Windows: `start`
 * - Linux: `xdg-open`
 *
 * Security: Uses execFile with argument arrays to prevent command injection.
 * Validates URL protocol before launching.
 *
 * @param url - The URL to open
 * @throws Error if the browser cannot be launched or URL is invalid
 */
export async function openSystemBrowser(url: string): Promise<void> {
  // Validate URL to prevent command injection and ensure it's a valid HTTP(S) URL
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error('Invalid URL format');
  }

  // Only allow http and https protocols for security
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error(`Invalid URL protocol: ${parsedUrl.protocol}. Only http: and https: are allowed.`);
  }

  const platform = process.platform;

  // Use execFile with argument arrays to prevent shell injection
  // This is safer than exec() with string interpolation
  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const execFileAsync = promisify(execFile);

  try {
    switch (platform) {
      case 'darwin':
        // macOS: open command with URL as argument
        await execFileAsync('open', [url]);
        break;
      case 'win32':
        // Windows: use cmd.exe /c start with proper escaping
        // Note: Windows requires special handling for URLs with special chars
        await execFileAsync('cmd.exe', ['/c', 'start', '', url]);
        break;
      default:
        // Linux and others: xdg-open with URL as argument
        await execFileAsync('xdg-open', [url]);
        break;
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to open browser: ${errorMessage}`);
  }
}

/**
 * Create an agent auth flow with the given dependencies.
 *
 * @param dependencies - Flow dependencies
 * @returns A new AgentAuthFlow instance
 */
export function createAgentAuthFlow(dependencies: AgentAuthFlowDependencies): AgentAuthFlow {
  return new AgentAuthFlow(dependencies);
}
