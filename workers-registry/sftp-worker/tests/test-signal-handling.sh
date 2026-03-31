#!/bin/bash
# Test signal handling for RpcDispatcher
# 
# Tests SIGTERM and SIGINT handling for graceful shutdown.

set -e

echo "=== Signal Handling Test ==="
echo

# Build the worker
echo "Building worker..."
npm run build > /dev/null 2>&1
echo "✓ Build successful"
echo

# Test 1: SIGTERM graceful shutdown
echo "Test 1: SIGTERM graceful shutdown"
{
  # Start worker in background
  node ../dist/sftp-worker.js > /tmp/sftp-worker-output.txt 2> /tmp/sftp-worker-stderr.txt &
  WORKER_PID=$!
  
  # Give it time to start
  sleep 0.5
  
  # Send SIGTERM
  kill -TERM $WORKER_PID
  
  # Wait for it to exit
  wait $WORKER_PID
  EXIT_CODE=$?
  
  # Check exit code is 0
  if [ $EXIT_CODE -eq 0 ]; then
    echo "✓ Worker exited with code 0 after SIGTERM"
  else
    echo "✗ Worker exited with code $EXIT_CODE (expected 0)"
  fi
  
  # Check for shutdown message in stderr
  if grep -q "shutting down gracefully" /tmp/sftp-worker-stderr.txt; then
    echo "✓ Graceful shutdown message logged"
  else
    echo "✗ No graceful shutdown message found"
  fi
}
echo

# Test 2: SIGINT graceful shutdown
echo "Test 2: SIGINT graceful shutdown"
{
  # Start worker in background
  node ../dist/sftp-worker.js > /tmp/sftp-worker-output2.txt 2> /tmp/sftp-worker-stderr2.txt &
  WORKER_PID=$!
  
  # Give it time to start
  sleep 0.5
  
  # Send SIGINT
  kill -INT $WORKER_PID
  
  # Wait for it to exit
  wait $WORKER_PID
  EXIT_CODE=$?
  
  # Check exit code is 0
  if [ $EXIT_CODE -eq 0 ]; then
    echo "✓ Worker exited with code 0 after SIGINT"
  else
    echo "✗ Worker exited with code $EXIT_CODE (expected 0)"
  fi
  
  # Check for shutdown message in stderr
  if grep -q "shutting down gracefully" /tmp/sftp-worker-stderr2.txt; then
    echo "✓ Graceful shutdown message logged"
  else
    echo "✗ No graceful shutdown message found"
  fi
}
echo

# Test 3: stdin close triggers exit with code 0
echo "Test 3: stdin close triggers exit with code 0"
{
  # Send empty input (closes stdin immediately)
  echo "" | node ../dist/sftp-worker.js > /tmp/sftp-worker-output3.txt 2> /tmp/sftp-worker-stderr3.txt
  EXIT_CODE=$?
  
  if [ $EXIT_CODE -eq 0 ]; then
    echo "✓ Worker exited with code 0 after stdin close"
  else
    echo "✗ Worker exited with code $EXIT_CODE (expected 0)"
  fi
  
  # Check for startup message
  if grep -q "Started, waiting for NDJSON messages" /tmp/sftp-worker-stderr3.txt; then
    echo "✓ Startup message logged"
  else
    echo "✗ No startup message found"
  fi
  
  # Check for stdin close message
  if grep -q "stdin closed" /tmp/sftp-worker-stderr3.txt; then
    echo "✓ stdin close message logged"
  else
    echo "✗ No stdin close message found"
  fi
}
echo

# Test 4: Verify stdout is only protocol messages (no logs)
echo "Test 4: Verify stdout purity (only protocol messages)"
{
  echo '{"jsonrpc":"2.0","id":1,"method":"sftp/connect"}' | \
    node ../dist/sftp-worker.js 2>/dev/null > /tmp/sftp-worker-stdout.txt
  
  # Check that stdout contains only JSON
  if jq empty /tmp/sftp-worker-stdout.txt 2>/dev/null; then
    echo "✓ stdout contains only valid JSON"
  else
    echo "✗ stdout contains non-JSON content"
  fi
  
  # Check that stdout contains JSON-RPC response
  if grep -q '"jsonrpc":"2.0"' /tmp/sftp-worker-stdout.txt; then
    echo "✓ stdout contains JSON-RPC response"
  else
    echo "✗ stdout does not contain JSON-RPC response"
  fi
}
echo

# Cleanup
rm -f /tmp/sftp-worker-*.txt

echo "=== All signal handling tests completed ==="
