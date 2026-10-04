/**
 * Phase 03 — Authentication & Multi-Tenant Security
 * Shared type definitions for auth subsystem.
 */

/**
 * Payload stored inside the signed JWT access token.
 * Never includes password hash or refresh token.
 */
export interface JwtAccessPayload {
  /** User UUID from PostgreSQL `users.id` */
  sub: string;
  /** User email (informational, not used for DB lookups inside protected routes) */
  email: string;
  /** Token type discriminant */
  type: 'access';
  /** Issued-at (Unix seconds, set by jsonwebtoken) */
  iat?: number;
  /** Expiry (Unix seconds, set by jsonwebtoken) */
  exp?: number;
}

/**
 * Payload stored inside the signed JWT refresh token.
 * Stored in `user_refresh_tokens` table alongside a hash.
 */
export interface JwtRefreshPayload {
  sub: string;
  type: 'refresh';
  /** Opaque token family ID for refresh-token rotation tracking */
  familyId: string;
  iat?: number;
  exp?: number;
}

/**
 * Shape of the `req.user` property injected by `requireAuth` middleware.
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
}

/**
 * Express augmentation: adds `user` to the request object when authenticated.
 */
declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}
