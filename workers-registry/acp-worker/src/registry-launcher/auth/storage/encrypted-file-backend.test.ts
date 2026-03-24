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
 * Unit tests for EncryptedFileBackend.
 *
 * @module storage/encrypted-file-backend.test
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import type { AuthProviderId, StoredCredentials } from '../types.js';
import { EncryptedFileBackend } from './encrypted-file-backend.js';

describe('EncryptedFileBackend', () => {
  let backend: EncryptedFileBackend;
  let testDir: string;
  let testFilePath: string;

  beforeEach(async () => {
    // Create a unique test directory for each test
    testDir = path.join(os.tmpdir(), `encrypted-file-backend-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    testFilePath = path.join(testDir, 'test-credentials.enc');
    await fs.mkdir(testDir, { recursive: true });
    backend = new EncryptedFileBackend(testFilePath);
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  const createTestCredentials = (providerId: AuthProviderId): StoredCredentials => ({
    providerId,
    accessToken: `test-access-token-${providerId}`,
    refreshToken: `test-refresh-token-${providerId}`,
    expiresAt: Date.now() + 3600000,
    scope: 'openid profile',
    storedAt: Date.now(),
  });

  describe('type', () => {
    it('should return "encrypted-file"', () => {
      expect(backend.type).toBe('encrypted-file');
    });
  });

  describe('isAvailable', () => {
    it('should return true when directory is writable', async () => {
      const available = await backend.isAvailable();
      expect(available).toBe(true);
    });

    it('should return false when directory is not writable', async () => {
      // Use a path that doesn't exist and can't be created
      const invalidBackend = new EncryptedFileBackend('/nonexistent/path/that/cannot/be/created/credentials.enc');
      const available = await invalidBackend.isAvailable();
      expect(available).toBe(false);
    });
  });

  describe('store and retrieve', () => {
    it('should store and retrieve credentials for a provider', async () => {
      const credentials = createTestCredentials('openai');

      await backend.store('openai', credentials);
      const retrieved = await backend.retrieve('openai');

      expect(retrieved).toEqual(credentials);
    });

    it('should return null for non-existent provider', async () => {
      const retrieved = await backend.retrieve('github');
      expect(retrieved).toBeNull();
    });

    it('should store credentials for multiple providers', async () => {
      const openaiCreds = createTestCredentials('openai');
      const githubCreds = createTestCredentials('github');
      const googleCreds = createTestCredentials('google');

      await backend.store('openai', openaiCreds);
      await backend.store('github', githubCreds);
      await backend.store('google', googleCreds);

      expect(await backend.retrieve('openai')).toEqual(openaiCreds);
      expect(await backend.retrieve('github')).toEqual(githubCreds);
      expect(await backend.retrieve('google')).toEqual(googleCreds);
    });

    it('should overwrite existing credentials for the same provider', async () => {
      const oldCreds = createTestCredentials('openai');
      const newCreds = {
        ...createTestCredentials('openai'),
        accessToken: 'new-access-token',
      };

      await backend.store('openai', oldCreds);
      await backend.store('openai', newCreds);

      const retrieved = await backend.retrieve('openai');
      expect(retrieved?.accessToken).toBe('new-access-token');
    });

    it('should persist credentials across backend instances', async () => {
      const credentials = createTestCredentials('openai');

      await backend.store('openai', credentials);

      // Create a new backend instance with the same file path
      const newBackend = new EncryptedFileBackend(testFilePath);
      const retrieved = await newBackend.retrieve('openai');

      expect(retrieved).toEqual(credentials);
    });
  });

  describe('delete', () => {
    it('should delete credentials for a specific provider', async () => {
      const openaiCreds = createTestCredentials('openai');
      const githubCreds = createTestCredentials('github');

      await backend.store('openai', openaiCreds);
      await backend.store('github', githubCreds);

      await backend.delete('openai');

      expect(await backend.retrieve('openai')).toBeNull();
      expect(await backend.retrieve('github')).toEqual(githubCreds);
    });

    it('should not throw when deleting non-existent provider', async () => {
      await expect(backend.delete('openai')).resolves.not.toThrow();
    });
  });

  describe('deleteAll', () => {
    it('should delete all stored credentials', async () => {
      await backend.store('openai', createTestCredentials('openai'));
      await backend.store('github', createTestCredentials('github'));

      await backend.deleteAll();

      expect(await backend.retrieve('openai')).toBeNull();
      expect(await backend.retrieve('github')).toBeNull();
    });

    it('should not throw when no credentials exist', async () => {
      await expect(backend.deleteAll()).resolves.not.toThrow();
    });

    it('should remove the credentials file', async () => {
      await backend.store('openai', createTestCredentials('openai'));
      await backend.deleteAll();

      await expect(fs.access(testFilePath)).rejects.toThrow();
    });
  });

  describe('listProviders', () => {
    it('should return empty array when no credentials stored', async () => {
      const providers = await backend.listProviders();
      expect(providers).toEqual([]);
    });

    it('should return all providers with stored credentials', async () => {
      await backend.store('openai', createTestCredentials('openai'));
      await backend.store('github', createTestCredentials('github'));
      await backend.store('google', createTestCredentials('google'));

      const providers = await backend.listProviders();
      expect(providers).toHaveLength(3);
      expect(providers).toContain('openai');
      expect(providers).toContain('github');
      expect(providers).toContain('google');
    });
  });

  describe('encryption', () => {
    it('should store data in encrypted format', async () => {
      await backend.store('openai', createTestCredentials('openai'));

      // Read the raw file content
      const rawContent = await fs.readFile(testFilePath);

      // The content should not contain plaintext tokens
      const contentStr = rawContent.toString('utf8');
      expect(contentStr).not.toContain('test-access-token');
      expect(contentStr).not.toContain('test-refresh-token');
    });

    it('should have correct file format (IV + AuthTag + Ciphertext)', async () => {
      await backend.store('openai', createTestCredentials('openai'));

      const rawContent = await fs.readFile(testFilePath);

      // File should be at least IV (12) + AuthTag (16) + some ciphertext
      expect(rawContent.length).toBeGreaterThan(28);
    });

    it('should handle corrupted file gracefully', async () => {
      // Write corrupted data to the file
      await fs.writeFile(testFilePath, 'corrupted data');

      // Should return null (empty store) instead of throwing
      const retrieved = await backend.retrieve('openai');
      expect(retrieved).toBeNull();
    });

    it('should handle truncated file gracefully', async () => {
      // Write truncated data (less than IV + AuthTag)
      await fs.writeFile(testFilePath, Buffer.alloc(10));

      // Should return null (empty store) instead of throwing
      const retrieved = await backend.retrieve('openai');
      expect(retrieved).toBeNull();
    });
  });

  describe('atomic writes', () => {
    it('should write atomically using temporary file', async () => {
      await backend.store('openai', createTestCredentials('openai'));

      // Verify no temp file remains
      const files = await fs.readdir(testDir);
      const tempFiles = files.filter(f => f.endsWith('.tmp'));
      expect(tempFiles).toHaveLength(0);
    });
  });

  describe('provider isolation (Property 13)', () => {
    it('should not return credentials for a different provider', async () => {
      const openaiCreds = createTestCredentials('openai');
      await backend.store('openai', openaiCreds);

      // Retrieving a different provider should not return openai's credentials
      const githubCreds = await backend.retrieve('github');
      expect(githubCreds).toBeNull();

      // Verify openai credentials are still intact
      const retrievedOpenai = await backend.retrieve('openai');
      expect(retrievedOpenai).toEqual(openaiCreds);
    });
  });
});
