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
 * Unit tests for CLI provider configuration.
 *
 * Tests that the provider list correctly:
 * - Excludes OpenAI/Anthropic from OAuth providers
 * - Includes Generic OIDC provider
 * - Shows "Microsoft Entra ID" instead of "Azure AD"
 *
 * **Validates: Requirements 7.1, 7b.1**
 *
 * @module cli/provider-config.test
 */

import { getAllProviderInfo, getProviderInfo } from '../flows/terminal-auth-flow.js';
import { VALID_PROVIDER_IDS } from '../types.js';
import { VALID_MODEL_PROVIDER_IDS } from '../model-credentials/index.js';

describe('Provider Configuration Tests (Requirements 7.1, 7b.1)', () => {
  describe('PROVIDER_INFO Configuration', () => {
    /**
     * **Validates: Requirement 7.1**
     * PROVIDER_INFO should contain exactly 5 OAuth providers
     */
    it('should contain exactly 5 OAuth providers', () => {
      const providers = getAllProviderInfo();
      expect(providers).toHaveLength(5);
    });

    /**
     * **Validates: Requirement 7.1**
     * PROVIDER_INFO should contain github, google, cognito, azure, oidc
     */
    it('should contain github, google, cognito, azure, and oidc providers', () => {
      const providers = getAllProviderInfo();
      const providerIds = providers.map(p => p.id);

      expect(providerIds).toContain('github');
      expect(providerIds).toContain('google');
      expect(providerIds).toContain('cognito');
      expect(providerIds).toContain('azure');
      expect(providerIds).toContain('oidc');
    });

    /**
     * **Validates: Requirement 7b.1**
     * PROVIDER_INFO should NOT contain 'openai' as OAuth provider
     */
    it('should NOT contain openai as OAuth provider', () => {
      const providers = getAllProviderInfo();
      const providerIds = providers.map(p => p.id);

      expect(providerIds).not.toContain('openai');
    });

    /**
     * **Validates: Requirement 7b.1**
     * PROVIDER_INFO should NOT contain 'anthropic' as OAuth provider
     */
    it('should NOT contain anthropic as OAuth provider', () => {
      const providers = getAllProviderInfo();
      const providerIds = providers.map(p => p.id);

      expect(providerIds).not.toContain('anthropic');
    });

    /**
     * **Validates: Requirement 7.1**
     * Azure provider should have name "Microsoft Entra ID" (not "Azure AD")
     */
    it('should show "Microsoft Entra ID" for azure provider', () => {
      const azureProvider = getProviderInfo('azure');

      expect(azureProvider).toBeDefined();
      expect(azureProvider?.name).toBe('Microsoft Entra ID');
      expect(azureProvider?.name).not.toBe('Azure AD');
    });

    /**
     * **Validates: Requirement 7a.1**
     * OIDC provider should have name "Generic OIDC"
     */
    it('should show "Generic OIDC" for oidc provider', () => {
      const oidcProvider = getProviderInfo('oidc');

      expect(oidcProvider).toBeDefined();
      expect(oidcProvider?.name).toBe('Generic OIDC');
    });

    /**
     * **Validates: Requirement 7.1**
     * All providers should have required configuration fields
     */
    it('should have required configuration fields for all providers', () => {
      const providers = getAllProviderInfo();

      for (const provider of providers) {
        expect(provider.id).toBeDefined();
        expect(provider.name).toBeDefined();
        expect(typeof provider.requiresClientSecret).toBe('boolean');
        expect(typeof provider.requiresCustomEndpoints).toBe('boolean');
        expect(typeof provider.supportsApiKey).toBe('boolean');
        expect(typeof provider.supportsOAuth).toBe('boolean');
      }
    });

    /**
     * **Validates: Requirement 7.1**
     * Provider IDs in PROVIDER_INFO should match VALID_PROVIDER_IDS
     */
    it('should have provider IDs matching VALID_PROVIDER_IDS', () => {
      const providers = getAllProviderInfo();
      const providerIds = providers.map(p => p.id);

      // All PROVIDER_INFO IDs should be in VALID_PROVIDER_IDS
      for (const id of providerIds) {
        expect(VALID_PROVIDER_IDS).toContain(id);
      }

      // All VALID_PROVIDER_IDS should be in PROVIDER_INFO
      for (const id of VALID_PROVIDER_IDS) {
        expect(providerIds).toContain(id);
      }
    });
  });

  describe('Model Provider Separation', () => {
    /**
     * **Validates: Requirement 7b.1**
     * OpenAI and Anthropic should be in VALID_MODEL_PROVIDER_IDS
     */
    it('should have openai and anthropic in VALID_MODEL_PROVIDER_IDS', () => {
      expect(VALID_MODEL_PROVIDER_IDS).toContain('openai');
      expect(VALID_MODEL_PROVIDER_IDS).toContain('anthropic');
    });

    /**
     * **Validates: Requirement 7b.1**
     * VALID_MODEL_PROVIDER_IDS should contain exactly 2 providers
     */
    it('should have exactly 2 model providers', () => {
      expect(VALID_MODEL_PROVIDER_IDS).toHaveLength(2);
    });

    /**
     * **Validates: Requirement 7b.2**
     * OAuth providers and Model providers should be disjoint sets
     */
    it('should have no overlap between OAuth and Model providers', () => {
      const oauthProviders = getAllProviderInfo().map(p => p.id);

      for (const modelProvider of VALID_MODEL_PROVIDER_IDS) {
        expect(oauthProviders).not.toContain(modelProvider);
      }
    });
  });

  describe('Provider Display Names', () => {
    /**
     * **Validates: Requirement 7.1**
     * GitHub provider should have correct display name
     */
    it('should show "GitHub" for github provider', () => {
      const provider = getProviderInfo('github');
      expect(provider?.name).toBe('GitHub');
    });

    /**
     * **Validates: Requirement 7.1**
     * Google provider should have correct display name
     */
    it('should show "Google" for google provider', () => {
      const provider = getProviderInfo('google');
      expect(provider?.name).toBe('Google');
    });

    /**
     * **Validates: Requirement 7.1**
     * Cognito provider should have correct display name
     */
    it('should show "AWS Cognito" for cognito provider', () => {
      const provider = getProviderInfo('cognito');
      expect(provider?.name).toBe('AWS Cognito');
    });
  });

  describe('Provider Custom Endpoint Requirements', () => {
    /**
     * **Validates: Requirement 7.3**
     * Cognito should require custom endpoints
     */
    it('should require custom endpoints for cognito', () => {
      const provider = getProviderInfo('cognito');
      expect(provider?.requiresCustomEndpoints).toBe(true);
    });

    /**
     * **Validates: Requirement 7.4**
     * Azure should require custom endpoints
     */
    it('should require custom endpoints for azure', () => {
      const provider = getProviderInfo('azure');
      expect(provider?.requiresCustomEndpoints).toBe(true);
    });

    /**
     * **Validates: Requirement 7a.2**
     * Generic OIDC should require custom endpoints
     */
    it('should require custom endpoints for oidc', () => {
      const provider = getProviderInfo('oidc');
      expect(provider?.requiresCustomEndpoints).toBe(true);
    });

    /**
     * **Validates: Requirement 7.1**
     * GitHub should NOT require custom endpoints
     */
    it('should NOT require custom endpoints for github', () => {
      const provider = getProviderInfo('github');
      expect(provider?.requiresCustomEndpoints).toBe(false);
    });

    /**
     * **Validates: Requirement 7.1**
     * Google should NOT require custom endpoints
     */
    it('should NOT require custom endpoints for google', () => {
      const provider = getProviderInfo('google');
      expect(provider?.requiresCustomEndpoints).toBe(false);
    });
  });
});
