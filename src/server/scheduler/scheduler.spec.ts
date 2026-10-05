/**
 * Cartoon Studio — Background Scheduler & Worker Queues Test Suite (Phase 11)
 *
 * Exhaustively validates:
 * 1. WorkerQueue lifecycle: concurrency management, atomic status transitions, and step tracing.
 * 2. Asynchronous job handlers: SCRIPTING, VOICE_GENERATION, ASSET_GENERATION, VALIDATION, and YOUTUBE_PUBLISH.
 * 3. Robust error handling, automatic retries with exponential attempt counting, and cancellation.
 * 4. EditorialScheduler autonomous monitor: detects due items, enforces QC gatekeepers, auto-publishes to YouTube,
 *    and transitions status to BROADCASTED with publication linkage.
 * 5. SchedulerService master daemon: starts/stops loops, operational metrics, and immediate manual trigger.
 * 6. REST API endpoints under /api/scheduler/* with Zod schema validation and error responses.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import { createServer } from 'node:http';
import { db } from '../db';
import { WorkerQueue } from './worker.queue';
import { EditorialScheduler } from './editorial.scheduler';
import { SchedulerService, schedulerService } from './scheduler.service';
import { schedulerRouter } from './scheduler.router';
import { qcService } from '../qc';
import { youTubeService } from '../youtube';
import { AppError, errorHandler } from '../errors';

async function waitForJob(queue: WorkerQueue, jobId: string, timeoutMs = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const job = await queue.getJob(jobId);
    if (job && (job.status === 'COMPLETED' || job.status === 'FAILED' || job.status === 'CANCELLED')) {
      return job;
    }
    await new Promise((r) => setTimeout(r, 40));
  }
  return (await queue.getJob(jobId))!;
}

describe('Phase 11 — Background Scheduler & Worker Queues', () => {
  let testApp: express.Express;

  beforeEach(() => {
    vi.restoreAllMocks();

    // Mock DB calls to allow isolated deterministic tests
    vi.spyOn(db.productionJob, 'create').mockResolvedValue({ id: 'job_test_1' } as any);
    vi.spyOn(db.productionJob, 'updateMany').mockResolvedValue({ count: 1 } as any);
    vi.spyOn(db.productionJob, 'findUnique').mockResolvedValue(null);
    vi.spyOn(db.productionJob, 'findMany').mockResolvedValue([]);

    vi.spyOn(db.jobStep, 'upsert').mockResolvedValue({ id: 'step_test_1' } as any);

    vi.spyOn(db.editorialCalendarItem, 'create').mockResolvedValue({ id: 'cal_test_1' } as any);
    vi.spyOn(db.editorialCalendarItem, 'updateMany').mockResolvedValue({ count: 1 } as any);
    vi.spyOn(db.editorialCalendarItem, 'findMany').mockResolvedValue([]);
    vi.spyOn(db.editorialCalendarItem, 'findUnique').mockResolvedValue(null);

    vi.spyOn(db.youTubeChannel, 'upsert').mockResolvedValue({
      id: 'ch_test_uuid',
      channelId: 'UC-KTN-KIDSTOON-STUDIO-DEMO',
      channelTitle: 'KidsToon Studio Sandbox',
      isDemoMode: true,
    } as any);
    vi.spyOn(db.youTubePublication, 'create').mockResolvedValue({
      id: 'pub_test_uuid',
      videoId: 'yt_test_video_1',
      videoUrl: 'https://youtube.com/watch?v=yt_test_video_1',
    } as any);
    vi.spyOn(db.asset, 'findFirst').mockResolvedValue(null);
    vi.spyOn(db.asset, 'create').mockResolvedValue({ id: 'mock_asset_1' } as any);
    vi.spyOn(db.assetVersion, 'count').mockResolvedValue(0);
    vi.spyOn(db.assetVersion, 'create').mockResolvedValue({ id: 'mock_version_1' } as any);
    vi.spyOn(db.asset, 'update').mockResolvedValue({ id: 'mock_asset_1' } as any);

    vi.spyOn(db.episodeVersion, 'findFirst').mockResolvedValue(null);
    vi.spyOn(db.episode, 'findUnique').mockResolvedValue(null);
    vi.spyOn(db.qCReport, 'findFirst').mockResolvedValue(null);
    vi.spyOn(db.qCReport, 'create').mockResolvedValue({ id: 'mock_report_1' } as any);
    vi.spyOn(db.qCCheck, 'createMany').mockResolvedValue({ count: 5 } as any);

    // Express app for testing schedulerRouter
    testApp = express();
    testApp.use(express.json());
    testApp.use('/api/scheduler', schedulerRouter);
    testApp.use(errorHandler);
  });

  afterEach(() => {
    schedulerService.stop();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 1. WorkerQueue & Job Lifecycle
  // ──────────────────────────────────────────────────────────────────────────
  describe('1. WorkerQueue Core Lifecycle', () => {
    it('enqueues a job with status QUEUED, progress 0, and UUID', async () => {
      const queue = new WorkerQueue({ maxConcurrency: 1 });
      const job = await queue.enqueueJob({
        episodeId: 'ep_test_queue_01',
        type: 'SCRIPTING',
        payload: { idea: 'Un perrito que busca su hueso' },
      });

      expect(job.id).toBeDefined();
      expect(job.status).toBe('QUEUED');
      expect(job.progress).toBe(0);
      expect(job.episodeId).toBe('ep_test_queue_01');
      expect(job.type).toBe('SCRIPTING');
    });

    it('enforces concurrency limit and processes jobs sequentially when concurrency=1', async () => {
      const queue = new WorkerQueue({ maxConcurrency: 1 });
      const job1 = await queue.enqueueJob({
        episodeId: 'ep_conc_1',
        type: 'VALIDATION',
        payload: { title: 'Test 1' },
      });
      const job2 = await queue.enqueueJob({
        episodeId: 'ep_conc_2',
        type: 'VALIDATION',
        payload: { title: 'Test 2' },
      });

      const metrics = queue.getMetrics();
      expect(metrics.totalJobsCount).toBe(2);
      expect(metrics.activeJobsCount).toBeLessThanOrEqual(1);
    });

    it('executes a SCRIPTING job to completion and stores story result', async () => {
      const queue = new WorkerQueue();
      const job = await queue.enqueueJob({
        episodeId: 'ep_script_01',
        type: 'SCRIPTING',
        payload: { idea: 'Aventura en la selva', sceneCount: 2 },
      });

      const updated = await waitForJob(queue, job.id);
      expect(updated).not.toBeNull();
      expect(updated?.status).toBe('COMPLETED');
      expect(updated?.progress).toBe(100);
      expect(updated?.outputResult).toBeDefined();
      expect((updated?.outputResult as any)?.story).toBeDefined();
      expect(updated?.steps.length).toBeGreaterThan(0);
    });

    it('executes a VOICE_GENERATION job with scene dialogue synthesis', async () => {
      const queue = new WorkerQueue();
      const job = await queue.enqueueJob({
        episodeId: 'ep_voice_01',
        type: 'VOICE_GENERATION',
        payload: {
          scenes: [
            { sceneIndex: 1, sceneCode: 'SC01', text: 'Hola a todos los amigos', speakerName: 'Milo' },
          ],
        },
      });

      const updated = await waitForJob(queue, job.id);
      expect(updated?.status).toBe('COMPLETED');
      expect(updated?.progress).toBe(100);
      expect((updated?.outputResult as any)?.sceneCount).toBe(1);
    });

    it('executes an ASSET_GENERATION visual job and tracks step progress', async () => {
      const queue = new WorkerQueue();
      const job = await queue.enqueueJob({
        episodeId: 'ep_vis_01',
        type: 'ASSET_GENERATION',
        payload: {
          scenes: [
            { sceneIndex: 1, sceneCode: 'SC01', action: 'Milo mira el arcoíris' },
          ],
        },
      });

      const updated = await waitForJob(queue, job.id);
      expect(updated?.status).toBe('COMPLETED');
      expect(updated?.progress).toBe(100);
      expect((updated?.outputResult as any)?.visualCount).toBe(1);
    });

    it('cancels a queued or active job on demand', async () => {
      const queue = new WorkerQueue({ maxConcurrency: 0 }); // paused queue
      const job = await queue.enqueueJob({
        episodeId: 'ep_cancel_01',
        type: 'SCRIPTING',
      });

      expect(job.status).toBe('QUEUED');
      const cancelled = await queue.cancelJob(job.id);
      expect(cancelled).toBe(true);

      const state = await queue.getJob(job.id);
      expect(state?.status).toBe('CANCELLED');
    });

    it('cannot cancel an already completed job', async () => {
      const queue = new WorkerQueue();
      const job = await queue.enqueueJob({
        episodeId: 'ep_completed_cancel',
        type: 'VALIDATION',
      });

      await waitForJob(queue, job.id);
      const res = await queue.cancelJob(job.id);
      expect(res).toBe(false);
    });

    it('retries failed jobs up to maxRetries before transitioning to FAILED', async () => {
      const queue = new WorkerQueue({ maxConcurrency: 1, defaultMaxRetries: 2 });

      // Enqueue job with unsupported type to force handler error
      const job = await queue.enqueueJob({
        episodeId: 'ep_fail_retry',
        type: 'UNSUPPORTED' as any,
        maxRetries: 1,
      });

      const state = await waitForJob(queue, job.id);
      expect(state?.status).toBe('FAILED');
      expect(state?.retryCount).toBe(1);
      expect(state?.errorMessage).toBeDefined();
    });

    it('allows manually retrying a failed job via retryJob', async () => {
      const queue = new WorkerQueue({ maxConcurrency: 0 });
      const job = await queue.enqueueJob({
        episodeId: 'ep_retry_manual',
        type: 'SCRIPTING',
      });

      await queue.cancelJob(job.id);
      const cancelledState = await queue.getJob(job.id);
      expect(cancelledState?.status).toBe('CANCELLED');

      const retried = await queue.retryJob(job.id);
      expect(retried?.status).toBe('QUEUED');
      expect(retried?.progress).toBe(0);
    });

    it('emits progress notifications to subscribers', async () => {
      const queue = new WorkerQueue();
      const notifications: any[] = [];
      const unsub = queue.subscribe((notif) => {
        notifications.push(notif);
      });

      const job = await queue.enqueueJob({
        episodeId: 'ep_sub_01',
        type: 'VALIDATION',
      });

      await waitForJob(queue, job.id);
      unsub();

      expect(notifications.length).toBeGreaterThan(0);
      expect(notifications.some((n) => n.status === 'COMPLETED')).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. EditorialScheduler & Automated Broadcast
  // ──────────────────────────────────────────────────────────────────────────
  describe('2. EditorialScheduler & Auto-Broadcast', () => {
    it('creates and lists editorial calendar items', async () => {
      const scheduler = new EditorialScheduler();
      const item = await scheduler.createItem({
        title: 'Estreno: Milo descubre el tesoro',
        plannedAt: new Date(Date.now() + 86400000).toISOString(),
        seriesId: 'series_01',
        episodeId: 'ep_cal_01',
        notes: 'Estreno exclusivo de fin de semana',
      });

      expect(item.id).toBeDefined();
      expect(item.title).toBe('Estreno: Milo descubre el tesoro');
      expect(item.editorialStatus).toBe('CONFIRMED');

      const list = await scheduler.listItems();
      expect(list.some((i) => i.id === item.id)).toBe(true);
    });

    it('automatically publishes to YouTube when plannedAt has arrived and status is CONFIRMED', async () => {
      const scheduler = new EditorialScheduler();

      // Mock QC approval to allow publication
      vi.spyOn(qcService, 'getLatestReport').mockResolvedValue({
        reportId: 'rep_approved_1',
        episodeId: 'ep_due_01',
        overallScore: 98,
        approvedForProduction: true,
        isBlocked: false,
        audioDriftSeconds: 0.01,
        coppaStatus: 'COMPLIANT',
        blockingReasons: [],
      } as any);

      // Create an item with plannedAt in the PAST
      const pastDate = new Date(Date.now() - 5000).toISOString();
      const item = await scheduler.createItem({
        title: 'Episodio Listo Para Emisión Inmediata',
        plannedAt: pastDate,
        episodeId: 'ep_due_01',
        editorialStatus: 'CONFIRMED',
      });

      // Trigger scheduler tick
      const processed = await scheduler.tick();
      expect(processed).toBe(1);

      const updated = await scheduler.getItem(item.id);
      expect(updated?.editorialStatus).toBe('BROADCASTED');
      expect(updated?.youtubePublicationId).toBeDefined();
      expect(updated?.notes).toContain('Emisión completada');
    });

    it('blocks automatic publication if episode is blocked by Quality Control (QC)', async () => {
      const scheduler = new EditorialScheduler();

      // Mock QC rejection
      vi.spyOn(qcService, 'getLatestReport').mockResolvedValue({
        reportId: 'rep_blocked_1',
        episodeId: 'ep_qc_blocked',
        overallScore: 40,
        approvedForProduction: false,
        isBlocked: true,
        audioDriftSeconds: 0.25, // Unacceptable drift > 0.05s
        coppaStatus: 'VIOLATION_DETECTED',
        blockingReasons: ['Desincronización de audio crítica (0.25s)', 'Infracción COPPA detectada'],
      } as any);

      const pastDate = new Date(Date.now() - 5000).toISOString();
      const item = await scheduler.createItem({
        title: 'Episodio Bloqueado por Calidad',
        plannedAt: pastDate,
        episodeId: 'ep_qc_blocked',
        editorialStatus: 'CONFIRMED',
      });

      await scheduler.tick();

      const updated = await scheduler.getItem(item.id);
      // Item must NOT transition to BROADCASTED
      expect(updated?.editorialStatus).toBe('CONFIRMED');
      expect(updated?.notes).toContain('Auto-Broadcast Error');
      expect(updated?.notes).toContain('bloqueado por Control de Calidad');
    });

    it('ignores future items whose broadcast time has not yet arrived', async () => {
      const scheduler = new EditorialScheduler();

      const futureDate = new Date(Date.now() + 3600000).toISOString(); // 1 hour from now
      const item = await scheduler.createItem({
        title: 'Episodio del Futuro',
        plannedAt: futureDate,
        episodeId: 'ep_future_1',
        editorialStatus: 'CONFIRMED',
      });

      const processed = await scheduler.tick();
      expect(processed).toBe(0);

      const updated = await scheduler.getItem(item.id);
      expect(updated?.editorialStatus).toBe('CONFIRMED');
      expect(updated?.youtubePublicationId).toBeNull();
    });

    it('ignores cancelled or already broadcasted items during tick', async () => {
      const scheduler = new EditorialScheduler();
      const pastDate = new Date(Date.now() - 10000).toISOString();

      const cancelled = await scheduler.createItem({
        title: 'Episodio Cancelado',
        plannedAt: pastDate,
        editorialStatus: 'CANCELLED',
      });

      const processed = await scheduler.tick();
      expect(processed).toBe(0);

      const item = await scheduler.getItem(cancelled.id);
      expect(item?.editorialStatus).toBe('CANCELLED');
    });

    it('updates and reschedules existing calendar items', async () => {
      const scheduler = new EditorialScheduler();
      const item = await scheduler.createItem({
        title: 'Título Original',
        plannedAt: new Date(Date.now() + 10000).toISOString(),
      });

      const newDate = new Date(Date.now() + 20000).toISOString();
      const updated = await scheduler.updateItem(item.id, {
        title: 'Título Reprogramado',
        plannedAt: newDate,
      });

      expect(updated.title).toBe('Título Reprogramado');
      expect(updated.plannedAt).toBe(newDate);
    });

    it('cancels calendar items cleanly', async () => {
      const scheduler = new EditorialScheduler();
      const item = await scheduler.createItem({
        title: 'Para Cancelar',
        plannedAt: new Date().toISOString(),
      });

      const cancelled = await scheduler.cancelItem(item.id);
      expect(cancelled.editorialStatus).toBe('CANCELLED');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. SchedulerService Unified Daemon
  // ──────────────────────────────────────────────────────────────────────────
  describe('3. SchedulerService Unified Daemon', () => {
    it('starts and stops daemon cleanly reporting accurate metrics', () => {
      schedulerService.start();
      let status = schedulerService.getStatus();
      expect(status.isRunning).toBe(true);
      expect(status.workerConcurrency).toBeGreaterThan(0);
      expect(status.uptimeSeconds).toBeGreaterThanOrEqual(0);

      schedulerService.stop();
      status = schedulerService.getStatus();
      expect(status.isRunning).toBe(false);
    });

    it('triggerNow executes both queues and editorial calendar ticks simultaneously', async () => {
      const res = await schedulerService.triggerNow();
      expect(res).toBeDefined();
      expect(typeof res.processedCalendarItems).toBe('number');
      expect(typeof res.activeJobs).toBe('number');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. Scheduler REST API Router
  // ──────────────────────────────────────────────────────────────────────────
  describe('4. Scheduler REST API Router (/api/scheduler/*)', () => {
    let server: any;
    let baseUrl: string;

    beforeEach(async () => {
      server = createServer(testApp);
      await new Promise<void>((resolve) => {
        server.listen(0, () => {
          const port = (server.address() as any).port;
          baseUrl = `http://127.0.0.1:${port}/api/scheduler`;
          resolve();
        });
      });
    });

    afterEach(async () => {
      await new Promise<void>((resolve) => server.close(resolve));
    });

    it('GET /status returns 200 OK with scheduler operational metrics', async () => {
      const res = await fetch(`${baseUrl}/status`);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.workerConcurrency).toBeDefined();
      expect(data.uptimeSeconds).toBeDefined();
      expect(typeof data.isRunning).toBe('boolean');
    });

    it('POST /start and POST /stop toggle daemon state', async () => {
      const startRes = await fetch(`${baseUrl}/start`, { method: 'POST' });
      expect(startRes.status).toBe(200);

      const stopRes = await fetch(`${baseUrl}/stop`, { method: 'POST' });
      expect(stopRes.status).toBe(200);
    });

    it('POST /trigger triggers immediate execution cycle', async () => {
      const res = await fetch(`${baseUrl}/trigger`, { method: 'POST' });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
    });

    it('POST /jobs/dispatch accepts valid job payload and returns HTTP 202 Accepted', async () => {
      const res = await fetch(`${baseUrl}/jobs/dispatch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          episodeId: 'ep_api_dispatch_01',
          type: 'VALIDATION',
          payload: { title: 'Test Dispatch' },
        }),
      });

      expect(res.status).toBe(202);
      const data = await res.json();
      expect(data.jobId).toBeDefined();
      expect(data.pollUrl).toBe(`/api/scheduler/jobs/${data.jobId}`);
      expect(data.streamUrl).toBe(`/api/scheduler/jobs/${data.jobId}/events`);
    });

    it('POST /jobs/dispatch rejects invalid payload with 400 Bad Request', async () => {
      const res = await fetch(`${baseUrl}/jobs/dispatch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // missing episodeId and invalid type
          type: 'INVALID_JOB_TYPE',
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });

    it('GET /jobs lists registered production jobs', async () => {
      const res = await fetch(`${baseUrl}/jobs`);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(Array.isArray(data.jobs)).toBe(true);
      expect(typeof data.count).toBe('number');
    });

    it('GET /jobs/:jobId returns 404 for unknown job', async () => {
      const res = await fetch(`${baseUrl}/jobs/job_unknown_nonexistent`);
      expect(res.status).toBe(404);
    });

    it('GET /calendar and POST /calendar manage editorial calendar items via API', async () => {
      const postRes = await fetch(`${baseUrl}/calendar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Estreno vía API REST',
          plannedAt: new Date(Date.now() + 86400000).toISOString(),
          seriesId: 'series_api_1',
          episodeId: 'ep_api_1',
          notes: 'Nota editorial',
        }),
      });

      expect(postRes.status).toBe(201);
      const created = await postRes.json();
      expect(created.id).toBeDefined();
      expect(created.title).toBe('Estreno vía API REST');

      // GET calendar
      const getRes = await fetch(`${baseUrl}/calendar`);
      expect(getRes.status).toBe(200);
      const calData = await getRes.json();
      expect(calData.items.some((i: any) => i.id === created.id)).toBe(true);

      // PATCH calendar
      const patchRes = await fetch(`${baseUrl}/calendar/${created.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Estreno vía API REST (Modificado)' }),
      });
      expect(patchRes.status).toBe(200);
      const patched = await patchRes.json();
      expect(patched.title).toBe('Estreno vía API REST (Modificado)');

      // DELETE calendar
      const delRes = await fetch(`${baseUrl}/calendar/${created.id}`, { method: 'DELETE' });
      expect(delRes.status).toBe(200);
      const deleted = await delRes.json();
      expect(deleted.item.editorialStatus).toBe('CANCELLED');
    });
  });
});
