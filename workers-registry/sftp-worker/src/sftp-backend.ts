/**
 * SFTP Backend - Adapter for ssh2-sftp-client
 * 
 * Provides abstraction layer over ssh2-sftp-client with:
 * - Connection lifecycle management
 * - Error mapping to SftpError
 * - Resource cleanup
 * - Credential security
 */

import SftpClient from 'ssh2-sftp-client';
import { Readable, Writable } from 'stream';
import { SftpError } from './types.js';
import {
  ConnectionConfig,
  ConnectResult,
  StatResult,
  ReaddirEntry
} from './types.js';

/**
 * SFTP Backend interface
 * 
 * Abstracts SFTP operations from concrete implementation.
 * Enables testing with mock backends.
 */
export interface ISftpBackend {
  connect(config: ConnectionConfig): Promise<ConnectResult>;
  disconnect(): Promise<void>;
  stat(path: string): Promise<StatResult>;
  lstat(path: string): Promise<StatResult>;
  readdir(path: string): Promise<ReaddirEntry[]>;
  readFile(path: string): Promise<Buffer>;
  writeFile(path: string, data: Buffer): Promise<void>;
  mkdir(path: string): Promise<void>;
  delete(path: string, recursive?: boolean): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  openReadStream(path: string): Promise<Readable>;
  openWriteStream(path: string): Promise<Writable>;
  writeFileAtomic(path: string, data: Buffer, tmpSuffix: string): Promise<void>;
  isConnected(): boolean;
}

/**
 * Concrete SFTP Backend implementation using ssh2-sftp-client
 */
export class SftpBackend implements ISftpBackend {
  private client: SftpClient;
  private connected: boolean = false;
  private config: ConnectionConfig | null = null;

  constructor() {
    this.client = new SftpClient();
  }

  /**
   * Establish SFTP connection
   * 
   * Supports password and private key authentication.
   * Returns server banner and host key fingerprint.
   */
  async connect(config: ConnectionConfig): Promise<ConnectResult> {
    try {
      this.config = config;

      const connectConfig: any = {
        host: config.host,
        port: config.port,
        username: config.username,
        readyTimeout: config.timeout || 30000,
      };

      // Authentication
      if (config.authType === 'password') {
        if (!config.password) {
          throw new SftpError(
            -32001,
            'Password required for password authentication',
            undefined,
            new Error('Missing password')
          );
        }
        connectConfig.password = config.password;
      } else if (config.authType === 'privateKey') {
        if (!config.privateKey) {
          throw new SftpError(
            -32001,
            'Private key required for privateKey authentication',
            undefined,
            new Error('Missing privateKey')
          );
        }
        connectConfig.privateKey = config.privateKey;
        if (config.passphrase) {
          connectConfig.passphrase = config.passphrase;
        }
      }

      // Host key verification will be handled by HostKeyVerifier (Task 9)
      // For now, we accept all host keys
      connectConfig.algorithms = {
        serverHostKey: ['ssh-rsa', 'ssh-dss', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521']
      };

      await this.client.connect(connectConfig);
      this.connected = true;

      // Extract server banner and host key fingerprint
      // Note: ssh2-sftp-client doesn't expose these directly
      // We'll need to enhance this in Task 9 with proper host key handling
      const serverBanner = 'SSH-2.0-OpenSSH'; // Placeholder
      const hostKeyFingerprint = 'SHA256:placeholder'; // Placeholder

      return {
        connected: true,
        serverBanner,
        hostKeyFingerprint,
      };
    } catch (error) {
      this.connected = false;
      throw this.mapError(error, undefined, 'connect');
    }
  }

  /**
   * Close SFTP connection and clean up resources
   * 
   * Idempotent - safe to call multiple times.
   * Clears credentials from memory.
   */
  async disconnect(): Promise<void> {
    try {
      if (this.connected) {
        await this.client.end();
      }
    } catch (error) {
      // Ignore errors during disconnect
    } finally {
      this.connected = false;

      // Clear credentials from memory (best-effort)
      if (this.config) {
        if (this.config.password) {
          // @ts-ignore - overwrite with zeros
          this.config.password = '\0'.repeat(this.config.password.length);
          this.config.password = '';
        }
        if (this.config.privateKey) {
          // @ts-ignore - overwrite with zeros
          this.config.privateKey = '\0'.repeat(this.config.privateKey.length);
          this.config.privateKey = '';
        }
        if (this.config.passphrase) {
          // @ts-ignore - overwrite with zeros
          this.config.passphrase = '\0'.repeat(this.config.passphrase.length);
          this.config.passphrase = '';
        }
        this.config = null;
      }
    }
  }

  /**
   * Get file/directory metadata (follows symlinks)
   */
  async stat(path: string): Promise<StatResult> {
    this.ensureConnected();
    try {
      const stats = await this.client.stat(path);
      return this.convertStats(stats, path);
    } catch (error) {
      throw this.mapError(error, path, 'stat');
    }
  }

  /**
   * Get file/directory metadata (does not follow symlinks)
   */
  async lstat(path: string): Promise<StatResult> {
    this.ensureConnected();
    try {
      const stats = await this.client.stat(path);
      // Note: ssh2-sftp-client doesn't have separate lstat
      // We'll need to check if it's a symlink via type
      return this.convertStats(stats, path);
    } catch (error) {
      throw this.mapError(error, path, 'lstat');
    }
  }

  /**
   * List directory contents
   */
  async readdir(path: string): Promise<ReaddirEntry[]> {
    this.ensureConnected();
    try {
      const entries = await this.client.list(path);
      return entries.map(entry => ({
        name: entry.name,
        type: this.convertFileType(entry.type),
        size: entry.size,
        mtime: Math.floor(entry.modifyTime / 1000), // Convert ms to seconds
        atime: Math.floor(entry.accessTime / 1000), // Convert ms to seconds
      }));
    } catch (error) {
      throw this.mapError(error, path, 'readdir');
    }
  }

  /**
   * Read file contents
   */
  async readFile(path: string): Promise<Buffer> {
    this.ensureConnected();
    try {
      const data = await this.client.get(path);
      return data as Buffer;
    } catch (error) {
      throw this.mapError(error, path, 'readFile');
    }
  }

  /**
   * Write file contents
   */
  async writeFile(path: string, data: Buffer): Promise<void> {
    this.ensureConnected();
    try {
      await this.client.put(data, path);
    } catch (error) {
      throw this.mapError(error, path, 'writeFile');
    }
  }

  /**
   * Create directory
   */
  async mkdir(path: string): Promise<void> {
    this.ensureConnected();
    try {
      await this.client.mkdir(path, false);
    } catch (error) {
      throw this.mapError(error, path, 'mkdir');
    }
  }

  /**
   * Delete file or directory
   */
  async delete(path: string, recursive: boolean = false): Promise<void> {
    this.ensureConnected();
    try {
      const stats = await this.client.stat(path);
      if (stats.isDirectory) {
        await this.client.rmdir(path, recursive);
      } else {
        await this.client.delete(path);
      }
    } catch (error) {
      throw this.mapError(error, path, 'delete');
    }
  }

  /**
   * Rename file or directory
   */
  async rename(oldPath: string, newPath: string): Promise<void> {
    this.ensureConnected();
    try {
      await this.client.rename(oldPath, newPath);
    } catch (error) {
      throw this.mapError(error, oldPath, 'rename');
    }
  }

  /**
   * Open read stream for chunked reading
   */
  async openReadStream(path: string): Promise<Readable> {
    this.ensureConnected();
    try {
      const stream = this.client.createReadStream(path);
      return stream;
    } catch (error) {
      throw this.mapError(error, path, 'openReadStream');
    }
  }

  /**
   * Open write stream for chunked writing
   */
  async openWriteStream(path: string): Promise<Writable> {
    this.ensureConnected();
    try {
      const stream = this.client.createWriteStream(path);
      return stream;
    } catch (error) {
      throw this.mapError(error, path, 'openWriteStream');
    }
  }

  /**
   * Write file atomically using temp file + rename strategy
   */
  async writeFileAtomic(path: string, data: Buffer, tmpSuffix: string): Promise<void> {
    this.ensureConnected();

    const tmpPath = path + tmpSuffix;

    try {
      // Write to temporary file
      await this.client.put(data, tmpPath);

      // Atomic rename
      await this.client.rename(tmpPath, path);
    } catch (error) {
      // Best-effort cleanup of temp file
      try {
        await this.client.delete(tmpPath);
      } catch (cleanupError) {
        // Log cleanup failure but don't throw
        console.error(`[SftpBackend] Failed to cleanup temp file ${tmpPath}:`, cleanupError);
      }

      throw this.mapError(error, path, 'writeFileAtomic');
    }
  }

  /**
   * Check if backend is connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  private ensureConnected(): void {
    if (!this.connected) {
      throw new SftpError(
        -32000,
        'No active connection',
        undefined,
        new Error('Backend not connected')
      );
    }
  }

  private convertStats(stats: any, path: string): StatResult {
    return {
      type: this.convertFileType(stats.type),
      size: stats.size,
      mtime: Math.floor(stats.modifyTime / 1000),
      atime: Math.floor(stats.accessTime / 1000),
      mode: stats.mode || 0,
    };
  }

  private convertFileType(type: string): 'file' | 'directory' | 'symlink' {
    if (type === 'd') return 'directory';
    if (type === 'l') return 'symlink';
    return 'file';
  }

  /**
   * Map ssh2-sftp-client errors to SftpError
   * 
   * This is a preliminary mapping. Full error mapping will be
   * implemented in ErrorMapper (Task 4) according to the normative table.
   */
  private mapError(error: any, path: string | undefined, operation: string): SftpError {
    const message = error?.message || String(error);
    const code = error?.code;

    // Connection errors
    if (message.includes('ECONNREFUSED') || message.includes('ENOTFOUND')) {
      return new SftpError(-32002, `Host unreachable: ${message}`, path, error);
    }
    if (message.includes('ETIMEDOUT') || message.includes('timeout')) {
      return new SftpError(-32003, `Connection timeout: ${message}`, path, error);
    }
    if (message.includes('Authentication failed') || message.includes('auth')) {
      return new SftpError(-32001, `Authentication failed: ${message}`, path, error);
    }

    // File system errors
    if (code === 'ENOENT' || message.includes('No such file')) {
      return new SftpError(-32010, `Path not found: ${path}`, path, error);
    }
    if (code === 'EACCES' || code === 'EPERM' || message.includes('Permission denied')) {
      return new SftpError(-32011, `Permission denied: ${path}`, path, error);
    }
    if (code === 'EEXIST' || message.includes('already exists')) {
      return new SftpError(-32012, `Already exists: ${path}`, path, error);
    }
    if (code === 'ENOSPC' || message.includes('No space')) {
      return new SftpError(-32013, `Disk full or quota exceeded: ${path}`, path, error);
    }
    if (code === 'ENOTDIR') {
      return new SftpError(-32022, `Not a directory: ${path}`, path, error);
    }
    if (code === 'EISDIR') {
      return new SftpError(-32023, `Is a directory: ${path}`, path, error);
    }
    if (code === 'ENOTEMPTY') {
      return new SftpError(-32024, `Directory not empty: ${path}`, path, error);
    }
    if (code === 'EBUSY') {
      return new SftpError(-32025, `Resource busy: ${path}`, path, error);
    }

    // Generic fallback
    return new SftpError(
      -32020,
      `SFTP operation failed (${operation}): ${message}`,
      path,
      error
    );
  }
}
