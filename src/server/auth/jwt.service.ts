/**
 * Phase 03 — JWT Service
 * Thin wrapper over `jsonwebtoken` for signing and verifying
 * access and refresh tokens. All secrets resolved from config.
 */

import jwt from 'jsonwebtoken';
import type { JwtAccessPayload, JwtRefreshPayload } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL = '30d';

// ---------------------------------------------------------------------------
// Helpers — resolve secrets at call-time (not module-load-time)
// to avoid circular imports with config singleton.
// ---------------------------------------------------------------------------

function jwtSecret(): string {
  const secret = process.env['JWT_SECRET'];
  if (!secret || secret.length < 32) {
    throw new Error(
      'JWT_SECRET is missing or too short (min 32 chars). Set it in .env'
    );
  }
  return secret;
}

// ---------------------------------------------------------------------------
// Access Token
// ---------------------------------------------------------------------------

export function signAccessToken(payload: Omit<JwtAccessPayload, 'type'>): string {
  return jwt.sign(
    { ...payload, type: 'access' } satisfies JwtAccessPayload,
    jwtSecret(),
    { expiresIn: ACCESS_TOKEN_TTL, algorithm: 'HS256' }
  );
}

export function verifyAccessToken(token: string): JwtAccessPayload {
  const decoded = jwt.verify(token, jwtSecret(), { algorithms: ['HS256'] });
  const payload = decoded as JwtAccessPayload;
  if (payload.type !== 'access') {
    throw new Error('Invalid token type: expected access token');
  }
  return payload;
}

// ---------------------------------------------------------------------------
// Refresh Token
// ---------------------------------------------------------------------------

export function signRefreshToken(
  sub: string,
  familyId: string
): string {
  const payload: JwtRefreshPayload = { sub, type: 'refresh', familyId };
  return jwt.sign(payload, jwtSecret(), {
    expiresIn: REFRESH_TOKEN_TTL,
    algorithm: 'HS256',
  });
}

export function verifyRefreshToken(token: string): JwtRefreshPayload {
  const decoded = jwt.verify(token, jwtSecret(), { algorithms: ['HS256'] });
  const payload = decoded as JwtRefreshPayload;
  if (payload.type !== 'refresh') {
    throw new Error('Invalid token type: expected refresh token');
  }
  return payload;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Decode without verification — for logging/debugging only */
export function decodeTokenUnsafe(token: string): unknown {
  return jwt.decode(token);
}
