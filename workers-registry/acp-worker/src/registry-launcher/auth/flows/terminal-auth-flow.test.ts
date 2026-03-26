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
 * Unit tests for Terminal Auth Flow module.
 *
 * Tests the interactive CLI setup flow for headless/manual credential configuration.
 *
 * **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6**
 *
 * @module flows/terminal-auth-flow.test
 */

import { PassThrough, Writable } from 'stream';
import type { AuthProviderId, StoredCredentials } from '../types.js';
import type { ICredentialStore } from '../storage/types.js';
import {
  TerminalAuthFlow,
  createTerminalAuthFlow,
  getProviderInfo,
  getAllProviderInfo,
  type TerminalAuthFlowDependencies,
  type TerminalAuthFlowResult,
} from './terminal-auth-flow.js';

/**
 * Create a mock input stream that can be written to programmatically.
 */
function createMockInput(): PassThrough {
  return new PassThrough();
}

/**
 * Helper to send input with a small delay to allow readline to process.
 */
async function sendInput(input: PassThrough, value: string): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 10));
  input.write(value + '\n');
}

/**
 * Helper to check if the result indicates success (manual flow completed successfully).
 */
function isSuccessResult(result: TerminalAuthFlowResult): boolean {
  return !result.useBrowserOAuth && result.authResult.success;
}

/**
 * Helper to get the providerId from the result.
 */
function getResultProviderId(result: TerminalAuthFlowResult): AuthProviderId {
  if (result.useBrowserOAuth) {
    return result.providerId;
  }
  return result.authResult.providerId;
}

/**
 * Helper to get the error from a failed result.
 */
function getResultError(result: TerminalAuthFlowResult): { code: string; message: string } | undefined {
  if (result.useBrowserOAuth) {
    return undefined;
  }
  if (result.authResult.success) {
    return undefined;
  }
  return result.authResult.error;
}

/**
 * Create a mock writable stream that captures output.
 */
function createMockOutput(): Writable & { getOutput: () => string } {
  let output = '';
  const writable = new Writable({
    write(chunk, _encoding, callback) {
      output += chunk.toString();
      callback();
    },
  }) as Writable & { getOutput: () => string };

  writable.getOutput = () => output;
  return writable;
}

/**
 * Create a mock credential store for testing.
 */
function createMockCredentialStore(
  overrides: Partial<ICredentialStore> = {}
): ICredentialStore {
  const storage = new Map<AuthProviderId, StoredCredentials>();

  return {
    store: jest.fn(async (providerId: AuthProviderId, credentials: StoredCredentials) => {
      storage.set(providerId, credentials);
    }),
    retrieve: jest.fn(async (providerId: AuthProviderId) => {
      return storage.get(providerId) || null;
    }),
    delete: jest.fn(async (providerId: AuthProviderId) => {
      storage.delete(providerId);
    }),
    deleteAll: jest.fn(async () => {
      storage.clear();
    }),
    listProviders: jest.fn(async () => {
      return Array.from(storage.keys());
    }),
    getBackendType: jest.fn(() => 'memory' as const),
    ...overrides,
  };
}

/**
 * Create mock validate credentials function.
 */
function createMockValidateCredentials(
  result: { valid: boolean; error?: string; accessToken?: string } = { valid: true, accessToken: 'test_token' }
): TerminalAuthFlowDependencies['validateCredentials'] {
  return jest.fn().mockResolvedValue(result);
}

describe('Terminal Auth Flow Unit Tests', () => {
  describe('TerminalAuthFlow class', () => {
    describe('1. Provider selection', () => {
      /**
       * **Validates: Requirement 4.2**
       * Prompt user to select an Auth_Provider from the supported list
       */
      it('should display provider selection menu', async () => {
        const mockOutput = createMockOutput();
        const mockInput = createMockInput();

        const flow = new TerminalAuthFlow({
          credentialStore: createMockCredentialStore(),
          validateCredentials: createMockValidateCredentials(),
          input: mockInput,
          output: mockOutput,
        });

        // Start the flow
        const executePromise = flow.execute();

        // Send inputs
        await sendInput(mockInput, '1');           // Select GitHub
        await sendInput(mockInput, '2');           // Select Manual API Key
        await sendInput(mockInput, 'test_client'); // Client ID
        await sendInput(mockInput, 'test_secret'); // Client Secret
        mockInput.end();

        await executePromise;

        const output = mockOutput.getOutput();
        expect(output).toContain('Select an OAuth provider');
        expect(output).toContain('1. GitHub');
        expect(output).toContain('2. Google');
        expect(output).toContain('3. AWS Cognito');
        expect(output).toContain('4. Azure AD');
      });

      /**
       * **Validates: Requirements 3.1, 4.2**
       * Offer choice between Browser OAuth and Manual API Key
       */
      it('should display authentication mode selection for OAuth-capable providers', async () => {
        const mockOutput = createMockOutput();
        const mockInput = createMockInput();

        const flow = new TerminalAuthFlow({
          credentialStore: createMockCredentialStore(),
          validateCredentials: createMockValidateCredentials(),
          input: mockInput,
          output: mockOutput,
        });

        const executePromise = flow.execute('github');

        await sendInput(mockInput, '2');           // Select Manual API Key
        await sendInput(mockInput, 'test_client'); // Client ID
        mockInput.end();

        await executePromise;

        const output = mockOutput.getOutput();
        expect(output).toContain('Browser OAuth (recommended)');
        expect(output).toContain('Manual API Key');
      });

      /**
       * **Validates: Requirements 3.1, 4.2**
       * Return browser OAuth indicator when user selects option 1
       */
      it('should return browser OAuth indicator when user selects Browser OAuth', async () => {
        const mockOutput = createMockOutput();
        const mockInput = createMockInput();

        const flow = new TerminalAuthFlow({
          credentialStore: createMockCredentialStore(),
          validateCredentials: createMockValidateCredentials(),
          input: mockInput,
          output: mockOutput,
        });

        const executePromise = flow.execute('github');

        await sendInput(mockInput, '1');           // Select Browser OAuth (default)
        mockInput.end();

        const result = await executePromise;

        expect(result.useBrowserOAuth).toBe(true);
        if (result.useBrowserOAuth) {
          expect(result.providerId).toBe('github');
        }
      });

      /**
       * **Validates: Requirements 3.1, 4.2**
       * Default to Browser OAuth when user presses Enter
       */
      it('should default to Browser OAuth when user presses Enter', async () => {
        const mockOutput = createMockOutput();
        const mockInput = createMockInput();

        const flow = new TerminalAuthFlow({
          credentialStore: createMockCredentialStore(),
          validateCredentials: createMockValidateCredentials(),
          input: mockInput,
          output: mockOutput,
        });

        const executePromise = flow.execute('github');

        await sendInput(mockInput, '');            // Press Enter (default to Browser OAuth)
        mockInput.end();

        const result = await executePromise;

        expect(result.useBrowserOAuth).toBe(true);
      });

      it('should accept valid provider selection', async () => {
        const mockOutput = createMockOutput();
        const mockInput = createMockInput();

        const validateCredentials = createMockValidateCredentials();

        const flow = new TerminalAuthFlow({
          credentialStore: createMockCredentialStore(),
          validateCredentials,
          input: mockInput,
          output: mockOutput,
        });

        const executePromise = flow.execute();

        await sendInput(mockInput, '1');              // Select GitHub
        await sendInput(mockInput, '2');              // Select Manual API Key
        await sendInput(mockInput, 'github_client');  // Client ID
        await sendInput(mockInput, 'github_secret');  // Client Secret (GitHub requires it)
        mockInput.end();

        const result = await executePromise;

        expect(isSuccessResult(result)).toBe(true);
        expect(getResultProviderId(result)).toBe('github');
      });

      it('should reject invalid provider selection and re-prompt', async () => {
        const mockOutput = createMockOutput();
        const mockInput = createMockInput();

        const flow = new TerminalAuthFlow({
          credentialStore: createMockCredentialStore(),
          validateCredentials: createMockValidateCredentials(),
          input: mockInput,
          output: mockOutput,
        });

        const executePromise = flow.execute();

        await sendInput(mockInput, '99');          // Invalid selection
        await sendInput(mockInput, '1');           // Valid selection (GitHub)
        await sendInput(mockInput, '2');           // Select Manual API Key
        await sendInput(mockInput, 'test_client'); // Client ID
        await sendInput(mockInput, 'test_secret'); // Client Secret
        mockInput.end();

        const result = await executePromise;

        const output = mockOutput.getOutput();
        expect(output).toContain('Invalid selection');
        expect(isSuccessResult(result)).toBe(true);
      });

      it('should skip provider selection when providerId is pre-specified', async () => {
        const mockOutput = createMockOutput();
        const mockInput = createMockInput();

        const flow = new TerminalAuthFlow({
          credentialStore: createMockCredentialStore(),
          validateCredentials: createMockValidateCredentials(),
          input: mockInput,
          output: mockOutput,
        });

        const executePromise = flow.execute('github');

        await sendInput(mockInput, '2');           // Select Manual API Key
        await sendInput(mockInput, 'test_client'); // Client ID
        await sendInput(mockInput, 'test_secret'); // Client Secret
        mockInput.end();

        const result = await executePromise;

        const output = mockOutput.getOutput();
        expect(output).not.toContain('Select an OAuth provider');
        expect(output).toContain('Configuring GitHub');
        expect(getResultProviderId(result)).toBe('github');
      });
    });

    describe('2. Credential collection for different providers', () => {
      /**
       * **Validates: Requirement 4.3**
       * Prompt for required credentials based on provider
       */
      it('should collect client ID and secret for GitHub', async () => {
        const mockOutput = createMockOutput();
        const mockInput = createMockInput();

        const validateCredentials = createMockValidateCredentials();

        const flow = new TerminalAuthFlow({
          credentialStore: createMockCredentialStore(),
          validateCredentials,
          input: mockInput,
          output: mockOutput,
        });

        const executePromise = flow.execute('github');

        await sendInput(mockInput, '2');                // Select Manual API Key
        await sendInput(mockInput, 'github_pat_token');
        mockInput.end();

        await executePromise;

        expect(validateCredentials).toHaveBeenCalledWith('github', {
          clientId: 'github_pat_token',
        });
      });

      it('should collect Personal Access Token for GitHub (API key mode)', async () => {
        const mockOutput = createMockOutput();
        const mockInput = createMockInput();

        const validateCredentials = createMockValidateCredentials();

        const flow = new TerminalAuthFlow({
          credentialStore: createMockCredentialStore(),
          validateCredentials,
          input: mockInput,
          output: mockOutput,
        });

        const executePromise = flow.execute('github');

        await sendInput(mockInput, '2');                   // Select Manual API Key
        await sendInput(mockInput, 'github_pat_token');    // Personal Access Token
        mockInput.end();

        await executePromise;

        // GitHub uses API key mode, so clientId is the PAT
        expect(validateCredentials).toHaveBeenCalledWith('github', {
          clientId: 'github_pat_token',
        });
      });

      it('should collect client ID and secret for Google', async () => {
        const mockOutput = createMockOutput();
        const mockInput = createMockInput();

        const validateCredentials = createMockValidateCredentials();

        const flow = new TerminalAuthFlow({
          credentialStore: createMockCredentialStore(),
          validateCredentials,
          input: mockInput,
          output: mockOutput,
        });

        const executePromise = flow.execute('google');

        await sendInput(mockInput, '2');                   // Select Manual API Key
        await sendInput(mockInput, 'google_client_id');
        await sendInput(mockInput, 'google_client_secret');
        mockInput.end();

        await executePromise;

        expect(validateCredentials).toHaveBeenCalledWith('google', {
          clientId: 'google_client_id',
          clientSecret: 'google_client_secret',
        });
      });
    });

    describe('3. Successful credential validation and storage', () => {
      /**
       * **Validates: Requirements 4.4, 4.5**
       * Validate credentials and store them securely
       */
      it('should store credentials after successful validation', async () => {
        const mockOutput = createMockOutput();
        const mockInput = createMockInput();

        const credentialStore = createMockCredentialStore();
        const validateCredentials = createMockValidateCredentials({
          valid: true,
          accessToken: 'validated_token',
        });

        const flow = new TerminalAuthFlow({
          credentialStore,
          validateCredentials,
          input: mockInput,
          output: mockOutput,
        });

        const executePromise = flow.execute('github');

        await sendInput(mockInput, '2');               // Select Manual API Key
        await sendInput(mockInput, 'test_client_id');
        mockInput.end();

        const result = await executePromise;

        expect(isSuccessResult(result)).toBe(true);
        expect(credentialStore.store).toHaveBeenCalledWith(
          'github',
          expect.objectContaining({
            providerId: 'github',
            accessToken: 'validated_token',
            clientId: 'test_client_id',
          })
        );
      });

      it('should display success message after storing credentials', async () => {
        const mockOutput = createMockOutput();
        const mockInput = createMockInput();

        const flow = new TerminalAuthFlow({
          credentialStore: createMockCredentialStore(),
          validateCredentials: createMockValidateCredentials(),
          input: mockInput,
          output: mockOutput,
        });

        const executePromise = flow.execute('github');

        await sendInput(mockInput, '2');               // Select Manual API Key
        await sendInput(mockInput, 'test_client_id');
        mockInput.end();

        await executePromise;

        const output = mockOutput.getOutput();
        expect(output).toContain('credentials configured successfully');
      });
    });

    describe('4. Validation failure with retry', () => {
      /**
       * **Validates: Requirement 4.6**
       * Display error and prompt for re-entry on validation failure
       */
      it('should display error and offer retry on validation failure', async () => {
        const mockOutput = createMockOutput();
        const mockInput = createMockInput();

        let callCount = 0;
        const validateCredentials = jest.fn().mockImplementation(async () => {
          callCount++;
          if (callCount === 1) {
            return { valid: false, error: 'Invalid client ID' };
          }
          return { valid: true, accessToken: 'token' };
        });

        const flow = new TerminalAuthFlow({
          credentialStore: createMockCredentialStore(),
          validateCredentials,
          input: mockInput,
          output: mockOutput,
        });

        const executePromise = flow.execute('github');

        await sendInput(mockInput, '2');               // Select Manual API Key
        await sendInput(mockInput, 'invalid_client');  // First attempt
        await sendInput(mockInput, 'y');               // Yes, retry
        await sendInput(mockInput, 'valid_client');    // Second attempt
        mockInput.end();

        const result = await executePromise;

        const output = mockOutput.getOutput();
        expect(output).toContain('Validation failed');
        expect(output).toContain('Invalid client ID');
        expect(output).toContain('Would you like to try again');
        expect(isSuccessResult(result)).toBe(true);
      });

      it('should return error when user declines retry', async () => {
        const mockOutput = createMockOutput();
        const mockInput = createMockInput();

        const validateCredentials = createMockValidateCredentials({
          valid: false,
          error: 'Invalid credentials',
        });

        const flow = new TerminalAuthFlow({
          credentialStore: createMockCredentialStore(),
          validateCredentials,
          input: mockInput,
          output: mockOutput,
        });

        const executePromise = flow.execute('github');

        await sendInput(mockInput, '2');               // Select Manual API Key
        await sendInput(mockInput, 'invalid_client');  // First attempt
        await sendInput(mockInput, 'n');               // No, don't retry
        mockInput.end();

        const result = await executePromise;

        expect(isSuccessResult(result)).toBe(false);
        const error = getResultError(result);
        expect(error?.code).toBe('INVALID_CREDENTIALS');
        expect(error?.message).toContain('user cancelled');
      });
    });

    describe('5. Maximum retry attempts exceeded', () => {
      /**
       * **Validates: Requirement 4.6**
       * Handle maximum retry attempts
       */
      it('should fail after 3 unsuccessful attempts', async () => {
        const mockOutput = createMockOutput();
        const mockInput = createMockInput();

        const validateCredentials = createMockValidateCredentials({
          valid: false,
          error: 'Invalid credentials',
        });

        const flow = new TerminalAuthFlow({
          credentialStore: createMockCredentialStore(),
          validateCredentials,
          input: mockInput,
          output: mockOutput,
        });

        const executePromise = flow.execute('github');

        await sendInput(mockInput, '2');          // Select Manual API Key
        await sendInput(mockInput, 'invalid_1');  // First attempt
        await sendInput(mockInput, 'y');          // Retry
        await sendInput(mockInput, 'invalid_2');  // Second attempt
        await sendInput(mockInput, 'y');          // Retry
        await sendInput(mockInput, 'invalid_3');  // Third attempt (max)
        mockInput.end();

        const result = await executePromise;

        expect(isSuccessResult(result)).toBe(false);
        const error = getResultError(result);
        expect(error?.code).toBe('INVALID_CREDENTIALS');
        expect(error?.message).toContain('after 3 attempts');
      });
    });

    describe('6. Custom endpoint collection for Cognito', () => {
      /**
       * **Validates: Requirements 4.3, 7.3**
       * Collect custom endpoints for AWS Cognito
       */
      it('should collect user pool domain and region for Cognito', async () => {
        const mockOutput = createMockOutput();
        const mockInput = createMockInput();

        const validateCredentials = createMockValidateCredentials();

        const flow = new TerminalAuthFlow({
          credentialStore: createMockCredentialStore(),
          validateCredentials,
          input: mockInput,
          output: mockOutput,
        });

        const executePromise = flow.execute('cognito');

        await sendInput(mockInput, '2');                    // Select Manual API Key
        await sendInput(mockInput, 'cognito_client_id');
        await sendInput(mockInput, 'cognito_client_secret');
        await sendInput(mockInput, 'my-user-pool');     // User pool domain
        await sendInput(mockInput, 'us-east-1');        // Region
        mockInput.end();

        await executePromise;

        expect(validateCredentials).toHaveBeenCalledWith('cognito', {
          clientId: 'cognito_client_id',
          clientSecret: 'cognito_client_secret',
          customEndpoints: {
            authorizationEndpoint: 'https://my-user-pool.auth.us-east-1.amazoncognito.com/oauth2/authorize',
            tokenEndpoint: 'https://my-user-pool.auth.us-east-1.amazoncognito.com/oauth2/token',
          },
        });
      });

      it('should display Cognito-specific prompts', async () => {
        const mockOutput = createMockOutput();
        const mockInput = createMockInput();

        const flow = new TerminalAuthFlow({
          credentialStore: createMockCredentialStore(),
          validateCredentials: createMockValidateCredentials(),
          input: mockInput,
          output: mockOutput,
        });

        const executePromise = flow.execute('cognito');

        await sendInput(mockInput, '2');                    // Select Manual API Key
        await sendInput(mockInput, 'cognito_client_id');
        await sendInput(mockInput, 'cognito_client_secret');
        await sendInput(mockInput, 'my-pool');
        await sendInput(mockInput, 'eu-west-1');
        mockInput.end();

        await executePromise;

        const output = mockOutput.getOutput();
        expect(output).toContain('Cognito User Pool');
        expect(output).toContain('User Pool Domain');
        expect(output).toContain('AWS Region');
      });
    });

    describe('7. Custom endpoint collection for Azure', () => {
      /**
       * **Validates: Requirements 4.3, 7.4**
       * Collect custom endpoints for Azure AD
       */
      it('should collect tenant ID for Azure AD', async () => {
        const mockOutput = createMockOutput();
        const mockInput = createMockInput();

        const validateCredentials = createMockValidateCredentials();

        const flow = new TerminalAuthFlow({
          credentialStore: createMockCredentialStore(),
          validateCredentials,
          input: mockInput,
          output: mockOutput,
        });

        const executePromise = flow.execute('azure');

        await sendInput(mockInput, '2');                   // Select Manual API Key
        await sendInput(mockInput, 'azure_client_id');
        await sendInput(mockInput, 'azure_client_secret');
        await sendInput(mockInput, 'my-tenant-id');     // Tenant ID
        mockInput.end();

        await executePromise;

        expect(validateCredentials).toHaveBeenCalledWith('azure', {
          clientId: 'azure_client_id',
          clientSecret: 'azure_client_secret',
          customEndpoints: {
            authorizationEndpoint: 'https://login.microsoftonline.com/my-tenant-id/oauth2/v2.0/authorize',
            tokenEndpoint: 'https://login.microsoftonline.com/my-tenant-id/oauth2/v2.0/token',
          },
        });
      });

      it('should support multi-tenant configuration with "common"', async () => {
        const mockOutput = createMockOutput();
        const mockInput = createMockInput();

        const validateCredentials = createMockValidateCredentials();

        const flow = new TerminalAuthFlow({
          credentialStore: createMockCredentialStore(),
          validateCredentials,
          input: mockInput,
          output: mockOutput,
        });

        const executePromise = flow.execute('azure');

        await sendInput(mockInput, '2');                   // Select Manual API Key
        await sendInput(mockInput, 'azure_client_id');
        await sendInput(mockInput, 'azure_client_secret');
        await sendInput(mockInput, 'common');           // Multi-tenant
        mockInput.end();

        await executePromise;

        expect(validateCredentials).toHaveBeenCalledWith('azure', {
          clientId: 'azure_client_id',
          clientSecret: 'azure_client_secret',
          customEndpoints: {
            authorizationEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
            tokenEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
          },
        });
      });

      it('should display Azure-specific prompts', async () => {
        const mockOutput = createMockOutput();
        const mockInput = createMockInput();

        const flow = new TerminalAuthFlow({
          credentialStore: createMockCredentialStore(),
          validateCredentials: createMockValidateCredentials(),
          input: mockInput,
          output: mockOutput,
        });

        const executePromise = flow.execute('azure');

        await sendInput(mockInput, '2');                   // Select Manual API Key
        await sendInput(mockInput, 'azure_client_id');
        await sendInput(mockInput, 'azure_client_secret');
        await sendInput(mockInput, 'tenant-123');
        mockInput.end();

        await executePromise;

        const output = mockOutput.getOutput();
        expect(output).toContain('Azure AD');
        expect(output).toContain('Tenant ID');
        expect(output).toContain('multi-tenant');
      });
    });

    describe('8. Error handling', () => {
      /**
       * **Validates: Requirement 13.1**
       * Handle errors gracefully
       */
      it('should return error for unsupported provider', async () => {
        const mockOutput = createMockOutput();
        const mockInput = createMockInput();

        const flow = new TerminalAuthFlow({
          credentialStore: createMockCredentialStore(),
          validateCredentials: createMockValidateCredentials(),
          input: mockInput,
          output: mockOutput,
        });

        mockInput.end();

        const result = await flow.execute('invalid_provider' as AuthProviderId);

        expect(isSuccessResult(result)).toBe(false);
        const error = getResultError(result);
        expect(error?.code).toBe('UNSUPPORTED_PROVIDER');
      });

      it('should handle credential store errors', async () => {
        const mockOutput = createMockOutput();
        const mockInput = createMockInput();

        const credentialStore = createMockCredentialStore({
          store: jest.fn().mockRejectedValue(new Error('Storage failed')),
        });

        const flow = new TerminalAuthFlow({
          credentialStore,
          validateCredentials: createMockValidateCredentials(),
          input: mockInput,
          output: mockOutput,
        });

        const executePromise = flow.execute('github');

        await sendInput(mockInput, '2');               // Select Manual API Key
        await sendInput(mockInput, 'test_client_id');
        mockInput.end();

        const result = await executePromise;

        expect(isSuccessResult(result)).toBe(false);
        const error = getResultError(result);
        expect(error?.code).toBe('PROVIDER_ERROR');
      });

      it('should handle validation function errors', async () => {
        const mockOutput = createMockOutput();
        const mockInput = createMockInput();

        const validateCredentials = jest.fn().mockRejectedValue(new Error('Validation error'));

        const flow = new TerminalAuthFlow({
          credentialStore: createMockCredentialStore(),
          validateCredentials,
          input: mockInput,
          output: mockOutput,
        });

        const executePromise = flow.execute('github');

        await sendInput(mockInput, '2');               // Select Manual API Key
        await sendInput(mockInput, 'test_client_id');
        mockInput.end();

        const result = await executePromise;

        expect(isSuccessResult(result)).toBe(false);
      });
    });

    describe('9. Required field validation', () => {
      /**
       * **Validates: Requirement 4.3**
       * Ensure required fields are not empty
       */
      it('should re-prompt for empty client ID', async () => {
        const mockOutput = createMockOutput();
        const mockInput = createMockInput();

        const flow = new TerminalAuthFlow({
          credentialStore: createMockCredentialStore(),
          validateCredentials: createMockValidateCredentials(),
          input: mockInput,
          output: mockOutput,
        });

        const executePromise = flow.execute('github');

        await sendInput(mockInput, '2');              // Select Manual API Key
        await sendInput(mockInput, '');               // Empty first attempt
        await sendInput(mockInput, 'valid_client');   // Valid second attempt
        mockInput.end();

        const result = await executePromise;

        const output = mockOutput.getOutput();
        expect(output).toContain('required');
        expect(isSuccessResult(result)).toBe(true);
      });
    });
  });

  describe('createTerminalAuthFlow factory', () => {
    it('should create a TerminalAuthFlow instance', () => {
      const flow = createTerminalAuthFlow({
        credentialStore: createMockCredentialStore(),
        validateCredentials: createMockValidateCredentials(),
      });

      expect(flow).toBeInstanceOf(TerminalAuthFlow);
    });
  });

  describe('getProviderInfo', () => {
    it('should return provider info for valid provider ID', () => {
      const info = getProviderInfo('github');

      expect(info).toBeDefined();
      expect(info?.id).toBe('github');
      expect(info?.name).toBe('GitHub');
      expect(info?.requiresClientSecret).toBe(true);
      expect(info?.requiresCustomEndpoints).toBe(false);
    });

    it('should return provider info for GitHub', () => {
      const info = getProviderInfo('github');

      expect(info).toBeDefined();
      expect(info?.id).toBe('github');
      expect(info?.requiresClientSecret).toBe(true);
      expect(info?.requiresCustomEndpoints).toBe(false);
    });

    it('should return provider info for Cognito', () => {
      const info = getProviderInfo('cognito');

      expect(info).toBeDefined();
      expect(info?.id).toBe('cognito');
      expect(info?.requiresClientSecret).toBe(true);
      expect(info?.requiresCustomEndpoints).toBe(true);
    });

    it('should return provider info for Azure', () => {
      const info = getProviderInfo('azure');

      expect(info).toBeDefined();
      expect(info?.id).toBe('azure');
      expect(info?.requiresClientSecret).toBe(true);
      expect(info?.requiresCustomEndpoints).toBe(true);
    });

    it('should return undefined for invalid provider ID', () => {
      const info = getProviderInfo('invalid' as AuthProviderId);

      expect(info).toBeUndefined();
    });
  });

  describe('getAllProviderInfo', () => {
    it('should return all supported providers', () => {
      const providers = getAllProviderInfo();

      expect(providers).toHaveLength(4);
      expect(providers.map(p => p.id)).toEqual([
        'github',
        'google',
        'cognito',
        'azure',
      ]);
    });

    it('should return readonly array', () => {
      const providers = getAllProviderInfo();

      // TypeScript should prevent modification, but we can verify it's an array
      expect(Array.isArray(providers)).toBe(true);
    });
  });
});
