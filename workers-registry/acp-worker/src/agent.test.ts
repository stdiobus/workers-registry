/**
 * Unit tests for ACPAgent initialization
 *
 * Tests capability negotiation and protocol version handling.
 *
 * @module agent.test
 */
import { ACPAgent } from './agent.js';
import type {
  AgentSideConnection,
  ClientCapabilities,
  ContentBlock,
  InitializeRequest,
  PromptRequest,
} from '@agentclientprotocol/sdk';
import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk';

/**
 * Create a mock AgentSideConnection for testing.
 * We only need to mock the interface since we're testing the Agent in isolation.
 */
function createMockConnection(): AgentSideConnection {
  return {
    sessionUpdate: jest.fn(),
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

describe('ACPAgent', () => {
  let agent: ACPAgent;
  let mockConnection: AgentSideConnection;

  beforeEach(() => {
    mockConnection = createMockConnection();
    agent = new ACPAgent(mockConnection);
  });

  describe('initialize()', () => {
    it('should return correct agent info with name and version', async () => {
      const request: InitializeRequest = {
        protocolVersion: PROTOCOL_VERSION,
      };

      const response = await agent.initialize(request);

      expect(response.agentInfo).toBeDefined();
      expect(response.agentInfo?.name).toBe('stdio-bus-worker');
      expect(response.agentInfo?.version).toBe('1.0.0');
    });

    it('should return correct capabilities with promptCapabilities.embeddedContext: true', async () => {
      const request: InitializeRequest = {
        protocolVersion: PROTOCOL_VERSION,
      };

      const response = await agent.initialize(request);

      expect(response.agentCapabilities).toBeDefined();
      expect(response.agentCapabilities?.promptCapabilities).toBeDefined();
      expect(response.agentCapabilities?.promptCapabilities?.embeddedContext).toBe(true);
    });

    it('should return empty authMethods array', async () => {
      const request: InitializeRequest = {
        protocolVersion: PROTOCOL_VERSION,
      };

      const response = await agent.initialize(request);

      expect(response.authMethods).toBeDefined();
      expect(response.authMethods).toEqual([]);
    });

    it('should return correct protocol version', async () => {
      const request: InitializeRequest = {
        protocolVersion: PROTOCOL_VERSION,
      };

      const response = await agent.initialize(request);

      expect(response.protocolVersion).toBe(PROTOCOL_VERSION);
    });

    it('should store client capabilities for later access', async () => {
      const clientCapabilities: ClientCapabilities = {
        fs: {
          readTextFile: true,
          writeTextFile: true,
        },
        terminal: true,
      };

      const request: InitializeRequest = {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities,
      };

      await agent.initialize(request);

      expect(agent.clientCapabilities).toEqual(clientCapabilities);
    });

    it('should store null when clientCapabilities is not provided', async () => {
      const request: InitializeRequest = {
        protocolVersion: PROTOCOL_VERSION,
      };

      await agent.initialize(request);

      expect(agent.clientCapabilities).toBeNull();
    });
  });

  describe('clientCapabilities getter', () => {
    it('should return null before initialize() is called', () => {
      expect(agent.clientCapabilities).toBeNull();
    });

    it('should return stored capabilities after initialize() is called', async () => {
      const clientCapabilities: ClientCapabilities = {
        fs: {
          readTextFile: true,
        },
      };

      const request: InitializeRequest = {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities,
      };

      await agent.initialize(request);

      expect(agent.clientCapabilities).toEqual(clientCapabilities);
    });
  });

  describe('connection getter', () => {
    it('should return the connection passed to constructor', () => {
      expect(agent.connection).toBe(mockConnection);
    });
  });

  describe('sessionManager getter', () => {
    it('should return a SessionManager instance', () => {
      expect(agent.sessionManager).toBeDefined();
    });
  });
});


describe('prompt()', () => {
  let agent: ACPAgent;
  let mockConnection: AgentSideConnection;
  let sessionId: string;

  beforeEach(async () => {
    mockConnection = createMockConnection();
    agent = new ACPAgent(mockConnection);

    // Create a session for testing
    const response = await agent.newSession({ cwd: '/test', mcpServers: [] });
    sessionId = response.sessionId;
  });

  /**
   * Parse ContentBlock[] from request
   */
  it('should process text content blocks and send agent_message_chunk', async () => {
    const request: PromptRequest = {
      sessionId,
      prompt: [
        { type: 'text', text: 'Hello, world!' } as ContentBlock,
      ],
    };

    const response = await agent.prompt(request);

    expect(response.stopReason).toBe('end_turn');
    expect(mockConnection.sessionUpdate).toHaveBeenCalledWith({
      sessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: {
          type: 'text',
          text: 'Hello, world!',
        },
      },
    });
  });

  /**
   * Echo mode for testing
   */
  it('should echo multiple text blocks', async () => {
    const request: PromptRequest = {
      sessionId,
      prompt: [
        { type: 'text', text: 'First message' } as ContentBlock,
        { type: 'text', text: 'Second message' } as ContentBlock,
      ],
    };

    const response = await agent.prompt(request);

    expect(response.stopReason).toBe('end_turn');
    expect(mockConnection.sessionUpdate).toHaveBeenCalledTimes(2);
  });

  /**
   * Return PromptResponse with stopReason
   */
  it('should return end_turn stopReason on successful completion', async () => {
    const request: PromptRequest = {
      sessionId,
      prompt: [
        { type: 'text', text: 'Test' } as ContentBlock,
      ],
    };

    const response = await agent.prompt(request);

    expect(response.stopReason).toBe('end_turn');
  });

  it('should throw error for unknown session', async () => {
    const request: PromptRequest = {
      sessionId: 'unknown-session-id',
      prompt: [
        { type: 'text', text: 'Test' } as ContentBlock,
      ],
    };

    await expect(agent.prompt(request)).rejects.toThrow('Session not found');
  });

  it('should return cancelled stopReason when session is cancelled before processing', async () => {
    // Cancel the session
    agent.cancel({ sessionId });

    const request: PromptRequest = {
      sessionId,
      prompt: [
        { type: 'text', text: 'Test' } as ContentBlock,
      ],
    };

    const response = await agent.prompt(request);

    expect(response.stopReason).toBe('cancelled');
    expect(mockConnection.sessionUpdate).not.toHaveBeenCalled();
  });

  it('should handle image content blocks', async () => {
    const request: PromptRequest = {
      sessionId,
      prompt: [
        { type: 'image', data: 'base64data', mimeType: 'image/png' } as ContentBlock,
      ],
    };

    const response = await agent.prompt(request);

    expect(response.stopReason).toBe('end_turn');
    expect(mockConnection.sessionUpdate).toHaveBeenCalledWith({
      sessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: {
          type: 'text',
          text: '[Image: image/png]',
        },
      },
    });
  });

  it('should handle embedded resource content blocks with text', async () => {
    const request: PromptRequest = {
      sessionId,
      prompt: [
        {
          type: 'resource',
          resource: {
            uri: 'file:///test.txt',
            text: 'File content here',
          },
        } as ContentBlock,
      ],
    };

    const response = await agent.prompt(request);

    expect(response.stopReason).toBe('end_turn');
    expect(mockConnection.sessionUpdate).toHaveBeenCalledWith({
      sessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: {
          type: 'text',
          text: '[Embedded resource: file:///test.txt]\nFile content here',
        },
      },
    });
  });

  it('should handle embedded resource content blocks with blob', async () => {
    const request: PromptRequest = {
      sessionId,
      prompt: [
        {
          type: 'resource',
          resource: {
            uri: 'file:///image.png',
            blob: 'base64blobdata',
          },
        } as ContentBlock,
      ],
    };

    const response = await agent.prompt(request);

    expect(response.stopReason).toBe('end_turn');
    expect(mockConnection.sessionUpdate).toHaveBeenCalledWith({
      sessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: {
          type: 'text',
          text: '[Embedded resource: file:///image.png] (binary data)',
        },
      },
    });
  });

  it('should handle resource_link content blocks when resource not found', async () => {
    const request: PromptRequest = {
      sessionId,
      prompt: [
        {
          type: 'resource_link',
          uri: 'file:///nonexistent.txt',
          name: 'nonexistent.txt',
        } as ContentBlock,
      ],
    };

    const response = await agent.prompt(request);

    expect(response.stopReason).toBe('end_turn');
    // Should echo the link info since resource resolution fails
    expect(mockConnection.sessionUpdate).toHaveBeenCalledWith({
      sessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: {
          type: 'text',
          text: '[Resource link: nonexistent.txt (file:///nonexistent.txt)]',
        },
      },
    });
  });

  it('should handle empty prompt array', async () => {
    const request: PromptRequest = {
      sessionId,
      prompt: [],
    };

    const response = await agent.prompt(request);

    expect(response.stopReason).toBe('end_turn');
    expect(mockConnection.sessionUpdate).not.toHaveBeenCalled();
  });
});
