#!/usr/bin/env node

/*
 * Apache License 2.0
 * Copyright (c) 2025–present Raman Marozau, Target Insight Function.
 * Contact: raman@worktif.com
 *
 * This file is part of the stdio bus protocol reference implementation:
 *   stdio_bus_kernel_workers (target: <target_stdio_bus_kernel_workers>).
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * MCP-to-ACP Protocol Proxy
 *
 * Converts MCP protocol (from Kiro) to ACP protocol (for stdio Bus)
 * Runs as MCP server for Kiro, forwards to ACP via TCP
 */

import net from 'net';
import { createInterface } from 'readline';

const ACP_HOST = process.env.ACP_HOST || '127.0.0.1';
const ACP_PORT = process.env.ACP_PORT || 9000;
const AGENT_ID = process.env.AGENT_ID || 'default-agent';

console.error(`[MCP-APC][proxy] Starting proxy...`);
console.error(`[MCP-APC][proxy] Target: ${ACP_HOST}:${ACP_PORT}`);
console.error(`[MCP-APC][proxy] Agent ID: ${AGENT_ID}`);

// State
const acpSocket = net.connect(ACP_PORT, ACP_HOST);
let acpConnected = false;
let proxySessionId = null; // For stdio Bus routing
let acpSessionId = null; // From ACP agent
let pendingRequests = new Map(); // id -> {method, params, ...}
let accumulatedText = new Map(); // requestId -> accumulated text

acpSocket.on('connect', () => {
  console.error('[MCP-APC][proxy] Connected to ACP stdio Bus');
  acpConnected = true;
});

acpSocket.on('error', (err) => {
  console.error(`[MCP-APC][proxy] ACP connection error: ${err.message}`);
  process.exit(1);
});

// Handle ACP messages
let acpBuffer = '';
acpSocket.on('data', (data) => {
  acpBuffer += data.toString();

  let newlineIndex;
  while ((newlineIndex = acpBuffer.indexOf('\n')) !== -1) {
    const line = acpBuffer.slice(0, newlineIndex);
    acpBuffer = acpBuffer.slice(newlineIndex + 1);

    if (line.trim()) {
      try {
        const acpMsg = JSON.parse(line);
        console.error(`[MCP-APC][proxy] ← ACP: ${JSON.stringify(acpMsg)}`);

        // Check if notification or response
        if (acpMsg.id === undefined || acpMsg.id === null) {
          // Notification from ACP worker - rewrite sessionId and send back to stdio Bus
          console.error(`[MCP-APC][proxy] Processing notification: ${acpMsg.method}`);
          handleACPNotification(acpMsg);
        } else {
          // Response
          console.error(`[MCP-APC][proxy] Processing response id=${acpMsg.id}`);
          console.error(`[MCP-APC][proxy] Pending: ${JSON.stringify([...pendingRequests.keys()])}`);
          const mcpResponse = convertACPtoMCP(acpMsg);
          if (mcpResponse) {
            console.error(`[MCP-APC][proxy] → MCP: ${JSON.stringify(mcpResponse)}`);
            process.stdout.write(JSON.stringify(mcpResponse) + '\n');
          } else {
            console.error(`[MCP-APC][proxy] WARNING: No MCP response for id=${acpMsg.id}`);
          }
        }
      } catch (err) {
        console.error(`[MCP-APC][proxy] Error parsing ACP: ${err.message}`);
      }
    }
  }
});

// Handle MCP requests
const rl = createInterface({
  input: process.stdin,
  terminal: false
});

rl.on('line', (line) => {
  if (!line.trim()) return;

  try {
    const mcpReq = JSON.parse(line);
    console.error(`[MCP-APC][proxy] ← MCP: ${JSON.stringify(mcpReq)}`);

    const acpReq = convertMCPtoACP(mcpReq);
    if (acpReq) {
      console.error(`[MCP-APC][proxy] → ACP: ${JSON.stringify(acpReq)}`);
      if (acpConnected) {
        acpSocket.write(JSON.stringify(acpReq) + '\n');
      }
    }
  } catch (err) {
    console.error(`[MCP-APC][proxy] Error parsing MCP: ${err.message}`);
  }
});

function handleACPNotification(msg) {
  const { method, params } = msg;

  if (method === 'session/update' && params?.update) {
    const update = params.update;

    // Find pending session/prompt request
    for (const [reqId, pending] of pendingRequests.entries()) {
      if (pending.method === 'session/prompt') {
        if (update.sessionUpdate === 'agent_message_chunk' && update.content?.text) {
          if (!accumulatedText.has(reqId)) {
            accumulatedText.set(reqId, '');
          }
          accumulatedText.set(reqId, accumulatedText.get(reqId) + update.content.text);
        }
        break;
      }
    }
  }

  // CRITICAL FIX: Add sessionId to notification before sending back to stdio_bus
  // Without sessionId, stdio_bus cannot route the message and shows warning:
  // "Worker message has no id or sessionId, cannot route"
  if (proxySessionId) {
    const notificationWithSession = {
      ...msg,
      sessionId: proxySessionId
    };
    console.error(`[MCP-ACP][proxy] → stdio_bus notification with sessionId: ${JSON.stringify(notificationWithSession)}`);
    if (acpConnected) {
      acpSocket.write(JSON.stringify(notificationWithSession) + '\n');
    }
  }
}

function convertMCPtoACP(mcpReq) {
  const { id, method, params } = mcpReq;

  if (id === undefined || id === null) {
    return null; // Ignore notifications
  }

  pendingRequests.set(id, { method, params });

  if (!proxySessionId) {
    proxySessionId = `proxy-${Date.now()}`;
  }

  switch (method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id,
        method: 'initialize',
        agentId: AGENT_ID,
        sessionId: proxySessionId,
        params: {
          protocolVersion: 1,
          clientCapabilities: params?.capabilities || {},
          clientInfo: params?.clientInfo || { name: 'mcp-proxy', version: '1.0.0' }
        }
      };

    case 'tools/list':
      sendMCP({
        jsonrpc: '2.0',
        id,
        result: {
          tools: [{
            name: 'acp_prompt',
            description: `Send prompt to ${AGENT_ID}`,
            inputSchema: {
              type: 'object',
              properties: {
                prompt: { type: 'string', description: 'Prompt text' }
              },
              required: ['prompt']
            }
          }]
        }
      });
      pendingRequests.delete(id);
      return null;

    case 'tools/call':
      const promptText = params?.arguments?.prompt || '';

      if (!acpSessionId) {
        // Need to create session first
        const sessionReqId = `sess-${id}`;
        pendingRequests.set(sessionReqId, {
          method: 'session/new',
          originalId: id,
          promptText
        });
        return {
          jsonrpc: '2.0',
          id: sessionReqId,
          method: 'session/new',
          agentId: AGENT_ID,
          sessionId: proxySessionId,
          params: { cwd: process.cwd(), mcpServers: [] }
        };
      }

      // Session exists, send prompt
      // IMPORTANT: Update pending to session/prompt since that's what we're sending
      pendingRequests.set(id, { method: 'session/prompt', params });
      return {
        jsonrpc: '2.0',
        id,
        method: 'session/prompt',
        agentId: AGENT_ID,
        sessionId: proxySessionId,
        params: {
          sessionId: acpSessionId,
          prompt: [{ type: 'text', text: promptText }]
        }
      };

    case 'resources/list':
      sendMCP({ jsonrpc: '2.0', id, result: { resources: [] } });
      pendingRequests.delete(id);
      return null;

    case 'resources/templates/list':
      sendMCP({ jsonrpc: '2.0', id, result: { resourceTemplates: [] } });
      pendingRequests.delete(id);
      return null;

    case 'prompts/list':
      sendMCP({ jsonrpc: '2.0', id, result: { prompts: [] } });
      pendingRequests.delete(id);
      return null;

    default:
      sendMCP({ jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown method: ${method}` } });
      pendingRequests.delete(id);
      return null;
  }
}

function convertACPtoMCP(acpResp) {
  const { id, result, error } = acpResp;

  const pending = pendingRequests.get(id);
  if (!pending) {
    console.error(`[MCP-APC][proxy] ERROR: No pending request for id=${id}`);
    return null;
  }

  console.error(`[MCP-APC][proxy] Converting ACP->MCP for method: ${pending.method}`);
  pendingRequests.delete(id);

  if (error) {
    accumulatedText.delete(id);
    return {
      jsonrpc: '2.0',
      id,
      error: { code: error.code || -32603, message: error.message || 'ACP error' }
    };
  }

  switch (pending.method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {}, resources: {} },
          serverInfo: result?.agentInfo || { name: 'acp-agent', version: '1.0.0' }
        }
      };

    case 'session/new':
      acpSessionId = result?.sessionId;
      console.error(`[MCP-APC][proxy] ACP session: ${acpSessionId}`);

      if (pending.originalId && pending.promptText) {
        // Send queued prompt
        const promptReq = {
          jsonrpc: '2.0',
          id: pending.originalId,
          method: 'session/prompt',
          agentId: AGENT_ID,
          sessionId: proxySessionId,
          params: {
            sessionId: acpSessionId,
            prompt: [{ type: 'text', text: pending.promptText }]
          }
        };

        pendingRequests.set(pending.originalId, { method: 'session/prompt' });

        console.error(`[MCP-APC][proxy] → ACP: ${JSON.stringify(promptReq)}`);
        if (acpConnected) {
          acpSocket.write(JSON.stringify(promptReq) + '\n');
        }
      }
      return null;

    case 'session/prompt':
      const text = accumulatedText.get(id) || '';
      accumulatedText.delete(id);
      console.error(`[MCP-APC][proxy] Returning accumulated text (${text.length} chars): "${text.substring(0, 50)}..."`);
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: text || 'No response' }]
        }
      };

    default:
      console.error(`[MCP-APC][proxy] WARNING: Unhandled method ${pending.method}, returning raw result`);
      return { jsonrpc: '2.0', id, result: result || {} };
  }
}

function sendMCP(msg) {
  console.error(`[MCP-APC][proxy] → MCP: ${JSON.stringify(msg)}`);
  process.stdout.write(JSON.stringify(msg) + '\n');
}

process.on('SIGTERM', () => {
  acpSocket.end();
  process.exit(0);
});

process.on('SIGINT', () => {
  acpSocket.end();
  process.exit(0);
});
