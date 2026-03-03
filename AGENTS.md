# AGENTS.md

## 0. Agent scope & identity

You are an AI coding agent working inside this repository only.

Your primary goals:
- Implement features and fixes as requested.
- Preserve existing architecture and public contracts.
- Maintain reliability, security, and performance.

You must:
- Prefer small, reviewable changes.
- Explain non-trivial decisions in comments or commit messages (if available).
- Ask for clarification when a change would break explicit constraints below.

## 1. Project overview

**Purpose of this repo:**
- Provides worker implementations for stdio Bus kernel, a high-performance message routing daemon for agent protocols.
- Workers run as child processes of stdio Bus kernel and communicate via NDJSON over stdin/stdout.
- Enables integration between clients and various agent protocols (ACP, MCP) through a unified message routing infrastructure.

**Core domains / bounded contexts:**
- **ACP Worker**: Full Agent Client Protocol implementation with session management and MCP server integration.
- **Registry Launcher**: Dynamic agent discovery and routing to agents in the ACP Registry (Claude, Goose, Cline, etc.).
- **MCP Integration**: MCP server management and MCP-to-ACP protocol bridging.
- **Protocol Layer**: NDJSON/JSON-RPC 2.0 message handling, session affinity, and worker lifecycle management.
- **Testing**: Unit, integration, and property-based testing for protocol correctness.

**Critical invariants:**
- Workers must never write non-JSON output to stdout (breaks NDJSON protocol).
- All logging and debug output must go to stderr only.
- Workers must preserve `sessionId` in responses when present in requests (required for session affinity).
- Workers must handle SIGTERM gracefully and exit with code 0.
- Workers must not crash on invalid input; handle parse errors and respond with JSON-RPC error messages.
- API keys and secrets must never be hardcoded or logged.
- Public API contracts (JSON-RPC method signatures, ACP/MCP protocol compliance) must not change without explicit instruction.

## 2. Environment & assumptions

**Runtime:**
- Node.js: 20.0.0 or later (required)
- TypeScript: 5.0+ with strict mode enabled

**Package manager:**
- npm (use npm consistently; do not mix with yarn or pnpm)

**Local services:**
- stdio Bus kernel (external daemon, not part of this repo) - available via Docker or binary
- No database or queue services required
- Workers are stateless except for in-memory session management

**Internet access:**
- Workers may need internet access to:
  - Fetch ACP Registry from `https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json`
  - Connect to external agent processes
  - Use MCP servers that require network access
- Do not assume internet access for tests; use mocks and fixtures.

## 3. Setup & commands

Always use these commands when working with the project:

**Install dependencies:**
```bash
# Root level
npm install

# ACP Worker
cd workers-registry/acp-worker
npm install
cd ../..

# MCP Echo Server
cd workers-registry/mcp-echo-server
npm install
cd ../..
```

**Run dev server:**
- No dev server; workers are spawned by stdio Bus kernel.
- For standalone testing, run workers directly: `node workers-registry/echo-worker/echo-worker.js`

**Run unit tests:**
```bash
# All tests (root level)
npm test

# Unit tests only
npm run test:unit

# ACP Worker tests
cd workers-registry/acp-worker
npm test
```

**Run integration/e2e tests:**
```bash
npm run test:integration
```

**Run property-based tests:**
```bash
npm run test:property
```

**Lint / format:**
- No explicit lint command configured; follow TypeScript compiler errors and existing code style.

**Build:**
```bash
# ACP Worker (TypeScript compilation)
cd workers-registry/acp-worker
npm run build

# MCP Echo Server
cd workers-registry/mcp-echo-server
npm run build
```

**Database / migrations:**
- Not applicable; no database in this project.

**Rule:** Before you propose final changes, run all relevant tests and build commands from this section. At minimum, run `npm test` at root level and verify the build succeeds for any TypeScript workers you modified.

## 4. Repository & architecture map

**High-level structure:**
```
workers-registry/          # All worker implementations
├── acp-worker/           # Main ACP protocol worker (TypeScript)
├── acp-registry/         # Registry Launcher configurations
├── echo-worker/          # Simple reference worker (JavaScript)
├── mcp-echo-server/      # MCP server example (TypeScript)
└── mcp-to-acp-proxy/     # MCP-to-ACP protocol bridge (JavaScript)

docs/                     # Project documentation
sandbox/                  # Additional documentation and examples
.kiro/                    # Kiro IDE configuration and steering rules
```

**Key entrypoints:**

**ACP Worker:**
- `workers-registry/acp-worker/src/index.ts` - Main entry point, reads NDJSON from stdin
- `workers-registry/acp-worker/src/agent.ts` - ACP Agent implementation
- `workers-registry/acp-worker/src/registry-launcher/index.ts` - Registry Launcher entry point

**Echo Worker:**
- `workers-registry/echo-worker/echo-worker.js` - Simple reference implementation

**MCP Echo Server:**
- `workers-registry/mcp-echo-server/index.ts` - MCP server example

**MCP-to-ACP Proxy:**
- `workers-registry/mcp-to-acp-proxy/proxy.js` - Protocol bridge entry point

**Configuration:**
- `*-config.json` files define stdio Bus kernel worker pool configurations
- `api-keys.json` (root level, not committed) - API keys for Registry Launcher

## 5. Coding conventions

**Language:**
- TypeScript strict mode: `true` (do not weaken typings).
- All strict flags enabled: `noImplicitAny`, `strictNullChecks`, `strictFunctionTypes`, `strictBindCallApply`, `strictPropertyInitialization`, `noImplicitThis`, `alwaysStrict`, `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, `noFallthroughCasesInSwitch`.
- Use ES modules (`import`/`export`); `type: "module"` in package.json.

**Style:**
- Quotes: single quotes for strings.
- Semicolons: use semicolons.
- Indentation: 2 spaces.
- Max line length: 100 characters (soft limit).
- Import order: external packages first, then internal modules, then types.
- Prefer pure functions where possible; side effects in adapters/handlers.
- Use `const` and `let`; avoid `var`.
- Use arrow functions for callbacks.
- Use template literals for string interpolation.
- Add trailing commas in multi-line objects/arrays.

**Naming conventions:**
- Files: kebab-case (`my-module.ts`)
- Classes: PascalCase (`MyClass`)
- Functions: camelCase (`myFunction`)
- Constants: UPPER_SNAKE_CASE (`MY_CONSTANT`)
- Interfaces: PascalCase with `I` prefix (`IMyInterface`)

**Error handling:**
- Use JSON-RPC 2.0 error responses for protocol errors.
- Use custom error types for domain errors (e.g., `RegistryError`, `SessionError`).
- Never throw raw strings; use `Error` objects with descriptive messages.
- Handle parse errors gracefully; do not crash workers on invalid input.

**Logging:**
- All logging goes to stderr using `console.error()`.
- Never log to stdout (breaks NDJSON protocol).
- Do not log secrets, API keys, or PII.
- Use structured logging where possible (JSON format for machine parsing).

**Comments:**
- Use JSDoc for public APIs.
- Add inline comments for complex logic.
- Keep comments up-to-date with code changes.

## 6. Testing strategy

When you change code:

**Always add or update tests covering:**
- Happy path (successful protocol flows).
- Relevant edge cases (empty params, missing fields, invalid types).
- Regressions you are fixing (add test that would have caught the bug).

**Test locations:**
- Unit tests: `src/**/*.test.ts` (co-located with implementation)
- Property-based tests: `src/**/*.property.test.ts` or `src/**/*.property.ts`
- Integration tests: `tests/integration/` (if present)

**Commands:**
- Unit tests: `npm run test:unit` (root) or `npm test` (worker level)
- Integration tests: `npm run test:integration`
- Property-based tests: `npm run test:property`
- All tests: `npm test`

**Testing patterns:**
- Use Jest with ts-jest preset.
- Use fast-check for property-based testing (protocol invariants, edge cases).
- Mock external dependencies (stdio Bus kernel, MCP servers, ACP Registry).
- Test NDJSON protocol compliance (valid JSON, newline-delimited, sessionId preservation).
- Test graceful shutdown (SIGTERM handling).

**If tests fail, fix them or revert the change. Do not silence or delete failing tests without reason.**

## 7. Workflow rules

**Branching:**
- Use branches like `feature/add-new-worker`, `fix/session-leak`, `refactor/registry-cache`.

**Commits:**
- Keep commits small and focused.
- Use conventional commit messages:
  - `feat: add new MCP proxy feature`
  - `fix: preserve sessionId in error responses`
  - `test: add property tests for NDJSON handler`
  - `refactor: extract registry resolver logic`
  - `docs: update worker configuration examples`
  - `chore: update dependencies`

**Pull requests:**
- Title format: `[scope] short description` (e.g., `[acp-worker] Add session timeout handling`)
- PR must include:
  - Summary of changes (what and why).
  - Risks and mitigations (breaking changes, performance impact).
  - How to test (commands + steps to verify).
  - Test coverage (new tests added or updated).

## 8. Safety, secrets & destructive operations

**Never hardcode secrets, tokens or passwords.**

**Do not read or modify:**
- `.env*` files (not used in this project, but forbidden if added).
- `api-keys.json` (read-only for workers; never commit or log).
- Secret stores or credentials in CI configs.

**Destructive operations (data loss, dropping tables, truncating logs, deleting resources) are forbidden unless:**
- The user explicitly asks for such operations and confirms understanding of the risk.

**Do not add code that:**
- Sends production data to external services not already configured.
- Weakens authentication or authorization checks.
- Logs API keys, tokens, or PII.
- Writes non-JSON output to stdout (breaks NDJSON protocol).

**If you are unsure whether a change might be destructive, ask before proceeding.**

## 9. Tooling & integrations (MCP / CLI / external)

**Internal CLI:**
- No internal CLI in this project.

**MCP / skills:**
- Workers integrate with MCP servers via `@modelcontextprotocol/sdk`.
- MCP servers are configured in worker-specific config files (e.g., `acp-worker-config.json`).
- Use MCP Manager (`workers-registry/acp-worker/src/mcp/manager.ts`) for MCP server lifecycle management.

**Cloud / platform tools:**
- Docker: Recommended deployment method via stdio Bus kernel container.
- No CDK, SST, or Terraform in this project.

**External dependencies:**
- `@agentclientprotocol/sdk`: Official ACP protocol SDK (do not modify).
- `@modelcontextprotocol/sdk`: Official MCP protocol SDK (do not modify).
- stdio Bus kernel: External daemon (not part of this repo).

**Do not introduce new tools or services without a clear justification and minimal footprint.**

## 10. Constraints / do-not-touch areas

**Do not change, unless a task explicitly requires it:**

**Public API contracts:**
- JSON-RPC 2.0 method signatures (method names, params structure, result structure).
- ACP protocol compliance (initialize, session management, prompt handling).
- MCP protocol compliance (tool execution, resource access).
- NDJSON protocol (stdin/stdout communication, newline-delimited JSON).

**Worker protocol requirements:**
- Workers must read NDJSON from stdin and write NDJSON to stdout.
- Workers must log to stderr only.
- Workers must preserve `sessionId` in responses.
- Workers must handle SIGTERM gracefully.

**Configuration file schemas:**
- stdio Bus kernel config structure (`pools`, `limits` fields).
- Worker-specific config structures (breaking changes require coordination with users).

**Generated or vendor files:**
- Do not manually edit:
  - `dist/` directories (generated by TypeScript compiler).
  - `node_modules/` (managed by npm).
  - `package-lock.json` (only update via `npm install`).
  - `yarn.lock` (not used; delete if found).

**Shared libraries with many dependants:**
- `workers-registry/acp-worker/src/session/` - Session management (used by all ACP workers).
- `workers-registry/acp-worker/src/registry-launcher/stream/` - NDJSON handler (used by Registry Launcher).
- Changes must be backwards compatible; add tests across all affected code.

## 11. Performance & resource guidelines

**Avoid algorithms worse than O(n log n) for large collections unless justified.**

**Be mindful of:**
- Additional network roundtrips (batch requests where possible).
- Additional process spawns (reuse agent processes in Registry Launcher).
- Memory leaks in long-running workers (clean up sessions, close connections).
- Blocking operations on stdin/stdout (use async I/O, readline interface).

**Performance-critical paths:**
- NDJSON parsing and serialization (hot path for all messages).
- Session routing (must be O(1) lookup by sessionId).
- Agent process management (minimize spawn overhead, reuse processes).

**If a task touches performance-critical paths, summarize your reasoning and trade-offs.**

## 12. Monorepo & nested AGENTS.md

This repository is organized as a multi-worker registry with independent worker implementations.

**Rule: follow the instructions of the closest AGENTS.md to the file you are editing.**

Currently, there is only this root AGENTS.md. If nested AGENTS.md files are added in worker directories (e.g., `workers-registry/acp-worker/AGENTS.md`):
- Local (nested) rules take precedence for that worker.
- Global constraints in this root file still apply for:
  - Security (secrets handling, logging).
  - Destructive operations.
  - Protocol compliance (NDJSON, JSON-RPC 2.0).

## 13. Multi-agent / personas (if applicable)

If you are a specialized agent, follow your persona rules in addition to this file:

**@dev-agent:**
- Focus on implementation and tests.
- Ensure all changes are covered by tests.
- Run tests before proposing changes.

**@test-agent:**
- Focus on test coverage and edge cases.
- Do not change runtime code unless fixing test flakiness.
- Add property-based tests for protocol invariants.

**@security-agent:**
- Focus on security review and hardening.
- Minimize functional changes.
- Check for secrets leakage, input validation, and error handling.

**If rules conflict, security > correctness > convenience.**

## 14. Definition of Done (checklist)

Before considering a task complete, ensure:

1. **Code compiles, and the project builds:**
   - TypeScript workers: `cd workers-registry/acp-worker && npm run build`
   - MCP Echo Server: `cd workers-registry/mcp-echo-server && npm run build`

2. **Tests pass:**
   - All tests: `npm test`
   - Unit tests: `npm run test:unit`
   - Integration tests: `npm run test:integration`
   - Property-based tests: `npm run test:property`

3. **No constraints from section 10 are violated:**
   - Public API contracts unchanged (or explicitly approved).
   - NDJSON protocol compliance maintained.
   - No manual edits to generated files.

4. **New/changed behavior is covered by tests:**
   - Happy path tested.
   - Edge cases tested.
   - Regressions tested.

5. **Changes are documented:**
   - Code comments for non-trivial logic.
   - README updates if worker behavior changes.
   - Commit message explains what and why.

6. **No secrets or sensitive data added to the repo:**
   - No hardcoded API keys, tokens, or passwords.
   - No PII in logs or test fixtures.

7. **Protocol compliance verified:**
   - Workers write only JSON to stdout.
   - Workers log only to stderr.
   - Workers preserve `sessionId` in responses.
   - Workers handle SIGTERM gracefully.

**If any item is not satisfied, the task is not done.**
