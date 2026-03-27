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
 * Unit tests for --auth-status CLI command.
 *
 * Tests that the status command correctly displays:
 * - OAuth Authentication Status section
 * - Model API Keys section
 * - Summary with both OAuth and Model Keys counts
 * - OpenAI and Anthropic in Model API Keys section (not OAuth)
 *
 * **Validates: Requirements 7b.3, 9.2**
 *
 * @module cli/status-command.test
 */

import { Writable } from 'stream';
import { runStatusCommand } from './status-command.js';
import { VALID_PROVIDER_IDS } from '../types.js';
import { VALID_MODEL_PROVIDER_IDS } from '../model-credentials/index.js';

/**
 * Create a mock writable stream that captures output.
 */
function createMockOutput(): { stream: Writable; getOutput: () => string } {
  let output = '';
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      output += chunk.toString();
      callback();
    },
  });
  return {
    stream,
    getOutput: () => output,
  };
}

describe('Status Command Tests (Requirements 7b.3, 9.2)', () => {
  describe('Output Sections', () => {
    /**
     * **Validates: Requirement 9.2**
     * Output should include OAuth Authentication Status section header
     */
    it('should include "=== OAuth Authentication Status ===" section', async () => {
      const mockOutput = createMockOutput();

      await runStatusCommand({ output: mockOutput.stream });

      const output = mockOutput.getOutput();
      expect(output).toContain('=== OAuth Authentication Status ===');
      mockOutput.stream.end();
    });

    /**
     * **Validates: Requirement 7b.3**
     * Output should include Model API Keys section header
     */
    it('should include "=== Model API Keys ===" section', async () => {
      const mockOutput = createMockOutput();

      await runStatusCommand({ output: mockOutput.stream });

      const output = mockOutput.getOutput();
      expect(output).toContain('=== Model API Keys ===');
      mockOutput.stream.end();
    });

    /**
     * **Validates: Requirement 7b.3**
     * OAuth section should appear before Model API Keys section
     */
    it('should show OAuth section before Model API Keys section', async () => {
      const mockOutput = createMockOutput();

      await runStatusCommand({ output: mockOutput.stream });

      const output = mockOutput.getOutput();
      const oauthIndex = output.indexOf('=== OAuth Authentication Status ===');
      const modelIndex = output.indexOf('=== Model API Keys ===');

      expect(oauthIndex).toBeGreaterThan(-1);
      expect(modelIndex).toBeGreaterThan(-1);
      expect(oauthIndex).toBeLessThan(modelIndex);
      mockOutput.stream.end();
    });
  });

  describe('Summary Section', () => {
    /**
     * **Validates: Requirement 7b.3**
     * Summary should include "Model Keys Configured" count
     */
    it('should include "Model Keys Configured" in summary', async () => {
      const mockOutput = createMockOutput();

      await runStatusCommand({ output: mockOutput.stream });

      const output = mockOutput.getOutput();
      expect(output).toContain('Model Keys Configured');
      mockOutput.stream.end();
    });

    /**
     * **Validates: Requirement 7b.3**
     * Summary should include "Model Keys Not Configured" count
     */
    it('should include "Model Keys Not Configured" in summary', async () => {
      const mockOutput = createMockOutput();

      await runStatusCommand({ output: mockOutput.stream });

      const output = mockOutput.getOutput();
      expect(output).toContain('Model Keys Not Configured');
      mockOutput.stream.end();
    });

    /**
     * **Validates: Requirement 9.2**
     * Summary should include OAuth status counts
     */
    it('should include OAuth status counts in summary', async () => {
      const mockOutput = createMockOutput();

      await runStatusCommand({ output: mockOutput.stream });

      const output = mockOutput.getOutput();
      expect(output).toContain('OAuth Authenticated');
      expect(output).toContain('OAuth Expired/Failed');
      expect(output).toContain('OAuth Not Configured');
      mockOutput.stream.end();
    });

    /**
     * **Validates: Requirement 9.2**
     * Summary section should be clearly marked
     */
    it('should include "--- Summary ---" section marker', async () => {
      const mockOutput = createMockOutput();

      await runStatusCommand({ output: mockOutput.stream });

      const output = mockOutput.getOutput();
      expect(output).toContain('--- Summary ---');
      mockOutput.stream.end();
    });
  });

  describe('Provider Display in Correct Sections', () => {
    /**
     * **Validates: Requirement 7b.3**
     * OpenAI should appear in Model API Keys section
     */
    it('should show OpenAI in Model API Keys section', async () => {
      const mockOutput = createMockOutput();

      await runStatusCommand({ output: mockOutput.stream });

      const output = mockOutput.getOutput();
      const modelSectionStart = output.indexOf('=== Model API Keys ===');
      const summaryStart = output.indexOf('--- Summary ---');

      // Extract Model API Keys section
      const modelSection = output.substring(modelSectionStart, summaryStart);

      expect(modelSection).toContain('Openai');
      mockOutput.stream.end();
    });

    /**
     * **Validates: Requirement 7b.3**
     * Anthropic should appear in Model API Keys section
     */
    it('should show Anthropic in Model API Keys section', async () => {
      const mockOutput = createMockOutput();

      await runStatusCommand({ output: mockOutput.stream });

      const output = mockOutput.getOutput();
      const modelSectionStart = output.indexOf('=== Model API Keys ===');
      const summaryStart = output.indexOf('--- Summary ---');

      // Extract Model API Keys section
      const modelSection = output.substring(modelSectionStart, summaryStart);

      expect(modelSection).toContain('Anthropic');
      mockOutput.stream.end();
    });

    /**
     * **Validates: Requirement 7b.3**
     * OpenAI should NOT appear in OAuth section
     */
    it('should NOT show OpenAI in OAuth section', async () => {
      const mockOutput = createMockOutput();

      await runStatusCommand({ output: mockOutput.stream });

      const output = mockOutput.getOutput();
      const oauthSectionStart = output.indexOf('=== OAuth Authentication Status ===');
      const modelSectionStart = output.indexOf('=== Model API Keys ===');

      // Extract OAuth section
      const oauthSection = output.substring(oauthSectionStart, modelSectionStart);

      expect(oauthSection).not.toContain('Openai');
      mockOutput.stream.end();
    });

    /**
     * **Validates: Requirement 7b.3**
     * Anthropic should NOT appear in OAuth section
     */
    it('should NOT show Anthropic in OAuth section', async () => {
      const mockOutput = createMockOutput();

      await runStatusCommand({ output: mockOutput.stream });

      const output = mockOutput.getOutput();
      const oauthSectionStart = output.indexOf('=== OAuth Authentication Status ===');
      const modelSectionStart = output.indexOf('=== Model API Keys ===');

      // Extract OAuth section
      const oauthSection = output.substring(oauthSectionStart, modelSectionStart);

      expect(oauthSection).not.toContain('Anthropic');
      mockOutput.stream.end();
    });

    /**
     * **Validates: Requirement 7.1**
     * All OAuth providers should appear in OAuth section
     */
    it('should show all OAuth providers in OAuth section', async () => {
      const mockOutput = createMockOutput();

      await runStatusCommand({ output: mockOutput.stream });

      const output = mockOutput.getOutput();
      const oauthSectionStart = output.indexOf('=== OAuth Authentication Status ===');
      const modelSectionStart = output.indexOf('=== Model API Keys ===');

      // Extract OAuth section
      const oauthSection = output.substring(oauthSectionStart, modelSectionStart);

      // Check all OAuth providers are present (capitalized)
      for (const providerId of VALID_PROVIDER_IDS) {
        const capitalizedName = providerId.charAt(0).toUpperCase() + providerId.slice(1);
        expect(oauthSection).toContain(capitalizedName);
      }
      mockOutput.stream.end();
    });

    /**
     * **Validates: Requirement 7b.1**
     * All Model providers should appear in Model API Keys section
     */
    it('should show all Model providers in Model API Keys section', async () => {
      const mockOutput = createMockOutput();

      await runStatusCommand({ output: mockOutput.stream });

      const output = mockOutput.getOutput();
      const modelSectionStart = output.indexOf('=== Model API Keys ===');
      const summaryStart = output.indexOf('--- Summary ---');

      // Extract Model API Keys section
      const modelSection = output.substring(modelSectionStart, summaryStart);

      // Check all Model providers are present (capitalized)
      for (const providerId of VALID_MODEL_PROVIDER_IDS) {
        const capitalizedName = providerId.charAt(0).toUpperCase() + providerId.slice(1);
        expect(modelSection).toContain(capitalizedName);
      }
      mockOutput.stream.end();
    });
  });

  describe('Exit Code', () => {
    /**
     * **Validates: Requirement 9.5**
     * Status command should return exit code 0 on success
     */
    it('should return exit code 0 on success', async () => {
      const mockOutput = createMockOutput();

      const exitCode = await runStatusCommand({ output: mockOutput.stream });

      expect(exitCode).toBe(0);
      mockOutput.stream.end();
    });
  });

  describe('NDJSON Protocol Compliance', () => {
    /**
     * **Validates: Requirement 10.5**
     * Status command should write to provided output stream (not stdout)
     */
    it('should write all output to provided stream', async () => {
      const mockOutput = createMockOutput();

      await runStatusCommand({ output: mockOutput.stream });

      const output = mockOutput.getOutput();
      // Output should be captured (meaning it went to our mock stream)
      expect(output.length).toBeGreaterThan(0);
      expect(output).toContain('OAuth Authentication Status');
      expect(output).toContain('Model API Keys');
      mockOutput.stream.end();
    });
  });
});
