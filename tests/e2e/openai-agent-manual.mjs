#!/usr/bin/env node

/**
 * Manual E2E test: Full ACP flow through stdio Bus with openai-agent
 *
 * Walks through the complete flow:
 *   1. Start stdio Bus with openai-agent worker
 *   2. initialize  → see authMethods (OAuth 2.1 with agent-auth)
 *   3. authenticate → agent acknowledges (no-op for this agent)
 *   4. session/new  → get a sessionId
 *   5. session/prompt → send a real prompt to OpenAI and stream response
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... node tests/e2e/openai-agent-manual.mjs
 *   OPENAI_API_KEY=sk-... node tests/e2e/openai-agent-manual.mjs "Your custom prompt"
 *
 * For Ollama (no key needed):
 *   OPENAI_BASE_URL=http://localhost:11434/v1 OPENAI_MODEL=llama3 node tests/e2e/openai-agent-manual.mjs
 */

import { StdioBus } from '@stdiobus/node';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = resolve(__dirname, 'openai-agent-bus-config.json');
const PROTOCOL_VERSION = 1;

let msgId = 0;
const nextId = () => `manual-${++msgId}`;

// ── Helpers ──

function sendAndWait(bus, method, params, timeoutMs = 30000) {
  const id = nextId();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout (${timeoutMs}ms) waiting for ${method} response`));
    }, timeoutMs);

    const handler = (msg) => {
      try {
        const response = JSON.parse(msg);
        if (response.id === id) {
          clearTimeout(timer);
          if (response.error) {
            reject(new Error(
              `JSON-RPC error ${response.error.code}: ${response.error.message}`
            ));
          } else {
            resolve(response.result);
          }
        }
      } catch { /* not our message */ }
    };

    bus.onMessage(handler);
    bus.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
  });
}

function collectSessionUpdates(bus, sessionId, timeoutMs = 30000) {
  const chunks = [];
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(chunks), timeoutMs);

    bus.onMessage((msg) => {
      try {
        const parsed = JSON.parse(msg);
        // Session updates are notifications (no id) with method session/update
        if (parsed.method === 'session/update' &&
          parsed.params?.sessionId === sessionId) {
          const content = parsed.params?.update?.content;
          if (content?.type === 'text') {
            chunks.push(content.text);
            process.stdout.write(content.text);
          }
        }
        // Prompt response (has id) signals end
        if (parsed.id && parsed.result?.stopReason) {
          clearTimeout(timer);
          setTimeout(() => resolve(chunks), 100);
        }
      } catch { /* ignore */ }
    });
  });
}

function hr() { console.log('\n' + '─'.repeat(60)); }
function step(n, title) { hr(); console.log(`  Step ${n}: ${title}`); hr(); }

// ── CI resolveType logic ──

function resolveType(method) {
  if (typeof method.type === 'string') return method.type;
  const meta = method._meta;
  if (meta && 'terminal-auth' in meta) return 'terminal';
  if (meta && 'agent-auth' in meta) return 'agent';
  return 'agent';
}

// ── Main ──

async function main() {
  const userPrompt = process.argv[2] || 'Say hello in one sentence.';

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  OpenAI Agent — Full ACP Flow via stdio Bus            ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log();
  console.log(`  Config:   ${CONFIG_PATH}`);
  console.log(`  Base URL: ${process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'}`);
  console.log(`  Model:    ${process.env.OPENAI_MODEL || 'gpt-4o'}`);
  console.log(`  API Key:  ${process.env.OPENAI_API_KEY ? '***' + process.env.OPENAI_API_KEY.slice(-4) : '(not set)'}`);
  console.log(`  Prompt:   "${userPrompt}"`);

  // ── Step 1: Start bus ──
  step(1, 'Starting stdio Bus with openai-agent worker');

  const bus = new StdioBus({ configPath: CONFIG_PATH });
  await bus.start();
  await new Promise((r) => setTimeout(r, 500));

  console.log(`  Bus state:    ${bus.isRunning() ? 'RUNNING' : 'NOT RUNNING'}`);
  console.log(`  Workers:      ${bus.getWorkerCount()}`);
  console.log(`  Backend:      ${bus.getBackendType()}`);

  try {
    // ── Step 2: Initialize ──
    step(2, 'initialize — check authMethods');

    const initResult = await sendAndWait(bus, 'initialize', {
      protocolVersion: PROTOCOL_VERSION,
      clientInfo: { name: 'manual-e2e', version: '1.0.0' },
    });

    console.log(`  Agent:           ${initResult.agentInfo?.name} v${initResult.agentInfo?.version}`);
    console.log(`  Protocol:        ${initResult.protocolVersion}`);
    console.log(`  Capabilities:    ${JSON.stringify(initResult.agentCapabilities)}`);
    console.log(`  authMethods:     ${initResult.authMethods?.length || 0} method(s)`);

    if (initResult.authMethods?.length > 0) {
      for (const m of initResult.authMethods) {
        const type = resolveType(m);
        console.log(`    → id="${m.id}", name="${m.name}", resolvedType="${type}"`);
        if (m._meta) console.log(`      _meta: ${JSON.stringify(m._meta)}`);
      }

      const hasAgentAuth = initResult.authMethods.some(
        (m) => resolveType(m) === 'agent' || resolveType(m) === 'terminal'
      );
      console.log(`  CI auth-check:   ${hasAgentAuth ? 'PASS' : 'FAIL'}`);
    } else {
      console.log('  CI auth-check:   FAIL (empty authMethods)');
    }

    // ── Step 3: Authenticate ──
    step(3, 'authenticate — agent acknowledges');

    const authResult = await sendAndWait(bus, 'authenticate', {
      methodId: 'oauth2',
    });
    console.log(`  Result: ${JSON.stringify(authResult)}`);
    console.log('  (No-op for this agent — auth handled externally)');

    // ── Step 4: New Session ──
    step(4, 'session/new — create session');

    const sessionResult = await sendAndWait(bus, 'session/new', {
      cwd: process.cwd(),
      mcpServers: [],
    });
    const sessionId = sessionResult.sessionId;
    console.log(`  Session ID: ${sessionId}`);

    // ── Step 5: Prompt ──
    step(5, `session/prompt — "${userPrompt}"`);
    console.log();
    console.log('  Response:');
    console.log('  ');

    // Start collecting streaming chunks
    const chunksPromise = collectSessionUpdates(bus, sessionId, 30000);

    // Send the prompt
    const promptResult = await sendAndWait(bus, 'session/prompt', {
      sessionId,
      prompt: [{ type: 'text', text: userPrompt }],
    }, 30000);

    const chunks = await chunksPromise;
    console.log();
    console.log();
    console.log(`  Stop reason: ${promptResult.stopReason}`);
    console.log(`  Chunks received: ${chunks.length}`);

    // ── Summary ──
    hr();
    console.log('  Summary');
    hr();
    const stats = bus.getStats();
    console.log(`  Messages in:     ${stats.messagesIn}`);
    console.log(`  Messages out:    ${stats.messagesOut}`);
    console.log(`  Bytes in:        ${stats.bytesIn}`);
    console.log(`  Bytes out:       ${stats.bytesOut}`);
    console.log();
    console.log('  All steps completed successfully.');

  } catch (err) {
    console.error(`\n  ERROR: ${err.message}`);
    if (err.message.includes('Authentication error')) {
      console.error('  → Set OPENAI_API_KEY environment variable');
    }
  } finally {
    console.log('\n  Stopping bus...');
    await bus.stop(5);
    console.log('  Done.');
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
