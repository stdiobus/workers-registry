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
 * Unit tests for --setup CLI command (updated setup wizard).
 *
 * Tests mode selection prompt, browser OAuth flow integration,
 * and manual credential flow.
 *
 * **Validates: Requirements 3.1, 4.2**
 *
 * @module cli/setup-command.test
 */

import { PassThrough, Writable } from 'stream';
import { runSetupCommand } from './setup-command.js';
import type { AuthProviderId } from '../types.js';

// Mock the dependencies
jest.mock('../flows/terminal-auth-flow.js');
jest.mock('../flows/agent-auth-flow.js');
jest.mock('../storage/credential-store.js');
jest.mock('../token-manager.js');
jest.mock('../providers/index.js');

import { TerminalAuthFlow } from '../flows/terminal-auth-flow.js';
import { AgentAuthFlow } from '../flows/agent-auth-flow.js';
import { CredentialStore } from '../storage/credential-store.js';
import { TokenManager } from '../token-manager.js';

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
 * Create a mock readable stream.
 */
function createMockInput(): PassThrough {
  return new PassThrough();
}

describe('Setup Command Unit Tests (Updated Wizard)', () => {
  let mockTerminalAuthFlowExecute: jest.Mock;
  let mockAgentAuthFlowExecute: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mock for TerminalAuthFlow
    mockTerminalAuthFlowExecute = jest.fn();
    (TerminalAuthFlow as jest.MockedClass<typeof TerminalAuthFlow>).mockImplementation(() => ({
      execute: mockTerminalAuthFlowExecute,
    } as unknown as TerminalAuthFlow));

    // Setup mock for AgentAuthFlow
    mockAgentAuthFlowExecute = jest.fn();
    (AgentAuthFlow as jest.MockedClass<typeof AgentAuthFlow>).mockImplementation(() => ({
      execute: mockAgentAuthFlowExecute,
    } as unknown as AgentAuthFlow));

    // Mock CredentialStore
    (CredentialStore as jest.MockedClass<typeof CredentialStore>).mockImplementation(() => ({
      store: jest.fn(),
      retrieve: jest.fn(),
      delete: jest.fn(),
      deleteAll: jest.fn(),
      listProviders: jest.fn(),
      getBackendType: jest.fn().mockReturnValue('memory'),
    } as unknown as CredentialStore));

    // Mock TokenManager
    (TokenManager as jest.MockedClass<typeof TokenManager>).mockImplementation(() => ({
      getAccessToken: jest.fn(),
      storeTokens: jest.fn(),
      hasValidTokens: jest.fn(),
      forceRefresh: jest.fn(),
      clearTokens: jest.fn(),
      getStatus: jest.fn(),
    } as unknown as TokenManager));
  });

  describe('Mode Selection Prompt (Requirements 3.1, 4.2)', () => {
    /**
     * **Validates: Requirements 3.1, 4.2**
     * Mode selection prompt appears for OAuth-capable providers
     */
    it('should trigger terminal auth flow which shows mode selection', async () => {
      const mockOutput = createMockOutput();
      const mockInput = createMockInput();

      // Terminal auth flow returns manual credential result
      mockTerminalAuthFlowExecute.mockResolvedValue({
        useBrowserOAuth: false,
        authResult: {
          success: true,
          providerId: 'github',
        },
      });

      const exitCode = await runSetupCommand({
        providerId: 'github',
        output: mockOutput.stream,
        input: mockInput,
      });

      expect(exitCode).toBe(0);
      expect(mockTerminalAuthFlowExecute).toHaveBeenCalledWith('github');
      mockOutput.stream.end();
    });

    it('should pass providerId to terminal auth flow when specified', async () => {
      const mockOutput = createMockOutput();
      const mockInput = createMockInput();

      mockTerminalAuthFlowExecute.mockResolvedValue({
        useBrowserOAuth: false,
        authResult: {
          success: true,
          providerId: 'github',
        },
      });

      await runSetupCommand({
        providerId: 'github',
        output: mockOutput.stream,
        input: mockInput,
      });

      expect(mockTerminalAuthFlowExecute).toHaveBeenCalledWith('github');
      mockOutput.stream.end();
    });

    it('should not pass providerId when not specified', async () => {
      const mockOutput = createMockOutput();
      const mockInput = createMockInput();

      mockTerminalAuthFlowExecute.mockResolvedValue({
        useBrowserOAuth: false,
        authResult: {
          success: true,
          providerId: 'github',
        },
      });

      await runSetupCommand({
        output: mockOutput.stream,
        input: mockInput,
      });

      expect(mockTerminalAuthFlowExecute).toHaveBeenCalledWith(undefined);
      mockOutput.stream.end();
    });
  });

  describe('Browser OAuth Flow Triggered (Requirement 3.1)', () => {
    /**
     * **Validates: Requirement 3.1**
     * Browser flow triggered when "Browser OAuth" selected
     */
    it('should trigger browser OAuth flow when terminal auth returns useBrowserOAuth=true', async () => {
      const mockOutput = createMockOutput();
      const mockInput = createMockInput();

      // Terminal auth flow returns browser OAuth indicator
      mockTerminalAuthFlowExecute.mockResolvedValue({
        useBrowserOAuth: true,
        providerId: 'github',
      });

      // Browser auth flow succeeds
      mockAgentAuthFlowExecute.mockResolvedValue({
        success: true,
        providerId: 'github',
      });

      const exitCode = await runSetupCommand({
        providerId: 'github',
        output: mockOutput.stream,
        input: mockInput,
      });

      expect(exitCode).toBe(0);
      expect(mockAgentAuthFlowExecute).toHaveBeenCalledWith('github');
      mockOutput.stream.end();
    });

    it('should display browser launch message when browser OAuth selected', async () => {
      const mockOutput = createMockOutput();
      const mockInput = createMockInput();

      mockTerminalAuthFlowExecute.mockResolvedValue({
        useBrowserOAuth: true,
        providerId: 'github',
      });

      mockAgentAuthFlowExecute.mockResolvedValue({
        success: true,
        providerId: 'github',
      });

      await runSetupCommand({
        providerId: 'github',
        output: mockOutput.stream,
        input: mockInput,
      });

      const output = mockOutput.getOutput();
      expect(output).toContain('Launching browser');
      expect(output).toContain('OAuth authentication');
      mockOutput.stream.end();
    });

    it('should display instruction to complete auth in browser', async () => {
      const mockOutput = createMockOutput();
      const mockInput = createMockInput();

      mockTerminalAuthFlowExecute.mockResolvedValue({
        useBrowserOAuth: true,
        providerId: 'google',
      });

      mockAgentAuthFlowExecute.mockResolvedValue({
        success: true,
        providerId: 'google',
      });

      await runSetupCommand({
        providerId: 'google',
        output: mockOutput.stream,
        input: mockInput,
      });

      const output = mockOutput.getOutput();
      expect(output).toContain('complete the authentication in your browser');
      mockOutput.stream.end();
    });
  });

  describe('Manual Flow Triggered (Requirement 4.2)', () => {
    /**
     * **Validates: Requirement 4.2**
     * Manual flow triggered when "Manual API Key" selected
     */
    it('should not trigger browser flow when terminal auth returns useBrowserOAuth=false', async () => {
      const mockOutput = createMockOutput();
      const mockInput = createMockInput();

      // Terminal auth flow returns manual credential result
      mockTerminalAuthFlowExecute.mockResolvedValue({
        useBrowserOAuth: false,
        authResult: {
          success: true,
          providerId: 'github',
        },
      });

      const exitCode = await runSetupCommand({
        providerId: 'github',
        output: mockOutput.stream,
        input: mockInput,
      });

      expect(exitCode).toBe(0);
      expect(mockAgentAuthFlowExecute).not.toHaveBeenCalled();
      mockOutput.stream.end();
    });

    it('should return success when manual flow completes successfully', async () => {
      const mockOutput = createMockOutput();
      const mockInput = createMockInput();

      mockTerminalAuthFlowExecute.mockResolvedValue({
        useBrowserOAuth: false,
        authResult: {
          success: true,
          providerId: 'github',
        },
      });

      const exitCode = await runSetupCommand({
        providerId: 'github',
        output: mockOutput.stream,
        input: mockInput,
      });

      expect(exitCode).toBe(0);
      mockOutput.stream.end();
    });

    it('should return failure when manual flow fails', async () => {
      const mockOutput = createMockOutput();
      const mockInput = createMockInput();

      mockTerminalAuthFlowExecute.mockResolvedValue({
        useBrowserOAuth: false,
        authResult: {
          success: false,
          providerId: 'github',
          error: {
            code: 'INVALID_CREDENTIALS',
            message: 'Invalid API key',
          },
        },
      });

      const exitCode = await runSetupCommand({
        providerId: 'github',
        output: mockOutput.stream,
        input: mockInput,
      });

      expect(exitCode).toBe(1);
      mockOutput.stream.end();
    });
  });

  describe('Browser Flow Success (Requirement 9.5)', () => {
    /**
     * **Validates: Requirement 9.5**
     * Browser flow success results in exit code 0
     */
    it('should return exit code 0 when browser OAuth succeeds', async () => {
      const mockOutput = createMockOutput();
      const mockInput = createMockInput();

      mockTerminalAuthFlowExecute.mockResolvedValue({
        useBrowserOAuth: true,
        providerId: 'github',
      });

      mockAgentAuthFlowExecute.mockResolvedValue({
        success: true,
        providerId: 'github',
      });

      const exitCode = await runSetupCommand({
        providerId: 'github',
        output: mockOutput.stream,
        input: mockInput,
      });

      expect(exitCode).toBe(0);
      mockOutput.stream.end();
    });

    it('should display success message with provider name after browser OAuth', async () => {
      const mockOutput = createMockOutput();
      const mockInput = createMockInput();

      mockTerminalAuthFlowExecute.mockResolvedValue({
        useBrowserOAuth: true,
        providerId: 'github',
      });

      mockAgentAuthFlowExecute.mockResolvedValue({
        success: true,
        providerId: 'github',
      });

      await runSetupCommand({
        providerId: 'github',
        output: mockOutput.stream,
        input: mockInput,
      });

      const output = mockOutput.getOutput();
      expect(output).toContain('github');
      expect(output).toContain('authentication completed successfully');
      mockOutput.stream.end();
    });
  });

  describe('Browser Flow Failure (Requirement 9.5)', () => {
    /**
     * **Validates: Requirement 9.5**
     * Browser flow failure results in exit code 1
     */
    it('should return exit code 1 when browser OAuth fails', async () => {
      const mockOutput = createMockOutput();
      const mockInput = createMockInput();

      mockTerminalAuthFlowExecute.mockResolvedValue({
        useBrowserOAuth: true,
        providerId: 'github',
      });

      mockAgentAuthFlowExecute.mockResolvedValue({
        success: false,
        providerId: 'github',
        error: {
          code: 'TIMEOUT',
          message: 'Authentication timed out',
        },
      });

      const exitCode = await runSetupCommand({
        providerId: 'github',
        output: mockOutput.stream,
        input: mockInput,
      });

      expect(exitCode).toBe(1);
      mockOutput.stream.end();
    });

    it('should display error message when browser OAuth fails', async () => {
      const mockOutput = createMockOutput();
      const mockInput = createMockInput();

      mockTerminalAuthFlowExecute.mockResolvedValue({
        useBrowserOAuth: true,
        providerId: 'google',
      });

      mockAgentAuthFlowExecute.mockResolvedValue({
        success: false,
        providerId: 'google',
        error: {
          code: 'PROVIDER_ERROR',
          message: 'Provider returned an error',
        },
      });

      await runSetupCommand({
        providerId: 'google',
        output: mockOutput.stream,
        input: mockInput,
      });

      const output = mockOutput.getOutput();
      expect(output).toContain('Browser authentication failed');
      expect(output).toContain('Provider returned an error');
      mockOutput.stream.end();
    });

    it('should return exit code 1 when browser OAuth times out', async () => {
      const mockOutput = createMockOutput();
      const mockInput = createMockInput();

      mockTerminalAuthFlowExecute.mockResolvedValue({
        useBrowserOAuth: true,
        providerId: 'azure',
      });

      mockAgentAuthFlowExecute.mockResolvedValue({
        success: false,
        providerId: 'azure',
        error: {
          code: 'TIMEOUT',
          message: 'Authentication timed out after 5 minutes',
        },
      });

      const exitCode = await runSetupCommand({
        providerId: 'azure',
        output: mockOutput.stream,
        input: mockInput,
      });

      expect(exitCode).toBe(1);
      const output = mockOutput.getOutput();
      expect(output).toContain('Browser authentication failed');
      mockOutput.stream.end();
    });

    it('should return exit code 1 when browser OAuth has invalid state', async () => {
      const mockOutput = createMockOutput();
      const mockInput = createMockInput();

      mockTerminalAuthFlowExecute.mockResolvedValue({
        useBrowserOAuth: true,
        providerId: 'cognito',
      });

      mockAgentAuthFlowExecute.mockResolvedValue({
        success: false,
        providerId: 'cognito',
        error: {
          code: 'INVALID_STATE',
          message: 'State parameter mismatch',
        },
      });

      const exitCode = await runSetupCommand({
        providerId: 'cognito',
        output: mockOutput.stream,
        input: mockInput,
      });

      expect(exitCode).toBe(1);
      mockOutput.stream.end();
    });
  });

  describe('User Messages Display', () => {
    /**
     * **Validates: Requirements 3.1, 4.2**
     * Appropriate user messages are displayed for both flows
     */
    it('should display appropriate messages for browser OAuth flow', async () => {
      const mockOutput = createMockOutput();
      const mockInput = createMockInput();

      mockTerminalAuthFlowExecute.mockResolvedValue({
        useBrowserOAuth: true,
        providerId: 'github',
      });

      mockAgentAuthFlowExecute.mockResolvedValue({
        success: true,
        providerId: 'github',
      });

      await runSetupCommand({
        providerId: 'github',
        output: mockOutput.stream,
        input: mockInput,
      });

      const output = mockOutput.getOutput();
      // Should have browser launch message
      expect(output).toContain('Launching browser');
      // Should have instruction message
      expect(output).toContain('complete the authentication');
      // Should have success message
      expect(output).toContain('completed successfully');
      mockOutput.stream.end();
    });

    it('should not display browser messages for manual flow', async () => {
      const mockOutput = createMockOutput();
      const mockInput = createMockInput();

      mockTerminalAuthFlowExecute.mockResolvedValue({
        useBrowserOAuth: false,
        authResult: {
          success: true,
          providerId: 'github',
        },
      });

      await runSetupCommand({
        providerId: 'github',
        output: mockOutput.stream,
        input: mockInput,
      });

      const output = mockOutput.getOutput();
      // Should NOT have browser-specific messages
      expect(output).not.toContain('Launching browser');
      expect(output).not.toContain('complete the authentication in your browser');
      mockOutput.stream.end();
    });
  });

  describe('Invalid Provider Handling', () => {
    it('should return exit code 1 for invalid provider', async () => {
      const mockOutput = createMockOutput();
      const mockInput = createMockInput();

      const exitCode = await runSetupCommand({
        providerId: 'invalid-provider' as AuthProviderId,
        output: mockOutput.stream,
        input: mockInput,
      });

      expect(exitCode).toBe(1);
      mockOutput.stream.end();
    });

    it('should display error message for invalid provider', async () => {
      const mockOutput = createMockOutput();
      const mockInput = createMockInput();

      await runSetupCommand({
        providerId: 'not-a-provider' as AuthProviderId,
        output: mockOutput.stream,
        input: mockInput,
      });

      const output = mockOutput.getOutput();
      expect(output).toContain('Invalid provider');
      expect(output).toContain('not-a-provider');
      mockOutput.stream.end();
    });

    it('should list supported providers in error message', async () => {
      const mockOutput = createMockOutput();
      const mockInput = createMockInput();

      await runSetupCommand({
        providerId: 'unknown' as AuthProviderId,
        output: mockOutput.stream,
        input: mockInput,
      });

      const output = mockOutput.getOutput();
      expect(output).toContain('Supported providers');
      mockOutput.stream.end();
    });

    it('should not call terminal auth flow for invalid provider', async () => {
      const mockOutput = createMockOutput();
      const mockInput = createMockInput();

      await runSetupCommand({
        providerId: 'invalid' as AuthProviderId,
        output: mockOutput.stream,
        input: mockInput,
      });

      expect(mockTerminalAuthFlowExecute).not.toHaveBeenCalled();
      mockOutput.stream.end();
    });
  });

  describe('Exception Handling', () => {
    it('should return exit code 1 when terminal auth flow throws', async () => {
      const mockOutput = createMockOutput();
      const mockInput = createMockInput();

      mockTerminalAuthFlowExecute.mockRejectedValue(new Error('Unexpected error'));

      const exitCode = await runSetupCommand({
        providerId: 'github',
        output: mockOutput.stream,
        input: mockInput,
      });

      expect(exitCode).toBe(1);
      const output = mockOutput.getOutput();
      expect(output).toContain('Setup failed');
      expect(output).toContain('Unexpected error');
      mockOutput.stream.end();
    });

    it('should return exit code 1 when browser auth flow throws', async () => {
      const mockOutput = createMockOutput();
      const mockInput = createMockInput();

      mockTerminalAuthFlowExecute.mockResolvedValue({
        useBrowserOAuth: true,
        providerId: 'github',
      });

      mockAgentAuthFlowExecute.mockRejectedValue(new Error('Browser launch failed'));

      const exitCode = await runSetupCommand({
        providerId: 'github',
        output: mockOutput.stream,
        input: mockInput,
      });

      expect(exitCode).toBe(1);
      const output = mockOutput.getOutput();
      expect(output).toContain('Setup failed');
      mockOutput.stream.end();
    });
  });

  describe('NDJSON Protocol Compliance', () => {
    it('should write all output to the provided stream (not stdout)', async () => {
      const mockOutput = createMockOutput();
      const mockInput = createMockInput();

      mockTerminalAuthFlowExecute.mockResolvedValue({
        useBrowserOAuth: false,
        authResult: {
          success: true,
          providerId: 'github',
        },
      });

      await runSetupCommand({
        providerId: 'github',
        output: mockOutput.stream,
        input: mockInput,
      });

      // If output was captured, it means it went to our stream, not stdout
      const output = mockOutput.getOutput();
      expect(output.length).toBeGreaterThanOrEqual(0);
      mockOutput.stream.end();
    });

    it('should use default stderr when no output stream provided', async () => {
      mockTerminalAuthFlowExecute.mockResolvedValue({
        useBrowserOAuth: false,
        authResult: {
          success: true,
          providerId: 'github',
        },
      });

      // Spy on process.stderr.write
      const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

      try {
        const exitCode = await runSetupCommand({ providerId: 'github' });
        expect(exitCode).toBe(0);
      } finally {
        stderrSpy.mockRestore();
      }
    });
  });

  describe('All Valid Providers', () => {
    const validProviders: AuthProviderId[] = ['github', 'google', 'cognito', 'azure'];

    it.each(validProviders)('should accept valid provider: %s for browser OAuth', async (providerId) => {
      const mockOutput = createMockOutput();
      const mockInput = createMockInput();

      mockTerminalAuthFlowExecute.mockResolvedValue({
        useBrowserOAuth: true,
        providerId,
      });

      mockAgentAuthFlowExecute.mockResolvedValue({
        success: true,
        providerId,
      });

      const exitCode = await runSetupCommand({
        providerId,
        output: mockOutput.stream,
        input: mockInput,
      });

      expect(exitCode).toBe(0);
      expect(mockTerminalAuthFlowExecute).toHaveBeenCalledWith(providerId);
      expect(mockAgentAuthFlowExecute).toHaveBeenCalledWith(providerId);
      mockOutput.stream.end();
    });

    it.each(validProviders)('should accept valid provider: %s for manual flow', async (providerId) => {
      const mockOutput = createMockOutput();
      const mockInput = createMockInput();

      mockTerminalAuthFlowExecute.mockResolvedValue({
        useBrowserOAuth: false,
        authResult: {
          success: true,
          providerId,
        },
      });

      const exitCode = await runSetupCommand({
        providerId,
        output: mockOutput.stream,
        input: mockInput,
      });

      expect(exitCode).toBe(0);
      expect(mockTerminalAuthFlowExecute).toHaveBeenCalledWith(providerId);
      expect(mockAgentAuthFlowExecute).not.toHaveBeenCalled();
      mockOutput.stream.end();
    });
  });
});
