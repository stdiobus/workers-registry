import { loadConfig } from '../src/config';

describe('loadConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.OPENAI_BASE_URL;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_MODEL;
    delete process.env.OPENAI_SYSTEM_PROMPT;
    delete process.env.OPENAI_MAX_TOKENS;
    delete process.env.OPENAI_TEMPERATURE;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('returns default values when env vars are unset', () => {
    const config = loadConfig();
    expect(config.baseUrl).toBe('https://api.openai.com/v1');
    expect(config.apiKey).toBe('');
    expect(config.model).toBe('gpt-4o');
    expect(config.systemPrompt).toBeUndefined();
    expect(config.maxTokens).toBeUndefined();
    expect(config.temperature).toBeUndefined();
  });

  it('reads OPENAI_BASE_URL from env', () => {
    process.env.OPENAI_BASE_URL = 'http://localhost:11434/v1';
    process.env.OPENAI_API_KEY = 'key';
    const config = loadConfig();
    expect(config.baseUrl).toBe('http://localhost:11434/v1');
  });

  it('reads OPENAI_API_KEY from env', () => {
    process.env.OPENAI_API_KEY = 'sk-test-key-123';
    const config = loadConfig();
    expect(config.apiKey).toBe('sk-test-key-123');
  });

  it('reads OPENAI_MODEL from env', () => {
    process.env.OPENAI_API_KEY = 'key';
    process.env.OPENAI_MODEL = 'gpt-3.5-turbo';
    const config = loadConfig();
    expect(config.model).toBe('gpt-3.5-turbo');
  });

  it('reads OPENAI_SYSTEM_PROMPT from env', () => {
    process.env.OPENAI_API_KEY = 'key';
    process.env.OPENAI_SYSTEM_PROMPT = 'You are a helpful assistant.';
    const config = loadConfig();
    expect(config.systemPrompt).toBe('You are a helpful assistant.');
  });

  it('parses OPENAI_MAX_TOKENS as integer', () => {
    process.env.OPENAI_API_KEY = 'key';
    process.env.OPENAI_MAX_TOKENS = '4096';
    const config = loadConfig();
    expect(config.maxTokens).toBe(4096);
  });

  it('parses OPENAI_TEMPERATURE as float', () => {
    process.env.OPENAI_API_KEY = 'key';
    process.env.OPENAI_TEMPERATURE = '0.7';
    const config = loadConfig();
    expect(config.temperature).toBe(0.7);
  });

  it('ignores invalid OPENAI_MAX_TOKENS', () => {
    process.env.OPENAI_API_KEY = 'key';
    process.env.OPENAI_MAX_TOKENS = 'not-a-number';
    const config = loadConfig();
    expect(config.maxTokens).toBeUndefined();
  });

  it('ignores invalid OPENAI_TEMPERATURE', () => {
    process.env.OPENAI_API_KEY = 'key';
    process.env.OPENAI_TEMPERATURE = 'abc';
    const config = loadConfig();
    expect(config.temperature).toBeUndefined();
  });

  it('logs warning when OPENAI_API_KEY is missing', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation();
    loadConfig();
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('OPENAI_API_KEY is not set'),
    );
    spy.mockRestore();
  });

  it('does not log warning when OPENAI_API_KEY is set', () => {
    process.env.OPENAI_API_KEY = 'sk-key';
    const spy = jest.spyOn(console, 'error').mockImplementation();
    loadConfig();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
