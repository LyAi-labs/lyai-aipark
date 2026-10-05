import { createHmac, timingSafeEqual } from 'node:crypto';
import { StorageSignatureError } from './storage.errors';

export interface SignAssetOptions {
  key: string;
  secret: string;
  expiresInSeconds?: number;
  baseUrl?: string;
}

/**
 * Genera una URL firmada con HMAC-SHA256 y marca de tiempo UNIX de expiración.
 *
 * Formato canónico:
 * `${baseUrl}?key=${encodeURIComponent(key)}&exp=${exp}&sig=${sig}`
 */
export function signAssetUrl({
  key,
  secret,
  expiresInSeconds = 3600,
  baseUrl = '/api/assets/signed',
}: SignAssetOptions): string {
  if (!key) {
    throw new Error('La clave del asset es requerida para firmar');
  }

  if (!secret || secret.length < 16) {
    throw new Error('La clave secreta para firmar URLs de almacenamiento debe tener al menos 16 caracteres');
  }

  const exp = Math.floor(Date.now() / 1000) + Math.max(1, expiresInSeconds);
  const payload = `${key}:${exp}`;
  const sig = createHmac('sha256', secret).update(payload).digest('hex');

  const cleanBase = baseUrl.replace(/\/$/, '');
  return `${cleanBase}?key=${encodeURIComponent(key)}&exp=${exp}&sig=${sig}`;
}

/**
 * Valida la firma criptográfica HMAC-SHA256 y verifica que no haya expirado.
 * Implementa comparación segura en tiempo constante contra ataques de canal lateral (timing attacks).
 *
 * @throws StorageSignatureError si la firma es inválida, expirada o faltan parámetros
 */
export function verifyAssetSignature(
  key: string | undefined,
  expStr: string | undefined,
  sig: string | undefined,
  secret: string
): void {
  if (!key || !expStr || !sig) {
    throw new StorageSignatureError('Parámetros de firma ausentes en la solicitud');
  }

  const exp = parseInt(expStr, 10);
  if (isNaN(exp) || exp <= 0) {
    throw new StorageSignatureError('Timestamp de expiración no válido');
  }

  const now = Math.floor(Date.now() / 1000);
  if (now > exp) {
    throw new StorageSignatureError('La URL firmada ha expirado');
  }

  const payload = `${key}:${exp}`;
  const expectedSigHex = createHmac('sha256', secret).update(payload).digest('hex');

  const sigBuf = Buffer.from(sig, 'hex');
  const expectedBuf = Buffer.from(expectedSigHex, 'hex');

  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    throw new StorageSignatureError('Firma criptográfica inválida o manipulada');
  }
}
