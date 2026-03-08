import { AgentConfig, ChatCompletionResult, ChatCompletionsRequest, OpenAIMessage, SSEChunk } from './types.js';
import { parseLine } from './sse-parser.js';

export function classifyHttpError(status: number, url: string): string {
  if (status === 401 || status === 403) {
    return `Authentication error (HTTP ${status}) calling ${url}. Check your OPENAI_API_KEY.`;
  }
  if (status === 429) {
    return `Rate limit exceeded (HTTP 429) calling ${url}. Please retry later.`;
  }
  if (status >= 500) {
    return `Server error (HTTP ${status}) from ${url}.`;
  }
  return `HTTP error (${status}) from ${url}.`;
}

export class ChatCompletionsClient {
  private readonly config: AgentConfig;

  constructor(config: AgentConfig) {
    this.config = config;
  }

  async streamCompletion(
    messages: OpenAIMessage[],
    signal: AbortSignal,
    onChunk: (text: string) => Promise<void>,
  ): Promise<ChatCompletionResult> {
    const url = `${this.config.baseUrl}/chat/completions`;
    const body: ChatCompletionsRequest = {
      model: this.config.model,
      messages,
      stream: true,
    };
    if (this.config.maxTokens !== undefined) {
      body.max_tokens = this.config.maxTokens;
    }
    if (this.config.temperature !== undefined) {
      body.temperature = this.config.temperature;
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        return { stopReason: 'cancelled', fullResponse: '' };
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Network error connecting to ${url}: ${message}`);
    }

    if (!response.ok) {
      throw new Error(classifyHttpError(response.status, url));
    }

    if (!response.body) {
      throw new Error(`No response body from ${url}.`);
    }

    let fullResponse = '';
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        // Keep the last potentially incomplete line in the buffer
        buffer = lines.pop() || '';

        for (const line of lines) {
          const event = parseLine(line);
          if (event.type === 'done') {
            return { stopReason: 'end_turn', fullResponse };
          }
          if (event.type === 'data') {
            const chunk = event.payload as SSEChunk;
            const content = chunk.choices?.[0]?.delta?.content;
            if (content) {
              fullResponse += content;
              await onChunk(content);
            }
          }
        }
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        return { stopReason: 'cancelled', fullResponse };
      }
      throw error;
    }

    return { stopReason: 'end_turn', fullResponse };
  }
}
