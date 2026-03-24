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
 * Base OAuth 2.1 provider implementation.
 *
 * Provides common OAuth 2.1 URL building logic and HTTPS endpoint validation.
 *
 * @module providers/base-provider
 */

import type {
  AuthProviderId,
  AuthorizationParams,
  TokenResponse,
  TokenInjectionMethod,
  ProviderEndpoints,
} from '../types.js';
import type { IAuthProvider } from './types.js';

/**
 * Configuration for a base auth provider.
 */
export interface BaseProviderConfig {
  /** Unique provider identifier */
  id: AuthProviderId;
  /** Human-readable provider name */
  name: string;
  /** OAuth authorization endpoint URL */
  authorizationEndpoint: string;
  /** OAuth token endpoint URL */
  tokenEndpoint: string;
  /** Default scopes for this provider */
  defaultScopes: string[];
  /** Token injection method for agent requests */
  tokenInjection: TokenInjectionMethod;
  /** Client ID for OAuth flow */
  clientId?: string;
  /** Client secret for OAuth flow (optional, for confidential clients) */
  clientSecret?: string;
}

/**
 * Abstract base class for OAuth 2.1 providers.
 *
 * Implements common OAuth 2.1 functionality:
 * - Authorization URL building with required parameters
 * - HTTPS endpoint validation
 * - Token exchange and refresh
 *
 * Requirements: 3.2, 3.6, 7.5
 */
export abstract class BaseAuthProvider implements IAuthProvider {
  readonly id: AuthProviderId;
  readonly name: string;
  readonly defaultScopes: readonly string[];

  protected readonly authorizationEndpoint: string;
  protected readonly tokenEndpoint: string;
  protected readonly tokenInjection: TokenInjectionMethod;
  protected clientId?: string;
  protected clientSecret?: string;

  /**
   * Create a new base auth provider.
   * @param config - Provider configuration
   */
  constructor(config: BaseProviderConfig) {
    this.id = config.id;
    this.name = config.name;
    this.authorizationEndpoint = config.authorizationEndpoint;
    this.tokenEndpoint = config.tokenEndpoint;
    this.defaultScopes = Object.freeze([...config.defaultScopes]);
    this.tokenInjection = config.tokenInjection;
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
  }

  /**
   * Build the authorization URL for the OAuth flow.
   *
   * Includes all required OAuth 2.1 parameters:
   * - client_id
   * - redirect_uri
   * - response_type=code
   * - scope
   * - state
   * - code_challenge
   * - code_challenge_method=S256
   *
   * @param params - Authorization parameters
   * @returns The complete authorization URL
   */
  buildAuthorizationUrl(params: AuthorizationParams): string {
    const url = new URL(this.authorizationEndpoint);

    // Required OAuth 2.1 parameters
    url.searchParams.set('client_id', params.clientId);
    url.searchParams.set('redirect_uri', params.redirectUri);
    url.searchParams.set('response_type', params.responseType);
    url.searchParams.set('scope', params.scope);
    url.searchParams.set('state', params.state);

    // PKCE parameters (required for OAuth 2.1)
    url.searchParams.set('code_challenge', params.codeChallenge);
    url.searchParams.set('code_challenge_method', params.codeChallengeMethod);

    // Add any additional provider-specific parameters
    if (params.additionalParams) {
      for (const [key, value] of Object.entries(params.additionalParams)) {
        url.searchParams.set(key, value);
      }
    }

    return url.toString();
  }

  /**
   * Exchange authorization code for tokens.
   *
   * @param code - The authorization code from the callback
   * @param codeVerifier - The PKCE code verifier
   * @param redirectUri - The redirect URI used in the authorization request
   * @returns The token response
   */
  async exchangeCode(
    code: string,
    codeVerifier: string,
    redirectUri: string
  ): Promise<TokenResponse> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    });

    if (this.clientId) {
      body.set('client_id', this.clientId);
    }

    if (this.clientSecret) {
      body.set('client_secret', this.clientSecret);
    }

    const response = await fetch(this.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Token exchange failed: ${response.status} ${errorBody}`);
    }

    const data = await response.json() as Record<string, unknown>;
    return this.parseTokenResponse(data);
  }

  /**
   * Refresh an access token using a refresh token.
   *
   * @param refreshToken - The refresh token
   * @returns The new token response
   */
  async refreshToken(refreshToken: string): Promise<TokenResponse> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });

    if (this.clientId) {
      body.set('client_id', this.clientId);
    }

    if (this.clientSecret) {
      body.set('client_secret', this.clientSecret);
    }

    const response = await fetch(this.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Token refresh failed: ${response.status} ${errorBody}`);
    }

    const data = await response.json() as Record<string, unknown>;
    return this.parseTokenResponse(data);
  }

  /**
   * Validate provider configuration.
   *
   * Ensures all endpoints use HTTPS (required for OAuth 2.1).
   *
   * @throws Error if configuration is invalid
   */
  validateConfig(): void {
    this.validateHttpsEndpoint(this.authorizationEndpoint, 'authorization');
    this.validateHttpsEndpoint(this.tokenEndpoint, 'token');
  }

  /**
   * Get token injection method for agent requests.
   *
   * @returns The token injection configuration
   */
  getTokenInjection(): TokenInjectionMethod {
    return this.tokenInjection;
  }

  /**
   * Get the provider endpoints.
   *
   * @returns The provider endpoint URLs
   */
  getEndpoints(): ProviderEndpoints {
    return {
      authorizationEndpoint: this.authorizationEndpoint,
      tokenEndpoint: this.tokenEndpoint,
    };
  }

  /**
   * Set the client credentials.
   *
   * @param clientId - The OAuth client ID
   * @param clientSecret - The OAuth client secret (optional)
   */
  setClientCredentials(clientId: string, clientSecret?: string): void {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  /**
   * Validate that an endpoint uses HTTPS.
   *
   * @param endpoint - The endpoint URL to validate
   * @param name - The name of the endpoint (for error messages)
   * @throws Error if the endpoint does not use HTTPS
   */
  protected validateHttpsEndpoint(endpoint: string, name: string): void {
    const url = new URL(endpoint);
    if (url.protocol !== 'https:') {
      throw new Error(
        `${this.name} ${name} endpoint must use HTTPS: ${endpoint}`
      );
    }
  }

  /**
   * Parse a token response from the provider.
   *
   * @param data - The raw response data
   * @returns The parsed token response
   */
  protected parseTokenResponse(data: Record<string, unknown>): TokenResponse {
    const accessToken = data.access_token;
    if (typeof accessToken !== 'string') {
      throw new Error('Invalid token response: missing access_token');
    }

    const tokenType = data.token_type;
    if (typeof tokenType !== 'string') {
      throw new Error('Invalid token response: missing token_type');
    }

    const response: TokenResponse = {
      accessToken,
      tokenType,
    };

    // Optional fields
    if (typeof data.expires_in === 'number') {
      response.expiresIn = data.expires_in;
    }

    if (typeof data.refresh_token === 'string') {
      response.refreshToken = data.refresh_token;
    }

    if (typeof data.scope === 'string') {
      response.scope = data.scope;
    }

    if (typeof data.id_token === 'string') {
      response.idToken = data.id_token;
    }

    return response;
  }
}
