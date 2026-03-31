#!/bin/bash
# Integration test for RpcDispatcher
# 
# Tests the RpcDispatcher by sending NDJSON messages to stdin
# and verifying responses on stdout.

set -e

echo "=== RpcDispatcher Integration Test ==="
echo

# Build the worker
echo "Building worker..."
npm run build > /dev/null 2>&1
echo "✓ Build successful"
echo

# Test 1: Valid JSON-RPC request
echo "Test 1: Valid JSON-RPC request"
echo '{"jsonrpc":"2.0","id":1,"method":"sftp/connect","params":{"host":"example.com"}}' | \
  node ../dist/sftp-worker.js 2>/dev/null | \
  grep -q '"jsonrpc":"2.0"' && echo "✓ Valid request handled" || echo "✗ Failed"
echo

# Test 2: Invalid JSON (Parse error)
echo "Test 2: Invalid JSON (Parse error -32700)"
echo '{"jsonrpc":"2.0","id":2,invalid}' | \
  node ../dist/sftp-worker.js 2>/dev/null | \
  grep -q '"code":-32700' && echo "✓ Parse error returned" || echo "✗ Failed"
echo

# Test 3: Missing jsonrpc field (Invalid Request)
echo "Test 3: Missing jsonrpc field (Invalid Request -32600)"
echo '{"id":3,"method":"test"}' | \
  node ../dist/sftp-worker.js 2>/dev/null | \
  grep -q '"code":-32600' && echo "✓ Invalid request error returned" || echo "✗ Failed"
echo

# Test 4: Unknown method (Method not found)
echo "Test 4: Unknown method (Method not found -32601)"
echo '{"jsonrpc":"2.0","id":4,"method":"unknown/method"}' | \
  node ../dist/sftp-worker.js 2>/dev/null | \
  grep -q '"code":-32601' && echo "✓ Method not found error returned" || echo "✗ Failed"
echo

# Test 5: Notification (no response)
echo "Test 5: Notification (no id field - should produce no response)"
RESPONSE=$(echo '{"jsonrpc":"2.0","method":"sftp/connect"}' | timeout 1 node ../dist/sftp-worker.js 2>/dev/null || true)
if [ -z "$RESPONSE" ]; then
  echo "✓ No response for notification"
else
  echo "✗ Failed - got response: $RESPONSE"
fi
echo

# Test 6: sessionId preservation
echo "Test 6: sessionId preservation"
echo '{"jsonrpc":"2.0","id":5,"method":"sftp/connect","sessionId":"sess-123"}' | \
  node ../dist/sftp-worker.js 2>/dev/null | \
  grep -q '"sessionId":"sess-123"' && echo "✓ sessionId preserved" || echo "✗ Failed"
echo

# Test 7: Multiple requests
echo "Test 7: Multiple requests in sequence"
{
  echo '{"jsonrpc":"2.0","id":6,"method":"sftp/connect"}'
  echo '{"jsonrpc":"2.0","id":7,"method":"sftp/readdir"}'
} | node ../dist/sftp-worker.js 2>/dev/null | \
  grep -c '"jsonrpc":"2.0"' | \
  grep -q '2' && echo "✓ Multiple requests handled" || echo "✗ Failed"
echo

# Test 8: Empty lines ignored
echo "Test 8: Empty lines ignored"
{
  echo ''
  echo '{"jsonrpc":"2.0","id":8,"method":"sftp/connect"}'
  echo '   '
} | node ../dist/sftp-worker.js 2>/dev/null | \
  grep -c '"jsonrpc":"2.0"' | \
  grep -q '1' && echo "✓ Empty lines ignored" || echo "✗ Failed"
echo

echo "=== All tests completed ==="
