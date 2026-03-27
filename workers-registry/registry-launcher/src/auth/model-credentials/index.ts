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
 * Model Credentials Module
 *
 * This module provides API key management for upstream model providers
 * (OpenAI, Anthropic). These providers do NOT offer public OAuth IdP
 * for third-party login - they use API keys instead.
 *
 * This module clearly separates:
 * - User identity (OAuth/OIDC): Handled by the main auth module
 * - Model API access (API Keys): Handled by this module
 *
 * Requirements: 7b.1, 7b.3
 *
 * @module model-credentials
 */

// =============================================================================
// Type Exports
// =============================================================================

export type {
  // Provider types
  ModelProviderId,

  // Credential types
  ModelCredential,
  StoredModelCredential,
  ModelCredentialResult,

  // Injection types
  ModelCredentialInjection,
  HeaderInjection,

  // Status types
  ModelCredentialStatus,
  ModelCredentialStatusEntry,
  ModelCredentialStatusMap,
} from './types.js';

// =============================================================================
// Constant and Function Exports
// =============================================================================

export {
  // Validation
  VALID_MODEL_PROVIDER_IDS,
  isValidModelProviderId,

  // Injection configuration
  MODEL_CREDENTIAL_INJECTION_CONFIG,
} from './types.js';

// =============================================================================
// OpenAI API Key Handler
// =============================================================================

export type { IModelCredentialStorage } from './openai-api-key.js';

export {
  OpenAIApiKeyHandler,
  createOpenAIApiKeyHandler,
  OPENAI_PROVIDER_ID,
  OPENAI_API_KEY_PREFIX,
  OPENAI_API_KEY_MIN_LENGTH,
  OPENAI_STORAGE_KEY,
} from './openai-api-key.js';

// =============================================================================
// Anthropic API Key Handler
// =============================================================================

export {
  AnthropicApiKeyHandler,
  createAnthropicApiKeyHandler,
  ANTHROPIC_PROVIDER_ID,
  ANTHROPIC_API_KEY_PREFIX,
  ANTHROPIC_API_KEY_MIN_LENGTH,
  ANTHROPIC_STORAGE_KEY,
} from './anthropic-api-key.js';
