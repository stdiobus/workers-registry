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

import * as fc from 'fast-check';
import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import { OpenAIAgent } from '../src/agent';

// Mock loadConfig to avoid env var side effects
jest.mock('../src/config', () => ({
  loadConfig: () => ({
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'test-key',
    model: 'gpt-4o',
  }),
}));

/**
 * Property 1: Initialize response contains required fields
 * Validates: Requirements 1.1
 *
 * For any InitializeRequest parameters, calling initialize() on the OpenAIAgent
 * SHALL return a response object containing non-empty name, version, and capabilities fields.
 */
describe('Property 1: Initialize response contains required fields', () => {
  it('returns non-empty name, version, and capabilities for arbitrary params', async () => {
    const mockConnection = {
      sessionUpdate: jest.fn().mockResolvedValue(undefined),
      closed: new Promise(() => { }),
    } as any;

    const agent = new OpenAIAgent(mockConnection);

    await fc.assert(
      fc.asyncProperty(
        fc.record({
          protocolVersion: fc.string({ minLength: 1 }),
          clientInfo: fc.record({
            name: fc.string({ minLength: 1 }),
            version: fc.string({ minLength: 1 }),
          }),
        }),
        async (params) => {
          const response = await agent.initialize(params as any);

          // Must have non-empty name
          expect(response.agentInfo).toBeDefined();
          expect(response.agentInfo!.name).toBeTruthy();
          expect(response.agentInfo!.name!.length).toBeGreaterThan(0);

          // Must have non-empty version
          expect(response.agentInfo!.version).toBeTruthy();
          expect(response.agentInfo!.version!.length).toBeGreaterThan(0);

          // Must have capabilities
          expect(response.agentCapabilities).toBeDefined();

          // Must have protocolVersion
          expect(response.protocolVersion).toBeTruthy();
        },
      ),
      { numRuns: 100 },
    );
  });
});

/**
 * Property 2: Bug Condition - authMethods contains valid agent auth entry
 * Validates: Requirements 1.2
 *
 * For any InitializeRequest parameters, calling initialize() on the OpenAIAgent
 * SHALL return authMethods as a non-empty array containing at least one entry
 * with _meta containing 'agent-auth': true that resolves to type "agent" via
 * the CI resolveType() logic, and has non-empty id and name strings.
 *
 * EXPECTED: This test FAILS on unfixed code (authMethods is []).
 * Failure confirms the bug exists.
 */
describe('Property 2: Bug Condition - authMethods contains valid agent auth entry', () => {
  /**
   * CI resolveType() logic:
   * 1. If method.type exists, return it
   * 2. If method._meta has 'terminal-auth', return 'terminal'
   * 3. If method._meta has 'agent-auth', return 'agent'
   * 4. Default: return 'agent'
   */
  function resolveType(method: Record<string, unknown>): string {
    if (typeof method.type === 'string') {
      return method.type;
    }
    const meta = method._meta as Record<string, unknown> | undefined;
    if (meta && 'terminal-auth' in meta) {
      return 'terminal';
    }
    if (meta && 'agent-auth' in meta) {
      return 'agent';
    }
    return 'agent';
  }

  it('authMethods is non-empty and contains a valid agent auth entry for arbitrary params', async () => {
    const mockConnection = {
      sessionUpdate: jest.fn().mockResolvedValue(undefined),
      closed: new Promise(() => { }),
    } as any;

    const agent = new OpenAIAgent(mockConnection);

    await fc.assert(
      fc.asyncProperty(
        fc.record({
          protocolVersion: fc.string({ minLength: 1 }),
          clientInfo: fc.record({
            name: fc.string({ minLength: 1 }),
            version: fc.string({ minLength: 1 }),
          }),
        }),
        async (params) => {
          const response = await agent.initialize(params as any);

          // authMethods must be a non-empty array
          expect(response.authMethods).toBeDefined();
          expect(Array.isArray(response.authMethods)).toBe(true);
          expect(response.authMethods!.length).toBeGreaterThan(0);

          // At least one entry must have _meta containing 'agent-auth': true
          const methods = response.authMethods as Array<Record<string, unknown>>;
          const agentAuthEntry = methods.find((m) => {
            const meta = m._meta as Record<string, unknown> | undefined;
            return meta && meta['agent-auth'] === true;
          });
          expect(agentAuthEntry).toBeDefined();

          // That entry must resolve to type "agent" via CI resolveType() logic
          expect(resolveType(agentAuthEntry!)).toBe('agent');

          // Entry must have non-empty id and name strings (AuthMethod type)
          expect(typeof agentAuthEntry!.id).toBe('string');
          expect((agentAuthEntry!.id as string).length).toBeGreaterThan(0);
          expect(typeof agentAuthEntry!.name).toBe('string');
          expect((agentAuthEntry!.name as string).length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});

/**
 * Property 3: Preservation - authMethods entries conform to AuthMethod type
 * Validates: Requirements 3.1, 3.2
 *
 * For any InitializeRequest parameters, calling initialize() on the OpenAIAgent:
 * - SHALL continue to return agentInfo.name === 'openai-agent' and agentInfo.version === '1.0.0'
 * - SHALL continue to return protocolVersion === PROTOCOL_VERSION
 * - SHALL continue to return defined agentCapabilities
 * - IF authMethods is non-empty, every entry SHALL have non-empty id (string) and name (string)
 *   conforming to the ACP SDK AuthMethod type
 *
 * EXPECTED: This test PASSES on unfixed code because:
 * - agentInfo, protocolVersion, agentCapabilities are already correct
 * - authMethods conformance check is vacuously true for empty array (no entries to check)
 */
describe('Property 3: Preservation - authMethods entries conform to AuthMethod type', () => {
  it('preserves existing fields and authMethods entries conform to AuthMethod type for arbitrary params', async () => {
    const mockConnection = {
      sessionUpdate: jest.fn().mockResolvedValue(undefined),
      closed: new Promise(() => { }),
    } as any;

    const agent = new OpenAIAgent(mockConnection);

    await fc.assert(
      fc.asyncProperty(
        fc.record({
          protocolVersion: fc.string({ minLength: 1 }),
          clientInfo: fc.record({
            name: fc.string({ minLength: 1 }),
            version: fc.string({ minLength: 1 }),
          }),
        }),
        async (params) => {
          const response = await agent.initialize(params as any);

          // Preservation: agentInfo fields unchanged
          expect(response.agentInfo).toBeDefined();
          expect(response.agentInfo!.name).toBe('openai-agent');
          expect(response.agentInfo!.version).toBe('1.0.0');

          // Preservation: protocolVersion matches SDK constant
          expect(response.protocolVersion).toBe(PROTOCOL_VERSION);

          // Preservation: agentCapabilities is defined
          expect(response.agentCapabilities).toBeDefined();

          // AuthMethod type conformance: IF authMethods is non-empty,
          // every entry must have non-empty id (string) and name (string)
          if (response.authMethods && response.authMethods.length > 0) {
            const methods = response.authMethods as Array<Record<string, unknown>>;
            for (const method of methods) {
              expect(typeof method.id).toBe('string');
              expect((method.id as string).length).toBeGreaterThan(0);
              expect(typeof method.name).toBe('string');
              expect((method.name as string).length).toBeGreaterThan(0);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
