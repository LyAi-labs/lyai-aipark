import { promises as fs, createReadStream, createWriteStream } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import type { RangeOptions, StorageItemMetadata, StorageProvider } from './storage.interface';
import { sanitizeStorageKey } from './path.sanitizer';
import { StorageNotFoundError, StorageSecurityError } from './storage.errors';
import { lookupMimeType } from './mime.utils';
import { signAssetUrl } from './signer';

export interface LocalStorageProviderOptions {
  baseDir?: string;
  publicBaseUrl?: string;
  secret?: string;
}

/**
 * Proveedor de Almacenamiento Local (Desarrollo / Testing)
 *
 * Directivas Server-First:
 * - Rutas POSIX normalizadas siempre.
 * - Cero rutas absolutas de Windows en claves o URLs expuestas.
 * - Confinamiento estricto al directorio base (`baseDir`).
 */
export class LocalStorageProvider implements StorageProvider {
  public readonly driver = 'local' as const;
  private readonly baseDir: string;
  private readonly publicBaseUrl: string;
  private readonly secret: string;

  constructor(options: LocalStorageProviderOptions = {}) {
    this.baseDir = resolve(options.baseDir || './storage/assets');
    this.publicBaseUrl = (options.publicBaseUrl || '/api/assets').replace(/\/$/, '');
    this.secret = options.secret || 'cartoon-factory-local-storage-secret-key-32chars';
  }

  /**
   * Resuelve y valida que la ruta física resultante permanezca confinada dentro de `baseDir`.
   */
  private resolvePhysicalPath(safeKey: string): string {
    const fullPath = resolve(this.baseDir, safeKey);
    const resolvedRoot = resolve(this.baseDir);

    // Confinamiento estricto contra Path Traversal
    if (!fullPath.startsWith(resolvedRoot + sep) && fullPath !== resolvedRoot) {
      throw new StorageSecurityError('Intento de escape fuera del directorio base de almacenamiento');
    }

    return fullPath;
  }

  async upload(
    key: string,
    data: Buffer | Uint8Array | Readable,
    _mimeType?: string
  ): Promise<string> {
    const safeKey = sanitizeStorageKey(key);
    const physicalPath = this.resolvePhysicalPath(safeKey);

    await fs.mkdir(dirname(physicalPath), { recursive: true });

    if (data instanceof Readable) {
      const writeStream = createWriteStream(physicalPath);
      await pipeline(data, writeStream);
    } else {
      await fs.writeFile(physicalPath, data);
    }

    return this.getPublicUrl(safeKey);
  }

  async put(
    key: string,
    data: Buffer | Uint8Array | Readable,
    mimeType?: string
  ): Promise<string> {
    return this.upload(key, data, mimeType);
  }

  async download(key: string): Promise<Buffer> {
    const safeKey = sanitizeStorageKey(key);
    const physicalPath = this.resolvePhysicalPath(safeKey);

    try {
      return await fs.readFile(physicalPath);
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        throw new StorageNotFoundError(safeKey);
      }
      throw err;
    }
  }

  async get(key: string): Promise<Buffer> {
    return this.download(key);
  }

  async getStream(key: string, range?: RangeOptions): Promise<Readable> {
    const safeKey = sanitizeStorageKey(key);
    const physicalPath = this.resolvePhysicalPath(safeKey);

    try {
      await fs.access(physicalPath);
    } catch {
      throw new StorageNotFoundError(safeKey);
    }

    return createReadStream(physicalPath, range ? { start: range.start, end: range.end } : undefined);
  }

  async exists(key: string): Promise<boolean> {
    try {
      const safeKey = sanitizeStorageKey(key);
      const physicalPath = this.resolvePhysicalPath(safeKey);
      await fs.access(physicalPath);
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      const safeKey = sanitizeStorageKey(key);
      const physicalPath = this.resolvePhysicalPath(safeKey);
      await fs.unlink(physicalPath);
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        throw err;
      }
    }
  }

  getPublicUrl(key: string): string {
    const safeKey = sanitizeStorageKey(key);
    // Garantiza URL con barras POSIX y sin ninguna referencia a unidades o rutas de Windows
    return `${this.publicBaseUrl}/${safeKey}`;
  }

  getUrl(key: string): string {
    return this.getPublicUrl(key);
  }

  async getSignedUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    const safeKey = sanitizeStorageKey(key);
    return signAssetUrl({
      key: safeKey,
      secret: this.secret,
      expiresInSeconds,
      baseUrl: `${this.publicBaseUrl}/signed`,
    });
  }

  async getMetadata(key: string): Promise<StorageItemMetadata | null> {
    try {
      const safeKey = sanitizeStorageKey(key);
      const physicalPath = this.resolvePhysicalPath(safeKey);
      const stat = await fs.stat(physicalPath);

      return {
        key: safeKey,
        contentType: lookupMimeType(safeKey),
        sizeBytes: stat.size,
        updatedAt: stat.mtime,
      };
    } catch {
      return null;
    }
  }
}
