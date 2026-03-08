import * as fc from 'fast-check';
import { loadConfig } from '../src/config';

/**
 * Property-based tests for configuration module.
 *
 * Feature: openai-acp-agent
 * Properties 12 & 13 from design document.
 */

describe('Config property tests', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    // Clear all OPENAI_ env vars
    delete process.env.OPENAI_BASE_URL;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_MODEL;
    delete process.env.OPENAI_SYSTEM_PROMPT;
    delete process.env.OPENAI_MAX_TOKENS;
    delete process.env.OPENAI_TEMPERATURE;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  /**
   * Property 12: Configuration round-trip from environment variables.
   *
   * For any set of non-empty string values assigned to OPENAI_BASE_URL,
   * OPENAI_API_KEY, and OPENAI_MODEL environment variables, loadConfig()
   * returns a config object with those exact values. When any of these
   * variables is unset, the config uses the documented defaults.
   *
   * **Validates: Requirements 7.1, 7.2, 7.3**
   */
  it('Property 12: round-trips arbitrary string env vars to config', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        (baseUrl, apiKey, model) => {
          process.env.OPENAI_BASE_URL = baseUrl;
          process.env.OPENAI_API_KEY = apiKey;
          process.env.OPENAI_MODEL = model;

          const config = loadConfig();

          expect(config.baseUrl).toBe(baseUrl);
          expect(config.apiKey).toBe(apiKey);
          expect(config.model).toBe(model);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property 12: uses defaults when env vars are unset', () => {
    // Ensure all three are unset
    delete process.env.OPENAI_BASE_URL;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_MODEL;

    const config = loadConfig();

    expect(config.baseUrl).toBe('https://api.openai.com/v1');
    expect(config.apiKey).toBe('');
    expect(config.model).toBe('gpt-4o');
  });

  /**
   * Property 13: Numeric environment variable parsing.
   *
   * For any valid integer string set as OPENAI_MAX_TOKENS, the config
   * parses it to the corresponding number. For any valid floating-point
   * string set as OPENAI_TEMPERATURE, the config parses it to the
   * corresponding number. For any non-numeric string, the config ignores
   * the value (uses undefined).
   *
   * **Validates: Requirements 7.5, 7.6**
   */
  it('Property 13: parses valid integer strings for OPENAI_MAX_TOKENS', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1000000, max: 1000000 }),
        (n) => {
          process.env.OPENAI_API_KEY = 'test-key';
          process.env.OPENAI_MAX_TOKENS = String(n);

          const config = loadConfig();

          expect(config.maxTokens).toBe(n);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property 13: parses valid float strings for OPENAI_TEMPERATURE', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -100, max: 100, noNaN: true, noDefaultInfinity: true }),
        (t) => {
          process.env.OPENAI_API_KEY = 'test-key';
          process.env.OPENAI_TEMPERATURE = String(t);

          const config = loadConfig();

          expect(config.temperature).toBeCloseTo(t, 10);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property 13: non-numeric strings for OPENAI_MAX_TOKENS result in undefined', () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => Number.isNaN(parseInt(s, 10))),
        (s) => {
          process.env.OPENAI_API_KEY = 'test-key';
          process.env.OPENAI_MAX_TOKENS = s;

          const config = loadConfig();

          expect(config.maxTokens).toBeUndefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property 13: non-numeric strings for OPENAI_TEMPERATURE result in undefined', () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => Number.isNaN(parseFloat(s))),
        (s) => {
          process.env.OPENAI_API_KEY = 'test-key';
          process.env.OPENAI_TEMPERATURE = s;

          const config = loadConfig();

          expect(config.temperature).toBeUndefined();
        },
      ),
      { numRuns: 100 },
    );
  });
});
