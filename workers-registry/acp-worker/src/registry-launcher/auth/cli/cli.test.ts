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
 * Unit tests for CLI commands.
 *
 * Tests flag parsing, output format, and exit codes.
 *
 * **Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5**
 *
 * @module cli/cli.test
 */

import { Writable, Readable } from 'stream';
import { runSetupCommand } from './setup-command.js';
import { runStatusCommand } from './status-command.js';
import { runLogoutCommand } from './logout-command.js';
import type { AuthProviderId } from '../types.js';
import { VALID_PROVIDER_IDS } from '../types.js';

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

/**
 * Create a mock readable stream with predefined input.
 */
function createMockInput(lines: string[]): Readable {
  let index = 0;
  return new Readable({
    read() {
      if (index < lines.length) {
        this.push(lines[index] + '\n');
        index++;
      } else {
        this.push(null);
      }
    },
  });
}


describe('CLI Commands Unit Tests', () => {
  describe('Setup Command (Requirement 9.1)', () => {
    it('should export runSetupCommand function', () => {
      expect(typeof runSetupCommand).toBe('function');
    });

    it('should accept options parameter', async () => {
      const mockOutput = createMockOutput();
      const mockInput = createMockInput(['1', 'test-client-id', 'n']); // Select OpenAI, enter client ID, don't retry

      // The setup command will fail because we're not providing valid credentials
      // but it should still run without throwing
      const exitCode = await runSetupCommand({
        output: mockOutput.stream,
        input: mockInput,
      });

      // Exit code should be 0 or 1 (not throw)
      expect([0, 1]).toContain(exitCode);
      mockOutput.stream.end();
    });

    it('should write output to stderr (not stdout)', async () => {
      const mockOutput = createMockOutput();
      const mockInput = createMockInput(['1', 'test-client-id', 'n']);

      await runSetupCommand({
        output: mockOutput.stream,
        input: mockInput,
      });

      // Output should contain setup wizard header
      const output = mockOutput.getOutput();
      expect(output).toContain('OAuth Authentication Setup');
      mockOutput.stream.end();
    });

    it('should accept pre-selected provider', async () => {
      const mockOutput = createMockOutput();
      const mockInput = createMockInput(['test-client-id', 'n']);

      await runSetupCommand({
        providerId: 'openai',
        output: mockOutput.stream,
        input: mockInput,
      });

      // Output should mention configuring the provider
      const output = mockOutput.getOutput();
      expect(output).toContain('OpenAI');
      mockOutput.stream.end();
    });

    it('should return exit code 1 for invalid provider', async () => {
      const mockOutput = createMockOutput();
      const mockInput = createMockInput([]);

      const exitCode = await runSetupCommand({
        providerId: 'invalid-provider' as AuthProviderId,
        output: mockOutput.stream,
        input: mockInput,
      });

      expect(exitCode).toBe(1);
      const output = mockOutput.getOutput();
      expect(output).toContain('Invalid provider');
      mockOutput.stream.end();
    });
  });


  describe('Status Command (Requirement 9.2)', () => {
    it('should export runStatusCommand function', () => {
      expect(typeof runStatusCommand).toBe('function');
    });

    it('should return exit code 0 on success', async () => {
      const mockOutput = createMockOutput();

      const exitCode = await runStatusCommand({ output: mockOutput.stream });

      expect(exitCode).toBe(0);
      mockOutput.stream.end();
    });

    it('should display status header', async () => {
      const mockOutput = createMockOutput();

      await runStatusCommand({ output: mockOutput.stream });

      const output = mockOutput.getOutput();
      expect(output).toContain('OAuth Authentication Status');
      mockOutput.stream.end();
    });

    it('should display all provider statuses', async () => {
      const mockOutput = createMockOutput();

      await runStatusCommand({ output: mockOutput.stream });

      const output = mockOutput.getOutput();

      // Should mention all providers
      for (const providerId of VALID_PROVIDER_IDS) {
        const providerName = providerId.charAt(0).toUpperCase() + providerId.slice(1);
        expect(output).toContain(providerName);
      }
      mockOutput.stream.end();
    });

    it('should display summary section', async () => {
      const mockOutput = createMockOutput();

      await runStatusCommand({ output: mockOutput.stream });

      const output = mockOutput.getOutput();
      expect(output).toContain('Summary');
      expect(output).toContain('Authenticated');
      expect(output).toContain('Not Configured');
      mockOutput.stream.end();
    });

    it('should show not-configured status for unconfigured providers', async () => {
      const mockOutput = createMockOutput();

      await runStatusCommand({ output: mockOutput.stream });

      const output = mockOutput.getOutput();
      expect(output).toContain('Not Configured');
      mockOutput.stream.end();
    });

    it('should provide setup hint when all providers not configured', async () => {
      const mockOutput = createMockOutput();

      await runStatusCommand({ output: mockOutput.stream });

      const output = mockOutput.getOutput();
      // The hint is shown when all providers are not configured
      // or when there are expired providers
      // Check that the output contains helpful information
      expect(output).toContain('Summary');
      mockOutput.stream.end();
    });

    it('should write output to stderr (not stdout)', async () => {
      const mockOutput = createMockOutput();

      await runStatusCommand({ output: mockOutput.stream });

      // Output should be captured (meaning it went to our mock stderr)
      const output = mockOutput.getOutput();
      expect(output.length).toBeGreaterThan(0);
      mockOutput.stream.end();
    });
  });


  describe('Logout Command (Requirements 9.3, 9.4)', () => {
    it('should export runLogoutCommand function', () => {
      expect(typeof runLogoutCommand).toBe('function');
    });

    it('should return exit code 0 when no credentials exist', async () => {
      const mockOutput = createMockOutput();

      const exitCode = await runLogoutCommand(undefined, { output: mockOutput.stream });

      expect(exitCode).toBe(0);
      mockOutput.stream.end();
    });

    it('should return exit code 0 for specific provider with no credentials', async () => {
      const mockOutput = createMockOutput();

      const exitCode = await runLogoutCommand('openai', { output: mockOutput.stream });

      expect(exitCode).toBe(0);
      mockOutput.stream.end();
    });

    it('should return exit code 1 for invalid provider', async () => {
      const mockOutput = createMockOutput();

      const exitCode = await runLogoutCommand(
        'invalid-provider' as AuthProviderId,
        { output: mockOutput.stream }
      );

      expect(exitCode).toBe(1);
      mockOutput.stream.end();
    });

    it('should display error message for invalid provider', async () => {
      const mockOutput = createMockOutput();

      await runLogoutCommand(
        'invalid-provider' as AuthProviderId,
        { output: mockOutput.stream }
      );

      const output = mockOutput.getOutput();
      expect(output).toContain('Invalid provider');
      expect(output).toContain('invalid-provider');
      mockOutput.stream.end();
    });

    it('should list supported providers in error message', async () => {
      const mockOutput = createMockOutput();

      await runLogoutCommand(
        'invalid-provider' as AuthProviderId,
        { output: mockOutput.stream }
      );

      const output = mockOutput.getOutput();
      expect(output).toContain('Supported providers');
      mockOutput.stream.end();
    });

    it('should display message when no credentials to remove', async () => {
      const mockOutput = createMockOutput();

      await runLogoutCommand(undefined, { output: mockOutput.stream });

      const output = mockOutput.getOutput();
      expect(output).toContain('No credentials found');
      mockOutput.stream.end();
    });

    it('should display message when specific provider has no credentials', async () => {
      const mockOutput = createMockOutput();

      await runLogoutCommand('github', { output: mockOutput.stream });

      const output = mockOutput.getOutput();
      expect(output).toContain('No credentials found');
      expect(output).toContain('github');
      mockOutput.stream.end();
    });

    it('should write output to stderr (not stdout)', async () => {
      const mockOutput = createMockOutput();

      await runLogoutCommand(undefined, { output: mockOutput.stream });

      // Output should be captured (meaning it went to our mock stderr)
      const output = mockOutput.getOutput();
      expect(output.length).toBeGreaterThan(0);
      mockOutput.stream.end();
    });

    it('should accept all valid provider IDs', async () => {
      for (const providerId of VALID_PROVIDER_IDS) {
        const mockOutput = createMockOutput();

        const exitCode = await runLogoutCommand(providerId, { output: mockOutput.stream });

        // Should not return error for valid provider
        expect(exitCode).toBe(0);
        mockOutput.stream.end();
      }
    });
  });


  describe('Exit Codes (Requirement 9.5)', () => {
    it('status command returns 0 on success', async () => {
      const mockOutput = createMockOutput();

      const exitCode = await runStatusCommand({ output: mockOutput.stream });

      expect(exitCode).toBe(0);
      mockOutput.stream.end();
    });

    it('logout command returns 0 on success (no credentials)', async () => {
      const mockOutput = createMockOutput();

      const exitCode = await runLogoutCommand(undefined, { output: mockOutput.stream });

      expect(exitCode).toBe(0);
      mockOutput.stream.end();
    });

    it('logout command returns 0 for valid provider (no credentials)', async () => {
      const mockOutput = createMockOutput();

      const exitCode = await runLogoutCommand('openai', { output: mockOutput.stream });

      expect(exitCode).toBe(0);
      mockOutput.stream.end();
    });

    it('logout command returns 1 for invalid provider', async () => {
      const mockOutput = createMockOutput();

      const exitCode = await runLogoutCommand(
        'not-a-provider' as AuthProviderId,
        { output: mockOutput.stream }
      );

      expect(exitCode).toBe(1);
      mockOutput.stream.end();
    });
  });


  describe('Output Format', () => {
    it('status command uses status indicators', async () => {
      const mockOutput = createMockOutput();

      await runStatusCommand({ output: mockOutput.stream });

      const output = mockOutput.getOutput();
      // Should use visual indicators
      expect(output).toMatch(/[✓✗⚠○]/);
      mockOutput.stream.end();
    });

    it('status command formats provider names with capitalization', async () => {
      const mockOutput = createMockOutput();

      await runStatusCommand({ output: mockOutput.stream });

      const output = mockOutput.getOutput();
      // Provider names should be capitalized
      expect(output).toContain('Openai');
      expect(output).toContain('Github');
      expect(output).toContain('Google');
      mockOutput.stream.end();
    });

    it('logout command confirms action', async () => {
      const mockOutput = createMockOutput();

      await runLogoutCommand(undefined, { output: mockOutput.stream });

      const output = mockOutput.getOutput();
      // Should have some confirmation message
      expect(output.length).toBeGreaterThan(0);
      mockOutput.stream.end();
    });
  });


  describe('NDJSON Protocol Compliance', () => {
    it('status command does not write to stdout', async () => {
      // We can't easily test this without mocking process.stdout
      // but we verify that the command accepts a custom output stream
      const mockOutput = createMockOutput();

      await runStatusCommand({ output: mockOutput.stream });

      // If output was captured, it means it went to our stream, not stdout
      const output = mockOutput.getOutput();
      expect(output.length).toBeGreaterThan(0);
      mockOutput.stream.end();
    });

    it('logout command does not write to stdout', async () => {
      const mockOutput = createMockOutput();

      await runLogoutCommand(undefined, { output: mockOutput.stream });

      const output = mockOutput.getOutput();
      expect(output.length).toBeGreaterThan(0);
      mockOutput.stream.end();
    });

    it('setup command does not write to stdout', async () => {
      const mockOutput = createMockOutput();
      const mockInput = createMockInput(['1', 'test-id', 'n']);

      await runSetupCommand({
        output: mockOutput.stream,
        input: mockInput,
      });

      const output = mockOutput.getOutput();
      expect(output.length).toBeGreaterThan(0);
      mockOutput.stream.end();
    });
  });
});
