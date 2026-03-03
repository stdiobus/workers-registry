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
 * Tool Call Utilities Tests
 *
 * Tests for tool call initiation, kind detection, and lifecycle management.
 */
import {
  determineToolKind,
  executeToolCall,
  executeToolCallWithPermission,
  generateToolCallId,
  requestToolPermission,
  sendToolCallInitiation,
  sendToolCallUpdate,
} from './tools.js';
import type { AgentSideConnection } from '@agentclientprotocol/sdk';
import type { MCPManager } from '../mcp/manager.js';

/**
 * Create a mock MCPManager for testing.
 */
function createMockMcpManager(): MCPManager & { callTool: jest.Mock } {
  return {
    callTool: jest.fn(),
    connect: jest.fn(),
    close: jest.fn(),
    listTools: jest.fn(),
    listResources: jest.fn(),
    readResource: jest.fn(),
    getConnection: jest.fn(),
    getAllConnections: jest.fn(),
    getServerCapabilities: jest.fn(),
    abortPendingOperations: jest.fn(),
    setOnServerCrash: jest.fn(),
    isServerCrashed: jest.fn(),
    getServerCrashError: jest.fn(),
    getCrashedServers: jest.fn(),
  } as unknown as MCPManager & { callTool: jest.Mock };
}

/**
 * Create a mock AgentSideConnection for testing.
 */
function createMockConnection(): AgentSideConnection {
  return {
    sessionUpdate: jest.fn().mockResolvedValue(undefined),
    requestPermission: jest.fn(),
    readTextFile: jest.fn(),
    writeTextFile: jest.fn(),
    createTerminal: jest.fn(),
    getTerminalOutput: jest.fn(),
    waitForTerminalExit: jest.fn(),
    killTerminal: jest.fn(),
    releaseTerminal: jest.fn(),
  } as unknown as AgentSideConnection;
}

describe('generateToolCallId', () => {
  /**
   * Generate unique toolCallId
   */
  it('should generate unique IDs', () => {
    const id1 = generateToolCallId();
    const id2 = generateToolCallId();
    const id3 = generateToolCallId();

    expect(id1).not.toBe(id2);
    expect(id2).not.toBe(id3);
    expect(id1).not.toBe(id3);
  });

  it('should generate IDs with tool- prefix', () => {
    const id = generateToolCallId();
    expect(id.startsWith('tool-')).toBe(true);
  });

  it('should include timestamp in ID', () => {
    const before = Date.now();
    const id = generateToolCallId();
    const after = Date.now();

    // Extract timestamp from ID (format: tool-{timestamp}-{counter})
    const parts = id.split('-');
    const timestamp = parseInt(parts[1], 10);

    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(after);
  });
});

describe('determineToolKind', () => {
  /**
   * Map tool kinds from MCP to ACP
   */
  it('should detect read operations', () => {
    expect(determineToolKind('readFile')).toBe('read');
    expect(determineToolKind('getContent')).toBe('read');
    expect(determineToolKind('listFiles')).toBe('read');
    expect(determineToolKind('fetchData')).toBe('read');
  });

  it('should detect edit operations', () => {
    expect(determineToolKind('writeFile')).toBe('edit');
    expect(determineToolKind('editContent')).toBe('edit');
    expect(determineToolKind('updateRecord')).toBe('edit');
    expect(determineToolKind('modifySettings')).toBe('edit');
  });

  it('should detect delete operations', () => {
    expect(determineToolKind('deleteFile')).toBe('delete');
    expect(determineToolKind('removeItem')).toBe('delete');
  });

  it('should detect move operations', () => {
    expect(determineToolKind('moveFile')).toBe('move');
    expect(determineToolKind('renameItem')).toBe('move');
  });

  it('should detect search operations', () => {
    expect(determineToolKind('searchFiles')).toBe('search');
    expect(determineToolKind('findPattern')).toBe('search');
    expect(determineToolKind('queryDatabase')).toBe('search');
  });

  it('should detect execute operations', () => {
    expect(determineToolKind('execCommand')).toBe('execute');
    expect(determineToolKind('runScript')).toBe('execute');
    expect(determineToolKind('shellCommand')).toBe('execute');
  });

  it('should detect fetch operations', () => {
    expect(determineToolKind('httpRequest')).toBe('fetch');
    expect(determineToolKind('apiCall')).toBe('fetch');
    expect(determineToolKind('makeRequest')).toBe('fetch');
  });

  it('should use description for kind detection', () => {
    expect(determineToolKind('getData', 'Fetches data from external API')).toBe('fetch');
  });

  it('should default to other for unknown tools', () => {
    expect(determineToolKind('unknownTool')).toBe('other');
    expect(determineToolKind('customAction')).toBe('other');
  });
});

describe('sendToolCallInitiation', () => {
  let mockConnection: AgentSideConnection;

  beforeEach(() => {
    mockConnection = createMockConnection();
  });

  /**
   * Build tool_call session update
   */
  it('should send tool_call session update', async () => {
    await sendToolCallInitiation(
      mockConnection,
      'session-123',
      'tool-1',
      'Test Tool',
      'read',
      'pending',
    );

    expect(mockConnection.sessionUpdate).toHaveBeenCalledWith({
      sessionId: 'session-123',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'tool-1',
        title: 'Test Tool',
        kind: 'read',
        status: 'pending',
      },
    });
  });

  it('should use default kind and status', async () => {
    await sendToolCallInitiation(
      mockConnection,
      'session-123',
      'tool-1',
      'Test Tool',
    );

    expect(mockConnection.sessionUpdate).toHaveBeenCalledWith({
      sessionId: 'session-123',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'tool-1',
        title: 'Test Tool',
        kind: 'other',
        status: 'pending',
      },
    });
  });
});

describe('sendToolCallUpdate', () => {
  let mockConnection: AgentSideConnection;

  beforeEach(() => {
    mockConnection = createMockConnection();
  });

  /**
   * Send tool_call_update with status and content
   */
  it('should send tool_call_update with status', async () => {
    await sendToolCallUpdate(
      mockConnection,
      'session-123',
      'tool-1',
      'in_progress',
    );

    expect(mockConnection.sessionUpdate).toHaveBeenCalledWith({
      sessionId: 'session-123',
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tool-1',
        status: 'in_progress',
        content: undefined,
        title: undefined,
      },
    });
  });

  it('should send tool_call_update with content', async () => {
    const content = [{
      type: 'content' as const,
      content: { type: 'text' as const, text: 'Result' },
    }];

    await sendToolCallUpdate(
      mockConnection,
      'session-123',
      'tool-1',
      'completed',
      content,
    );

    expect(mockConnection.sessionUpdate).toHaveBeenCalledWith({
      sessionId: 'session-123',
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tool-1',
        status: 'completed',
        content,
        title: undefined,
      },
    });
  });

  it('should send tool_call_update with title', async () => {
    await sendToolCallUpdate(
      mockConnection,
      'session-123',
      'tool-1',
      'completed',
      undefined,
      'Updated Title',
    );

    expect(mockConnection.sessionUpdate).toHaveBeenCalledWith({
      sessionId: 'session-123',
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tool-1',
        status: 'completed',
        content: undefined,
        title: 'Updated Title',
      },
    });
  });
});

describe('executeToolCall', () => {
  let mockConnection: AgentSideConnection;
  let mockMcpManager: MCPManager & { callTool: jest.Mock };

  beforeEach(() => {
    mockConnection = createMockConnection();
    mockMcpManager = createMockMcpManager();
  });

  /**
   * Full tool call lifecycle
   */
  it('should execute tool call with full lifecycle', async () => {
    // Mock successful tool execution
    mockMcpManager.callTool.mockResolvedValue({
      content: [{ type: 'text', text: 'Success!' }],
      isError: false,
    });

    const result = await executeToolCall(
      mockConnection,
      'session-123',
      mockMcpManager,
      'testTool',
      { arg: 'value' },
    );

    // Should have sent 3 updates: initiation, in_progress, completed
    expect(mockConnection.sessionUpdate).toHaveBeenCalledTimes(3);

    // First call: tool_call initiation
    expect(mockConnection.sessionUpdate).toHaveBeenNthCalledWith(1, expect.objectContaining({
      sessionId: 'session-123',
      update: expect.objectContaining({
        sessionUpdate: 'tool_call',
        status: 'pending',
      }),
    }));

    // Second call: in_progress update
    expect(mockConnection.sessionUpdate).toHaveBeenNthCalledWith(2, expect.objectContaining({
      sessionId: 'session-123',
      update: expect.objectContaining({
        sessionUpdate: 'tool_call_update',
        status: 'in_progress',
      }),
    }));

    // Third call: completed update with content
    expect(mockConnection.sessionUpdate).toHaveBeenNthCalledWith(3, expect.objectContaining({
      sessionId: 'session-123',
      update: expect.objectContaining({
        sessionUpdate: 'tool_call_update',
        status: 'completed',
      }),
    }));

    // Should return the content
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('content');
  });

  it('should handle tool execution errors', async () => {
    // Mock tool execution error
    mockMcpManager.callTool.mockRejectedValue(new Error('Tool failed'));

    const result = await executeToolCall(
      mockConnection,
      'session-123',
      mockMcpManager,
      'failingTool',
      {},
    );

    // Should have sent 3 updates: initiation, in_progress, failed
    expect(mockConnection.sessionUpdate).toHaveBeenCalledTimes(3);

    // Third call should be failed status
    expect(mockConnection.sessionUpdate).toHaveBeenNthCalledWith(3, expect.objectContaining({
      sessionId: 'session-123',
      update: expect.objectContaining({
        sessionUpdate: 'tool_call_update',
        status: 'failed',
      }),
    }));

    // Should return error content
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('content');
  });

  it('should handle tool returning isError: true', async () => {
    // Mock tool returning error result
    mockMcpManager.callTool.mockResolvedValue({
      content: [{ type: 'text', text: 'Error message' }],
      isError: true,
    });

    const result = await executeToolCall(
      mockConnection,
      'session-123',
      mockMcpManager,
      'errorTool',
      {},
    );

    // Third call should be failed status
    expect(mockConnection.sessionUpdate).toHaveBeenNthCalledWith(3, expect.objectContaining({
      update: expect.objectContaining({
        status: 'failed',
      }),
    }));

    expect(result).toHaveLength(1);
  });

  it('should use tool description for kind detection', async () => {
    mockMcpManager.callTool.mockResolvedValue({
      content: [{ type: 'text', text: 'Data' }],
      isError: false,
    });

    await executeToolCall(
      mockConnection,
      'session-123',
      mockMcpManager,
      'getData',
      {},
      'Fetches data from external API',
    );

    // First call should have kind: 'fetch' based on description
    expect(mockConnection.sessionUpdate).toHaveBeenNthCalledWith(1, expect.objectContaining({
      update: expect.objectContaining({
        kind: 'fetch',
      }),
    }));
  });
});


describe('requestToolPermission', () => {
  let mockConnection: AgentSideConnection;

  beforeEach(() => {
    mockConnection = createMockConnection();
  });

  /**
   * Use connection.requestPermission() method
   */
  it('should request permission and return granted when allow_once selected', async () => {
    jest.mocked(mockConnection.requestPermission).mockResolvedValue({
      outcome: { outcome: 'selected', optionId: 'allow_once' },
    });

    const result = await requestToolPermission(
      mockConnection,
      'session-123',
      'tool-1',
      'Test Tool',
      'read',
    );

    expect(mockConnection.requestPermission).toHaveBeenCalledWith({
      sessionId: 'session-123',
      toolCall: {
        toolCallId: 'tool-1',
        title: 'Test Tool',
        kind: 'read',
        status: 'pending',
      },
      options: expect.arrayContaining([
        expect.objectContaining({ optionId: 'allow_once', kind: 'allow_once' }),
        expect.objectContaining({ optionId: 'allow_always', kind: 'allow_always' }),
        expect.objectContaining({ optionId: 'reject_once', kind: 'reject_once' }),
      ]),
    });

    expect(result.granted).toBe(true);
    expect(result.optionId).toBe('allow_once');
    expect(result.cancelled).toBe(false);
  });

  it('should return granted when allow_always selected', async () => {
    jest.mocked(mockConnection.requestPermission).mockResolvedValue({
      outcome: { outcome: 'selected', optionId: 'allow_always' },
    });

    const result = await requestToolPermission(
      mockConnection,
      'session-123',
      'tool-1',
      'Test Tool',
    );

    expect(result.granted).toBe(true);
    expect(result.optionId).toBe('allow_always');
  });

  it('should return not granted when reject_once selected', async () => {
    jest.mocked(mockConnection.requestPermission).mockResolvedValue({
      outcome: { outcome: 'selected', optionId: 'reject_once' },
    });

    const result = await requestToolPermission(
      mockConnection,
      'session-123',
      'tool-1',
      'Test Tool',
    );

    expect(result.granted).toBe(false);
    expect(result.optionId).toBe('reject_once');
    expect(result.cancelled).toBe(false);
  });

  it('should return cancelled when permission request is cancelled', async () => {
    jest.mocked(mockConnection.requestPermission).mockResolvedValue({
      outcome: { outcome: 'cancelled' },
    });

    const result = await requestToolPermission(
      mockConnection,
      'session-123',
      'tool-1',
      'Test Tool',
    );

    expect(result.granted).toBe(false);
    expect(result.cancelled).toBe(true);
  });

  it('should handle permission request errors', async () => {
    jest.mocked(mockConnection.requestPermission).mockRejectedValue(new Error('Connection lost'));

    const result = await requestToolPermission(
      mockConnection,
      'session-123',
      'tool-1',
      'Test Tool',
    );

    expect(result.granted).toBe(false);
    expect(result.cancelled).toBe(true);
  });

  it('should use custom permission options when provided', async () => {
    jest.mocked(mockConnection.requestPermission).mockResolvedValue({
      outcome: { outcome: 'selected', optionId: 'custom_allow' },
    });

    const customOptions = [
      { optionId: 'custom_allow', name: 'Custom Allow', kind: 'allow_once' as const },
      { optionId: 'custom_reject', name: 'Custom Reject', kind: 'reject_once' as const },
    ];

    await requestToolPermission(
      mockConnection,
      'session-123',
      'tool-1',
      'Test Tool',
      'edit',
      customOptions,
    );

    expect(mockConnection.requestPermission).toHaveBeenCalledWith({
      sessionId: 'session-123',
      toolCall: expect.any(Object),
      options: customOptions,
    });
  });
});

describe('executeToolCallWithPermission', () => {
  let mockConnection: AgentSideConnection;
  let mockMcpManager: MCPManager & { callTool: jest.Mock };

  beforeEach(() => {
    mockConnection = createMockConnection();
    mockMcpManager = createMockMcpManager();
  });

  /**
   * Full tool call lifecycle with permission
   */
  it('should execute tool when permission is granted', async () => {
    jest.mocked(mockConnection.requestPermission).mockResolvedValue({
      outcome: { outcome: 'selected', optionId: 'allow_once' },
    });
    mockMcpManager.callTool.mockResolvedValue({
      content: [{ type: 'text', text: 'Success!' }],
      isError: false,
    });

    const result = await executeToolCallWithPermission(
      mockConnection,
      'session-123',
      mockMcpManager,
      'testTool',
      { arg: 'value' },
    );

    // Should have called requestPermission
    expect(mockConnection.requestPermission).toHaveBeenCalled();

    // Should have called the tool
    expect(mockMcpManager.callTool).toHaveBeenCalledWith('testTool', { arg: 'value' });

    // Should return content
    expect(result.content).toHaveLength(1);
  });

  it('should not execute tool when permission is denied', async () => {
    jest.mocked(mockConnection.requestPermission).mockResolvedValue({
      outcome: { outcome: 'selected', optionId: 'reject_once' },
    });

    const result = await executeToolCallWithPermission(
      mockConnection,
      'session-123',
      mockMcpManager,
      'testTool',
      {},
    );

    // Should have called requestPermission
    expect(mockConnection.requestPermission).toHaveBeenCalled();

    // Should NOT have called the tool
    expect(mockMcpManager.callTool).not.toHaveBeenCalled();

    // Should return permission denied content
    expect(result.permissionResult?.granted).toBe(false);
    expect(result.content[0]).toEqual({
      type: 'content',
      content: { type: 'text', text: 'Permission denied' },
    });
  });

  it('should not execute tool when permission is cancelled', async () => {
    jest.mocked(mockConnection.requestPermission).mockResolvedValue({
      outcome: { outcome: 'cancelled' },
    });

    const result = await executeToolCallWithPermission(
      mockConnection,
      'session-123',
      mockMcpManager,
      'testTool',
      {},
    );

    // Should NOT have called the tool
    expect(mockMcpManager.callTool).not.toHaveBeenCalled();

    // Should return cancelled content
    expect(result.permissionResult?.cancelled).toBe(true);
    expect(result.content[0]).toEqual({
      type: 'content',
      content: { type: 'text', text: 'Permission request cancelled' },
    });
  });

  it('should skip permission request when requirePermission is false', async () => {
    mockMcpManager.callTool.mockResolvedValue({
      content: [{ type: 'text', text: 'Success!' }],
      isError: false,
    });

    const result = await executeToolCallWithPermission(
      mockConnection,
      'session-123',
      mockMcpManager,
      'testTool',
      {},
      undefined,
      false, // requirePermission = false
    );

    // Should NOT have called requestPermission
    expect(mockConnection.requestPermission).not.toHaveBeenCalled();

    // Should have called the tool
    expect(mockMcpManager.callTool).toHaveBeenCalled();

    // Should return content
    expect(result.content).toHaveLength(1);
  });

  it('should handle tool execution errors after permission granted', async () => {
    jest.mocked(mockConnection.requestPermission).mockResolvedValue({
      outcome: { outcome: 'selected', optionId: 'allow_once' },
    });
    mockMcpManager.callTool.mockRejectedValue(new Error('Tool failed'));

    const result = await executeToolCallWithPermission(
      mockConnection,
      'session-123',
      mockMcpManager,
      'failingTool',
      {},
    );

    // Should return error content
    expect(result.content[0]).toEqual({
      type: 'content',
      content: { type: 'text', text: 'Error: Tool failed' },
    });
  });
});
