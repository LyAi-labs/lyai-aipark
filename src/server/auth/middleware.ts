/**
 * Phase 03 — Auth Middleware
 *
 * `requireAuth`: Express middleware that enforces JWT authentication.
 * Reads the access token from the `access_token` HttpOnly cookie.
 * Falls back to `Authorization: Bearer <token>` header for API clients
 * that cannot set cookies (e.g., internal workers, CLI tools).
 *
 * On success: populates `req.user` with { id, email } and calls next().
 * On failure: returns 401 JSON response — never calls next() with an error.
 */

import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from './jwt.service.js';

// ---------------------------------------------------------------------------
// Token extraction helpers
// ---------------------------------------------------------------------------

/**
 * Reads the access token from:
 *   1. `access_token` HttpOnly cookie (preferred — XSS-resistant)
 *   2. `Authorization: Bearer <token>` header (fallback for non-browser clients)
 */
function extractToken(req: Request): string | null {
  // Priority 1: HttpOnly cookie
  const cookieToken: string | undefined = req.cookies?.['access_token'];
  if (cookieToken) return cookieToken;

  // Priority 2: Authorization header
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/**
 * Enforces authentication. Attach to any route or router that requires login.
 *
 * @example
 *   app.use('/api/v1', requireAuth, apiV1Router);
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractToken(req);

  if (!token) {
    res.status(401).json({
      error: 'UNAUTHENTICATED',
      message: 'Access token required. Provide it via cookie or Authorization header.',
    });
    return;
  }

  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, email: payload.email };
    next();
  } catch (err: unknown) {
    const isExpired =
      err instanceof Error && err.message.toLowerCase().includes('expired');
    res.status(401).json({
      error: isExpired ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID',
      message: isExpired
        ? 'Access token has expired. Refresh it via POST /api/auth/refresh.'
        : 'Access token is invalid or has been tampered with.',
    });
  }
}

/**
 * Optional variant — extracts user if token present but does not block
 * unauthenticated requests. Useful for routes with mixed public/private data.
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = extractToken(req);
  if (!token) {
    next();
    return;
  }
  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, email: payload.email };
  } catch {
    // Ignore invalid token in optional mode
  }
  next();
}
