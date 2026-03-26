# OAuth 2.1 Authentication

OAuth 2.1 authentication support for the Registry Launcher, enabling secure browser-based authentication with major AI providers.

## Quick Start

```bash
# Login with a provider (opens browser)
node ./launch/index.js acp-registry --login openai

# Check authentication status
node ./launch/index.js acp-registry --auth-status

# Interactive setup wizard
node ./launch/index.js acp-registry --setup

# Logout from all providers
node ./launch/index.js acp-registry --logout

# Logout from specific provider
node ./launch/index.js acp-registry --logout openai
```

## Supported Providers

| Provider | OAuth 2.1 | API Key | Default Scopes |
|----------|-----------|---------|----------------|
| OpenAI | ✅ | ✅ | `openid`, `profile` |
| Anthropic | ✅ | ✅ | `api` |
| GitHub | ✅ | ✅ | `read:user` |
| Google | ✅ | ✅ | `openid`, `profile`, `email` |
| Microsoft Entra ID | ✅ | ✅ | `openid`, `profile` |
| AWS Cognito | ✅ | ✅ | `openid`, `profile` |

## Documentation

- [User Guide](./user-guide.md) - How to use OAuth authentication
- [Configuration](./configuration.md) - Environment variables and settings
- [CLI Reference](./cli-reference.md) - Complete CLI command reference
- [Security](./security.md) - Security considerations and best practices
- [Technical Reference](./technical-reference.md) - Architecture and internals
- [Troubleshooting](./troubleshooting.md) - Common issues and solutions

## Features

- **OAuth 2.1 with PKCE** - Secure browser-based authentication
- **Multiple Providers** - Support for major AI providers
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
// api-keys.json (still supported)
{
  "claude-acp": {
    "apiKey": "sk-ant-...",
    "env": { "ANTHROPIC_API_KEY": "sk-ant-..." }
  }
}
```

## License

Apache License 2.0 - See [LICENSE](../../LICENSE) for details.

---

*Documentation last verified: March 2026*
*All 5 e2e tests passing, 2138+ unit tests passing*
