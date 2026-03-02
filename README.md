# stdio Bus Workers Registry

This repository contains worker implementations and examples for [stdio Bus kernel](https://github.com/stdiobus/kernel) - a high-performance message routing daemon for agent protocols.

## Overview

stdio Bus kernel provides the core protocol and message routing infrastructure. This repository contains the worker implementations that run as child processes of stdio Bus kernel, handling various agent protocols and use cases.

## Architecture

```
stdio Bus kernel (binary) ← https://github.com/stdiobus/kernel
    ↓ (spawns workers via stdin/stdout NDJSON)
Workers Registry (this repo)
    ├── ACP Worker (Agent Client Protocol)
    ├── Registry Launcher (ACP Registry integration)
    ├── MCP-to-ACP Proxy (protocol bridge)
    └── Echo Worker (testing/examples)
```

## Workers

| Worker | Description | Protocol |
|--------|-------------|----------|
| `acp-worker` | Full ACP protocol implementation using official SDK | ACP |
| `registry-launcher` | Routes messages to any agent in the ACP Registry | ACP |
| `mcp-to-acp-proxy` | Bridges MCP clients (like Kiro) to ACP agents | MCP → ACP |
| `echo-worker` | Simple echo worker for testing NDJSON protocol | NDJSON |
| `mcp-echo-server` | MCP server example for testing | MCP |

## Prerequisites

- [stdio Bus kernel](https://github.com/stdiobus/kernel) binary (download from releases)
- Node.js 20.0.0 or later


## Quick Start

### 1. Get stdio Bus kernel

Download the latest release from [stdio Bus kernel releases](https://github.com/stdiobus/kernel/releases):

```bash
# Example for Linux/macOS
wget https://github.com/stdiobus/kernel/releases/latest/download/stdio_bus
chmod +x stdio_bus
```

### 2. Build Workers

```bash
# Install dependencies
npm install

# Build ACP worker
cd workers-registry/acp-worker
npm install
npm run build
cd ../..
```

### 3. Run Echo Worker Example

```bash
# Terminal 1: Start stdio Bus with echo worker
./stdio_bus --config workers-registry/echo-worker/echo-worker-config.json --tcp 127.0.0.1:9000

# Terminal 2: Test with a simple message
echo '{"jsonrpc":"2.0","id":"1","method":"echo","params":{"hello":"world"}}' | nc 127.0.0.1 9000
```

---

## Worker Documentation

### ACP Worker

Full implementation of the Agent Client Protocol using the official `@agentclientprotocol/sdk`.

**Location:** `workers-registry/acp-worker/`

**Features:**
- Complete ACP protocol support (initialize, session management, prompts)
- MCP server integration for tool execution
- Session-based routing
- Graceful shutdown handling

**Build:**
```bash
cd workers-registry/acp-worker
npm install
npm run build
```

**Run with stdio Bus:**
```bash
./stdio_bus --config workers-registry/acp-worker/acp-worker-config.json --tcp 127.0.0.1:9000
```

**Configuration:** See `workers-registry/acp-worker/src/` for implementation details.

---

### Registry Launcher

Routes messages to any agent in the [ACP Registry](https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json).

**Location:** `workers-registry/acp-worker/src/registry-launcher/`

**Features:**
- Automatic agent discovery from ACP Registry
- Dynamic agent process management
- API key injection from configuration
- Session affinity routing

**Available Agents:**
- `claude-acp` - Claude Agent
- `goose` - Goose
- `cline` - Cline
- `github-copilot` - GitHub Copilot
- And many more from the registry

**Configuration:**
```json
{
  "pools": [{
    "id": "registry-launcher",
    "command": "node",
    "args": ["./workers-registry/acp-worker/dist/registry-launcher/index.js", "./config.json"],
    "instances": 1
  }]
}
```

**Run:**
```bash
./stdio_bus --config workers-registry/acp-registry/registry-launcher-config.json --tcp 127.0.0.1:9000
```

---

### MCP-to-ACP Proxy

Bridges MCP clients (like Kiro IDE) to ACP agents through stdio Bus.

**Location:** `workers-registry/mcp-to-acp-proxy/`

**Architecture:**
```
Kiro (MCP Client) → MCP-to-ACP Proxy → stdio Bus → Registry Launcher → ACP Agent
```

**Configuration for Kiro:**
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

**Documentation:** See [workers-registry/mcp-to-acp-proxy/README.md](workers-registry/mcp-to-acp-proxy/README.md)

---

### Echo Worker

Simple reference implementation demonstrating the NDJSON worker protocol.

**Location:** `workers-registry/echo-worker/`

**Purpose:**
- Testing stdio Bus kernel functionality
- Reference implementation for custom workers
- Protocol documentation through code

**Run standalone:**
```bash
echo '{"jsonrpc":"2.0","id":"1","method":"test","params":{"foo":"bar"}}' | node workers-registry/echo-worker/echo-worker.js
```

**Run with stdio Bus:**
```bash
./stdio_bus --config workers-registry/echo-worker/echo-worker-config.json --tcp 127.0.0.1:9000
```

---

### MCP Echo Server

TypeScript MCP server example for testing MCP integration.

**Location:** `workers-registry/mcp-echo-server/`

**Tools provided:**
- `echo` - Echoes input text
- `reverse` - Reverses input text
- `uppercase` - Converts to uppercase
- `delay` - Echoes after a delay (for testing cancellation)
- `error` - Always returns an error (for testing error handling)

**Build:**
```bash
cd workers-registry/mcp-echo-server
npm install
npm run build
```

**Run:**
```bash
node workers-registry/mcp-echo-server/dist/mcp-echo-server.js
```

---

## stdio Bus Configuration

stdio Bus kernel is configured via JSON files. This repository includes example configurations for each worker.

### Configuration File Structure

```json
{
  "pools": [
    {
      "id": "worker-id",
      "command": "/path/to/executable",
      "args": ["arg1", "arg2"],
      "instances": 1
    }
  ],
  "limits": {
    "max_input_buffer": 1048576,
    "max_output_queue": 4194304,
    "max_restarts": 5,
    "restart_window_sec": 60,
    "drain_timeout_sec": 30,
    "backpressure_timeout_sec": 60
  }
}
```

### Pool Configuration

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique identifier for this worker pool |
| `command` | string | Yes | Path to the executable |
| `args` | string[] | No | Command-line arguments |
| `instances` | number | Yes | Number of worker instances (≥ 1) |

### Limits Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `max_input_buffer` | number | 1048576 (1 MB) | Maximum input buffer size per connection |
| `max_output_queue` | number | 4194304 (4 MB) | Maximum output queue size per connection |
| `max_restarts` | number | 5 | Maximum worker restarts within restart window |
| `restart_window_sec` | number | 60 | Time window for counting restarts |
| `drain_timeout_sec` | number | 30 | Timeout for graceful shutdown |
| `backpressure_timeout_sec` | number | 60 | Timeout before closing connection when queue is full |

### Example Configurations

**Minimal Configuration:**
```json
{
  "pools": [{
    "id": "echo-worker",
    "command": "node",
    "args": ["./workers-registry/echo-worker/echo-worker.js"],
    "instances": 1
  }]
}
```

**High-Throughput Configuration:**
```json
{
  "pools": [{
    "id": "acp-worker",
    "command": "node",
    "args": ["./workers-registry/acp-worker/dist/index.js"],
    "instances": 4
  }],
  "limits": {
    "max_input_buffer": 4194304,
    "max_output_queue": 16777216,
    "backpressure_timeout_sec": 120
  }
}
```

**Multiple Worker Pools:**
```json
{
  "pools": [
    {
      "id": "acp-worker",
      "command": "node",
      "args": ["./workers-registry/acp-worker/dist/index.js"],
      "instances": 2
    },
    {
      "id": "echo-worker",
      "command": "node",
      "args": ["./workers-registry/echo-worker/echo-worker.js"],
      "instances": 1
    }
  ]
}
```

---

## NDJSON Protocol

Workers communicate with stdio Bus kernel via stdin/stdout using NDJSON (Newline-Delimited JSON).

### Protocol Rules

1. **Input (stdin):** stdio Bus sends JSON-RPC messages, one per line
2. **Output (stdout):** Workers write JSON-RPC responses, one per line
3. **Errors (stderr):** All logging and debug output goes to stderr
4. **Never write non-JSON to stdout** - it will break the protocol

### Message Types

**Request** (requires response):
```json
{"jsonrpc":"2.0","id":"1","method":"test","params":{"foo":"bar"}}
```

**Response:**
```json
{"jsonrpc":"2.0","id":"1","result":{"status":"ok"}}
```

**Notification** (no response):
```json
{"jsonrpc":"2.0","method":"notify","params":{"event":"started"}}
```

### Session Affinity

Messages with the same `sessionId` are routed to the same worker instance:

```json
{"jsonrpc":"2.0","id":"1","method":"test","sessionId":"sess-123","params":{}}
```

Workers must preserve `sessionId` in responses for proper routing.

### Graceful Shutdown

Workers must handle SIGTERM for graceful shutdown:
1. Stop accepting new messages
2. Complete in-flight processing
3. Exit with code 0

stdio Bus sends SIGTERM during shutdown or worker restarts.

---

## Testing

### Unit Tests

```bash
# Run all tests
npm test

# Run specific test suites
npm run test:unit
npm run test:integration
npm run test:property
```

### Manual Testing

**Test echo worker:**
```bash
# Start stdio Bus
./stdio_bus --config workers-registry/echo-worker/echo-worker-config.json --tcp 127.0.0.1:9000

# Send test message
echo '{"jsonrpc":"2.0","id":"1","method":"echo","params":{"test":true}}' | nc 127.0.0.1 9000
```

**Test ACP worker:**
```bash
# Start stdio Bus with ACP worker
./stdio_bus --config workers-registry/acp-worker/acp-worker-config.json --tcp 127.0.0.1:9000

# Send initialize request
echo '{"jsonrpc":"2.0","id":"1","method":"initialize","params":{"clientInfo":{"name":"test","version":"1.0"}}}' | nc 127.0.0.1 9000
```

**Test Registry Launcher:**
```bash
# Start stdio Bus with Registry Launcher
./stdio_bus --config workers-registry/acp-registry/registry-launcher-config.json --tcp 127.0.0.1:9000

# Send message with agentId
echo '{"jsonrpc":"2.0","id":"1","method":"initialize","params":{"agentId":"claude-acp","clientInfo":{"name":"test"}}}' | nc 127.0.0.1 9000
```

---

## Development

### Creating a Custom Worker

1. Workers must read NDJSON from stdin and write NDJSON to stdout
2. All logging goes to stderr
3. Handle SIGTERM for graceful shutdown
4. Preserve `sessionId` in responses when present in requests

**Minimal worker template (Node.js):**

```javascript
#!/usr/bin/env node
import readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on('line', (line) => {
  try {
    const msg = JSON.parse(line);
    
    if (msg.id !== undefined) {
      // Request - send response
      const response = {
        jsonrpc: '2.0',
        id: msg.id,
        result: { /* your result */ }
      };
      
      if (msg.sessionId) {
        response.sessionId = msg.sessionId;
      }
      
      console.log(JSON.stringify(response));
    }
  } catch (err) {
    console.error('Parse error:', err.message);
  }
});

process.on('SIGTERM', () => {
  console.error('Shutting down...');
  rl.close();
});

rl.on('close', () => process.exit(0));
```

### Project Structure

```
workers-registry/
├── acp-worker/              # Full ACP protocol implementation
│   ├── src/
│   │   ├── agent.ts         # ACP Agent implementation
│   │   ├── index.ts         # Main entry point
│   │   ├── mcp/             # MCP server integration
│   │   ├── session/         # Session management
│   │   └── registry-launcher/  # Registry Launcher implementation
│   └── tests/               # Test suites
├── acp-registry/            # Registry Launcher configs
├── echo-worker/             # Simple echo worker example
├── mcp-echo-server/         # MCP server example
└── mcp-to-acp-proxy/        # MCP-to-ACP protocol bridge
```

---

## Resources

- [stdio Bus kernel](https://github.com/stdiobus/kernel) - Core protocol and daemon
- [ACP Registry](https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json) - Available ACP agents
- [Agent Client Protocol SDK](https://www.npmjs.com/package/@agentclientprotocol/sdk) - Official ACP SDK
- [Model Context Protocol SDK](https://www.npmjs.com/package/@modelcontextprotocol/sdk) - Official MCP SDK

## Documentation

- [Architecture](ARCHITECTURE.md) - System architecture and design
- [Examples](EXAMPLES.md) - Practical usage examples
- [FAQ](FAQ.md) - Frequently asked questions
- [Migration Guide](MIGRATION.md) - Migrating from old repository structure
- [Contributing](CONTRIBUTING.md) - Contribution guidelines
- [Changelog](CHANGELOG.md) - Version history and changes

## Worker Documentation

- [ACP Worker](workers-registry/acp-worker/README.md) - Full ACP protocol implementation
- [Registry Launcher](workers-registry/acp-registry/README.md) - ACP Registry integration
- [Echo Worker](workers-registry/echo-worker/README.md) - Reference implementation
- [MCP Echo Server](workers-registry/mcp-echo-server/README.md) - MCP server example
- [MCP-to-ACP Proxy](workers-registry/mcp-to-acp-proxy/README.md) - Protocol bridge

---

## License

Apache License 2.0

Copyright (c) 2025–present Raman Marozau, Work Target Insight Function.

See [LICENSE](LICENSE) file for details.

---

## Contributing

Contributions are welcome! Please ensure:
- All tests pass (`npm test`)
- Code follows existing style
- Documentation is updated
- Workers handle SIGTERM gracefully
- No output to stdout except NDJSON protocol messages
