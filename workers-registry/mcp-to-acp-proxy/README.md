# MCP-to-ACP Protocol Proxy

Converts MCP protocol (from Kiro) to ACP protocol (for stdio Bus – https://github.com/stdiobus/stdiobus).

## Purpose

This proxy allows MCP clients (like Kiro IDE) to communicate with ACP agents through stdio Bus kernel.

## Architecture

```
Kiro (MCP Client) → MCP-to-ACP Proxy → stdio Bus → Registry Launcher → ACP Agent
```

## Configuration

### Environment Variables

- `ACP_HOST`: stdio Bus host (default: `127.0.0.1`)
- `ACP_PORT`: stdio Bus port (default: `9000`)
- `AGENT_ID`: ACP Registry agent ID (required)

### Available Agent IDs

See the [ACP Registry](https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json) for available agents:

- `claude-acp` - Claude Agent
- `goose` - Goose
- `cline` - Cline
- `github-copilot` - GitHub Copilot
- And many more...

## Usage with Kiro

1. Start stdio Bus with Registry Launcher:
```bash
./releases/stdio_bus \
  --config workers-registry/acp-registry/registry-launcher-config.json \
  --tcp 127.0.0.1:9000
```

2. Configure in `.kiro/settings/mcp.json`:
```json
{
  "mcpServers": {
    "stdio-bus-acp": {
      "command": "node",
      "args": ["./examples/mcp-to-acp-proxy/proxy.js"],
      "env": {
        "ACP_HOST": "127.0.0.1",
        "ACP_PORT": "9000",
        "AGENT_ID": "claude-acp"
      },
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

3. Restart MCP server in Kiro (Command Palette → "MCP: Reconnect Server")

## Protocol Mapping

### MCP → ACP

| MCP Method | ACP Method | Notes |
|------------|------------|-------|
| `initialize` | `initialize` | Protocol version converted |
| `tools/list` | `session/new` | Creates session first |
| `tools/call` | `session/prompt` | Converts tool call to prompt |

### Response Conversion

- ACP responses are converted back to MCP format
- Session IDs are managed automatically
- Errors are propagated with proper error codes

## Limitations

- Tools are not directly mapped (ACP uses prompts instead)
- Resources are not supported
- Sampling is not supported
- This is a basic proxy for demonstration purposes

## Testing

Test the proxy directly:
```bash
# Start stdio Bus
./releases/stdio_bus \
  --config workers-registry/acp-registry/registry-launcher-config.json \
  --tcp 127.0.0.1:9000

# In another terminal, test the proxy
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}' | \
  ACP_HOST=127.0.0.1 ACP_PORT=9000 AGENT_ID=claude-acp node examples/mcp-to-acp-proxy/proxy.js
```

## Troubleshooting

### "No session available" error
- The proxy creates a session automatically on first `tools/list` or `tools/call`
- If you see this error, the session creation failed

### Connection refused
- Ensure stdio Bus is running on the specified host:port
- Check that Registry Launcher worker is running: `ps aux | grep registry-launcher`

### "Invalid params" error
- Check that the AGENT_ID exists in the ACP Registry
- Verify the agent ID spelling matches exactly

### Protocol version mismatch
- The proxy converts MCP version to ACP version automatically
- If you see version errors, check the ACP agent's supported version
