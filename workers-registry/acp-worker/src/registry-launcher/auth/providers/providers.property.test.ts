/*
 * Apache License 2.0
 * Copyright (c) 2025–present Raman Marozau, Target Insight Function.
 * Contact: raman@worktif.com
 */

/**
 * Property-based tests for OAuth providers.
 *
 * Properties tested:
 * - Property 8: Authorization URL Required Parameters
 * - Property 11: Provider Endpoints HTTPS Enforcement
 * - Property 17: Provider Default Scopes
 */

import * as fc from 'fast-check';
import { BaseAuthProvider, BaseProviderConfig } from './base-provider.js';
import type { AuthorizationParams } from '../types.js';

/**
 * Concrete test provider for property testing.
 */
class TestProvider extends BaseAuthProvider {
  constructor(config: Partial<BaseProviderConfig> = {}) {
    super({
      id: 'openai',
      name: 'Test Provider',
      authorizationEndpoint: config.authorizationEndpoint ?? 'https://auth.example.com/authorize',
      tokenEndpoint: config.tokenEndpoint ?? 'https://auth.example.com/token',
      defaultScopes: config.defaultScopes ?? ['openid', 'profile'],
      tokenInjection: config.tokenInjection ?? { type: 'header', key: 'Authorization', format: 'Bearer {token}' },
      ...config,
    });
  }
}

/**
 * Arbitrary for generating valid client IDs.
 */
const clientIdArb = fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-_'.split('')), { minLength: 5, maxLength: 30 });

/**
 * Arbitrary for generating valid redirect URIs.
 */
const redirectUriArb = fc.integer({ min: 1024, max: 65535 }).map(port => `http://127.0.0.1:${port}/callback`);

/**
 * Arbitrary for generating valid scopes.
 */
const scopeArb = fc.constantFrom('openid', 'profile', 'email', 'openid profile', 'openid profile email');

/**
 * Arbitrary for generating valid state parameters.
 */
const stateArb = fc.stringOf(fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'.split('')), { minLength: 32, maxLength: 48 });

/**
 * Arbitrary for generating valid PKCE code challenges.
 */
const codeChallengeArb = fc.stringOf(fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'.split('')), { minLength: 43, maxLength: 64 });

/**
 * Arbitrary for generating valid authorization params.
 */
const authParamsArb: fc.Arbitrary<AuthorizationParams> = fc.record({
  clientId: clientIdArb,
  redirectUri: redirectUriArb,
  scope: scopeArb,
  state: stateArb,
  codeChallenge: codeChallengeArb,
  codeChallengeMethod: fc.constant('S256' as const),
  responseType: fc.constant('code' as const),
});

describe('Provider Property Tests', () => {
  /**
   * Property 8: Authorization URL Required Parameters
   *
   * For any valid authorization parameters:
   * - The built URL contains all required OAuth 2.1 parameters
   * - Parameters are properly URL-encoded
   * - The URL is valid and parseable
   *
   * Validates: Requirements 3.2
   */
  describe('Property 8: Authorization URL Required Parameters', () => {
    it('should include all required OAuth 2.1 parameters', () => {
      fc.assert(
        fc.property(authParamsArb, (params) => {
          const provider = new TestProvider();
          const url = provider.buildAuthorizationUrl(params);
          const parsed = new URL(url);

          // All required parameters must be present
          expect(parsed.searchParams.has('client_id')).toBe(true);
          expect(parsed.searchParams.has('redirect_uri')).toBe(true);
          expect(parsed.searchParams.has('response_type')).toBe(true);
          expect(parsed.searchParams.has('scope')).toBe(true);
          expect(parsed.searchParams.has('state')).toBe(true);
          expect(parsed.searchParams.has('code_challenge')).toBe(true);
          expect(parsed.searchParams.has('code_challenge_method')).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('should preserve parameter values exactly', () => {
      fc.assert(
        fc.property(authParamsArb, (params) => {
          const provider = new TestProvider();
          const url = provider.buildAuthorizationUrl(params);
          const parsed = new URL(url);

          // Values must match exactly (URL decoding handled by URL API)
          expect(parsed.searchParams.get('client_id')).toBe(params.clientId);
          expect(parsed.searchParams.get('redirect_uri')).toBe(params.redirectUri);
          expect(parsed.searchParams.get('response_type')).toBe(params.responseType);
          expect(parsed.searchParams.get('scope')).toBe(params.scope);
          expect(parsed.searchParams.get('state')).toBe(params.state);
          expect(parsed.searchParams.get('code_challenge')).toBe(params.codeChallenge);
          expect(parsed.searchParams.get('code_challenge_method')).toBe(params.codeChallengeMethod);
        }),
        { numRuns: 100 }
      );
    });

    it('should always use S256 code challenge method', () => {
      fc.assert(
        fc.property(authParamsArb, (params) => {
          const provider = new TestProvider();
          const url = provider.buildAuthorizationUrl(params);
          const parsed = new URL(url);

          expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
        }),
        { numRuns: 100 }
      );
    });

    it('should always use code response type', () => {
      fc.assert(
        fc.property(authParamsArb, (params) => {
          const provider = new TestProvider();
          const url = provider.buildAuthorizationUrl(params);
          const parsed = new URL(url);

          expect(parsed.searchParams.get('response_type')).toBe('code');
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 11: Provider Endpoints HTTPS Enforcement
   *
   * For any provider configuration:
   * - validateConfig() throws for HTTP endpoints
   * - validateConfig() passes for HTTPS endpoints
   *
   * Validates: Requirements 3.6, 7.5
   */
  describe('Property 11: Provider Endpoints HTTPS Enforcement', () => {
    /**
     * Arbitrary for generating domain names.
     */
    const domainArb = fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')), { minLength: 3, maxLength: 10 })
      .map(s => `${s}.example.com`);

    /**
     * Arbitrary for generating paths.
     */
    const pathArb = fc.constantFrom('/authorize', '/oauth/authorize', '/auth', '/token', '/oauth/token');

    it('should reject HTTP authorization endpoints at construction time', () => {
      fc.assert(
        fc.property(domainArb, pathArb, (domain, path) => {
          const httpUrl = `http://${domain}${path}`;
          // Validation now happens at construction time
          expect(() => new TestProvider({
            authorizationEndpoint: httpUrl,
          })).toThrow(/must use HTTPS/);
        }),
        { numRuns: 50 }
      );
    });

    it('should reject HTTP token endpoints at construction time', () => {
      fc.assert(
        fc.property(domainArb, pathArb, (domain, path) => {
          const httpUrl = `http://${domain}${path}`;
          // Validation now happens at construction time
          expect(() => new TestProvider({
            tokenEndpoint: httpUrl,
          })).toThrow(/must use HTTPS/);
        }),
        { numRuns: 50 }
      );
    });

    it('should accept HTTPS endpoints', () => {
      fc.assert(
        fc.property(domainArb, pathArb, domainArb, pathArb, (authDomain, authPath, tokenDomain, tokenPath) => {
          const authUrl = `https://${authDomain}${authPath}`;
          const tokenUrl = `https://${tokenDomain}${tokenPath}`;
          const provider = new TestProvider({
            authorizationEndpoint: authUrl,
            tokenEndpoint: tokenUrl,
          });

          expect(() => provider.validateConfig()).not.toThrow();
        }),
        { numRuns: 50 }
      );
    });
  });

  /**
   * Property 17: Provider Default Scopes
   *
   * For any provider:
   * - defaultScopes is a non-empty readonly array
   * - defaultScopes cannot be modified
   *
   * Validates: Requirements 7.2
   */
  describe('Property 17: Provider Default Scopes', () => {
    /**
     * Arbitrary for generating valid scope arrays.
     */
    const scopesArrayArb = fc.array(
      fc.constantFrom('openid', 'profile', 'email', 'read:user', 'api'),
      { minLength: 1, maxLength: 5 }
    );

    it('should have non-empty default scopes', () => {
      fc.assert(
        fc.property(scopesArrayArb, (scopes) => {
          const provider = new TestProvider({
            defaultScopes: scopes,
          });

          expect(provider.defaultScopes.length).toBeGreaterThan(0);
        }),
        { numRuns: 100 }
      );
    });

    it('should preserve default scopes exactly', () => {
      fc.assert(
        fc.property(scopesArrayArb, (scopes) => {
          const provider = new TestProvider({
            defaultScopes: scopes,
          });

          expect([...provider.defaultScopes]).toEqual(scopes);
        }),
        { numRuns: 100 }
      );
    });

    it('should freeze default scopes array', () => {
      fc.assert(
        fc.property(scopesArrayArb, (scopes) => {
          const provider = new TestProvider({
            defaultScopes: scopes,
          });

          expect(Object.isFrozen(provider.defaultScopes)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('should not allow modification of default scopes', () => {
      fc.assert(
        fc.property(scopesArrayArb, (scopes) => {
          const provider = new TestProvider({
            defaultScopes: scopes,
          });

          // Attempting to modify should throw in strict mode or be ignored
          expect(() => {
            (provider.defaultScopes as string[]).push('new-scope');
          }).toThrow();
        }),
        { numRuns: 50 }
      );
    });
  });
});
