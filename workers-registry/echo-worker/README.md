# Echo Worker

Simple reference implementation demonstrating the NDJSON worker protocol for [stdio Bus kernel](https://github.com/stdiobus/stdiobus).

## Overview

The Echo Worker is a minimal worker that echoes back any JSON-RPC request it receives. It serves as both a functional test worker and documentation of the NDJSON communication protocol.

## Purpose

- Testing stdio Bus kernel functionality
- Reference implementation for custom workers
- Protocol documentation through code
- Development and debugging tool

## NDJSON Protocol

Workers communicate with stdio Bus kernel via stdin/stdout using NDJSON (Newline-Delimited JSON).

### Protocol Rules

1. **Input (stdin):** stdio Bus sends JSON-RPC messages, one per line
2. **Output (stdout):** Workers write JSON-RPC responses, one per line
3. **Errors (stderr):** All logging and debug output goes to stderr
4. **Never write non-JSON to stdout** - it will break the protocol

### Message Types

**Request** (has both `id` and `method`):
```json
{"jsonrpc":"2.0","id":"1","method":"test","params":{"foo":"bar"}}
```

**Response** (has `id` and `result` or `error`):
```json
{"jsonrpc":"2.0","id":"1","result":{"echo":{"foo":"bar"},"method":"test","timestamp":"2025-01-01T00:00:00.000Z"}}
```

**Notification** (has `method` but no `id`):
```json
{"jsonrpc":"2.0","method":"notify","params":{"event":"started"}}
```

### Session Affinity

Messages with the same `sessionId` are routed to the same worker instance:

```json
{"jsonrpc":"2.0","id":"1","method":"test","sessionId":"sess-123","params":{}}
```

Workers must preserve `sessionId` in responses for proper routing.

## Usage

### Standalone Mode

Test the worker directly without stdio Bus:

```bash
# Send a single request
echo '{"jsonrpc":"2.0","id":"1","method":"test","params":{"foo":"bar"}}' | \
  node workers-registry/echo-worker/echo-worker.js

# Expected output:
# {"jsonrpc":"2.0","id":"1","result":{"echo":{"foo":"bar"},"method":"test","timestamp":"..."}}
```

### With stdio Bus kernel

**TCP mode (recommended for testing):**

```bash
# Terminal 1: Start stdio Bus
./stdio_bus --config workers-registry/echo-worker/echo-worker-config.json --tcp 127.0.0.1:9000

# Terminal 2: Send test requests
echo '{"jsonrpc":"2.0","id":"1","method":"echo","params":{"hello":"world"}}' | nc 127.0.0.1 9000
```

**Unix socket mode:**

```bash
# Terminal 1: Start stdio Bus
./stdio_bus --config workers-registry/echo-worker/echo-worker-config.json --unix /tmp/stdio_bus.sock

# Terminal 2: Send test requests
echo '{"jsonrpc":"2.0","id":"1","method":"echo","params":{"hello":"world"}}' | nc -U /tmp/stdio_bus.sock
```

**Stdio mode:**

```bash
# Start stdio Bus in stdio mode
./stdio_bus --config workers-registry/echo-worker/echo-worker-config.json --stdio

# Then send messages via stdin (one JSON per line)
{"jsonrpc":"2.0","id":"1","method":"echo","params":{"hello":"world"}}
```

## Configuration

Example configuration file (`echo-worker-config.json`):

```json
{
  "pools": [{
    "id": "echo-worker",
    "command": "node",
    "args": ["./workers-registry/echo-worker/echo-worker.js"],
    "instances": 2
  }]
}
```

### Configuration Options

- `instances`: Number of worker processes (for load balancing)
- `command`: Path to Node.js executable
- `args`: Path to the worker script

## Implementation Details

### Request Handling

For requests (messages with both `id` and `method`):
1. Parse the incoming JSON message
2. Generate a response with the same `id`
3. Include `result` object with echoed data
4. Preserve `sessionId` if present
5. Write response to stdout as NDJSON

### Notification Handling

For notifications (messages with `method` but no `id`):
1. Do NOT send a response (per JSON-RPC 2.0 spec)
2. Optionally send a notification back if `sessionId` is present

### Error Handling

For malformed JSON:
1. Log error to stderr (never stdout)
2. Continue processing subsequent messages
3. Do NOT crash the worker

### Graceful Shutdown

The worker handles SIGTERM for graceful shutdown:
1. Set `shuttingDown` flag to stop processing new messages
2. Close the readline interface
3. Exit with code 0

stdio Bus sends SIGTERM during shutdown or worker restarts.

## Testing

### Manual Testing

```bash
# Test echo functionality
echo '{"jsonrpc":"2.0","id":"1","method":"echo","params":{"test":true}}' | \
  node workers-registry/echo-worker/echo-worker.js

# Test session affinity
echo '{"jsonrpc":"2.0","id":"1","method":"test","sessionId":"sess-1","params":{}}' | \
  node workers-registry/echo-worker/echo-worker.js

# Test notification
echo '{"jsonrpc":"2.0","method":"notify","sessionId":"sess-1","params":{}}' | \
  node workers-registry/echo-worker/echo-worker.js
```

### With stdio Bus

```bash
# Start stdio Bus
./stdio_bus --config workers-registry/echo-worker/echo-worker-config.json --tcp 127.0.0.1:9000

# Test multiple requests
for i in {1..10}; do
  echo "{\"jsonrpc\":\"2.0\",\"id\":\"$i\",\"method\":\"test\",\"params\":{}}" | nc 127.0.0.1 9000
done

# Test session affinity (same session goes to same worker)
echo '{"jsonrpc":"2.0","id":"1","method":"test","sessionId":"sess-123","params":{}}' | nc 127.0.0.1 9000
echo '{"jsonrpc":"2.0","id":"2","method":"test","sessionId":"sess-123","params":{}}' | nc 127.0.0.1 9000
```

## Creating Custom Workers

Use the echo worker as a template for creating custom workers:

1. **Read NDJSON from stdin:**
   ```javascript
   const rl = readline.createInterface({
     input: process.stdin,
     output: process.stdout,
     terminal: false
   });
   ```

2. **Process messages:**
   ```javascript
   rl.on('line', (line) => {
     const msg = JSON.parse(line);
     // Process message
   });
   ```

3. **Write NDJSON to stdout:**
   ```javascript
   console.log(JSON.stringify(response));
   ```

4. **Log to stderr:**
   ```javascript
   console.error('[worker] Log message');
   ```

5. **Handle SIGTERM:**
   ```javascript
   process.on('SIGTERM', () => {
     rl.close();
   });
   ```

## Best Practices

1. **Never write non-JSON to stdout** - it will break the protocol
2. **Always log to stderr** - stdout is for protocol messages only
3. **Preserve sessionId** - required for session-based routing
4. **Handle SIGTERM** - for graceful shutdown
5. **Handle parse errors** - don't crash on malformed input
6. **Use readline** - for efficient line-based input processing
7. **Exit cleanly** - exit with code 0 on normal shutdown

## Troubleshooting

### Worker not responding

Check that:
- Worker is writing to stdout (not stderr)
- Output is valid JSON
- Each message ends with a newline
- No extra output is written to stdout

### Session affinity not working

Check that:
- `sessionId` is preserved in responses
- `sessionId` matches exactly (case-sensitive)
- stdio Bus is configured with multiple instances

### Worker crashing

Check that:
- Parse errors are caught and logged to stderr
- Uncaught exceptions are handled
- SIGTERM handler is registered

## Performance

- Message throughput: ~50,000 messages/second (single instance)
- Latency: <1ms per message
- Memory usage: ~10MB per instance

## License

Apache License 2.0

Copyright (c) 2025–present Raman Marozau, Target Insight Function.

## Resources

- [stdio Bus kernel](https://github.com/stdiobus/stdiobus) - Core protocol and daemon
- [JSON-RPC 2.0 Specification](https://www.jsonrpc.org/specification) - JSON-RPC protocol
- [NDJSON Specification](http://ndjson.org/) - Newline-Delimited JSON format
