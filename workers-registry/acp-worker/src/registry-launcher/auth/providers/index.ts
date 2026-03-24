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
 * Provider registry and factory.
 *
 * Provides access to OAuth provider implementations.
 *
 * @module providers
 */

import type { AuthProviderId } from '../types.js';
import type { IAuthProvider } from './types.js';

/**
 * Provider factory function type.
 */
export type ProviderFactory = () => IAuthProvider;

/**
 * Internal registry of provider factories.
 */
const providerRegistry = new Map<AuthProviderId, ProviderFactory>();

/**
 * List of supported OAuth provider IDs.
 */
export const SUPPORTED_PROVIDERS: readonly AuthProviderId[] = [
  'openai',
  'github',
  'google',
  'cognito',
  'azure',
  'anthropic',
] as const;

/**
 * Register a provider factory.
 *
 * @param providerId - The provider identifier
 * @param factory - Factory function that creates the provider
 */
export function registerProvider(providerId: AuthProviderId, factory: ProviderFactory): void {
  providerRegistry.set(providerId, factory);
}

/**
 * Unregister a provider.
 *
 * @param providerId - The provider identifier to unregister
 * @returns True if the provider was unregistered
 */
export function unregisterProvider(providerId: AuthProviderId): boolean {
  return providerRegistry.delete(providerId);
}

/**
 * Clear all registered providers.
 * Useful for testing.
 */
export function clearProviders(): void {
  providerRegistry.clear();
}

/**
 * Get a provider implementation by ID.
 *
 * @param providerId - The provider identifier
 * @returns The provider implementation
 * @throws Error if provider is not registered
 */
export function getProvider(providerId: AuthProviderId): IAuthProvider {
  const factory = providerRegistry.get(providerId);
  if (!factory) {
    const supported = getRegisteredProviders().join(', ') || 'none';
    throw new Error(
      `Provider '${providerId}' is not registered. Registered providers: ${supported}`
    );
  }
  return factory();
}

/**
 * Check if a provider is registered.
 *
 * @param providerId - The provider identifier
 * @returns True if the provider is registered
 */
export function hasProvider(providerId: AuthProviderId): boolean {
  return providerRegistry.has(providerId);
}

/**
 * Get the list of registered provider IDs.
 *
 * @returns Array of registered provider identifiers
 */
export function getRegisteredProviders(): AuthProviderId[] {
  return Array.from(providerRegistry.keys());
}

/**
 * Get the list of supported provider IDs.
 *
 * @returns Array of supported provider identifiers
 */
export function getSupportedProviders(): readonly AuthProviderId[] {
  return SUPPORTED_PROVIDERS;
}

/**
 * Check if a provider ID is valid (supported).
 *
 * @param providerId - The provider identifier to check
 * @returns True if the provider is supported
 */
export function isValidProviderId(providerId: string): providerId is AuthProviderId {
  return SUPPORTED_PROVIDERS.includes(providerId as AuthProviderId);
}

/**
 * Check if a provider ID is registered and available.
 *
 * @param providerId - The provider identifier to check
 * @returns True if the provider is registered
 */
export function isProviderAvailable(providerId: string): boolean {
  return isValidProviderId(providerId) && hasProvider(providerId as AuthProviderId);
}

// Re-export types
export type { IAuthProvider } from './types.js';
export { BaseAuthProvider } from './base-provider.js';
export type { BaseProviderConfig } from './base-provider.js';

// Re-export concrete providers
export { OpenAIProvider } from './openai-provider.js';
export { GitHubProvider } from './github-provider.js';
export { GoogleProvider } from './google-provider.js';
export { CognitoProvider } from './cognito-provider.js';
export type { CognitoProviderConfig } from './cognito-provider.js';
export { AzureProvider } from './azure-provider.js';
export type { AzureProviderConfig } from './azure-provider.js';
export { AnthropicProvider } from './anthropic-provider.js';
