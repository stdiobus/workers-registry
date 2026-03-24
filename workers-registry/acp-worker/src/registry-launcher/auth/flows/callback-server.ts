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
 * Loopback HTTP server for OAuth callbacks.
 *
 * @module flows/callback-server
 */

import type { CallbackResult } from '../types.js';

// TODO: Implement in Task 11.1

/**
 * Loopback HTTP server for OAuth callbacks.
 */
export interface ICallbackServer {
  /** Start the server and return the redirect URI */
  start(): Promise<string>;

  /** Wait for the authorization callback */
  waitForCallback(timeoutMs: number): Promise<CallbackResult>;

  /** Stop the server and clean up resources */
  stop(): Promise<void>;

  /** Get the current server port (0 if not started) */
  getPort(): number;

  /** Check if server is running */
  isRunning(): boolean;
}

/**
 * Callback server implementation.
 */
export class CallbackServer implements ICallbackServer {
  async start(): Promise<string> {
    throw new Error('Not implemented - Task 11.1');
  }

  async waitForCallback(_timeoutMs: number): Promise<CallbackResult> {
    throw new Error('Not implemented - Task 11.1');
  }

  async stop(): Promise<void> {
    throw new Error('Not implemented - Task 11.1');
  }

  getPort(): number {
    throw new Error('Not implemented - Task 11.1');
  }

  isRunning(): boolean {
    throw new Error('Not implemented - Task 11.1');
  }
}
