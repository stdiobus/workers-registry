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
 * AWS Cognito OAuth 2.1 provider implementation.
 *
 * @module providers/cognito-provider
 */

import { BaseAuthProvider } from './base-provider.js';

/**
 * Configuration options for Cognito provider.
 */
export interface CognitoProviderConfig {
  /** Cognito user pool domain (e.g., 'my-app' for my-app.auth.us-east-1.amazoncognito.com) */
  userPoolDomain: string;
  /** AWS region (e.g., 'us-east-1') */
  region: string;
  /** OAuth client ID */
  clientId?: string;
  /** OAuth client secret (optional) */
  clientSecret?: string;
}

/**
 * AWS Cognito OAuth provider.
 *
 * Endpoints are dynamically constructed based on user pool domain and region:
 * - Authorization: https://{domain}.auth.{region}.amazoncognito.com/oauth2/authorize
 * - Token: https://{domain}.auth.{region}.amazoncognito.com/oauth2/token
 *
 * Default scopes: openid, profile
 * Token injection: Bearer header
 */
export class CognitoProvider extends BaseAuthProvider {
  constructor(config: CognitoProviderConfig) {
    const baseUrl = `https://${config.userPoolDomain}.auth.${config.region}.amazoncognito.com`;

    super({
      id: 'cognito',
      name: 'AWS Cognito',
      authorizationEndpoint: `${baseUrl}/oauth2/authorize`,
      tokenEndpoint: `${baseUrl}/oauth2/token`,
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
