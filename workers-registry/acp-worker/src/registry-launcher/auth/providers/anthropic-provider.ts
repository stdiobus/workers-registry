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
 * Anthropic OAuth 2.1 provider implementation.
 *
 * @module providers/anthropic-provider
 */

import { BaseAuthProvider } from './base-provider.js';

/**
 * Anthropic OAuth provider.
 *
 * Endpoints:
 * - Authorization: https://auth.anthropic.com/authorize
 * - Token: https://auth.anthropic.com/token
 *
 * Default scopes: api
 * Token injection: x-api-key header
 */
export class AnthropicProvider extends BaseAuthProvider {
  constructor(clientId?: string) {
    super({
      id: 'anthropic',
      name: 'Anthropic',
      authorizationEndpoint: 'https://auth.anthropic.com/authorize',
      tokenEndpoint: 'https://auth.anthropic.com/token',
      defaultScopes: ['api'],
      tokenInjection: {
        type: 'header',
        key: 'x-api-key',
      },
      clientId,
    });
  }
}
