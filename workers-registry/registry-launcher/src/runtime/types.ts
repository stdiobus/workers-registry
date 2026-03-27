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

import type { ChildProcess } from 'child_process';

/**
 * State of an agent runtime.
 */
export type RuntimeState = 'starting' | 'running' | 'stopping' | 'stopped';

/**
 * Agent runtime representing a spawned agent process.
 */
export interface AgentRuntime {
  /** Agent identifier */
  agentId: string;
  /** Current state */
  state: RuntimeState;
  /** Child process reference */
  process: ChildProcess;

  /** Write a message to the agent's stdin */
  write(message: object): boolean;

  /** Terminate the agent process */
  terminate(timeout?: number): Promise<void>;
}
