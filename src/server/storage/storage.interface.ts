import type { Readable } from 'node:stream';

/**
 * Metadatos canónicos de un asset almacenado
 */
export interface StorageItemMetadata {
  key: string;
  contentType: string;
  sizeBytes: number;
  updatedAt: Date;
  etag?: string;
}

/**
 * Opciones para streaming por rangos de bytes (HTTP 206)
 */
export interface RangeOptions {
  start: number;
  end?: number;
}

/**
 * Contrato de Abstracción StorageProvider (Server-First)
 * Prohíbe terminantemente rutas locales hardcodeadas o dependencias del sistema de archivos Windows.
 */
export interface StorageProvider {
  /** Identificador canónico del driver activo ('local' | 's3') */
  readonly driver: 'local' | 's3';

  /**
   * Sube un archivo o stream al proveedor de almacenamiento.
   * @returns URL canónica accesible del asset.
   */
  upload(
    key: string,
    data: Buffer | Uint8Array | Readable,
    mimeType?: string
  ): Promise<string>;

  /**
   * Alias de upload para compatibilidad retrospectiva con implementaciones previas.
   */
  put(
    key: string,
    data: Buffer | Uint8Array | Readable,
    mimeType?: string
  ): Promise<string>;

  /**
   * Descarga el archivo completo como Buffer en memoria.
   */
  download(key: string): Promise<Buffer>;

  /**
   * Alias de download para compatibilidad retrospectiva.
   */
  get(key: string): Promise<Buffer>;

  /**
   * Obtiene un flujo de lectura (Readable Stream) optimizado para streaming de audio/vídeo.
   */
  getStream(key: string, range?: RangeOptions): Promise<Readable>;

  /**
   * Comprueba si un asset existe en el almacenamiento.
   */
  exists(key: string): Promise<boolean>;

  /**
   * Elimina un asset del almacenamiento.
   */
  delete(key: string): Promise<void>;

  /**
   * Obtiene la URL pública del asset (normalizada a POSIX, cero C:\Users...).
   */
  getPublicUrl(key: string): string;

  /**
   * Alias de getPublicUrl.
   */
  getUrl(key: string): string;

  /**
   * Genera una URL firmada con tiempo de caducidad (TTL en segundos).
   */
  getSignedUrl(key: string, expiresInSeconds?: number): Promise<string>;

  /**
   * Obtiene los metadatos del asset si existe, o null si no se encuentra.
   */
  getMetadata(key: string): Promise<StorageItemMetadata | null>;
}
