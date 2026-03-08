import { AgentConfig } from './types.js';

export function loadConfig(): AgentConfig {
  const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  const apiKey = process.env.OPENAI_API_KEY || '';
  const model = process.env.OPENAI_MODEL || 'gpt-4o';
  const systemPrompt = process.env.OPENAI_SYSTEM_PROMPT || undefined;

  let maxTokens: number | undefined;
  const maxTokensStr = process.env.OPENAI_MAX_TOKENS;
  if (maxTokensStr !== undefined) {
    const parsed = parseInt(maxTokensStr, 10);
    maxTokens = Number.isNaN(parsed) ? undefined : parsed;
  }

  let temperature: number | undefined;
  const temperatureStr = process.env.OPENAI_TEMPERATURE;
  if (temperatureStr !== undefined) {
    const parsed = parseFloat(temperatureStr);
    temperature = Number.isNaN(parsed) ? undefined : parsed;
  }

  if (!apiKey) {
    console.error('[openai-agent] Warning: OPENAI_API_KEY is not set. This may be fine for local endpoints like Ollama.');
  }

  return { baseUrl, apiKey, model, systemPrompt, maxTokens, temperature };
}
