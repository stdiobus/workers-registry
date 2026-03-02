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
 * Unit Tests for Distribution Resolver Module
 *
 * Tests for platform detection, command construction for each distribution type,
 * and error handling for unsupported platforms.
 *
 * @module registry-launcher/registry/resolver.test
 */
import {
  getCurrentPlatform,
  PlatformNotSupportedError,
  resolve,
  resolveBinary,
  resolveNpx,
  resolveUvx,
} from './resolver.js';
import type { BinaryDistribution, NpxDistribution, UvxDistribution } from './types.js';

// Store original process.platform and process.arch
const originalPlatform = process.platform;
const originalArch = process.arch;

/**
 * Helper to mock process.platform and process.arch.
 */
function mockPlatform(platform: string, arch: string): void {
  Object.defineProperty(process, 'platform', { value: platform, writable: true });
  Object.defineProperty(process, 'arch', { value: arch, writable: true });
}

/**
 * Restore original platform values.
 */
function restorePlatform(): void {
  Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true });
  Object.defineProperty(process, 'arch', { value: originalArch, writable: true });
}

describe('getCurrentPlatform', () => {
  afterEach(() => {
    restorePlatform();
  });

  describe('platform detection', () => {
    /**
     * Resolve platform-specific binary path
     */
    it('should return darwin-x64 for macOS Intel', () => {
      mockPlatform('darwin', 'x64');
      expect(getCurrentPlatform()).toBe('darwin-x64');
    });

    it('should return darwin-arm64 for macOS Apple Silicon', () => {
      mockPlatform('darwin', 'arm64');
      expect(getCurrentPlatform()).toBe('darwin-arm64');
    });

    it('should return linux-x64 for Linux x64', () => {
      mockPlatform('linux', 'x64');
      expect(getCurrentPlatform()).toBe('linux-x64');
    });

    it('should return linux-arm64 for Linux ARM64', () => {
      mockPlatform('linux', 'arm64');
      expect(getCurrentPlatform()).toBe('linux-arm64');
    });

    it('should return win32-x64 for Windows x64', () => {
      mockPlatform('win32', 'x64');
      expect(getCurrentPlatform()).toBe('win32-x64');
    });

    it('should default to linux-x64 for unsupported platform combinations', () => {
      mockPlatform('freebsd', 'x64');
      expect(getCurrentPlatform()).toBe('linux-x64');
    });

    it('should default to linux-x64 for unsupported architecture', () => {
      mockPlatform('linux', 'ia32');
      expect(getCurrentPlatform()).toBe('linux-x64');
    });

    it('should default to linux-x64 for darwin with unsupported arch', () => {
      mockPlatform('darwin', 'ia32');
      expect(getCurrentPlatform()).toBe('linux-x64');
    });

    it('should default to linux-x64 for win32 with unsupported arch', () => {
      mockPlatform('win32', 'arm64');
      expect(getCurrentPlatform()).toBe('linux-x64');
    });
  });
});

describe('resolveBinary', () => {
  afterEach(() => {
    restorePlatform();
  });

  describe('successful resolution', () => {
    /**
     * Resolve platform-specific binary path
     */
    it('should resolve binary path for current platform', () => {
      mockPlatform('darwin', 'x64');

      const distribution: BinaryDistribution = {
        type: 'binary',
        platforms: {
          'darwin-x64': '/path/to/darwin-x64/binary',
          'linux-x64': '/path/to/linux-x64/binary',
        },
      };

      const result = resolveBinary(distribution, 'test-agent');

      expect(result.command).toBe('/path/to/darwin-x64/binary');
      expect(result.args).toEqual([]);
    });

    it('should resolve binary path for linux-x64', () => {
      mockPlatform('linux', 'x64');

      const distribution: BinaryDistribution = {
        type: 'binary',
        platforms: {
          'darwin-x64': '/path/to/darwin-x64/binary',
          'linux-x64': '/path/to/linux-x64/binary',
        },
      };

      const result = resolveBinary(distribution, 'test-agent');

      expect(result.command).toBe('/path/to/linux-x64/binary');
    });

    it('should resolve binary path for darwin-arm64', () => {
      mockPlatform('darwin', 'arm64');

      const distribution: BinaryDistribution = {
        type: 'binary',
        platforms: {
          'darwin-arm64': '/path/to/darwin-arm64/binary',
        },
      };

      const result = resolveBinary(distribution, 'test-agent');

      expect(result.command).toBe('/path/to/darwin-arm64/binary');
    });

    it('should resolve binary path for win32-x64', () => {
      mockPlatform('win32', 'x64');

      const distribution: BinaryDistribution = {
        type: 'binary',
        platforms: {
          'win32-x64': 'C:\\path\\to\\binary.exe',
        },
      };

      const result = resolveBinary(distribution, 'test-agent');

      expect(result.command).toBe('C:\\path\\to\\binary.exe');
    });

    it('should include agent args in spawn command', () => {
      mockPlatform('linux', 'x64');

      const distribution: BinaryDistribution = {
        type: 'binary',
        platforms: { 'linux-x64': '/path/to/binary' },
      };

      const result = resolveBinary(distribution, 'test-agent', ['--verbose', '--config', 'config.json']);

      expect(result.args).toEqual(['--verbose', '--config', 'config.json']);
    });

    it('should include agent env in spawn command', () => {
      mockPlatform('linux', 'x64');

      const distribution: BinaryDistribution = {
        type: 'binary',
        platforms: { 'linux-x64': '/path/to/binary' },
      };

      const result = resolveBinary(distribution, 'test-agent', undefined, { NODE_ENV: 'production' });

      expect(result.env).toEqual({ NODE_ENV: 'production' });
    });

    it('should handle empty args array', () => {
      mockPlatform('linux', 'x64');

      const distribution: BinaryDistribution = {
        type: 'binary',
        platforms: { 'linux-x64': '/path/to/binary' },
      };

      const result = resolveBinary(distribution, 'test-agent', []);

      expect(result.args).toEqual([]);
    });

    it('should handle empty env object', () => {
      mockPlatform('linux', 'x64');

      const distribution: BinaryDistribution = {
        type: 'binary',
        platforms: { 'linux-x64': '/path/to/binary' },
      };

      const result = resolveBinary(distribution, 'test-agent', undefined, {});

      expect(result.env).toEqual({});
    });
  });

  describe('platform not supported', () => {
    /**
     * Return error for unsupported platform
     */
    it('should throw PlatformNotSupportedError when platform not in distribution', () => {
      mockPlatform('darwin', 'x64');

      const distribution: BinaryDistribution = {
        type: 'binary',
        platforms: {
          'linux-x64': '/path/to/linux-x64/binary',
        },
      };

      expect(() => resolveBinary(distribution, 'test-agent')).toThrow(PlatformNotSupportedError);
    });

    it('should include agentId in PlatformNotSupportedError', () => {
      mockPlatform('darwin', 'x64');

      const distribution: BinaryDistribution = {
        type: 'binary',
        platforms: { 'linux-x64': '/path/to/binary' },
      };

      try {
        resolveBinary(distribution, 'my-agent');
        fail('Expected PlatformNotSupportedError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(PlatformNotSupportedError);
        expect((error as PlatformNotSupportedError).agentId).toBe('my-agent');
      }
    });

    it('should include platform in PlatformNotSupportedError', () => {
      mockPlatform('darwin', 'arm64');

      const distribution: BinaryDistribution = {
        type: 'binary',
        platforms: { 'linux-x64': '/path/to/binary' },
      };

      try {
        resolveBinary(distribution, 'my-agent');
        fail('Expected PlatformNotSupportedError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(PlatformNotSupportedError);
        expect((error as PlatformNotSupportedError).platform).toBe('darwin-arm64');
      }
    });

    it('should throw when platforms object is empty', () => {
      mockPlatform('linux', 'x64');

      const distribution: BinaryDistribution = {
        type: 'binary',
        platforms: {},
      };

      expect(() => resolveBinary(distribution, 'test-agent')).toThrow(PlatformNotSupportedError);
    });

    it('should throw for win32-x64 when only unix platforms available', () => {
      mockPlatform('win32', 'x64');

      const distribution: BinaryDistribution = {
        type: 'binary',
        platforms: {
          'darwin-x64': '/path/darwin',
          'darwin-arm64': '/path/darwin-arm',
          'linux-x64': '/path/linux',
          'linux-arm64': '/path/linux-arm',
        },
      };

      expect(() => resolveBinary(distribution, 'test-agent')).toThrow(PlatformNotSupportedError);
    });
  });
});

describe('resolveNpx', () => {
  /**
   * Construct spawn command using npx
   */
  describe('command construction', () => {
    it('should construct npx command with package name', () => {
      const distribution: NpxDistribution = {
        type: 'npx',
        package: 'my-package',
      };

      const result = resolveNpx(distribution);

      expect(result.command).toBe('npx');
      expect(result.args).toEqual(['my-package']);
    });

    it('should construct npx command with package name and version', () => {
      const distribution: NpxDistribution = {
        type: 'npx',
        package: 'my-package',
        version: '1.2.3',
      };

      const result = resolveNpx(distribution);

      expect(result.command).toBe('npx');
      expect(result.args).toEqual(['my-package@1.2.3']);
    });

    it('should handle scoped package names', () => {
      const distribution: NpxDistribution = {
        type: 'npx',
        package: '@scope/my-package',
      };

      const result = resolveNpx(distribution);

      expect(result.args).toEqual(['@scope/my-package']);
    });

    it('should handle scoped package names with version', () => {
      const distribution: NpxDistribution = {
        type: 'npx',
        package: '@scope/my-package',
        version: '2.0.0',
      };

      const result = resolveNpx(distribution);

      expect(result.args).toEqual(['@scope/my-package@2.0.0']);
    });

    it('should handle semver range versions', () => {
      const distribution: NpxDistribution = {
        type: 'npx',
        package: 'my-package',
        version: '^1.0.0',
      };

      const result = resolveNpx(distribution);

      expect(result.args).toEqual(['my-package@^1.0.0']);
    });

    it('should handle latest tag as version', () => {
      const distribution: NpxDistribution = {
        type: 'npx',
        package: 'my-package',
        version: 'latest',
      };

      const result = resolveNpx(distribution);

      expect(result.args).toEqual(['my-package@latest']);
    });
  });

  describe('args passthrough', () => {
    it('should append agent args after package spec', () => {
      const distribution: NpxDistribution = {
        type: 'npx',
        package: 'my-package',
      };

      const result = resolveNpx(distribution, ['--verbose', '--config', 'config.json']);

      expect(result.args).toEqual(['my-package', '--verbose', '--config', 'config.json']);
    });

    it('should append agent args after package spec with version', () => {
      const distribution: NpxDistribution = {
        type: 'npx',
        package: 'my-package',
        version: '1.0.0',
      };

      const result = resolveNpx(distribution, ['--flag']);

      expect(result.args).toEqual(['my-package@1.0.0', '--flag']);
    });

    it('should handle empty args array', () => {
      const distribution: NpxDistribution = {
        type: 'npx',
        package: 'my-package',
      };

      const result = resolveNpx(distribution, []);

      expect(result.args).toEqual(['my-package']);
    });

    it('should handle undefined args', () => {
      const distribution: NpxDistribution = {
        type: 'npx',
        package: 'my-package',
      };

      const result = resolveNpx(distribution, undefined);

      expect(result.args).toEqual(['my-package']);
    });
  });

  describe('env passthrough', () => {
    it('should include env in spawn command', () => {
      const distribution: NpxDistribution = {
        type: 'npx',
        package: 'my-package',
      };

      const result = resolveNpx(distribution, undefined, { NODE_ENV: 'production', DEBUG: '*' });

      expect(result.env).toEqual({ NODE_ENV: 'production', DEBUG: '*' });
    });

    it('should handle empty env object', () => {
      const distribution: NpxDistribution = {
        type: 'npx',
        package: 'my-package',
      };

      const result = resolveNpx(distribution, undefined, {});

      expect(result.env).toEqual({});
    });

    it('should handle undefined env', () => {
      const distribution: NpxDistribution = {
        type: 'npx',
        package: 'my-package',
      };

      const result = resolveNpx(distribution, undefined, undefined);

      expect(result.env).toBeUndefined();
    });
  });
});

describe('resolveUvx', () => {
  /**
   * Construct spawn command using uvx
   */
  describe('command construction', () => {
    it('should construct uvx command with package name', () => {
      const distribution: UvxDistribution = {
        type: 'uvx',
        package: 'my-python-package',
      };

      const result = resolveUvx(distribution);

      expect(result.command).toBe('uvx');
      expect(result.args).toEqual(['my-python-package']);
    });

    it('should construct uvx command with package name and version', () => {
      const distribution: UvxDistribution = {
        type: 'uvx',
        package: 'my-python-package',
        version: '1.2.3',
      };

      const result = resolveUvx(distribution);

      expect(result.command).toBe('uvx');
      expect(result.args).toEqual(['my-python-package@1.2.3']);
    });

    it('should handle package names with hyphens', () => {
      const distribution: UvxDistribution = {
        type: 'uvx',
        package: 'my-python-package-name',
      };

      const result = resolveUvx(distribution);

      expect(result.args).toEqual(['my-python-package-name']);
    });

    it('should handle package names with underscores', () => {
      const distribution: UvxDistribution = {
        type: 'uvx',
        package: 'my_python_package',
      };

      const result = resolveUvx(distribution);

      expect(result.args).toEqual(['my_python_package']);
    });
  });

  describe('args passthrough', () => {
    it('should append agent args after package spec', () => {
      const distribution: UvxDistribution = {
        type: 'uvx',
        package: 'my-package',
      };

      const result = resolveUvx(distribution, ['--verbose', '--config', 'config.yaml']);

      expect(result.args).toEqual(['my-package', '--verbose', '--config', 'config.yaml']);
    });

    it('should append agent args after package spec with version', () => {
      const distribution: UvxDistribution = {
        type: 'uvx',
        package: 'my-package',
        version: '2.0.0',
      };

      const result = resolveUvx(distribution, ['--flag']);

      expect(result.args).toEqual(['my-package@2.0.0', '--flag']);
    });

    it('should handle empty args array', () => {
      const distribution: UvxDistribution = {
        type: 'uvx',
        package: 'my-package',
      };

      const result = resolveUvx(distribution, []);

      expect(result.args).toEqual(['my-package']);
    });

    it('should handle undefined args', () => {
      const distribution: UvxDistribution = {
        type: 'uvx',
        package: 'my-package',
      };

      const result = resolveUvx(distribution, undefined);

      expect(result.args).toEqual(['my-package']);
    });
  });

  describe('env passthrough', () => {
    it('should include env in spawn command', () => {
      const distribution: UvxDistribution = {
        type: 'uvx',
        package: 'my-package',
      };

      const result = resolveUvx(distribution, undefined, { PYTHONPATH: '/custom/path', DEBUG: '1' });

      expect(result.env).toEqual({ PYTHONPATH: '/custom/path', DEBUG: '1' });
    });

    it('should handle empty env object', () => {
      const distribution: UvxDistribution = {
        type: 'uvx',
        package: 'my-package',
      };

      const result = resolveUvx(distribution, undefined, {});

      expect(result.env).toEqual({});
    });

    it('should handle undefined env', () => {
      const distribution: UvxDistribution = {
        type: 'uvx',
        package: 'my-package',
      };

      const result = resolveUvx(distribution, undefined, undefined);

      expect(result.env).toBeUndefined();
    });
  });
});

describe('resolve (dispatcher)', () => {
  afterEach(() => {
    restorePlatform();
  });

  describe('distribution type dispatch', () => {
    it('should dispatch binary distribution to resolveBinary', () => {
      mockPlatform('linux', 'x64');

      const distribution: BinaryDistribution = {
        type: 'binary',
        platforms: { 'linux-x64': '/path/to/binary' },
      };

      const result = resolve(distribution, 'test-agent');

      expect(result.command).toBe('/path/to/binary');
    });

    it('should dispatch npx distribution to resolveNpx', () => {
      const distribution: NpxDistribution = {
        type: 'npx',
        package: 'my-package',
        version: '1.0.0',
      };

      const result = resolve(distribution, 'test-agent');

      expect(result.command).toBe('npx');
      expect(result.args).toContain('my-package@1.0.0');
    });

    it('should dispatch uvx distribution to resolveUvx', () => {
      const distribution: UvxDistribution = {
        type: 'uvx',
        package: 'my-python-package',
      };

      const result = resolve(distribution, 'test-agent');

      expect(result.command).toBe('uvx');
      expect(result.args).toContain('my-python-package');
    });
  });

  describe('args and env passthrough', () => {
    it('should pass args to binary resolver', () => {
      mockPlatform('linux', 'x64');

      const distribution: BinaryDistribution = {
        type: 'binary',
        platforms: { 'linux-x64': '/path/to/binary' },
      };

      const result = resolve(distribution, 'test-agent', ['--flag'], { KEY: 'value' });

      expect(result.args).toEqual(['--flag']);
      expect(result.env).toEqual({ KEY: 'value' });
    });

    it('should pass args to npx resolver', () => {
      const distribution: NpxDistribution = {
        type: 'npx',
        package: 'my-package',
      };

      const result = resolve(distribution, 'test-agent', ['--verbose'], { NODE_ENV: 'test' });

      expect(result.args).toContain('--verbose');
      expect(result.env).toEqual({ NODE_ENV: 'test' });
    });

    it('should pass args to uvx resolver', () => {
      const distribution: UvxDistribution = {
        type: 'uvx',
        package: 'my-package',
      };

      const result = resolve(distribution, 'test-agent', ['--debug'], { PYTHONPATH: '/path' });

      expect(result.args).toContain('--debug');
      expect(result.env).toEqual({ PYTHONPATH: '/path' });
    });
  });

  describe('error propagation', () => {
    it('should propagate PlatformNotSupportedError from binary resolver', () => {
      mockPlatform('darwin', 'x64');

      const distribution: BinaryDistribution = {
        type: 'binary',
        platforms: { 'linux-x64': '/path/to/binary' },
      };

      expect(() => resolve(distribution, 'test-agent')).toThrow(PlatformNotSupportedError);
    });

    it('should throw error for unknown distribution type', () => {
      const distribution = {
        type: 'unknown',
        package: 'test',
      } as unknown as NpxDistribution;

      expect(() => resolve(distribution, 'test-agent')).toThrow('Unknown distribution type');
    });
  });
});
