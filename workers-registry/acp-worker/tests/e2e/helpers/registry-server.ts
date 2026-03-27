/*
 * Apache License 2.0
 * Copyright (c) 2025–present Raman Marozau, Target Insight Function.
 */

/**
 * Mock HTTP server that serves a registry JSON for E2E tests.
 *
 * Provides a lightweight HTTP server on a random port that returns
 * a valid ACP registry JSON with the provided agent definitions.
 *
 * IMPORTANT: This module works ONLY with the production binary (dist/).
 * No imports from src/ are allowed.
 *
 * @module tests/e2e/helpers/registry-server
 */

import { createServer, Server, IncomingMessage, ServerResponse } from 'http';

/** Agent definition for the mock registry. */
export interface MockAgent {
  /** Unique agent identifier */
  id: string;
  /** Human-readable agent name */
  name: string;
  /** Agent version */
  version?: string;
  /** Agent description */
  description?: string;
  /** Command to run the agent (e.g., 'node') */
  cmd: string;
  /** Arguments for the command (e.g., path to agent script) */
  args: string[];
}

/** All supported platform keys for binary distribution. */
const ALL_PLATFORMS = [
  'darwin-aarch64',
  'darwin-x86_64',
  'linux-x86_64',
  'linux-aarch64',
  'windows-x86_64',
] as const;

/**
 * Mock HTTP server that serves an ACP registry JSON.
 *
 * Binds to 127.0.0.1 on a random port and serves the registry
 * at any request path.
 */
export class MockRegistryServer {
  private server: Server | null = null;
  private port = 0;

  /**
   * Start the HTTP server on a random port, serving the registry JSON.
   *
   * @param agents - Array of mock agent definitions to include in the registry.
   * @returns The full URL to the registry JSON (e.g., `http://127.0.0.1:12345/registry.json`).
   */
  async start(agents: MockAgent[]): Promise<string> {
    if (this.server) {
      throw new Error('[e2e-harness] Mock registry server already started');
    }

    const registryJson = this.buildRegistryJson(agents);
    const body = JSON.stringify(registryJson);

    this.server = createServer((_req: IncomingMessage, res: ServerResponse) => {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body).toString(),
      });
      res.end(body);
    });

    return new Promise<string>((resolve, reject) => {
      this.server!.on('error', reject);
      this.server!.listen(0, '127.0.0.1', () => {
        const address = this.server!.address();
        if (address && typeof address === 'object') {
          this.port = address.port;
          resolve(this.getUrl());
        } else {
          reject(new Error('[e2e-harness] Failed to get server address'));
        }
      });
    });
  }

  /**
   * Stop the server and release resources.
   */
  async stop(): Promise<void> {
    if (!this.server) return;

    const server = this.server;
    this.server = null;
    this.port = 0;

    return new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }

  /**
   * Get the URL of the mock registry.
   *
   * @returns URL in format `http://127.0.0.1:{port}/registry.json`.
   */
  getUrl(): string {
    if (!this.port) {
      throw new Error('[e2e-harness] Mock registry server not started');
    }
    return `http://127.0.0.1:${this.port}/registry.json`;
  }

  /**
   * Build a valid ACP registry JSON from the provided agents.
   */
  private buildRegistryJson(agents: MockAgent[]): object {
    return {
      version: '1.0.0',
      agents: agents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        version: agent.version ?? '1.0.0',
        description: agent.description ?? `Mock agent: ${agent.name}`,
        distribution: {
          binary: Object.fromEntries(
            ALL_PLATFORMS.map((platform) => [
              platform,
              { cmd: agent.cmd, args: [...agent.args] },
            ]),
          ),
        },
      })),
    };
  }
}
