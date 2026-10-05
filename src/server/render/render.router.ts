/**
 * Cartoon Studio — Video Render REST API Router
 * Phase 08: Real Video Rendering Engine (FFmpeg Worker)
 *
 * Implements non-blocking 202 Accepted job dispatch, polling, SSE event streaming,
 * and cancellation endpoints.
 */

import { Router, Request, Response } from 'express';
import { renderService } from './render.service';
import { checkFfmpegAvailability } from './ffmpeg.wrapper';
import { CancelRenderRequestSchema, StartRenderRequestSchema } from './render.types';
import { ValidationError, NotFoundError } from '../errors';
import { requireAuth } from '../auth';

export const renderRouter = Router();

/**
 * GET /api/render/capabilities
 * Health & capabilities probe for FFmpeg on the host system.
 */
renderRouter.get('/capabilities', (_req: Request, res: Response) => {
  const capabilities = checkFfmpegAvailability();
  res.json({
    success: true,
    capabilities,
  });
});

// All mutative / job endpoints require authentication
renderRouter.use(requireAuth);

/**
 * POST /api/render/start
 * Dispatches an asynchronous video rendering pipeline (HTTP 202 Accepted).
 */
renderRouter.post('/start', async (req: Request, res: Response) => {
  const parseResult = StartRenderRequestSchema.safeParse(req.body);
  if (!parseResult.success) {
    throw new ValidationError('Parámetros de renderizado inválidos');
  }

  const userId = (req as any).user?.id;
  const dispatch = await renderService.startRender(parseResult.data, userId);

  return res.status(202).json({
    success: true,
    message: 'Trabajo de renderizado encolado en el Worker FFmpeg',
    ...dispatch,
  });
});

/**
 * GET /api/render/jobs/:jobId
 * Polling endpoint for job state and completion result.
 */
renderRouter.get('/jobs/:jobId', (req: Request, res: Response) => {
  const jobId = Array.isArray(req.params['jobId']) ? req.params['jobId'][0] : req.params['jobId'];
  const job = renderService.getJobState(jobId);

  if (!job) {
    throw new NotFoundError(`Trabajo de renderizado con ID [${jobId}] no encontrado`);
  }

  return res.json({
    success: true,
    job,
  });
});

/**
 * GET /api/render/jobs/:jobId/events
 * Server-Sent Events (SSE) stream for real-time progress updates.
 */
renderRouter.get('/jobs/:jobId/events', (req: Request, res: Response) => {
  const jobId = Array.isArray(req.params['jobId']) ? req.params['jobId'][0] : req.params['jobId'];
  const job = renderService.getJobState(jobId);

  if (!job) {
    throw new NotFoundError(`Trabajo de renderizado con ID [${jobId}] no encontrado`);
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  // Send initial state immediately
  res.write(`data: ${JSON.stringify({
    jobId: job.jobId,
    status: job.status,
    progress: job.progress,
    stepDescription: job.stepDescription,
    result: job.result,
  })}\n\n`);

  const unsubscribe = renderService.subscribeToJob(jobId, (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);

    if (event.status === 'COMPLETED' || event.status === 'FAILED' || event.status === 'CANCELLED') {
      res.end();
    }
  });

  // Keep-alive heartbeat every 15 seconds
  const heartbeat = setInterval(() => {
    res.write(': keep-alive\n\n');
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

/**
 * POST /api/render/jobs/:jobId/cancel
 * Aborts an active rendering job.
 */
renderRouter.post('/jobs/:jobId/cancel', async (req: Request, res: Response) => {
  const jobId = Array.isArray(req.params['jobId']) ? req.params['jobId'][0] : req.params['jobId'];
  const cancelled = await renderService.cancelJob(jobId);

  if (!cancelled) {
    return res.status(400).json({
      success: false,
      message: `No se pudo cancelar el trabajo [${jobId}]: no existe o ya ha finalizado.`,
    });
  }

  return res.json({
    success: true,
    message: `Trabajo [${jobId}] cancelado con éxito.`,
  });
});
