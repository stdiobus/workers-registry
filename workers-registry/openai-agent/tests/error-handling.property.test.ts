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
import { classifyHttpError } from '../src/client';

/**
 * Property 10: HTTP error classification
 * Validates: Requirements 6.1, 6.3, 6.6
 *
 * For any HTTP status code in {401, 403}, the error handler SHALL produce a message
 * containing "authentication". For any HTTP status code >= 500, the error handler SHALL
 * produce a message containing "server error". For any HTTP error response, the error
 * message SHALL include the endpoint URL and the HTTP status code.
 */
describe('Property 10: HTTP error classification', () => {
  it('produces "Authentication" message for 401/403 status codes', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(401, 403),
        fc.webUrl(),
        (status, url) => {
          const message = classifyHttpError(status, url);
          expect(message.toLowerCase()).toContain('authentication');
          expect(message).toContain(url);
          expect(message).toContain(String(status));
        },
      ),
      { numRuns: 100 },
    );
  });

  it('produces "Server error" message for status codes >= 500', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 500, max: 599 }),
        fc.webUrl(),
        (status, url) => {
          const message = classifyHttpError(status, url);
          expect(message.toLowerCase()).toContain('server error');
          expect(message).toContain(url);
          expect(message).toContain(String(status));
        },
      ),
      { numRuns: 100 },
    );
  });

  it('produces "Rate limit" message for 429 status code', () => {
    fc.assert(
      fc.property(
        fc.webUrl(),
        (url) => {
          const message = classifyHttpError(429, url);
          expect(message.toLowerCase()).toContain('rate limit');
          expect(message).toContain(url);
          expect(message).toContain('429');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('includes endpoint URL in all error messages', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constantFrom(401, 403),
          fc.constant(429),
          fc.integer({ min: 500, max: 599 }),
          fc.integer({ min: 400, max: 499 }).filter(s => s !== 401 && s !== 403 && s !== 429),
        ),
        fc.webUrl(),
        (status, url) => {
          const message = classifyHttpError(status, url);
          expect(message).toContain(url);
        },
      ),
      { numRuns: 100 },
    );
  });
});
