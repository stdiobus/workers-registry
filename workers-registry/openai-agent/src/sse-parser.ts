import { SSEEvent } from './types.js';

const DATA_PREFIX = 'data: ';
const DONE_MARKER = '[DONE]';

export function parseLine(line: string): SSEEvent {
  // Skip empty lines and whitespace-only lines
  if (!line.trim()) {
    return { type: 'skip' };
  }

  // Skip SSE comments (lines starting with :)
  if (line.startsWith(':')) {
    return { type: 'skip' };
  }

  // Check for data: prefix
  if (!line.startsWith(DATA_PREFIX)) {
    return { type: 'skip' };
  }

  const data = line.slice(DATA_PREFIX.length);

  // Check for [DONE] marker
  if (data === DONE_MARKER) {
    return { type: 'done' };
  }

  // Try to parse JSON
  try {
    const payload = JSON.parse(data);
    return { type: 'data', payload };
  } catch {
    console.error('[openai-agent] Failed to parse SSE JSON:', data);
    return { type: 'skip' };
  }
}
