# Universal Worker Launcher

TypeScript-based universal launcher for all workers in the stdio Bus Workers Registry.

## Overview

This launcher provides a single entry point to run any worker in the registry by name, simplifying deployment and usage.

## Features

- Type-safe worker configuration
- Automatic worker discovery and validation
- Clear error messages and usage information
- Compiled to JavaScript with full type definitions

## Usage

After building the project:

```bash
# Run any worker by name (package install)
./node_modules/.bin/stdiobus <worker-name>

# Or via npx (no local install)
npx -y -p @stdiobus/workers-registry stdiobus <worker-name>

# Direct Node invocation
node ./node_modules/@stdiobus/workers-registry/launch <worker-name>

# In this repo, after build
node ./launch/index.js <worker-name>

# Examples
./node_modules/.bin/stdiobus acp-worker
./node_modules/.bin/stdiobus echo-worker
./node_modules/.bin/stdiobus mcp-echo-server
```

## Available Workers

- `acp-worker` - Full ACP protocol implementation with MCP integration
- `acp-registry` - Registry Launcher for ACP Registry agents
- `echo-worker` - Simple echo worker for testing NDJSON protocol
- `mcp-echo-server` - MCP server example for testing
- `mcp-to-acp-proxy` - MCP-to-ACP protocol bridge

## Development

```bash
# Build the launcher
npm run build

# Clean build artifacts
npm run clean
```

## Architecture

The launcher:

1. Validates the worker name from command-line arguments
2. Maps the worker name to its compiled entry point
3. Dynamically imports and executes the worker module
4. Handles errors gracefully with helpful messages

All logging goes to stderr to keep stdout clean for NDJSON protocol communication.
