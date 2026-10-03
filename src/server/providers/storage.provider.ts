/**
 * StorageProvider Interface & Minimal Local Implementation
 * Designed to prevent hardcoding to Windows absolute paths or local filesystem.
 */
import { promises as fs } from 'node:fs';
import { dirname, join, normalize } from 'node:path';

export interface StorageItemMetadata {
  contentType: string;
  sizeBytes: number;
  updatedAt: Date;
}

export interface StorageProvider {
  /**
   * Store an asset with a unique key
   */
  put(key: string, data: Buffer | Uint8Array, contentType: string): Promise<string>;

  /**
   * Retrieve asset binary data
   */
  get(key: string): Promise<Buffer>;

  /**
   * Check whether an asset exists
   */
  exists(key: string): Promise<boolean>;

  /**
   * Delete an asset
   */
  delete(key: string): Promise<void>;

  /**
   * Generate canonical public/serve URL for the asset
   */
  getUrl(key: string): string;
}

/**
 * Minimal LocalStorageProvider for development
 * Uses normalized POSIX relative paths; strictly prevents C:\ or absolute path coupling.
 */
export class LocalStorageProvider implements StorageProvider {
  private readonly baseDir: string;
  private readonly publicBaseUrl: string;

  constructor(baseDir = './storage/assets', publicBaseUrl = '/api/assets') {
    this.baseDir = normalize(baseDir);
    this.publicBaseUrl = publicBaseUrl.replace(/\/$/, '');
  }

  private resolvePath(key: string): string {
    // Sanitize key to prevent path traversal
    const safeKey = key.replace(/^(\.\.(\/|\\|$))+/, '').replace(/\\/g, '/');
    return join(this.baseDir, safeKey);
  }

  async put(key: string, data: Buffer | Uint8Array, _contentType: string): Promise<string> {
    const fullPath = this.resolvePath(key);
    await fs.mkdir(dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, data);
    return this.getUrl(key);
  }

  async get(key: string): Promise<Buffer> {
    const fullPath = this.resolvePath(key);
    return fs.readFile(fullPath);
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.resolvePath(key));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await fs.unlink(this.resolvePath(key));
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  getUrl(key: string): string {
    const cleanKey = key.replace(/\\/g, '/').replace(/^\//, '');
    return `${this.publicBaseUrl}/${cleanKey}`;
  }
}
