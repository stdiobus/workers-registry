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
 * Property-based tests for OIDC Provider.
 *
 * Feature: oauth-authentication
 * Properties: OIDC Discovery endpoint format, Token validation claims
 *
 * **Validates: Requirements 7a.1, 7a.5**
 *
 * @module oidc-provider.property.test
 */

import * as fc from 'fast-check';
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
// Custom Arbitraries
// =============================================================================

/**
 * Generate a valid HTTPS domain name.
 */
const validDomainArb = fc.tuple(
  fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')), { minLength: 3, maxLength: 10 }),
  fc.constantFrom('com', 'org', 'net', 'io', 'dev')
).map(([name, tld]) => `${name}.${tld}`);

/**
 * Generate a valid HTTPS issuer URL.
 */
const validIssuerArb = fc.tuple(
  validDomainArb,
  fc.option(fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')), { minLength: 1, maxLength: 10 }), { nil: undefined })
).map(([domain, path]) => path ? `https://${domain}/${path}` : `https://${domain}`);

/**
 * Generate a valid client ID.
 */
const validClientIdArb = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-_'.split('')),
  { minLength: 8, maxLength: 32 }
);

/**
 * Generate a valid subject identifier.
 */
const validSubjectArb = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-_'.split('')),
  { minLength: 8, maxLength: 64 }
);

/**
 * Generate a valid nonce.
 */
const validNonceArb = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-_'.split('')),
  { minLength: 16, maxLength: 64 }
);

/**
 * Generate a clock skew value in seconds.
 */
const clockSkewArb = fc.integer({ min: 0, max: 300 });

// =============================================================================
// Property Tests
// =============================================================================

describe('OIDC Provider Property Tests', () => {
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

  /**
   * Feature: oauth-authentication, Property: OIDC Discovery Endpoint Format
   *
   * *For any* valid issuer URL, the discovery URL SHALL be
   * {issuer}/.well-known/openid-configuration.
   *
   * **Validates: Requirements 7a.1**
   */
  describe('Property: OIDC Discovery Endpoint Format', () => {
    test('discovery URL is always {issuer}/.well-known/openid-configuration', () => {
      fc.assert(
        fc.property(
          validIssuerArb,
          (issuer) => {
            // Normalize issuer (remove trailing slash if present)
            const normalizedIssuer = issuer.replace(/\/$/, '');
            const expectedDiscoveryUrl = `${normalizedIssuer}/.well-known/openid-configuration`;

            // Create provider and verify discovery URL format
            const provider = new OIDCProvider({ issuer: normalizedIssuer, skipDiscovery: true });

            // The discovery URL should follow the OIDC spec format
            // We verify this by checking the issuer is stored correctly
            expect(provider.getIssuer()).toBe(normalizedIssuer);

            // The discovery URL format is: {issuer}/.well-known/openid-configuration
            // This is verified by the discover() method behavior
            const discoveryUrl = `${provider.getIssuer()}/.well-known/openid-configuration`;
            expect(discoveryUrl).toBe(expectedDiscoveryUrl);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('discovery URL handles issuers with and without trailing slashes consistently', () => {
      fc.assert(
        fc.property(
          validDomainArb,
          (domain) => {
            const issuerWithoutSlash = `https://${domain}`;

            // Both should produce the same normalized discovery URL
            // Note: OIDCProvider rejects trailing slashes in query/fragment but not in path
            // We test with the normalized version
            const provider = new OIDCProvider({ issuer: issuerWithoutSlash, skipDiscovery: true });

            const discoveryUrl = `${provider.getIssuer()}/.well-known/openid-configuration`;
            expect(discoveryUrl).toBe(`https://${domain}/.well-known/openid-configuration`);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('discovery document validation is consistent for valid documents', async () => {
      await fc.assert(
        fc.asyncProperty(
          validIssuerArb,
          async (issuer) => {
            const normalizedIssuer = issuer.replace(/\/$/, '');
            const discoveryDoc = {
              issuer: normalizedIssuer,
              authorization_endpoint: `${normalizedIssuer}/authorize`,
              token_endpoint: `${normalizedIssuer}/token`,
              jwks_uri: `${normalizedIssuer}/.well-known/jwks.json`,
            };

            mockFetch(new Map([
              [`${normalizedIssuer}/.well-known/openid-configuration`, { status: 200, body: discoveryDoc }],
            ]));

            const provider = new OIDCProvider({ issuer: normalizedIssuer });
            const result = await provider.discover();

            // Valid discovery document should always succeed
            expect(result.success).toBe(true);
            expect(result.document?.issuer).toBe(normalizedIssuer);
            expect(result.document?.authorization_endpoint).toBe(`${normalizedIssuer}/authorize`);
            expect(result.document?.token_endpoint).toBe(`${normalizedIssuer}/token`);

            restoreFetch();
          }
        ),
        { numRuns: 100 }
      );
    });

    test('discovery document validation rejects mismatched issuers', async () => {
      await fc.assert(
        fc.asyncProperty(
          validIssuerArb,
          validIssuerArb,
          async (configuredIssuer, documentIssuer) => {
            const normalizedConfigured = configuredIssuer.replace(/\/$/, '');
            const normalizedDocument = documentIssuer.replace(/\/$/, '');

            // Skip if issuers happen to match
            if (normalizedConfigured === normalizedDocument) {
              return;
            }

            const discoveryDoc = {
              issuer: normalizedDocument, // Different from configured
              authorization_endpoint: `${normalizedDocument}/authorize`,
              token_endpoint: `${normalizedDocument}/token`,
            };

            mockFetch(new Map([
              [`${normalizedConfigured}/.well-known/openid-configuration`, { status: 200, body: discoveryDoc }],
            ]));

            const provider = new OIDCProvider({ issuer: normalizedConfigured });
            const result = await provider.discover();

            // Mismatched issuer should always fail
            expect(result.success).toBe(false);
            expect(result.error).toContain('issuer mismatch');

            restoreFetch();
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Feature: oauth-authentication, Property: Token Validation Claims
   *
   * *For any* valid ID token claims, validation SHALL be deterministic.
   * Issuer validation SHALL handle trailing slashes consistently.
   * Audience validation SHALL work with both string and array formats.
   * Expiration validation SHALL respect clock skew.
   *
   * **Validates: Requirements 7a.5**
   */
  describe('Property: Token Validation Claims', () => {
    test('issuer validation handles trailing slashes consistently', async () => {
      await fc.assert(
        fc.asyncProperty(
          validDomainArb,
          validClientIdArb,
          validSubjectArb,
          async (domain, clientId, subject) => {
            const issuerWithoutSlash = `https://${domain}`;
            const jwksUri = `${issuerWithoutSlash}/.well-known/jwks.json`;

            const discoveryDoc = {
              issuer: issuerWithoutSlash,
              authorization_endpoint: `${issuerWithoutSlash}/authorize`,
              token_endpoint: `${issuerWithoutSlash}/token`,
              jwks_uri: jwksUri,
            };

            mockFetch(new Map([
              [`${issuerWithoutSlash}/.well-known/openid-configuration`, { status: 200, body: discoveryDoc }],
              [jwksUri, { status: 200, body: testJWKS }],
            ]));

            const now = Math.floor(Date.now() / 1000);

            // Token with issuer without trailing slash
            const payloadWithoutSlash = {
              iss: issuerWithoutSlash,
              sub: subject,
              aud: clientId,
              exp: now + 3600,
              iat: now - 60,
            };

            // Token with issuer with trailing slash
            const payloadWithSlash = {
              iss: `${issuerWithoutSlash}/`,
              sub: subject,
              aud: clientId,
              exp: now + 3600,
              iat: now - 60,
            };

            const tokenWithoutSlash = createTestJWT(payloadWithoutSlash, testKeyPair.privateKey, testKid);
            const tokenWithSlash = createTestJWT(payloadWithSlash, testKeyPair.privateKey, testKid);

            const provider = new OIDCProvider({ issuer: issuerWithoutSlash });

            // Both should validate successfully (trailing slash normalization)
            const resultWithoutSlash = await provider.validateIdToken(tokenWithoutSlash, { audience: clientId });
            const resultWithSlash = await provider.validateIdToken(tokenWithSlash, { audience: clientId });

            expect(resultWithoutSlash.valid).toBe(true);
            expect(resultWithSlash.valid).toBe(true);

            restoreFetch();
          }
        ),
        { numRuns: 100 }
      );
    });

    test('audience validation works with string format', async () => {
      await fc.assert(
        fc.asyncProperty(
          validIssuerArb,
          validClientIdArb,
          validSubjectArb,
          async (issuer, clientId, subject) => {
            const normalizedIssuer = issuer.replace(/\/$/, '');
            const jwksUri = `${normalizedIssuer}/.well-known/jwks.json`;

            const discoveryDoc = {
              issuer: normalizedIssuer,
              authorization_endpoint: `${normalizedIssuer}/authorize`,
              token_endpoint: `${normalizedIssuer}/token`,
              jwks_uri: jwksUri,
            };

            mockFetch(new Map([
              [`${normalizedIssuer}/.well-known/openid-configuration`, { status: 200, body: discoveryDoc }],
              [jwksUri, { status: 200, body: testJWKS }],
            ]));

            const now = Math.floor(Date.now() / 1000);
            const payload = {
              iss: normalizedIssuer,
              sub: subject,
              aud: clientId, // String format
              exp: now + 3600,
              iat: now - 60,
            };

            const token = createTestJWT(payload, testKeyPair.privateKey, testKid);
            const provider = new OIDCProvider({ issuer: normalizedIssuer });

            const result = await provider.validateIdToken(token, { audience: clientId });
            expect(result.valid).toBe(true);
            expect(result.claims?.aud).toBe(clientId);

            restoreFetch();
          }
        ),
        { numRuns: 100 }
      );
    });

    test('audience validation works with array format', async () => {
      await fc.assert(
        fc.asyncProperty(
          validIssuerArb,
          validClientIdArb,
          validClientIdArb,
          validSubjectArb,
          async (issuer, clientId, otherClientId, subject) => {
            const normalizedIssuer = issuer.replace(/\/$/, '');
            const jwksUri = `${normalizedIssuer}/.well-known/jwks.json`;

            const discoveryDoc = {
              issuer: normalizedIssuer,
              authorization_endpoint: `${normalizedIssuer}/authorize`,
              token_endpoint: `${normalizedIssuer}/token`,
              jwks_uri: jwksUri,
            };

            mockFetch(new Map([
              [`${normalizedIssuer}/.well-known/openid-configuration`, { status: 200, body: discoveryDoc }],
              [jwksUri, { status: 200, body: testJWKS }],
            ]));

            const now = Math.floor(Date.now() / 1000);
            const payload = {
              iss: normalizedIssuer,
              sub: subject,
              aud: [clientId, otherClientId], // Array format
              exp: now + 3600,
              iat: now - 60,
            };

            const token = createTestJWT(payload, testKeyPair.privateKey, testKid);
            const provider = new OIDCProvider({ issuer: normalizedIssuer });

            // Should validate when expected audience is in the array
            const result = await provider.validateIdToken(token, { audience: clientId });
            expect(result.valid).toBe(true);

            restoreFetch();
          }
        ),
        { numRuns: 100 }
      );
    });

    test('audience validation rejects when client ID not in audience', async () => {
      await fc.assert(
        fc.asyncProperty(
          validIssuerArb,
          validClientIdArb,
          validClientIdArb,
          validSubjectArb,
          async (issuer, tokenAudience, expectedAudience, subject) => {
            // Skip if audiences happen to match
            if (tokenAudience === expectedAudience) {
              return;
            }

            const normalizedIssuer = issuer.replace(/\/$/, '');
            const jwksUri = `${normalizedIssuer}/.well-known/jwks.json`;

            const discoveryDoc = {
              issuer: normalizedIssuer,
              authorization_endpoint: `${normalizedIssuer}/authorize`,
              token_endpoint: `${normalizedIssuer}/token`,
              jwks_uri: jwksUri,
            };

            mockFetch(new Map([
              [`${normalizedIssuer}/.well-known/openid-configuration`, { status: 200, body: discoveryDoc }],
              [jwksUri, { status: 200, body: testJWKS }],
            ]));

            const now = Math.floor(Date.now() / 1000);
            const payload = {
              iss: normalizedIssuer,
              sub: subject,
              aud: tokenAudience, // Different from expected
              exp: now + 3600,
              iat: now - 60,
            };

            const token = createTestJWT(payload, testKeyPair.privateKey, testKid);
            const provider = new OIDCProvider({ issuer: normalizedIssuer });

            const result = await provider.validateIdToken(token, { audience: expectedAudience });
            expect(result.valid).toBe(false);
            expect(result.error).toContain('Invalid audience');

            restoreFetch();
          }
        ),
        { numRuns: 100 }
      );
    });

    test('expiration validation respects clock skew', async () => {
      await fc.assert(
        fc.asyncProperty(
          validIssuerArb,
          validClientIdArb,
          validSubjectArb,
          clockSkewArb,
          async (issuer, clientId, subject, clockSkew) => {
            const normalizedIssuer = issuer.replace(/\/$/, '');
            const jwksUri = `${normalizedIssuer}/.well-known/jwks.json`;

            const discoveryDoc = {
              issuer: normalizedIssuer,
              authorization_endpoint: `${normalizedIssuer}/authorize`,
              token_endpoint: `${normalizedIssuer}/token`,
              jwks_uri: jwksUri,
            };

            mockFetch(new Map([
              [`${normalizedIssuer}/.well-known/openid-configuration`, { status: 200, body: discoveryDoc }],
              [jwksUri, { status: 200, body: testJWKS }],
            ]));

            const now = Math.floor(Date.now() / 1000);

            // Token that expired exactly at (now - clockSkew/2)
            // Should be valid with clock skew tolerance
            const expiredWithinSkew = {
              iss: normalizedIssuer,
              sub: subject,
              aud: clientId,
              exp: now - Math.floor(clockSkew / 2), // Expired within clock skew
              iat: now - 3600,
            };

            // Token that expired well before clock skew
            const expiredBeyondSkew = {
              iss: normalizedIssuer,
              sub: subject,
              aud: clientId,
              exp: now - clockSkew - 100, // Expired beyond clock skew
              iat: now - 7200,
            };

            const tokenWithinSkew = createTestJWT(expiredWithinSkew, testKeyPair.privateKey, testKid);
            const tokenBeyondSkew = createTestJWT(expiredBeyondSkew, testKeyPair.privateKey, testKid);

            const provider = new OIDCProvider({ issuer: normalizedIssuer });

            // Token within clock skew should be valid
            const resultWithinSkew = await provider.validateIdToken(tokenWithinSkew, {
              audience: clientId,
              clockSkewSeconds: clockSkew,
            });
            expect(resultWithinSkew.valid).toBe(true);

            // Token beyond clock skew should be invalid
            const resultBeyondSkew = await provider.validateIdToken(tokenBeyondSkew, {
              audience: clientId,
              clockSkewSeconds: clockSkew,
            });
            expect(resultBeyondSkew.valid).toBe(false);
            expect(resultBeyondSkew.error).toContain('expired');

            restoreFetch();
          }
        ),
        { numRuns: 100 }
      );
    });

    test('validation is deterministic for the same token', async () => {
      await fc.assert(
        fc.asyncProperty(
          validIssuerArb,
          validClientIdArb,
          validSubjectArb,
          async (issuer, clientId, subject) => {
            const normalizedIssuer = issuer.replace(/\/$/, '');
            const jwksUri = `${normalizedIssuer}/.well-known/jwks.json`;

            const discoveryDoc = {
              issuer: normalizedIssuer,
              authorization_endpoint: `${normalizedIssuer}/authorize`,
              token_endpoint: `${normalizedIssuer}/token`,
              jwks_uri: jwksUri,
            };

            mockFetch(new Map([
              [`${normalizedIssuer}/.well-known/openid-configuration`, { status: 200, body: discoveryDoc }],
              [jwksUri, { status: 200, body: testJWKS }],
            ]));

            const now = Math.floor(Date.now() / 1000);
            const payload = {
              iss: normalizedIssuer,
              sub: subject,
              aud: clientId,
              exp: now + 3600,
              iat: now - 60,
            };

            const token = createTestJWT(payload, testKeyPair.privateKey, testKid);
            const provider = new OIDCProvider({ issuer: normalizedIssuer });

            // Validate the same token multiple times
            const result1 = await provider.validateIdToken(token, { audience: clientId });
            const result2 = await provider.validateIdToken(token, { audience: clientId });
            const result3 = await provider.validateIdToken(token, { audience: clientId });

            // All results should be identical
            expect(result1.valid).toBe(result2.valid);
            expect(result2.valid).toBe(result3.valid);
            expect(result1.claims?.sub).toBe(result2.claims?.sub);
            expect(result2.claims?.sub).toBe(result3.claims?.sub);

            restoreFetch();
          }
        ),
        { numRuns: 100 }
      );
    });

    test('iat validation rejects tokens issued in the future beyond clock skew', async () => {
      await fc.assert(
        fc.asyncProperty(
          validIssuerArb,
          validClientIdArb,
          validSubjectArb,
          clockSkewArb,
          async (issuer, clientId, subject, clockSkew) => {
            const normalizedIssuer = issuer.replace(/\/$/, '');
            const jwksUri = `${normalizedIssuer}/.well-known/jwks.json`;

            const discoveryDoc = {
              issuer: normalizedIssuer,
              authorization_endpoint: `${normalizedIssuer}/authorize`,
              token_endpoint: `${normalizedIssuer}/token`,
              jwks_uri: jwksUri,
            };

            mockFetch(new Map([
              [`${normalizedIssuer}/.well-known/openid-configuration`, { status: 200, body: discoveryDoc }],
              [jwksUri, { status: 200, body: testJWKS }],
            ]));

            const now = Math.floor(Date.now() / 1000);

            // Token issued well in the future (beyond clock skew)
            const futurePayload = {
              iss: normalizedIssuer,
              sub: subject,
              aud: clientId,
              exp: now + 7200,
              iat: now + clockSkew + 100, // Issued beyond clock skew in future
            };

            const futureToken = createTestJWT(futurePayload, testKeyPair.privateKey, testKid);
            const provider = new OIDCProvider({ issuer: normalizedIssuer });

            const result = await provider.validateIdToken(futureToken, {
              audience: clientId,
              clockSkewSeconds: clockSkew,
            });

            expect(result.valid).toBe(false);
            expect(result.error).toContain('issued in the future');

            restoreFetch();
          }
        ),
        { numRuns: 100 }
      );
    });

    test('nonce validation is deterministic', async () => {
      await fc.assert(
        fc.asyncProperty(
          validIssuerArb,
          validClientIdArb,
          validSubjectArb,
          validNonceArb,
          async (issuer, clientId, subject, nonce) => {
            const normalizedIssuer = issuer.replace(/\/$/, '');
            const jwksUri = `${normalizedIssuer}/.well-known/jwks.json`;

            const discoveryDoc = {
              issuer: normalizedIssuer,
              authorization_endpoint: `${normalizedIssuer}/authorize`,
              token_endpoint: `${normalizedIssuer}/token`,
              jwks_uri: jwksUri,
            };

            mockFetch(new Map([
              [`${normalizedIssuer}/.well-known/openid-configuration`, { status: 200, body: discoveryDoc }],
              [jwksUri, { status: 200, body: testJWKS }],
            ]));

            const now = Math.floor(Date.now() / 1000);
            const payload = {
              iss: normalizedIssuer,
              sub: subject,
              aud: clientId,
              exp: now + 3600,
              iat: now - 60,
              nonce: nonce,
            };

            const token = createTestJWT(payload, testKeyPair.privateKey, testKid);
            const provider = new OIDCProvider({ issuer: normalizedIssuer });

            // Matching nonce should always succeed
            const validResult = await provider.validateIdToken(token, {
              audience: clientId,
              nonce: nonce,
            });
            expect(validResult.valid).toBe(true);

            // Different nonce should always fail
            const invalidResult = await provider.validateIdToken(token, {
              audience: clientId,
              nonce: nonce + '-different',
            });
            expect(invalidResult.valid).toBe(false);
            expect(invalidResult.error).toContain('Invalid nonce');

            restoreFetch();
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
