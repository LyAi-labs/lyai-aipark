/**
 * Cartoon Studio — AI Telemetry & Provider Execution Service
 * Phase 04: Robust AI Generation & Prompt Hardening
 *
 * Persists token consumption, latency, and costs in PostgreSQL (provider_executions).
 * Includes SHA-256 request hashing and resilient non-blocking error handling.
 */

import crypto from 'node:crypto';
import { db } from '../db';
import { logger } from '../utils/logger';
import { ProviderType } from '@prisma/client';

export interface RecordExecutionParams {
  episodeId?: string;
  jobId?: string;
  provider?: ProviderType;
  modelOrService: string;
  operation: string;
  requestPayload: unknown;
  latencyMs: number;
  httpStatus?: number;
  errorCode?: string;
  inputUnits: number;
  outputUnits: number;
  costEur: number;
  rawUsageMetadata?: unknown;
}

export class TelemetryService {
  /**
   * Computes a SHA-256 hash of the sanitized request payload.
   */
  public computeRequestHash(payload: unknown): string {
    const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return crypto.createHash('sha256').update(serialized).digest('hex');
  }

  /**
   * Records provider execution telemetry.
   * If an episodeId is provided and exists in PostgreSQL, creates a provider_executions row.
   * Gracefully falls back to structured logging if the database is unreachable or episode doesn't exist.
   */
  public async recordExecution(params: RecordExecutionParams): Promise<void> {
    const {
      episodeId,
      jobId,
      provider = ProviderType.GEMINI,
      modelOrService,
      operation,
      requestPayload,
      latencyMs,
      httpStatus = 200,
      errorCode,
      inputUnits,
      outputUnits,
      costEur,
      rawUsageMetadata,
    } = params;

    const requestHash = this.computeRequestHash(requestPayload);

    logger.info(`AI Execution [${operation}] completed`, {
      provider,
      modelOrService,
      latencyMs,
      inputUnits,
      outputUnits,
      costEur,
      requestHash,
      episodeId,
    });

    if (!episodeId) {
      return;
    }

    try {
      // Check if episode exists to prevent foreign key violation
      const episode = await db.episode.findUnique({
        where: { id: episodeId },
        select: { id: true },
      });

      if (!episode) {
        logger.debug('Skipping DB telemetry persist: Episode ID not found in database', { episodeId });
        return;
      }

      await db.providerExecution.create({
        data: {
          episodeId,
          jobId: jobId || null,
          provider,
          modelOrService,
          operation,
          requestHash,
          latencyMs,
          httpStatus,
          errorCode: errorCode || null,
          inputUnits,
          outputUnits,
          costEur,
          rawUsageMetadata: rawUsageMetadata as any,
        },
      });
    } catch (err: any) {
      // Do not fail the user's AI response if DB persistence fails
      logger.warn('Failed to persist provider_executions row in database', {
        error: err.message,
        operation,
        episodeId,
      });
    }
  }
}

export const telemetryService = new TelemetryService();
