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
 * Main orchestrator for OAuth authentication.
 *
 * Coordinates providers, flows, storage, and token management.
 *
 * @module auth-manager
 */

import type { AgentApiKeys } from '../config/api-keys.js';
import type { ICredentialStore } from './storage/types.js';
import type { ITokenManager } from './token-manager.js';
import type {
  AuthProviderId,
  AuthResult,
  AuthStatusMap,
  AgentAuthOptions,
} from './types.js';

// TODO: Implement in Task 15.1

/**
 * Main orchestrator for OAuth authentication.
 * Coordinates providers, flows, storage, and token management.
 */
export class AuthManager {
  constructor(
    _credentialStore: ICredentialStore,
    _tokenManager: ITokenManager,
    _legacyApiKeys: Record<string, AgentApiKeys>
  ) {
    throw new Error('Not implemented - Task 15.1');
  }

  /**
   * Authenticate with a provider using agent auth flow.
   */
  async authenticateAgent(
    _providerId: AuthProviderId,
    _options?: AgentAuthOptions
  ): Promise<AuthResult> {
    throw new Error('Not implemented - Task 15.1');
  }

  /**
   * Run interactive terminal setup for a provider.
   */
  async setupTerminal(_providerId: AuthProviderId): Promise<AuthResult> {
    throw new Error('Not implemented - Task 15.1');
  }

  /**
   * Get access token for an agent, preferring OAuth over legacy.
   */
  async getTokenForAgent(
    _agentId: string,
    _providerId?: AuthProviderId
  ): Promise<string | null> {
    throw new Error('Not implemented - Task 15.1');
  }

  /**
   * Inject authentication into an agent request.
   */
  async injectAuth(_agentId: string, _request: object): Promise<object> {
    throw new Error('Not implemented - Task 15.3');
  }

  /**
   * Get authentication status for all providers.
   */
  async getStatus(): Promise<AuthStatusMap> {
    throw new Error('Not implemented - Task 15.1');
  }

  /**
   * Logout from a specific provider or all providers.
   */
  async logout(_providerId?: AuthProviderId): Promise<void> {
    throw new Error('Not implemented - Task 15.1');
  }

  /**
   * Check if re-authentication is required.
   */
  async requiresReauth(_providerId: AuthProviderId): Promise<boolean> {
    throw new Error('Not implemented - Task 15.1');
  }
}
