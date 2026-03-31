/**
 * PathNormalizer - SFTP path validation and normalization
 * 
 * Validates and normalizes SFTP paths according to POSIX conventions:
 * - Checks for null bytes and invalid UTF-8
 * - Resolves . and .. segments
 * - Removes trailing slashes (except root "/")
 * - Removes duplicate slashes
 * - Ensures result is an absolute POSIX path
 */

import { SftpError } from './types.js';
import { INVALID_PATH } from './error-codes.js';

export class PathNormalizer {
  /**
   * Normalize an SFTP path to canonical absolute POSIX form
   * 
   * @param path - Input path (must be absolute or will be rejected)
   * @returns Normalized absolute path
   * @throws SftpError with code INVALID_PATH (-32026) if path is invalid
   * 
   * Requirements: 19.3, 28.3, 28.4
   */
  static normalize(path: string): string {
    // Check for null bytes (Requirement 28.4)
    if (path.includes('\0')) {
      throw new SftpError(
        INVALID_PATH,
        'Path contains null byte',
        path
      );
    }

    // Check for invalid UTF-8 by attempting to encode/decode
    // Invalid UTF-8 will be replaced with replacement character
    const encoded = Buffer.from(path, 'utf8');
    const decoded = encoded.toString('utf8');

    // If the string contains replacement characters that weren't in the original,
    // it means there was invalid UTF-8
    if (decoded !== path && decoded.includes('\uFFFD')) {
      throw new SftpError(
        INVALID_PATH,
        'Path contains invalid UTF-8 sequences',
        path
      );
    }

    // Path must be absolute (start with /)
    if (!path.startsWith('/')) {
      throw new SftpError(
        INVALID_PATH,
        'Path must be absolute (start with /)',
        path
      );
    }

    // Split path into segments, filtering out empty segments from duplicate slashes
    const segments = path.split('/').filter(seg => seg.length > 0);

    // Resolve . and .. segments (Requirement 28.3)
    const resolved: string[] = [];

    for (const segment of segments) {
      if (segment === '.') {
        // Current directory - skip
        continue;
      } else if (segment === '..') {
        // Parent directory - pop if possible
        if (resolved.length > 0) {
          resolved.pop();
        }
        // If we're at root, .. has no effect (can't go above root)
      } else {
        // Normal segment
        resolved.push(segment);
      }
    }

    // Reconstruct path
    if (resolved.length === 0) {
      // Root path
      return '/';
    }

    // Join with / and prepend root /
    // This automatically handles:
    // - Removing duplicate slashes (we filtered empty segments)
    // - Removing trailing slashes (we join segments without trailing /)
    return '/' + resolved.join('/');
  }

  /**
   * Check if a path is valid without normalizing
   * 
   * @param path - Path to validate
   * @returns true if path is valid, false otherwise
   */
  static isValid(path: string): boolean {
    try {
      PathNormalizer.normalize(path);
      return true;
    } catch {
      return false;
    }
  }
}
