/**
 * PathNormalizer Unit Tests
 * 
 * Concrete examples and edge cases for path normalization.
 * Complements property-based tests with specific scenarios.
 * 
 * Feature: sftp-vscode-plugin
 */

import { PathNormalizer } from '../path-normalizer.js';
import { INVALID_PATH } from '../error-codes.js';
import { SftpError } from '../types.js';

describe('PathNormalizer - Unit Tests', () => {
  describe('normalize() - happy path', () => {
    it('should handle root path', () => {
      expect(PathNormalizer.normalize('/')).toBe('/');
    });

    it('should handle simple absolute paths', () => {
      expect(PathNormalizer.normalize('/home')).toBe('/home');
      expect(PathNormalizer.normalize('/home/user')).toBe('/home/user');
      expect(PathNormalizer.normalize('/var/log/app.log')).toBe('/var/log/app.log');
    });

    it('should remove trailing slashes', () => {
      expect(PathNormalizer.normalize('/home/')).toBe('/home');
      expect(PathNormalizer.normalize('/home/user/')).toBe('/home/user');
      expect(PathNormalizer.normalize('/home/user///')).toBe('/home/user');
    });

    it('should remove duplicate slashes', () => {
      expect(PathNormalizer.normalize('//home')).toBe('/home');
      expect(PathNormalizer.normalize('/home//user')).toBe('/home/user');
      expect(PathNormalizer.normalize('///home///user///')).toBe('/home/user');
    });

    it('should resolve . segments', () => {
      expect(PathNormalizer.normalize('/.')).toBe('/');
      expect(PathNormalizer.normalize('/./home')).toBe('/home');
      expect(PathNormalizer.normalize('/home/./user')).toBe('/home/user');
      expect(PathNormalizer.normalize('/home/user/.')).toBe('/home/user');
      expect(PathNormalizer.normalize('/./home/./user/.')).toBe('/home/user');
    });

    it('should resolve .. segments', () => {
      expect(PathNormalizer.normalize('/..')).toBe('/');
      expect(PathNormalizer.normalize('/home/..')).toBe('/');
      expect(PathNormalizer.normalize('/home/user/..')).toBe('/home');
      expect(PathNormalizer.normalize('/home/user/../..')).toBe('/');
      expect(PathNormalizer.normalize('/home/user/../../..')).toBe('/');
    });

    it('should handle complex paths with mixed . and ..', () => {
      expect(PathNormalizer.normalize('/home/./user/../admin')).toBe('/home/admin');
      expect(PathNormalizer.normalize('/a/b/c/../../d')).toBe('/a/d');
      expect(PathNormalizer.normalize('/a/./b/../c/./d')).toBe('/a/c/d');
    });

    it('should handle paths with all issues combined', () => {
      expect(PathNormalizer.normalize('//home/./user/..//admin//')).toBe('/home/admin');
      expect(PathNormalizer.normalize('///a//.//b//..//c//./d//')).toBe('/a/c/d');
    });

    it('should handle Unicode paths', () => {
      expect(PathNormalizer.normalize('/home/пользователь')).toBe('/home/пользователь');
      expect(PathNormalizer.normalize('/home/用户')).toBe('/home/用户');
      expect(PathNormalizer.normalize('/home/ユーザー')).toBe('/home/ユーザー');
      expect(PathNormalizer.normalize('/home/🏠/📁')).toBe('/home/🏠/📁');
    });
  });

  describe('normalize() - error cases', () => {
    it('should reject relative paths', () => {
      expect(() => PathNormalizer.normalize('home')).toThrow(SftpError);
      expect(() => PathNormalizer.normalize('home/user')).toThrow(SftpError);
      expect(() => PathNormalizer.normalize('./home')).toThrow(SftpError);
      expect(() => PathNormalizer.normalize('../home')).toThrow(SftpError);

      try {
        PathNormalizer.normalize('home/user');
      } catch (error) {
        expect(error).toBeInstanceOf(SftpError);
        expect((error as SftpError).code).toBe(INVALID_PATH);
        expect((error as SftpError).message).toContain('absolute');
      }
    });

    it('should reject empty path', () => {
      expect(() => PathNormalizer.normalize('')).toThrow(SftpError);

      try {
        PathNormalizer.normalize('');
      } catch (error) {
        expect(error).toBeInstanceOf(SftpError);
        expect((error as SftpError).code).toBe(INVALID_PATH);
      }
    });

    it('should reject paths with null bytes', () => {
      expect(() => PathNormalizer.normalize('/home\0user')).toThrow(SftpError);
      expect(() => PathNormalizer.normalize('/home/\0')).toThrow(SftpError);
      expect(() => PathNormalizer.normalize('\0/home')).toThrow(SftpError);

      try {
        PathNormalizer.normalize('/home\0user');
      } catch (error) {
        expect(error).toBeInstanceOf(SftpError);
        expect((error as SftpError).code).toBe(INVALID_PATH);
        expect((error as SftpError).message).toContain('null byte');
      }
    });

    it('should reject paths with invalid UTF-8', () => {
      // Create a string with unpaired surrogate (invalid UTF-8)
      const invalidUtf8Path = '/home/' + String.fromCharCode(0xD800);

      expect(() => PathNormalizer.normalize(invalidUtf8Path)).toThrow(SftpError);

      try {
        PathNormalizer.normalize(invalidUtf8Path);
      } catch (error) {
        expect(error).toBeInstanceOf(SftpError);
        expect((error as SftpError).code).toBe(INVALID_PATH);
        expect((error as SftpError).message).toContain('invalid UTF-8');
      }
    });
  });

  describe('normalize() - idempotence', () => {
    it('should be idempotent for already normalized paths', () => {
      const paths = [
        '/',
        '/home',
        '/home/user',
        '/var/log/app.log',
        '/a/b/c/d/e',
      ];

      for (const path of paths) {
        const once = PathNormalizer.normalize(path);
        const twice = PathNormalizer.normalize(once);
        expect(twice).toBe(once);
      }
    });

    it('should be idempotent for unnormalized paths', () => {
      const testCases = [
        { input: '/home/', expected: '/home' },
        { input: '//home', expected: '/home' },
        { input: '/home/./user', expected: '/home/user' },
        { input: '/home/user/..', expected: '/home' },
        { input: '//home/./user/..//admin//', expected: '/home/admin' },
      ];

      for (const { input, expected } of testCases) {
        const once = PathNormalizer.normalize(input);
        expect(once).toBe(expected);

        const twice = PathNormalizer.normalize(once);
        expect(twice).toBe(once);
      }
    });
  });

  describe('isValid()', () => {
    it('should return true for valid paths', () => {
      expect(PathNormalizer.isValid('/')).toBe(true);
      expect(PathNormalizer.isValid('/home')).toBe(true);
      expect(PathNormalizer.isValid('/home/user')).toBe(true);
      expect(PathNormalizer.isValid('/home/./user')).toBe(true);
      expect(PathNormalizer.isValid('/home/user/..')).toBe(true);
      expect(PathNormalizer.isValid('//home//')).toBe(true);
    });

    it('should return false for invalid paths', () => {
      expect(PathNormalizer.isValid('')).toBe(false);
      expect(PathNormalizer.isValid('home')).toBe(false);
      expect(PathNormalizer.isValid('./home')).toBe(false);
      expect(PathNormalizer.isValid('/home\0user')).toBe(false);
      expect(PathNormalizer.isValid('/home/' + String.fromCharCode(0xD800))).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle very long paths', () => {
      const longPath = '/' + 'a/'.repeat(100) + 'file.txt';
      const normalized = PathNormalizer.normalize(longPath);
      expect(normalized).toBe(longPath.replace(/\/$/, ''));
    });

    it('should handle paths with only dots', () => {
      expect(PathNormalizer.normalize('/.')).toBe('/');
      expect(PathNormalizer.normalize('/..')).toBe('/');
      expect(PathNormalizer.normalize('/./.')).toBe('/');
      expect(PathNormalizer.normalize('/../..')).toBe('/');
    });

    it('should handle paths with special characters', () => {
      expect(PathNormalizer.normalize('/home/user-name')).toBe('/home/user-name');
      expect(PathNormalizer.normalize('/home/user_name')).toBe('/home/user_name');
      expect(PathNormalizer.normalize('/home/user.name')).toBe('/home/user.name');
      expect(PathNormalizer.normalize('/home/user@host')).toBe('/home/user@host');
      expect(PathNormalizer.normalize('/home/user name')).toBe('/home/user name');
    });

    it('should handle paths with dots in filenames', () => {
      expect(PathNormalizer.normalize('/home/file.txt')).toBe('/home/file.txt');
      expect(PathNormalizer.normalize('/home/.hidden')).toBe('/home/.hidden');
      expect(PathNormalizer.normalize('/home/..hidden')).toBe('/home/..hidden');
      expect(PathNormalizer.normalize('/home/file..txt')).toBe('/home/file..txt');
    });

    it('should distinguish between . segment and . in filename', () => {
      // . as segment (should be removed)
      expect(PathNormalizer.normalize('/home/./file.txt')).toBe('/home/file.txt');

      // . in filename (should be kept)
      expect(PathNormalizer.normalize('/home/file.txt')).toBe('/home/file.txt');

      // .hidden file (should be kept)
      expect(PathNormalizer.normalize('/home/.hidden')).toBe('/home/.hidden');
    });

    it('should distinguish between .. segment and .. in filename', () => {
      // .. as segment (should resolve to parent)
      expect(PathNormalizer.normalize('/home/user/..')).toBe('/home');

      // .. in filename (should be kept)
      expect(PathNormalizer.normalize('/home/..hidden')).toBe('/home/..hidden');
      expect(PathNormalizer.normalize('/home/file..txt')).toBe('/home/file..txt');
    });
  });
});
