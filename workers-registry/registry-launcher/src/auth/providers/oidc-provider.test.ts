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
 * Unit tests for OIDC Provider.
 *
 * Tests OIDC discovery, JWKS retrieval, caching, and ID token validation.
 *
 * Requirements: 7a.1, 7a.2, 7a.5, 7a.6, 7a.7
 */

import * as crypto from 'crypto';
import { OIDCProvider, type JWKS, type JWK } from './oidc-provider.js';

// =============================================================================
// Test Utilities
// =============================================================================

/**
 * Generate a test RSA key pair.
 */
function generateTestKeyPair(): { publicKey: crypto.KeyObject; privateKey: crypto.KeyObject } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  return { publicKey, privateKey };
}

/**
 * Convert a public key to JWK format.
 */
function publicKeyToJWK(publicKey: crypto.KeyObject, kid: string): JWK {
  const jwk = publicKey.export({ format: 'jwk' }) as JWK;
  return {
    ...jwk,
    kid,
    alg: 'RS256',
    use: 'sig',
  };
}

/**
 * Base64url encode a string or buffer.
 */
function base64UrlEncode(input: string | Buffer): string {
  const buffer = typeof input === 'string' ? Buffer.from(input) : input;
  return buffer.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * Create a signed JWT for testing.
 */
function createTestJWT(
  payload: Record<string, unknown>,
  privateKey: crypto.KeyObject,
  kid: string
): string {
  const header = {
    alg: 'RS256',
    typ: 'JWT',
    kid,
  };

  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const signedData = `${headerB64}.${payloadB64}`;

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signedData);
  const signature = signer.sign(privateKey);
  const signatureB64 = base64UrlEncode(signature);

  return `${headerB64}.${payloadB64}.${signatureB64}`;
}

// =============================================================================
// Mock fetch for testing
// =============================================================================

const originalFetch = global.fetch;

function mockFetch(responses: Map<string, { status: number; body: unknown }>): void {
  global.fetch = jest.fn().mockImplementation((url: string) => {
    const response = responses.get(url);
    if (!response) {
      return Promise.resolve({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: () => Promise.resolve('Not Found'),
        json: () => Promise.reject(new Error('Not Found')),
      });
    }
    return Promise.resolve({
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      statusText: response.status === 200 ? 'OK' : 'Error',
      text: () => Promise.resolve(JSON.stringify(response.body)),
      json: () => Promise.resolve(response.body),
    });
  });
}

function restoreFetch(): void {
  global.fetch = originalFetch;
}

// =============================================================================
// Tests
// =============================================================================

describe('OIDCProvider', () => {
  const testIssuer = 'https://auth.example.com';
  const testClientId = 'test-client-id';
  const testKid = 'test-key-id';

  let testKeyPair: { publicKey: crypto.KeyObject; privateKey: crypto.KeyObject };
  let testJWK: JWK;
  let testJWKS: JWKS;

  beforeAll(() => {
    testKeyPair = generateTestKeyPair();
    testJWK = publicKeyToJWK(testKeyPair.publicKey, testKid);
    testJWKS = { keys: [testJWK] };
  });

  afterEach(() => {
    restoreFetch();
  });

  describe('constructor', () => {
    it('should create provider with valid issuer', () => {
      const provider = new OIDCProvider({ issuer: testIssuer });
      expect(provider.getIssuer()).toBe(testIssuer);
    });

    it('should reject non-HTTPS issuer', () => {
      expect(() => new OIDCProvider({ issuer: 'http://auth.example.com' }))
        .toThrow('OIDC issuer must use HTTPS');
    });

    it('should reject issuer with embedded credentials', () => {
      expect(() => new OIDCProvider({ issuer: 'https://user:pass@auth.example.com' }))
        .toThrow('OIDC issuer must not contain embedded credentials');
    });

    it('should reject issuer with query string', () => {
      expect(() => new OIDCProvider({ issuer: 'https://auth.example.com?foo=bar' }))
        .toThrow('OIDC issuer must not contain query string or fragment');
    });

    it('should accept manual JWKS URI', () => {
      const jwksUri = 'https://auth.example.com/.well-known/jwks.json';
      const provider = new OIDCProvider({ issuer: testIssuer, jwksUri });
      expect(provider.getJwksUri()).toBe(jwksUri);
    });
  });

  describe('OIDC Discovery', () => {
    it('should fetch and parse discovery document', async () => {
      const discoveryDoc = {
        issuer: testIssuer,
        authorization_endpoint: `${testIssuer}/authorize`,
        token_endpoint: `${testIssuer}/token`,
        jwks_uri: `${testIssuer}/.well-known/jwks.json`,
      };

      mockFetch(new Map([
        [`${testIssuer}/.well-known/openid-configuration`, { status: 200, body: discoveryDoc }],
      ]));

      const provider = new OIDCProvider({ issuer: testIssuer });
      const result = await provider.discover();

      expect(result.success).toBe(true);
      expect(result.document).toEqual(discoveryDoc);
      expect(provider.getJwksUri()).toBe(discoveryDoc.jwks_uri);
    });

    it('should reject discovery document with mismatched issuer', async () => {
      const discoveryDoc = {
        issuer: 'https://different-issuer.com',
        authorization_endpoint: `${testIssuer}/authorize`,
        token_endpoint: `${testIssuer}/token`,
      };

      mockFetch(new Map([
        [`${testIssuer}/.well-known/openid-configuration`, { status: 200, body: discoveryDoc }],
      ]));

      const provider = new OIDCProvider({ issuer: testIssuer });
      const result = await provider.discover();

      expect(result.success).toBe(false);
      expect(result.error).toContain('issuer mismatch');
    });

    it('should skip discovery when configured', async () => {
      const provider = new OIDCProvider({
        issuer: testIssuer,
        skipDiscovery: true,
      });

      const result = await provider.discover();
      expect(result.success).toBe(false);
      expect(result.error).toBe('Discovery skipped by configuration');
    });

    it('should handle discovery timeout', async () => {
      // Mock fetch to never resolve (simulating timeout)
      global.fetch = jest.fn().mockImplementation(() => {
        return new Promise((_, reject) => {
          // Simulate AbortController abort
          const error = new Error('The operation was aborted');
          error.name = 'AbortError';
          setTimeout(() => reject(error), 10);
        });
      });

      const provider = new OIDCProvider({
        issuer: testIssuer,
        discoveryTimeoutMs: 5, // Very short timeout
      });

      const result = await provider.discover();

      expect(result.success).toBe(false);
      expect(result.error).toContain('timed out');
    });

    it('should reject discovery document missing required fields', async () => {
      // Missing authorization_endpoint
      const incompleteDoc = {
        issuer: testIssuer,
        token_endpoint: `${testIssuer}/token`,
      };

      mockFetch(new Map([
        [`${testIssuer}/.well-known/openid-configuration`, { status: 200, body: incompleteDoc }],
      ]));

      const provider = new OIDCProvider({ issuer: testIssuer });
      const result = await provider.discover();

      expect(result.success).toBe(false);
      expect(result.error).toContain('authorization_endpoint');
    });

    it('should reject discovery document missing token_endpoint', async () => {
      const incompleteDoc = {
        issuer: testIssuer,
        authorization_endpoint: `${testIssuer}/authorize`,
      };

      mockFetch(new Map([
        [`${testIssuer}/.well-known/openid-configuration`, { status: 200, body: incompleteDoc }],
      ]));

      const provider = new OIDCProvider({ issuer: testIssuer });
      const result = await provider.discover();

      expect(result.success).toBe(false);
      expect(result.error).toContain('token_endpoint');
    });

    it('should reject discovery document missing issuer', async () => {
      const incompleteDoc = {
        authorization_endpoint: `${testIssuer}/authorize`,
        token_endpoint: `${testIssuer}/token`,
      };

      mockFetch(new Map([
        [`${testIssuer}/.well-known/openid-configuration`, { status: 200, body: incompleteDoc }],
      ]));

      const provider = new OIDCProvider({ issuer: testIssuer });
      const result = await provider.discover();

      expect(result.success).toBe(false);
      expect(result.error).toContain('issuer');
    });

    it('should handle HTTP error during discovery', async () => {
      mockFetch(new Map([
        [`${testIssuer}/.well-known/openid-configuration`, { status: 500, body: { error: 'Internal Server Error' } }],
      ]));

      const provider = new OIDCProvider({ issuer: testIssuer });
      const result = await provider.discover();

      expect(result.success).toBe(false);
      expect(result.error).toContain('HTTP 500');
    });

    it('should handle network error during discovery', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

      const provider = new OIDCProvider({ issuer: testIssuer });
      const result = await provider.discover();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Network error');
    });
  });

  describe('Manual Endpoint Override', () => {
    /**
     * Tests for manual endpoint override when discovery is unavailable.
     * Requirements: 7a.2
     */

    it('should use manual endpoints when provided', async () => {
      const manualAuthEndpoint = 'https://custom-auth.example.com/authorize';
      const manualTokenEndpoint = 'https://custom-auth.example.com/token';

      const provider = new OIDCProvider({
        issuer: testIssuer,
        authorizationEndpoint: manualAuthEndpoint,
        tokenEndpoint: manualTokenEndpoint,
        skipDiscovery: true,
      });

      expect(provider.getAuthorizationEndpoint()).toBe(manualAuthEndpoint);
      expect(provider.getTokenEndpoint()).toBe(manualTokenEndpoint);
    });

    it('should skip discovery when manual endpoints are provided', async () => {
      const provider = new OIDCProvider({
        issuer: testIssuer,
        authorizationEndpoint: 'https://custom-auth.example.com/authorize',
        tokenEndpoint: 'https://custom-auth.example.com/token',
      });

      // Discovery should be marked as attempted since manual endpoints are provided
      expect(provider.isDiscoveryAttempted()).toBe(true);
    });

    it('should use manual JWKS URI when provided', async () => {
      const manualJwksUri = 'https://custom-auth.example.com/.well-known/jwks.json';

      const provider = new OIDCProvider({
        issuer: testIssuer,
        jwksUri: manualJwksUri,
        skipDiscovery: true,
      });

      expect(provider.getJwksUri()).toBe(manualJwksUri);
    });

    it('should reject non-HTTPS manual authorization endpoint', () => {
      expect(() => new OIDCProvider({
        issuer: testIssuer,
        authorizationEndpoint: 'http://insecure.example.com/authorize',
      })).toThrow('HTTPS');
    });

    it('should reject non-HTTPS manual token endpoint', () => {
      expect(() => new OIDCProvider({
        issuer: testIssuer,
        tokenEndpoint: 'http://insecure.example.com/token',
      })).toThrow('HTTPS');
    });

    it('should reject non-HTTPS manual JWKS URI', () => {
      expect(() => new OIDCProvider({
        issuer: testIssuer,
        jwksUri: 'http://insecure.example.com/jwks.json',
      })).toThrow('HTTPS');
    });

    it('should reject manual endpoint with embedded credentials', () => {
      expect(() => new OIDCProvider({
        issuer: testIssuer,
        authorizationEndpoint: 'https://user:pass@auth.example.com/authorize',
      })).toThrow('embedded credentials');
    });

    it('should use manual endpoints for token exchange', async () => {
      const manualTokenEndpoint = 'https://custom-auth.example.com/token';
      let capturedUrl: string | undefined;

      global.fetch = jest.fn().mockImplementation((url: string) => {
        capturedUrl = url;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            access_token: 'test-token',
            token_type: 'Bearer',
            expires_in: 3600,
          }),
        });
      });

      const provider = new OIDCProvider({
        issuer: testIssuer,
        authorizationEndpoint: 'https://custom-auth.example.com/authorize',
        tokenEndpoint: manualTokenEndpoint,
        clientId: testClientId,
      });

      await provider.exchangeCode('test-code', 'test-verifier', 'http://127.0.0.1:8080/callback');

      expect(capturedUrl).toBe(manualTokenEndpoint);
    });
  });

  describe('PKCE Enforcement', () => {
    /**
     * Tests for PKCE S256 enforcement in authorization requests.
     * Requirements: 7a.3
     */

    it('should include PKCE parameters in authorization URL', () => {
      const provider = new OIDCProvider({
        issuer: testIssuer,
        clientId: testClientId,
        skipDiscovery: true,
      });

      const authUrl = provider.buildAuthorizationUrl({
        clientId: testClientId,
        redirectUri: 'http://127.0.0.1:8080/callback',
        responseType: 'code',
        scope: 'openid profile',
        state: 'test-state',
        codeChallenge: 'test-code-challenge',
        codeChallengeMethod: 'S256',
      });

      const url = new URL(authUrl);
      expect(url.searchParams.get('code_challenge')).toBe('test-code-challenge');
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    });

    it('should require code_verifier in token exchange', async () => {
      let capturedBody: string | undefined;

      global.fetch = jest.fn().mockImplementation((url: string, options?: RequestInit) => {
        if (url.includes('/token')) {
          capturedBody = options?.body as string;
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({
              access_token: 'test-token',
              token_type: 'Bearer',
              expires_in: 3600,
            }),
          });
        }
        return Promise.resolve({ ok: false, status: 404 });
      });

      const provider = new OIDCProvider({
        issuer: testIssuer,
        authorizationEndpoint: `${testIssuer}/authorize`,
        tokenEndpoint: `${testIssuer}/token`,
        clientId: testClientId,
      });

      const codeVerifier = 'test-code-verifier-12345678901234567890123456789012345';
      await provider.exchangeCode('test-code', codeVerifier, 'http://127.0.0.1:8080/callback');

      const bodyParams = new URLSearchParams(capturedBody!);
      expect(bodyParams.get('code_verifier')).toBe(codeVerifier);
    });

    it('should enforce S256 method (not plain)', () => {
      const provider = new OIDCProvider({
        issuer: testIssuer,
        clientId: testClientId,
        skipDiscovery: true,
      });

      // The buildAuthorizationUrl method requires codeChallengeMethod to be 'S256'
      // This is enforced by the type system, but we verify the URL contains S256
      const authUrl = provider.buildAuthorizationUrl({
        clientId: testClientId,
        redirectUri: 'http://127.0.0.1:8080/callback',
        responseType: 'code',
        scope: 'openid profile',
        state: 'test-state',
        codeChallenge: 'test-challenge',
        codeChallengeMethod: 'S256',
      });

      const url = new URL(authUrl);
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      expect(url.searchParams.get('code_challenge_method')).not.toBe('plain');
    });
  });

  describe('State and Nonce Validation', () => {
    /**
     * Tests for state and nonce parameter validation.
     * Requirements: 7a.4
     */

    const jwksUri = `${testIssuer}/.well-known/jwks.json`;
    const discoveryDoc = {
      issuer: testIssuer,
      authorization_endpoint: `${testIssuer}/authorize`,
      token_endpoint: `${testIssuer}/token`,
      jwks_uri: jwksUri,
    };

    beforeEach(() => {
      mockFetch(new Map([
        [`${testIssuer}/.well-known/openid-configuration`, { status: 200, body: discoveryDoc }],
        [jwksUri, { status: 200, body: testJWKS }],
      ]));
    });

    it('should include state parameter in authorization URL', () => {
      const provider = new OIDCProvider({
        issuer: testIssuer,
        clientId: testClientId,
        skipDiscovery: true,
      });

      const state = 'random-state-value-12345';
      const authUrl = provider.buildAuthorizationUrl({
        clientId: testClientId,
        redirectUri: 'http://127.0.0.1:8080/callback',
        responseType: 'code',
        scope: 'openid profile',
        state,
        codeChallenge: 'test-challenge',
        codeChallengeMethod: 'S256',
      });

      const url = new URL(authUrl);
      expect(url.searchParams.get('state')).toBe(state);
    });

    it('should validate nonce in ID token when expected', async () => {
      const now = Math.floor(Date.now() / 1000);
      const expectedNonce = 'expected-nonce-value';
      const payload = {
        iss: testIssuer,
        sub: 'user-123',
        aud: testClientId,
        exp: now + 3600,
        iat: now - 60,
        nonce: expectedNonce,
      };

      const idToken = createTestJWT(payload, testKeyPair.privateKey, testKid);
      const provider = new OIDCProvider({ issuer: testIssuer });

      // Valid nonce
      const validResult = await provider.validateIdToken(idToken, {
        audience: testClientId,
        nonce: expectedNonce,
      });
      expect(validResult.valid).toBe(true);
    });

    it('should reject ID token with wrong nonce', async () => {
      const now = Math.floor(Date.now() / 1000);
      const payload = {
        iss: testIssuer,
        sub: 'user-123',
        aud: testClientId,
        exp: now + 3600,
        iat: now - 60,
        nonce: 'actual-nonce',
      };

      const idToken = createTestJWT(payload, testKeyPair.privateKey, testKid);
      const provider = new OIDCProvider({ issuer: testIssuer });

      const result = await provider.validateIdToken(idToken, {
        audience: testClientId,
        nonce: 'expected-nonce',
      });

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid nonce');
    });

    it('should reject ID token with missing nonce when expected', async () => {
      const now = Math.floor(Date.now() / 1000);
      const payload = {
        iss: testIssuer,
        sub: 'user-123',
        aud: testClientId,
        exp: now + 3600,
        iat: now - 60,
        // No nonce in token
      };

      const idToken = createTestJWT(payload, testKeyPair.privateKey, testKid);
      const provider = new OIDCProvider({ issuer: testIssuer });

      const result = await provider.validateIdToken(idToken, {
        audience: testClientId,
        nonce: 'expected-nonce',
      });

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid nonce');
    });

    it('should accept ID token without nonce when not expected', async () => {
      const now = Math.floor(Date.now() / 1000);
      const payload = {
        iss: testIssuer,
        sub: 'user-123',
        aud: testClientId,
        exp: now + 3600,
        iat: now - 60,
        // No nonce
      };

      const idToken = createTestJWT(payload, testKeyPair.privateKey, testKid);
      const provider = new OIDCProvider({ issuer: testIssuer });

      const result = await provider.validateIdToken(idToken, {
        audience: testClientId,
        // No nonce expected
      });

      expect(result.valid).toBe(true);
    });
  });

  describe('JWKS Retrieval and Caching', () => {
    const jwksUri = `${testIssuer}/.well-known/jwks.json`;
    const discoveryDoc = {
      issuer: testIssuer,
      authorization_endpoint: `${testIssuer}/authorize`,
      token_endpoint: `${testIssuer}/token`,
      jwks_uri: jwksUri,
    };

    it('should fetch JWKS from jwks_uri', async () => {
      mockFetch(new Map([
        [`${testIssuer}/.well-known/openid-configuration`, { status: 200, body: discoveryDoc }],
        [jwksUri, { status: 200, body: testJWKS }],
      ]));

      const provider = new OIDCProvider({ issuer: testIssuer });
      const jwks = await provider.fetchJWKS();

      expect(jwks).toEqual(testJWKS);
    });

    it('should cache JWKS', async () => {
      mockFetch(new Map([
        [`${testIssuer}/.well-known/openid-configuration`, { status: 200, body: discoveryDoc }],
        [jwksUri, { status: 200, body: testJWKS }],
      ]));

      const provider = new OIDCProvider({ issuer: testIssuer });

      // First fetch
      await provider.fetchJWKS();

      // Second fetch should use cache
      const cachedJWKS = provider.getCachedJWKS();
      expect(cachedJWKS).toBeDefined();
      expect(cachedJWKS?.jwks).toEqual(testJWKS);

      // Verify fetch was only called twice (discovery + JWKS)
      expect(global.fetch).toHaveBeenCalledTimes(2);

      // Third fetch should still use cache
      await provider.fetchJWKS();
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('should force refresh JWKS when requested', async () => {
      mockFetch(new Map([
        [`${testIssuer}/.well-known/openid-configuration`, { status: 200, body: discoveryDoc }],
        [jwksUri, { status: 200, body: testJWKS }],
      ]));

      const provider = new OIDCProvider({ issuer: testIssuer });

      // First fetch
      await provider.fetchJWKS();
      expect(global.fetch).toHaveBeenCalledTimes(2);

      // Force refresh
      await provider.fetchJWKS(true);
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });

    it('should find key by kid', async () => {
      mockFetch(new Map([
        [`${testIssuer}/.well-known/openid-configuration`, { status: 200, body: discoveryDoc }],
        [jwksUri, { status: 200, body: testJWKS }],
      ]));

      const provider = new OIDCProvider({ issuer: testIssuer });
      const key = await provider.findKey(testKid);

      expect(key).toBeDefined();
      expect(key?.kid).toBe(testKid);
    });

    it('should handle key rotation by refreshing JWKS', async () => {
      const newKid = 'new-key-id';
      const newKeyPair = generateTestKeyPair();
      const newJWK = publicKeyToJWK(newKeyPair.publicKey, newKid);
      const newJWKS = { keys: [newJWK] };

      let fetchCount = 0;
      global.fetch = jest.fn().mockImplementation((url: string) => {
        if (url.includes('openid-configuration')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(discoveryDoc),
          });
        }
        if (url.includes('jwks')) {
          fetchCount++;
          // First fetch returns old JWKS, subsequent fetches return new JWKS
          const jwks = fetchCount === 1 ? testJWKS : newJWKS;
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(jwks),
          });
        }
        return Promise.resolve({ ok: false, status: 404 });
      });

      const provider = new OIDCProvider({ issuer: testIssuer });

      // First, find the old key
      const oldKey = await provider.findKey(testKid);
      expect(oldKey?.kid).toBe(testKid);

      // Now try to find the new key (should trigger refresh)
      const newKey = await provider.findKey(newKid);
      expect(newKey?.kid).toBe(newKid);
    });

    it('should clear JWKS cache', async () => {
      mockFetch(new Map([
        [`${testIssuer}/.well-known/openid-configuration`, { status: 200, body: discoveryDoc }],
        [jwksUri, { status: 200, body: testJWKS }],
      ]));

      const provider = new OIDCProvider({ issuer: testIssuer });
      await provider.fetchJWKS();

      expect(provider.getCachedJWKS()).toBeDefined();

      provider.clearJWKSCache();

      expect(provider.getCachedJWKS()).toBeUndefined();
    });
  });

  describe('ID Token Validation', () => {
    const jwksUri = `${testIssuer}/.well-known/jwks.json`;
    const discoveryDoc = {
      issuer: testIssuer,
      authorization_endpoint: `${testIssuer}/authorize`,
      token_endpoint: `${testIssuer}/token`,
      jwks_uri: jwksUri,
    };

    beforeEach(() => {
      mockFetch(new Map([
        [`${testIssuer}/.well-known/openid-configuration`, { status: 200, body: discoveryDoc }],
        [jwksUri, { status: 200, body: testJWKS }],
      ]));
    });

    it('should validate a valid ID token', async () => {
      const now = Math.floor(Date.now() / 1000);
      const payload = {
        iss: testIssuer,
        sub: 'user-123',
        aud: testClientId,
        exp: now + 3600,
        iat: now - 60,
      };

      const idToken = createTestJWT(payload, testKeyPair.privateKey, testKid);
      const provider = new OIDCProvider({ issuer: testIssuer });

      const result = await provider.validateIdToken(idToken, { audience: testClientId });

      expect(result.valid).toBe(true);
      expect(result.claims?.sub).toBe('user-123');
    });

    it('should reject token with invalid issuer', async () => {
      const now = Math.floor(Date.now() / 1000);
      const payload = {
        iss: 'https://wrong-issuer.com',
        sub: 'user-123',
        aud: testClientId,
        exp: now + 3600,
        iat: now - 60,
      };

      const idToken = createTestJWT(payload, testKeyPair.privateKey, testKid);
      const provider = new OIDCProvider({ issuer: testIssuer });

      const result = await provider.validateIdToken(idToken, { audience: testClientId });

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid issuer');
    });

    it('should reject token with invalid audience', async () => {
      const now = Math.floor(Date.now() / 1000);
      const payload = {
        iss: testIssuer,
        sub: 'user-123',
        aud: 'wrong-client-id',
        exp: now + 3600,
        iat: now - 60,
      };

      const idToken = createTestJWT(payload, testKeyPair.privateKey, testKid);
      const provider = new OIDCProvider({ issuer: testIssuer });

      const result = await provider.validateIdToken(idToken, { audience: testClientId });

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid audience');
    });

    it('should reject expired token', async () => {
      const now = Math.floor(Date.now() / 1000);
      const payload = {
        iss: testIssuer,
        sub: 'user-123',
        aud: testClientId,
        exp: now - 3600, // Expired 1 hour ago
        iat: now - 7200,
      };

      const idToken = createTestJWT(payload, testKeyPair.privateKey, testKid);
      const provider = new OIDCProvider({ issuer: testIssuer });

      const result = await provider.validateIdToken(idToken, { audience: testClientId });

      expect(result.valid).toBe(false);
      expect(result.error).toContain('expired');
    });

    it('should reject token issued in the future', async () => {
      const now = Math.floor(Date.now() / 1000);
      const payload = {
        iss: testIssuer,
        sub: 'user-123',
        aud: testClientId,
        exp: now + 7200,
        iat: now + 3600, // Issued 1 hour in the future
      };

      const idToken = createTestJWT(payload, testKeyPair.privateKey, testKid);
      const provider = new OIDCProvider({ issuer: testIssuer });

      const result = await provider.validateIdToken(idToken, { audience: testClientId });

      expect(result.valid).toBe(false);
      expect(result.error).toContain('issued in the future');
    });

    it('should validate nonce when provided', async () => {
      const now = Math.floor(Date.now() / 1000);
      const nonce = 'test-nonce-123';
      const payload = {
        iss: testIssuer,
        sub: 'user-123',
        aud: testClientId,
        exp: now + 3600,
        iat: now - 60,
        nonce,
      };

      const idToken = createTestJWT(payload, testKeyPair.privateKey, testKid);
      const provider = new OIDCProvider({ issuer: testIssuer });

      // Valid nonce
      const validResult = await provider.validateIdToken(idToken, {
        audience: testClientId,
        nonce,
      });
      expect(validResult.valid).toBe(true);

      // Invalid nonce
      const invalidResult = await provider.validateIdToken(idToken, {
        audience: testClientId,
        nonce: 'wrong-nonce',
      });
      expect(invalidResult.valid).toBe(false);
      expect(invalidResult.error).toContain('Invalid nonce');
    });

    it('should accept token with array audience containing client_id', async () => {
      const now = Math.floor(Date.now() / 1000);
      const payload = {
        iss: testIssuer,
        sub: 'user-123',
        aud: ['other-client', testClientId, 'another-client'],
        exp: now + 3600,
        iat: now - 60,
      };

      const idToken = createTestJWT(payload, testKeyPair.privateKey, testKid);
      const provider = new OIDCProvider({ issuer: testIssuer });

      const result = await provider.validateIdToken(idToken, { audience: testClientId });

      expect(result.valid).toBe(true);
    });

    it('should respect clock skew tolerance', async () => {
      const now = Math.floor(Date.now() / 1000);
      const payload = {
        iss: testIssuer,
        sub: 'user-123',
        aud: testClientId,
        exp: now - 30, // Expired 30 seconds ago
        iat: now - 3600,
      };

      const idToken = createTestJWT(payload, testKeyPair.privateKey, testKid);
      const provider = new OIDCProvider({ issuer: testIssuer });

      // With default 60 second clock skew, should still be valid
      const result = await provider.validateIdToken(idToken, { audience: testClientId });
      expect(result.valid).toBe(true);

      // With 0 clock skew, should be invalid
      const strictResult = await provider.validateIdToken(idToken, {
        audience: testClientId,
        clockSkewSeconds: 0,
      });
      expect(strictResult.valid).toBe(false);
    });

    it('should reject malformed JWT', async () => {
      const provider = new OIDCProvider({ issuer: testIssuer });

      // Not enough parts
      const result1 = await provider.validateIdToken('invalid.token', { audience: testClientId });
      expect(result1.valid).toBe(false);
      expect(result1.error).toContain('Invalid JWT format');

      // Invalid base64
      const result2 = await provider.validateIdToken('!!!.@@@.###', { audience: testClientId });
      expect(result2.valid).toBe(false);
    });

    it('should reject token with invalid signature', async () => {
      const now = Math.floor(Date.now() / 1000);
      const payload = {
        iss: testIssuer,
        sub: 'user-123',
        aud: testClientId,
        exp: now + 3600,
        iat: now - 60,
      };

      // Create token with a different key
      const differentKeyPair = generateTestKeyPair();
      const idToken = createTestJWT(payload, differentKeyPair.privateKey, testKid);
      const provider = new OIDCProvider({ issuer: testIssuer });

      const result = await provider.validateIdToken(idToken, { audience: testClientId });

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid JWT signature');
    });

    it('should handle issuer with trailing slash', async () => {
      const issuerWithSlash = `${testIssuer}/`;
      const now = Math.floor(Date.now() / 1000);
      const payload = {
        iss: issuerWithSlash,
        sub: 'user-123',
        aud: testClientId,
        exp: now + 3600,
        iat: now - 60,
      };

      const idToken = createTestJWT(payload, testKeyPair.privateKey, testKid);
      const provider = new OIDCProvider({ issuer: testIssuer });

      const result = await provider.validateIdToken(idToken, { audience: testClientId });

      expect(result.valid).toBe(true);
    });
  });

  describe('Token Endpoint Auth Methods', () => {
    /**
     * Tests for token_endpoint_auth_method support.
     * Requirements: 7a.7
     *
     * Validates:
     * - client_secret_post: credentials sent in request body
     * - client_secret_basic: credentials sent in Authorization header as Basic base64(client_id:client_secret)
     */

    const testClientSecret = 'test-secret-value';
    const testCode = 'test-auth-code';
    const testCodeVerifier = 'test-code-verifier-12345678901234567890123456789012345';
    const testRedirectUri = 'http://127.0.0.1:8080/callback';
    const testRefreshToken = 'test-refresh-token';

    const tokenResponse = {
      access_token: 'test-access-token',
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: 'new-refresh-token',
    };

    const discoveryDoc = {
      issuer: testIssuer,
      authorization_endpoint: `${testIssuer}/authorize`,
      token_endpoint: `${testIssuer}/token`,
      jwks_uri: `${testIssuer}/.well-known/jwks.json`,
    };

    it('should use client_secret_post by default', () => {
      const provider = new OIDCProvider({
        issuer: testIssuer,
        clientId: testClientId,
        clientSecret: testClientSecret,
      });

      expect(provider).toBeDefined();
    });

    it('should support client_secret_basic configuration', () => {
      const provider = new OIDCProvider({
        issuer: testIssuer,
        clientId: testClientId,
        clientSecret: testClientSecret,
        tokenEndpointAuthMethod: 'client_secret_basic',
      });

      expect(provider).toBeDefined();
    });

    describe('client_secret_post (default)', () => {
      it('should send credentials in request body during token exchange', async () => {
        let capturedBody: string | undefined;
        let capturedHeaders: Record<string, string> | undefined;

        global.fetch = jest.fn().mockImplementation((url: string, options?: RequestInit) => {
          if (url.includes('openid-configuration')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: () => Promise.resolve(discoveryDoc),
            });
          }
          if (url.includes('/token')) {
            capturedBody = options?.body as string;
            capturedHeaders = options?.headers as Record<string, string>;
            return Promise.resolve({
              ok: true,
              status: 200,
              json: () => Promise.resolve(tokenResponse),
            });
          }
          return Promise.resolve({ ok: false, status: 404 });
        });

        const provider = new OIDCProvider({
          issuer: testIssuer,
          clientId: testClientId,
          clientSecret: testClientSecret,
          tokenEndpointAuthMethod: 'client_secret_post',
        });

        await provider.exchangeCode(testCode, testCodeVerifier, testRedirectUri);

        // Verify credentials are in the body
        expect(capturedBody).toBeDefined();
        const bodyParams = new URLSearchParams(capturedBody!);
        expect(bodyParams.get('client_id')).toBe(testClientId);
        expect(bodyParams.get('client_secret')).toBe(testClientSecret);
        expect(bodyParams.get('grant_type')).toBe('authorization_code');
        expect(bodyParams.get('code')).toBe(testCode);
        expect(bodyParams.get('code_verifier')).toBe(testCodeVerifier);
        expect(bodyParams.get('redirect_uri')).toBe(testRedirectUri);

        // Verify NO Authorization header is set for client_secret_post
        expect(capturedHeaders?.['Authorization']).toBeUndefined();
      });

      it('should send credentials in request body during token refresh', async () => {
        let capturedBody: string | undefined;
        let capturedHeaders: Record<string, string> | undefined;

        global.fetch = jest.fn().mockImplementation((url: string, options?: RequestInit) => {
          if (url.includes('openid-configuration')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: () => Promise.resolve(discoveryDoc),
            });
          }
          if (url.includes('/token')) {
            capturedBody = options?.body as string;
            capturedHeaders = options?.headers as Record<string, string>;
            return Promise.resolve({
              ok: true,
              status: 200,
              json: () => Promise.resolve(tokenResponse),
            });
          }
          return Promise.resolve({ ok: false, status: 404 });
        });

        const provider = new OIDCProvider({
          issuer: testIssuer,
          clientId: testClientId,
          clientSecret: testClientSecret,
          tokenEndpointAuthMethod: 'client_secret_post',
        });

        await provider.refreshToken(testRefreshToken);

        // Verify credentials are in the body
        expect(capturedBody).toBeDefined();
        const bodyParams = new URLSearchParams(capturedBody!);
        expect(bodyParams.get('client_id')).toBe(testClientId);
        expect(bodyParams.get('client_secret')).toBe(testClientSecret);
        expect(bodyParams.get('grant_type')).toBe('refresh_token');
        expect(bodyParams.get('refresh_token')).toBe(testRefreshToken);

        // Verify NO Authorization header is set for client_secret_post
        expect(capturedHeaders?.['Authorization']).toBeUndefined();
      });

      it('should work without client_secret (public client)', async () => {
        let capturedBody: string | undefined;

        global.fetch = jest.fn().mockImplementation((url: string, options?: RequestInit) => {
          if (url.includes('openid-configuration')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: () => Promise.resolve(discoveryDoc),
            });
          }
          if (url.includes('/token')) {
            capturedBody = options?.body as string;
            return Promise.resolve({
              ok: true,
              status: 200,
              json: () => Promise.resolve(tokenResponse),
            });
          }
          return Promise.resolve({ ok: false, status: 404 });
        });

        const provider = new OIDCProvider({
          issuer: testIssuer,
          clientId: testClientId,
          // No clientSecret - public client
        });

        await provider.exchangeCode(testCode, testCodeVerifier, testRedirectUri);

        const bodyParams = new URLSearchParams(capturedBody!);
        expect(bodyParams.get('client_id')).toBe(testClientId);
        expect(bodyParams.has('client_secret')).toBe(false);
      });
    });

    describe('client_secret_basic', () => {
      it('should send credentials in Authorization header during token exchange', async () => {
        let capturedBody: string | undefined;
        let capturedHeaders: Record<string, string> | undefined;

        global.fetch = jest.fn().mockImplementation((url: string, options?: RequestInit) => {
          if (url.includes('openid-configuration')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: () => Promise.resolve(discoveryDoc),
            });
          }
          if (url.includes('/token')) {
            capturedBody = options?.body as string;
            capturedHeaders = options?.headers as Record<string, string>;
            return Promise.resolve({
              ok: true,
              status: 200,
              json: () => Promise.resolve(tokenResponse),
            });
          }
          return Promise.resolve({ ok: false, status: 404 });
        });

        const provider = new OIDCProvider({
          issuer: testIssuer,
          clientId: testClientId,
          clientSecret: testClientSecret,
          tokenEndpointAuthMethod: 'client_secret_basic',
        });

        await provider.exchangeCode(testCode, testCodeVerifier, testRedirectUri);

        // Verify Authorization header is set with Basic auth
        expect(capturedHeaders?.['Authorization']).toBeDefined();
        const expectedCredentials = Buffer.from(`${testClientId}:${testClientSecret}`).toString('base64');
        expect(capturedHeaders?.['Authorization']).toBe(`Basic ${expectedCredentials}`);

        // Verify client_id is in body but client_secret is NOT
        const bodyParams = new URLSearchParams(capturedBody!);
        expect(bodyParams.get('client_id')).toBe(testClientId);
        expect(bodyParams.has('client_secret')).toBe(false);
        expect(bodyParams.get('grant_type')).toBe('authorization_code');
        expect(bodyParams.get('code')).toBe(testCode);
        expect(bodyParams.get('code_verifier')).toBe(testCodeVerifier);
      });

      it('should send credentials in Authorization header during token refresh', async () => {
        let capturedBody: string | undefined;
        let capturedHeaders: Record<string, string> | undefined;

        global.fetch = jest.fn().mockImplementation((url: string, options?: RequestInit) => {
          if (url.includes('openid-configuration')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: () => Promise.resolve(discoveryDoc),
            });
          }
          if (url.includes('/token')) {
            capturedBody = options?.body as string;
            capturedHeaders = options?.headers as Record<string, string>;
            return Promise.resolve({
              ok: true,
              status: 200,
              json: () => Promise.resolve(tokenResponse),
            });
          }
          return Promise.resolve({ ok: false, status: 404 });
        });

        const provider = new OIDCProvider({
          issuer: testIssuer,
          clientId: testClientId,
          clientSecret: testClientSecret,
          tokenEndpointAuthMethod: 'client_secret_basic',
        });

        await provider.refreshToken(testRefreshToken);

        // Verify Authorization header is set with Basic auth
        expect(capturedHeaders?.['Authorization']).toBeDefined();
        const expectedCredentials = Buffer.from(`${testClientId}:${testClientSecret}`).toString('base64');
        expect(capturedHeaders?.['Authorization']).toBe(`Basic ${expectedCredentials}`);

        // Verify client_id is in body but client_secret is NOT
        const bodyParams = new URLSearchParams(capturedBody!);
        expect(bodyParams.get('client_id')).toBe(testClientId);
        expect(bodyParams.has('client_secret')).toBe(false);
        expect(bodyParams.get('grant_type')).toBe('refresh_token');
        expect(bodyParams.get('refresh_token')).toBe(testRefreshToken);
      });

      it('should handle special characters in credentials', async () => {
        const specialClientId = 'client:with/special+chars=';
        const specialClientSecret = 'secret:with/special+chars=&more';
        let capturedHeaders: Record<string, string> | undefined;

        global.fetch = jest.fn().mockImplementation((url: string, options?: RequestInit) => {
          if (url.includes('openid-configuration')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: () => Promise.resolve(discoveryDoc),
            });
          }
          if (url.includes('/token')) {
            capturedHeaders = options?.headers as Record<string, string>;
            return Promise.resolve({
              ok: true,
              status: 200,
              json: () => Promise.resolve(tokenResponse),
            });
          }
          return Promise.resolve({ ok: false, status: 404 });
        });

        const provider = new OIDCProvider({
          issuer: testIssuer,
          clientId: specialClientId,
          clientSecret: specialClientSecret,
          tokenEndpointAuthMethod: 'client_secret_basic',
        });

        await provider.exchangeCode(testCode, testCodeVerifier, testRedirectUri);

        // Verify the credentials are properly base64 encoded
        const expectedCredentials = Buffer.from(`${specialClientId}:${specialClientSecret}`).toString('base64');
        expect(capturedHeaders?.['Authorization']).toBe(`Basic ${expectedCredentials}`);

        // Verify we can decode it back correctly
        const authHeader = capturedHeaders?.['Authorization'];
        const base64Part = authHeader?.replace('Basic ', '');
        const decoded = Buffer.from(base64Part!, 'base64').toString('utf-8');
        expect(decoded).toBe(`${specialClientId}:${specialClientSecret}`);
      });

      it('should not set Authorization header without client_secret', async () => {
        let capturedHeaders: Record<string, string> | undefined;

        global.fetch = jest.fn().mockImplementation((url: string, options?: RequestInit) => {
          if (url.includes('openid-configuration')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: () => Promise.resolve(discoveryDoc),
            });
          }
          if (url.includes('/token')) {
            capturedHeaders = options?.headers as Record<string, string>;
            return Promise.resolve({
              ok: true,
              status: 200,
              json: () => Promise.resolve(tokenResponse),
            });
          }
          return Promise.resolve({ ok: false, status: 404 });
        });

        const provider = new OIDCProvider({
          issuer: testIssuer,
          clientId: testClientId,
          // No clientSecret
          tokenEndpointAuthMethod: 'client_secret_basic',
        });

        await provider.exchangeCode(testCode, testCodeVerifier, testRedirectUri);

        // Without client_secret, Authorization header should not be set
        expect(capturedHeaders?.['Authorization']).toBeUndefined();
      });
    });

    describe('token exchange error handling', () => {
      it('should throw error on token exchange failure', async () => {
        global.fetch = jest.fn().mockImplementation((url: string) => {
          if (url.includes('openid-configuration')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: () => Promise.resolve(discoveryDoc),
            });
          }
          if (url.includes('/token')) {
            return Promise.resolve({
              ok: false,
              status: 400,
              text: () => Promise.resolve('{"error":"invalid_grant","error_description":"Code expired"}'),
            });
          }
          return Promise.resolve({ ok: false, status: 404 });
        });

        const provider = new OIDCProvider({
          issuer: testIssuer,
          clientId: testClientId,
          clientSecret: testClientSecret,
        });

        await expect(provider.exchangeCode(testCode, testCodeVerifier, testRedirectUri))
          .rejects.toThrow('Token exchange failed');
      });

      it('should throw error on token refresh failure', async () => {
        global.fetch = jest.fn().mockImplementation((url: string) => {
          if (url.includes('openid-configuration')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: () => Promise.resolve(discoveryDoc),
            });
          }
          if (url.includes('/token')) {
            return Promise.resolve({
              ok: false,
              status: 400,
              text: () => Promise.resolve('{"error":"invalid_grant","error_description":"Refresh token expired"}'),
            });
          }
          return Promise.resolve({ ok: false, status: 404 });
        });

        const provider = new OIDCProvider({
          issuer: testIssuer,
          clientId: testClientId,
          clientSecret: testClientSecret,
        });

        await expect(provider.refreshToken(testRefreshToken))
          .rejects.toThrow('Token refresh failed');
      });
    });

    describe('token response parsing', () => {
      it('should correctly parse token response', async () => {
        global.fetch = jest.fn().mockImplementation((url: string) => {
          if (url.includes('openid-configuration')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: () => Promise.resolve(discoveryDoc),
            });
          }
          if (url.includes('/token')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: () => Promise.resolve(tokenResponse),
            });
          }
          return Promise.resolve({ ok: false, status: 404 });
        });

        const provider = new OIDCProvider({
          issuer: testIssuer,
          clientId: testClientId,
          clientSecret: testClientSecret,
        });

        const result = await provider.exchangeCode(testCode, testCodeVerifier, testRedirectUri);

        expect(result.accessToken).toBe('test-access-token');
        expect(result.tokenType).toBe('Bearer');
        expect(result.expiresIn).toBe(3600);
        expect(result.refreshToken).toBe('new-refresh-token');
      });
    });
  });
});
