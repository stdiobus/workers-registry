/**
 * AtomicWriter — atomic file write strategy
 *
 * Supports two write strategies:
 * - tempRename: write to .<name>.sftp-tmp-<random>, then rename (atomic)
 * - direct: write directly to target path
 *
 * Best-effort cleanup of temp files on failure.
 * Logs cleanup results to stderr without leaking credentials.
 */

import { ISftpBackend } from './sftp-backend.js';
import { SFTP_OPERATION_FAILED } from './error-codes.js';
import { ErrorMapper } from './error-mapper.js';

export interface AtomicWriteResult {
  written: boolean;
  size: number;
  atomic: boolean;
}

export class AtomicWriter {
  /**
   * Write data to a file using the specified strategy.
   *
   * tempRename: writes to .<name>.sftp-tmp-<random> then renames.
   *   If rename fails → error -32020 with data.fallbackAvailable: true.
   *   Best-effort cleanup of temp file on any failure.
   *
   * direct: writes directly to the target path.
   */
  async write(
    backend: ISftpBackend,
    path: string,
    data: Buffer,
    strategy: 'tempRename' | 'direct'
  ): Promise<AtomicWriteResult> {
    if (strategy === 'direct') {
      await backend.writeFile(path, data);
      return { written: true, size: data.length, atomic: false };
    }

    // tempRename strategy
    const dirPart = path.substring(0, path.lastIndexOf('/')) || '/';
    const namePart = path.substring(path.lastIndexOf('/') + 1);
    const randomSuffix = Math.random().toString(36).substring(2, 10);
    const tmpName = `.${namePart}.sftp-tmp-${randomSuffix}`;
    const tmpPath = dirPart === '/' ? `/${tmpName}` : `${dirPart}/${tmpName}`;

    try {
      // Write to temp file
      await backend.writeFile(tmpPath, data);
    } catch (writeError) {
      // Best-effort cleanup of temp file after write failure
      await this.cleanupTempFile(backend, tmpPath);
      throw writeError;
    }

    try {
      // Atomic rename
      await backend.rename(tmpPath, path);
    } catch (renameError) {
      // Best-effort cleanup of temp file after rename failure
      await this.cleanupTempFile(backend, tmpPath);

      // Rename failed → -32020 with fallbackAvailable: true
      const mapped = ErrorMapper.map(renameError, { path, method: 'sftp/writeFile' });
      throw {
        code: SFTP_OPERATION_FAILED,
        message: `Atomic rename failed: ${mapped.message}`,
        data: {
          ...mapped.data,
          fallbackAvailable: true,
        },
      };
    }

    return { written: true, size: data.length, atomic: true };
  }

  /**
   * Best-effort cleanup of a temporary file.
   * Logs result to stderr without leaking credentials.
   */
  private async cleanupTempFile(backend: ISftpBackend, tmpPath: string): Promise<void> {
    try {
      await backend.delete(tmpPath);
      process.stderr.write(`[AtomicWriter] Cleaned up temp file: ${tmpPath}\n`);
    } catch (cleanupError) {
      const msg = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
      process.stderr.write(`[AtomicWriter] Failed to cleanup temp file ${tmpPath}: ${msg}\n`);
    }
  }
}
