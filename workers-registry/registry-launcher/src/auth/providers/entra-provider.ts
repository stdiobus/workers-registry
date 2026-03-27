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
 * Microsoft Entra ID (formerly Azure AD) OAuth 2.1 provider implementation.
 *
 * @module providers/entra-provider
 */

import { BaseAuthProvider } from './base-provider.js';

/**
 * Configuration options for Microsoft Entra ID provider.
 * 
 * @remarks
 * Microsoft renamed Azure AD to Microsoft Entra ID in 2023.
 * This provider supports both single-tenant and multi-tenant configurations.
 */
export interface EntraProviderConfig {
  /** Microsoft Entra ID tenant ID or 'common' for multi-tenant */
  tenantId: string;
  /** OAuth client ID */
  clientId?: string;
  /** OAuth client secret (optional) */
  clientSecret?: string;
}

/**
 * @deprecated Use EntraProviderConfig instead. Kept for backward compatibility.
 */
export type AzureProviderConfig = EntraProviderConfig;

/**
 * Well-known Microsoft Entra ID tenant values for multi-tenant scenarios.
 */
const WELL_KNOWN_TENANTS = new Set(['common', 'organizations', 'consumers']);

/**
 * Pattern for valid Microsoft Entra ID tenant GUIDs.
 * Format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
 */
const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Pattern for valid Microsoft Entra ID verified domain names.
 * Must be a valid domain format without URL injection characters.
 */
const DOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;

/**
 * Microsoft Entra ID (formerly Azure AD) OAuth provider.
 *
 * Endpoints are dynamically constructed based on tenant ID:
 * - Authorization: https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize
 * - Token: https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token
 *
 * Use 'common' for multi-tenant applications.
 *
 * Default scopes: openid, profile
 * Token injection: Bearer header
 * 
 * @remarks
 * The provider ID remains 'azure' for backward compatibility with existing
 * configurations and the ACP Registry.
 */
export class EntraIdProvider extends BaseAuthProvider {
  constructor(config: EntraProviderConfig) {
    // Validate tenantId to prevent URL injection
    EntraIdProvider.validateTenantId(config.tenantId);

    const baseUrl = `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0`;

    super({
      id: 'azure',  // Keep 'azure' as provider ID for backward compatibility
      name: 'Microsoft Entra ID',
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

  /**
   * Validate Microsoft Entra ID tenant ID.
   * @param tenantId - The tenant ID to validate
   * @throws Error if tenantId is invalid or contains injection characters
   */
  private static validateTenantId(tenantId: string): void {
    if (!tenantId || typeof tenantId !== 'string') {
      throw new Error('Entra ID tenantId is required');
    }

    const trimmed = tenantId.trim();
    if (trimmed !== tenantId) {
      throw new Error('Entra ID tenantId must not contain leading/trailing whitespace');
    }

    if (tenantId.length === 0) {
      throw new Error('Entra ID tenantId cannot be empty');
    }

    // Check for URL injection characters
    if (/[/:?#@\s]/.test(tenantId)) {
      throw new Error('Entra ID tenantId contains invalid characters (/, :, ?, #, @, or whitespace)');
    }

    // Accept well-known tenant values
    if (WELL_KNOWN_TENANTS.has(tenantId.toLowerCase())) {
      return;
    }

    // Accept valid GUIDs
    if (GUID_PATTERN.test(tenantId)) {
      return;
    }

    // Accept valid domain names (verified domains)
    if (DOMAIN_PATTERN.test(tenantId)) {
      return;
    }

    throw new Error(
      `Entra ID tenantId must be 'common', 'organizations', 'consumers', a valid GUID, or a verified domain name`
    );
  }
}

/**
 * @deprecated Use EntraIdProvider instead. Kept for backward compatibility.
 */
export const AzureProvider = EntraIdProvider;
