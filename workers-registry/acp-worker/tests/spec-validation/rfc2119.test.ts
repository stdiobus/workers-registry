/*
 * Apache License 2.0
 * Copyright (c) 2025–present Raman Marozau, Work Target Insight Function.
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
 * Property tests for RFC 2119 language usage in specification documents.
 *
 * Feature: reference-implementation-docs, Property 1: RFC 2119 Language Usage
 *
 *
 * @module spec-validation/rfc2119.test
 */
import * as fs from 'fs';
import * as path from 'path';

describe('Specification Document RFC 2119 Compliance', () => {
  const specPath = path.resolve(__dirname, '../../../spec/agent-transport-os.md');

  /**
   * Feature: reference-implementation-docs, Property 1: RFC 2119 Language Usage
   *
   * *For any* normative specification document, the document SHALL contain
   * RFC 2119 keywords (SHALL, SHOULD, MAY, MUST, MUST NOT) to express
   * requirement levels.
   *
   */
  it('spec document contains RFC 2119 keywords', () => {
    const content = fs.readFileSync(specPath, 'utf8');
    const rfc2119Keywords = ['SHALL', 'SHOULD', 'MAY', 'MUST', 'MUST NOT'];
    const hasKeywords = rfc2119Keywords.some(kw => content.includes(kw));
    expect(hasKeywords).toBe(true);
  });

  /**
   * Verify that the spec document contains the RFC 2119 conformance statement.
   *
   */
  it('spec document contains RFC 2119 conformance statement', () => {
    const content = fs.readFileSync(specPath, 'utf8');
    expect(content).toContain('RFC 2119');
  });

  /**
   * Verify that multiple RFC 2119 keywords are used throughout the document.
   *
   */
  it('spec document uses multiple RFC 2119 keywords', () => {
    const content = fs.readFileSync(specPath, 'utf8');
    const rfc2119Keywords = ['SHALL', 'SHOULD', 'MAY', 'MUST', 'MUST NOT'];
    const foundKeywords = rfc2119Keywords.filter(kw => content.includes(kw));
    // Expect at least 3 different RFC 2119 keywords to be used
    expect(foundKeywords.length).toBeGreaterThanOrEqual(3);
  });

  /**
   * Verify that the spec document exists at the expected location.
   *
   */
  it('spec document exists at spec/agent-transport-os.md', () => {
    expect(fs.existsSync(specPath)).toBe(true);
  });
});
