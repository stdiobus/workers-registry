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
 * Pattern for valid Cognito user pool domain names.
 * Must be alphanumeric with hyphens, no leading/trailing hyphens.
 */
const VALID_DOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i;

/**
 * Pattern for valid AWS region names.
 * Format: xx-xxxx-N (e.g., us-east-1, eu-west-2)
 */
const VALID_REGION_PATTERN = /^[a-z]{2}-[a-z]+-\d+$/;

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
    // Validate userPoolDomain to prevent URL injection
    CognitoProvider.validateUserPoolDomain(config.userPoolDomain);
    // Validate region to prevent URL injection
    CognitoProvider.validateRegion(config.region);

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

  /**
   * Validate Cognito user pool domain name.
   * @param domain - The user pool domain to validate
   * @throws Error if domain is invalid or contains injection characters
   */
  private static validateUserPoolDomain(domain: string): void {
    if (!domain || typeof domain !== 'string') {
      throw new Error('Cognito userPoolDomain is required');
    }

    const trimmed = domain.trim();
    if (trimmed !== domain) {
      throw new Error('Cognito userPoolDomain must not contain leading/trailing whitespace');
    }

    if (domain.length === 0) {
      throw new Error('Cognito userPoolDomain cannot be empty');
    }

    if (domain.length > 63) {
      throw new Error('Cognito userPoolDomain must be 63 characters or less');
    }

    // Check for URL injection characters
    if (/[/:?#@\s]/.test(domain)) {
      throw new Error('Cognito userPoolDomain contains invalid characters (/, :, ?, #, @, or whitespace)');
    }

    if (!VALID_DOMAIN_PATTERN.test(domain)) {
      throw new Error(
        'Cognito userPoolDomain must be alphanumeric with hyphens, no leading/trailing hyphens'
      );
    }
  }

  /**
   * Validate AWS region name.
   * @param region - The AWS region to validate
   * @throws Error if region is invalid or contains injection characters
   */
  private static validateRegion(region: string): void {
    if (!region || typeof region !== 'string') {
      throw new Error('Cognito region is required');
    }

    const trimmed = region.trim();
    if (trimmed !== region) {
      throw new Error('Cognito region must not contain leading/trailing whitespace');
    }

    if (region.length === 0) {
      throw new Error('Cognito region cannot be empty');
    }

    // Check for URL injection characters
    if (/[/:?#@\s]/.test(region)) {
      throw new Error('Cognito region contains invalid characters (/, :, ?, #, @, or whitespace)');
    }

    if (!VALID_REGION_PATTERN.test(region)) {
      throw new Error(
        'Cognito region must be a valid AWS region format (e.g., us-east-1, eu-west-2)'
      );
    }
  }
}
