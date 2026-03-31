# SFTP Worker for stdio Bus

The SFTP Worker is a Node.js process managed by the stdio Bus daemon. It implements SFTP operations via JSON-RPC 2.0 over NDJSON and integrates into the workers-registry for secure access to remote SFTP servers.

## Architecture

```
VS Code Extension (client)
    ↓ unix socket / stdio (NDJSON framing)
stdio Bus daemon (C binary — boundary translation gateway)
    ↓ stdin/stdout (NDJSON, always)
SFTP Worker (Node.js) — workers-registry/sftp-worker/
    ↓ ssh2-sftp-client
Remote SFTP Server
```

## Key Features

- JSON-RPC 2.0 over NDJSON: one JSON message per line, `\n` delimiter
- Session affinity: `sessionId` binds a session to a specific worker instance
- Capability negotiation: feature handshake via `sftp/initialize`
- Chunked I/O: stream handle API for large files
- Atomic writes: `tempRename` strategy (write to temp file, then rename)
- Host key verification: `strict`, `tofu`, and `none` policies
- Strict state machine: `idle → connecting → active → closing → closed`

## Installation and Usage

### Build

```bash
cd workers-registry/sftp-worker
npm install
npm run build
```

### Run via stdio Bus daemon

```bash
./build/stdio_bus --config workers-registry/sftp-worker/sftp-worker-config.json --stdio
```

### Development (watch mode)

```bash
cd workers-registry/sftp-worker
npm run dev
```

### Testing

```bash
cd workers-registry/sftp-worker
npm test
```

## RPC Methods

All methods use JSON-RPC 2.0 format. Every request must include a `sessionId` field for session affinity routing.

### Request Format

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "sftp/methodName",
  "params": { ... },
  "sessionId": "sess-abc-123"
}
```

### Success Response Format

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": { ... },
  "sessionId": "sess-abc-123"
}
```

### Error Response Format

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32010,
    "message": "Path not found: /nonexistent",
    "data": {
      "source": "SftpBackend",
      "category": "PATH_NOT_FOUND",
      "path": "/nonexistent",
      "retryable": false
    }
  },
  "sessionId": "sess-abc-123"
}
```

---

### sftp/initialize

Negotiate protocol version and capabilities. Must be the first RPC call before any working operations.

**Parameters:**
- `protocolVersion` (string, required): Protocol version in "MAJOR.MINOR" format (e.g., "1.0")
- `clientName` (string, required): Client name (e.g., "sftp-bus-vscode")
- `clientVersion` (string, required): Client version (e.g., "0.1.0")
- `capabilities` (object, optional): Requested capabilities

**Result:**
- `protocolVersion` (string): Worker protocol version
- `workerVersion` (string): Worker version
- `capabilities` (object): Negotiated capabilities

**Example request:**

```json
{
  "jsonrpc": "2.0", "id": 0,
  "method": "sftp/initialize",
  "params": {
    "protocolVersion": "1.0",
    "clientName": "sftp-bus-vscode",
    "clientVersion": "0.1.0",
    "capabilities": {
      "chunkedIO": true, "atomicWrite": true,
      "hostKeyVerification": true, "cancelRequest": true
    }
  },
  "sessionId": "sess-abc-123"
}
```

**Example response:**

```json
{
  "jsonrpc": "2.0", "id": 0,
  "result": {
    "protocolVersion": "1.0",
    "workerVersion": "0.1.0",
    "capabilities": {
      "chunkedIO": true, "atomicWrite": true,
      "hostKeyVerification": true,
      "maxChunkBytes": 1048576, "maxInlineFileBytes": 1048576,
      "cancelRequest": true
    }
  },
  "sessionId": "sess-abc-123"
}
```

**Errors:** `-32030` (INCOMPATIBLE_PROTOCOL) — incompatible MAJOR version.

---

### sftp/connect

Establish an SFTP connection to a remote server.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `host` | string | yes | — | SFTP server hostname |
| `port` | number | no | 22 | SFTP server port |
| `username` | string | yes | — | Username |
| `authType` | string | yes | — | `"password"` or `"privateKey"` |
| `password` | string | if password auth | — | Password |
| `privateKey` | string | if key auth | — | Private SSH key (OpenSSH format) |
| `passphrase` | string | no | — | Passphrase for the private key |
| `timeout` | number | no | 30000 | Connection timeout (ms) |
| `hostKeyPolicy` | string | no | `"tofu"` | `"strict"`, `"tofu"`, or `"none"` |
| `knownHostKeys` | string[] | no | — | Known fingerprints for `strict` policy |

**Result:**
- `connected` (boolean): true on success
- `serverBanner` (string, optional): Server banner
- `hostKeyFingerprint` (string): SHA256 fingerprint of the server's host key

**Errors:**
- `-32001` AUTHENTICATION_FAILED
- `-32002` HOST_UNREACHABLE
- `-32003` CONNECTION_TIMEOUT
- `-32027` HOST_KEY_UNKNOWN (strict policy, key not in list)
- `-32028` HOST_KEY_MISMATCH (strict/tofu policy, key changed)

---

### sftp/disconnect

Close the SFTP connection for the current session.

**Parameters:** None (session determined by `sessionId`).

**Result:** `{ "disconnected": true }`

Idempotent — returns success even if the connection is already closed.

---

### sftp/readdir

List files and directories at the given path.

**Parameters:** `path` (string, required) — absolute remote path.

**Result:**
```json
{
  "entries": [
    { "name": "file.txt", "type": "file", "size": 1024, "mtime": 1700000000, "atime": 1700000000 },
    { "name": "docs", "type": "directory", "size": 4096, "mtime": 1700000100, "atime": 1700000100 }
  ]
}
```

Entry types: `"file"`, `"directory"`, `"symlink"`. Timestamps are Unix seconds.

**Errors:** `-32010` PATH_NOT_FOUND, `-32011` PERMISSION_DENIED.

---

### sftp/stat

Get metadata for a file or directory.

**Parameters:** `path` (string, required).

**Result:** `{ "type": "file"|"directory"|"symlink", "size": number, "mtime": number, "atime": number, "mode": number }`

**Errors:** `-32010`, `-32011`.

---

### sftp/readFile

Read file contents (inline mode, for files ≤ `maxInlineFileBytes`).

**Parameters:** `path` (string, required).

**Result:** `{ "data": "<base64>", "size": number, "encoding": "base64" }`

For files exceeding `maxInlineFileBytes`, use the chunked I/O API instead.

**Errors:** `-32010`, `-32011`, `-32023` IS_A_DIRECTORY.

---

### sftp/writeFile

Write file contents (inline mode).

**Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `path` | string | yes | — | Absolute remote path |
| `data` | string | yes | — | File content (base64-encoded) |
| `create` | boolean | no | true | Create file if it does not exist |
| `overwrite` | boolean | no | true | Overwrite if file exists |
| `writeStrategy` | string | no | `"tempRename"` | `"direct"` or `"tempRename"` |

**Result:** `{ "written": true, "size": number, "atomic": boolean }`

`atomic` is `true` when `tempRename` was used, `false` for `direct`.

**Errors:** `-32010`, `-32011`, `-32012` ALREADY_EXISTS, `-32013` DISK_FULL_OR_QUOTA, `-32023`.

---

### sftp/mkdir

Create a directory.

**Parameters:** `path` (string, required).

**Result:** `{ "created": true }`

**Errors:** `-32010`, `-32011`, `-32012`.

---

### sftp/delete

Delete a file or directory.

**Parameters:** `path` (string, required), `recursive` (boolean, optional, default: false).

**Result:** `{ "deleted": true }`

**Errors:** `-32010`, `-32011`, `-32024` DIRECTORY_NOT_EMPTY (when recursive=false on non-empty dir).

---

### sftp/rename

Rename or move a file/directory.

**Parameters:** `oldPath` (string, required), `newPath` (string, required).

**Result:** `{ "renamed": true }`

**Errors:** `-32010`, `-32011`, `-32012`.

---

## Chunked I/O API

For files exceeding `maxInlineFileBytes` (default 1 MB).

### Read

```
sftp/openRead(path)       → { handleId, fileSize }
sftp/readChunk(handleId, offset, length) → { data, offset, length, eof }
sftp/closeRead(handleId)  → { closed: true }
```

### Write

```
sftp/openWrite(path, create, overwrite) → { handleId }
sftp/writeChunk(handleId, offset, data) → { written }
sftp/commitWrite(handleId) → { committed, size, sha256 }
sftp/abortWrite(handleId)  → { aborted: true }
```

### Ordering

Chunks must be written in strictly sequential order by `offset`. The worker validates continuity and rejects out-of-order chunks with `-32031` (INVALID_CHUNK).

Handles expire after 60 seconds of inactivity → `-32032` (INVALID_OR_EXPIRED_HANDLE).

---

## Error Codes

### Standard JSON-RPC Codes

| Code | Meaning |
|---|---|
| -32700 | Parse error (invalid JSON) |
| -32600 | Invalid Request (valid JSON, invalid JSON-RPC) |
| -32601 | Method not found |
| -32602 | Invalid params (missing required fields) |

### Application Codes — Core

| Code | Constant | Description | Retryable |
|---|---|---|---|
| -32000 | NO_ACTIVE_CONNECTION | No active connection for session | No |
| -32001 | AUTHENTICATION_FAILED | Authentication failed | No |
| -32002 | HOST_UNREACHABLE | Host unreachable / DNS error | No |
| -32003 | CONNECTION_TIMEOUT | Connection timed out | Yes |
| -32010 | PATH_NOT_FOUND | Path does not exist | No |
| -32011 | PERMISSION_DENIED | Access denied | No |
| -32012 | ALREADY_EXISTS | File/directory already exists | No |
| -32013 | DISK_FULL_OR_QUOTA | Disk full or quota exceeded | No |
| -32020 | SFTP_OPERATION_FAILED | Generic SFTP error (fallback) | No |

### Application Codes — Extended

| Code | Constant | Description | Retryable |
|---|---|---|---|
| -32021 | OPERATION_CANCELLED | Cancelled by client | No |
| -32022 | NOT_A_DIRECTORY | Expected directory, got file | No |
| -32023 | IS_A_DIRECTORY | Expected file, got directory | No |
| -32024 | DIRECTORY_NOT_EMPTY | Non-empty directory | No |
| -32025 | RESOURCE_BUSY | Resource busy or locked | Yes |
| -32026 | INVALID_PATH | Invalid or non-normalizable path | No |
| -32027 | HOST_KEY_UNKNOWN | Host key not in trust store | No |
| -32028 | HOST_KEY_MISMATCH | Host key mismatch | No |
| -32029 | UNSUPPORTED_OPERATION | Operation not supported | No |
| -32030 | INCOMPATIBLE_PROTOCOL | Incompatible protocol version | No |
| -32031 | INVALID_CHUNK | Invalid chunk offset/size | No |
| -32032 | INVALID_OR_EXPIRED_HANDLE | Handle expired or invalid | No |
| -32033 | SESSION_CLOSING | Session is closing | No |
| -32034 | CONFLICTING_OPERATION | Concurrent mutation conflict | No |
| -32035 | DATA_INTEGRITY_ERROR | Data corruption detected | No |

### Structured Error Data

Every error response includes `data` with:
- `source` (string): Originating module
- `category` (string): Error constant name
- `path` (string, optional): Path that caused the error
- `retryable` (boolean): Whether the client should retry
- `reason` (string, optional): `"cancelled"`, `"session_closing"`, or `"connection_lost"`
- `presentedFingerprint` (string, optional): Server's host key fingerprint
- `expectedFingerprint` (string, optional): Expected fingerprint
- `fallbackAvailable` (boolean, optional): Whether a fallback strategy is available

---

## Session State Machine

Each SFTP session transitions through these states:

```
idle → connecting → active → closing → closed
```

| State | Allowed Methods | Transitions |
|---|---|---|
| `idle` | `sftp/initialize`, `sftp/connect` | → `connecting` on connect |
| `connecting` | `$/cancelRequest` | → `active` on success, → `closed` on error |
| `active` | All SFTP methods | → `closing` on disconnect, → `closed` on connection loss |
| `closing` | None (in-flight complete) | → `closed` when in-flight = 0 |
| `closed` | None | Session removed from map |

---

## Capability Negotiation

### Baseline Capabilities (no sftp/initialize)

```json
{
  "chunkedIO": false,
  "atomicWrite": false,
  "hostKeyVerification": true,
  "maxChunkBytes": 1048576,
  "maxInlineFileBytes": 1048576,
  "cancelRequest": false
}
```

### Negotiation Rules

- Boolean capabilities: AND (both sides must support)
- Numeric capabilities: MIN (lower value wins)
- Calling a method requiring an unsupported capability → `-32029`

---

## Concurrency and Cancellation

### Concurrency Queue

- Mutations (`writeFile`, `delete`, `rename`, `mkdir`) on the same path execute in FIFO order.
- Non-conflicting operations and reads execute in parallel.
- Maximum in-flight requests per session: `maxInFlightPerSession` (default 16).

### Cancellation

Send a `$/cancelRequest` notification to cancel an in-flight request:

```json
{"jsonrpc": "2.0", "method": "$/cancelRequest", "params": {"id": 42}, "sessionId": "..."}
```

The worker returns `-32021` with `data.reason` set to `"cancelled"`, `"session_closing"`, or `"connection_lost"`. Cancellation after completion is silently ignored.

---

## Resource Limits

| Limit | Default | Exceeded Behavior |
|---|---|---|
| `maxConcurrentSessions` | 10 | `-32020` on new connect |
| `maxInFlightPerSession` | 16 | `-32025` (retryable) |
| `maxOpenHandles` | 32 | `-32025` on new open |
| `handleTimeoutMs` | 60000 | `-32032` on expired handle |

Warnings are logged to stderr at 80% of each limit.

---

## Security

### Credentials

- Passwords, private keys, and passphrases are never logged to stderr.
- Only host, port, username, and auth type appear in logs.
- Credentials are cleared from memory on disconnect.

### Host Key Verification

| Policy | Behavior |
|---|---|
| `strict` | Verify against `knownHostKeys`. Reject on mismatch (`-32028`) or absence (`-32027`). |
| `tofu` | Accept on first connection, verify on subsequent connections. |
| `none` | No verification (dev/test only). |

Fingerprint format: `SHA256:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` (OpenSSH style).

### Path Validation

The `PathNormalizer` rejects null bytes and invalid UTF-8 (`-32026`), resolves `.`/`..` segments, collapses duplicate slashes, and ensures the result is an absolute POSIX path. Normalization is idempotent.

---

## Graceful Shutdown

### SIGTERM / SIGINT

1. Stop accepting new messages from stdin.
2. Complete all in-flight operations.
3. Close all SFTP connections via `SessionManager.destroyAll()`.
4. Free all resources (handles, timers).
5. Exit with code 0.

### stdin Close

Worker exits with code 0 when stdin is closed (daemon closed the pipe).

### Uncaught Exception

Worker logs the stack trace to stderr and exits with code 1.

---

## stdio Bus Integration

### Configuration

```json
{
  "pools": [{
    "id": "sftp-worker",
    "command": "/usr/bin/env",
    "args": ["node", "./workers-registry/sftp-worker/dist/sftp-worker.js"],
    "instances": 1
  }],
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

### Session Affinity

The daemon routes all messages with the same `sessionId` to the same worker instance, preserving the SFTP connection across requests.

---

## Project Structure

```
workers-registry/sftp-worker/
├── src/
│   ├── sftp-worker.ts           # Entry point
│   ├── rpc-dispatcher.ts        # JSON-RPC router
│   ├── session-manager.ts       # Session lifecycle
│   ├── sftp-backend.ts          # ISftpBackend implementation
│   ├── error-mapper.ts          # Error mapping pipeline
│   ├── path-normalizer.ts       # Path validation
│   ├── concurrency-queue.ts     # FIFO mutation queue
│   ├── handle-manager.ts        # Stream handle management
│   ├── capability-negotiator.ts # Capability handshake
│   ├── host-key-verifier.ts     # Host key verification
│   ├── atomic-writer.ts         # Atomic write strategies
│   ├── types.ts                 # Shared TypeScript types
│   ├── error-codes.ts           # Error code constants
│   └── __tests__/               # Unit and property tests
├── dist/                        # Compiled JavaScript
├── package.json
├── tsconfig.json
├── sftp-worker-config.json      # stdio Bus config
├── README.md                    # Documentation (Russian)
└── README.en.md                 # Documentation (English, this file)
```

## Related Documentation

- [VS Code Extension README](../../vscode-extension/README.md) — User-facing extension documentation
- [SFTP Bus Architecture](../../docs/sftp-bus-architecture.md) — System-level architecture and design
- [stdio Bus Overview](../../docs/overview.md) — The underlying transport daemon

## License

See the root LICENSE file.
