import { createHash, createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import type { RangeOptions, StorageItemMetadata, StorageProvider } from './storage.interface';
import { sanitizeStorageKey } from './path.sanitizer';
import { StorageError, StorageNotFoundError } from './storage.errors';
import { lookupMimeType } from './mime.utils';

export interface S3StorageOptions {
  endpoint?: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  region?: string;
  forcePathStyle?: boolean;
  publicCdnUrl?: string;
  fetchFn?: typeof fetch;
}

/**
 * Proveedor de Almacenamiento Compatible con S3 (Producción / Cloud / MinIO / R2)
 *
 * Implementa la especificación AWS Signature Version 4 (SigV4) de forma nativa
 * con Node.js Crypto y Fetch sin dependencias pesadas de terceros.
 */
export class S3CompatibleStorageProvider implements StorageProvider {
  public readonly driver = 's3' as const;
  private readonly endpoint: string;
  private readonly bucket: string;
  private readonly accessKey: string;
  private readonly secretKey: string;
  private readonly region: string;
  private readonly forcePathStyle: boolean;
  private readonly publicCdnUrl?: string;
  private readonly fetch: typeof fetch;

  constructor(options: S3StorageOptions) {
    this.endpoint = (options.endpoint || 'https://s3.amazonaws.com').replace(/\/$/, '');
    this.bucket = options.bucket;
    this.accessKey = options.accessKey;
    this.secretKey = options.secretKey;
    this.region = options.region || 'us-east-1';
    // Por defecto true para MinIO y endpoints personalizados; false para endpoints directos de AWS S3
    this.forcePathStyle = options.forcePathStyle ?? true;
    this.publicCdnUrl = options.publicCdnUrl?.replace(/\/$/, '');
    this.fetch = options.fetchFn || globalThis.fetch;
  }

  /**
   * Calcula el hash SHA-256 en formato hexadecimal
   */
  private sha256(data: string | Buffer | Uint8Array): string {
    return createHash('sha256').update(data).digest('hex');
  }

  /**
   * Calcula HMAC-SHA256 binario
   */
  private hmac(key: Buffer | string, data: string): Buffer {
    return createHmac('sha256', key).update(data).digest();
  }

  /**
   * Deriva la clave de firma AWS SigV4
   */
  private getSigningKey(dateStamp: string): Buffer {
    const kDate = this.hmac(`AWS4${this.secretKey}`, dateStamp);
    const kRegion = this.hmac(kDate, this.region);
    const kService = this.hmac(kRegion, 's3');
    return this.hmac(kService, 'aws4_request');
  }

  /**
   * Obtiene la URL completa del recurso S3 según el estilo de direccionamiento
   */
  private getResourceUrl(safeKey: string): { url: URL; host: string; canonicalUri: string } {
    let rawUrlStr: string;
    let canonicalUri: string;

    if (this.forcePathStyle) {
      rawUrlStr = `${this.endpoint}/${this.bucket}/${safeKey}`;
      const parsed = new URL(rawUrlStr);
      canonicalUri = `/${this.bucket}/${safeKey}`;
      return { url: parsed, host: parsed.host, canonicalUri };
    } else {
      const endpointUrl = new URL(this.endpoint);
      const host = `${this.bucket}.${endpointUrl.host}`;
      rawUrlStr = `${endpointUrl.protocol}//${host}/${safeKey}`;
      const parsed = new URL(rawUrlStr);
      canonicalUri = `/${safeKey}`;
      return { url: parsed, host, canonicalUri };
    }
  }

  /**
   * Firma una petición HTTP con AWS Signature Version 4
   */
  private signRequest(
    method: string,
    safeKey: string,
    body: Buffer | Uint8Array | null,
    headers: Record<string, string> = {}
  ): { url: string; headers: Record<string, string> } {
    const { url, host, canonicalUri } = this.getResourceUrl(safeKey);
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ''); // YYYYMMDDTHHMMSSZ
    const dateStamp = amzDate.substring(0, 8); // YYYYMMDD

    const contentSha256 = body ? this.sha256(body) : this.sha256('');

    const signedHeadersList = ['host', 'x-amz-content-sha256', 'x-amz-date'];
    const requestHeaders: Record<string, string> = {
      ...headers,
      host,
      'x-amz-date': amzDate,
      'x-amz-content-sha256': contentSha256,
    };

    const canonicalHeaders =
      `host:${host}\n` +
      `x-amz-content-sha256:${contentSha256}\n` +
      `x-amz-date:${amzDate}\n`;

    const signedHeaders = signedHeadersList.join(';');

    const canonicalRequest = [
      method,
      canonicalUri,
      '', // query string vacío
      canonicalHeaders,
      signedHeaders,
      contentSha256,
    ].join('\n');

    const credentialScope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      this.sha256(canonicalRequest),
    ].join('\n');

    const signingKey = this.getSigningKey(dateStamp);
    const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

    const authorization = `AWS4-HMAC-SHA256 Credential=${this.accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    requestHeaders['authorization'] = authorization;

    return {
      url: url.toString(),
      headers: requestHeaders,
    };
  }

  async upload(
    key: string,
    data: Buffer | Uint8Array | Readable,
    mimeType?: string
  ): Promise<string> {
    const safeKey = sanitizeStorageKey(key);
    const resolvedMime = mimeType || lookupMimeType(safeKey);

    let buffer: Buffer;
    if (data instanceof Readable) {
      const chunks: Buffer[] = [];
      for await (const chunk of data) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      buffer = Buffer.concat(chunks);
    } else {
      buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    }

    const { url, headers } = this.signRequest('PUT', safeKey, buffer, {
      'content-type': resolvedMime,
      'content-length': buffer.length.toString(),
    });

    const response = await this.fetch(url, {
      method: 'PUT',
      headers,
      body: buffer as unknown as BodyInit,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new StorageError(`Fallo al subir a S3 [${response.status}]: ${errorText}`, response.status);
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
    const { url, headers } = this.signRequest('GET', safeKey, null);

    const response = await this.fetch(url, {
      method: 'GET',
      headers,
    });

    if (response.status === 404) {
      throw new StorageNotFoundError(safeKey);
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new StorageError(`Error al descargar de S3 [${response.status}]: ${errorText}`, response.status);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async get(key: string): Promise<Buffer> {
    return this.download(key);
  }

  async getStream(key: string, range?: RangeOptions): Promise<Readable> {
    const safeKey = sanitizeStorageKey(key);
    const customHeaders: Record<string, string> = {};

    if (range) {
      const endStr = range.end !== undefined ? range.end.toString() : '';
      customHeaders['range'] = `bytes=${range.start}-${endStr}`;
    }

    const { url, headers } = this.signRequest('GET', safeKey, null, customHeaders);

    const response = await this.fetch(url, {
      method: 'GET',
      headers,
    });

    if (response.status === 404) {
      throw new StorageNotFoundError(safeKey);
    }

    if (!response.ok && response.status !== 206) {
      const errorText = await response.text();
      throw new StorageError(`Error al obtener stream de S3 [${response.status}]: ${errorText}`, response.status);
    }

    if (!response.body) {
      return Readable.from([]);
    }

    return Readable.fromWeb(response.body as any);
  }

  async exists(key: string): Promise<boolean> {
    try {
      const safeKey = sanitizeStorageKey(key);
      const { url, headers } = this.signRequest('HEAD', safeKey, null);

      const response = await this.fetch(url, {
        method: 'HEAD',
        headers,
      });

      return response.ok;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    const safeKey = sanitizeStorageKey(key);
    const { url, headers } = this.signRequest('DELETE', safeKey, null);

    const response = await this.fetch(url, {
      method: 'DELETE',
      headers,
    });

    if (!response.ok && response.status !== 404) {
      const errorText = await response.text();
      throw new StorageError(`Error al eliminar de S3 [${response.status}]: ${errorText}`, response.status);
    }
  }

  getPublicUrl(key: string): string {
    const safeKey = sanitizeStorageKey(key);

    if (this.publicCdnUrl) {
      return `${this.publicCdnUrl}/${safeKey}`;
    }

    const { url } = this.getResourceUrl(safeKey);
    return url.toString();
  }

  getUrl(key: string): string {
    return this.getPublicUrl(key);
  }

  /**
   * Genera una URL prefirmada (Presigned URL) con AWS SigV4 en Query Parameters
   */
  async getSignedUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    const safeKey = sanitizeStorageKey(key);
    const { url, host, canonicalUri } = this.getResourceUrl(safeKey);

    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.substring(0, 8);
    const credentialScope = `${dateStamp}/${this.region}/s3/aws4_request`;

    const queryParams: Record<string, string> = {
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': `${this.accessKey}/${credentialScope}`,
      'X-Amz-Date': amzDate,
      'X-Amz-Expires': Math.max(1, Math.min(expiresInSeconds, 604800)).toString(),
      'X-Amz-SignedHeaders': 'host',
    };

    // Orden alfabético estricto de parámetros
    const sortedKeys = Object.keys(queryParams).sort();
    const canonicalQueryString = sortedKeys
      .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(queryParams[k])}`)
      .join('&');

    const canonicalHeaders = `host:${host}\n`;
    const signedHeaders = 'host';
    const payloadHash = 'UNSIGNED-PAYLOAD';

    const canonicalRequest = [
      'GET',
      canonicalUri,
      canonicalQueryString,
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');

    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      this.sha256(canonicalRequest),
    ].join('\n');

    const signingKey = this.getSigningKey(dateStamp);
    const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

    url.search = `${canonicalQueryString}&X-Amz-Signature=${signature}`;
    return url.toString();
  }

  async getMetadata(key: string): Promise<StorageItemMetadata | null> {
    try {
      const safeKey = sanitizeStorageKey(key);
      const { url, headers } = this.signRequest('HEAD', safeKey, null);

      const response = await this.fetch(url, {
        method: 'HEAD',
        headers,
      });

      if (!response.ok) {
        return null;
      }

      const contentLength = response.headers.get('content-length');
      const contentType = response.headers.get('content-type') || lookupMimeType(safeKey);
      const lastModified = response.headers.get('last-modified');
      const etag = response.headers.get('etag') || undefined;

      return {
        key: safeKey,
        contentType,
        sizeBytes: contentLength ? parseInt(contentLength, 10) : 0,
        updatedAt: lastModified ? new Date(lastModified) : new Date(),
        etag: etag ? etag.replace(/"/g, '') : undefined,
      };
    } catch {
      return null;
    }
  }
}
