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
 * --logout CLI command implementation.
 *
 * Removes stored credentials from the Credential_Store.
 *
 * Requirements: 9.3, 9.4
 *
 * @module cli/logout-command
 */

import { CredentialStore } from '../storage/credential-store.js';
import { TokenManager } from '../token-manager.js';
import { AuthManager } from '../auth-manager.js';
import type { AuthProviderId } from '../types.js';
import { isValidProviderId, VALID_PROVIDER_IDS } from '../types.js';

/**
 * Options for the logout command.
 */
export interface LogoutCommandOptions {
  /** Custom output stream (for testing) */
  output?: NodeJS.WritableStream;
}

/**
 * Run the logout command.
 *
 * Removes stored credentials from the Credential_Store.
 * All output goes to stderr to comply with NDJSON protocol requirements.
 *
 * Requirement 9.3: WHEN the `--logout` flag is provided, THE Registry_Launcher
 * SHALL remove all stored credentials from the Credential_Store.
 *
 * Requirement 9.4: WHEN the `--logout` flag is provided with a provider name,
 * THE Registry_Launcher SHALL remove only the credentials for that specific provider.
 *
 * @param providerId - Optional provider to logout from (all if not specified)
 * @param options - Command options
 * @returns Exit code (0 for success, 1 for failure)
 */
export async function runLogoutCommand(
  providerId?: AuthProviderId,
  options: LogoutCommandOptions = {}
): Promise<number> {
  const output = options.output ?? process.stderr;

  try {
    // Validate provider ID if specified
    if (providerId !== undefined && !isValidProviderId(providerId)) {
      output.write(`\nError: Invalid provider '${providerId}'.\n`);
      output.write(`Supported providers: ${VALID_PROVIDER_IDS.join(', ')}\n\n`);
      return 1;
    }

    // Create credential store and token manager
    const credentialStore = new CredentialStore();
    const tokenManager = new TokenManager({
      credentialStore,
      providerResolver: () => null, // Not needed for logout
    });

    // Create auth manager
    const authManager = new AuthManager({
      credentialStore,
      tokenManager,
      legacyApiKeys: {},
    });

    // Get list of configured providers before logout
    const configuredProviders = await credentialStore.listProviders();

    if (providerId) {
      // Logout from specific provider (Requirement 9.4)
      if (!configuredProviders.includes(providerId)) {
        output.write(`\nNo credentials found for provider '${providerId}'.\n\n`);
        return 0; // Not an error, just nothing to do
      }

      await authManager.logout(providerId);

      const providerName = providerId.charAt(0).toUpperCase() + providerId.slice(1);
      output.write(`\nSuccessfully logged out from ${providerName}.\n\n`);
    } else {
      // Logout from all providers (Requirement 9.3)
      if (configuredProviders.length === 0) {
        output.write('\nNo credentials found. Nothing to logout.\n\n');
        return 0; // Not an error, just nothing to do
      }

      await authManager.logout();

      output.write(`\nSuccessfully logged out from all providers.\n`);
      output.write(`Removed credentials for: ${configuredProviders.join(', ')}\n\n`);
    }

    return 0;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    output.write(`\nLogout failed: ${errorMessage}\n`);
    console.error(`[LogoutCommand] Error: ${errorMessage}`);
    return 1;
  }
}
