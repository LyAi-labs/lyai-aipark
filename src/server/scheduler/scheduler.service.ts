/**
 * Cartoon Studio — Master Scheduler & Worker Coordinator Service (Phase 11)
 * Unifies asynchronous job queues and editorial calendar publication daemon.
 */

import { config } from '../config';
import { logger } from '../utils/logger';
import { WorkerQueue } from './worker.queue';
import { EditorialScheduler } from './editorial.scheduler';
import {
  CreateCalendarItemInput,
  EditorialCalendarItemDTO,
  EnqueueJobInput,
  JobFilter,
  ProductionJobState,
  SchedulerMetrics,
  UpdateCalendarItemInput,
} from './types';

export class SchedulerService {
  private static instance: SchedulerService | null = null;
  private workerQueue: WorkerQueue;
  private editorialScheduler: EditorialScheduler;
  private startedAt: number = Date.now();
  private isAutoStarted = false;

  private constructor() {
    this.workerQueue = new WorkerQueue({
      maxConcurrency: config.scheduler.maxConcurrentJobs,
      defaultMaxRetries: 2,
    });

    this.editorialScheduler = new EditorialScheduler({
      pollIntervalMs: config.scheduler.calendarPollIntervalMs,
    });

    if (config.scheduler.autoStart) {
      this.start();
    }
  }

  public static getInstance(): SchedulerService {
    if (!SchedulerService.instance) {
      SchedulerService.instance = new SchedulerService();
    }
    return SchedulerService.instance;
  }

  /**
   * Starts background worker loop and editorial calendar scheduler.
   */
  public start(): void {
    if (this.isAutoStarted) return;
    this.isAutoStarted = true;
    this.startedAt = Date.now();
    logger.info('Starting Cartoon Studio Scheduler & Worker Queues daemon');

    this.editorialScheduler.start();
    this.workerQueue.triggerProcessing();
  }

  /**
   * Stops background loops.
   */
  public stop(): void {
    this.isAutoStarted = false;
    this.editorialScheduler.stop();
    logger.info('Cartoon Studio Scheduler & Worker Queues daemon stopped');
  }

  /**
   * Triggers an immediate execution tick of both queues and editorial monitor.
   */
  public async triggerNow(): Promise<{ processedCalendarItems: number; activeJobs: number }> {
    this.workerQueue.triggerProcessing();
    const processedCalendar = await this.editorialScheduler.tick();
    const metrics = this.workerQueue.getMetrics();
    return {
      processedCalendarItems: processedCalendar,
      activeJobs: metrics.activeJobsCount,
    };
  }

  /**
   * Retrieves full operational metrics and status.
   */
  public getStatus(): SchedulerMetrics {
    const queueMetrics = this.workerQueue.getMetrics();
    const calMetrics = this.editorialScheduler.getMetrics();

    return {
      isRunning: this.isAutoStarted || this.editorialScheduler.isRunning(),
      workerConcurrency: config.scheduler.maxConcurrentJobs,
      activeJobsCount: queueMetrics.activeJobsCount,
      queuedJobsCount: queueMetrics.queuedJobsCount,
      completedJobsCount: queueMetrics.completedJobsCount,
      failedJobsCount: queueMetrics.failedJobsCount,
      editorialItemsPendingCount: calMetrics.pendingCount,
      editorialItemsBroadcastedCount: calMetrics.broadcastedCount,
      lastJobPollAt: new Date().toISOString(),
      lastCalendarPollAt: calMetrics.lastPollAt,
      lastBroadcastAt: calMetrics.lastBroadcastAt,
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Job Queue Delegation
  // ──────────────────────────────────────────────────────────────────────────

  public async enqueueJob(input: EnqueueJobInput): Promise<ProductionJobState> {
    return this.workerQueue.enqueueJob(input);
  }

  public async getJob(jobId: string): Promise<ProductionJobState | null> {
    return this.workerQueue.getJob(jobId);
  }

  public listJobs(filter?: JobFilter): ProductionJobState[] {
    return this.workerQueue.listJobs(filter);
  }

  public async cancelJob(jobId: string): Promise<boolean> {
    return this.workerQueue.cancelJob(jobId);
  }

  public async retryJob(jobId: string): Promise<ProductionJobState | null> {
    return this.workerQueue.retryJob(jobId);
  }

  public getQueue(): WorkerQueue {
    return this.workerQueue;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Editorial Calendar Delegation
  // ──────────────────────────────────────────────────────────────────────────

  public async createCalendarItem(input: CreateCalendarItemInput): Promise<EditorialCalendarItemDTO> {
    return this.editorialScheduler.createItem(input);
  }

  public async updateCalendarItem(id: string, input: UpdateCalendarItemInput): Promise<EditorialCalendarItemDTO> {
    return this.editorialScheduler.updateItem(id, input);
  }

  public async cancelCalendarItem(id: string): Promise<EditorialCalendarItemDTO> {
    return this.editorialScheduler.cancelItem(id);
  }

  public async getCalendarItem(id: string): Promise<EditorialCalendarItemDTO | null> {
    return this.editorialScheduler.getItem(id);
  }

  public async listCalendarItems(seriesId?: string): Promise<EditorialCalendarItemDTO[]> {
    return this.editorialScheduler.listItems(seriesId);
  }

  public getEditorialScheduler(): EditorialScheduler {
    return this.editorialScheduler;
  }
}

export const schedulerService = SchedulerService.getInstance();
