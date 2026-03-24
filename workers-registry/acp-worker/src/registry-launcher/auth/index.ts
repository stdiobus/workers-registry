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
 * OAuth 2.1 Authentication Module
 *
 * This module provides OAuth 2.1 authentication for the Registry Launcher worker.
 * It supports multiple OAuth providers (OpenAI, GitHub, Google, AWS Cognito, Azure AD, Anthropic)
 * and two authentication modes:
 * - Agent Auth: Browser-based OAuth 2.1 Authorization Code flow with PKCE
 * - Terminal Auth: Interactive CLI setup flow for headless environments
 *
 * @module auth
 */

// =============================================================================
// Core Types
// =============================================================================

export type {
  // Provider and status types
  AuthProviderId,
  StorageBackendType,
  TokenStatus,
  AuthErrorCode,

  // Token and credential types
  TokenResponse,
  StoredCredentials,
  TokenInjectionMethod,
  ProviderEndpoints,

  // Authorization flow types
  AuthorizationParams,
  CallbackResult,
  AgentAuthOptions,

  // Result and error types
  AuthResult,
  AuthError,
  AuthStatusEntry,
  AuthStatusMap,

  // Configuration types
  ProviderConfig,
  AuthConfig,

  // ACP protocol types
  AcpAuthMethod,
} from './types.js';

// =============================================================================
// PKCE Module
// =============================================================================

export {
  generateCodeVerifier,
  generateCodeChallenge,
  generatePKCEPair,
} from './pkce.js';

// =============================================================================
// State Parameter Module
// =============================================================================

export {
  generateState,
  validateState,
} from './state.js';

// =============================================================================
// Session Management
// =============================================================================

export type { IAuthSession } from './session.js';
export { AuthSession, createSession, SessionManager, DEFAULT_SESSION_TIMEOUT_MS } from './session.js';

// =============================================================================
// Auth Manager
// =============================================================================

export { AuthManager } from './auth-manager.js';

// =============================================================================
// Token Manager
// =============================================================================

export type { ITokenManager } from './token-manager.js';
export { TokenManager } from './token-manager.js';

// =============================================================================
// Providers
// =============================================================================

export type { IAuthProvider } from './providers/types.js';
export {
  getProvider,
  getSupportedProviders,
  isValidProviderId,
} from './providers/index.js';

// =============================================================================
// Storage
// =============================================================================

export type { ICredentialStore, IStorageBackend } from './storage/types.js';
export { CredentialStore } from './storage/credential-store.js';

// =============================================================================
// Flows
// =============================================================================

export type { ICallbackServer } from './flows/callback-server.js';
export { AgentAuthFlow } from './flows/agent-auth-flow.js';
export { TerminalAuthFlow } from './flows/terminal-auth-flow.js';

// =============================================================================
// CLI Commands
// =============================================================================

export {
  runSetupCommand,
  runStatusCommand,
  runLogoutCommand,
} from './cli/index.js';
