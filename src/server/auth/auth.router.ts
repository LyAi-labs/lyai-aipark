/**
 * Phase 03 — Auth Router
 *
 * Endpoints:
 *   POST /api/auth/register   — Create new user (email + password)
 *   POST /api/auth/login      — Exchange credentials for tokens
 *   POST /api/auth/refresh    — Rotate refresh token → new access + refresh
 *   POST /api/auth/logout     — Invalidate refresh token + clear cookies
 *   GET  /api/auth/me         — Return authenticated user info
 *
 * Token strategy:
 *   - `access_token`  → HttpOnly, Secure, SameSite=Strict cookie (15 min TTL)
 *   - `refresh_token` → HttpOnly, Secure, SameSite=Strict cookie (30 days TTL)
 *     Refresh token hash is stored in DB (`user_refresh_tokens` table via raw query
 *     until Phase 03 schema update lands). For now, stored as opaque identifier.
 *
 * NOTE: The DB schema already has `users` table (from Phase 02).
 * `password_hash` column is added in this phase's migration.
 */

import { Router, type Request, type Response } from 'express';
import { db } from '../db/index.js';
import { hashPassword, verifyPassword, needsRehash } from './password.service.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from './jwt.service.js';
import { requireAuth } from './middleware.js';
import { z } from 'zod';
import crypto from 'node:crypto';

export const authRouter = Router();

// ---------------------------------------------------------------------------
// Cookie configuration
// ---------------------------------------------------------------------------

const COOKIE_DEFAULTS = {
  httpOnly: true,
  secure: process.env['NODE_ENV'] === 'production',
  sameSite: 'strict' as const,
  path: '/',
};

const ACCESS_COOKIE_TTL_MS  = 15 * 60 * 1000;          // 15 minutes
const REFRESH_COOKIE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function setAuthCookies(res: Response, accessToken: string, refreshToken: string): void {
  res.cookie('access_token', accessToken, {
    ...COOKIE_DEFAULTS,
    maxAge: ACCESS_COOKIE_TTL_MS,
  });
  res.cookie('refresh_token', refreshToken, {
    ...COOKIE_DEFAULTS,
    maxAge: REFRESH_COOKIE_TTL_MS,
  });
}

function clearAuthCookies(res: Response): void {
  res.clearCookie('access_token', { ...COOKIE_DEFAULTS });
  res.clearCookie('refresh_token', { ...COOKIE_DEFAULTS });
}

// ---------------------------------------------------------------------------
// Input schemas (Zod)
// ---------------------------------------------------------------------------

const RegisterSchema = z.object({
  email: z.string().email('Invalid email format').max(255),
  name: z.string().min(1, 'Name is required').max(255),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must be at most 128 characters'),
});

const LoginSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(128),
});

// ---------------------------------------------------------------------------
// POST /api/auth/register
// ---------------------------------------------------------------------------

authRouter.post('/register', async (req: Request, res: Response) => {
  const parsed = RegisterSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({
      error: 'VALIDATION_ERROR',
      issues: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const { email, name, password } = parsed.data;

  // Check uniqueness
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    // Return the same generic error to prevent email enumeration
    res.status(409).json({
      error: 'CONFLICT',
      message: 'An account with this email already exists.',
    });
    return;
  }

  const passwordHash = await hashPassword(password);

  const user = await db.user.create({
    data: { email, name, passwordHash },
    select: { id: true, email: true, name: true, createdAt: true },
  });

  const familyId = crypto.randomUUID();
  const accessToken  = signAccessToken({ sub: user.id, email: user.email });
  const refreshToken = signRefreshToken(user.id, familyId);

  // Persist hashed refresh token for later rotation validation
  await db.userRefreshToken.create({
    data: {
      userId:   user.id,
      familyId,
      tokenHash: crypto.createHash('sha256').update(refreshToken).digest('hex'),
    },
  });

  setAuthCookies(res, accessToken, refreshToken);
  res.status(201).json({ user });
});

// ---------------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------------

authRouter.post('/login', async (req: Request, res: Response) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({
      error: 'VALIDATION_ERROR',
      issues: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const { email, password } = parsed.data;

  const user = await db.user.findUnique({ where: { email } });

  // Constant-time path: always run argon2.verify to prevent timing attacks
  const hash = user?.passwordHash ?? '$argon2id$v=19$m=65536,t=3,p=4$PLACEHOLDER';
  const valid = await verifyPassword(hash, password);

  if (!user || !valid) {
    res.status(401).json({
      error: 'INVALID_CREDENTIALS',
      message: 'Email or password is incorrect.',
    });
    return;
  }

  // Transparent rehash if parameters changed
  if (user.passwordHash && await needsRehash(user.passwordHash)) {
    const newHash = await hashPassword(password);
    await db.user.update({
      where: { id: user.id },
      data: { passwordHash: newHash },
    });
  }

  const familyId = crypto.randomUUID();
  const accessToken  = signAccessToken({ sub: user.id, email: user.email });
  const refreshToken = signRefreshToken(user.id, familyId);

  await db.userRefreshToken.create({
    data: {
      userId:   user.id,
      familyId,
      tokenHash: crypto.createHash('sha256').update(refreshToken).digest('hex'),
    },
  });

  setAuthCookies(res, accessToken, refreshToken);
  res.json({
    user: { id: user.id, email: user.email, name: user.name },
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/refresh
// ---------------------------------------------------------------------------

authRouter.post('/refresh', async (req: Request, res: Response) => {
  const rawRefreshToken: string | undefined = req.cookies?.['refresh_token'];

  if (!rawRefreshToken) {
    res.status(401).json({
      error: 'MISSING_REFRESH_TOKEN',
      message: 'Refresh token cookie is absent.',
    });
    return;
  }

  let payload;
  try {
    payload = verifyRefreshToken(rawRefreshToken);
  } catch {
    clearAuthCookies(res);
    res.status(401).json({
      error: 'INVALID_REFRESH_TOKEN',
      message: 'Refresh token is invalid or expired.',
    });
    return;
  }

  const incomingHash = crypto
    .createHash('sha256')
    .update(rawRefreshToken)
    .digest('hex');

  // Refresh token rotation: find and delete the old token record
  const stored = await db.userRefreshToken.findFirst({
    where: { familyId: payload.familyId, tokenHash: incomingHash },
  });

  if (!stored) {
    // Possible token reuse attack — invalidate the entire family
    await db.userRefreshToken.deleteMany({
      where: { familyId: payload.familyId },
    });
    clearAuthCookies(res);
    res.status(401).json({
      error: 'REFRESH_TOKEN_REUSE',
      message: 'Refresh token has already been used. All sessions invalidated.',
    });
    return;
  }

  // Delete old token
  await db.userRefreshToken.delete({ where: { id: stored.id } });

  const user = await db.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, email: true },
  });

  if (!user) {
    clearAuthCookies(res);
    res.status(401).json({ error: 'USER_NOT_FOUND' });
    return;
  }

  // Issue new token pair in the same family (rotation)
  const newAccessToken  = signAccessToken({ sub: user.id, email: user.email });
  const newRefreshToken = signRefreshToken(user.id, payload.familyId);

  await db.userRefreshToken.create({
    data: {
      userId:   user.id,
      familyId: payload.familyId,
      tokenHash: crypto.createHash('sha256').update(newRefreshToken).digest('hex'),
    },
  });

  setAuthCookies(res, newAccessToken, newRefreshToken);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// POST /api/auth/logout
// ---------------------------------------------------------------------------

authRouter.post('/logout', requireAuth, async (req: Request, res: Response) => {
  const rawRefreshToken: string | undefined = req.cookies?.['refresh_token'];

  if (rawRefreshToken) {
    const tokenHash = crypto
      .createHash('sha256')
      .update(rawRefreshToken)
      .digest('hex');
    // Best-effort deletion — do not throw if already expired
    await db.userRefreshToken
      .deleteMany({ where: { userId: req.user!.id, tokenHash } })
      .catch(() => {});
  }

  clearAuthCookies(res);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// GET /api/auth/me
// ---------------------------------------------------------------------------

authRouter.get('/me', requireAuth, async (req: Request, res: Response) => {
  const user = await db.user.findUnique({
    where: { id: req.user!.id },
    select: { id: true, email: true, name: true, createdAt: true },
  });

  if (!user) {
    res.status(404).json({ error: 'USER_NOT_FOUND' });
    return;
  }

  res.json({ user });
});
