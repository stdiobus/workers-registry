# Frequently Asked Questions (FAQ)

## General Questions

### What is stdio Bus Workers Registry?

stdio Bus Workers Registry is a collection of worker implementations for [stdio Bus kernel](https://github.com/stdiobus/stdiobus). Workers are processes that handle various agent protocols (ACP, MCP) and communicate with stdio Bus via stdin/stdout using NDJSON protocol.

### What is stdio Bus kernel?

stdio Bus kernel is a high-performance message routing daemon that manages worker processes and routes messages between clients and workers. It's available at [https://github.com/stdiobus/stdiobus](https://github.com/stdiobus/stdiobus). For convenience, Docker images are also available on [Docker Hub](https://hub.docker.com/r/stdiobus/stdiobus).

### Why are workers in a separate repository?

Separating workers from the core daemon provides:
- Better separation of concerns
- Easier to contribute and extend
- Independent versioning
- Clearer documentation
- Simpler deployment

### What protocols are supported?

- **ACP (Agent Client Protocol)** - Full protocol support via ACP Worker
- **MCP (Model Context Protocol)** - Via MCP Echo Server and MCP-to-ACP Proxy
- **NDJSON JSON-RPC** - Base protocol for all workers

## Installation and Setup

### How do I get started?

1. Get stdio Bus kernel: [Build from source](https://github.com/stdiobus/stdiobus) or use [Docker image](https://hub.docker.com/r/stdiobus/stdiobus)
2. Clone this repository
3. Build workers: `npm install && cd workers-registry/acp-worker && npm install && npm run build`
4. Run: See [Quick Start](README.md#quick-start) for detailed instructions

### What are the system requirements?

- stdio Bus kernel (build from source or use Docker)
- Node.js 20.0.0 or later (for building workers)
- Linux, macOS, or Windows (WSL for binary, Docker for containers)
- 100MB+ free disk space
- 512MB+ RAM (depends on workers)

### Do I need to build stdio Bus kernel from source?

No! You can use the official Docker image from [Docker Hub](https://hub.docker.com/r/stdiobus/stdiobus) for quick start. Building from source is only needed if you want to modify the kernel itself or prefer running the binary directly.

## Workers

### What is a worker?

A worker is a process that:
- Reads NDJSON messages from stdin
- Processes messages according to a protocol (ACP, MCP, etc.)
- Writes NDJSON responses to stdout
- Logs to stderr

### Which worker should I use?

- **Echo Worker** - Testing and learning the protocol
- **ACP Worker** - Full ACP protocol support with MCP integration
- **Registry Launcher** - Connect to any agent in the ACP Registry
- **MCP-to-ACP Proxy** - Bridge MCP clients (like Kiro) to ACP agents
- **MCP Echo Server** - Testing MCP integration

### Can I create my own worker?

Yes! See [Creating Custom Workers](CONTRIBUTING.md#creating-new-workers) for guidelines. The Echo Worker is a good starting point.

### How many worker instances should I run?

- **Development**: 1 instance is usually enough
- **Production**: 2-8 instances depending on load
- **High-throughput**: 8+ instances with appropriate hardware

Use session affinity for stateful conversations.

## Configuration

### Where are configuration files?

- **stdio Bus config**: `config.json` (defines worker pools, mounted into Docker container)
- **Worker config**: Worker-specific configuration files
- **API keys**: `api-keys.json` (for Registry Launcher, mounted into Docker container)

### How do I configure multiple workers?

Create a configuration file with multiple pools:

```json
{
  "pools": [
    {
      "id": "echo-worker",
      "command": "node",
      "args": ["./workers-registry/echo-worker/echo-worker.js"],
      "instances": 2
    },
    {
      "id": "acp-worker",
      "command": "node",
      "args": ["./workers-registry/acp-worker/dist/index.js"],
      "instances": 1
    }
  ]
}
```

### How do I configure API keys for Registry Launcher?

Create `api-keys.json`:

```json
{
  "ANTHROPIC_API_KEY": "sk-ant-...",
  "OPENAI_API_KEY": "sk-...",
  "GITHUB_TOKEN": "ghp_..."
}
```

Reference it in `registry-launcher-worker-config.json`:

```json
{
  "apiKeysPath": "./api-keys.json"
}
```

## Protocol and Communication

### What is NDJSON?

NDJSON (Newline-Delimited JSON) is a format where each line is a complete JSON object:

```
{"jsonrpc":"2.0","id":"1","method":"test","params":{}}\n
{"jsonrpc":"2.0","id":"2","method":"echo","params":{}}\n
```

### What is session affinity?

Session affinity ensures that all messages with the same `sessionId` are routed to the same worker instance. This is essential for stateful conversations.

```json
{
  "jsonrpc": "2.0",
  "id": "1",
  "method": "test",
  "sessionId": "sess-123",
  "params": {}
}
```

### How do I send messages to stdio Bus?

Via TCP (when running in Docker), Unix socket, or stdio:

```bash
# TCP (Docker)
echo '{"jsonrpc":"2.0","id":"1","method":"echo","params":{}}' | nc localhost 9000

# Unix socket (requires volume mount)
echo '{"jsonrpc":"2.0","id":"1","method":"echo","params":{}}' | nc -U /tmp/stdio_bus.sock

# Stdio (interactive mode)
docker run -i \
  -v $(pwd)/config.json:/config.json:ro \
  -v $(pwd)/workers-registry:/workers-registry:ro \
  stdiobus/stdiobus:latest \
  --config /config.json --stdio
```

### What's the difference between a request and a notification?

- **Request**: Has `id` and `method`, requires a response
- **Notification**: Has `method` but no `id`, no response expected

## ACP and Registry Launcher

### What is the ACP Registry?

The [ACP Registry](https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json) is a centralized list of available ACP agents (Claude, Goose, Cline, etc.) with their metadata and launch commands.

### How do I use a specific agent from the registry?

Include `agentId` in your message:

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

### Which agents are available?

See the [ACP Registry](https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json) for the full list. Popular agents:
- `claude-acp` - Claude Agent
- `goose` - Goose
- `cline` - Cline
- `github-copilot` - GitHub Copilot

### How do I add a new agent to the registry?

The ACP Registry is maintained by the ACP team. Contact them to add new agents. For local testing, you can modify the registry URL in the configuration.

## MCP Integration

### Can I use MCP servers with stdio Bus?

Yes! The ACP Worker includes MCP Manager that connects to MCP servers for tool execution.

### How do I configure MCP servers?

Configure in the ACP Worker's MCP servers config:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      "env": {}
    }
  }
}
```

### Can I use Kiro IDE with stdio Bus?

Yes! Use the MCP-to-ACP Proxy to bridge Kiro (MCP client) to stdio Bus (ACP agents). See [MCP-to-ACP Proxy documentation](workers-registry/mcp-to-acp-proxy/README.md).

## Troubleshooting

### Worker not starting

Check:
- Node.js version (20.0.0+)
- Dependencies installed (`npm install`)
- Worker built (`npm run build`)
- Configuration paths are correct (mounted into Docker container)
- Worker files are accessible from Docker container
- Docker volumes are mounted correctly

### Connection refused

Check:
- stdio Bus Docker container is running (`docker ps`)
- Port mapping is correct (`-p 9000:9000`)
- Firewall allows connections
- No other process using the port
- Using `localhost` or `127.0.0.1` to connect

### Messages not being processed

Check:
- Message format is valid JSON
- Each message ends with newline
- `jsonrpc` field is "2.0"
- Worker logs for errors (stderr)

### Session not found

Check:
- Session was created first
- `sessionId` matches exactly (case-sensitive)
- Worker hasn't restarted (sessions are in-memory)

### Agent not found (Registry Launcher)

Check:
- Agent ID is correct (case-sensitive)
- Agent exists in the registry
- Registry URL is accessible
- Check cached registry in `/tmp/acp-registry-cache.json`

### API key errors

Check:
- API keys are configured in `api-keys.json`
- API key names match agent requirements
- API keys are valid and not expired
- File permissions allow reading `api-keys.json`

## Performance

### How many messages per second can stdio Bus handle?

- **Echo Worker**: ~50,000 messages/second
- **ACP Worker**: ~10,000 messages/second
- **Registry Launcher**: ~5,000 messages/second (depends on agent)

Actual throughput depends on hardware, message size, and worker complexity.

### How do I improve performance?

- Increase worker instances
- Use session affinity for stateful conversations
- Configure larger buffer sizes
- Use multiple stdio Bus instances (load balancing)
- Monitor and optimize worker code

### How much memory do workers use?

- **Echo Worker**: ~10MB per instance
- **ACP Worker**: ~50MB per instance
- **Registry Launcher**: ~100MB + ~50-200MB per agent

Monitor with `ps aux | grep worker` or `top`.

## Development

### How do I contribute?

See [Contributing Guidelines](CONTRIBUTING.md) for detailed instructions.

### How do I run tests?

```bash
# Run all tests
npm test

# Run specific test suites
npm run test:unit
npm run test:integration
npm run test:property

# Run tests for specific worker
cd workers-registry/acp-worker
npm test
```

### How do I debug workers?

```bash
# View Docker container logs
docker logs -f stdiobus-container-name

# Enable debug logging (via environment variable)
docker run -d \
  -e LOG_LEVEL=debug \
  -p 9000:9000 \
  -v $(pwd)/config.json:/config.json:ro \
  -v $(pwd)/workers-registry:/workers-registry:ro \
  stdiobus/stdiobus:latest

# Check worker logs (stderr) from container
docker exec stdiobus-container-name ps aux | grep worker
```

### Where can I get help?

- [GitHub Issues](https://github.com/stdiobus/workers-registry/issues) - Bug reports and feature requests
- [GitHub Discussions](https://github.com/stdiobus/workers-registry/discussions) - Questions and discussions
- [Documentation](README.md) - Project documentation
- [Examples](EXAMPLES.md) - Practical examples

## Security

### Is it safe to use stdio Bus in production?

stdio Bus is designed for production use, but:
- Protect API keys (file permissions, environment variables)
- Validate all input
- Use secure connections (TLS for TCP)
- Monitor for suspicious activity
- Keep dependencies updated

### How are API keys stored?

API keys are stored in configuration files and injected as environment variables. Use file permissions to protect configuration files:

```bash
chmod 600 api-keys.json
```

### Can workers access each other's data?

No. Each worker runs in a separate process with isolated memory. Workers cannot access each other's data.

## Deployment

### How do I deploy to production?

1. Build workers: `npm run build`
2. Configure production settings (instances, limits)
3. Set up monitoring and logging
4. Use process manager (systemd, PM2, Docker)
5. Configure firewall and security
6. Test thoroughly before deploying

### Can I use Docker?

Yes! Docker is the recommended way to run stdio Bus. See the [Docker Hub README](sandbox/DOCKER_HUB_README.md) for detailed instructions.

Quick example:

```bash
docker run -d \
  --name stdiobus \
  -p 8080:8080 \
  -v $(pwd)/config.json:/config.json:ro \
  -v $(pwd)/workers-registry:/workers-registry:ro \
  stdiobus/stdiobus:latest
```

### How do I monitor stdio Bus in production?

- Monitor Docker container health (`docker ps`, `docker stats`)
- Monitor worker process count inside container
- Monitor memory usage per worker
- Monitor message throughput
- Monitor error rates in logs (`docker logs`)
- Monitor session count
- Use logging and metrics tools (Prometheus, Grafana)

## License

### What license is stdio Bus Workers Registry under?

Apache License 2.0. See [LICENSE](LICENSE) file for details.

### Can I use it commercially?

Yes! The Apache License 2.0 allows commercial use.

### Do I need to contribute changes back?

No, but contributions are welcome! See [Contributing Guidelines](CONTRIBUTING.md).

## Additional Resources

- [Main README](README.md) - Project overview
- [stdio Bus kernel](https://github.com/stdiobus/stdiobus) - Core protocol and daemon
- [stdio Bus on Docker Hub](https://hub.docker.com/r/stdiobus/stdiobus) - Docker images (optional)
