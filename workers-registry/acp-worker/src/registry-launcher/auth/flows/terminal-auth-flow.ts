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
 * Interactive CLI setup flow for headless/manual credential configuration.
 *
 * Implements the terminal auth flow for configuring OAuth credentials
 * in headless environments without browser access.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
 *
 * @module flows/terminal-auth-flow
 */

import * as readline from 'readline';
import type {
  AuthProviderId,
  AuthResult,
  StoredCredentials,
  ProviderEndpoints,
} from '../types.js';
import { VALID_PROVIDER_IDS } from '../types.js';
import type { ICredentialStore } from '../storage/types.js';

/**
 * Authentication mode selected by the user.
 * Requirements: 3.1, 4.2
 */
export type AuthenticationMode = 'browser-oauth' | 'manual-api-key';

/**
 * Result indicating browser OAuth flow should be used.
 * This is returned when the user selects "Browser OAuth" mode.
 */
export interface BrowserOAuthResult {
  /** Indicates browser OAuth flow should be used */
  useBrowserOAuth: true;
  /** The selected provider ID */
  providerId: AuthProviderId;
}

/**
 * Result indicating manual credential flow completed.
 */
export interface ManualCredentialResult {
  /** Indicates manual credential flow was used */
  useBrowserOAuth: false;
  /** The authentication result from manual flow */
  authResult: AuthResult;
}

/**
 * Combined result type for terminal auth flow execution.
 */
export type TerminalAuthFlowResult = BrowserOAuthResult | ManualCredentialResult;

/**
 * Provider display information for the selection menu.
 */
interface ProviderInfo {
  id: AuthProviderId;
  name: string;
  requiresClientSecret: boolean;
  requiresCustomEndpoints: boolean;
  /** Whether this provider supports simple API key authentication */
  supportsApiKey: boolean;
  /** Whether this provider supports browser-based OAuth flow */
  supportsOAuth: boolean;
  /** Label for the API key (e.g., "API Key", "Personal Access Token") */
  apiKeyLabel?: string;
  /** Environment variable name for the API key */
  apiKeyEnvVar?: string;
}

/**
 * Provider information for display and configuration.
 * Per ACP Registry spec: OpenAI, Anthropic support API key alternative,
 * GitHub supports Personal Access Token alternative.
 * All providers support browser-based OAuth flow.
 */
const PROVIDER_INFO: readonly ProviderInfo[] = [
  { id: 'openai', name: 'OpenAI', requiresClientSecret: false, requiresCustomEndpoints: false, supportsApiKey: true, supportsOAuth: true, apiKeyLabel: 'API Key', apiKeyEnvVar: 'OPENAI_API_KEY' },
  { id: 'github', name: 'GitHub', requiresClientSecret: true, requiresCustomEndpoints: false, supportsApiKey: true, supportsOAuth: true, apiKeyLabel: 'Personal Access Token', apiKeyEnvVar: 'GITHUB_TOKEN' },
  { id: 'google', name: 'Google', requiresClientSecret: true, requiresCustomEndpoints: false, supportsApiKey: false, supportsOAuth: true },
  { id: 'cognito', name: 'AWS Cognito', requiresClientSecret: true, requiresCustomEndpoints: true, supportsApiKey: false, supportsOAuth: true },
  { id: 'azure', name: 'Azure AD', requiresClientSecret: true, requiresCustomEndpoints: true, supportsApiKey: false, supportsOAuth: true },
  { id: 'anthropic', name: 'Anthropic', requiresClientSecret: false, requiresCustomEndpoints: false, supportsApiKey: true, supportsOAuth: true, apiKeyLabel: 'API Key', apiKeyEnvVar: 'ANTHROPIC_API_KEY' },
] as const;


/**
 * Collected credentials from user input.
 */
export interface CollectedCredentials {
  clientId: string;
  clientSecret?: string;
  customEndpoints?: ProviderEndpoints;
}

/**
 * Dependencies for the terminal auth flow.
 */
export interface TerminalAuthFlowDependencies {
  /** Credential store for persisting credentials */
  credentialStore: ICredentialStore;
  /** Function to validate credentials (attempts token request) */
  validateCredentials: (
    providerId: AuthProviderId,
    credentials: CollectedCredentials
  ) => Promise<{ valid: boolean; error?: string; accessToken?: string }>;
  /** Optional custom input/output streams (for testing) */
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

/**
 * Terminal auth flow - interactive CLI setup.
 *
 * Provides an interactive terminal interface for configuring OAuth credentials
 * in headless environments. The flow:
 * 1. Prompts user to select a provider
 * 2. Prompts for required credentials
 * 3. Validates credentials by attempting a token request
 * 4. Stores credentials securely on success
 * 5. Prompts for re-entry on validation failure
 */
export class TerminalAuthFlow {
  private readonly credentialStore: ICredentialStore;
  private readonly validateCredentials: TerminalAuthFlowDependencies['validateCredentials'];
  private readonly input: NodeJS.ReadableStream;
  private readonly output: NodeJS.WritableStream;
  private rl: readline.Interface | null = null;

  /**
   * Create a new terminal auth flow.
   *
   * @param dependencies - Flow dependencies
   */
  constructor(dependencies: TerminalAuthFlowDependencies) {
    this.credentialStore = dependencies.credentialStore;
    this.validateCredentials = dependencies.validateCredentials;
    this.input = dependencies.input ?? process.stdin;
    this.output = dependencies.output ?? process.stderr;
  }

  /**
   * Execute the terminal auth flow.
   *
   * Runs the interactive setup wizard to configure OAuth credentials.
   * For providers supporting OAuth, offers a choice between browser OAuth
   * and manual API key entry.
   *
   * Requirements: 3.1, 4.2
   *
   * @param providerId - Optional pre-selected provider (skips provider selection)
   * @returns Terminal auth flow result indicating mode selection and outcome
   */
  async execute(providerId?: AuthProviderId): Promise<TerminalAuthFlowResult> {
    this.rl = readline.createInterface({
      input: this.input,
      output: this.output,
    });

    try {
      this.writeLine('\n=== OAuth Authentication Setup ===\n');

      // Step 1: Select provider (Requirement 4.2)
      const selectedProvider = providerId ?? await this.selectProvider();
      const providerInfo = PROVIDER_INFO.find(p => p.id === selectedProvider);

      if (!providerInfo) {
        return {
          useBrowserOAuth: false,
          authResult: {
            success: false,
            providerId: selectedProvider,
            error: {
              code: 'UNSUPPORTED_PROVIDER',
              message: `Provider '${selectedProvider}' is not supported.`,
              details: { supportedProviders: VALID_PROVIDER_IDS },
            },
          },
        };
      }

      this.writeLine(`\nConfiguring ${providerInfo.name}...\n`);

      // Step 2: Select authentication mode (Requirement 3.1, 4.2)
      // For providers supporting OAuth, offer choice between browser OAuth and manual
      if (providerInfo.supportsOAuth) {
        const authMode = await this.selectAuthenticationMode(providerInfo);

        if (authMode === 'browser-oauth') {
          // Return indicator that browser OAuth flow should be used
          this.writeLine('\nBrowser OAuth selected. Launching browser authentication flow...\n');
          return {
            useBrowserOAuth: true,
            providerId: selectedProvider,
          };
        }
      }

      // Step 3-5: Collect and validate credentials with retry loop (manual flow)
      const result = await this.collectAndValidateWithRetry(selectedProvider, providerInfo);
      return {
        useBrowserOAuth: false,
        authResult: result,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[TerminalAuthFlow] Error: ${errorMessage}`);

      return {
        useBrowserOAuth: false,
        authResult: {
          success: false,
          providerId: providerId || 'openai',
          error: {
            code: 'PROVIDER_ERROR',
            message: `Terminal auth flow failed: ${errorMessage}`,
          },
        },
      };
    } finally {
      this.cleanup();
    }
  }

  /**
   * Select authentication mode for providers supporting OAuth.
   * Offers choice between browser OAuth (recommended) and manual API key.
   *
   * Requirements: 3.1, 4.2
   *
   * @param providerInfo - Provider information
   * @returns Selected authentication mode
   */
  private async selectAuthenticationMode(providerInfo: ProviderInfo): Promise<AuthenticationMode> {
    this.writeLine(`${providerInfo.name} supports multiple authentication methods:\n`);
    this.writeLine('  1. Browser OAuth (recommended) - Opens browser for secure authentication');
    this.writeLine('  2. Manual API Key - Enter credentials directly in terminal\n');

    const selection = await this.promptSelection('Select authentication method (1-2) [default: 1]: ', 1, 2, 1);

    return selection === 1 ? 'browser-oauth' : 'manual-api-key';
  }


  /**
   * Collect and validate credentials with retry loop.
   * Requirements: 4.3, 4.4, 4.5, 4.6
   *
   * Note: When this method is called, the user has already selected "Manual API Key"
   * in the authentication mode selection. For providers that support simple API key
   * authentication (OpenAI, Anthropic, GitHub), we collect the API key directly.
   * For providers that don't support simple API key (Google, Cognito, Azure),
   * we collect OAuth client credentials.
   */
  private async collectAndValidateWithRetry(
    selectedProvider: AuthProviderId,
    providerInfo: ProviderInfo
  ): Promise<AuthResult> {
    let credentials: CollectedCredentials | null = null;
    let validationResult: { valid: boolean; error?: string; accessToken?: string } | null = null;
    let attempts = 0;
    const maxAttempts = 3;

    // For providers that support simple API key, use API key mode directly
    // (user already selected "Manual API Key" in auth mode selection)
    const useApiKey = providerInfo.supportsApiKey;

    while (attempts < maxAttempts) {
      attempts++;

      // Collect credentials (Requirement 4.3)
      if (useApiKey) {
        credentials = await this.collectApiKeyCredentials(providerInfo);
      } else {
        credentials = await this.collectCredentials(providerInfo);
      }

      // Validate credentials (Requirement 4.4)
      this.writeLine('\nValidating credentials...');
      validationResult = await this.validateCredentials(selectedProvider, credentials);

      if (validationResult.valid) {
        break;
      }

      // Display error and prompt for re-entry (Requirement 4.6)
      this.writeLine(`\nValidation failed: ${validationResult.error || 'Unknown error'}`);

      if (attempts < maxAttempts) {
        const retry = await this.promptYesNo('Would you like to try again?');
        if (!retry) {
          return {
            success: false,
            providerId: selectedProvider,
            error: {
              code: 'INVALID_CREDENTIALS',
              message: 'Credential validation failed and user cancelled retry.',
              details: { validationError: validationResult.error },
            },
          };
        }
        this.writeLine('');
      }
    }

    if (!validationResult?.valid || !credentials) {
      return {
        success: false,
        providerId: selectedProvider,
        error: {
          code: 'INVALID_CREDENTIALS',
          message: `Credential validation failed after ${maxAttempts} attempts.`,
          details: { validationError: validationResult?.error },
        },
      };
    }

    // Enforce invariant: valid credentials must have a non-empty access token
    if (!validationResult.accessToken || validationResult.accessToken.trim() === '') {
      return {
        success: false,
        providerId: selectedProvider,
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Credential validation succeeded but no access token was returned.',
        },
      };
    }

    // Step 5: Store credentials securely (Requirement 4.5)
    const storedCredentials: StoredCredentials = {
      providerId: selectedProvider,
      accessToken: validationResult.accessToken,
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      customEndpoints: credentials.customEndpoints,
      storedAt: Date.now(),
    };

    await this.credentialStore.store(selectedProvider, storedCredentials);

    this.writeLine(`\n${providerInfo.name} credentials configured successfully!\n`);

    return {
      success: true,
      providerId: selectedProvider,
    };
  }

  /**
   * Prompt for a numeric selection within a range.
   * Supports an optional default value that is used when user presses Enter without input.
   *
   * @param message - The prompt message
   * @param min - Minimum valid selection
   * @param max - Maximum valid selection
   * @param defaultValue - Optional default value used when input is empty
   * @returns The selected number
   */
  private async promptSelection(message: string, min: number, max: number, defaultValue?: number): Promise<number> {
    while (true) {
      const input = await this.prompt(message);
      const trimmed = input.trim();

      // If input is empty and we have a default, use it
      if (trimmed === '' && defaultValue !== undefined) {
        return defaultValue;
      }

      const selection = parseInt(trimmed, 10);

      if (selection >= min && selection <= max) {
        return selection;
      }

      this.writeLine(`Invalid selection. Please enter a number between ${min} and ${max}.`);
    }
  }

  /**
   * Collect API key credentials (simple mode for OpenAI, Anthropic, GitHub).
   */
  private async collectApiKeyCredentials(providerInfo: ProviderInfo): Promise<CollectedCredentials> {
    const label = providerInfo.apiKeyLabel || 'API Key';
    const envVar = providerInfo.apiKeyEnvVar;

    if (envVar) {
      this.writeLine(`(You can also set this via ${envVar} environment variable)\n`);
    }

    const apiKey = await this.promptSecret(`${label}: `);

    // For API key auth, we store the API key as the clientId
    // The actual token will be the API key itself
    return {
      clientId: apiKey,
      // No clientSecret needed for API key auth
    };
  }

  /**
   * Prompt user to select a provider from the supported list.
   * Requirement 4.2
   */
  private async selectProvider(): Promise<AuthProviderId> {
    this.writeLine('Select an OAuth provider:\n');

    PROVIDER_INFO.forEach((provider, index) => {
      this.writeLine(`  ${index + 1}. ${provider.name}`);
    });

    this.writeLine('');

    while (true) {
      const input = await this.prompt(`Enter selection (1-${PROVIDER_INFO.length}): `);
      const selection = parseInt(input.trim(), 10);

      if (selection >= 1 && selection <= PROVIDER_INFO.length) {
        return PROVIDER_INFO[selection - 1].id;
      }

      this.writeLine(`Invalid selection. Please enter a number between 1 and ${PROVIDER_INFO.length}.`);
    }
  }


  /**
   * Collect credentials from user input.
   * Requirement 4.3
   */
  private async collectCredentials(providerInfo: ProviderInfo): Promise<CollectedCredentials> {
    const credentials: CollectedCredentials = {
      clientId: '',
    };

    // Always prompt for client ID
    credentials.clientId = await this.promptRequired('Client ID: ');

    // Prompt for client secret if required
    if (providerInfo.requiresClientSecret) {
      credentials.clientSecret = await this.promptSecret('Client Secret: ');
    }

    // Prompt for custom endpoints if required (Cognito/Azure)
    if (providerInfo.requiresCustomEndpoints) {
      credentials.customEndpoints = await this.collectCustomEndpoints(providerInfo);
    }

    return credentials;
  }

  /**
   * Collect custom endpoints for providers that require them (Cognito/Azure).
   * Validates all endpoints to ensure HTTPS and no embedded credentials.
   */
  private async collectCustomEndpoints(providerInfo: ProviderInfo): Promise<ProviderEndpoints> {
    this.writeLine(`\n${providerInfo.name} requires custom endpoint configuration:\n`);

    if (providerInfo.id === 'cognito') {
      return this.collectCognitoEndpoints();
    } else if (providerInfo.id === 'azure') {
      return this.collectAzureEndpoints();
    }

    // Generic custom endpoints with HTTPS validation
    const authEndpoint = await this.promptValidatedUrl('Authorization Endpoint URL: ');
    const tokenEndpoint = await this.promptValidatedUrl('Token Endpoint URL: ');

    return {
      authorizationEndpoint: authEndpoint,
      tokenEndpoint: tokenEndpoint,
    };
  }

  /**
   * Prompt for a validated HTTPS URL.
   * Ensures the URL is valid, uses HTTPS, and has no embedded credentials.
   */
  private async promptValidatedUrl(message: string): Promise<string> {
    while (true) {
      const input = await this.promptRequired(message);
      const error = this.validateHttpsUrl(input);
      if (error === null) {
        return input;
      }
      this.writeLine(`Error: ${error}`);
    }
  }

  /**
   * Validate that a URL is a valid HTTPS URL without embedded credentials.
   */
  private validateHttpsUrl(value: string): string | null {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return 'Invalid URL format.';
    }
    if (url.protocol !== 'https:') {
      return 'URL must use HTTPS protocol for security.';
    }
    if (url.username || url.password) {
      return 'URL must not contain embedded credentials.';
    }
    return null;
  }

  /**
   * Collect Cognito-specific endpoint configuration.
   * Validates input to prevent URL injection attacks.
   */
  private async collectCognitoEndpoints(): Promise<ProviderEndpoints> {
    this.writeLine('Enter your Cognito User Pool details:\n');

    const userPoolDomain = await this.promptValidated(
      'User Pool Domain (e.g., my-app): ',
      this.validateCognitoDomain.bind(this)
    );
    const region = await this.promptValidated(
      'AWS Region (e.g., us-east-1): ',
      this.validateAwsRegion.bind(this)
    );

    const baseUrl = `https://${userPoolDomain}.auth.${region}.amazoncognito.com`;

    return {
      authorizationEndpoint: `${baseUrl}/oauth2/authorize`,
      tokenEndpoint: `${baseUrl}/oauth2/token`,
    };
  }

  /**
   * Collect Azure AD-specific endpoint configuration.
   * Validates input to prevent URL injection attacks.
   */
  private async collectAzureEndpoints(): Promise<ProviderEndpoints> {
    this.writeLine('Enter your Azure AD details:\n');

    const tenantId = await this.promptValidated(
      'Tenant ID (or "common" for multi-tenant): ',
      this.validateAzureTenantId.bind(this)
    );

    const baseUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0`;

    return {
      authorizationEndpoint: `${baseUrl}/authorize`,
      tokenEndpoint: `${baseUrl}/token`,
    };
  }

  /**
   * Validate Cognito user pool domain.
   * Must be alphanumeric with hyphens, no URL injection characters.
   */
  private validateCognitoDomain(value: string): string | null {
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i.test(value)) {
      return 'Invalid domain format. Must be alphanumeric with hyphens, no leading/trailing hyphens.';
    }
    if (value.length > 63) {
      return 'Domain must be 63 characters or less.';
    }
    if (/[/:?#@\s]/.test(value)) {
      return 'Domain contains invalid characters (/, :, ?, #, @, or whitespace).';
    }
    return null;
  }

  /**
   * Validate AWS region format.
   * Must match pattern like us-east-1, eu-west-2.
   */
  private validateAwsRegion(value: string): string | null {
    if (!/^[a-z]{2}-[a-z]+-\d+$/.test(value)) {
      return 'Invalid AWS region format. Expected format: us-east-1, eu-west-2, etc.';
    }
    return null;
  }

  /**
   * Validate Azure tenant ID.
   * Must be 'common', 'organizations', 'consumers', a valid GUID, or a domain name.
   */
  private validateAzureTenantId(value: string): string | null {
    const wellKnown = ['common', 'organizations', 'consumers'];
    if (wellKnown.includes(value.toLowerCase())) {
      return null;
    }
    // GUID pattern
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
      return null;
    }
    // Domain pattern (no URL injection chars)
    if (/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i.test(value)) {
      return null;
    }
    if (/[/:?#@\s]/.test(value)) {
      return 'Tenant ID contains invalid characters (/, :, ?, #, @, or whitespace).';
    }
    return "Invalid tenant ID. Must be 'common', 'organizations', 'consumers', a valid GUID, or a domain name.";
  }

  /**
   * Prompt for input with validation.
   */
  private async promptValidated(
    message: string,
    validator: (value: string) => string | null
  ): Promise<string> {
    while (true) {
      const input = await this.promptRequired(message);
      const error = validator(input);
      if (error === null) {
        return input;
      }
      this.writeLine(`Error: ${error}`);
    }
  }


  /**
   * Prompt for required input (non-empty).
   */
  private async promptRequired(message: string): Promise<string> {
    while (true) {
      const input = await this.prompt(message);
      const trimmed = input.trim();

      if (trimmed.length > 0) {
        return trimmed;
      }

      this.writeLine('This field is required. Please enter a value.');
    }
  }

  /**
   * Prompt for secret input (hidden if possible).
   * Note: In a real implementation, this would hide input.
   * For headless environments, we accept visible input.
   */
  private async promptSecret(message: string): Promise<string> {
    // In headless environments, we can't easily hide input
    // The user should be aware they're entering sensitive data
    this.writeLine('(Note: Input will be visible in terminal)');
    return this.promptRequired(message);
  }

  /**
   * Prompt for yes/no confirmation.
   */
  private async promptYesNo(message: string): Promise<boolean> {
    while (true) {
      const input = await this.prompt(`${message} (y/n): `);
      const normalized = input.trim().toLowerCase();

      if (normalized === 'y' || normalized === 'yes') {
        return true;
      }
      if (normalized === 'n' || normalized === 'no') {
        return false;
      }

      this.writeLine('Please enter "y" or "n".');
    }
  }

  /**
   * Prompt for user input.
   */
  private prompt(message: string): Promise<string> {
    return new Promise((resolve) => {
      if (!this.rl) {
        resolve('');
        return;
      }

      this.rl.question(message, (answer) => {
        resolve(answer);
      });
    });
  }

  /**
   * Write a line to output.
   */
  private writeLine(message: string): void {
    this.output.write(message + '\n');
  }

  /**
   * Clean up resources.
   */
  private cleanup(): void {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
  }
}

/**
 * Create a terminal auth flow with the given dependencies.
 *
 * @param dependencies - Flow dependencies
 * @returns A new TerminalAuthFlow instance
 */
export function createTerminalAuthFlow(
  dependencies: TerminalAuthFlowDependencies
): TerminalAuthFlow {
  return new TerminalAuthFlow(dependencies);
}

/**
 * Get provider information by ID.
 *
 * @param providerId - The provider identifier
 * @returns Provider info or undefined if not found
 */
export function getProviderInfo(providerId: AuthProviderId): ProviderInfo | undefined {
  return PROVIDER_INFO.find(p => p.id === providerId);
}

/**
 * Get all supported provider information.
 *
 * @returns Array of provider information
 */
export function getAllProviderInfo(): readonly ProviderInfo[] {
  return PROVIDER_INFO;
}
