# Registry Launcher

Routes messages to any agent in the [ACP Registry](https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json) through [stdio Bus kernel](https://github.com/stdiobus/stdiobus).

## Overview

The Registry Launcher is a stdio Bus worker that dynamically discovers and launches agents from the ACP Registry. It handles agent process management, API key injection, and session-based routing.

## Features

- **Automatic agent discovery** from ACP Registry
- **Dynamic process management** - agents are launched on-demand
- **API key injection** from configuration
- **Session affinity routing** - messages with same sessionId go to same agent
- **Graceful shutdown** - agents are terminated cleanly
- **Automatic restart** - failed agents are restarted automatically
- **Registry caching** - reduces network requests

## Architecture

```
Client
  ↓ (TCP/Unix socket)
stdio Bus kernel
  ↓ (NDJSON via stdin/stdout)
Registry Launcher
  ↓ (fetches registry)
ACP Registry (CDN)
  ↓ (launches agents)
Agent Processes (claude-acp, goose, cline, etc.)
```

## Installation

The Registry Launcher is part of the ACP Worker package:

```bash
cd workers-registry/acp-worker
npm install
npm run build
```

## Usage

### Configuration

Create a worker configuration file (`registry-launcher-worker-config.json`):

```json
{
  "registry": {
    "url": "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json",
    "cacheTTL": 3600
  },
  "apiKeys": {
    "ANTHROPIC_API_KEY": "sk-ant-...",
    "OPENAI_API_KEY": "sk-...",
    "GITHUB_TOKEN": "ghp_..."
  },
  "limits": {
    "maxAgents": 10,
    "maxSessionsPerAgent": 100,
    "agentStartupTimeout": 30000,
    "agentShutdownTimeout": 10000
  }
}
```

Create a stdio Bus configuration file (`registry-launcher-config.json`):

```json
{
  "pools": [{
    "id": "registry-launcher",
    "command": "node",
    "args": [
      "./workers-registry/acp-worker/dist/registry-launcher/index.js",
      "./registry-launcher-worker-config.json"
    ],
    "instances": 1
  }]
}
```

### Starting

```bash
# Start stdio Bus with Registry Launcher
./stdio_bus \
  --config workers-registry/acp-registry/registry-launcher-config.json \
  --tcp 127.0.0.1:9000
```

### Sending Messages

Messages must include an `agentId` parameter to specify which agent to use:

```bash
# Initialize with Claude agent
echo '{"jsonrpc":"2.0","id":"1","method":"initialize","params":{"agentId":"claude-acp","clientInfo":{"name":"test","version":"1.0"}}}' | \
  nc 127.0.0.1 9000

# Create session
echo '{"jsonrpc":"2.0","id":"2","method":"session/new","params":{"agentId":"claude-acp"}}' | \
  nc 127.0.0.1 9000

# Send prompt
echo '{"jsonrpc":"2.0","id":"3","method":"session/prompt","params":{"agentId":"claude-acp","sessionId":"sess-123","prompt":"Hello!"}}' | \
  nc 127.0.0.1 9000
```

## Available Agents

The Registry Launcher supports any agent in the [ACP Registry](https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json). Popular agents include:

| Agent ID | Description | Required API Keys |
|----------|-------------|-------------------|
| `claude-acp` | Claude Agent | `ANTHROPIC_API_KEY` |
| `goose` | Goose | `OPENAI_API_KEY` |
| `cline` | Cline | `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` |
| `github-copilot` | GitHub Copilot | `GITHUB_TOKEN` |
| `openai-agent` | OpenAI Agent | `OPENAI_API_KEY` |

See the registry for the complete list and latest versions.

## Configuration Reference

### Registry Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `url` | string | Required | URL to ACP Registry JSON |
| `cacheTTL` | number | 3600 | Cache TTL in seconds |

### API Keys Configuration

Map of environment variable names to API key values. These are injected into agent processes:

```json
{
  "apiKeys": {
    "ANTHROPIC_API_KEY": "sk-ant-...",
    "OPENAI_API_KEY": "sk-...",
    "CUSTOM_API_KEY": "..."
  }
}
```

### Limits Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `maxAgents` | number | 10 | Maximum concurrent agent processes |
| `maxSessionsPerAgent` | number | 100 | Maximum sessions per agent |
| `agentStartupTimeout` | number | 30000 | Agent startup timeout (ms) |
| `agentShutdownTimeout` | number | 10000 | Agent shutdown timeout (ms) |

## Message Routing

### Agent Selection

The Registry Launcher routes messages based on the `agentId` parameter:

```json
{
  "jsonrpc": "2.0",
  "id": "1",
  "method": "initialize",
  "params": {
    "agentId": "claude-acp",
    "clientInfo": {"name": "test"}
  }
}
```

### Session Affinity

Messages with the same `sessionId` are routed to the same agent instance:

```json
{
  "jsonrpc": "2.0",
  "id": "2",
  "method": "session/prompt",
  "params": {
    "agentId": "claude-acp",
    "sessionId": "sess-123",
    "prompt": "Hello!"
  }
}
```

### Agent Lifecycle

1. **On first message:** Agent process is launched
2. **On subsequent messages:** Messages are routed to existing process
3. **On idle timeout:** Agent process is terminated (configurable)
4. **On error:** Agent process is restarted automatically

## Process Management

### Agent Startup

1. Fetch agent metadata from registry
2. Resolve agent executable path
3. Inject API keys from configuration
4. Spawn agent process with stdio transport
5. Wait for agent to be ready (with timeout)

### Agent Shutdown

1. Send SIGTERM to agent process
2. Wait for graceful shutdown (with timeout)
3. Send SIGKILL if timeout exceeded
4. Clean up resources

### Error Handling

- **Agent not found:** Return error to client
- **Agent startup failure:** Return error and retry on next message
- **Agent crash:** Restart agent automatically
- **Registry fetch failure:** Use cached registry or return error

## Testing

### Manual Testing

```bash
# Start Registry Launcher
./stdio_bus \
  --config workers-registry/acp-registry/registry-launcher-config.json \
  --tcp 127.0.0.1:9000

# Test with Claude agent
echo '{"jsonrpc":"2.0","id":"1","method":"initialize","params":{"agentId":"claude-acp","clientInfo":{"name":"test"}}}' | \
  nc 127.0.0.1 9000

# Test with Goose agent
echo '{"jsonrpc":"2.0","id":"2","method":"initialize","params":{"agentId":"goose","clientInfo":{"name":"test"}}}' | \
  nc 127.0.0.1 9000
```

### Integration Testing

```bash
# Run integration tests
cd workers-registry/acp-worker
npm run test:integration
```

## Using with IDE

The Registry Launcher can be used with IDE through the MCP-to-ACP Proxy:

1. Start stdio Bus with Registry Launcher:
```bash
./stdio_bus \
  --config workers-registry/acp-registry/registry-launcher-config.json \
  --tcp 127.0.0.1:9000
```

2. Configure MCP-to-ACP Proxy in `.ai/settings/mcp.json`:
```json
{
  "mcpServers": {
    "stdio-bus-acp": {
      "command": "node",
      "args": ["./workers-registry/mcp-to-acp-proxy/proxy.js"],
      "env": {
        "ACP_HOST": "127.0.0.1",
        "ACP_PORT": "9000",
        "AGENT_ID": "claude-acp"
      }
    }
  }
}
```

3. Restart MCP server in IDE (Command Palette → "MCP: Reconnect Server")

See [MCP-to-ACP Proxy documentation](../mcp-to-acp-proxy/README.md) for details.

## Troubleshooting

### "Agent not found" error

Check that:
- Agent ID is correct (case-sensitive)
- Agent exists in the registry
- Registry URL is accessible

### "Agent startup timeout" error

Check that:
- Agent executable is available
- Required API keys are configured
- Agent supports stdio transport
- Increase `agentStartupTimeout` if needed

### "Too many agents" error

Check that:
- `maxAgents` limit is not exceeded
- Old agents are being terminated properly
- Increase `maxAgents` if needed

### API key errors

Check that:
- API keys are configured in `apiKeys` section
- API key names match agent requirements
- API keys are valid and not expired

### Registry fetch errors

Check that:
- Registry URL is accessible
- Network connection is working
- Registry JSON is valid
- Check cached registry in `/tmp/acp-registry-cache.json`

## Performance

### Benchmarks

- Agent startup time: ~1-3 seconds (depends on agent)
- Message routing: <1ms
- Registry fetch: ~100-500ms (cached after first fetch)
- Memory per agent: ~50-200MB (depends on agent)

### Optimization Tips

- Use registry caching to reduce network requests
- Configure appropriate `maxAgents` limit
- Use session affinity for stateful conversations
- Monitor agent memory usage
- Terminate idle agents to free resources

## Security

### API Key Management

- API keys are stored in configuration file (not in code)
- API keys are injected as environment variables
- API keys are not logged or exposed in responses
- Use file permissions to protect configuration file

### Agent Isolation

- Each agent runs in a separate process
- Agents cannot access each other's memory
- Agents are terminated on shutdown
- Failed agents are restarted with clean state

## Development

### Project Structure

```
src/registry-launcher/
├── index.ts              # Main entry point
├── config/               # Configuration management
│   ├── config.ts
│   ├── api-keys.ts
│   └── types.ts
├── registry/             # Registry fetching and parsing
│   ├── index.ts
│   ├── resolver.ts
│   └── types.ts
├── runtime/              # Agent process management
│   ├── manager.ts
│   ├── agent-runtime.ts
│   └── types.ts
├── router/               # Message routing
│   └── message-router.ts
└── stream/               # NDJSON handling
    └── ndjson-handler.ts
```

### Building

```bash
cd workers-registry/acp-worker
npm run build
```

### Testing

```bash
# Run all tests
npm test

# Run specific tests
npm run test:unit -- registry-launcher
npm run test:integration -- registry-launcher
npm run test:property -- registry-launcher
```

## License

Apache License 2.0

Copyright (c) 2025–present Raman Marozau, Target Insight Function.

## Resources

- [stdio Bus kernel](https://github.com/stdiobus/stdiobus) - Core protocol and daemon
- [ACP Registry](https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json) - Available agents
- [ACP SDK](https://www.npmjs.com/package/@agentclientprotocol/sdk) - Official ACP SDK
- [MCP-to-ACP Proxy](../mcp-to-acp-proxy/README.md) - Protocol bridge for IDE
