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
 * Tool Call Utilities
 *
 * Provides utilities for initiating and managing tool calls in ACP.
 * Handles tool call lifecycle including initiation, permission requests,
 * execution, and result reporting.
 *
 * @module acp/tools
 */

import type { AgentSideConnection, PermissionOption, ToolCallContent, ToolCallUpdate } from '@agentclientprotocol/sdk';
import { mapToolResultToACPContent } from './content-mapper.js';
import type { MCPManager } from '../mcp/manager.js';
import type { MCPContent } from '../mcp/types.js';

/**
 * Permission request result.
 */
export interface PermissionResult {
  /** Whether permission was granted */
  granted: boolean;
  /** The option ID that was selected (if granted) */
  optionId?: string;
  /** Whether the request was cancelled */
  cancelled?: boolean;
}

/**
 * Tool kind categories for ACP tool calls.
 * Helps clients choose appropriate icons and UI treatment.
 */
export type ToolKind =
  'read'
  | 'edit'
  | 'delete'
  | 'move'
  | 'search'
  | 'execute'
  | 'think'
  | 'fetch'
  | 'switch_mode'
  | 'other';

/**
 * Tool call status values.
 */
export type ToolCallStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

/**
 * Counter for generating unique tool call IDs within a session.
 */
let toolCallCounter = 0;

/**
 * Generate a unique tool call ID.
 *
 * @returns A unique tool call ID string
 */
export function generateToolCallId(): string {
  toolCallCounter++;
  return `tool-${Date.now()}-${toolCallCounter}`;
}

/**
 * Determine the tool kind based on tool name and description.
 *
 * @param toolName - The name of the tool
 * @param description - Optional tool description
 * @returns The appropriate ToolKind
 */
export function determineToolKind(toolName: string, description?: string): ToolKind {
  const name = toolName.toLowerCase();
  const desc = (description || '').toLowerCase();

  // Check description first for more specific hints
  if (desc.includes('external') || desc.includes('api') || desc.includes('http')) {
    return 'fetch';
  }

  // Check for read operations
  if (name.includes('read') || name.includes('get') || name.includes('list') || name.includes('fetch')) {
    return 'read';
  }

  // Check for edit/write operations
  if (name.includes('write') || name.includes('edit') || name.includes('update') || name.includes('modify')) {
    return 'edit';
  }

  // Check for delete operations
  if (name.includes('delete') || name.includes('remove')) {
    return 'delete';
  }

  // Check for move/rename operations
  if (name.includes('move') || name.includes('rename')) {
    return 'move';
  }

  // Check for search operations
  if (name.includes('search') || name.includes('find') || name.includes('query')) {
    return 'search';
  }

  // Check for execute operations
  if (name.includes('exec') || name.includes('run') || name.includes('shell') || name.includes('command')) {
    return 'execute';
  }

  // Check for fetch operations (external data)
  if (name.includes('http') || name.includes('api') || name.includes('request')) {
    return 'fetch';
  }

  // Default to 'other' for unknown tools
  return 'other';
}

/**
 * Send a tool_call session update to initiate a tool call.
 *
 * @param connection - The ACP connection
 * @param sessionId - The session ID
 * @param toolCallId - The unique tool call ID
 * @param title - Human-readable title for the tool call
 * @param kind - The tool kind category
 * @param status - Initial status (usually 'pending')
 */
export async function sendToolCallInitiation(
  connection: AgentSideConnection,
  sessionId: string,
  toolCallId: string,
  title: string,
  kind: ToolKind = 'other',
  status: ToolCallStatus = 'pending',
): Promise<void> {
  await connection.sessionUpdate({
    sessionId,
    update: {
      sessionUpdate: 'tool_call',
      toolCallId,
      title,
      kind,
      status,
    },
  });
}

/**
 * Send a tool_call_update to report progress or results.
 *
 * @param connection - The ACP connection
 * @param sessionId - The session ID
 * @param toolCallId - The tool call ID to update
 * @param status - The new status
 * @param content - Optional content to include
 * @param title - Optional updated title
 */
export async function sendToolCallUpdate(
  connection: AgentSideConnection,
  sessionId: string,
  toolCallId: string,
  status: ToolCallStatus,
  content?: ToolCallContent[],
  title?: string,
): Promise<void> {
  await connection.sessionUpdate({
    sessionId,
    update: {
      sessionUpdate: 'tool_call_update',
      toolCallId,
      status,
      content,
      title,
    },
  });
}

/**
 * Request permission from the user before executing a tool.
 *
 * @param connection - The ACP connection
 * @param sessionId - The session ID
 * @param toolCallId - The tool call ID
 * @param title - Human-readable title for the tool call
 * @param kind - The tool kind category
 * @param options - Permission options to present to the user
 * @returns The permission result with granted/cancelled status
 */
export async function requestToolPermission(
  connection: AgentSideConnection,
  sessionId: string,
  toolCallId: string,
  title: string,
  kind: ToolKind = 'other',
  options?: PermissionOption[],
): Promise<PermissionResult> {
  // Build default permission options if not provided
  const permissionOptions: PermissionOption[] = options ?? [
    { optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' },
    { optionId: 'allow_always', name: 'Allow always', kind: 'allow_always' },
    { optionId: 'reject_once', name: 'Reject', kind: 'reject_once' },
  ];

  // Build the tool call update for the permission request
  const toolCall: ToolCallUpdate = {
    toolCallId,
    title,
    kind,
    status: 'pending',
  };

  try {
    // Use SDK's requestPermission method
    const response = await connection.requestPermission({
      sessionId,
      toolCall,
      options: permissionOptions,
    });

    // Handle the response outcome
    if (response.outcome.outcome === 'cancelled') {
      return { granted: false, cancelled: true };
    }

    if (response.outcome.outcome === 'selected') {
      const selectedOption = response.outcome.optionId;
      // Check if the selected option is an allow option
      const isAllowed = selectedOption.startsWith('allow');
      return {
        granted: isAllowed,
        optionId: selectedOption,
        cancelled: false,
      };
    }

    // Unknown outcome - treat as rejected
    return { granted: false, cancelled: false };
  } catch (error) {
    // If permission request fails, treat as cancelled
    console.error('[ACP] Permission request failed:', error);
    return { granted: false, cancelled: true };
  }
}

/**
 * Execute a tool call with full lifecycle management.
 *
 * This function handles the complete tool call flow:
 * 1. Sends tool_call initiation with pending status
 * 2. Updates to in_progress when execution starts
 * 3. Executes the tool via MCP
 * 4. Updates with completed/failed status and results
 *
 * @param connection - The ACP connection
 * @param sessionId - The session ID
 * @param mcpManager - The MCP manager for tool execution
 * @param toolName - The name of the tool to execute
 * @param args - Arguments to pass to the tool
 * @param description - Optional tool description for kind detection
 * @returns The tool call result content
 */
export async function executeToolCall(
  connection: AgentSideConnection,
  sessionId: string,
  mcpManager: MCPManager,
  toolName: string,
  args: Record<string, unknown>,
  description?: string,
): Promise<ToolCallContent[]> {
  // Generate unique tool call ID
  const toolCallId = generateToolCallId();

  // Determine tool kind
  const kind = determineToolKind(toolName, description);

  // Create human-readable title
  const title = `Executing: ${toolName}`;

  try {
    // Send tool_call initiation with pending status
    await sendToolCallInitiation(connection, sessionId, toolCallId, title, kind, 'pending');

    // Update to in_progress
    await sendToolCallUpdate(connection, sessionId, toolCallId, 'in_progress');

    // Execute the tool via MCP
    const result = await mcpManager.callTool(toolName, args);

    // Map MCP result to ACP content
    const content = mapToolResultToACPContent(result.content as MCPContent[], result.isError);

    // Send final update with completed/failed status
    const finalStatus: ToolCallStatus = result.isError ? 'failed' : 'completed';
    await sendToolCallUpdate(connection, sessionId, toolCallId, finalStatus, content);

    return content;
  } catch (error) {
    // Send failed status on error
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorContent: ToolCallContent[] = [{
      type: 'content',
      content: {
        type: 'text',
        text: `Error: ${errorMessage}`,
      },
    }];

    await sendToolCallUpdate(connection, sessionId, toolCallId, 'failed', errorContent);

    return errorContent;
  }
}

/**
 * Execute a tool call with permission request.
 *
 * This function handles the complete tool call flow with permission:
 * 1. Sends tool_call initiation with pending status
 * 2. Requests permission from the user
 * 3. If granted, executes the tool via MCP
 * 4. Updates with completed/failed status and results
 *
 * @param connection - The ACP connection
 * @param sessionId - The session ID
 * @param mcpManager - The MCP manager for tool execution
 * @param toolName - The name of the tool to execute
 * @param args - Arguments to pass to the tool
 * @param description - Optional tool description for kind detection
 * @param requirePermission - Whether to request permission before execution
 * @returns The tool call result content and permission result
 */
export async function executeToolCallWithPermission(
  connection: AgentSideConnection,
  sessionId: string,
  mcpManager: MCPManager,
  toolName: string,
  args: Record<string, unknown>,
  description?: string,
  requirePermission: boolean = true,
): Promise<{ content: ToolCallContent[]; permissionResult?: PermissionResult }> {
  // Generate unique tool call ID
  const toolCallId = generateToolCallId();

  // Determine tool kind
  const kind = determineToolKind(toolName, description);

  // Create human-readable title
  const title = `Executing: ${toolName}`;

  try {
    // Send tool_call initiation with pending status
    await sendToolCallInitiation(connection, sessionId, toolCallId, title, kind, 'pending');

    // Request permission if required
    if (requirePermission) {
      const permissionResult = await requestToolPermission(
        connection,
        sessionId,
        toolCallId,
        title,
        kind,
      );

      // If permission was cancelled or rejected, return early
      if (!permissionResult.granted) {
        const status: ToolCallStatus = permissionResult.cancelled ? 'failed' : 'failed';
        const message = permissionResult.cancelled ? 'Permission request cancelled' : 'Permission denied';
        const errorContent: ToolCallContent[] = [{
          type: 'content',
          content: {
            type: 'text',
            text: message,
          },
        }];

        await sendToolCallUpdate(connection, sessionId, toolCallId, status, errorContent);

        return { content: errorContent, permissionResult };
      }
    }

    // Update to in_progress
    await sendToolCallUpdate(connection, sessionId, toolCallId, 'in_progress');

    // Execute the tool via MCP
    const result = await mcpManager.callTool(toolName, args);

    // Map MCP result to ACP content
    const content = mapToolResultToACPContent(result.content as MCPContent[], result.isError);

    // Send final update with completed/failed status
    const finalStatus: ToolCallStatus = result.isError ? 'failed' : 'completed';
    await sendToolCallUpdate(connection, sessionId, toolCallId, finalStatus, content);

    return { content };
  } catch (error) {
    // Send failed status on error
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorContent: ToolCallContent[] = [{
      type: 'content',
      content: {
        type: 'text',
        text: `Error: ${errorMessage}`,
      },
    }];

    await sendToolCallUpdate(connection, sessionId, toolCallId, 'failed', errorContent);

    return { content: errorContent };
  }
}
