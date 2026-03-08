import { OpenAIAgent, convertContentBlocks, buildMessages } from '../src/agent';

// Mock loadConfig to avoid env var side effects
jest.mock('../src/config', () => ({
  loadConfig: () => ({
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'test-key',
    model: 'gpt-4o',
  }),
}));

const mockConnection = {
  sessionUpdate: jest.fn().mockResolvedValue(undefined),
  closed: new Promise(() => { }),
} as any;

describe('OpenAIAgent', () => {
  let agent: OpenAIAgent;

  beforeEach(() => {
    agent = new OpenAIAgent(mockConnection);
  });

  describe('initialize', () => {
    it('returns correct name, version, and capabilities', async () => {
      const result = await agent.initialize({} as any);
      expect(result.agentInfo).toBeDefined();
      expect(result.agentInfo!.name).toBe('openai-agent');
      expect(result.agentInfo!.version).toBe('1.0.0');
      expect(result.protocolVersion).toBeDefined();
      expect(result.agentCapabilities).toBeDefined();
    });
  });

  describe('newSession', () => {
    it('creates session and returns sessionId', async () => {
      const result = await agent.newSession({ cwd: '/test' } as any);
      expect(result.sessionId).toBeDefined();
      expect(typeof result.sessionId).toBe('string');
      expect(result.sessionId.length).toBeGreaterThan(0);
    });

    it('returns unique sessionIds', async () => {
      const r1 = await agent.newSession({ cwd: '/a' } as any);
      const r2 = await agent.newSession({ cwd: '/b' } as any);
      expect(r1.sessionId).not.toBe(r2.sessionId);
    });
  });

  describe('loadSession', () => {
    it('throws error (not supported)', async () => {
      await expect(agent.loadSession({} as any)).rejects.toThrow(
        'Session loading is not supported',
      );
    });
  });

  describe('authenticate', () => {
    it('returns void', async () => {
      const result = await agent.authenticate({} as any);
      expect(result).toBeUndefined();
    });
  });

  describe('prompt', () => {
    it('throws error for non-existent sessionId', async () => {
      await expect(
        agent.prompt({
          sessionId: 'nonexistent-id',
          prompt: [],
        } as any),
      ).rejects.toThrow('Session not found: nonexistent-id');
    });
  });
});

describe('convertContentBlocks', () => {
  it('converts text blocks', () => {
    const result = convertContentBlocks([
      { type: 'text', text: 'Hello world' },
    ] as any);
    expect(result).toBe('Hello world');
  });

  it('converts resource_link blocks', () => {
    const result = convertContentBlocks([
      { type: 'resource_link', name: 'file.ts', uri: 'file:///file.ts' },
    ] as any);
    expect(result).toBe('[Resource: file.ts] file:///file.ts');
  });

  it('converts resource blocks', () => {
    const result = convertContentBlocks([
      { type: 'resource', resource: { uri: 'file:///f.ts', text: 'content' } },
    ] as any);
    expect(result).toBe('[Resource: file:///f.ts]\ncontent');
  });

  it('converts image blocks', () => {
    const result = convertContentBlocks([
      { type: 'image', mimeType: 'image/png', data: '' },
    ] as any);
    expect(result).toBe('[Image: image/png]');
  });

  it('concatenates multiple blocks with newlines', () => {
    const result = convertContentBlocks([
      { type: 'text', text: 'line1' },
      { type: 'text', text: 'line2' },
    ] as any);
    expect(result).toBe('line1\nline2');
  });
});

describe('buildMessages', () => {
  it('builds messages without system prompt', () => {
    const messages = buildMessages(undefined, [], 'hello');
    expect(messages).toEqual([
      { role: 'user', content: 'hello' },
    ]);
  });

  it('prepends system prompt when provided', () => {
    const messages = buildMessages('You are helpful', [], 'hello');
    expect(messages).toEqual([
      { role: 'system', content: 'You are helpful' },
      { role: 'user', content: 'hello' },
    ]);
  });

  it('includes history in order', () => {
    const history = [
      { role: 'user' as const, content: 'q1' },
      { role: 'assistant' as const, content: 'a1' },
    ];
    const messages = buildMessages(undefined, history, 'q2');
    expect(messages).toEqual([
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'q2' },
    ]);
  });
});
