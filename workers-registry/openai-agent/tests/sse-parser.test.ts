import { parseLine } from '../src/sse-parser';

describe('parseLine', () => {
  it('extracts JSON from data: line', () => {
    const line = 'data: {"choices":[{"index":0,"delta":{"content":"hello"}}]}';
    const result = parseLine(line);
    expect(result.type).toBe('data');
    if (result.type === 'data') {
      expect(result.payload).toEqual({
        choices: [{ index: 0, delta: { content: 'hello' } }],
      });
    }
  });

  it('returns done for data: [DONE]', () => {
    const result = parseLine('data: [DONE]');
    expect(result).toEqual({ type: 'done' });
  });

  it('returns skip for empty line', () => {
    const result = parseLine('');
    expect(result).toEqual({ type: 'skip' });
  });

  it('returns skip for whitespace-only line', () => {
    const result = parseLine('   ');
    expect(result).toEqual({ type: 'skip' });
  });

  it('returns skip for SSE comment', () => {
    const result = parseLine(':this is a comment');
    expect(result).toEqual({ type: 'skip' });
  });

  it('returns skip and logs to stderr for invalid JSON', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation();
    const result = parseLine('data: {invalid json}');
    expect(result).toEqual({ type: 'skip' });
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to parse SSE JSON'),
      expect.any(String),
    );
    spy.mockRestore();
  });

  it('returns skip for lines without data: prefix', () => {
    const result = parseLine('event: message');
    expect(result).toEqual({ type: 'skip' });
  });

  it('parses chunk with empty delta', () => {
    const line = 'data: {"choices":[{"index":0,"delta":{},"finish_reason":null}]}';
    const result = parseLine(line);
    expect(result.type).toBe('data');
    if (result.type === 'data') {
      const payload = result.payload as { choices: Array<{ delta: Record<string, unknown> }> };
      expect(payload.choices[0].delta.content).toBeUndefined();
    }
  });
});
