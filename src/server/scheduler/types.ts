/**
 * Cartoon Studio — Background Scheduler & Worker Queues Types (Phase 11)
 * Formal definitions for asynchronous jobs, worker queues, and editorial scheduling.
 */

import { JobType, JobStatus, StepStatus, EditorialStatus, PrivacyStatus } from '@prisma/client';

export type { JobType, JobStatus, StepStatus, EditorialStatus, PrivacyStatus };

export interface JobStepDetail {
  id?: string;
  stepIndex: number;
  stepKey: string;
  name: string;
  status: StepStatus;
  progress?: number;
  inputHash?: string;
  outputReference?: string;
  attemptCount?: number;
  durationMs?: number;
  errorMessage?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface ProductionJobState {
  id: string;
  episodeId: string;
  episodeVersionId?: string | null;
  type: JobType;
  status: JobStatus;
  progress: number;
  stepDescription?: string | null;
  errorMessage?: string | null;
  errorDetails?: Record<string, unknown> | null;
  steps: JobStepDetail[];
  payload?: Record<string, unknown>;
  outputResult?: Record<string, unknown>;
  retryCount: number;
  maxRetries: number;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EnqueueJobInput {
  episodeId: string;
  episodeVersionId?: string;
  type: JobType;
  payload?: Record<string, unknown>;
  maxRetries?: number;
  priority?: number;
  userId?: string;
}

export interface JobFilter {
  status?: JobStatus;
  type?: JobType;
  episodeId?: string;
  limit?: number;
  offset?: number;
}

export interface JobExecutionContext {
  job: ProductionJobState;
  signal: AbortSignal;
  updateProgress: (progress: number, stepDescription?: string, stepKey?: string) => Promise<void>;
  completeStep: (stepKey: string, outputReference?: string, outputPayload?: Record<string, unknown>) => Promise<void>;
  failStep: (stepKey: string, error: Error) => Promise<void>;
  logInfo: (message: string, meta?: Record<string, unknown>) => void;
  logWarn: (message: string, meta?: Record<string, unknown>) => void;
}

export type JobHandler = (context: JobExecutionContext) => Promise<Record<string, unknown>>;

export interface EditorialCalendarItemDTO {
  id: string;
  seriesId: string;
  title: string;
  episodeId?: string | null;
  episodeCode?: string;
  plannedAt: string;
  timezone: string;
  editorialStatus: EditorialStatus;
  notes?: string | null;
  youtubePublicationId?: string | null;
  privacyStatus?: PrivacyStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCalendarItemInput {
  seriesId?: string;
  title: string;
  episodeId?: string;
  plannedAt: string | Date;
  timezone?: string;
  editorialStatus?: EditorialStatus;
  notes?: string;
  privacyStatus?: PrivacyStatus;
}

export interface UpdateCalendarItemInput {
  title?: string;
  plannedAt?: string | Date;
  timezone?: string;
  editorialStatus?: EditorialStatus;
  notes?: string;
  privacyStatus?: PrivacyStatus;
}

export interface SchedulerMetrics {
  isRunning: boolean;
  workerConcurrency: number;
  activeJobsCount: number;
  queuedJobsCount: number;
  completedJobsCount: number;
  failedJobsCount: number;
  editorialItemsPendingCount: number;
  editorialItemsBroadcastedCount: number;
  lastJobPollAt?: string;
  lastCalendarPollAt?: string;
  lastBroadcastAt?: string;
  uptimeSeconds: number;
}

export interface JobProgressNotification {
  jobId: string;
  episodeId: string;
  type: JobType;
  status: JobStatus;
  progress: number;
  stepDescription?: string;
  stepKey?: string;
  timestamp: string;
}
