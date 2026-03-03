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
 * Unit tests for the ACPConnection class.
 *
 * Tests TCP connection handling, NDJSON streaming, message parsing,
 * and connection lifecycle management.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import net from 'net';
import { ACPConnection } from '../../src/mcp-proxy/connection.js';
import { ProxyConfig, ACPRequest, ACPResponse, ACPNotification } from '../../src/mcp-proxy/types.js';

// Mock the net module
jest.mock('net');

describe('ACPConnection', () => {
  let mockSocket: any;
  let config: ProxyConfig;
  let onMessageMock: jest.Mock<(msg: ACPResponse | ACPNotification) => void>;
  let onErrorMock: jest.Mock<(err: Error) => void>;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Create mock socket with event emitter behavior
    mockSocket = {
      on: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
    };

    // Mock net.connect to return our mock socket
    (net.connect as jest.Mock).mockReturnValue(mockSocket);

    // Setup test configuration
    config = {
      acpHost: '127.0.0.1',
      acpPort: 9011,
      agentId: 'test-agent'
    };

    // Setup callback mocks
    onMessageMock = jest.fn();
    onErrorMock = jest.fn();
  });

  describe('constructor and connection establishment', () => {
    // Sub-task 9.2: Test connection establishes to correct host and port
    it('should connect to correct host and port', () => {
      new ACPConnection(config, onMessageMock, onErrorMock);

      expect(net.connect).toHaveBeenCalledWith(9011, '127.0.0.1');
    });

    it('should connect to custom host and port', () => {
      const customConfig: ProxyConfig = {
        acpHost: '192.168.1.100',
        acpPort: 8080,
        agentId: 'test-agent'
      };

      new ACPConnection(customConfig, onMessageMock, onErrorMock);

      expect(net.connect).toHaveBeenCalledWith(8080, '192.168.1.100');
    });

    it('should setup event handlers on socket', () => {
      new ACPConnection(config, onMessageMock, onErrorMock);

      expect(mockSocket.on).toHaveBeenCalledWith('connect', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('data', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('close', expect.any(Function));
    });
  });

  describe('connection event handling', () => {
    // Sub-task 9.3: Test connection logs on successful connect
    it('should log on successful connect', () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

      new ACPConnection(config, onMessageMock, onErrorMock);

      // Get the connect handler and call it
      const connectHandler = mockSocket.on.mock.calls.find(
        (call: any[]) => call[0] === 'connect'
      )?.[1];
      connectHandler();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Connected to ACP stdio Bus at 127.0.0.1:9011')
      );

      consoleErrorSpy.mockRestore();
    });

    it('should set connected state on connect', () => {
      const connection = new ACPConnection(config, onMessageMock, onErrorMock);

      // Initially not connected
      expect(connection.isConnected()).toBe(false);

      // Trigger connect event
      const connectHandler = mockSocket.on.mock.calls.find(
        (call: any[]) => call[0] === 'connect'
      )?.[1];
      connectHandler();

      // Now connected
      expect(connection.isConnected()).toBe(true);
    });

    // Sub-task 9.4: Test connection error triggers error callback
    it('should trigger error callback on connection error', () => {
      new ACPConnection(config, onMessageMock, onErrorMock);

      const testError = new Error('Connection refused');

      // Get the error handler and call it
      const errorHandler = mockSocket.on.mock.calls.find(
        (call: any[]) => call[0] === 'error'
      )?.[1];
      errorHandler(testError);

      expect(onErrorMock).toHaveBeenCalledWith(testError);
    });

    it('should log connection error', () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

      new ACPConnection(config, onMessageMock, onErrorMock);

      const testError = new Error('Connection timeout');

      // Trigger error event
      const errorHandler = mockSocket.on.mock.calls.find(
        (call: any[]) => call[0] === 'error'
      )?.[1];
      errorHandler(testError);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('ACP connection error: Connection timeout')
      );

      consoleErrorSpy.mockRestore();
    });

    it('should set connected state to false on close', () => {
      const connection = new ACPConnection(config, onMessageMock, onErrorMock);

      // Simulate connect then close
      const connectHandler = mockSocket.on.mock.calls.find(
        (call: any[]) => call[0] === 'connect'
      )?.[1];
      connectHandler();

      expect(connection.isConnected()).toBe(true);

      // Trigger close event
      const closeHandler = mockSocket.on.mock.calls.find(
        (call: any[]) => call[0] === 'close'
      )?.[1];
      closeHandler();

      expect(connection.isConnected()).toBe(false);
    });

    it('should log on connection close', () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

      new ACPConnection(config, onMessageMock, onErrorMock);

      // Trigger close event
      const closeHandler = mockSocket.on.mock.calls.find(
        (call: any[]) => call[0] === 'close'
      )?.[1];
      closeHandler();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('ACP connection closed')
      );

      consoleErrorSpy.mockRestore();
    });

    it('should handle error during active connection', () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

      const connection = new ACPConnection(config, onMessageMock, onErrorMock);

      // Connect
      const connectHandler = mockSocket.on.mock.calls.find(
        (call: any[]) => call[0] === 'connect'
      )?.[1];
      connectHandler();

      expect(connection.isConnected()).toBe(true);

      // Error occurs
      const errorHandler = mockSocket.on.mock.calls.find(
        (call: any[]) => call[0] === 'error'
      )?.[1];
      const testError = new Error('Network error');
      errorHandler(testError);

      expect(onErrorMock).toHaveBeenCalledWith(testError);

      consoleErrorSpy.mockRestore();
    });
  });

  describe('NDJSON parsing with complete lines', () => {
    // Sub-task 9.5: Test NDJSON parsing with complete lines
    it('should parse single complete NDJSON line', () => {
      new ACPConnection(config, onMessageMock, onErrorMock);

      const message: ACPResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: { test: 'data' }
      };

      // Get the data handler
      const dataHandler = mockSocket.on.mock.calls.find(
        (call: any[]) => call[0] === 'data'
      )?.[1];

      // Send complete NDJSON line
      dataHandler(Buffer.from(JSON.stringify(message) + '\n'));

      expect(onMessageMock).toHaveBeenCalledWith(message);
      expect(onMessageMock).toHaveBeenCalledTimes(1);
    });

    it('should parse multiple complete NDJSON lines in one chunk', () => {
      new ACPConnection(config, onMessageMock, onErrorMock);

      const message1: ACPResponse = { jsonrpc: '2.0', id: 1, result: {} };
      const message2: ACPResponse = { jsonrpc: '2.0', id: 2, result: {} };
      const message3: ACPResponse = { jsonrpc: '2.0', id: 3, result: {} };

      const dataHandler = mockSocket.on.mock.calls.find(
        (call: any[]) => call[0] === 'data'
      )?.[1];

      // Send multiple lines in one chunk
      const chunk = JSON.stringify(message1) + '\n' +
        JSON.stringify(message2) + '\n' +
        JSON.stringify(message3) + '\n';
      dataHandler(Buffer.from(chunk));

      expect(onMessageMock).toHaveBeenCalledTimes(3);
      expect(onMessageMock).toHaveBeenNthCalledWith(1, message1);
      expect(onMessageMock).toHaveBeenNthCalledWith(2, message2);
      expect(onMessageMock).toHaveBeenNthCalledWith(3, message3);
    });

    it('should ignore empty lines', () => {
      new ACPConnection(config, onMessageMock, onErrorMock);

      const message: ACPResponse = { jsonrpc: '2.0', id: 1, result: {} };

      const dataHandler = mockSocket.on.mock.calls.find(
        (call: any[]) => call[0] === 'data'
      )?.[1];

      // Send lines with empty lines interspersed
      const chunk = '\n' + JSON.stringify(message) + '\n\n';
      dataHandler(Buffer.from(chunk));

      expect(onMessageMock).toHaveBeenCalledTimes(1);
      expect(onMessageMock).toHaveBeenCalledWith(message);
    });

    it('should ignore whitespace-only lines', () => {
      new ACPConnection(config, onMessageMock, onErrorMock);

      const message: ACPResponse = { jsonrpc: '2.0', id: 1, result: {} };

      const dataHandler = mockSocket.on.mock.calls.find(
        (call: any[]) => call[0] === 'data'
      )?.[1];

      // Send lines with whitespace-only lines
      const chunk = '   \n' + JSON.stringify(message) + '\n\t\n';
      dataHandler(Buffer.from(chunk));

      expect(onMessageMock).toHaveBeenCalledTimes(1);
      expect(onMessageMock).toHaveBeenCalledWith(message);
    });

    it('should log received messages', () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

      new ACPConnection(config, onMessageMock, onErrorMock);

      const message: ACPResponse = { jsonrpc: '2.0', id: 1, result: {} };

      const dataHandler = mockSocket.on.mock.calls.find(
        (call: any[]) => call[0] === 'data'
      )?.[1];

      dataHandler(Buffer.from(JSON.stringify(message) + '\n'));

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('← ACP:')
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe('NDJSON buffering with partial lines', () => {
    // Sub-task 9.6: Test NDJSON buffering with partial lines
    it('should buffer partial line until newline arrives', () => {
      new ACPConnection(config, onMessageMock, onErrorMock);

      const message: ACPResponse = { jsonrpc: '2.0', id: 1, result: { test: 'data' } };
      const fullLine = JSON.stringify(message);

      const dataHandler = mockSocket.on.mock.calls.find(
        (call: any[]) => call[0] === 'data'
      )?.[1];

      // Send first half
      dataHandler(Buffer.from(fullLine.slice(0, 20)));
      expect(onMessageMock).not.toHaveBeenCalled();

      // Send second half with newline
      dataHandler(Buffer.from(fullLine.slice(20) + '\n'));
      expect(onMessageMock).toHaveBeenCalledWith(message);
      expect(onMessageMock).toHaveBeenCalledTimes(1);
    });

    it('should handle multiple partial chunks', () => {
      new ACPConnection(config, onMessageMock, onErrorMock);

      const message: ACPResponse = { jsonrpc: '2.0', id: 1, result: { test: 'data' } };
      const fullLine = JSON.stringify(message);

      const dataHandler = mockSocket.on.mock.calls.find(
        (call: any[]) => call[0] === 'data'
      )?.[1];

      // Send in 4 chunks
      const chunkSize = Math.floor(fullLine.length / 4);
      dataHandler(Buffer.from(fullLine.slice(0, chunkSize)));
      dataHandler(Buffer.from(fullLine.slice(chunkSize, chunkSize * 2)));
      dataHandler(Buffer.from(fullLine.slice(chunkSize * 2, chunkSize * 3)));
      expect(onMessageMock).not.toHaveBeenCalled();

      // Final chunk with newline
      dataHandler(Buffer.from(fullLine.slice(chunkSize * 3) + '\n'));
      expect(onMessageMock).toHaveBeenCalledWith(message);
      expect(onMessageMock).toHaveBeenCalledTimes(1);
    });

    it('should handle partial line followed by complete line', () => {
      new ACPConnection(config, onMessageMock, onErrorMock);

      const message1: ACPResponse = { jsonrpc: '2.0', id: 1, result: {} };
      const message2: ACPResponse = { jsonrpc: '2.0', id: 2, result: {} };

      const dataHandler = mockSocket.on.mock.calls.find(
        (call: any[]) => call[0] === 'data'
      )?.[1];

      // Send partial first message
      const line1 = JSON.stringify(message1);
      dataHandler(Buffer.from(line1.slice(0, 15)));
      expect(onMessageMock).not.toHaveBeenCalled();

      // Send rest of first message + complete second message
      const chunk2 = line1.slice(15) + '\n' + JSON.stringify(message2) + '\n';
      dataHandler(Buffer.from(chunk2));

      expect(onMessageMock).toHaveBeenCalledTimes(2);
      expect(onMessageMock).toHaveBeenNthCalledWith(1, message1);
      expect(onMessageMock).toHaveBeenNthCalledWith(2, message2);
    });

    it('should handle complete line followed by partial line', () => {
      new ACPConnection(config, onMessageMock, onErrorMock);

      const message1: ACPResponse = { jsonrpc: '2.0', id: 1, result: {} };
      const message2: ACPResponse = { jsonrpc: '2.0', id: 2, result: {} };

      const dataHandler = mockSocket.on.mock.calls.find(
        (call: any[]) => call[0] === 'data'
      )?.[1];

      // Send complete first message + partial second message
      const line2 = JSON.stringify(message2);
      const chunk1 = JSON.stringify(message1) + '\n' + line2.slice(0, 10);
      dataHandler(Buffer.from(chunk1));

      expect(onMessageMock).toHaveBeenCalledTimes(1);
      expect(onMessageMock).toHaveBeenCalledWith(message1);

      // Send rest of second message
      dataHandler(Buffer.from(line2.slice(10) + '\n'));

      expect(onMessageMock).toHaveBeenCalledTimes(2);
      expect(onMessageMock).toHaveBeenNthCalledWith(2, message2);
    });

    it('should preserve buffer across multiple data events', () => {
      new ACPConnection(config, onMessageMock, onErrorMock);

      const message: ACPResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: { longData: 'x'.repeat(1000) }
      };
      const fullLine = JSON.stringify(message);

      const dataHandler = mockSocket.on.mock.calls.find(
        (call: any[]) => call[0] === 'data'
      )?.[1];

      // Send one character at a time (extreme case)
      for (let i = 0; i < fullLine.length; i++) {
        dataHandler(Buffer.from(fullLine[i]));
        expect(onMessageMock).not.toHaveBeenCalled();
      }

      // Send newline
      dataHandler(Buffer.from('\n'));
      expect(onMessageMock).toHaveBeenCalledWith(message);
      expect(onMessageMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('JSON parsing error handling', () => {
    it('should log error for invalid JSON', () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

      new ACPConnection(config, onMessageMock, onErrorMock);

      const dataHandler = mockSocket.on.mock.calls.find(
        (call: any[]) => call[0] === 'data'
      )?.[1];

      // Send invalid JSON
      dataHandler(Buffer.from('{ invalid json }\n'));

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error parsing ACP message')
      );
      expect(onMessageMock).not.toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });

    it('should continue processing after JSON error', () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

      new ACPConnection(config, onMessageMock, onErrorMock);

      const validMessage: ACPResponse = { jsonrpc: '2.0', id: 1, result: {} };

      const dataHandler = mockSocket.on.mock.calls.find(
        (call: any[]) => call[0] === 'data'
      )?.[1];

      // Send invalid JSON followed by valid JSON
      const chunk = '{ invalid }\n' + JSON.stringify(validMessage) + '\n';
      dataHandler(Buffer.from(chunk));

      expect(onMessageMock).toHaveBeenCalledWith(validMessage);
      expect(onMessageMock).toHaveBeenCalledTimes(1);

      consoleErrorSpy.mockRestore();
    });
  });

  describe('send() method', () => {
    // Sub-task 9.7: Test send() writes NDJSON format
    it('should write NDJSON format', () => {
      const connection = new ACPConnection(config, onMessageMock, onErrorMock);

      // Simulate connection
      const connectHandler = mockSocket.on.mock.calls.find(
        (call: any[]) => call[0] === 'connect'
      )?.[1];
      connectHandler();

      const request: ACPRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        agentId: 'test-agent',
        sessionId: 'session-123',
        params: {}
      };

      connection.send(request);

      expect(mockSocket.write).toHaveBeenCalledWith(
        JSON.stringify(request) + '\n'
      );
    });

    it('should log sent messages', () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

      const connection = new ACPConnection(config, onMessageMock, onErrorMock);

      // Simulate connection
      const connectHandler = mockSocket.on.mock.calls.find(
        (call: any[]) => call[0] === 'connect'
      )?.[1];
      connectHandler();

      const request: ACPRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        agentId: 'test-agent',
        sessionId: 'session-123'
      };

      connection.send(request);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('→ ACP:')
      );

      consoleErrorSpy.mockRestore();
    });

    it('should not send when not connected', () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

      const connection = new ACPConnection(config, onMessageMock, onErrorMock);

      // Don't trigger connect event
      const request: ACPRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        agentId: 'test-agent',
        sessionId: 'session-123'
      };

      connection.send(request);

      expect(mockSocket.write).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Cannot send: not connected')
      );

      consoleErrorSpy.mockRestore();
    });

    it('should handle requests with complex params', () => {
      const connection = new ACPConnection(config, onMessageMock, onErrorMock);

      // Simulate connection
      const connectHandler = mockSocket.on.mock.calls.find(
        (call: any[]) => call[0] === 'connect'
      )?.[1];
      connectHandler();

      const request: ACPRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'session/prompt',
        agentId: 'test-agent',
        sessionId: 'session-123',
        params: {
          sessionId: 'acp-session-456',
          prompt: [
            { type: 'text', text: 'Hello world' },
            { type: 'image', data: 'base64data' }
          ]
        }
      };

      connection.send(request);

      expect(mockSocket.write).toHaveBeenCalledWith(
        JSON.stringify(request) + '\n'
      );
    });
  });

  describe('close() method', () => {
    // Sub-task 9.8: Test close() ends socket gracefully
    it('should end socket gracefully', () => {
      const connection = new ACPConnection(config, onMessageMock, onErrorMock);

      connection.close();

      expect(mockSocket.end).toHaveBeenCalled();
    });

    it('should be callable multiple times', () => {
      const connection = new ACPConnection(config, onMessageMock, onErrorMock);

      connection.close();
      connection.close();
      connection.close();

      expect(mockSocket.end).toHaveBeenCalledTimes(3);
    });
  });

  describe('isConnected() method', () => {
    // Sub-task 9.9: Test isConnected() reflects connection state
    it('should return false initially', () => {
      const connection = new ACPConnection(config, onMessageMock, onErrorMock);

      expect(connection.isConnected()).toBe(false);
    });

    it('should return true after connect event', () => {
      const connection = new ACPConnection(config, onMessageMock, onErrorMock);

      const connectHandler = mockSocket.on.mock.calls.find(
        (call: any[]) => call[0] === 'connect'
      )?.[1];
      connectHandler();

      expect(connection.isConnected()).toBe(true);
    });

    it('should return false after close event', () => {
      const connection = new ACPConnection(config, onMessageMock, onErrorMock);

      // Connect then close
      const connectHandler = mockSocket.on.mock.calls.find(
        (call: any[]) => call[0] === 'connect'
      )?.[1];
      connectHandler();

      const closeHandler = mockSocket.on.mock.calls.find(
        (call: any[]) => call[0] === 'close'
      )?.[1];
      closeHandler();

      expect(connection.isConnected()).toBe(false);
    });

    it('should reflect connection state accurately through lifecycle', () => {
      const connection = new ACPConnection(config, onMessageMock, onErrorMock);

      // Initial state
      expect(connection.isConnected()).toBe(false);

      // After connect
      const connectHandler = mockSocket.on.mock.calls.find(
        (call: any[]) => call[0] === 'connect'
      )?.[1];
      connectHandler();
      expect(connection.isConnected()).toBe(true);

      // After close
      const closeHandler = mockSocket.on.mock.calls.find(
        (call: any[]) => call[0] === 'close'
      )?.[1];
      closeHandler();
      expect(connection.isConnected()).toBe(false);
    });
  });

  describe('integration scenarios', () => {
    it('should handle complete request-response cycle', () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

      const connection = new ACPConnection(config, onMessageMock, onErrorMock);

      // Connect
      const connectHandler = mockSocket.on.mock.calls.find(
        (call: any[]) => call[0] === 'connect'
      )?.[1];
      connectHandler();

      // Send request
      const request: ACPRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        agentId: 'test-agent',
        sessionId: 'session-123'
      };
      connection.send(request);

      // Receive response
      const response: ACPResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: { agentInfo: { name: 'Test Agent' } }
      };

      const dataHandler = mockSocket.on.mock.calls.find(
        (call: any[]) => call[0] === 'data'
      )?.[1];
      dataHandler(Buffer.from(JSON.stringify(response) + '\n'));

      expect(mockSocket.write).toHaveBeenCalledWith(JSON.stringify(request) + '\n');
      expect(onMessageMock).toHaveBeenCalledWith(response);

      consoleErrorSpy.mockRestore();
    });

    it('should handle streaming response with multiple chunks', () => {
      new ACPConnection(config, onMessageMock, onErrorMock);

      const dataHandler = mockSocket.on.mock.calls.find(
        (call: any[]) => call[0] === 'data'
      )?.[1];

      // Receive multiple notifications
      const notification1: ACPNotification = {
        jsonrpc: '2.0',
        method: 'session/update',
        params: { update: { sessionUpdate: 'agent_message_chunk', content: { text: 'Hello ' } } }
      };

      const notification2: ACPNotification = {
        jsonrpc: '2.0',
        method: 'session/update',
        params: { update: { sessionUpdate: 'agent_message_chunk', content: { text: 'world' } } }
      };

      const response: ACPResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: {}
      };

      // Send all messages in one chunk
      const chunk = JSON.stringify(notification1) + '\n' +
        JSON.stringify(notification2) + '\n' +
        JSON.stringify(response) + '\n';
      dataHandler(Buffer.from(chunk));

      expect(onMessageMock).toHaveBeenCalledTimes(3);
      expect(onMessageMock).toHaveBeenNthCalledWith(1, notification1);
      expect(onMessageMock).toHaveBeenNthCalledWith(2, notification2);
      expect(onMessageMock).toHaveBeenNthCalledWith(3, response);
    });
  });
});
