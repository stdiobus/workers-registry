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
 * Azure AD OAuth 2.1 provider implementation.
 *
 * @module providers/azure-provider
 */

import { BaseAuthProvider } from './base-provider.js';

/**
 * Configuration options for Azure AD provider.
 */
export interface AzureProviderConfig {
  /** Azure AD tenant ID or 'common' for multi-tenant */
  tenantId: string;
  /** OAuth client ID */
  clientId?: string;
  /** OAuth client secret (optional) */
  clientSecret?: string;
}

/**
 * Azure AD OAuth provider.
 *
 * Endpoints are dynamically constructed based on tenant ID:
 * - Authorization: https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize
 * - Token: https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token
 *
 * Use 'common' for multi-tenant applications.
 *
 * Default scopes: openid, profile
 * Token injection: Bearer header
 */
export class AzureProvider extends BaseAuthProvider {
  constructor(config: AzureProviderConfig) {
    const baseUrl = `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0`;

    super({
      id: 'azure',
      name: 'Azure AD',
      authorizationEndpoint: `${baseUrl}/authorize`,
      tokenEndpoint: `${baseUrl}/token`,
      defaultScopes: ['openid', 'profile'],
      tokenInjection: {
        type: 'header',
        key: 'Authorization',
        format: 'Bearer {token}',
      },
      clientId: config.clientId,
      clientSecret: config.clientSecret,
    });
  }
}
