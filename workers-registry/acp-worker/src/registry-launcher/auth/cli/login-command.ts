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
 * --login CLI command implementation.
 *
 * Starts the browser-based OAuth 2.1 Authorization Code flow with PKCE.
 *
 * Requirements: 3.1, 3.2, 9.5
 *
 * @module cli/login-command
 */

import { CredentialStore } from '../storage/credential-store.js';
import { TokenManager } from '../token-manager.js';
import { AuthManager } from '../auth-manager.js';
import { getProvider } from '../providers/index.js';
import type { AuthProviderId } from '../types.js';
import { isValidProviderId, VALID_PROVIDER_IDS } from '../types.js';

/**
 * Default timeout for browser OAuth flow (5 minutes).
 */
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Options for the login command.
 */
export interface LoginCommandOptions {
  /** Custom output stream (for testing) */
  output?: NodeJS.WritableStream;
  /** Custom timeout in milliseconds (default: 5 minutes) */
  timeoutMs?: number;
}

/**
 * Run the login command.
 *
 * Starts the browser-based OAuth 2.1 Authorization Code flow with PKCE
 * for the specified provider.
 *
 * All output goes to stderr to comply with NDJSON protocol requirements.
 *
 * Requirement 3.1: WHEN an agent requires OAuth authentication with `type: "agent"`,
 * THE Auth_Module SHALL initiate the OAuth 2.1 Authorization Code flow with PKCE.
 *
 * Requirement 3.2: WHEN initiating the authorization flow, THE Auth_Module SHALL
 * open the system default browser to the provider's authorization URL.
 *
 * Requirement 9.5: THE Registry_Launcher SHALL exit with code 0 after successfully
 * completing any auth CLI command.
 *
 * @param providerId - The provider to authenticate with
 * @param options - Command options
 * @returns Exit code (0 for success, 1 for failure)
 */
export async function runLoginCommand(
  providerId: AuthProviderId,
  options: LoginCommandOptions = {}
): Promise<number> {
  const output = options.output ?? process.stderr;

  // Validate and sanitize timeout
  let timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    timeoutMs = DEFAULT_TIMEOUT_MS;
  }
  // Clamp to reasonable bounds (1 second to 30 minutes)
  timeoutMs = Math.max(1000, Math.min(timeoutMs, 30 * 60 * 1000));

  // Validate provider ID
  if (!isValidProviderId(providerId)) {
    output.write(`\nError: Invalid provider '${providerId}'.\n`);
    output.write(`Supported providers: ${VALID_PROVIDER_IDS.join(', ')}\n\n`);
    return 1;
  }

  try {
    // Create credential store and token manager
    const credentialStore = new CredentialStore();
    const tokenManager = new TokenManager({
      credentialStore,
      providerResolver: getProvider,
    });

    // Create auth manager
    const authManager = new AuthManager({
      credentialStore,
      tokenManager,
      legacyApiKeys: {},
    });

    // Get provider display name
    const providerName = providerId.charAt(0).toUpperCase() + providerId.slice(1);
    const timeoutMinutes = Math.round(timeoutMs / 60000);

    // Output user feedback
    output.write(`\nOpening browser for ${providerName} authentication...\n`);
    output.write(`Waiting for authorization (timeout: ${timeoutMinutes} minutes)...\n\n`);

    // Start the browser OAuth flow
    const result = await authManager.authenticateAgent(providerId, { timeoutMs });

    if (result.success) {
      output.write(`\n✓ Successfully authenticated with ${providerName}.\n\n`);
      return 0;
    } else {
      // Handle specific error cases
      const error = result.error;

      if (error.code === 'TIMEOUT') {
        output.write(`\n✗ Authentication timed out.\n`);
        output.write(`The browser authorization flow did not complete within ${timeoutMinutes} minutes.\n`);
        output.write(`Please try again and complete the authorization in your browser.\n\n`);
      } else if (error.code === 'INVALID_STATE') {
        output.write(`\n✗ Authentication failed: Security validation error.\n`);
        output.write(`The authorization response could not be verified. Please try again.\n\n`);
      } else if (error.code === 'CALLBACK_ERROR') {
        output.write(`\n✗ Authentication cancelled or failed.\n`);
        if (error.message) {
          output.write(`${error.message}\n`);
        }
        output.write(`\n`);
      } else if (error.code === 'PROVIDER_ERROR') {
        output.write(`\n✗ ${providerName} returned an error.\n`);
        if (error.message) {
          output.write(`${error.message}\n`);
        }
        output.write(`\n`);
      } else if (error.code === 'UNSUPPORTED_PROVIDER') {
        output.write(`\n✗ Provider '${providerId}' is not supported.\n`);
        output.write(`Supported providers: ${VALID_PROVIDER_IDS.join(', ')}\n\n`);
      } else {
        // Generic error handling
        output.write(`\n✗ Authentication failed.\n`);
        if (error.message) {
          output.write(`${error.message}\n`);
        }
        output.write(`\n`);
      }

      // Log error details for debugging (to stderr)
      console.error(`[LoginCommand] Authentication failed for ${providerId}: ${error.code} - ${error.message}`);

      return 1;
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    output.write(`\n✗ Login failed: ${errorMessage}\n\n`);
    console.error(`[LoginCommand] Error: ${errorMessage}`);
    return 1;
  }
}
