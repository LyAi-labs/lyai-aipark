import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import { sanitizeStorageKey } from './path.sanitizer';
import { signAssetUrl, verifyAssetSignature } from './signer';
import { LocalStorageProvider } from './local.storage';
import { S3CompatibleStorageProvider } from './s3.storage';
import { createStorageProvider } from './storage.factory';
import { storageRouter, createStorageRouter } from './storage.router';
import { StorageNotFoundError, StorageSecurityError, StorageSignatureError } from './storage.errors';
import { lookupMimeType, parseHttpRange } from './mime.utils';
import { signAccessToken } from '../auth/jwt.service';
import { errorHandler } from '../errors';

const TEST_STORAGE_DIR = join(process.cwd(), 'tmp-test-storage');
const TEST_SECRET = 'test-storage-super-secret-key-32chars-min!!';
process.env['JWT_SECRET'] = TEST_SECRET;
process.env['NODE_ENV'] = 'test';

describe('Phase 05 — StorageProvider Abstraction Engine', () => {
  beforeEach(async () => {
    await fs.mkdir(TEST_STORAGE_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEST_STORAGE_DIR, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 1. Path Sanitizer & Traversal Defense
  // ──────────────────────────────────────────────────────────────────────────
  describe('1. Path Sanitizer & Traversal Defense', () => {
    it('normalizes valid nested POSIX keys and strips leading slashes', () => {
      expect(sanitizeStorageKey('episodes/ep-101/scene-1.wav')).toBe('episodes/ep-101/scene-1.wav');
      expect(sanitizeStorageKey('/thumbnails/hero.png')).toBe('thumbnails/hero.png');
      expect(sanitizeStorageKey('///assets/subfolder/file.json')).toBe('assets/subfolder/file.json');
    });

    it('converts Windows backslashes into POSIX slashes', () => {
      expect(sanitizeStorageKey('episodes\\ep-101\\dialogue.mp3')).toBe('episodes/ep-101/dialogue.mp3');
    });

    it('rejects Path Traversal attempts with ".." segments', () => {
      expect(() => sanitizeStorageKey('../../../etc/passwd')).toThrow(StorageSecurityError);
      expect(() => sanitizeStorageKey('episodes/../../secret.txt')).toThrow(StorageSecurityError);
      expect(() => sanitizeStorageKey('episodes/..')).toThrow(StorageSecurityError);
      expect(() => sanitizeStorageKey('..\\..\\windows\\system32')).toThrow(StorageSecurityError);
    });

    it('rejects URL-encoded traversal patterns (%2e%2e)', () => {
      expect(() => sanitizeStorageKey('%2e%2e%2fetc/passwd')).toThrow(StorageSecurityError);
      expect(() => sanitizeStorageKey('%252e%252e%252fsecret')).toThrow(StorageSecurityError);
    });

    it('rejects raw and encoded Null Bytes (\0, %00)', () => {
      expect(() => sanitizeStorageKey('audio.wav\0.exe')).toThrow(StorageSecurityError);
      expect(() => sanitizeStorageKey('audio.wav%00.exe')).toThrow(StorageSecurityError);
    });

    it('rejects Windows absolute drive letters (C:, D:)', () => {
      expect(() => sanitizeStorageKey('C:\\Users\\Glado\\secret.txt')).toThrow(StorageSecurityError);
      expect(() => sanitizeStorageKey('d:/data/assets.png')).toThrow(StorageSecurityError);
    });

    it('rejects UNC network paths (\\\\server or //server)', () => {
      expect(() => sanitizeStorageKey('\\\\evil-server\\share\\file.mp4')).toThrow(StorageSecurityError);
      expect(() => sanitizeStorageKey('//evil-server/share/file.mp4')).toThrow(StorageSecurityError);
    });

    it('rejects ASCII control characters', () => {
      expect(() => sanitizeStorageKey('audio\x08test.wav')).toThrow(StorageSecurityError);
      expect(() => sanitizeStorageKey('line\ntest.wav')).toThrow(StorageSecurityError);
    });

    it('rejects empty or whitespace-only keys', () => {
      expect(() => sanitizeStorageKey('')).toThrow(StorageSecurityError);
      expect(() => sanitizeStorageKey('   ')).toThrow(StorageSecurityError);
      expect(() => sanitizeStorageKey('/')).toThrow(StorageSecurityError);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. MIME & Range Utilities
  // ──────────────────────────────────────────────────────────────────────────
  describe('2. MIME & HTTP Range Utilities', () => {
    it('correctly maps audio, video and image extensions to MIME types', () => {
      expect(lookupMimeType('dialogue.wav')).toBe('audio/wav');
      expect(lookupMimeType('voice.mp3')).toBe('audio/mpeg');
      expect(lookupMimeType('final-video.mp4')).toBe('video/mp4');
      expect(lookupMimeType('poster.png')).toBe('image/png');
      expect(lookupMimeType('thumb.webp')).toBe('image/webp');
      expect(lookupMimeType('unknown.customext')).toBe('application/octet-stream');
    });

    it('parses valid byte ranges for media streaming (HTTP 206)', () => {
      const totalSize = 1000;
      const range1 = parseHttpRange('bytes=0-499', totalSize);
      expect(range1).toEqual({ start: 0, end: 499, totalSize: 1000, chunkLength: 500 });

      const range2 = parseHttpRange('bytes=500-', totalSize);
      expect(range2).toEqual({ start: 500, end: 999, totalSize: 1000, chunkLength: 500 });

      const range3 = parseHttpRange('bytes=-200', totalSize);
      expect(range3).toEqual({ start: 800, end: 999, totalSize: 1000, chunkLength: 200 });
    });

    it('returns null for invalid or out-of-bounds ranges', () => {
      expect(parseHttpRange(undefined, 1000)).toBeNull();
      expect(parseHttpRange('invalid-range', 1000)).toBeNull();
      expect(parseHttpRange('bytes=1500-2000', 1000)).toBeNull();
      expect(parseHttpRange('bytes=600-400', 1000)).toBeNull();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. HMAC-SHA256 URL Signer & Verifier
  // ──────────────────────────────────────────────────────────────────────────
  describe('3. Cryptographic URL Signer & Verifier', () => {
    it('signs and verifies asset URLs with timestamp and signature', () => {
      const url = signAssetUrl({
        key: 'episodes/ep-1/scene-1.wav',
        secret: TEST_SECRET,
        expiresInSeconds: 300,
        baseUrl: '/api/assets/signed',
      });

      expect(url).toContain('/api/assets/signed?key=');
      expect(url).toContain('&exp=');
      expect(url).toContain('&sig=');

      const parsed = new URL(`http://localhost${url}`);
      const key = parsed.searchParams.get('key')!;
      const exp = parsed.searchParams.get('exp')!;
      const sig = parsed.searchParams.get('sig')!;

      expect(() => verifyAssetSignature(key, exp, sig, TEST_SECRET)).not.toThrow();
    });

    it('rejects expired signed URLs', () => {
      const pastExp = (Math.floor(Date.now() / 1000) - 10).toString();
      expect(() => verifyAssetSignature('episodes/1.wav', pastExp, 'fakesig', TEST_SECRET)).toThrow(
        StorageSignatureError
      );
    });

    it('rejects tampered keys or signatures', () => {
      const url = signAssetUrl({
        key: 'episodes/ep-1/scene-1.wav',
        secret: TEST_SECRET,
        expiresInSeconds: 300,
      });

      const parsed = new URL(`http://localhost${url}`);
      const exp = parsed.searchParams.get('exp')!;
      const sig = parsed.searchParams.get('sig')!;

      // Modificamos la clave solicitada
      expect(() => verifyAssetSignature('episodes/ep-1/other.wav', exp, sig, TEST_SECRET)).toThrow(
        StorageSignatureError
      );

      // Modificamos la firma
      const badSig = sig.slice(0, -2) + 'aa';
      expect(() => verifyAssetSignature('episodes/ep-1/scene-1.wav', exp, badSig, TEST_SECRET)).toThrow(
        StorageSignatureError
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. LocalStorageProvider Implementation
  // ──────────────────────────────────────────────────────────────────────────
  describe('4. LocalStorageProvider', () => {
    let provider: LocalStorageProvider;

    beforeEach(() => {
      provider = new LocalStorageProvider({
        baseDir: TEST_STORAGE_DIR,
        publicBaseUrl: '/api/assets',
        secret: TEST_SECRET,
      });
    });

    it('has driver property set to "local"', () => {
      expect(provider.driver).toBe('local');
    });

    it('uploads and downloads binary buffer data', async () => {
      const testBuffer = Buffer.from('RIFF....WAVEfmt test audio data');
      const publicUrl = await provider.upload('episodes/ep-1/audio.wav', testBuffer, 'audio/wav');

      // Cero rastro de C:\Users... en la URL pública
      expect(publicUrl).toBe('/api/assets/episodes/ep-1/audio.wav');
      expect(publicUrl).not.toContain('C:');
      expect(publicUrl).not.toContain('\\');

      const exists = await provider.exists('episodes/ep-1/audio.wav');
      expect(exists).toBe(true);

      const downloaded = await provider.download('episodes/ep-1/audio.wav');
      expect(downloaded.toString()).toBe(testBuffer.toString());
    });

    it('supports upload via Readable stream', async () => {
      const stream = Readable.from(['Chunk 1, ', 'Chunk 2, ', 'Chunk 3']);
      const publicUrl = await provider.upload('streams/stream-test.txt', stream, 'text/plain');

      expect(publicUrl).toBe('/api/assets/streams/stream-test.txt');
      const downloaded = await provider.download('streams/stream-test.txt');
      expect(downloaded.toString()).toBe('Chunk 1, Chunk 2, Chunk 3');
    });

    it('returns stream with optional byte range slicing', async () => {
      const data = Buffer.from('0123456789ABCDEF');
      await provider.upload('range-test.dat', data);

      const rangeStream = await provider.getStream('range-test.dat', { start: 2, end: 5 });
      const chunks: Buffer[] = [];
      for await (const chunk of rangeStream) {
        chunks.push(Buffer.from(chunk));
      }
      const sliceResult = Buffer.concat(chunks).toString();
      expect(sliceResult).toBe('2345');
    });

    it('returns metadata with size, updatedAt and MIME type', async () => {
      const data = Buffer.from('Fake PNG binary header');
      await provider.upload('images/scene-1.png', data, 'image/png');

      const meta = await provider.getMetadata('images/scene-1.png');
      expect(meta).not.toBeNull();
      expect(meta?.contentType).toBe('image/png');
      expect(meta?.sizeBytes).toBe(data.length);
      expect(meta?.key).toBe('images/scene-1.png');
    });

    it('throws StorageNotFoundError when downloading non-existent asset', async () => {
      await expect(provider.download('non-existent.mp4')).rejects.toThrow(StorageNotFoundError);
      await expect(provider.getStream('non-existent.mp4')).rejects.toThrow(StorageNotFoundError);
    });

    it('deletes asset idempotently without throwing if not found', async () => {
      await provider.upload('temp/delete-me.txt', Buffer.from('hello'));
      expect(await provider.exists('temp/delete-me.txt')).toBe(true);

      await provider.delete('temp/delete-me.txt');
      expect(await provider.exists('temp/delete-me.txt')).toBe(false);

      // Segundo delete no debe lanzar error
      await expect(provider.delete('temp/delete-me.txt')).resolves.not.toThrow();
    });

    it('generates signed URLs without any Windows path or drive letter', async () => {
      const signedUrl = await provider.getSignedUrl('episodes/1/audio.wav', 600);
      expect(signedUrl).toContain('/api/assets/signed?key=episodes%2F1%2Faudio.wav');
      expect(signedUrl).not.toContain('C:');
      expect(signedUrl).not.toContain('\\');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 5. S3CompatibleStorageProvider Implementation (AWS SigV4)
  // ──────────────────────────────────────────────────────────────────────────
  describe('5. S3CompatibleStorageProvider (AWS SigV4 & Zero Dependencies)', () => {
    it('has driver property set to "s3"', () => {
      const s3 = new S3CompatibleStorageProvider({
        bucket: 'test-bucket',
        accessKey: 'AKIAIOSFODNN7EXAMPLE',
        secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      });
      expect(s3.driver).toBe('s3');
    });

    it('constructs correct public URLs with POSIX paths and no Windows artifacts', () => {
      const s3 = new S3CompatibleStorageProvider({
        endpoint: 'https://s3.eu-west-1.amazonaws.com',
        bucket: 'cartoon-studio-assets',
        accessKey: 'AKIAEXAMPLE',
        secretKey: 'secretEXAMPLE',
        forcePathStyle: true,
      });

      const url = s3.getPublicUrl('episodes/ep-1/scene-1.mp4');
      expect(url).toBe('https://s3.eu-west-1.amazonaws.com/cartoon-studio-assets/episodes/ep-1/scene-1.mp4');
      expect(url).not.toContain('C:');
      expect(url).not.toContain('\\');
    });

    it('generates compliant AWS SigV4 Presigned URLs with query parameters', async () => {
      const s3 = new S3CompatibleStorageProvider({
        endpoint: 'https://s3.amazonaws.com',
        bucket: 'my-bucket',
        accessKey: 'MYACCESSKEY',
        secretKey: 'MYSECRETKEY',
        region: 'us-east-1',
        forcePathStyle: true,
      });

      const presignedUrl = await s3.getSignedUrl('audio/voice.wav', 900);
      const url = new URL(presignedUrl);

      expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
      expect(url.searchParams.get('X-Amz-Credential')).toContain('MYACCESSKEY');
      expect(url.searchParams.get('X-Amz-Date')).toBeDefined();
      expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
      expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('host');
      expect(url.searchParams.get('X-Amz-Signature')).toBeDefined();
    });

    it('executes upload with SigV4 Authorization header to mock fetch', async () => {
      let capturedUrl = '';
      let capturedHeaders: Record<string, string> = {};
      let capturedBody: any;

      const mockFetch = vi.fn().mockImplementation(async (url: string, init: any) => {
        capturedUrl = url;
        capturedHeaders = init.headers;
        capturedBody = init.body;
        return {
          ok: true,
          status: 200,
          text: async () => '',
        };
      });

      const s3 = new S3CompatibleStorageProvider({
        endpoint: 'http://localhost:9000',
        bucket: 'minio-bucket',
        accessKey: 'minioadmin',
        secretKey: 'minioadmin',
        region: 'us-east-1',
        fetchFn: mockFetch as any,
      });

      const fileData = Buffer.from('Test video stream content');
      await s3.upload('videos/test.mp4', fileData, 'video/mp4');

      expect(capturedUrl).toBe('http://localhost:9000/minio-bucket/videos/test.mp4');
      expect(capturedHeaders['authorization']).toContain('AWS4-HMAC-SHA256 Credential=minioadmin/');
      expect(capturedHeaders['x-amz-content-sha256']).toBeDefined();
      expect(capturedHeaders['content-type']).toBe('video/mp4');
      expect(Buffer.isBuffer(capturedBody) || capturedBody instanceof Uint8Array).toBe(true);
    });

    it('downloads from S3 and throws StorageNotFoundError on 404', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => 'NoSuchKey',
      });

      const s3 = new S3CompatibleStorageProvider({
        bucket: 'test-bucket',
        accessKey: 'key',
        secretKey: 'secret',
        fetchFn: mockFetch as any,
      });

      await expect(s3.download('missing.mp3')).rejects.toThrow(StorageNotFoundError);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 6. Factory Resolution & Switching
  // ──────────────────────────────────────────────────────────────────────────
  describe('6. Factory Resolution & Driver Switching', () => {
    it('creates LocalStorageProvider when driver is "local"', () => {
      const provider = createStorageProvider(
        {
          driver: 'local',
          localPath: './storage/assets',
          s3: {},
        },
        {
          jwtSecret: TEST_SECRET,
          sessionSecret: TEST_SECRET,
          isConfigured: true,
        }
      );

      expect(provider.driver).toBe('local');
    });

    it('creates S3CompatibleStorageProvider when driver is "s3"', () => {
      const provider = createStorageProvider(
        {
          driver: 's3',
          localPath: './storage/assets',
          s3: {
            endpoint: 'http://localhost:9000',
            bucket: 'remote-bucket',
            accessKey: 'remoteKey',
            secretKey: 'remoteSecret',
          },
        },
        {
          jwtSecret: TEST_SECRET,
          sessionSecret: TEST_SECRET,
          isConfigured: true,
        }
      );

      expect(provider.driver).toBe('s3');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 7. Express Router Endpoints & Security Integration
  // ──────────────────────────────────────────────────────────────────────────
  describe('7. Express Router Endpoints & Security Integration', () => {
    let app: Express;
    let localProvider: LocalStorageProvider;
    let validAuthToken: string;

    beforeEach(async () => {
      localProvider = new LocalStorageProvider({
        baseDir: TEST_STORAGE_DIR,
        publicBaseUrl: '/api/assets',
        secret: TEST_SECRET,
      });

      // Creamos archivo de prueba
      await localProvider.upload('episodes/1/scene-1.wav', Buffer.from('WAV_HEADER_DATA_12345'), 'audio/wav');

      validAuthToken = signAccessToken(
        {
          userId: 'usr_test_123',
          email: 'creator@cartoon.studio',
          role: 'ADMIN',
        },
        TEST_SECRET
      );

      app = express();
      app.use(express.json());
      app.use(cookieParser());
      app.use('/api/assets', createStorageRouter(localProvider));
      app.use(errorHandler);
    });

    it('GET /api/assets/:key serves asset with MIME type and security headers', async () => {
      const res = await fetchResponse(app, 'GET', '/api/assets/episodes/1/scene-1.wav');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('audio/wav');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['accept-ranges']).toBe('bytes');
      expect(res.body).toBe('WAV_HEADER_DATA_12345');
    });

    it('GET /api/assets/:key supports Range requests with 206 Partial Content', async () => {
      const res = await fetchResponse(app, 'GET', '/api/assets/episodes/1/scene-1.wav', {
        headers: { range: 'bytes=0-3' },
      });

      expect(res.status).toBe(206);
      expect(res.headers['content-range']).toContain('bytes 0-3/');
      expect(res.headers['content-length']).toBe('4');
      expect(res.body).toBe('WAV_');
    });

    it('GET /api/assets/:key returns 404 for non-existent asset', async () => {
      const res = await fetchResponse(app, 'GET', '/api/assets/missing/audio.wav');
      expect(res.status).toBe(404);
      expect(JSON.parse(res.body).error.code).toBe('STORAGE_NOT_FOUND');
    });

    it('GET /api/assets/:key blocks directory traversal with 400 Bad Request', async () => {
      const res = await fetchResponse(app, 'GET', '/api/assets/episodes/%252e%252e/secret.txt');
      expect(res.status).toBe(400);
      expect(JSON.parse(res.body).error.code).toBe('STORAGE_SECURITY_ERROR');
    });

    it('GET /api/assets/signed validates signature and serves asset', async () => {
      const signedUrl = await localProvider.getSignedUrl('episodes/1/scene-1.wav', 300);
      const res = await fetchResponse(app, 'GET', signedUrl);

      expect(res.status).toBe(200);
      expect(res.body).toBe('WAV_HEADER_DATA_12345');
    });

    it('GET /api/assets/signed rejects invalid or expired signatures with 403 Forbidden', async () => {
      const res = await fetchResponse(
        app,
        'GET',
        '/api/assets/signed?key=episodes/1/scene-1.wav&exp=9999999999&sig=deadbeef00112233'
      );

      expect(res.status).toBe(403);
      expect(JSON.parse(res.body).error.code).toBe('STORAGE_SIGNATURE_ERROR');
    });

    it('POST /api/assets/sign requires authentication (401 without JWT)', async () => {
      const res = await fetchResponse(app, 'POST', '/api/assets/sign', {
        body: JSON.stringify({ key: 'episodes/1/scene-1.wav' }),
        headers: { 'content-type': 'application/json' },
      });

      expect(res.status).toBe(401);
    });

    it('POST /api/assets/sign generates signed URL for authenticated user', async () => {
      const res = await fetchResponse(app, 'POST', '/api/assets/sign', {
        body: JSON.stringify({ key: 'episodes/1/scene-1.wav', expiresIn: 600 }),
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${validAuthToken}`,
        },
      });

      expect(res.status).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.success).toBe(true);
      expect(data.signedUrl).toContain('/api/assets/signed?key=');
      expect(data.expiresAt).toBeDefined();
    });

    it('POST /api/assets/upload saves file and returns public URL for authenticated user', async () => {
      const res = await fetchResponse(app, 'POST', '/api/assets/upload', {
        body: JSON.stringify({
          key: 'uploads/test-image.png',
          data: Buffer.from('PNG_FAKE_IMAGE_DATA').toString('base64'),
          encoding: 'base64',
          contentType: 'image/png',
        }),
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${validAuthToken}`,
        },
      });

      expect(res.status).toBe(201);
      const data = JSON.parse(res.body);
      expect(data.success).toBe(true);
      expect(data.url).toBe('/api/assets/uploads/test-image.png');
      expect(data.key).toBe('uploads/test-image.png');

      // Comprobamos que el archivo se puede leer
      const fileRes = await fetchResponse(app, 'GET', '/api/assets/uploads/test-image.png');
      expect(fileRes.status).toBe(200);
      expect(fileRes.body).toBe('PNG_FAKE_IMAGE_DATA');
    });

    it('DELETE /api/assets/:key removes file for authenticated user', async () => {
      // Subir archivo temporal
      await localProvider.upload('to-delete.txt', Buffer.from('delete test'));

      const res = await fetchResponse(app, 'DELETE', '/api/assets/to-delete.txt', {
        headers: { authorization: `Bearer ${validAuthToken}` },
      });

      expect(res.status).toBe(200);
      expect(JSON.parse(res.body).success).toBe(true);
      expect(await localProvider.exists('to-delete.txt')).toBe(false);
    });
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Helper para testear Express sin abrir puertos de red
// ──────────────────────────────────────────────────────────────────────────
async function fetchResponse(
  app: Express,
  method: string,
  urlPath: string,
  options: { headers?: Record<string, string>; body?: string } = {}
): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  const { createServer } = await import('node:http');

  return new Promise((resolve, reject) => {
    const server = createServer(app);
    server.listen(0, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        return reject(new Error('Failed to bind server address'));
      }

      const port = address.port;
      const fullUrl = `http://127.0.0.1:${port}${urlPath}`;

      fetch(fullUrl, {
        method,
        headers: options.headers,
        body: options.body,
      })
        .then(async (res) => {
          const body = await res.text();
          const headers: Record<string, string> = {};
          res.headers.forEach((val, key) => {
            headers[key.toLowerCase()] = val;
          });

          server.close(() => {
            resolve({
              status: res.status,
              headers,
              body,
            });
          });
        })
        .catch((err) => {
          server.close(() => reject(err));
        });
    });
  });
}
