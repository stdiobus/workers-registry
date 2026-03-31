# Manual Signal Handling Test

This document describes how to manually test signal handling for the RpcDispatcher.

## Requirements Tested

- 1.4: SIGTERM handling for graceful shutdown
- 1.5: SIGINT handling for graceful shutdown  
- 1.6: Exit with code 0 when stdin closes
- 1.7: Exit with code 1 on uncaught exception
- 13.5: Log startup message to stderr
- 13.6: Log shutdown message to stderr

## Test 1: SIGTERM Graceful Shutdown

```bash
# Terminal 1: Start the worker
node dist/sftp-worker.js

# Terminal 2: Send SIGTERM
pkill -TERM -f sftp-worker.js

# Expected:
# - Worker logs "Received SIGTERM, shutting down gracefully..." to stderr
# - Worker exits with code 0
# - No error messages
```

## Test 2: SIGINT Graceful Shutdown

```bash
# Terminal 1: Start the worker
node dist/sftp-worker.js

# Press Ctrl+C

# Expected:
# - Worker logs "Received SIGINT, shutting down gracefully..." to stderr
# - Worker exits with code 0
# - No error messages
```

## Test 3: stdin Close

```bash
# Send empty input (closes stdin immediately)
echo "" | node dist/sftp-worker.js

# Expected:
# - Worker logs "Started, waiting for NDJSON messages on stdin..." to stderr
# - Worker logs "stdin closed, exiting gracefully" to stderr
# - Worker exits with code 0
```

## Test 4: Startup and Shutdown Messages

```bash
# Start worker and immediately close stdin
{ sleep 1; } | node dist/sftp-worker.js 2>&1 | grep -E "(Started|stdin closed|shutting down)"

# Expected output should contain:
# [timestamp] INFO: [sftp-worker] Started, waiting for NDJSON messages on stdin...
# [timestamp] INFO: stdin closed, exiting gracefully
```

## Test 5: stdout Purity (Only Protocol Messages)

```bash
# Send a request and capture stdout separately from stderr
echo '{"jsonrpc":"2.0","id":1,"method":"sftp/connect"}' | \
  node dist/sftp-worker.js 2>/dev/null | \
  jq .

# Expected:
# - stdout contains ONLY valid JSON-RPC response
# - No log messages in stdout
# - Response has jsonrpc, id, and error fields
```

## Test 6: Verify Logs Go to stderr

```bash
# Capture stderr separately
echo '{"jsonrpc":"2.0","id":1,"method":"sftp/connect"}' | \
  node dist/sftp-worker.js 2>&1 1>/dev/null | \
  grep "Started"

# Expected:
# - Startup message appears (it's in stderr)
# - Format: [ISO-8601-timestamp] INFO: [sftp-worker] Started, waiting for NDJSON messages on stdin...
```

## Automated Test

Run the integration test script:

```bash
./test-rpc-dispatcher.sh
```

All tests should pass with ✓ marks.
