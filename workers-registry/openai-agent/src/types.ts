export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionsRequest {
  model: string;
  messages: OpenAIMessage[];
  stream: true;
  max_tokens?: number;
  temperature?: number;
}

export interface SSEChunk {
  id?: string;
  object?: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
    };
    finish_reason: string | null;
  }>;
}

export interface AgentConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface ChatCompletionResult {
  stopReason: 'end_turn' | 'cancelled';
  fullResponse: string;
}

export type SSEEvent =
  | { type: 'data'; payload: unknown }
  | { type: 'done' }
  | { type: 'skip' };
