import { Router, type Request, type Response, type NextFunction } from 'express';
import { storageProvider as defaultStorageProvider } from './storage.factory';
import type { StorageProvider } from './storage.interface';
import { sanitizeStorageKey } from './path.sanitizer';
import { verifyAssetSignature } from './signer';
import { lookupMimeType, parseHttpRange } from './mime.utils';
import { config } from '../config';
import { requireAuth } from '../auth';
import { StorageNotFoundError, StorageSecurityError } from './storage.errors';

/**
 * Extrae la clave de almacenamiento desde los parámetros de Express (soporta path-to-regexp v8 arrays o strings)
 */
function extractKeyFromRequest(req: Request): string {
  const param = req.params['key'];
  if (Array.isArray(param)) {
    return param.join('/');
  }
  if (typeof param === 'string' && param.length > 0) {
    return param;
  }
  return req.path.replace(/^\//, '');
}

/**
 * Crea una instancia de Express Router para almacenamiento vinculada a un StorageProvider
 */
export function createStorageRouter(provider: StorageProvider = defaultStorageProvider): Router {
  const router: Router = Router();

  /**
   * Transmite el asset binario soportando HTTP 206 Partial Content (Range requests)
   */
  async function streamAsset(key: string, req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const safeKey = sanitizeStorageKey(key);
      const metadata = await provider.getMetadata(safeKey);

      if (!metadata) {
        throw new StorageNotFoundError(safeKey);
      }

      const mimeType = metadata.contentType || lookupMimeType(safeKey);
      const rangeHeader = req.headers.range;
      const parsedRange = parseHttpRange(rangeHeader, metadata.sizeBytes);

      res.setHeader('Content-Type', mimeType);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('X-Content-Type-Options', 'nosniff');

      if (parsedRange) {
        res.status(206);
        res.setHeader('Content-Range', `bytes ${parsedRange.start}-${parsedRange.end}/${parsedRange.totalSize}`);
        res.setHeader('Content-Length', parsedRange.chunkLength);

        const stream = await provider.getStream(safeKey, {
          start: parsedRange.start,
          end: parsedRange.end,
        });
        stream.pipe(res);
      } else {
        res.status(200);
        res.setHeader('Content-Length', metadata.sizeBytes);
        res.setHeader('Cache-Control', 'public, max-age=86400, immutable');

        const stream = await provider.getStream(safeKey);
        stream.pipe(res);
      }
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/assets/signed
   * Acceso público controlado a assets mediante URL firmada con HMAC-SHA256 y TTL
   */
  router.get('/signed', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const key = req.query['key'] as string | undefined;
      const exp = req.query['exp'] as string | undefined;
      const sig = req.query['sig'] as string | undefined;

      const secret = config.auth.jwtSecret || process.env['JWT_SECRET'] || 'cartoon-factory-local-storage-secret-key-32chars';
      verifyAssetSignature(key, exp, sig, secret);

      await streamAsset(key!, req, res, next);
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/assets/sign
   * Genera una URL firmada para un asset específico (Protegido con JWT)
   */
  router.post('/sign', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { key, expiresIn } = req.body;
      if (!key) {
        throw new StorageSecurityError('La clave del asset es requerida para firmar');
      }

      const safeKey = sanitizeStorageKey(key);
      const expiresInSec = typeof expiresIn === 'number' ? expiresIn : 3600;
      const signedUrl = await provider.getSignedUrl(safeKey, expiresInSec);
      const expiresAt = new Date(Date.now() + expiresInSec * 1000).toISOString();

      return res.json({
        success: true,
        key: safeKey,
        signedUrl,
        expiresAt,
      });
    } catch (err) {
      next(err);
      return;
    }
  });

  /**
   * POST /api/assets/upload
   * Sube un asset binario o codificado en base64 (Protegido con JWT)
   */
  router.post('/upload', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { key, data, contentType, encoding } = req.body;
      if (!key) {
        throw new StorageSecurityError('La clave del asset es obligatoria');
      }
      if (data === undefined || data === null) {
        throw new StorageSecurityError('Los datos del asset son obligatorios');
      }

      const safeKey = sanitizeStorageKey(key);

      let buffer: Buffer;
      if (Buffer.isBuffer(data)) {
        buffer = data;
      } else if (typeof data === 'string' && data.includes('base64,')) {
        const cleanBase64 = data.split('base64,')[1];
        buffer = Buffer.from(cleanBase64, 'base64');
      } else if (encoding === 'base64') {
        buffer = Buffer.from(data, 'base64');
      } else {
        buffer = Buffer.from(data);
      }

      // Límite de seguridad defensivo de 50 MB
      const MAX_SIZE = 50 * 1024 * 1024;
      if (buffer.length > MAX_SIZE) {
        throw new StorageSecurityError(`El tamaño del archivo (${(buffer.length / 1024 / 1024).toFixed(2)} MB) supera el límite permitido de 50 MB`);
      }

      const resolvedMime = contentType || lookupMimeType(safeKey);
      const publicUrl = await provider.upload(safeKey, buffer, resolvedMime);

      res.status(201).json({
        success: true,
        key: safeKey,
        url: publicUrl,
        sizeBytes: buffer.length,
        contentType: resolvedMime,
      });
      return;
    } catch (err) {
      next(err);
      return;
    }
  });

  /**
   * DELETE /api/assets/*key
   * Elimina un asset de almacenamiento (Protegido con JWT)
   */
  router.delete('/*key', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rawKey = extractKeyFromRequest(req);
      const safeKey = sanitizeStorageKey(rawKey);

      await provider.delete(safeKey);

      res.json({
        success: true,
        key: safeKey,
        message: 'Asset eliminado correctamente',
      });
      return;
    } catch (err) {
      next(err);
      return;
    }
  });

  /**
   * GET /api/assets/*key
   * Sirve directamente assets públicos con soporte para streaming y HTTP 206
   */
  router.get('/*key', async (req: Request, res: Response, next: NextFunction) => {
    const rawKey = extractKeyFromRequest(req);
    await streamAsset(rawKey, req, res, next);
  });

  return router;
}

/**
 * Instancia singleton exportada para montaje directo en el servidor Express
 */
export const storageRouter: Router = createStorageRouter();
