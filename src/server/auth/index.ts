/**
 * Phase 03 — Auth Module Public API
 * Re-exports for use across the server.
 */
export { authRouter } from './auth.router.js';
export { requireAuth, optionalAuth } from './middleware.js';
export type { AuthenticatedUser, JwtAccessPayload, JwtRefreshPayload } from './types.js';
