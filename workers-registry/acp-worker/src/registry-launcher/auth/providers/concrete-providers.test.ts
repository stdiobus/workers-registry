/*
 * Apache License 2.0
 * Copyright (c) 2025–present Raman Marozau, Target Insight Function.
 * Contact: raman@worktif.com
 */

/**
 * Unit tests for concrete OAuth provider implementations.
 */

import { OpenAIProvider } from './openai-provider.js';
import { GitHubProvider } from './github-provider.js';
import { GoogleProvider } from './google-provider.js';
import { CognitoProvider } from './cognito-provider.js';
import { AzureProvider } from './azure-provider.js';
import { AnthropicProvider } from './anthropic-provider.js';

describe('OpenAIProvider', () => {
  it('should have correct provider ID', () => {
    const provider = new OpenAIProvider();
    expect(provider.id).toBe('openai');
  });

  it('should have correct name', () => {
    const provider = new OpenAIProvider();
    expect(provider.name).toBe('OpenAI');
  });

  it('should have correct default scopes', () => {
    const provider = new OpenAIProvider();
    expect([...provider.defaultScopes]).toEqual(['openid', 'profile']);
  });

  it('should have correct endpoints', () => {
    const provider = new OpenAIProvider();
    const endpoints = provider.getEndpoints();
    expect(endpoints.authorizationEndpoint).toBe('https://auth.openai.com/authorize');
    expect(endpoints.tokenEndpoint).toBe('https://auth.openai.com/token');
  });

  it('should use Bearer token injection', () => {
    const provider = new OpenAIProvider();
    const injection = provider.getTokenInjection();
    expect(injection.type).toBe('header');
    expect(injection.key).toBe('Authorization');
    expect(injection.format).toBe('Bearer {token}');
  });

  it('should pass HTTPS validation', () => {
    const provider = new OpenAIProvider();
    expect(() => provider.validateConfig()).not.toThrow();
  });

  it('should accept client ID in constructor', () => {
    const provider = new OpenAIProvider('my-client-id');
    expect(provider.id).toBe('openai');
  });
});

describe('GitHubProvider', () => {
  it('should have correct provider ID', () => {
    const provider = new GitHubProvider();
    expect(provider.id).toBe('github');
  });

  it('should have correct name', () => {
    const provider = new GitHubProvider();
    expect(provider.name).toBe('GitHub');
  });

  it('should have correct default scopes', () => {
    const provider = new GitHubProvider();
    expect([...provider.defaultScopes]).toEqual(['read:user']);
  });

  it('should have correct endpoints', () => {
    const provider = new GitHubProvider();
    const endpoints = provider.getEndpoints();
    expect(endpoints.authorizationEndpoint).toBe('https://github.com/login/oauth/authorize');
    expect(endpoints.tokenEndpoint).toBe('https://github.com/login/oauth/access_token');
  });

  it('should use Bearer token injection', () => {
    const provider = new GitHubProvider();
    const injection = provider.getTokenInjection();
    expect(injection.type).toBe('header');
    expect(injection.key).toBe('Authorization');
    expect(injection.format).toBe('Bearer {token}');
  });

  it('should pass HTTPS validation', () => {
    const provider = new GitHubProvider();
    expect(() => provider.validateConfig()).not.toThrow();
  });

  it('should accept client ID and secret in constructor', () => {
    const provider = new GitHubProvider('my-client-id', 'my-client-secret');
    expect(provider.id).toBe('github');
  });
});

describe('GoogleProvider', () => {
  it('should have correct provider ID', () => {
    const provider = new GoogleProvider();
    expect(provider.id).toBe('google');
  });

  it('should have correct name', () => {
    const provider = new GoogleProvider();
    expect(provider.name).toBe('Google');
  });

  it('should have correct default scopes', () => {
    const provider = new GoogleProvider();
    expect([...provider.defaultScopes]).toEqual(['openid', 'profile', 'email']);
  });

  it('should have correct endpoints', () => {
    const provider = new GoogleProvider();
    const endpoints = provider.getEndpoints();
    expect(endpoints.authorizationEndpoint).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(endpoints.tokenEndpoint).toBe('https://oauth2.googleapis.com/token');
  });

  it('should use Bearer token injection', () => {
    const provider = new GoogleProvider();
    const injection = provider.getTokenInjection();
    expect(injection.type).toBe('header');
    expect(injection.key).toBe('Authorization');
    expect(injection.format).toBe('Bearer {token}');
  });

  it('should pass HTTPS validation', () => {
    const provider = new GoogleProvider();
    expect(() => provider.validateConfig()).not.toThrow();
  });
});

describe('CognitoProvider', () => {
  const defaultConfig = {
    userPoolDomain: 'my-app',
    region: 'us-east-1',
  };

  it('should have correct provider ID', () => {
    const provider = new CognitoProvider(defaultConfig);
    expect(provider.id).toBe('cognito');
  });

  it('should have correct name', () => {
    const provider = new CognitoProvider(defaultConfig);
    expect(provider.name).toBe('AWS Cognito');
  });

  it('should have correct default scopes', () => {
    const provider = new CognitoProvider(defaultConfig);
    expect([...provider.defaultScopes]).toEqual(['openid', 'profile']);
  });

  it('should construct endpoints from domain and region', () => {
    const provider = new CognitoProvider(defaultConfig);
    const endpoints = provider.getEndpoints();
    expect(endpoints.authorizationEndpoint).toBe(
      'https://my-app.auth.us-east-1.amazoncognito.com/oauth2/authorize'
    );
    expect(endpoints.tokenEndpoint).toBe(
      'https://my-app.auth.us-east-1.amazoncognito.com/oauth2/token'
    );
  });

  it('should support different regions', () => {
    const provider = new CognitoProvider({
      userPoolDomain: 'my-app',
      region: 'eu-west-1',
    });
    const endpoints = provider.getEndpoints();
    expect(endpoints.authorizationEndpoint).toContain('eu-west-1');
  });

  it('should use Bearer token injection', () => {
    const provider = new CognitoProvider(defaultConfig);
    const injection = provider.getTokenInjection();
    expect(injection.type).toBe('header');
    expect(injection.key).toBe('Authorization');
    expect(injection.format).toBe('Bearer {token}');
  });

  it('should pass HTTPS validation', () => {
    const provider = new CognitoProvider(defaultConfig);
    expect(() => provider.validateConfig()).not.toThrow();
  });

  it('should accept client credentials in config', () => {
    const provider = new CognitoProvider({
      ...defaultConfig,
      clientId: 'my-client-id',
      clientSecret: 'my-client-secret',
    });
    expect(provider.id).toBe('cognito');
  });
});

describe('AzureProvider', () => {
  const defaultConfig = {
    tenantId: 'my-tenant-id',
  };

  it('should have correct provider ID', () => {
    const provider = new AzureProvider(defaultConfig);
    expect(provider.id).toBe('azure');
  });

  it('should have correct name', () => {
    const provider = new AzureProvider(defaultConfig);
    expect(provider.name).toBe('Azure AD');
  });

  it('should have correct default scopes', () => {
    const provider = new AzureProvider(defaultConfig);
    expect([...provider.defaultScopes]).toEqual(['openid', 'profile']);
  });

  it('should construct endpoints from tenant ID', () => {
    const provider = new AzureProvider(defaultConfig);
    const endpoints = provider.getEndpoints();
    expect(endpoints.authorizationEndpoint).toBe(
      'https://login.microsoftonline.com/my-tenant-id/oauth2/v2.0/authorize'
    );
    expect(endpoints.tokenEndpoint).toBe(
      'https://login.microsoftonline.com/my-tenant-id/oauth2/v2.0/token'
    );
  });

  it('should support multi-tenant with common', () => {
    const provider = new AzureProvider({ tenantId: 'common' });
    const endpoints = provider.getEndpoints();
    expect(endpoints.authorizationEndpoint).toContain('/common/');
  });

  it('should use Bearer token injection', () => {
    const provider = new AzureProvider(defaultConfig);
    const injection = provider.getTokenInjection();
    expect(injection.type).toBe('header');
    expect(injection.key).toBe('Authorization');
    expect(injection.format).toBe('Bearer {token}');
  });

  it('should pass HTTPS validation', () => {
    const provider = new AzureProvider(defaultConfig);
    expect(() => provider.validateConfig()).not.toThrow();
  });

  it('should accept client credentials in config', () => {
    const provider = new AzureProvider({
      ...defaultConfig,
      clientId: 'my-client-id',
      clientSecret: 'my-client-secret',
    });
    expect(provider.id).toBe('azure');
  });
});

describe('AnthropicProvider', () => {
  it('should have correct provider ID', () => {
    const provider = new AnthropicProvider();
    expect(provider.id).toBe('anthropic');
  });

  it('should have correct name', () => {
    const provider = new AnthropicProvider();
    expect(provider.name).toBe('Anthropic');
  });

  it('should have correct default scopes', () => {
    const provider = new AnthropicProvider();
    expect([...provider.defaultScopes]).toEqual(['api']);
  });

  it('should have correct endpoints', () => {
    const provider = new AnthropicProvider();
    const endpoints = provider.getEndpoints();
    expect(endpoints.authorizationEndpoint).toBe('https://auth.anthropic.com/authorize');
    expect(endpoints.tokenEndpoint).toBe('https://auth.anthropic.com/token');
  });

  it('should use x-api-key header injection', () => {
    const provider = new AnthropicProvider();
    const injection = provider.getTokenInjection();
    expect(injection.type).toBe('header');
    expect(injection.key).toBe('x-api-key');
    expect(injection.format).toBeUndefined();
  });

  it('should pass HTTPS validation', () => {
    const provider = new AnthropicProvider();
    expect(() => provider.validateConfig()).not.toThrow();
  });

  it('should accept client ID in constructor', () => {
    const provider = new AnthropicProvider('my-client-id');
    expect(provider.id).toBe('anthropic');
  });
});
