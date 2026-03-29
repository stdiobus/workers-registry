/*
 * Apache License 2.0
 * Copyright (c) 2025–present Raman Marozau, Target Insight Function.
 */

/**
 * E2E test harness for the production Registry Launcher binary.
 *
 * Spawns `node dist/registry-launcher/index.js` and provides helpers
 * for sending NDJSON messages, waiting for responses, and managing
 * the launcher lifecycle.
 *
 * IMPORTANT: This module works ONLY with the production binary (dist/).
 * No imports from src/ are allowed.
 *
 * @module tests/e2e/helpers/launcher-harness
 */

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';

/** Options for starting the launcher process. */
export interface LauncherOptions {
  /** Environment variables to pass to the launcher */
  env?: Record<string, string>;
  /** Path to api-keys.json file */
  apiKeysPath?: string;
  /** URL for the mock registry server */
  registryUrl?: string;
  /** Additional CLI args */
  args?: string[];
  /** Timeout for launcher ready in ms (default: 15000) */
  readyTimeoutMs?: number;
}

/**
 * Test harness for the production Registry Launcher binary.
 *
 * Manages spawning, communication, and cleanup of the launcher process
 * for E2E testing.
 */
export class LauncherHarness {
  private process: ChildProcess | null = null;
  private stderrBuffer = '';
  private stdoutBuffer = '';
  private responses: object[] = [];
  private responseListeners: Array<(response: object) => void> = [];
  private stderrListeners: Array<(text: string) => void> = [];

  /** Path to the production launcher binary. */
  private readonly launcherPath: string;

  constructor() {
    this.launcherPath = path.resolve(
      __dirname,
      '../../../dist/registry-launcher/index.js',
    );
  }

  /**
   * Spawn the launcher process and wait for "Registry Launcher ready" in stderr.
   *
   * @param opts - Launcher options (env vars, registry URL, api keys path, etc.)
   * @throws Error if the launcher fails to start or doesn't become ready within timeout.
   */
  async start(opts?: LauncherOptions): Promise<void> {
    if (this.process) {
      throw new Error('[e2e-harness] Launcher already started');
    }

    const env: Record<string, string> = { ...process.env as Record<string, string> };

    if (opts?.registryUrl) {
      env.ACP_REGISTRY_URL = opts.registryUrl;
    }
    if (opts?.apiKeysPath) {
      env.ACP_API_KEYS_PATH = opts.apiKeysPath;
    }
    if (opts?.env) {
      Object.assign(env, opts.env);
    }

    const args = [this.launcherPath, ...(opts?.args ?? [])];

    this.process = spawn('node', args, {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Wire up stdout NDJSON parsing
    this.process.stdout!.setEncoding('utf8');
    this.process.stdout!.on('data', (chunk: string) => {
      this.stdoutBuffer += chunk;
      this.parseStdoutLines();
    });

    // Wire up stderr collection
    this.process.stderr!.setEncoding('utf8');
    this.process.stderr!.on('data', (chunk: string) => {
      this.stderrBuffer += chunk;
      // Notify stderr listeners
      for (const listener of this.stderrListeners) {
        listener(chunk);
      }
    });

    // Handle unexpected exit during startup
    const readyTimeoutMs = opts?.readyTimeoutMs ?? 15000;

    await new Promise<void>((resolve, reject) => {
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(
            new Error(
              `[e2e-harness] Launcher not ready within ${readyTimeoutMs}ms. Stderr:\n${this.stderrBuffer}`,
            ),
          );
        }
      }, readyTimeoutMs);

      const onStderr = (chunk: string) => {
        if (!settled && chunk.includes('Registry Launcher ready')) {
          settled = true;
          clearTimeout(timer);
          resolve();
        }
      };

      this.stderrListeners.push(onStderr);

      // Also check already-buffered stderr
      if (this.stderrBuffer.includes('Registry Launcher ready')) {
        settled = true;
        clearTimeout(timer);
        resolve();
        return;
      }

      this.process!.on('exit', (code) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(
            new Error(
              `[e2e-harness] Launcher exited with code ${code} before ready. Stderr:\n${this.stderrBuffer}`,
            ),
          );
        }
      });

      this.process!.on('error', (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(
            new Error(`[e2e-harness] Failed to spawn launcher: ${err.message}`),
          );
        }
      });
    });
  }

  /**
   * Send an NDJSON message to the launcher's stdin.
   *
   * @param msg - Object to serialize as JSON and write to stdin.
   * @throws Error if the launcher is not running.
   */
  sendMessage(msg: object): void {
    if (!this.process || !this.process.stdin || !this.isRunning()) {
      throw new Error('[e2e-harness] Launcher is not running');
    }
    this.process.stdin.write(JSON.stringify(msg) + '\n');
  }

  /**
   * Wait for a response with a matching `id` from stdout.
   *
   * Checks already-received responses first, then listens for new ones.
   *
   * @param id - The JSON-RPC request id to match.
   * @param timeoutMs - Maximum time to wait in ms (default: 10000).
   * @returns The parsed response object.
   * @throws Error on timeout or if the launcher exits unexpectedly.
   */
  async waitForResponse(
    id: string | number,
    timeoutMs = 10000,
  ): Promise<object> {
    // Check already-received responses
    const existing = this.findResponse(id);
    if (existing) {
      return existing;
    }

    return new Promise<object>((resolve, reject) => {
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          cleanup();
          reject(
            new Error(
              `[e2e-harness] Timeout waiting for response id=${id} after ${timeoutMs}ms. ` +
              `Received ${this.responses.length} responses so far. Stderr:\n${this.stderrBuffer}`,
            ),
          );
        }
      }, timeoutMs);

      const listener = (response: object) => {
        if (!settled && this.matchesId(response, id)) {
          settled = true;
          cleanup();
          resolve(response);
        }
      };

      const onExit = () => {
        if (!settled) {
          settled = true;
          cleanup();
          // Check one more time in case response arrived before exit
          const found = this.findResponse(id);
          if (found) {
            resolve(found);
          } else {
            reject(
              new Error(
                `[e2e-harness] Launcher exited while waiting for response id=${id}`,
              ),
            );
          }
        }
      };

      const cleanup = () => {
        clearTimeout(timer);
        const idx = this.responseListeners.indexOf(listener);
        if (idx >= 0) this.responseListeners.splice(idx, 1);
        this.process?.removeListener('exit', onExit);
      };

      this.responseListeners.push(listener);
      this.process?.on('exit', onExit);
    });
  }

  /**
   * Wait for a pattern to appear in stderr output.
   *
   * Checks already-collected stderr first, then listens for new data.
   *
   * @param pattern - String or RegExp to match against stderr.
   * @param timeoutMs - Maximum time to wait in ms (default: 10000).
   * @returns The matching stderr line or chunk.
   * @throws Error on timeout.
   */
  async waitForStderr(
    pattern: string | RegExp,
    timeoutMs = 10000,
  ): Promise<string> {
    // Check already-collected stderr
    if (this.matchesPattern(this.stderrBuffer, pattern)) {
      return this.stderrBuffer;
    }

    return new Promise<string>((resolve, reject) => {
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          cleanup();
          reject(
            new Error(
              `[e2e-harness] Timeout waiting for stderr pattern "${pattern}" after ${timeoutMs}ms. ` +
              `Stderr so far:\n${this.stderrBuffer}`,
            ),
          );
        }
      }, timeoutMs);

      const listener = (_chunk: string) => {
        if (!settled && this.matchesPattern(this.stderrBuffer, pattern)) {
          settled = true;
          cleanup();
          resolve(this.stderrBuffer);
        }
      };

      const cleanup = () => {
        clearTimeout(timer);
        const idx = this.stderrListeners.indexOf(listener);
        if (idx >= 0) this.stderrListeners.splice(idx, 1);
      };

      this.stderrListeners.push(listener);
    });
  }

  /**
   * Collect all responses from stdout for a given period.
   *
   * @param timeoutMs - Duration to collect responses in ms.
   * @returns Array of all parsed response objects received during the period.
   */
  async collectAllResponses(timeoutMs: number): Promise<object[]> {
    const collected: object[] = [...this.responses];

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        cleanup();
        resolve();
      }, timeoutMs);

      const listener = (response: object) => {
        collected.push(response);
      };

      const cleanup = () => {
        clearTimeout(timer);
        const idx = this.responseListeners.indexOf(listener);
        if (idx >= 0) this.responseListeners.splice(idx, 1);
      };

      this.responseListeners.push(listener);
    });

    return collected;
  }

  /**
   * Send SIGTERM and wait for process exit, then cleanup.
   *
   * @returns Object with the exit code (null if force-killed).
   */
  async stop(): Promise<{ exitCode: number | null }> {
    if (!this.process) {
      return { exitCode: null };
    }

    const proc = this.process;
    this.process = null;

    return new Promise<{ exitCode: number | null }>((resolve) => {
      let settled = false;
      const forceKillTimeout = 5000;

      const forceKillTimer = setTimeout(() => {
        if (!settled) {
          settled = true;
          console.error('[e2e-harness] Force-killing launcher after timeout');
          try {
            proc.kill('SIGKILL');
          } catch {
            // Process may already be dead
          }
          resolve({ exitCode: null });
        }
      }, forceKillTimeout);

      proc.on('exit', (code) => {
        if (!settled) {
          settled = true;
          clearTimeout(forceKillTimer);
          resolve({ exitCode: code });
        }
      });

      try {
        proc.kill('SIGTERM');
      } catch {
        // Process may already be dead
        if (!settled) {
          settled = true;
          clearTimeout(forceKillTimer);
          resolve({ exitCode: null });
        }
      }
    });
  }

  /**
   * Get all stderr output collected so far.
   *
   * @returns The full stderr buffer as a string.
   */
  getStderr(): string {
    return this.stderrBuffer;
  }

  /**
   * Check if the launcher process is running.
   *
   * @returns true if the process is alive.
   */
  isRunning(): boolean {
    return this.process !== null && this.process.exitCode === null && !this.process.killed;
  }

  // ---- Private helpers ----

  /** Parse complete NDJSON lines from the stdout buffer. */
  private parseStdoutLines(): void {
    const lines = this.stdoutBuffer.split('\n');
    // Keep the last (possibly incomplete) line in the buffer
    this.stdoutBuffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as object;
        this.responses.push(parsed);
        // Notify listeners
        for (const listener of this.responseListeners) {
          listener(parsed);
        }
      } catch {
        console.error(`[e2e-harness] Failed to parse stdout line: ${trimmed.slice(0, 200)}`);
      }
    }
  }

  /** Find an already-received response by id. */
  private findResponse(id: string | number): object | undefined {
    return this.responses.find((r) => this.matchesId(r, id));
  }

  /** Check if a response object has a matching id. */
  private matchesId(response: object, id: string | number): boolean {
    return 'id' in response && (response as Record<string, unknown>).id === id;
  }

  /** Check if text matches a string or RegExp pattern. */
  private matchesPattern(text: string, pattern: string | RegExp): boolean {
    if (typeof pattern === 'string') {
      return text.includes(pattern);
    }
    return pattern.test(text);
  }
}
