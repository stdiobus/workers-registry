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
 * --auth-status CLI command implementation.
 *
 * Displays the current authentication status for all configured providers.
 *
 * Requirements: 9.2
 *
 * @module cli/status-command
 */

import { CredentialStore } from '../storage/credential-store.js';
import { TokenManager } from '../token-manager.js';
import { AuthManager } from '../auth-manager.js';
import type { AuthStatusEntry, TokenStatus } from '../types.js';
import { VALID_PROVIDER_IDS } from '../types.js';

/**
 * Options for the status command.
 */
export interface StatusCommandOptions {
  /** Custom output stream (for testing) */
  output?: NodeJS.WritableStream;
}

/**
 * Format a timestamp as a human-readable date string.
 *
 * @param timestamp - Unix timestamp in milliseconds
 * @returns Formatted date string
 */
function formatTimestamp(timestamp: number | undefined): string {
  if (!timestamp) {
    return 'N/A';
  }
  return new Date(timestamp).toLocaleString();
}

/**
 * Get a human-readable status label with color indicator.
 *
 * @param status - Token status
 * @returns Status label with indicator
 */
function getStatusLabel(status: TokenStatus): string {
  switch (status) {
    case 'authenticated':
      return '✓ Authenticated';
    case 'expired':
      return '⚠ Expired (refresh available)';
    case 'refresh-failed':
      return '✗ Refresh Failed (re-auth required)';
    case 'not-configured':
      return '○ Not Configured';
    default:
      return '? Unknown';
  }
}

/**
 * Sanitize a string for safe terminal output.
 * Removes control characters and ANSI escape sequences.
 *
 * @param value - The string to sanitize
 * @returns Sanitized string safe for terminal output
 */
function sanitizeForOutput(value: string): string {
  // Remove ANSI escape sequences
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\x00-\x1f\x7f]|\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

/**
 * Format a single provider status entry for display.
 *
 * @param entry - Auth status entry
 * @returns Formatted status lines
 */
function formatProviderStatus(entry: AuthStatusEntry): string[] {
  const lines: string[] = [];
  const providerName = entry.providerId.charAt(0).toUpperCase() + entry.providerId.slice(1);

  lines.push(`  ${providerName}:`);
  lines.push(`    Status: ${getStatusLabel(entry.status)}`);

  if (entry.status !== 'not-configured') {
    if (entry.expiresAt) {
      const now = Date.now();
      const isExpired = entry.expiresAt <= now;
      const expiresLabel = isExpired ? 'Expired at' : 'Expires at';
      lines.push(`    ${expiresLabel}: ${formatTimestamp(entry.expiresAt)}`);
    }

    if (entry.scope) {
      // Sanitize scope to prevent terminal output injection
      lines.push(`    Scope: ${sanitizeForOutput(entry.scope)}`);
    }

    if (entry.lastRefresh) {
      lines.push(`    Last Updated: ${formatTimestamp(entry.lastRefresh)}`);
    }
  }

  return lines;
}

/**
 * Run the auth-status command.
 *
 * Displays the current authentication status for all configured providers.
 * All output goes to stderr to comply with NDJSON protocol requirements.
 *
 * Requirement 9.2: WHEN the `--auth-status` flag is provided, THE Registry_Launcher
 * SHALL display the current authentication status for all configured providers
 * (authenticated, expired, not configured).
 *
 * @param options - Command options
 * @returns Exit code (0 for success)
 */
export async function runStatusCommand(options: StatusCommandOptions = {}): Promise<number> {
  const output = options.output ?? process.stderr;

  try {
    // Create credential store and token manager
    const credentialStore = new CredentialStore();
    const tokenManager = new TokenManager({
      credentialStore,
      providerResolver: () => null, // Not needed for status check
    });

    // Create auth manager
    const authManager = new AuthManager({
      credentialStore,
      tokenManager,
      legacyApiKeys: {},
    });

    // Get status for all providers
    const statusMap = await authManager.getStatus();

    // Display header
    output.write('\n=== OAuth Authentication Status ===\n\n');

    // Count providers by status
    let authenticatedCount = 0;
    let expiredCount = 0;
    let notConfiguredCount = 0;

    // Display status for each provider
    for (const providerId of VALID_PROVIDER_IDS) {
      const entry = statusMap.get(providerId);

      if (entry) {
        const lines = formatProviderStatus(entry);
        for (const line of lines) {
          output.write(line + '\n');
        }
        output.write('\n');

        // Update counts
        switch (entry.status) {
          case 'authenticated':
            authenticatedCount++;
            break;
          case 'expired':
          case 'refresh-failed':
            expiredCount++;
            break;
          case 'not-configured':
            notConfiguredCount++;
            break;
        }
      }
    }

    // Display summary
    output.write('--- Summary ---\n');
    output.write(`  Authenticated: ${authenticatedCount}\n`);
    output.write(`  Expired/Failed: ${expiredCount}\n`);
    output.write(`  Not Configured: ${notConfiguredCount}\n`);
    output.write('\n');

    // Provide helpful hints
    if (notConfiguredCount === VALID_PROVIDER_IDS.length) {
      output.write('Tip: Run with --setup to configure authentication.\n\n');
    } else if (expiredCount > 0) {
      output.write('Tip: Run with --setup to re-authenticate expired providers.\n\n');
    }

    return 0;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    output.write(`\nFailed to get auth status: ${errorMessage}\n`);
    console.error(`[StatusCommand] Error: ${errorMessage}`);
    return 1;
  }
}
