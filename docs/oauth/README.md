# OAuth 2.1 Authentication

OAuth 2.1 authentication support for the Registry Launcher, enabling secure browser-based authentication with identity providers and API key management for model providers.

## Quick Start

```bash
# Login with a provider (opens browser)
node ./launch/index.js acp-registry --login github

# Check authentication status
node ./launch/index.js acp-registry --auth-status

# Interactive setup wizard
node ./launch/index.js acp-registry --setup

# Logout from all providers
node ./launch/index.js acp-registry --logout

# Logout from specific provider
node ./launch/index.js acp-registry --logout github
```

## Supported Providers

### OAuth Identity Providers (User Identity)

| Provider | OAuth 2.1 | Default Scopes |
|----------|-----------|----------------|
| GitHub | ✓ | `read:user` |
| Google | ✓ | `openid`, `profile`, `email` |
| Microsoft Entra ID | ✓ | `openid`, `profile` |
| AWS Cognito | ✓ | `openid`, `profile` |
| Generic OIDC | ✓ | `openid`, `profile` |

### Model API Keys (Model Access)

| Provider | API Key | Header |
|----------|---------|--------|
| OpenAI | ✓ | `Authorization: Bearer {key}` |
| Anthropic | ✓ | `x-api-key: {key}` |

> **Note:** OpenAI and Anthropic do NOT offer public OAuth IdP for third-party login. They use API keys only. Use `--setup` to configure API keys.

## Documentation

- [User Guide](./user-guide.md) - How to use OAuth authentication
- [Configuration](./configuration.md) - Environment variables and settings
- [CLI Reference](./cli-reference.md) - Complete CLI command reference
- [Security](./security.md) - Security considerations and best practices
- [Technical Reference](./technical-reference.md) - Architecture and internals
- [Troubleshooting](./troubleshooting.md) - Common issues and solutions

## Features

- **OAuth 2.1 with PKCE** - Secure browser-based authentication
- **Multiple Identity Providers** - GitHub, Google, Microsoft Entra ID, AWS Cognito, Generic OIDC
- **Model API Keys** - Separate management for OpenAI and Anthropic API keys
- **Secure Token Storage** - OS keychain or encrypted file storage
- **Automatic Token Refresh** - Proactive refresh before expiration
- **Backward Compatible** - Existing `api-keys.json` continues to work
- **Headless Detection** - Clear error messages in CI/SSH environments

## How It Works

1. **Browser OAuth Flow**: Run `--login <provider>` to open browser for authentication
2. **Token Storage**: Tokens are securely stored in OS keychain or encrypted file
3. **Automatic Injection**: Registry Launcher automatically injects tokens into agent requests
4. **Token Refresh**: Tokens are refreshed automatically before expiration

## Backward Compatibility

Existing `api-keys.json` configuration continues to work. OAuth credentials take precedence when available, with automatic fallback to API keys.

```json
{
  "agents": {
    "claude-acp": {
      "apiKey": "sk-ant-...",
      "env": { "ANTHROPIC_API_KEY": "sk-ant-..." }
    }
  },
  "version": "1.0.0"
}
```

## License

Apache License 2.0 - See [LICENSE](../../LICENSE) for details.
