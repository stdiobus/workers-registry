/*
 * Apache License 2.0
 * Copyright (c) 2025–present Raman Marozau, Work Target Insight Function.
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
 * Configuration Module Unit Tests
 *
 * Tests for the Registry Launcher configuration loading functionality.
 */
import { loadConfig } from './config.js';
import { DEFAULT_CONFIG } from './types.js';
import { mkdirSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('loadConfig', () => {
  let testDir: string;
  let testConfigPath: string;
  const originalEnv = process.env;

  beforeEach(() => {
    // Create a unique test directory for each test
    testDir = join(tmpdir(), `config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    testConfigPath = join(testDir, 'config.json');

    // Reset environment variables
    process.env = { ...originalEnv };
    delete process.env.ACP_REGISTRY_URL;
  });

  afterEach(() => {
    // Clean up test files
    try {
      unlinkSync(testConfigPath);
    } catch {
      // File may not exist
    }
    try {
      rmdirSync(testDir);
    } catch {
      // Directory may not exist or not be empty
    }

    // Restore environment
    process.env = originalEnv;
  });

  describe('valid config file parsing', () => {
    /**
     * Parse config file as JSON
     */
    it('should parse valid config file with all fields', () => {
      const config = {
        registryUrl: 'https://custom.registry.example.com/registry.json',
        shutdownTimeoutSec: 10,
      };
      writeFileSync(testConfigPath, JSON.stringify(config));

      const result = loadConfig(testConfigPath);

      expect(result.registryUrl).toBe('https://custom.registry.example.com/registry.json');
      expect(result.shutdownTimeoutSec).toBe(10);
    });

    it('should apply defaults for missing fields', () => {
      const config = {
        registryUrl: 'https://custom.registry.example.com/registry.json',
      };
      writeFileSync(testConfigPath, JSON.stringify(config));

      const result = loadConfig(testConfigPath);

      expect(result.registryUrl).toBe('https://custom.registry.example.com/registry.json');
      expect(result.shutdownTimeoutSec).toBe(DEFAULT_CONFIG.shutdownTimeoutSec);
    });

    it('should apply defaults for partial config with only shutdownTimeoutSec', () => {
      const config = {
        shutdownTimeoutSec: 15,
      };
      writeFileSync(testConfigPath, JSON.stringify(config));

      const result = loadConfig(testConfigPath);

      expect(result.registryUrl).toBe(DEFAULT_CONFIG.registryUrl);
      expect(result.shutdownTimeoutSec).toBe(15);
    });

    it('should handle empty object config', () => {
      writeFileSync(testConfigPath, JSON.stringify({}));

      const result = loadConfig(testConfigPath);

      expect(result).toEqual(DEFAULT_CONFIG);
    });
  });

  describe('missing config file handling', () => {
    /**
     * Use defaults and log warning for missing file
     */
    it('should use defaults when config file is missing', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const result = loadConfig('/nonexistent/path/config.json');

      expect(result).toEqual(DEFAULT_CONFIG);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('not found'),
      );

      consoleSpy.mockRestore();
    });
  });

  describe('malformed JSON handling', () => {
    /**
     * Use defaults and log warning for malformed JSON
     */
    it('should use defaults when config file contains malformed JSON', () => {
      writeFileSync(testConfigPath, '{ invalid json }');
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const result = loadConfig(testConfigPath);

      expect(result).toEqual(DEFAULT_CONFIG);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('malformed JSON'),
      );

      consoleSpy.mockRestore();
    });

    it('should use defaults when config file is empty', () => {
      writeFileSync(testConfigPath, '');
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const result = loadConfig(testConfigPath);

      expect(result).toEqual(DEFAULT_CONFIG);

      consoleSpy.mockRestore();
    });

    it('should use defaults when config file contains only whitespace', () => {
      writeFileSync(testConfigPath, '   \n\t  ');
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const result = loadConfig(testConfigPath);

      expect(result).toEqual(DEFAULT_CONFIG);

      consoleSpy.mockRestore();
    });
  });

  describe('environment variable override', () => {
    /**
     * Environment variable override for registry URL
     */
    it('should override registryUrl with ACP_REGISTRY_URL environment variable', () => {
      const config = {
        registryUrl: 'https://config-file.example.com/registry.json',
        shutdownTimeoutSec: 10,
      };
      writeFileSync(testConfigPath, JSON.stringify(config));
      process.env.ACP_REGISTRY_URL = 'https://env-override.example.com/registry.json';

      const result = loadConfig(testConfigPath);

      expect(result.registryUrl).toBe('https://env-override.example.com/registry.json');
      expect(result.shutdownTimeoutSec).toBe(10);
    });

    it('should use environment variable even when no config file provided', () => {
      process.env.ACP_REGISTRY_URL = 'https://env-only.example.com/registry.json';

      const result = loadConfig();

      expect(result.registryUrl).toBe('https://env-only.example.com/registry.json');
      expect(result.shutdownTimeoutSec).toBe(DEFAULT_CONFIG.shutdownTimeoutSec);
    });

    it('should ignore empty environment variable', () => {
      const config = {
        registryUrl: 'https://config-file.example.com/registry.json',
      };
      writeFileSync(testConfigPath, JSON.stringify(config));
      process.env.ACP_REGISTRY_URL = '';

      const result = loadConfig(testConfigPath);

      expect(result.registryUrl).toBe('https://config-file.example.com/registry.json');
    });
  });

  describe('invalid field types handling', () => {
    /**
     * se defaults for invalid field types
     */
    it('should use default for registryUrl when it is not a string', () => {
      const config = {
        registryUrl: 12345,
        shutdownTimeoutSec: 10,
      };
      writeFileSync(testConfigPath, JSON.stringify(config));
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const result = loadConfig(testConfigPath);

      expect(result.registryUrl).toBe(DEFAULT_CONFIG.registryUrl);
      expect(result.shutdownTimeoutSec).toBe(10);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('registryUrl'),
      );

      consoleSpy.mockRestore();
    });

    it('should use default for registryUrl when it is an empty string', () => {
      const config = {
        registryUrl: '',
        shutdownTimeoutSec: 10,
      };
      writeFileSync(testConfigPath, JSON.stringify(config));
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const result = loadConfig(testConfigPath);

      expect(result.registryUrl).toBe(DEFAULT_CONFIG.registryUrl);
      expect(result.shutdownTimeoutSec).toBe(10);

      consoleSpy.mockRestore();
    });

    it('should use default for shutdownTimeoutSec when it is not a number', () => {
      const config = {
        registryUrl: 'https://custom.example.com/registry.json',
        shutdownTimeoutSec: 'ten',
      };
      writeFileSync(testConfigPath, JSON.stringify(config));
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const result = loadConfig(testConfigPath);

      expect(result.registryUrl).toBe('https://custom.example.com/registry.json');
      expect(result.shutdownTimeoutSec).toBe(DEFAULT_CONFIG.shutdownTimeoutSec);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('shutdownTimeoutSec'),
      );

      consoleSpy.mockRestore();
    });

    it('should use default for shutdownTimeoutSec when it is zero', () => {
      const config = {
        shutdownTimeoutSec: 0,
      };
      writeFileSync(testConfigPath, JSON.stringify(config));
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const result = loadConfig(testConfigPath);

      expect(result.shutdownTimeoutSec).toBe(DEFAULT_CONFIG.shutdownTimeoutSec);

      consoleSpy.mockRestore();
    });

    it('should use default for shutdownTimeoutSec when it is negative', () => {
      const config = {
        shutdownTimeoutSec: -5,
      };
      writeFileSync(testConfigPath, JSON.stringify(config));
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const result = loadConfig(testConfigPath);

      expect(result.shutdownTimeoutSec).toBe(DEFAULT_CONFIG.shutdownTimeoutSec);

      consoleSpy.mockRestore();
    });

    it('should use default for shutdownTimeoutSec when it is NaN', () => {
      const config = {
        shutdownTimeoutSec: NaN,
      };
      writeFileSync(testConfigPath, JSON.stringify(config));
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const result = loadConfig(testConfigPath);

      expect(result.shutdownTimeoutSec).toBe(DEFAULT_CONFIG.shutdownTimeoutSec);

      consoleSpy.mockRestore();
    });

    it('should use default for shutdownTimeoutSec when it is Infinity', () => {
      const config = {
        shutdownTimeoutSec: Infinity,
      };
      writeFileSync(testConfigPath, JSON.stringify(config));
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const result = loadConfig(testConfigPath);

      expect(result.shutdownTimeoutSec).toBe(DEFAULT_CONFIG.shutdownTimeoutSec);

      consoleSpy.mockRestore();
    });

    it('should use defaults when config is not an object', () => {
      writeFileSync(testConfigPath, JSON.stringify('just a string'));
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const result = loadConfig(testConfigPath);

      expect(result).toEqual(DEFAULT_CONFIG);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('valid object'),
      );

      consoleSpy.mockRestore();
    });

    it('should use defaults when config is null', () => {
      writeFileSync(testConfigPath, JSON.stringify(null));
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const result = loadConfig(testConfigPath);

      expect(result).toEqual(DEFAULT_CONFIG);

      consoleSpy.mockRestore();
    });

    it('should use defaults when config is an array', () => {
      writeFileSync(testConfigPath, JSON.stringify([1, 2, 3]));
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const result = loadConfig(testConfigPath);

      expect(result).toEqual(DEFAULT_CONFIG);

      consoleSpy.mockRestore();
    });
  });

  describe('no config path provided', () => {
    /**
     * Use defaults when no config path provided
     */
    it('should use defaults when no config path is provided', () => {
      const result = loadConfig();

      expect(result).toEqual(DEFAULT_CONFIG);
    });

    it('should use defaults when config path is undefined', () => {
      const result = loadConfig(undefined);

      expect(result).toEqual(DEFAULT_CONFIG);
    });
  });

  describe('extra fields handling', () => {
    it('should ignore extra fields in config file', () => {
      const config = {
        registryUrl: 'https://custom.example.com/registry.json',
        shutdownTimeoutSec: 10,
        extraField: 'should be ignored',
        anotherExtra: 123,
      };
      writeFileSync(testConfigPath, JSON.stringify(config));

      const result = loadConfig(testConfigPath);

      expect(result.registryUrl).toBe('https://custom.example.com/registry.json');
      expect(result.shutdownTimeoutSec).toBe(10);
      expect((result as unknown as Record<string, unknown>).extraField).toBeUndefined();
      expect((result as unknown as Record<string, unknown>).anotherExtra).toBeUndefined();
    });
  });

  describe('decimal shutdownTimeoutSec', () => {
    it('should accept decimal values for shutdownTimeoutSec', () => {
      const config = {
        shutdownTimeoutSec: 2.5,
      };
      writeFileSync(testConfigPath, JSON.stringify(config));

      const result = loadConfig(testConfigPath);

      expect(result.shutdownTimeoutSec).toBe(2.5);
    });
  });
});
