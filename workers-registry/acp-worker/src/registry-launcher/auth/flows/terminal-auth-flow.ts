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
 * @module flows/terminal-auth-flow
 */

import type { AuthProviderId, AuthResult } from '../types.js';

// TODO: Implement in Task 14.3

/**
 * Terminal auth flow - interactive CLI setup.
 */
export class TerminalAuthFlow {
  /**
   * Execute the terminal auth flow.
   *
   * @param providerId - The provider to authenticate with
   * @returns Authentication result
   */
  async execute(_providerId: AuthProviderId): Promise<AuthResult> {
    throw new Error('Not implemented - Task 14.3');
  }
}
