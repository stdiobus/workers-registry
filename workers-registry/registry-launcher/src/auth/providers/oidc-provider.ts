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
 * Generic OIDC Discovery provider implementation.
 *
 * Supports any OIDC-compliant provider via issuer-based discovery
 * (.well-known/openid-configuration) with manual endpoint override fallback.
 *
 * Requirements: 7a.1, 7a.2, 7a.3, 7a.5, 7a.6
 *
 * @module providers/oidc-provider
 */

import * as crypto from 'crypto';
import { BaseAuthProvider } from './base-provider.js';
import type { TokenResponse } from '../types.js';

// =============================================================================
// JWKS Types
// =============================================================================

/**
 * JSON Web Key (JWK) structure for RSA keys.
 */
export interface JWK {
  /** Key type (e.g., 'RSA') */
  kty: string;
  /** Key ID - used to match keys in JWKS */
  kid?: string;
  /** Algorithm (e.g., 'RS256') */
  alg?: string;
  /** Key use (e.g., 'sig' for signature) */
  use?: string;
  /** RSA modulus (base64url encoded) */
  n?: string;
  /** RSA exponent (base64url encoded) */
  e?: string;
  /** X.509 certificate chain */
  x5c?: string[];
}

/**
 * JSON Web Key Set (JWKS) structure.
 */
export interface JWKS {
  /** Array of JSON Web Keys */
  keys: JWK[];
}

/**
 * Cached JWKS with metadata.
 */
export interface CachedJWKS {
  /** The JWKS data */
  jwks: JWKS;
  /** Timestamp when the JWKS was fetched */
  fetchedAt: number;
  /** TTL in milliseconds */
  ttlMs: number;
}

/**
 * Decoded JWT header.
 */
export interface JWTHeader {
  /** Algorithm used for signing */
  alg: string;
  /** Token type (usually 'JWT') */
  typ?: string;
  /** Key ID - used to find the signing key in JWKS */
  kid?: string;
}

/**
 * ID Token claims structure.
 * Requirements: 7a.5
 */
export interface IDTokenClaims {
  /** Issuer - must match the configured issuer */
  iss: string;
  /** Subject - unique identifier for the user */
  sub: string;
  /** Audience - must contain the client_id */
  aud: string | string[];
  /** Expiration time (Unix timestamp) */
  exp: number;
  /** Issued at time (Unix timestamp) */
  iat: number;
  /** Nonce - if provided in auth request, must match */
  nonce?: string;
  /** Authentication time */
  auth_time?: number;
  /** Access token hash */
  at_hash?: string;
  /** Additional claims */
  [key: string]: unknown;
}

/**
 * Result of ID token validation.
 */
export interface IDTokenValidationResult {
  /** Whether validation was successful */
  valid: boolean;
  /** The decoded claims if valid */
  claims?: IDTokenClaims;
  /** Error message if validation failed */
  error?: string;
}

/**
 * Options for ID token validation.
 */
export interface IDTokenValidationOptions {
  /** Expected audience (client_id) */
  audience: string;
  /** Expected nonce (if used in auth request) */
  nonce?: string;
  /** Clock skew tolerance in seconds (default: 60) */
  clockSkewSeconds?: number;
}

/**
 * OIDC Discovery document structure.
 * Contains the endpoints and capabilities advertised by the OIDC provider.
 */
export interface OIDCDiscoveryDocument {
  /** The issuer identifier (must match the issuer URL) */
  issuer: string;
  /** URL of the authorization endpoint */
  authorization_endpoint: string;
  /** URL of the token endpoint */
  token_endpoint: string;
  /** URL of the JWKS endpoint for token validation */
  jwks_uri?: string;
  /** URL of the userinfo endpoint */
  userinfo_endpoint?: string;
  /** Supported response types */
  response_types_supported?: string[];
  /** Supported grant types */
  grant_types_supported?: string[];
  /** Supported scopes */
  scopes_supported?: string[];
  /** Supported token endpoint authentication methods */
  token_endpoint_auth_methods_supported?: string[];
  /** Supported code challenge methods for PKCE */
  code_challenge_methods_supported?: string[];
}

/**
 * Configuration options for OIDC provider.
 */
export interface OIDCProviderConfig {
  /**
   * The OIDC issuer URL (e.g., 'https://auth.example.com').
   * Used for discovery via {issuer}/.well-known/openid-configuration.
   */
  issuer: string;

  /**
   * Manual override for authorization endpoint.
   * Used when discovery is unavailable.
   * Requirements: 7a.2
   */
  authorizationEndpoint?: string;

  /**
   * Manual override for token endpoint.
   * Used when discovery is unavailable.
   * Requirements: 7a.2
   */
  tokenEndpoint?: string;

  /**
   * Manual override for JWKS URI.
   * Used for token validation when discovery is unavailable.
   */
  jwksUri?: string;

  /** OAuth client ID */
  clientId?: string;

  /** OAuth client secret (optional, for confidential clients) */
  clientSecret?: string;

  /**
   * Token endpoint authentication method.
   * Supported: 'client_secret_post', 'client_secret_basic'
   * Default: 'client_secret_post'
   * Requirements: 7a.7
   */
  tokenEndpointAuthMethod?: 'client_secret_post' | 'client_secret_basic';

  /**
   * Custom scopes to use instead of defaults.
   * Default: ['openid', 'profile']
   */
  scopes?: string[];

  /**
   * Whether to skip discovery and use manual endpoints only.
   * Default: false (discovery is attempted first)
   */
  skipDiscovery?: boolean;

  /**
   * Timeout for discovery request in milliseconds.
   * Default: 10000 (10 seconds)
   */
  discoveryTimeoutMs?: number;
}

/**
 * Result of OIDC discovery operation.
 */
export interface OIDCDiscoveryResult {
  /** Whether discovery was successful */
  success: boolean;
  /** The discovery document if successful */
  document?: OIDCDiscoveryDocument;
  /** Error message if discovery failed */
  error?: string;
}

/**
 * Generic OIDC Discovery provider.
 *
 * Supports any OIDC-compliant provider (Auth0, Okta, Keycloak, etc.)
 * via issuer-based discovery with manual endpoint override fallback.
 *
 * Features:
 * - Automatic discovery via .well-known/openid-configuration
 * - Manual endpoint override when discovery unavailable
 * - PKCE S256 enforcement (per Requirement 7a.3)
 * - Cached discovery document
 * - Support for client_secret_post and client_secret_basic auth methods
 *
 * Default scopes: openid, profile
 * Token injection: Bearer header
 *
 * Requirements: 7a.1, 7a.2, 7a.3, 7a.7
 */
export class OIDCProvider extends BaseAuthProvider {
  private readonly issuer: string;
  private readonly tokenEndpointAuthMethod: 'client_secret_post' | 'client_secret_basic';
  private readonly discoveryTimeoutMs: number;
  private readonly skipDiscovery: boolean;
  private readonly manualJwksUri?: string;

  /** Discovered authorization endpoint (overrides base class endpoint after discovery) */
  private discoveredAuthorizationEndpoint?: string;

  /** Discovered token endpoint (overrides base class endpoint after discovery) */
  private discoveredTokenEndpoint?: string;

  /** Cached discovery document */
  private discoveryDocument?: OIDCDiscoveryDocument;

  /** Whether discovery has been attempted */
  private discoveryAttempted = false;

  /** Cached JWKS for token validation */
  private cachedJWKS?: CachedJWKS;

  /** Default timeout for discovery requests (10 seconds) */
  private static readonly DEFAULT_DISCOVERY_TIMEOUT_MS = 10000;

  /** Default JWKS cache TTL (1 hour) */
  private static readonly DEFAULT_JWKS_CACHE_TTL_MS = 60 * 60 * 1000;

  /** Default clock skew tolerance for token validation (60 seconds) */
  private static readonly DEFAULT_CLOCK_SKEW_SECONDS = 60;

  constructor(config: OIDCProviderConfig) {
    // Validate issuer URL
    OIDCProvider.validateIssuer(config.issuer);

    // Determine initial endpoints - use manual overrides or placeholders for discovery
    const authorizationEndpoint = config.authorizationEndpoint ||
      `${config.issuer}/authorize`;
    const tokenEndpoint = config.tokenEndpoint ||
      `${config.issuer}/oauth/token`;

    // Validate manual endpoints if provided
    if (config.authorizationEndpoint) {
      OIDCProvider.validateEndpoint(config.authorizationEndpoint, 'authorization');
    }
    if (config.tokenEndpoint) {
      OIDCProvider.validateEndpoint(config.tokenEndpoint, 'token');
    }
    if (config.jwksUri) {
      OIDCProvider.validateEndpoint(config.jwksUri, 'jwks');
    }

    super({
      id: 'oidc',
      name: 'Generic OIDC',
      authorizationEndpoint,
      tokenEndpoint,
      defaultScopes: config.scopes || ['openid', 'profile'],
      tokenInjection: {
        type: 'header',
        key: 'Authorization',
        format: 'Bearer {token}',
      },
      clientId: config.clientId,
      clientSecret: config.clientSecret,
    });

    this.issuer = config.issuer;
    this.tokenEndpointAuthMethod = config.tokenEndpointAuthMethod || 'client_secret_post';
    this.discoveryTimeoutMs = config.discoveryTimeoutMs || OIDCProvider.DEFAULT_DISCOVERY_TIMEOUT_MS;
    this.skipDiscovery = config.skipDiscovery || false;
    this.manualJwksUri = config.jwksUri;

    // If manual endpoints are provided, mark discovery as not needed
    if (config.authorizationEndpoint && config.tokenEndpoint) {
      this.discoveryAttempted = true;
    }
  }

  /**
   * Validate the issuer URL.
   * @param issuer - The issuer URL to validate
   * @throws Error if issuer is invalid
   */
  private static validateIssuer(issuer: string): void {
    if (!issuer || typeof issuer !== 'string') {
      throw new Error('OIDC issuer is required');
    }

    const trimmed = issuer.trim();
    if (trimmed !== issuer) {
      throw new Error('OIDC issuer must not contain leading/trailing whitespace');
    }

    if (issuer.length === 0) {
      throw new Error('OIDC issuer cannot be empty');
    }

    // Parse and validate URL
    let url: URL;
    try {
      url = new URL(issuer);
    } catch {
      throw new Error(`OIDC issuer must be a valid URL: ${issuer}`);
    }

    // Must be HTTPS
    if (url.protocol !== 'https:') {
      throw new Error(`OIDC issuer must use HTTPS: ${issuer}`);
    }

    // Must not have embedded credentials
    if (url.username || url.password) {
      throw new Error('OIDC issuer must not contain embedded credentials');
    }

    // Must not have query string or fragment
    if (url.search || url.hash) {
      throw new Error('OIDC issuer must not contain query string or fragment');
    }
  }

  /**
   * Validate an endpoint URL.
   * @param endpoint - The endpoint URL to validate
   * @param name - The name of the endpoint for error messages
   * @throws Error if endpoint is invalid
   */
  private static validateEndpoint(endpoint: string, name: string): void {
    if (!endpoint || typeof endpoint !== 'string') {
      throw new Error(`OIDC ${name} endpoint is required`);
    }

    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      throw new Error(`OIDC ${name} endpoint must be a valid URL: ${endpoint}`);
    }

    if (url.protocol !== 'https:') {
      throw new Error(`OIDC ${name} endpoint must use HTTPS: ${endpoint}`);
    }

    if (url.username || url.password) {
      throw new Error(`OIDC ${name} endpoint must not contain embedded credentials`);
    }
  }

  /**
   * Get the issuer URL.
   * @returns The issuer URL
   */
  getIssuer(): string {
    return this.issuer;
  }

  /**
   * Get the JWKS URI for token validation.
   * Returns the discovered or manually configured JWKS URI.
   * @returns The JWKS URI or undefined if not available
   */
  getJwksUri(): string | undefined {
    return this.discoveryDocument?.jwks_uri || this.manualJwksUri;
  }

  /**
   * Get the cached discovery document.
   * @returns The discovery document or undefined if not discovered
   */
  getDiscoveryDocument(): OIDCDiscoveryDocument | undefined {
    return this.discoveryDocument;
  }

  /**
   * Check if discovery has been performed.
   * @returns True if discovery was attempted
   */
  isDiscoveryAttempted(): boolean {
    return this.discoveryAttempted;
  }

  /**
   * Get the effective authorization endpoint.
   * Returns discovered endpoint if available, otherwise the initial endpoint.
   * @returns The authorization endpoint URL
   */
  getAuthorizationEndpoint(): string {
    return this.discoveredAuthorizationEndpoint || this.getEndpoints().authorizationEndpoint;
  }

  /**
   * Get the effective token endpoint.
   * Returns discovered endpoint if available, otherwise the initial endpoint.
   * @returns The token endpoint URL
   */
  getTokenEndpoint(): string {
    return this.discoveredTokenEndpoint || this.getEndpoints().tokenEndpoint;
  }

  /**
   * Perform OIDC discovery by fetching the .well-known/openid-configuration.
   *
   * This method fetches and parses the discovery document, updating the
   * provider's endpoints if successful.
   *
   * Requirements: 7a.1
   *
   * @returns The discovery result
   */
  async discover(): Promise<OIDCDiscoveryResult> {
    if (this.skipDiscovery) {
      return {
        success: false,
        error: 'Discovery skipped by configuration',
      };
    }

    const discoveryUrl = `${this.issuer}/.well-known/openid-configuration`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.discoveryTimeoutMs);

    try {
      const response = await fetch(discoveryUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
        signal: controller.signal,
        redirect: 'error', // Don't follow redirects for security
      });

      if (!response.ok) {
        this.discoveryAttempted = true;
        return {
          success: false,
          error: `Discovery failed: HTTP ${response.status} ${response.statusText}`,
        };
      }

      const document = await response.json() as OIDCDiscoveryDocument;

      // Validate required fields
      const validationError = this.validateDiscoveryDocument(document);
      if (validationError) {
        this.discoveryAttempted = true;
        return {
          success: false,
          error: validationError,
        };
      }

      // Cache the discovery document
      this.discoveryDocument = document;
      this.discoveryAttempted = true;

      // Store discovered endpoints
      this.discoveredAuthorizationEndpoint = document.authorization_endpoint;
      this.discoveredTokenEndpoint = document.token_endpoint;

      return {
        success: true,
        document,
      };
    } catch (error) {
      this.discoveryAttempted = true;

      if (error instanceof Error && error.name === 'AbortError') {
        return {
          success: false,
          error: `Discovery timed out after ${this.discoveryTimeoutMs}ms`,
        };
      }

      return {
        success: false,
        error: `Discovery failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Validate the discovery document.
   * @param document - The discovery document to validate
   * @returns Error message if invalid, undefined if valid
   */
  private validateDiscoveryDocument(document: OIDCDiscoveryDocument): string | undefined {
    if (!document.issuer) {
      return 'Discovery document missing required field: issuer';
    }

    if (!document.authorization_endpoint) {
      return 'Discovery document missing required field: authorization_endpoint';
    }

    if (!document.token_endpoint) {
      return 'Discovery document missing required field: token_endpoint';
    }

    // Validate issuer matches
    // Note: Some providers may have trailing slash differences
    const normalizedDocIssuer = document.issuer.replace(/\/$/, '');
    const normalizedConfigIssuer = this.issuer.replace(/\/$/, '');
    if (normalizedDocIssuer !== normalizedConfigIssuer) {
      return `Discovery document issuer mismatch: expected ${this.issuer}, got ${document.issuer}`;
    }

    // Validate endpoints are HTTPS
    try {
      OIDCProvider.validateEndpoint(document.authorization_endpoint, 'authorization');
      OIDCProvider.validateEndpoint(document.token_endpoint, 'token');
      if (document.jwks_uri) {
        OIDCProvider.validateEndpoint(document.jwks_uri, 'jwks');
      }
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }

    return undefined;
  }

  /**
   * Ensure discovery has been performed before operations that need endpoints.
   * If discovery hasn't been attempted and manual endpoints weren't provided,
   * this will perform discovery.
   */
  async ensureDiscovered(): Promise<void> {
    if (!this.discoveryAttempted && !this.skipDiscovery) {
      await this.discover();
    }
  }

  /**
   * Exchange authorization code for tokens.
   *
   * Overrides base implementation to support different token endpoint
   * authentication methods (client_secret_post, client_secret_basic).
   *
   * Requirements: 7a.7
   *
   * @param code - The authorization code from the callback
   * @param codeVerifier - The PKCE code verifier
   * @param redirectUri - The redirect URI used in the authorization request
   * @returns The token response
   */
  override async exchangeCode(
    code: string,
    codeVerifier: string,
    redirectUri: string
  ): Promise<TokenResponse> {
    // Ensure discovery has been performed
    await this.ensureDiscovered();

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    });

    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    };

    // Handle different token endpoint auth methods
    if (this.tokenEndpointAuthMethod === 'client_secret_basic') {
      // client_secret_basic: credentials in Authorization header
      if (this.clientId && this.clientSecret) {
        const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
        headers['Authorization'] = `Basic ${credentials}`;
      }
      if (this.clientId) {
        body.set('client_id', this.clientId);
      }
    } else {
      // client_secret_post: credentials in request body (default)
      if (this.clientId) {
        body.set('client_id', this.clientId);
      }
      if (this.clientSecret) {
        body.set('client_secret', this.clientSecret);
      }
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      BaseAuthProvider.DEFAULT_REQUEST_TIMEOUT_MS
    );

    // Use discovered endpoint if available
    const tokenEndpoint = this.getTokenEndpoint();

    try {
      const response = await fetch(tokenEndpoint, {
        method: 'POST',
        headers,
        body: body.toString(),
        signal: controller.signal,
        redirect: 'error',
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Token exchange failed: ${response.status} ${errorBody}`);
      }

      const data = await response.json() as Record<string, unknown>;
      return this.parseTokenResponse(data);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Token exchange timed out after ${BaseAuthProvider.DEFAULT_REQUEST_TIMEOUT_MS}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Refresh an access token using a refresh token.
   *
   * Overrides base implementation to support different token endpoint
   * authentication methods.
   *
   * @param refreshToken - The refresh token
   * @returns The new token response
   */
  override async refreshToken(refreshToken: string): Promise<TokenResponse> {
    // Ensure discovery has been performed
    await this.ensureDiscovered();

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });

    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    };

    // Handle different token endpoint auth methods
    if (this.tokenEndpointAuthMethod === 'client_secret_basic') {
      if (this.clientId && this.clientSecret) {
        const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
        headers['Authorization'] = `Basic ${credentials}`;
      }
      if (this.clientId) {
        body.set('client_id', this.clientId);
      }
    } else {
      if (this.clientId) {
        body.set('client_id', this.clientId);
      }
      if (this.clientSecret) {
        body.set('client_secret', this.clientSecret);
      }
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      BaseAuthProvider.DEFAULT_REQUEST_TIMEOUT_MS
    );

    // Use discovered endpoint if available
    const tokenEndpoint = this.getTokenEndpoint();

    try {
      const response = await fetch(tokenEndpoint, {
        method: 'POST',
        headers,
        body: body.toString(),
        signal: controller.signal,
        redirect: 'error',
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Token refresh failed: ${response.status} ${errorBody}`);
      }

      const data = await response.json() as Record<string, unknown>;
      return this.parseTokenResponse(data);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Token refresh timed out after ${BaseAuthProvider.DEFAULT_REQUEST_TIMEOUT_MS}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // =============================================================================
  // JWKS Retrieval and Caching (Requirements: 7a.6)
  // =============================================================================

  /**
   * Fetch JWKS from the jwks_uri endpoint.
   *
   * Requirements: 7a.6
   *
   * @param forceRefresh - If true, bypasses cache and fetches fresh JWKS
   * @returns The JWKS or null if unavailable
   */
  async fetchJWKS(forceRefresh = false): Promise<JWKS | null> {
    // Check cache first (unless force refresh)
    if (!forceRefresh && this.cachedJWKS) {
      const now = Date.now();
      const cacheAge = now - this.cachedJWKS.fetchedAt;
      if (cacheAge < this.cachedJWKS.ttlMs) {
        return this.cachedJWKS.jwks;
      }
    }

    // Ensure discovery has been performed to get jwks_uri
    await this.ensureDiscovered();

    const jwksUri = this.getJwksUri();
    if (!jwksUri) {
      return null;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.discoveryTimeoutMs);

    try {
      const response = await fetch(jwksUri, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
        signal: controller.signal,
        redirect: 'error',
      });

      if (!response.ok) {
        throw new Error(`JWKS fetch failed: HTTP ${response.status} ${response.statusText}`);
      }

      const jwks = await response.json() as JWKS;

      // Validate JWKS structure
      if (!jwks.keys || !Array.isArray(jwks.keys)) {
        throw new Error('Invalid JWKS: missing or invalid keys array');
      }

      // Cache the JWKS
      this.cachedJWKS = {
        jwks,
        fetchedAt: Date.now(),
        ttlMs: OIDCProvider.DEFAULT_JWKS_CACHE_TTL_MS,
      };

      return jwks;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`JWKS fetch timed out after ${this.discoveryTimeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Find a key in the JWKS by key ID (kid).
   *
   * If the key is not found in the cache, attempts to refresh the JWKS
   * to handle key rotation.
   *
   * Requirements: 7a.6 (key rotation handling)
   *
   * @param kid - The key ID to find
   * @returns The JWK or null if not found
   */
  async findKey(kid: string): Promise<JWK | null> {
    // First, try to find in cached JWKS
    let jwks = await this.fetchJWKS(false);
    if (jwks) {
      const key = jwks.keys.find(k => k.kid === kid);
      if (key) {
        return key;
      }
    }

    // Key not found - might be key rotation, refresh JWKS
    jwks = await this.fetchJWKS(true);
    if (jwks) {
      const key = jwks.keys.find(k => k.kid === kid);
      if (key) {
        return key;
      }
    }

    return null;
  }

  /**
   * Clear the JWKS cache.
   * Useful for testing or when key rotation is detected.
   */
  clearJWKSCache(): void {
    this.cachedJWKS = undefined;
  }

  /**
   * Get the cached JWKS if available.
   * @returns The cached JWKS or undefined
   */
  getCachedJWKS(): CachedJWKS | undefined {
    return this.cachedJWKS;
  }

  // =============================================================================
  // ID Token Validation (Requirements: 7a.5)
  // =============================================================================

  /**
   * Validate an ID token.
   *
   * Validates the following claims per OIDC Core spec:
   * - iss: Must match the configured issuer
   * - aud: Must contain the client_id
   * - exp: Must not be expired
   * - iat: Must be present and reasonable
   *
   * Also validates the JWT signature using JWKS.
   *
   * Requirements: 7a.5, 7a.6
   *
   * @param idToken - The ID token to validate
   * @param options - Validation options
   * @returns The validation result
   */
  async validateIdToken(
    idToken: string,
    options: IDTokenValidationOptions
  ): Promise<IDTokenValidationResult> {
    try {
      // Split the JWT into parts
      const parts = idToken.split('.');
      if (parts.length !== 3) {
        return { valid: false, error: 'Invalid JWT format: expected 3 parts' };
      }

      const [headerB64, payloadB64, signatureB64] = parts;

      // Decode header
      let header: JWTHeader;
      try {
        header = JSON.parse(OIDCProvider.base64UrlDecode(headerB64));
      } catch {
        return { valid: false, error: 'Invalid JWT header: failed to decode' };
      }

      // Decode payload (claims)
      let claims: IDTokenClaims;
      try {
        claims = JSON.parse(OIDCProvider.base64UrlDecode(payloadB64));
      } catch {
        return { valid: false, error: 'Invalid JWT payload: failed to decode' };
      }

      // Validate signature
      const signatureValid = await this.validateJWTSignature(
        headerB64,
        payloadB64,
        signatureB64,
        header
      );
      if (!signatureValid) {
        return { valid: false, error: 'Invalid JWT signature' };
      }

      // Validate claims
      const claimsValidation = this.validateIDTokenClaims(claims, options);
      if (!claimsValidation.valid) {
        return claimsValidation;
      }

      return { valid: true, claims };
    } catch (error) {
      return {
        valid: false,
        error: `Token validation failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Validate the JWT signature using JWKS.
   *
   * Requirements: 7a.6
   *
   * @param headerB64 - Base64url encoded header
   * @param payloadB64 - Base64url encoded payload
   * @param signatureB64 - Base64url encoded signature
   * @param header - Decoded JWT header
   * @returns True if signature is valid
   */
  private async validateJWTSignature(
    headerB64: string,
    payloadB64: string,
    signatureB64: string,
    header: JWTHeader
  ): Promise<boolean> {
    // Only support RS256 for now (most common)
    if (header.alg !== 'RS256') {
      throw new Error(`Unsupported algorithm: ${header.alg}. Only RS256 is supported.`);
    }

    // Find the signing key
    if (!header.kid) {
      throw new Error('JWT header missing kid (key ID)');
    }

    const key = await this.findKey(header.kid);
    if (!key) {
      throw new Error(`Key not found in JWKS: ${header.kid}`);
    }

    // Verify the key is RSA
    if (key.kty !== 'RSA') {
      throw new Error(`Unsupported key type: ${key.kty}. Only RSA is supported.`);
    }

    if (!key.n || !key.e) {
      throw new Error('Invalid RSA key: missing n or e');
    }

    // Convert JWK to PEM format for Node.js crypto
    const publicKey = OIDCProvider.jwkToPem(key);

    // Verify signature
    const signedData = `${headerB64}.${payloadB64}`;
    const signature = OIDCProvider.base64UrlToBuffer(signatureB64);

    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(signedData);

    return verifier.verify(publicKey, signature);
  }

  /**
   * Validate ID token claims.
   *
   * Requirements: 7a.5
   *
   * @param claims - The decoded claims
   * @param options - Validation options
   * @returns The validation result
   */
  private validateIDTokenClaims(
    claims: IDTokenClaims,
    options: IDTokenValidationOptions
  ): IDTokenValidationResult {
    const clockSkew = options.clockSkewSeconds ?? OIDCProvider.DEFAULT_CLOCK_SKEW_SECONDS;
    const now = Math.floor(Date.now() / 1000);

    // Validate iss (issuer)
    // Normalize trailing slashes for comparison
    const normalizedClaimsIss = claims.iss?.replace(/\/$/, '');
    const normalizedIssuer = this.issuer.replace(/\/$/, '');
    if (!claims.iss || normalizedClaimsIss !== normalizedIssuer) {
      return {
        valid: false,
        error: `Invalid issuer: expected ${this.issuer}, got ${claims.iss}`,
      };
    }

    // Validate aud (audience)
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audiences.includes(options.audience)) {
      return {
        valid: false,
        error: `Invalid audience: expected ${options.audience}, got ${claims.aud}`,
      };
    }

    // Validate exp (expiration)
    if (typeof claims.exp !== 'number') {
      return { valid: false, error: 'Missing or invalid exp claim' };
    }
    if (claims.exp + clockSkew < now) {
      return { valid: false, error: 'Token has expired' };
    }

    // Validate iat (issued at)
    if (typeof claims.iat !== 'number') {
      return { valid: false, error: 'Missing or invalid iat claim' };
    }
    // iat should not be in the future (with clock skew tolerance)
    if (claims.iat - clockSkew > now) {
      return { valid: false, error: 'Token issued in the future' };
    }

    // Validate nonce if provided
    if (options.nonce !== undefined) {
      if (claims.nonce !== options.nonce) {
        return {
          valid: false,
          error: `Invalid nonce: expected ${options.nonce}, got ${claims.nonce}`,
        };
      }
    }

    return { valid: true, claims };
  }

  // =============================================================================
  // Utility Methods
  // =============================================================================

  /**
   * Decode a base64url encoded string to UTF-8.
   *
   * @param input - Base64url encoded string
   * @returns Decoded UTF-8 string
   */
  private static base64UrlDecode(input: string): string {
    // Replace base64url characters with base64 characters
    let base64 = input.replace(/-/g, '+').replace(/_/g, '/');

    // Add padding if necessary
    const padding = base64.length % 4;
    if (padding) {
      base64 += '='.repeat(4 - padding);
    }

    return Buffer.from(base64, 'base64').toString('utf-8');
  }

  /**
   * Convert a base64url encoded string to a Buffer.
   *
   * @param input - Base64url encoded string
   * @returns Buffer
   */
  private static base64UrlToBuffer(input: string): Buffer {
    // Replace base64url characters with base64 characters
    let base64 = input.replace(/-/g, '+').replace(/_/g, '/');

    // Add padding if necessary
    const padding = base64.length % 4;
    if (padding) {
      base64 += '='.repeat(4 - padding);
    }

    return Buffer.from(base64, 'base64');
  }

  /**
   * Convert a JWK RSA public key to PEM format.
   *
   * @param jwk - The JWK to convert
   * @returns PEM formatted public key
   */
  private static jwkToPem(jwk: JWK): string {
    if (!jwk.n || !jwk.e) {
      throw new Error('Invalid JWK: missing n or e');
    }

    // Use Node.js crypto to create the key from JWK
    const keyObject = crypto.createPublicKey({
      key: {
        kty: jwk.kty,
        n: jwk.n,
        e: jwk.e,
      },
      format: 'jwk',
    });

    return keyObject.export({ type: 'spki', format: 'pem' }) as string;
  }
}
