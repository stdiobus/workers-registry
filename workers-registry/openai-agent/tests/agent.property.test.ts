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
import { OpenAIAgent } from '../src/agent';

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
