/*
 * Apache License 2.0
 * Copyright (c) 2025–present Raman Marozau, Target Insight Function.
 * Contact: raman@worktif.com
 */

/**
 * Unit tests for BaseAuthProvider.
 */

import { BaseAuthProvider, BaseProviderConfig } from './base-provider.js';
import type { AuthorizationParams } from '../types.js';

/**
 * Concrete implementation for testing.
 */
class TestProvider extends BaseAuthProvider {
  constructor(config: Partial<BaseProviderConfig> = {}) {
    super({
      id: 'openai',
      name: 'Test Provider',
      authorizationEndpoint: 'https://auth.example.com/authorize',
      tokenEndpoint: 'https://auth.example.com/token',
      defaultScopes: ['openid', 'profile'],
      tokenInjection: { type: 'header', key: 'Authorization', format: 'Bearer {token}' },
      ...config,
    });
  }
}

describe('BaseAuthProvider', () => {
  describe('constructor', () => {
    it('should initialize with provided config', () => {
      const provider = new TestProvider();

      expect(provider.id).toBe('openai');
      expect(provider.name).toBe('Test Provider');
      expect(provider.defaultScopes).toEqual(['openid', 'profile']);
    });

    it('should freeze defaultScopes array', () => {
      const provider = new TestProvider();

      expect(Object.isFrozen(provider.defaultScopes)).toBe(true);
    });
  });

  describe('buildAuthorizationUrl', () => {
    it('should build URL with all required OAuth 2.1 parameters', () => {
      const provider = new TestProvider();
      const params: AuthorizationParams = {
        clientId: 'test-client-id',
        redirectUri: 'http://127.0.0.1:8080/callback',
        scope: 'openid profile',
        state: 'random-state-value',
        codeChallenge: 'code-challenge-value',
        codeChallengeMethod: 'S256',
        responseType: 'code',
      };

      const url = provider.buildAuthorizationUrl(params);
      const parsed = new URL(url);

      expect(parsed.origin).toBe('https://auth.example.com');
      expect(parsed.pathname).toBe('/authorize');
      expect(parsed.searchParams.get('client_id')).toBe('test-client-id');
      expect(parsed.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:8080/callback');
      expect(parsed.searchParams.get('response_type')).toBe('code');
      expect(parsed.searchParams.get('scope')).toBe('openid profile');
      expect(parsed.searchParams.get('state')).toBe('random-state-value');
      expect(parsed.searchParams.get('code_challenge')).toBe('code-challenge-value');
      expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
    });

    it('should include additional parameters when provided', () => {
      const provider = new TestProvider();
      const params: AuthorizationParams = {
        clientId: 'test-client-id',
        redirectUri: 'http://127.0.0.1:8080/callback',
        scope: 'openid profile',
        state: 'random-state-value',
        codeChallenge: 'code-challenge-value',
        codeChallengeMethod: 'S256',
        responseType: 'code',
        additionalParams: {
          prompt: 'consent',
          login_hint: 'user@example.com',
        },
      };

      const url = provider.buildAuthorizationUrl(params);
      const parsed = new URL(url);

      expect(parsed.searchParams.get('prompt')).toBe('consent');
      expect(parsed.searchParams.get('login_hint')).toBe('user@example.com');
    });

    it('should properly encode special characters in parameters', () => {
      const provider = new TestProvider();
      const params: AuthorizationParams = {
        clientId: 'test-client-id',
        redirectUri: 'http://127.0.0.1:8080/callback?foo=bar',
        scope: 'openid profile email',
        state: 'state+with+special/chars',
        codeChallenge: 'challenge_with-special.chars',
        codeChallengeMethod: 'S256',
        responseType: 'code',
      };

      const url = provider.buildAuthorizationUrl(params);
      const parsed = new URL(url);

      // URL should be properly encoded
      expect(parsed.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:8080/callback?foo=bar');
      expect(parsed.searchParams.get('state')).toBe('state+with+special/chars');
    });
  });

  describe('validateConfig', () => {
    it('should pass for valid HTTPS endpoints', () => {
      const provider = new TestProvider();

      expect(() => provider.validateConfig()).not.toThrow();
    });

    it('should throw for HTTP authorization endpoint', () => {
      const provider = new TestProvider({
        authorizationEndpoint: 'http://auth.example.com/authorize',
      });

      expect(() => provider.validateConfig()).toThrow(
        'Test Provider authorization endpoint must use HTTPS'
      );
    });

    it('should throw for HTTP token endpoint', () => {
      const provider = new TestProvider({
        tokenEndpoint: 'http://auth.example.com/token',
      });

      expect(() => provider.validateConfig()).toThrow(
        'Test Provider token endpoint must use HTTPS'
      );
    });
  });

  describe('getTokenInjection', () => {
    it('should return the configured token injection method', () => {
      const provider = new TestProvider();

      const injection = provider.getTokenInjection();

      expect(injection).toEqual({
        type: 'header',
        key: 'Authorization',
        format: 'Bearer {token}',
      });
    });

    it('should support different injection types', () => {
      const provider = new TestProvider({
        tokenInjection: { type: 'header', key: 'x-api-key' },
      });

      const injection = provider.getTokenInjection();

      expect(injection).toEqual({
        type: 'header',
        key: 'x-api-key',
      });
    });
  });

  describe('getEndpoints', () => {
    it('should return the provider endpoints', () => {
      const provider = new TestProvider();

      const endpoints = provider.getEndpoints();

      expect(endpoints).toEqual({
        authorizationEndpoint: 'https://auth.example.com/authorize',
        tokenEndpoint: 'https://auth.example.com/token',
      });
    });
  });

  describe('setClientCredentials', () => {
    it('should set client ID and secret', () => {
      const provider = new TestProvider();

      provider.setClientCredentials('new-client-id', 'new-client-secret');

      // Verify by building auth URL
      const params: AuthorizationParams = {
        clientId: 'new-client-id',
        redirectUri: 'http://127.0.0.1:8080/callback',
        scope: 'openid',
        state: 'state',
        codeChallenge: 'challenge',
        codeChallengeMethod: 'S256',
        responseType: 'code',
      };

      const url = provider.buildAuthorizationUrl(params);
      const parsed = new URL(url);

      expect(parsed.searchParams.get('client_id')).toBe('new-client-id');
    });

    it('should allow setting client ID without secret', () => {
      const provider = new TestProvider();

      provider.setClientCredentials('new-client-id');

      // Should not throw
      expect(() => provider.validateConfig()).not.toThrow();
    });
  });

  describe('exchangeCode', () => {
    let provider: TestProvider;
    let mockFetch: jest.SpyInstance;

    beforeEach(() => {
      provider = new TestProvider({ clientId: 'test-client' });
      mockFetch = jest.spyOn(global, 'fetch');
    });

    afterEach(() => {
      mockFetch.mockRestore();
    });

    it('should exchange code for tokens', async () => {
      const mockResponse: Record<string, unknown> = {
        access_token: 'access-token-value',
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'refresh-token-value',
        scope: 'openid profile',
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await provider.exchangeCode(
        'auth-code',
        'code-verifier',
        'http://127.0.0.1:8080/callback'
      );

      expect(result).toEqual({
        accessToken: 'access-token-value',
        tokenType: 'Bearer',
        expiresIn: 3600,
        refreshToken: 'refresh-token-value',
        scope: 'openid profile',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://auth.example.com/token',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json',
          },
        })
      );
    });

    it('should include client_id in request body', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          access_token: 'token',
          token_type: 'Bearer',
        }),
      });

      await provider.exchangeCode('code', 'verifier', 'http://localhost/callback');

      const call = mockFetch.mock.calls[0];
      const body = call[1].body as string;
      expect(body).toContain('client_id=test-client');
    });

    it('should throw on error response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve('{"error":"invalid_grant"}'),
      });

      await expect(
        provider.exchangeCode('invalid-code', 'verifier', 'http://localhost/callback')
      ).rejects.toThrow('Token exchange failed: 400');
    });

    it('should throw on missing access_token', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ token_type: 'Bearer' }),
      });

      await expect(
        provider.exchangeCode('code', 'verifier', 'http://localhost/callback')
      ).rejects.toThrow('Invalid token response: missing access_token');
    });

    it('should throw on missing token_type', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ access_token: 'token' }),
      });

      await expect(
        provider.exchangeCode('code', 'verifier', 'http://localhost/callback')
      ).rejects.toThrow('Invalid token response: missing token_type');
    });
  });

  describe('refreshToken', () => {
    let provider: TestProvider;
    let mockFetch: jest.SpyInstance;

    beforeEach(() => {
      provider = new TestProvider({ clientId: 'test-client' });
      mockFetch = jest.spyOn(global, 'fetch');
    });

    afterEach(() => {
      mockFetch.mockRestore();
    });

    it('should refresh tokens', async () => {
      const mockResponse: Record<string, unknown> = {
        access_token: 'new-access-token',
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'new-refresh-token',
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await provider.refreshToken('old-refresh-token');

      expect(result).toEqual({
        accessToken: 'new-access-token',
        tokenType: 'Bearer',
        expiresIn: 3600,
        refreshToken: 'new-refresh-token',
      });

      const call = mockFetch.mock.calls[0];
      const body = call[1].body as string;
      expect(body).toContain('grant_type=refresh_token');
      expect(body).toContain('refresh_token=old-refresh-token');
    });

    it('should throw on error response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('{"error":"invalid_token"}'),
      });

      await expect(provider.refreshToken('invalid-token')).rejects.toThrow(
        'Token refresh failed: 401'
      );
    });
  });

  describe('parseTokenResponse', () => {
    it('should handle optional id_token', async () => {
      const provider = new TestProvider({ clientId: 'test-client' });
      const mockFetch = jest.spyOn(global, 'fetch');

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          access_token: 'token',
          token_type: 'Bearer',
          id_token: 'id-token-value',
        }),
      } as unknown as Response);

      const result = await provider.exchangeCode('code', 'verifier', 'http://localhost/callback');

      expect(result.idToken).toBe('id-token-value');

      mockFetch.mockRestore();
    });
  });
});
