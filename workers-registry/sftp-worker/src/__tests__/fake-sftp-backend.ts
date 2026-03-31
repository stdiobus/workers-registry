/**
 * Fake SFTP Backend for testing
 * 
 * In-memory implementation of ISftpBackend for fast, deterministic tests.
 * Simulates SFTP operations without network or real server.
 */

import { Readable, Writable } from 'stream';
import { ISftpBackend } from '../sftp-backend.js';
import { SftpError } from '../types.js';
import {
  ConnectionConfig,
  ConnectResult,
  StatResult,
  ReaddirEntry,
} from '../types.js';

interface FakeFileEntry {
  type: 'file' | 'directory' | 'symlink';
  content?: Buffer;
  size: number;
  mtime: number;
  atime: number;
  mode: number;
}

/**
 * Fake SFTP Backend with in-memory file system
 */
export class FakeSftpBackend implements ISftpBackend {
  private connected: boolean = false;
  private files: Map<string, FakeFileEntry> = new Map();
  private config: ConnectionConfig | null = null;

  // Test hooks
  public simulateError: string | null = null;
  public simulateDelay: number = 0;

  constructor() {
    // Initialize with root directory
    this.files.set('/', {
      type: 'directory',
      size: 0,
      mtime: Math.floor(Date.now() / 1000),
      atime: Math.floor(Date.now() / 1000),
      mode: 0o755,
    });
  }

  async connect(config: ConnectionConfig): Promise<ConnectResult> {
    await this.delay();

    if (this.simulateError === 'auth') {
      throw new SftpError(-32001, 'Authentication failed', undefined);
    }
    if (this.simulateError === 'unreachable') {
      throw new SftpError(-32002, 'Host unreachable', undefined);
    }
    if (this.simulateError === 'timeout') {
      throw new SftpError(-32003, 'Connection timeout', undefined);
    }

    // Validate credentials
    if (config.authType === 'password' && !config.password) {
      throw new SftpError(-32001, 'Password required', undefined);
    }
    if (config.authType === 'privateKey' && !config.privateKey) {
      throw new SftpError(-32001, 'Private key required', undefined);
    }

    this.connected = true;
    this.config = config;

    return {
      connected: true,
      serverBanner: 'SSH-2.0-FakeSSH',
      hostKeyFingerprint: 'SHA256:fakefingerprint123',
    };
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.config = null;
  }

  async stat(path: string): Promise<StatResult> {
    this.ensureConnected();
    await this.delay();

    const entry = this.files.get(path);
    if (!entry) {
      throw new SftpError(-32010, `Path not found: ${path}`, path);
    }

    return {
      type: entry.type,
      size: entry.size,
      mtime: entry.mtime,
      atime: entry.atime,
      mode: entry.mode,
    };
  }

  async lstat(path: string): Promise<StatResult> {
    // Same as stat for fake backend (no symlink resolution)
    return this.stat(path);
  }

  async readdir(path: string): Promise<ReaddirEntry[]> {
    this.ensureConnected();
    await this.delay();

    const entry = this.files.get(path);
    if (!entry) {
      throw new SftpError(-32010, `Path not found: ${path}`, path);
    }
    if (entry.type !== 'directory') {
      throw new SftpError(-32022, `Not a directory: ${path}`, path);
    }

    const entries: ReaddirEntry[] = [];
    const prefix = path === '/' ? '/' : path + '/';

    for (const [filePath, fileEntry] of this.files.entries()) {
      if (filePath.startsWith(prefix) && filePath !== path) {
        const relativePath = filePath.substring(prefix.length);
        // Only direct children (no nested paths)
        if (!relativePath.includes('/')) {
          entries.push({
            name: relativePath,
            type: fileEntry.type,
            size: fileEntry.size,
            mtime: fileEntry.mtime,
            atime: fileEntry.atime,
          });
        }
      }
    }

    return entries;
  }

  async readFile(path: string): Promise<Buffer> {
    this.ensureConnected();
    await this.delay();

    const entry = this.files.get(path);
    if (!entry) {
      throw new SftpError(-32010, `Path not found: ${path}`, path);
    }
    if (entry.type === 'directory') {
      throw new SftpError(-32023, `Is a directory: ${path}`, path);
    }

    return entry.content || Buffer.alloc(0);
  }

  async writeFile(path: string, data: Buffer): Promise<void> {
    this.ensureConnected();
    await this.delay();

    const now = Math.floor(Date.now() / 1000);
    this.files.set(path, {
      type: 'file',
      content: data,
      size: data.length,
      mtime: now,
      atime: now,
      mode: 0o644,
    });
  }

  async mkdir(path: string): Promise<void> {
    this.ensureConnected();
    await this.delay();

    if (this.files.has(path)) {
      throw new SftpError(-32012, `Already exists: ${path}`, path);
    }

    const now = Math.floor(Date.now() / 1000);
    this.files.set(path, {
      type: 'directory',
      size: 0,
      mtime: now,
      atime: now,
      mode: 0o755,
    });
  }

  async delete(path: string, recursive: boolean = false): Promise<void> {
    this.ensureConnected();
    await this.delay();

    const entry = this.files.get(path);
    if (!entry) {
      throw new SftpError(-32010, `Path not found: ${path}`, path);
    }

    if (entry.type === 'directory') {
      // Check if directory has children
      const hasChildren = Array.from(this.files.keys()).some(
        (p) => p.startsWith(path + '/') && p !== path
      );

      if (hasChildren && !recursive) {
        throw new SftpError(-32024, `Directory not empty: ${path}`, path);
      }

      if (recursive) {
        // Delete all children
        const toDelete = Array.from(this.files.keys()).filter(
          (p) => p.startsWith(path + '/') || p === path
        );
        toDelete.forEach((p) => this.files.delete(p));
      } else {
        this.files.delete(path);
      }
    } else {
      this.files.delete(path);
    }
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    this.ensureConnected();
    await this.delay();

    const entry = this.files.get(oldPath);
    if (!entry) {
      throw new SftpError(-32010, `Path not found: ${oldPath}`, oldPath);
    }

    this.files.set(newPath, entry);
    this.files.delete(oldPath);
  }

  async openReadStream(path: string): Promise<Readable> {
    this.ensureConnected();
    const data = await this.readFile(path);
    return Readable.from([data]);
  }

  async openWriteStream(path: string): Promise<Writable> {
    this.ensureConnected();
    const chunks: Buffer[] = [];
    const backend = this;

    const stream = new Writable({
      write(chunk, encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      },
      final(callback) {
        const data = Buffer.concat(chunks);
        backend.writeFile(path, data).then(() => callback()).catch(callback);
      },
    });

    return stream;
  }

  async writeFileAtomic(path: string, data: Buffer, tmpSuffix: string): Promise<void> {
    this.ensureConnected();
    await this.delay();

    const tmpPath = path + tmpSuffix;

    // Write to temp file
    await this.writeFile(tmpPath, data);

    // Atomic rename
    await this.rename(tmpPath, path);
  }

  isConnected(): boolean {
    return this.connected;
  }

  // ============================================================================
  // Test Helpers
  // ============================================================================

  /**
   * Reset fake backend to initial state
   */
  reset(): void {
    this.connected = false;
    this.files.clear();
    this.files.set('/', {
      type: 'directory',
      size: 0,
      mtime: Math.floor(Date.now() / 1000),
      atime: Math.floor(Date.now() / 1000),
      mode: 0o755,
    });
    this.simulateError = null;
    this.simulateDelay = 0;
  }

  /**
   * Get all files in fake file system
   */
  getAllFiles(): Map<string, FakeFileEntry> {
    return new Map(this.files);
  }

  /**
   * Directly set a file in fake file system
   */
  setFile(path: string, entry: FakeFileEntry): void {
    this.files.set(path, entry);
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private ensureConnected(): void {
    if (!this.connected) {
      throw new SftpError(-32000, 'No active connection', undefined);
    }
  }

  private async delay(): Promise<void> {
    if (this.simulateDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.simulateDelay));
    }
  }
}
