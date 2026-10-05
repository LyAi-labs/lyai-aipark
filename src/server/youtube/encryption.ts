/**
 * AES-256-GCM Token Encryption Module
 * Provides authenticated encryption for OAuth access & refresh tokens at rest.
 * Uses 96-bit NIST-recommended IVs and 128-bit authentication tags.
 * Immune to nonce reuse and ciphertext tampering.
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { config } from '../config';
import { AppError } from '../errors';
import type { EncryptedOAuthCredentials, DecryptedOAuthCredentials } from './types';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits per NIST SP 800-38D
const TAG_LENGTH = 16; // 128 bits auth tag

/**
 * Derives a deterministic 32-byte (256-bit) encryption key from server auth secret.
 */
function deriveEncryptionKey(customSecret?: string): Buffer {
  const secret = customSecret || config.auth.jwtSecret || config.auth.sessionSecret || 'cartoon_studio_default_master_encryption_key_32_bytes_min';
  return createHash('sha256').update(secret).digest();
}

/**
 * Encrypts OAuth access token and optional refresh token using AES-256-GCM.
 * Generates distinct IVs for access and refresh tokens to prevent nonce-reuse attacks.
 */
export function encryptOAuthTokens(
  accessToken: string,
  refreshToken = '',
  customSecret?: string
): EncryptedOAuthCredentials {
  if (!accessToken) {
    throw new AppError('Cannot encrypt empty access token', 400, 'ENCRYPTION_ERROR');
  }

  const key = deriveEncryptionKey(customSecret);

  // Generate 24 random bytes: first 12 for access token, next 12 for refresh token
  const ivBuffer = randomBytes(IV_LENGTH * 2);
  const iv1 = ivBuffer.subarray(0, IV_LENGTH);
  const iv2 = ivBuffer.subarray(IV_LENGTH, IV_LENGTH * 2);

  // 1. Encrypt Access Token
  const cipher1 = createCipheriv(ALGORITHM, key, iv1);
  const encAccess = Buffer.concat([
    cipher1.update(accessToken, 'utf8'),
    cipher1.final(),
  ]);
  const tag1 = cipher1.getAuthTag();

  // 2. Encrypt Refresh Token (if present)
  let encRefreshString = '';
  if (refreshToken) {
    const cipher2 = createCipheriv(ALGORITHM, key, iv2);
    const encRefresh = Buffer.concat([
      cipher2.update(refreshToken, 'utf8'),
      cipher2.final(),
    ]);
    const tag2 = cipher2.getAuthTag();
    // Pack tag2 and ciphertext together: tag2(hex):ciphertext(hex)
    encRefreshString = `${tag2.toString('hex')}:${encRefresh.toString('hex')}`;
  }

  // Combined IV (48 hex chars, fits in db.VarChar(64))
  const combinedIvHex = ivBuffer.toString('hex');
  const tag1Hex = tag1.toString('hex'); // 32 hex chars

  return {
    encryptedAccessToken: `${tag1Hex}:${encAccess.toString('hex')}`,
    encryptedRefreshToken: encRefreshString,
    iv: combinedIvHex,
    authTag: tag1Hex,
  };
}

/**
 * Decrypts OAuth access token and refresh token using AES-256-GCM.
 * Throws AppError if authentication tag verification fails (detects tampering).
 */
export function decryptOAuthTokens(
  encrypted: EncryptedOAuthCredentials,
  customSecret?: string
): DecryptedOAuthCredentials {
  const key = deriveEncryptionKey(customSecret);

  if (!encrypted.iv || encrypted.iv.length !== IV_LENGTH * 4) {
    throw new AppError('Invalid IV length for token decryption', 400, 'TOKEN_DECRYPTION_FAILED');
  }

  const ivBuffer = Buffer.from(encrypted.iv, 'hex');
  const iv1 = ivBuffer.subarray(0, IV_LENGTH);
  const iv2 = ivBuffer.subarray(IV_LENGTH, IV_LENGTH * 2);

  // 1. Decrypt Access Token
  const [accessTagHex, accessCipherHex] = encrypted.encryptedAccessToken.split(':');
  if (!accessTagHex || !accessCipherHex) {
    throw new AppError('Malformed encrypted access token format', 400, 'TOKEN_DECRYPTION_FAILED');
  }

  let accessToken = '';
  try {
    const decipher1 = createDecipheriv(ALGORITHM, key, iv1);
    decipher1.setAuthTag(Buffer.from(accessTagHex, 'hex'));
    accessToken = Buffer.concat([
      decipher1.update(Buffer.from(accessCipherHex, 'hex')),
      decipher1.final(),
    ]).toString('utf8');
  } catch (err: any) {
    throw new AppError(
      `Fallo de integridad criptográfica en Access Token: ${err.message}`,
      401,
      'TOKEN_INTEGRITY_CHECK_FAILED'
    );
  }

  // 2. Decrypt Refresh Token (if present)
  let refreshToken = '';
  if (encrypted.encryptedRefreshToken) {
    const [refreshTagHex, refreshCipherHex] = encrypted.encryptedRefreshToken.split(':');
    if (refreshTagHex && refreshCipherHex) {
      try {
        const decipher2 = createDecipheriv(ALGORITHM, key, iv2);
        decipher2.setAuthTag(Buffer.from(refreshTagHex, 'hex'));
        refreshToken = Buffer.concat([
          decipher2.update(Buffer.from(refreshCipherHex, 'hex')),
          decipher2.final(),
        ]).toString('utf8');
      } catch (err: any) {
        throw new AppError(
          `Fallo de integridad criptográfica en Refresh Token: ${err.message}`,
          401,
          'TOKEN_INTEGRITY_CHECK_FAILED'
        );
      }
    }
  }

  return {
    accessToken,
    refreshToken,
  };
}
