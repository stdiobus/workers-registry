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

export interface HistoryEntry {
  role: 'user' | 'assistant';
  content: string;
}

export class Session {
  readonly id: string;
  readonly cwd: string;
  private _history: HistoryEntry[] = [];
  private _abortController: AbortController;
  private _cancelled = false;

  constructor(id: string, cwd: string) {
    this.id = id;
    this.cwd = cwd;
    this._abortController = new AbortController();
  }

  getAbortSignal(): AbortSignal {
    return this._abortController.signal;
  }

  cancel(): void {
    this._cancelled = true;
    this._abortController.abort();
  }

  isCancelled(): boolean {
    return this._cancelled;
  }

  resetCancellation(): void {
    this._cancelled = false;
    this._abortController = new AbortController();
  }

  addHistoryEntry(role: 'user' | 'assistant', content: string): void {
    this._history.push({ role, content });
  }

  getHistory(): HistoryEntry[] {
    return [...this._history];
  }
}
