/**
 * Cartoon Studio — Asynchronous Worker Queue (Phase 11)
 * PostgreSQL-backed, resilient background job processing engine.
 * Supports concurrency limits, atomic status transitions, step tracing, retries, and cancellation.
 */

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { JobType, JobStatus, StepStatus } from '@prisma/client';
import {
  EnqueueJobInput,
  JobFilter,
  JobExecutionContext,
  ProductionJobState,
  JobStepDetail,
  JobProgressNotification,
} from './types';
import { JOB_HANDLERS } from './job.handlers';
import { db } from '../db';
import { logger } from '../utils/logger';
import { AppError } from '../errors';

export interface WorkerQueueOptions {
  maxConcurrency?: number;
  defaultMaxRetries?: number;
  jobTimeoutMs?: number;
}

export class WorkerQueue extends EventEmitter {
  private jobs = new Map<string, ProductionJobState>();
  private activeControllers = new Map<string, AbortController>();
  private activeJobsCount = 0;
  private maxConcurrency: number;
  private defaultMaxRetries: number;
  private jobTimeoutMs: number;
  private isProcessingLoop = false;

  constructor(options: WorkerQueueOptions = {}) {
    super();
    this.maxConcurrency = options.maxConcurrency ?? 2;
    this.defaultMaxRetries = options.defaultMaxRetries ?? 2;
    this.jobTimeoutMs = options.jobTimeoutMs ?? 300000; // 5 minutes default timeout
    this.setMaxListeners(100);
  }

  /**
   * Enqueues a new production job.
   */
  public async enqueueJob(input: EnqueueJobInput): Promise<ProductionJobState> {
    const jobId = randomUUID();
    const now = new Date().toISOString();

    const jobState: ProductionJobState = {
      id: jobId,
      episodeId: input.episodeId,
      episodeVersionId: input.episodeVersionId || null,
      type: input.type,
      status: 'QUEUED',
      progress: 0,
      stepDescription: `Trabajo de tipo ${input.type} encolado para episodio [${input.episodeId}].`,
      errorMessage: null,
      errorDetails: null,
      steps: [],
      payload: input.payload || {},
      retryCount: 0,
      maxRetries: input.maxRetries ?? this.defaultMaxRetries,
      startedAt: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    this.jobs.set(jobId, jobState);

    // Persist to PostgreSQL if connected
    try {
      await db.productionJob.create({
        data: {
          id: jobId,
          episodeId: input.episodeId,
          episodeVersionId: input.episodeVersionId || undefined,
          type: input.type,
          status: 'QUEUED',
          progress: 0,
          stepDescription: jobState.stepDescription,
          startedAt: null,
        },
      });
    } catch (err: any) {
      logger.warn('Could not persist enqueued job to PostgreSQL (falling back to memory state)', {
        jobId,
        error: err.message,
      });
    }

    const snapshot = { ...jobState };
    this.emitNotification(jobState);
    this.triggerProcessing();

    return snapshot;
  }

  /**
   * Triggers processing tick if concurrency allows.
   */
  public triggerProcessing(): void {
    if (this.isProcessingLoop) return;
    this.isProcessingLoop = true;

    queueMicrotask(async () => {
      try {
        while (this.activeJobsCount < this.maxConcurrency) {
          const nextJob = this.claimNextJob();
          if (!nextJob) break;

          this.activeJobsCount++;
          this.executeJob(nextJob)
            .catch((err) => {
              logger.error('Unhandled failure during background job execution', {
                jobId: nextJob.id,
                error: err.message,
              });
            })
            .finally(() => {
              this.activeJobsCount--;
              this.triggerProcessing();
            });
        }
      } finally {
        this.isProcessingLoop = false;
      }
    });
  }

  /**
   * Selects and claims the oldest QUEUED job.
   */
  private claimNextJob(): ProductionJobState | null {
    for (const job of this.jobs.values()) {
      if (job.status === 'QUEUED') {
        job.status = 'PROCESSING';
        job.startedAt = new Date().toISOString();
        job.updatedAt = job.startedAt;
        job.stepDescription = `Procesando trabajo ${job.type}...`;

        // Update DB
        try {
          db.productionJob
            .updateMany({
              where: { id: job.id, status: 'QUEUED' },
              data: {
                status: 'PROCESSING',
                startedAt: new Date(job.startedAt),
                stepDescription: job.stepDescription,
              },
            })
            .catch(() => {});
        } catch {
          // Offline
        }

        this.emitNotification(job);
        return job;
      }
    }
    return null;
  }

  /**
   * Executes a claimed job using its registered handler.
   */
  private async executeJob(job: ProductionJobState): Promise<void> {
    const controller = new AbortController();
    this.activeControllers.set(job.id, controller);

    const timeoutHandle = setTimeout(() => {
      logger.warn(`Job [${job.id}] reached timeout of ${this.jobTimeoutMs}ms. Aborting.`, { jobId: job.id });
      controller.abort();
    }, this.jobTimeoutMs);

    const context: JobExecutionContext = {
      job,
      signal: controller.signal,
      updateProgress: async (progress: number, stepDesc?: string, stepKey?: string) => {
        job.progress = Math.max(0, Math.min(100, Math.round(progress)));
        if (stepDesc) job.stepDescription = stepDesc;
        job.updatedAt = new Date().toISOString();

        if (stepKey) {
          const existingStep = job.steps.find((s) => s.stepKey === stepKey);
          if (existingStep) {
            existingStep.progress = job.progress;
            existingStep.status = 'PROCESSING';
          } else {
            job.steps.push({
              stepIndex: job.steps.length + 1,
              stepKey,
              name: stepDesc || stepKey,
              status: 'PROCESSING',
              progress: job.progress,
              startedAt: job.updatedAt,
            });
          }
        }

        try {
          await db.productionJob.updateMany({
            where: { id: job.id },
            data: {
              progress: job.progress,
              stepDescription: job.stepDescription,
            },
          });
        } catch {
          // Offline
        }

        this.emitNotification(job, stepKey);
      },
      completeStep: async (stepKey: string, outputRef?: string, outputPayload?: Record<string, unknown>) => {
        let step = job.steps.find((s) => s.stepKey === stepKey);
        const now = new Date().toISOString();

        if (!step) {
          step = {
            stepIndex: job.steps.length + 1,
            stepKey,
            name: stepKey,
            status: 'COMPLETED',
            outputReference: outputRef,
            completedAt: now,
          };
          job.steps.push(step);
        } else {
          step.status = 'COMPLETED';
          step.outputReference = outputRef;
          step.completedAt = now;
        }

        try {
          await db.jobStep.upsert({
            where: {
              uq_job_step_index: {
                jobId: job.id,
                stepIndex: step.stepIndex,
              },
            },
            create: {
              jobId: job.id,
              stepIndex: step.stepIndex,
              stepKey: step.stepKey,
              name: step.name,
              status: 'COMPLETED',
              inputHash: 'manual_dispatch',
              outputReference: outputRef || null,
              outputPayload: outputPayload ? (outputPayload as any) : undefined,
              completedAt: new Date(now),
            },
            update: {
              status: 'COMPLETED',
              outputReference: outputRef || null,
              outputPayload: outputPayload ? (outputPayload as any) : undefined,
              completedAt: new Date(now),
            },
          });
        } catch {
          // Offline
        }
      },
      failStep: async (stepKey: string, err: Error) => {
        const step = job.steps.find((s) => s.stepKey === stepKey);
        if (step) {
          step.status = 'FAILED';
          step.errorMessage = err.message;
          step.completedAt = new Date().toISOString();
        }
      },
      logInfo: (msg, meta) => logger.info(`[WorkerQueue] ${msg}`, { jobId: job.id, ...meta }),
      logWarn: (msg, meta) => logger.warn(`[WorkerQueue] ${msg}`, { jobId: job.id, ...meta }),
    };

    try {
      const handler = JOB_HANDLERS[job.type];
      if (!handler) {
        throw new AppError(`No existe un handler registrado para el tipo de trabajo [${job.type}]`, 400, 'UNSUPPORTED_JOB_TYPE');
      }

      logger.info(`Starting execution of job [${job.id}] type [${job.type}]`, { episodeId: job.episodeId });
      const result = await handler(context);

      clearTimeout(timeoutHandle);
      this.activeControllers.delete(job.id);

      // Check if job was aborted during run
      if (controller.signal.aborted || job.status === 'CANCELLED') {
        job.status = 'CANCELLED';
        job.stepDescription = 'Trabajo cancelado por el usuario o tiempo de espera.';
        job.completedAt = new Date().toISOString();
        await this.syncJobCompletionToDb(job);
        this.emitNotification(job);
        return;
      }

      job.status = 'COMPLETED';
      job.progress = 100;
      job.outputResult = result;
      job.completedAt = new Date().toISOString();
      job.stepDescription = 'Trabajo completado exitosamente.';
      job.errorMessage = null;

      await this.syncJobCompletionToDb(job);
      this.emitNotification(job);
      this.emit('completed', job);
    } catch (error: any) {
      clearTimeout(timeoutHandle);
      this.activeControllers.delete(job.id);

      if (controller.signal.aborted || error.code === 'JOB_ABORTED' || error.code === 'JOB_CANCELLED') {
        job.status = 'CANCELLED';
        job.stepDescription = 'Trabajo cancelado.';
        job.completedAt = new Date().toISOString();
        await this.syncJobCompletionToDb(job);
        this.emitNotification(job);
        this.emit('cancelled', job);
        return;
      }

      // Check for retries
      if (job.retryCount < job.maxRetries) {
        job.retryCount++;
        job.status = 'QUEUED';
        job.stepDescription = `Reintentando tras error (${job.retryCount}/${job.maxRetries}): ${error.message}`;
        logger.warn(`Job [${job.id}] failed. Scheduled retry [${job.retryCount}/${job.maxRetries}].`, {
          error: error.message,
        });
        await this.syncJobCompletionToDb(job);
        this.emitNotification(job);
        return;
      }

      job.status = 'FAILED';
      job.errorMessage = error.message || 'Error desconocido durante la ejecución del trabajo';
      job.errorDetails = { stack: error.stack, code: error.code };
      job.completedAt = new Date().toISOString();
      job.stepDescription = `Fallo crítico: ${job.errorMessage}`;

      await this.syncJobCompletionToDb(job);
      this.emitNotification(job);
      this.emit('failed', job);
    }
  }

  private async syncJobCompletionToDb(job: ProductionJobState): Promise<void> {
    try {
      await db.productionJob.updateMany({
        where: { id: job.id },
        data: {
          status: job.status,
          progress: job.progress,
          stepDescription: job.stepDescription,
          errorMessage: job.errorMessage,
          errorDetails: job.errorDetails ? (job.errorDetails as any) : undefined,
          completedAt: job.completedAt ? new Date(job.completedAt) : undefined,
        },
      });
    } catch {
      // Offline fallback
    }
  }

  /**
   * Cancels a running or queued job.
   */
  public async cancelJob(jobId: string): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job) return false;

    if (job.status === 'COMPLETED' || job.status === 'FAILED') {
      return false;
    }

    const controller = this.activeControllers.get(jobId);
    if (controller) {
      controller.abort();
      this.activeControllers.delete(jobId);
    }

    job.status = 'CANCELLED';
    job.stepDescription = 'Cancelado por el usuario.';
    job.completedAt = new Date().toISOString();

    await this.syncJobCompletionToDb(job);
    this.emitNotification(job);
    this.emit('cancelled', job);

    return true;
  }

  /**
   * Retries a failed or cancelled job.
   */
  public async retryJob(jobId: string): Promise<ProductionJobState | null> {
    const job = this.jobs.get(jobId);
    if (!job) return null;

    if (job.status !== 'FAILED' && job.status !== 'CANCELLED') {
      return job;
    }

    job.status = 'QUEUED';
    job.progress = 0;
    job.errorMessage = null;
    job.errorDetails = null;
    job.retryCount = 0;
    job.startedAt = null;
    job.completedAt = null;
    job.stepDescription = 'Trabajo reencolado manualmente para reintento.';

    await this.syncJobCompletionToDb(job);
    this.emitNotification(job);
    this.triggerProcessing();

    return job;
  }

  /**
   * Retrieves a job by ID.
   */
  public async getJob(jobId: string): Promise<ProductionJobState | null> {
    const memJob = this.jobs.get(jobId);
    if (memJob) return memJob;

    // Check DB
    try {
      const dbJob = await db.productionJob.findUnique({
        where: { id: jobId },
        include: { steps: { orderBy: { stepIndex: 'asc' } } },
      });

      if (!dbJob) return null;

      const loadedState: ProductionJobState = {
        id: dbJob.id,
        episodeId: dbJob.episodeId,
        episodeVersionId: dbJob.episodeVersionId,
        type: dbJob.type,
        status: dbJob.status,
        progress: dbJob.progress,
        stepDescription: dbJob.stepDescription,
        errorMessage: dbJob.errorMessage,
        errorDetails: dbJob.errorDetails as Record<string, unknown> | null,
        steps: dbJob.steps.map((s) => ({
          id: s.id,
          stepIndex: s.stepIndex,
          stepKey: s.stepKey,
          name: s.name,
          status: s.status,
          outputReference: s.outputReference || undefined,
          errorMessage: s.errorMessage || undefined,
          completedAt: s.completedAt?.toISOString(),
        })),
        retryCount: 0,
        maxRetries: this.defaultMaxRetries,
        startedAt: dbJob.startedAt?.toISOString() || null,
        completedAt: dbJob.completedAt?.toISOString() || null,
        createdAt: dbJob.createdAt.toISOString(),
        updatedAt: dbJob.updatedAt.toISOString(),
      };

      this.jobs.set(jobId, loadedState);
      return loadedState;
    } catch {
      return null;
    }
  }

  /**
   * Lists jobs matching criteria.
   */
  public listJobs(filter: JobFilter = {}): ProductionJobState[] {
    let list = Array.from(this.jobs.values());

    if (filter.status) {
      list = list.filter((j) => j.status === filter.status);
    }
    if (filter.type) {
      list = list.filter((j) => j.type === filter.type);
    }
    if (filter.episodeId) {
      list = list.filter((j) => j.episodeId === filter.episodeId);
    }

    list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const offset = filter.offset || 0;
    const limit = filter.limit || 50;
    return list.slice(offset, offset + limit);
  }

  /**
   * Retrieves active status metrics.
   */
  public getMetrics(): {
    activeJobsCount: number;
    queuedJobsCount: number;
    completedJobsCount: number;
    failedJobsCount: number;
    totalJobsCount: number;
  } {
    let queued = 0;
    let completed = 0;
    let failed = 0;

    for (const j of this.jobs.values()) {
      if (j.status === 'QUEUED') queued++;
      else if (j.status === 'COMPLETED') completed++;
      else if (j.status === 'FAILED') failed++;
    }

    return {
      activeJobsCount: this.activeJobsCount,
      queuedJobsCount: queued,
      completedJobsCount: completed,
      failedJobsCount: failed,
      totalJobsCount: this.jobs.size,
    };
  }

  /**
   * Subscribes to progress events for SSE or UI telemetry.
   */
  public subscribe(listener: (notification: JobProgressNotification) => void): () => void {
    this.on('progress', listener);
    return () => {
      this.off('progress', listener);
    };
  }

  private emitNotification(job: ProductionJobState, stepKey?: string): void {
    const notification: JobProgressNotification = {
      jobId: job.id,
      episodeId: job.episodeId,
      type: job.type,
      status: job.status,
      progress: job.progress,
      stepDescription: job.stepDescription || undefined,
      stepKey,
      timestamp: new Date().toISOString(),
    };
    this.emit('progress', notification);
  }
}
