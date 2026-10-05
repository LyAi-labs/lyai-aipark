/**
 * Cartoon Studio — Scheduler & Worker Router (Phase 11)
 * Express REST API endpoints for job queue management, SSE telemetry, and editorial calendar automation.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { schedulerService } from './scheduler.service';
import { ValidationError, NotFoundError } from '../errors';
import { JobType, EditorialStatus } from '@prisma/client';
import { JobProgressNotification } from './types';

export const schedulerRouter: Router = Router();

const DispatchJobSchema = z.object({
  episodeId: z.string().min(1, 'El ID de episodio es obligatorio'),
  type: z.nativeEnum(JobType),
  payload: z.record(z.string(), z.unknown()).optional(),
  maxRetries: z.number().int().min(0).max(5).optional(),
});

const CreateCalendarSchema = z.object({
  title: z.string().min(1, 'El título es obligatorio').max(255),
  plannedAt: z.string().refine((val) => !isNaN(Date.parse(val)), 'Fecha de emisión ISO inválida'),
  seriesId: z.string().optional(),
  episodeId: z.string().optional(),
  timezone: z.string().optional(),
  editorialStatus: z.nativeEnum(EditorialStatus).optional(),
  notes: z.string().optional(),
  privacyStatus: z.enum(['PRIVATE', 'PUBLIC']).optional(),
});

const UpdateCalendarSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  plannedAt: z.string().refine((val) => !isNaN(Date.parse(val)), 'Fecha de emisión ISO inválida').optional(),
  timezone: z.string().optional(),
  editorialStatus: z.nativeEnum(EditorialStatus).optional(),
  notes: z.string().optional(),
  privacyStatus: z.enum(['PRIVATE', 'PUBLIC']).optional(),
});

// ──────────────────────────────────────────────────────────────────────────────
// Daemon Control & Status
// ──────────────────────────────────────────────────────────────────────────────

schedulerRouter.get('/status', (_req: Request, res: Response) => {
  const status = schedulerService.getStatus();
  return res.json(status);
});

schedulerRouter.post('/start', (_req: Request, res: Response) => {
  schedulerService.start();
  return res.json({ success: true, message: 'Scheduler background daemon started' });
});

schedulerRouter.post('/stop', (_req: Request, res: Response) => {
  schedulerService.stop();
  return res.json({ success: true, message: 'Scheduler background daemon stopped' });
});

schedulerRouter.post('/trigger', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await schedulerService.triggerNow();
    return res.json({
      success: true,
      message: 'Trigger executed successfully',
      ...result,
    });
  } catch (error) {
    return next(error);
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// Worker Jobs Management
// ──────────────────────────────────────────────────────────────────────────────

schedulerRouter.post('/jobs/dispatch', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parseResult = DispatchJobSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw new ValidationError(`Parámetros de despacho de trabajo inválidos: ${JSON.stringify(parseResult.error.format())}`);
    }

    const { episodeId, type, payload, maxRetries } = parseResult.data;
    const userId = (req as any).user?.sub;

    const job = await schedulerService.enqueueJob({
      episodeId,
      type,
      payload: { ...payload, userId },
      maxRetries,
    });

    return res.status(202).json({
      jobId: job.id,
      episodeId: job.episodeId,
      type: job.type,
      status: job.status,
      stepDescription: job.stepDescription,
      pollUrl: `/api/scheduler/jobs/${job.id}`,
      streamUrl: `/api/scheduler/jobs/${job.id}/events`,
    });
  } catch (error) {
    return next(error);
  }
});

schedulerRouter.get('/jobs', (req: Request, res: Response) => {
  const { status, type, episodeId, limit, offset } = req.query;

  const jobs = schedulerService.listJobs({
    status: status ? (String(status) as any) : undefined,
    type: type ? (String(type) as any) : undefined,
    episodeId: episodeId ? String(episodeId) : undefined,
    limit: limit ? parseInt(String(limit), 10) : undefined,
    offset: offset ? parseInt(String(offset), 10) : undefined,
  });

  return res.json({ jobs, count: jobs.length });
});

schedulerRouter.get('/jobs/:jobId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const jobId = String(req.params['jobId'] ?? '');
    const job = await schedulerService.getJob(jobId);
    if (!job) {
      throw new NotFoundError(`Trabajo [${jobId}] no encontrado`);
    }
    return res.json(job);
  } catch (error) {
    return next(error);
  }
});

schedulerRouter.post('/jobs/:jobId/cancel', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const jobId = String(req.params['jobId'] ?? '');
    const cancelled = await schedulerService.cancelJob(jobId);
    if (!cancelled) {
      throw new ValidationError(`El trabajo [${jobId}] no puede cancelarse en su estado actual`);
    }
    return res.json({ success: true, jobId, message: 'Trabajo cancelado correctamente' });
  } catch (error) {
    return next(error);
  }
});

schedulerRouter.post('/jobs/:jobId/retry', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const jobId = String(req.params['jobId'] ?? '');
    const retried = await schedulerService.retryJob(jobId);
    if (!retried) {
      throw new NotFoundError(`Trabajo [${jobId}] no encontrado`);
    }
    return res.json(retried);
  } catch (error) {
    return next(error);
  }
});

schedulerRouter.get('/jobs/:jobId/events', async (req: Request, res: Response) => {
  const jobId = String(req.params['jobId'] ?? '');

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const currentJob = await schedulerService.getJob(jobId);
  if (currentJob) {
    res.write(`data: ${JSON.stringify(currentJob)}\n\n`);
  }

  const unsubscribe = schedulerService.getQueue().subscribe((notification: JobProgressNotification) => {
    if (notification.jobId === jobId) {
      res.write(`data: ${JSON.stringify(notification)}\n\n`);
      if (notification.status === 'COMPLETED' || notification.status === 'FAILED' || notification.status === 'CANCELLED') {
        res.end();
      }
    }
  });

  req.on('close', () => {
    unsubscribe();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Editorial Calendar Endpoints
// ──────────────────────────────────────────────────────────────────────────────

schedulerRouter.get('/calendar', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const seriesId = req.query['seriesId'] ? String(req.query['seriesId']) : undefined;
    const items = await schedulerService.listCalendarItems(seriesId);
    return res.json({ items, count: items.length });
  } catch (error) {
    return next(error);
  }
});

schedulerRouter.post('/calendar', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parseResult = CreateCalendarSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw new ValidationError(`Parámetros de elemento de calendario inválidos: ${JSON.stringify(parseResult.error.format())}`);
    }

    const item = await schedulerService.createCalendarItem(parseResult.data as any);
    return res.status(201).json(item);
  } catch (error) {
    return next(error);
  }
});

schedulerRouter.get('/calendar/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = String(req.params['id'] ?? '');
    const item = await schedulerService.getCalendarItem(id);
    if (!item) {
      throw new NotFoundError(`Elemento de calendario [${id}] no encontrado`);
    }
    return res.json(item);
  } catch (error) {
    return next(error);
  }
});

schedulerRouter.patch('/calendar/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = String(req.params['id'] ?? '');
    const parseResult = UpdateCalendarSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw new ValidationError(`Parámetros de actualización inválidos: ${JSON.stringify(parseResult.error.format())}`);
    }

    const item = await schedulerService.updateCalendarItem(id, parseResult.data as any);
    return res.json(item);
  } catch (error) {
    return next(error);
  }
});

schedulerRouter.delete('/calendar/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = String(req.params['id'] ?? '');
    const cancelled = await schedulerService.cancelCalendarItem(id);
    return res.json({ success: true, item: cancelled });
  } catch (error) {
    return next(error);
  }
});
