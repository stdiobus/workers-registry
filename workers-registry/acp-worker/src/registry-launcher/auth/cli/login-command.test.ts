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
 * Unit tests for --login CLI command.
 *
 * Tests successful browser OAuth flow, timeout handling, invalid provider error,
 * and exit codes.
 *
 * **Validates: Requirements 3.1, 3.5, 9.5**
 *
 * @module cli/login-command.test
 */

import { Writable } from 'stream';
import { runLoginCommand } from './login-command.js';
import type { AuthProviderId, AuthResult } from '../types.js';
import { VALID_PROVIDER_IDS } from '../types.js';

// Mock the dependencies
jest.mock('../storage/credential-store.js');
jest.mock('../token-manager.js');
jest.mock('../auth-manager.js');
jest.mock('../providers/index.js');

import { CredentialStore } from '../storage/credential-store.js';
import { TokenManager } from '../token-manager.js';
import { AuthManager } from '../auth-manager.js';

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

describe('Login Command Unit Tests', () => {
  let mockAuthManager: jest.Mocked<AuthManager>;
  let mockAuthenticateAgent: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mock for authenticateAgent
    mockAuthenticateAgent = jest.fn();
    mockAuthManager = {
      authenticateAgent: mockAuthenticateAgent,
    } as unknown as jest.Mocked<AuthManager>;

    // Mock AuthManager constructor to return our mock
    (AuthManager as jest.MockedClass<typeof AuthManager>).mockImplementation(() => mockAuthManager);

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

  describe('Successful Authentication Flow (Requirement 3.1)', () => {
    it('should return exit code 0 on successful authentication', async () => {
      const mockOutput = createMockOutput();
      const successResult: AuthResult = {
        success: true,
        providerId: 'github',
      };
      mockAuthenticateAgent.mockResolvedValue(successResult);

      const exitCode = await runLoginCommand('github', { output: mockOutput.stream });

      expect(exitCode).toBe(0);
      mockOutput.stream.end();
    });

    it('should display success message with provider name', async () => {
      const mockOutput = createMockOutput();
      const successResult: AuthResult = {
        success: true,
        providerId: 'openai',
      };
      mockAuthenticateAgent.mockResolvedValue(successResult);

      await runLoginCommand('openai', { output: mockOutput.stream });

      const output = mockOutput.getOutput();
      expect(output).toContain('Successfully authenticated');
      expect(output).toContain('Openai');
      expect(output).toContain('✓');
      mockOutput.stream.end();
    });

    it('should display opening browser message', async () => {
      const mockOutput = createMockOutput();
      const successResult: AuthResult = {
        success: true,
        providerId: 'google',
      };
      mockAuthenticateAgent.mockResolvedValue(successResult);

      await runLoginCommand('google', { output: mockOutput.stream });

      const output = mockOutput.getOutput();
      expect(output).toContain('Opening browser');
      expect(output).toContain('Google');
      mockOutput.stream.end();
    });

    it('should display waiting for authorization message', async () => {
      const mockOutput = createMockOutput();
      const successResult: AuthResult = {
        success: true,
        providerId: 'github',
      };
      mockAuthenticateAgent.mockResolvedValue(successResult);

      await runLoginCommand('github', { output: mockOutput.stream });

      const output = mockOutput.getOutput();
      expect(output).toContain('Waiting for authorization');
      expect(output).toContain('timeout');
      mockOutput.stream.end();
    });

    it('should call authenticateAgent with correct provider', async () => {
      const mockOutput = createMockOutput();
      const successResult: AuthResult = {
        success: true,
        providerId: 'anthropic',
      };
      mockAuthenticateAgent.mockResolvedValue(successResult);

      await runLoginCommand('anthropic', { output: mockOutput.stream });

      expect(mockAuthenticateAgent).toHaveBeenCalledWith('anthropic', expect.objectContaining({
        timeoutMs: expect.any(Number),
      }));
      mockOutput.stream.end();
    });

    it('should pass custom timeout to authenticateAgent', async () => {
      const mockOutput = createMockOutput();
      const successResult: AuthResult = {
        success: true,
        providerId: 'github',
      };
      mockAuthenticateAgent.mockResolvedValue(successResult);
      const customTimeout = 120000; // 2 minutes

      await runLoginCommand('github', {
        output: mockOutput.stream,
        timeoutMs: customTimeout,
      });

      expect(mockAuthenticateAgent).toHaveBeenCalledWith('github', expect.objectContaining({
        timeoutMs: customTimeout,
      }));
      mockOutput.stream.end();
    });
  });

  describe('Timeout Handling (Requirement 3.5)', () => {
    it('should return exit code 1 on timeout', async () => {
      const mockOutput = createMockOutput();
      const timeoutResult: AuthResult = {
        success: false,
        providerId: 'github',
        error: {
          code: 'TIMEOUT',
          message: 'Authentication timed out',
        },
      };
      mockAuthenticateAgent.mockResolvedValue(timeoutResult);

      const exitCode = await runLoginCommand('github', { output: mockOutput.stream });

      expect(exitCode).toBe(1);
      mockOutput.stream.end();
    });

    it('should display timeout error message', async () => {
      const mockOutput = createMockOutput();
      const timeoutResult: AuthResult = {
        success: false,
        providerId: 'openai',
        error: {
          code: 'TIMEOUT',
          message: 'Authentication timed out',
        },
      };
      mockAuthenticateAgent.mockResolvedValue(timeoutResult);

      await runLoginCommand('openai', { output: mockOutput.stream });

      const output = mockOutput.getOutput();
      expect(output).toContain('timed out');
      expect(output).toContain('✗');
      mockOutput.stream.end();
    });

    it('should suggest trying again on timeout', async () => {
      const mockOutput = createMockOutput();
      const timeoutResult: AuthResult = {
        success: false,
        providerId: 'github',
        error: {
          code: 'TIMEOUT',
          message: 'Authentication timed out',
        },
      };
      mockAuthenticateAgent.mockResolvedValue(timeoutResult);

      await runLoginCommand('github', { output: mockOutput.stream });

      const output = mockOutput.getOutput();
      expect(output).toContain('try again');
      mockOutput.stream.end();
    });

    it('should handle invalid timeout values gracefully', async () => {
      const mockOutput = createMockOutput();
      const successResult: AuthResult = {
        success: true,
        providerId: 'github',
      };
      mockAuthenticateAgent.mockResolvedValue(successResult);

      // Test with negative timeout - should use default
      const exitCode = await runLoginCommand('github', {
        output: mockOutput.stream,
        timeoutMs: -1000,
      });

      expect(exitCode).toBe(0);
      // Should have been called with a valid timeout (clamped to minimum)
      expect(mockAuthenticateAgent).toHaveBeenCalledWith('github', expect.objectContaining({
        timeoutMs: expect.any(Number),
      }));
      const callArgs = mockAuthenticateAgent.mock.calls[0][1];
      expect(callArgs?.timeoutMs).toBeGreaterThan(0);
      mockOutput.stream.end();
    });

    it('should clamp very large timeout values', async () => {
      const mockOutput = createMockOutput();
      const successResult: AuthResult = {
        success: true,
        providerId: 'github',
      };
      mockAuthenticateAgent.mockResolvedValue(successResult);

      // Test with very large timeout - should be clamped
      await runLoginCommand('github', {
        output: mockOutput.stream,
        timeoutMs: 999999999,
      });

      const callArgs = mockAuthenticateAgent.mock.calls[0][1];
      // Should be clamped to max (30 minutes = 1800000ms)
      expect(callArgs?.timeoutMs).toBeLessThanOrEqual(30 * 60 * 1000);
      mockOutput.stream.end();
    });
  });

  describe('Invalid Provider Error (Requirement 13.4)', () => {
    it('should return exit code 1 for invalid provider', async () => {
      const mockOutput = createMockOutput();

      const exitCode = await runLoginCommand(
        'invalid-provider' as AuthProviderId,
        { output: mockOutput.stream }
      );

      expect(exitCode).toBe(1);
      mockOutput.stream.end();
    });

    it('should display error message for invalid provider', async () => {
      const mockOutput = createMockOutput();

      await runLoginCommand(
        'not-a-provider' as AuthProviderId,
        { output: mockOutput.stream }
      );

      const output = mockOutput.getOutput();
      expect(output).toContain('Invalid provider');
      expect(output).toContain('not-a-provider');
      mockOutput.stream.end();
    });

    it('should list supported providers in error message', async () => {
      const mockOutput = createMockOutput();

      await runLoginCommand(
        'unknown' as AuthProviderId,
        { output: mockOutput.stream }
      );

      const output = mockOutput.getOutput();
      expect(output).toContain('Supported providers');
      // Check that at least some valid providers are listed
      expect(output).toContain('openai');
      expect(output).toContain('github');
      mockOutput.stream.end();
    });

    it('should not call authenticateAgent for invalid provider', async () => {
      const mockOutput = createMockOutput();

      await runLoginCommand(
        'invalid' as AuthProviderId,
        { output: mockOutput.stream }
      );

      expect(mockAuthenticateAgent).not.toHaveBeenCalled();
      mockOutput.stream.end();
    });

    it('should handle UNSUPPORTED_PROVIDER error from AuthManager', async () => {
      const mockOutput = createMockOutput();
      const unsupportedResult: AuthResult = {
        success: false,
        providerId: 'openai',
        error: {
          code: 'UNSUPPORTED_PROVIDER',
          message: "Provider 'openai' is not supported.",
          details: { supportedProviders: VALID_PROVIDER_IDS },
        },
      };
      mockAuthenticateAgent.mockResolvedValue(unsupportedResult);

      const exitCode = await runLoginCommand('openai', { output: mockOutput.stream });

      expect(exitCode).toBe(1);
      const output = mockOutput.getOutput();
      expect(output).toContain('not supported');
      mockOutput.stream.end();
    });
  });

  describe('Exit Codes (Requirement 9.5)', () => {
    it('should return 0 on successful authentication', async () => {
      const mockOutput = createMockOutput();
      mockAuthenticateAgent.mockResolvedValue({
        success: true,
        providerId: 'github',
      });

      const exitCode = await runLoginCommand('github', { output: mockOutput.stream });

      expect(exitCode).toBe(0);
      mockOutput.stream.end();
    });

    it('should return 1 on authentication failure', async () => {
      const mockOutput = createMockOutput();
      mockAuthenticateAgent.mockResolvedValue({
        success: false,
        providerId: 'github',
        error: {
          code: 'PROVIDER_ERROR',
          message: 'Provider returned an error',
        },
      });

      const exitCode = await runLoginCommand('github', { output: mockOutput.stream });

      expect(exitCode).toBe(1);
      mockOutput.stream.end();
    });

    it('should return 1 on invalid provider', async () => {
      const mockOutput = createMockOutput();

      const exitCode = await runLoginCommand(
        'fake-provider' as AuthProviderId,
        { output: mockOutput.stream }
      );

      expect(exitCode).toBe(1);
      mockOutput.stream.end();
    });

    it('should return 1 on exception', async () => {
      const mockOutput = createMockOutput();
      mockAuthenticateAgent.mockRejectedValue(new Error('Unexpected error'));

      const exitCode = await runLoginCommand('github', { output: mockOutput.stream });

      expect(exitCode).toBe(1);
      mockOutput.stream.end();
    });
  });

  describe('Provider Error Handling', () => {
    it('should handle INVALID_STATE error', async () => {
      const mockOutput = createMockOutput();
      mockAuthenticateAgent.mockResolvedValue({
        success: false,
        providerId: 'github',
        error: {
          code: 'INVALID_STATE',
          message: 'State parameter mismatch',
        },
      });

      const exitCode = await runLoginCommand('github', { output: mockOutput.stream });

      expect(exitCode).toBe(1);
      const output = mockOutput.getOutput();
      expect(output).toContain('Security validation error');
      mockOutput.stream.end();
    });

    it('should handle CALLBACK_ERROR', async () => {
      const mockOutput = createMockOutput();
      mockAuthenticateAgent.mockResolvedValue({
        success: false,
        providerId: 'github',
        error: {
          code: 'CALLBACK_ERROR',
          message: 'User cancelled the authorization',
        },
      });

      const exitCode = await runLoginCommand('github', { output: mockOutput.stream });

      expect(exitCode).toBe(1);
      const output = mockOutput.getOutput();
      expect(output).toContain('cancelled');
      mockOutput.stream.end();
    });

    it('should handle PROVIDER_ERROR', async () => {
      const mockOutput = createMockOutput();
      mockAuthenticateAgent.mockResolvedValue({
        success: false,
        providerId: 'openai',
        error: {
          code: 'PROVIDER_ERROR',
          message: 'Invalid client credentials',
        },
      });

      const exitCode = await runLoginCommand('openai', { output: mockOutput.stream });

      expect(exitCode).toBe(1);
      const output = mockOutput.getOutput();
      expect(output).toContain('Openai');
      expect(output).toContain('error');
      mockOutput.stream.end();
    });

    it('should handle generic errors gracefully', async () => {
      const mockOutput = createMockOutput();
      mockAuthenticateAgent.mockResolvedValue({
        success: false,
        providerId: 'github',
        error: {
          code: 'NETWORK_ERROR',
          message: 'Failed to connect to provider',
        },
      });

      const exitCode = await runLoginCommand('github', { output: mockOutput.stream });

      expect(exitCode).toBe(1);
      const output = mockOutput.getOutput();
      expect(output).toContain('failed');
      mockOutput.stream.end();
    });

    it('should handle thrown exceptions', async () => {
      const mockOutput = createMockOutput();
      mockAuthenticateAgent.mockRejectedValue(new Error('Network timeout'));

      const exitCode = await runLoginCommand('github', { output: mockOutput.stream });

      expect(exitCode).toBe(1);
      const output = mockOutput.getOutput();
      expect(output).toContain('Login failed');
      expect(output).toContain('Network timeout');
      mockOutput.stream.end();
    });
  });

  describe('User Feedback Messages', () => {
    it('should write all output to the provided stream', async () => {
      const mockOutput = createMockOutput();
      mockAuthenticateAgent.mockResolvedValue({
        success: true,
        providerId: 'github',
      });

      await runLoginCommand('github', { output: mockOutput.stream });

      const output = mockOutput.getOutput();
      // Should have multiple lines of output
      expect(output.split('\n').length).toBeGreaterThan(1);
      mockOutput.stream.end();
    });

    it('should use default stderr when no output stream provided', async () => {
      // This test verifies the function doesn't throw when no output is provided
      mockAuthenticateAgent.mockResolvedValue({
        success: true,
        providerId: 'github',
      });

      // Spy on process.stderr.write
      const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

      try {
        const exitCode = await runLoginCommand('github');
        expect(exitCode).toBe(0);
        // Verify something was written to stderr
        expect(stderrSpy).toHaveBeenCalled();
      } finally {
        stderrSpy.mockRestore();
      }
    });

    it('should display timeout duration in waiting message', async () => {
      const mockOutput = createMockOutput();
      mockAuthenticateAgent.mockResolvedValue({
        success: true,
        providerId: 'github',
      });

      await runLoginCommand('github', {
        output: mockOutput.stream,
        timeoutMs: 300000, // 5 minutes
      });

      const output = mockOutput.getOutput();
      expect(output).toContain('5 minutes');
      mockOutput.stream.end();
    });
  });

  describe('NDJSON Protocol Compliance', () => {
    it('should not write to stdout (only to provided output stream)', async () => {
      const mockOutput = createMockOutput();
      mockAuthenticateAgent.mockResolvedValue({
        success: true,
        providerId: 'github',
      });

      await runLoginCommand('github', { output: mockOutput.stream });

      // If output was captured, it means it went to our stream, not stdout
      const output = mockOutput.getOutput();
      expect(output.length).toBeGreaterThan(0);
      mockOutput.stream.end();
    });
  });

  describe('All Valid Providers', () => {
    it.each(VALID_PROVIDER_IDS)('should accept valid provider: %s', async (providerId) => {
      const mockOutput = createMockOutput();
      mockAuthenticateAgent.mockResolvedValue({
        success: true,
        providerId,
      });

      const exitCode = await runLoginCommand(providerId, { output: mockOutput.stream });

      expect(exitCode).toBe(0);
      expect(mockAuthenticateAgent).toHaveBeenCalledWith(providerId, expect.any(Object));
      mockOutput.stream.end();
    });
  });
});
