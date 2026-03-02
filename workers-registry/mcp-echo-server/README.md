# MCP Echo Server

TypeScript MCP (Model Context Protocol) server example for testing MCP integration with [stdio Bus kernel](https://github.com/stdiobus/kernel).

## Overview

The MCP Echo Server is a simple MCP server that provides various tools for testing MCP protocol functionality. It demonstrates how to implement an MCP server and integrate it with stdio Bus through the ACP Worker.

## Features

- Complete MCP protocol implementation using `@modelcontextprotocol/sdk`
- Multiple test tools with different behaviors
- Error handling and cancellation support
- Stdio transport for integration with stdio Bus
- TypeScript implementation with type safety

## Tools

| Tool | Description | Parameters |
|------|-------------|------------|
| `echo` | Echoes input text back | `text: string` |
| `reverse` | Reverses input text | `text: string` |
| `uppercase` | Converts text to uppercase | `text: string` |
| `delay` | Echoes after a delay (for testing cancellation) | `text: string, delay: number` |
| `error` | Always returns an error (for testing error handling) | `message: string` |

## Installation

```bash
cd workers-registry/mcp-echo-server
npm install
npm run build
```

## Usage

### Standalone Mode

Run the server directly:

```bash
node dist/mcp-echo-server.js
```

The server will listen on stdin/stdout for MCP protocol messages.

### With ACP Worker

The MCP Echo Server can be integrated with the ACP Worker through MCP server configuration:

1. Configure in ACP Worker's MCP servers config:
```json
{
  "mcpServers": {
    "echo": {
      "command": "node",
      "args": ["./workers-registry/mcp-echo-server/dist/mcp-echo-server.js"],
      "env": {}
    }
  }
}
```

2. Start stdio Bus with ACP Worker:
```bash
./stdio_bus --config acp-worker-config.json --tcp 127.0.0.1:9000
```

3. The ACP Worker will automatically connect to the MCP Echo Server and expose its tools.

## Testing

### Manual Testing

```bash
# Start the server
node dist/mcp-echo-server.js

# Send initialize request
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}' | \
  node dist/mcp-echo-server.js

# List tools
echo '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | \
  node dist/mcp-echo-server.js

# Call echo tool
echo '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"echo","arguments":{"text":"Hello, World!"}}}' | \
  node dist/mcp-echo-server.js
```

### Integration Testing

Test with ACP Worker:

```bash
# Start stdio Bus with ACP Worker
./stdio_bus --config acp-worker-config.json --tcp 127.0.0.1:9000

# Initialize ACP session
echo '{"jsonrpc":"2.0","id":"1","method":"initialize","params":{"clientInfo":{"name":"test"}}}' | \
  nc 127.0.0.1 9000

# Create session
echo '{"jsonrpc":"2.0","id":"2","method":"session/new","params":{}}' | \
  nc 127.0.0.1 9000

# Send prompt that uses echo tool
echo '{"jsonrpc":"2.0","id":"3","method":"session/prompt","params":{"sessionId":"sess-123","prompt":"Use the echo tool to say hello"}}' | \
  nc 127.0.0.1 9000
```

## Tool Examples

### Echo Tool

Echoes the input text back:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "echo",
    "arguments": {
      "text": "Hello, World!"
    }
  }
}
```

Response:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Echo: Hello, World!"
      }
    ]
  }
}
```

### Reverse Tool

Reverses the input text:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "reverse",
    "arguments": {
      "text": "Hello"
    }
  }
}
```

Response:
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "olleH"
      }
    ]
  }
}
```

### Uppercase Tool

Converts text to uppercase:

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "uppercase",
    "arguments": {
      "text": "hello world"
    }
  }
}
```

Response:
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "HELLO WORLD"
      }
    ]
  }
}
```

### Delay Tool

Echoes after a delay (useful for testing cancellation):

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "tools/call",
  "params": {
    "name": "delay",
    "arguments": {
      "text": "Delayed message",
      "delay": 5000
    }
  }
}
```

Response (after 5 seconds):
```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Delayed echo: Delayed message"
      }
    ]
  }
}
```

### Error Tool

Always returns an error (useful for testing error handling):

```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "method": "tools/call",
  "params": {
    "name": "error",
    "arguments": {
      "message": "Test error"
    }
  }
}
```

Response:
```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "error": {
    "code": -32000,
    "message": "Test error"
  }
}
```

## Configuration

### MCP Server Configuration

When using with ACP Worker, configure in the MCP servers config file:

```json
{
  "mcpServers": {
    "echo": {
      "command": "node",
      "args": ["./workers-registry/mcp-echo-server/dist/mcp-echo-server.js"],
      "env": {
        "LOG_LEVEL": "debug"
      }
    }
  }
}
```

### Environment Variables

- `LOG_LEVEL` - Logging level (error/warn/info/debug)
- `NODE_ENV` - Environment mode (development/production)

## Development

### Project Structure

```
mcp-echo-server/
├── mcp-echo-server.ts    # Main server implementation
├── package.json          # Dependencies and scripts
├── tsconfig.json         # TypeScript configuration
└── dist/                 # Compiled JavaScript (after build)
```

### Building

```bash
# Build TypeScript
npm run build

# Watch for changes
npm run dev
```

### Adding New Tools

To add a new tool:

1. Define the tool in the `tools/list` handler:
```typescript
{
  name: "my_tool",
  description: "My custom tool",
  inputSchema: {
    type: "object",
    properties: {
      param: { type: "string" }
    },
    required: ["param"]
  }
}
```

2. Implement the tool in the `tools/call` handler:
```typescript
case "my_tool":
  return {
    content: [{
      type: "text",
      text: `Result: ${args.param}`
    }]
  };
```

## Protocol Support

### Supported Methods

| Method | Description | Status |
|--------|-------------|--------|
| `initialize` | Initialize MCP connection | ✅ Implemented |
| `tools/list` | List available tools | ✅ Implemented |
| `tools/call` | Call a tool | ✅ Implemented |
| `resources/list` | List resources | ❌ Not implemented |
| `prompts/list` | List prompts | ❌ Not implemented |

### Capabilities

The server supports the following capabilities:

- `tools` - Tool execution support
- `experimental` - Experimental features

## Troubleshooting

### Server not starting

Check that:
- Node.js 18.0.0 or later is installed
- Dependencies are installed (`npm install`)
- Server is built (`npm run build`)

### Tools not working

Check that:
- Tool name is correct (case-sensitive)
- Required parameters are provided
- Parameter types match the schema

### Integration issues with ACP Worker

Check that:
- MCP server command is correct in config
- MCP server is executable
- ACP Worker is configured to use the MCP server
- Check ACP Worker logs for errors

## Performance

- Tool execution: <1ms (except delay tool)
- Memory usage: ~20MB
- Startup time: ~100ms

## Use Cases

- Testing MCP protocol implementation
- Debugging MCP integration
- Development and testing of MCP clients
- Learning MCP protocol
- Benchmarking MCP performance

## License

Apache License 2.0

Copyright (c) 2025–present Raman Marozau, Work Target Insight Function.

## Resources

- [stdio Bus kernel](https://github.com/stdiobus/kernel) - Core protocol and daemon
- [MCP SDK](https://www.npmjs.com/package/@modelcontextprotocol/sdk) - Official MCP SDK
- [MCP Specification](https://spec.modelcontextprotocol.io/) - MCP protocol specification
- [ACP Worker](../acp-worker/README.md) - ACP Worker documentation
