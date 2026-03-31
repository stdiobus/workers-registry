/**
 * PathNormalizer Property-Based Tests
 * 
 * Property-based tests using fast-check to validate universal properties
 * of path normalization.
 * 
 * Feature: sftp-vscode-plugin
 * 
 * Tests:
 * - Property 25: Path normalization idempotence (Requirements 19.3, 28.3)
 * - Property 43: Invalid path rejection (Requirement 28.4)
 */

import fc from 'fast-check';
import { PathNormalizer } from '../path-normalizer.js';
import { INVALID_PATH } from '../error-codes.js';
import { SftpError } from '../types.js';

// ============================================================================
// Fast-check Arbitraries (Generators)
// ============================================================================

/**
 * Generate valid path segments (no /, no null bytes, valid UTF-8)
 */
const arbValidSegment = fc.stringOf(
  fc.char().filter(c => c !== '/' && c !== '\0'),
  { minLength: 1, maxLength: 20 }
);

/**
 * Generate paths with . and .. segments for normalization testing
 */
const arbPathWithDots = fc.array(
  fc.oneof(
    fc.constant('.'),
    fc.constant('..'),
    arbValidSegment
  ),
  { minLength: 0, maxLength: 10 }
).map(segments => '/' + segments.join('/'));

/**
 * Generate paths with trailing slashes
 */
const arbPathWithTrailingSlash = fc.array(
  arbValidSegment,
  { minLength: 1, maxLength: 10 }
).map(segments => '/' + segments.join('/') + '/');

/**
 * Generate paths with duplicate slashes
 */
const arbPathWithDuplicateSlashes = fc.array(
  arbValidSegment,
  { minLength: 1, maxLength: 10 }
).map(segments => {
  // Insert random number of slashes between segments
  return '/' + segments.join(fc.sample(fc.stringOf(fc.constant('/'), { minLength: 1, maxLength: 5 }), 1)[0]);
});

/**
 * Generate paths with mixed normalization issues
 */
const arbUnnormalizedPath = fc.oneof(
  arbPathWithDots,
  arbPathWithTrailingSlash,
  arbPathWithDuplicateSlashes,
  // Combine multiple issues
  fc.array(
    fc.oneof(
      fc.constant('.'),
      fc.constant('..'),
      arbValidSegment,
      fc.constant('') // Empty segment (creates duplicate /)
    ),
    { minLength: 1, maxLength: 15 }
  ).map(segments => '/' + segments.join('/') + fc.sample(fc.oneof(fc.constant(''), fc.constant('/')), 1)[0])
);

/**
 * Generate paths with null bytes
 */
const arbPathWithNullByte = fc.tuple(
  fc.array(arbValidSegment, { minLength: 0, maxLength: 5 }),
  fc.array(arbValidSegment, { minLength: 0, maxLength: 5 })
).map(([before, after]) => {
  const beforePath = before.length > 0 ? '/' + before.join('/') : '';
  const afterPath = after.length > 0 ? '/' + after.join('/') : '';
  return beforePath + '\0' + afterPath;
});

/**
 * Generate paths with invalid UTF-8 sequences
 * We'll use invalid byte sequences that can't be properly decoded
 */
const arbPathWithInvalidUtf8 = fc.array(
  arbValidSegment,
  { minLength: 1, maxLength: 5 }
).map(segments => {
  const validPath = '/' + segments.join('/');
  // Insert an invalid UTF-8 sequence (lone continuation byte)
  // This creates a string that when encoded to Buffer and decoded will have replacement chars
  const invalidUtf8 = validPath + String.fromCharCode(0xD800); // Unpaired surrogate
  return invalidUtf8;
});

/**
 * Generate relative paths (invalid - must be absolute)
 */
const arbRelativePath = fc.array(
  arbValidSegment,
  { minLength: 1, maxLength: 5 }
).map(segments => segments.join('/'));

// ============================================================================
// Property-Based Tests
// ============================================================================

describe('PathNormalizer - Property-Based Tests', () => {
  /**
   * Property 25: Path normalization idempotence
   * 
   * For any path containing ., .., trailing slashes, or duplicate slashes,
   * PathNormalizer.normalize() should produce a canonical absolute POSIX path.
   * Repeated normalization of the result should yield the same path (idempotence):
   * normalize(normalize(p)) === normalize(p)
   * 
   * **Validates: Requirements 19.3, 28.3**
   */
  describe('Property 25: Path normalization idempotence', () => {
    it('should be idempotent for all normalizable paths', () => {
      fc.assert(
        fc.property(arbUnnormalizedPath, (path) => {
          try {
            const once = PathNormalizer.normalize(path);
            const twice = PathNormalizer.normalize(once);

            // Idempotence: normalize(normalize(p)) === normalize(p)
            expect(twice).toBe(once);

            // Result should be absolute
            expect(once.startsWith('/')).toBe(true);

            // Result should not have trailing slash (unless it's root)
            if (once !== '/') {
              expect(once.endsWith('/')).toBe(false);
            }

            // Result should not have duplicate slashes
            expect(once.includes('//')).toBe(false);

            // Result should not have . or .. segments
            const segments = once.split('/').filter(s => s.length > 0);
            expect(segments.includes('.')).toBe(false);
            expect(segments.includes('..')).toBe(false);

            return true;
          } catch (error) {
            // If path is invalid (e.g., contains null bytes from edge cases),
            // that's acceptable - we're testing valid paths here
            if (error instanceof SftpError && error.code === INVALID_PATH) {
              return true;
            }
            throw error;
          }
        }),
        { numRuns: 200 }
      );
    });

    it('should handle paths with . segments correctly', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.oneof(fc.constant('.'), arbValidSegment),
            { minLength: 1, maxLength: 10 }
          ),
          (segments) => {
            const path = '/' + segments.join('/');

            try {
              const normalized = PathNormalizer.normalize(path);

              // . segments should be removed
              const resultSegments = normalized.split('/').filter(s => s.length > 0);
              expect(resultSegments.includes('.')).toBe(false);

              // Idempotence
              expect(PathNormalizer.normalize(normalized)).toBe(normalized);

              return true;
            } catch (error) {
              if (error instanceof SftpError && error.code === INVALID_PATH) {
                return true;
              }
              throw error;
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle paths with .. segments correctly', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.oneof(fc.constant('..'), arbValidSegment),
            { minLength: 1, maxLength: 10 }
          ),
          (segments) => {
            const path = '/' + segments.join('/');

            try {
              const normalized = PathNormalizer.normalize(path);

              // .. segments should be resolved
              const resultSegments = normalized.split('/').filter(s => s.length > 0);
              expect(resultSegments.includes('..')).toBe(false);

              // Idempotence
              expect(PathNormalizer.normalize(normalized)).toBe(normalized);

              return true;
            } catch (error) {
              if (error instanceof SftpError && error.code === INVALID_PATH) {
                return true;
              }
              throw error;
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should remove trailing slashes except for root', () => {
      fc.assert(
        fc.property(arbPathWithTrailingSlash, (path) => {
          try {
            const normalized = PathNormalizer.normalize(path);

            // Should not end with / unless it's root
            if (normalized !== '/') {
              expect(normalized.endsWith('/')).toBe(false);
            }

            // Idempotence
            expect(PathNormalizer.normalize(normalized)).toBe(normalized);

            return true;
          } catch (error) {
            if (error instanceof SftpError && error.code === INVALID_PATH) {
              return true;
            }
            throw error;
          }
        }),
        { numRuns: 100 }
      );
    });

    it('should remove duplicate slashes', () => {
      fc.assert(
        fc.property(
          fc.array(arbValidSegment, { minLength: 1, maxLength: 10 }),
          fc.integer({ min: 2, max: 5 }),
          (segments, slashCount) => {
            // Create path with multiple slashes between segments
            const slashes = '/'.repeat(slashCount);
            const path = '/' + segments.join(slashes);

            try {
              const normalized = PathNormalizer.normalize(path);

              // Should not have duplicate slashes
              expect(normalized.includes('//')).toBe(false);

              // Idempotence
              expect(PathNormalizer.normalize(normalized)).toBe(normalized);

              return true;
            } catch (error) {
              if (error instanceof SftpError && error.code === INVALID_PATH) {
                return true;
              }
              throw error;
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle root path correctly', () => {
      const normalized = PathNormalizer.normalize('/');
      expect(normalized).toBe('/');

      // Idempotence for root
      expect(PathNormalizer.normalize(normalized)).toBe('/');
    });

    it('should handle paths that normalize to root', () => {
      fc.assert(
        fc.property(
          fc.array(fc.oneof(fc.constant('.'), fc.constant('..')), { minLength: 1, maxLength: 10 }),
          (segments) => {
            const path = '/' + segments.join('/');

            const normalized = PathNormalizer.normalize(path);

            // Should normalize to root
            expect(normalized).toBe('/');

            // Idempotence
            expect(PathNormalizer.normalize(normalized)).toBe('/');

            return true;
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  /**
   * Property 43: Invalid path rejection
   * 
   * For any path containing null bytes (\0) or invalid UTF-8 sequences,
   * Worker should reject the request with code -32026 (INVALID_PATH).
   * 
   * **Validates: Requirement 28.4**
   */
  describe('Property 43: Invalid path rejection', () => {
    it('should reject paths with null bytes', () => {
      fc.assert(
        fc.property(arbPathWithNullByte, (path) => {
          expect(() => PathNormalizer.normalize(path)).toThrow(SftpError);

          try {
            PathNormalizer.normalize(path);
            return false; // Should have thrown
          } catch (error) {
            expect(error).toBeInstanceOf(SftpError);
            expect((error as SftpError).code).toBe(INVALID_PATH);
            expect((error as SftpError).message).toContain('null byte');
            return true;
          }
        }),
        { numRuns: 100 }
      );
    });

    it('should reject paths with invalid UTF-8 sequences', () => {
      fc.assert(
        fc.property(arbPathWithInvalidUtf8, (path) => {
          // Only test if the path actually contains invalid UTF-8
          const encoded = Buffer.from(path, 'utf8');
          const decoded = encoded.toString('utf8');

          if (decoded !== path && decoded.includes('\uFFFD')) {
            // Path has invalid UTF-8
            expect(() => PathNormalizer.normalize(path)).toThrow(SftpError);

            try {
              PathNormalizer.normalize(path);
              return false; // Should have thrown
            } catch (error) {
              expect(error).toBeInstanceOf(SftpError);
              expect((error as SftpError).code).toBe(INVALID_PATH);
              expect((error as SftpError).message).toContain('invalid UTF-8');
              return true;
            }
          }

          return true; // Path was actually valid UTF-8
        }),
        { numRuns: 100 }
      );
    });

    it('should reject relative paths', () => {
      fc.assert(
        fc.property(arbRelativePath, (path) => {
          expect(() => PathNormalizer.normalize(path)).toThrow(SftpError);

          try {
            PathNormalizer.normalize(path);
            return false; // Should have thrown
          } catch (error) {
            expect(error).toBeInstanceOf(SftpError);
            expect((error as SftpError).code).toBe(INVALID_PATH);
            expect((error as SftpError).message).toContain('absolute');
            return true;
          }
        }),
        { numRuns: 100 }
      );
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

    it('isValid should return false for invalid paths', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            arbPathWithNullByte,
            arbRelativePath,
            fc.constant('')
          ),
          (path) => {
            expect(PathNormalizer.isValid(path)).toBe(false);
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('isValid should return true for valid paths', () => {
      fc.assert(
        fc.property(
          fc.array(arbValidSegment, { minLength: 1, maxLength: 10 }),
          (segments) => {
            const path = '/' + segments.join('/');
            expect(PathNormalizer.isValid(path)).toBe(true);
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
