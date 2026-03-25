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
 * --setup CLI command implementation.
 *
 * Starts the interactive authentication Setup_Wizard.
 *
 * Requirements: 9.1
 *
 * @module cli/setup-command
 */

import { TerminalAuthFlow } from '../flows/terminal-auth-flow.js';
import { CredentialStore } from '../storage/credential-store.js';
import { CLIENT_CREDENTIALS_MARKER } from '../auth-manager.js';
import type { AuthProviderId } from '../types.js';
import { isValidProviderId, VALID_PROVIDER_IDS } from '../types.js';

/**
 * Options for the setup command.
 */
export interface SetupCommandOptions {
  /** Optional pre-selected provider (skips provider selection) */
  providerId?: AuthProviderId;
  /** Custom input stream (for testing) */
  input?: NodeJS.ReadableStream;
  /** Custom output stream (for testing) */
  output?: NodeJS.WritableStream;
}

/**
 * Run the setup command.
 *
 * Starts the interactive Setup_Wizard for configuring OAuth credentials.
 * All output goes to stderr to comply with NDJSON protocol requirements.
 *
 * Requirement 9.1: WHEN the `--setup` flag is provided, THE Registry_Launcher
 * SHALL start the interactive authentication Setup_Wizard.
 *
 * @param options - Command options
 * @returns Exit code (0 for success, 1 for failure)
 */
export async function runSetupCommand(options: SetupCommandOptions = {}): Promise<number> {
  const output = options.output ?? process.stderr;

  try {
    // Validate provider ID if specified
    if (options.providerId !== undefined && !isValidProviderId(options.providerId)) {
      output.write(`\nError: Invalid provider '${options.providerId}'.\n`);
      output.write(`Supported providers: ${VALID_PROVIDER_IDS.join(', ')}\n\n`);
      return 1;
    }

    // Create credential store
    const credentialStore = new CredentialStore();

    // Create terminal auth flow
    const terminalAuthFlow = new TerminalAuthFlow({
      credentialStore,
      validateCredentials: async (_providerId, credentials) => {
        // Basic validation - check that required fields are present
        if (!credentials.clientId || credentials.clientId.trim().length === 0) {
          return { valid: false, error: 'Client ID is required' };
        }
        // For terminal auth, we accept the credentials as valid
        // Return the marker token to indicate client credentials are configured
        // The actual OAuth token will be obtained when the credentials are used
        return { valid: true, accessToken: CLIENT_CREDENTIALS_MARKER };
      },
      input: options.input,
      output,
    });

    // Execute the setup wizard
    const result = await terminalAuthFlow.execute(options.providerId);

    if (result.success) {
      return 0;
    } else {
      // Error message already displayed by terminal auth flow
      return 1;
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    output.write(`\nSetup failed: ${errorMessage}\n`);
    console.error(`[SetupCommand] Error: ${errorMessage}`);
    return 1;
  }
}
