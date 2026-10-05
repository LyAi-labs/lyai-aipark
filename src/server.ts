import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import cookieParser from 'cookie-parser';
import { join } from 'node:path';
import { config } from './server/config';
import { logger } from './server/utils/logger';
import { errorHandler } from './server/errors';
import { db } from './server/db';
import { authRouter, requireAuth } from './server/auth';
import { aiRouter } from './server/ai';
import { storageRouter } from './server/storage';
import { voiceRouter } from './server/audio';
import { visualRouter } from './server/visuals';
import { renderRouter } from './server/render';
import { qcRouter, qcService } from './server/qc';
import { youtubeRouter } from './server/youtube';
import { schedulerRouter } from './server/scheduler';

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
app.use(express.json({ limit: '30mb' }));
app.use(cookieParser());

// ──────────────────────────────────────────────────────────────────────────────
// Auth routes — public (no requireAuth here)
// ──────────────────────────────────────────────────────────────────────────────
app.use('/api/auth', authRouter);

// Public Google OAuth 2.0 redirects
app.get('/api/youtube/callback', (req, res, next) => youtubeRouter(req, res, next));
app.get('/api/auth/google/callback', (req, res, next) => youtubeRouter(req, res, next));

// ──────────────────────────────────────────────────────────────────────────────
// Storage routes — public streaming & signed access (upload/sign/delete are guarded with requireAuth inside storageRouter)
// ──────────────────────────────────────────────────────────────────────────────
app.use('/api/assets', storageRouter);

// ──────────────────────────────────────────────────────────────────────────────
// Voice & Audio routes (catalog and test audition public; scene and batch guarded with requireAuth)
// ──────────────────────────────────────────────────────────────────────────────
app.use('/api/voice', voiceRouter);

// ──────────────────────────────────────────────────────────────────────────────
// Phase 07 — Visuals & Storyboard routes (scene, batch, character and thumbnail guarded with requireAuth)
// ──────────────────────────────────────────────────────────────────────────────
app.use('/api/visuals', visualRouter);

// ──────────────────────────────────────────────────────────────────────────────
// Phase 08 — Real Video Rendering Engine (FFmpeg Worker: 202 Accepted, SSE, jobs)
// ──────────────────────────────────────────────────────────────────────────────
app.use('/api/render', renderRouter);

// ──────────────────────────────────────────────────────────────────────────────
// Phase 09 — Objective Quality Control (Audio Drift & COPPA Checks)
// ──────────────────────────────────────────────────────────────────────────────
app.use('/api/qc', qcRouter);

// ──────────────────────────────────────────────────────────────────────────────
// Health endpoint — public (monitoring, load-balancer probes)
// ──────────────────────────────────────────────────────────────────────────────
app.get('/api/health/db', async (_req, res) => {
  try {
    await db.$queryRaw`SELECT 1`;
    return res.json({
      status: 'connected',
      database: 'PostgreSQL 16',
      orm: 'Prisma 6.4.1',
      tablesRegistered: 20,
    });
  } catch (error: any) {
    return res.status(503).json({
      status: 'disconnected',
      database: 'PostgreSQL 16',
      orm: 'Prisma 6.4.1',
      tablesRegistered: 20,
      message: 'PostgreSQL instance not reachable on configured DATABASE_URL. Start via docker compose up -d postgres.',
      error: error.message,
    });
  }
});

const angularApp = new AngularNodeAppEngine();

// ──────────────────────────────────────────────────────────────────────────────
// Phase 03 — Global Auth Guard
// All /api/* routes registered BELOW this point require a valid JWT.
// Routes mounted ABOVE (/api/auth/*, /api/health/*, /api/assets/*) are public.
// ──────────────────────────────────────────────────────────────────────────────
app.use('/api', requireAuth);

// ──────────────────────────────────────────────────────────────────────────────
// Phase 04 — Hardened AI Router (Gemini 3.8 Flash + Zod Validation + Telemetry)
// Endpoints: /generate-story, /generate-character, /quality-control, /generate-metadata, /cost-summary
// ──────────────────────────────────────────────────────────────────────────────
app.use('/api', aiRouter);

// ──────────────────────────────────────────────────────────────────────────────
// Phase 10 — Real YouTube Integration (OAuth 2.0 & Data API v3)
// Endpoints: /status, /auth-url, /publish, /disconnect, /publications/:episodeId
// ──────────────────────────────────────────────────────────────────────────────
app.use('/api/youtube', youtubeRouter);

// ──────────────────────────────────────────────────────────────────────────────
// Phase 11 — Background Scheduler & Worker Queues
// Endpoints: /status, /start, /stop, /trigger, /jobs/*, /calendar/*
// ──────────────────────────────────────────────────────────────────────────────
app.use('/api/scheduler', schedulerRouter);


/**
 * Global API Error Handling Middleware
 */
app.use(errorHandler);

/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

/**
 * Handle all other requests by rendering the Angular application.
 */
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) =>
      response ? writeResponseToNodeResponse(response, res) : next(),
    )
    .catch(next);
});

/**
 * Start the server if this module is the main entry point, or it is ran via PM2.
 */
if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = config.app.port;
  app.listen(port, (error) => {
    if (error) {
      logger.error('Failed to start Node Express server', { error: error.message });
      throw error;
    }

    logger.info(`Node Express server listening on http://localhost:${port}`, {
      env: config.app.env,
      storageDriver: config.storage.driver,
      aiConfigured: config.ai.hasApiKey
    });
  });
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);
