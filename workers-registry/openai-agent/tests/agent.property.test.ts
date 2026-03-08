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
