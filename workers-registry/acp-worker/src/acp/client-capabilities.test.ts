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
 * Client Capabilities Tests
 *
 * Tests for file system and terminal access via ACP SDK.
 */
import {
  canReadFile,
  canUseTerminal,
  canWriteFile,
  executeCommand,
  readFile,
  startCommand,
  writeFile,
} from './client-capabilities.js';
import type { AgentSideConnection, ClientCapabilities, TerminalHandle } from '@agentclientprotocol/sdk';

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
  } as unknown as AgentSideConnection;
}

/**
 * Create a mock TerminalHandle for testing.
 */
function createMockTerminalHandle(): TerminalHandle {
  return {
    id: 'terminal-123',
    currentOutput: jest.fn(),
    waitForExit: jest.fn(),
    kill: jest.fn(),
    release: jest.fn(),
  } as unknown as TerminalHandle;
}

describe('canReadFile', () => {
  /**
   * Validates - Check clientCapabilities.fs.readTextFile
   */
  it('should return true when readTextFile capability is enabled', () => {
    const capabilities: ClientCapabilities = {
      fs: { readTextFile: true, writeTextFile: false },
      terminal: false,
    };
    expect(canReadFile(capabilities)).toBe(true);
  });

  it('should return false when readTextFile capability is disabled', () => {
    const capabilities: ClientCapabilities = {
      fs: { readTextFile: false, writeTextFile: true },
      terminal: true,
    };
    expect(canReadFile(capabilities)).toBe(false);
  });

  it('should return false when capabilities is null', () => {
    expect(canReadFile(null)).toBe(false);
  });

  it('should return false when fs is undefined', () => {
    const capabilities: ClientCapabilities = {
      terminal: true,
    };
    expect(canReadFile(capabilities)).toBe(false);
  });
});

describe('canWriteFile', () => {
  /**
   * Check clientCapabilities.fs.writeTextFile
   */
  it('should return true when writeTextFile capability is enabled', () => {
    const capabilities: ClientCapabilities = {
      fs: { readTextFile: false, writeTextFile: true },
      terminal: false,
    };
    expect(canWriteFile(capabilities)).toBe(true);
  });

  it('should return false when writeTextFile capability is disabled', () => {
    const capabilities: ClientCapabilities = {
      fs: { readTextFile: true, writeTextFile: false },
      terminal: true,
    };
    expect(canWriteFile(capabilities)).toBe(false);
  });

  it('should return false when capabilities is null', () => {
    expect(canWriteFile(null)).toBe(false);
  });
});

describe('canUseTerminal', () => {
  /**
   * Check clientCapabilities.terminal
   */
  it('should return true when terminal capability is enabled', () => {
    const capabilities: ClientCapabilities = {
      fs: { readTextFile: false, writeTextFile: false },
      terminal: true,
    };
    expect(canUseTerminal(capabilities)).toBe(true);
  });

  it('should return false when terminal capability is disabled', () => {
    const capabilities: ClientCapabilities = {
      fs: { readTextFile: true, writeTextFile: true },
      terminal: false,
    };
    expect(canUseTerminal(capabilities)).toBe(false);
  });

  it('should return false when capabilities is null', () => {
    expect(canUseTerminal(null)).toBe(false);
  });
});

describe('readFile', () => {
  let mockConnection: AgentSideConnection;

  beforeEach(() => {
    mockConnection = createMockConnection();
  });

  /**
   * Use connection.readTextFile() for reads
   */
  it('should read file content successfully', async () => {
    jest.mocked(mockConnection.readTextFile).mockResolvedValue({
      content: 'Hello, World!',
    });

    const result = await readFile(mockConnection, 'session-123', '/path/to/file.txt');

    expect(mockConnection.readTextFile).toHaveBeenCalledWith({
      sessionId: 'session-123',
      path: '/path/to/file.txt',
      line: undefined,
      limit: undefined,
    });
    expect(result.success).toBe(true);
    expect(result.content).toBe('Hello, World!');
    expect(result.error).toBeUndefined();
  });

  it('should pass line and limit options', async () => {
    jest.mocked(mockConnection.readTextFile).mockResolvedValue({
      content: 'Line content',
    });

    await readFile(mockConnection, 'session-123', '/path/to/file.txt', {
      line: 10,
      limit: 5,
    });

    expect(mockConnection.readTextFile).toHaveBeenCalledWith({
      sessionId: 'session-123',
      path: '/path/to/file.txt',
      line: 10,
      limit: 5,
    });
  });

  it('should handle read errors', async () => {
    jest.mocked(mockConnection.readTextFile).mockRejectedValue(new Error('File not found'));

    const result = await readFile(mockConnection, 'session-123', '/nonexistent.txt');

    expect(result.success).toBe(false);
    expect(result.content).toBe('');
    expect(result.error).toBe('File not found');
  });
});

describe('writeFile', () => {
  let mockConnection: AgentSideConnection;

  beforeEach(() => {
    mockConnection = createMockConnection();
  });

  /**
   * Use connection.writeTextFile() for writes
   */
  it('should write file content successfully', async () => {
    jest.mocked(mockConnection.writeTextFile).mockResolvedValue({});

    const result = await writeFile(
      mockConnection,
      'session-123',
      '/path/to/file.txt',
      'New content',
    );

    expect(mockConnection.writeTextFile).toHaveBeenCalledWith({
      sessionId: 'session-123',
      path: '/path/to/file.txt',
      content: 'New content',
    });
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('should handle write errors', async () => {
    jest.mocked(mockConnection.writeTextFile).mockRejectedValue(new Error('Permission denied'));

    const result = await writeFile(
      mockConnection,
      'session-123',
      '/readonly/file.txt',
      'Content',
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('Permission denied');
  });
});

describe('executeCommand', () => {
  let mockConnection: AgentSideConnection;
  let mockTerminal: TerminalHandle;

  beforeEach(() => {
    mockConnection = createMockConnection();
    mockTerminal = createMockTerminalHandle();
    jest.mocked(mockConnection.createTerminal).mockResolvedValue(mockTerminal);
  });

  it('should execute command and return result', async () => {
    jest.mocked(mockTerminal.waitForExit).mockResolvedValue({
      exitCode: 0,
      signal: null,
    });
    jest.mocked(mockTerminal.currentOutput).mockResolvedValue({
      output: 'Command output',
      truncated: false,
    });

    const result = await executeCommand(mockConnection, 'session-123', 'echo', {
      args: ['hello'],
    });

    expect(mockConnection.createTerminal).toHaveBeenCalledWith({
      sessionId: 'session-123',
      command: 'echo',
      args: ['hello'],
      cwd: undefined,
      env: undefined,
      outputByteLimit: undefined,
    });
    expect(result.success).toBe(true);
    expect(result.output).toBe('Command output');
    expect(result.exitCode).toBe(0);
    expect(result.signal).toBeNull();
    expect(result.truncated).toBe(false);
  });

  it('should handle command failure', async () => {
    jest.mocked(mockTerminal.waitForExit).mockResolvedValue({
      exitCode: 1,
      signal: null,
    });
    jest.mocked(mockTerminal.currentOutput).mockResolvedValue({
      output: 'Error output',
      truncated: false,
    });

    const result = await executeCommand(mockConnection, 'session-123', 'false');

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
  });

  it('should handle command terminated by signal', async () => {
    jest.mocked(mockTerminal.waitForExit).mockResolvedValue({
      exitCode: null,
      signal: 'SIGKILL',
    });
    jest.mocked(mockTerminal.currentOutput).mockResolvedValue({
      output: 'Partial output',
      truncated: false,
    });

    const result = await executeCommand(mockConnection, 'session-123', 'sleep', {
      args: ['100'],
    });

    expect(result.exitCode).toBeNull();
    expect(result.signal).toBe('SIGKILL');
  });

  it('should pass environment variables', async () => {
    jest.mocked(mockTerminal.waitForExit).mockResolvedValue({ exitCode: 0, signal: null });
    jest.mocked(mockTerminal.currentOutput).mockResolvedValue({ output: '', truncated: false });

    await executeCommand(mockConnection, 'session-123', 'env', {
      env: [{ name: 'MY_VAR', value: 'my_value' }],
    });

    expect(mockConnection.createTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        env: [{ name: 'MY_VAR', value: 'my_value' }],
      }),
    );
  });

  it('should pass working directory', async () => {
    jest.mocked(mockTerminal.waitForExit).mockResolvedValue({ exitCode: 0, signal: null });
    jest.mocked(mockTerminal.currentOutput).mockResolvedValue({ output: '', truncated: false });

    await executeCommand(mockConnection, 'session-123', 'pwd', {
      cwd: '/home/user',
    });

    expect(mockConnection.createTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/home/user',
      }),
    );
  });

  it('should handle truncated output', async () => {
    jest.mocked(mockTerminal.waitForExit).mockResolvedValue({ exitCode: 0, signal: null });
    jest.mocked(mockTerminal.currentOutput).mockResolvedValue({
      output: 'Truncated...',
      truncated: true,
    });

    const result = await executeCommand(mockConnection, 'session-123', 'cat', {
      args: ['large-file.txt'],
      outputByteLimit: 1000,
    });

    expect(result.truncated).toBe(true);
  });

  it('should always release terminal', async () => {
    jest.mocked(mockTerminal.waitForExit).mockResolvedValue({ exitCode: 0, signal: null });
    jest.mocked(mockTerminal.currentOutput).mockResolvedValue({ output: '', truncated: false });

    await executeCommand(mockConnection, 'session-123', 'echo');

    expect(mockTerminal.release).toHaveBeenCalled();
  });

  it('should release terminal even on error', async () => {
    jest.mocked(mockTerminal.waitForExit).mockRejectedValue(new Error('Connection lost'));

    await executeCommand(mockConnection, 'session-123', 'echo');

    expect(mockTerminal.release).toHaveBeenCalled();
  });

  it('should handle terminal creation error', async () => {
    jest.mocked(mockConnection.createTerminal).mockRejectedValue(new Error('Terminal not supported'));

    const result = await executeCommand(mockConnection, 'session-123', 'echo');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Terminal not supported');
  });
});

describe('startCommand', () => {
  let mockConnection: AgentSideConnection;
  let mockTerminal: TerminalHandle;

  beforeEach(() => {
    mockConnection = createMockConnection();
    mockTerminal = createMockTerminalHandle();
    jest.mocked(mockConnection.createTerminal).mockResolvedValue(mockTerminal);
  });

  /**
   * Track terminal IDs for cleanup
   */
  it('should start command and return terminal handle', async () => {
    const terminal = await startCommand(mockConnection, 'session-123', 'npm', {
      args: ['run', 'dev'],
    });

    expect(mockConnection.createTerminal).toHaveBeenCalledWith({
      sessionId: 'session-123',
      command: 'npm',
      args: ['run', 'dev'],
      cwd: undefined,
      env: undefined,
      outputByteLimit: undefined,
    });
    expect(terminal).toBe(mockTerminal);
  });

  it('should pass all options to createTerminal', async () => {
    await startCommand(mockConnection, 'session-123', 'node', {
      args: ['server.js'],
      cwd: '/app',
      env: [{ name: 'PORT', value: '3000' }],
      outputByteLimit: 10000,
    });

    expect(mockConnection.createTerminal).toHaveBeenCalledWith({
      sessionId: 'session-123',
      command: 'node',
      args: ['server.js'],
      cwd: '/app',
      env: [{ name: 'PORT', value: '3000' }],
      outputByteLimit: 10000,
    });
  });
});
