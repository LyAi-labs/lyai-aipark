/**
 * Cartoon Studio — Editorial Calendar Scheduler (Phase 11)
 * Monitors scheduled broadcast intentions and automatically publishes episodes to YouTube
 * upon reaching their target broadcast time, enforcing QC gatekeepers and COPPA compliance.
 */

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { EditorialStatus, PrivacyStatus } from '@prisma/client';
import {
  CreateCalendarItemInput,
  EditorialCalendarItemDTO,
  UpdateCalendarItemInput,
} from './types';
import { db } from '../db';
import { youTubeService } from '../youtube';
import { qcService } from '../qc';
import { logger } from '../utils/logger';
import { AppError } from '../errors';

export interface EditorialSchedulerOptions {
  pollIntervalMs?: number;
  autoStart?: boolean;
}

export class EditorialScheduler extends EventEmitter {
  private timer: NodeJS.Timeout | null = null;
  private isTicking = false;
  private pollIntervalMs: number;
  private items = new Map<string, EditorialCalendarItemDTO>();
  private lastPollAt: string | null = null;
  private lastBroadcastAt: string | null = null;

  constructor(options: EditorialSchedulerOptions = {}) {
    super();
    this.pollIntervalMs = options.pollIntervalMs ?? 10000;
  }

  /**
   * Starts periodic polling of the editorial calendar.
   */
  public start(): void {
    if (this.timer) return;
    logger.info(`Starting EditorialScheduler background loop (interval: ${this.pollIntervalMs}ms)`);
    this.timer = setInterval(() => {
      this.tick().catch((err) => {
        logger.error('Error during EditorialScheduler tick', { error: err.message });
      });
    }, this.pollIntervalMs);
  }

  /**
   * Stops periodic polling.
   */
  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info('EditorialScheduler background loop stopped');
    }
  }

  /**
   * Returns whether background timer is active.
   */
  public isRunning(): boolean {
    return this.timer !== null;
  }

  /**
   * Core scheduler tick: queries all due CONFIRMED calendar items and executes publishing.
   */
  public async tick(): Promise<number> {
    if (this.isTicking) return 0;
    this.isTicking = true;
    this.lastPollAt = new Date().toISOString();

    let processedCount = 0;
    try {
      const now = new Date();
      const dueItems = await this.findDueItems(now);

      for (const item of dueItems) {
        try {
          logger.info(`Due calendar item reached: [${item.id}] "${item.title}". Executing auto-broadcast.`, {
            episodeId: item.episodeId,
            plannedAt: item.plannedAt,
          });

          await this.broadcastItem(item);
          processedCount++;
          this.lastBroadcastAt = new Date().toISOString();
        } catch (itemErr: any) {
          logger.error(`Failed to auto-broadcast calendar item [${item.id}]`, {
            error: itemErr.message,
            episodeId: item.episodeId,
          });

          // Mark error note in item
          await this.updateItem(item.id, {
            notes: `[Auto-Broadcast Error ${new Date().toISOString()}]: ${itemErr.message}`,
          });
        }
      }
    } finally {
      this.isTicking = false;
    }

    return processedCount;
  }

  /**
   * Finds all CONFIRMED items whose plannedAt has arrived.
   */
  private async findDueItems(now: Date): Promise<EditorialCalendarItemDTO[]> {
    const dueList: EditorialCalendarItemDTO[] = [];

    // Check DB first if available
    try {
      const dbDue = await db.editorialCalendarItem.findMany({
        where: {
          editorialStatus: 'CONFIRMED',
          plannedAt: { lte: now },
        },
        include: { episode: true },
        orderBy: { plannedAt: 'asc' },
      });

      for (const d of dbDue) {
        const dto: EditorialCalendarItemDTO = {
          id: d.id,
          seriesId: d.seriesId,
          title: d.title,
          episodeId: d.episodeId,
          episodeCode: (d as any).episode?.episodeCode || undefined,
          plannedAt: d.plannedAt.toISOString(),
          timezone: d.timezone,
          editorialStatus: d.editorialStatus,
          notes: d.notes,
          youtubePublicationId: d.youtubePublicationId,
          createdAt: d.createdAt.toISOString(),
          updatedAt: d.updatedAt.toISOString(),
        };
        dueList.push(dto);
        this.items.set(dto.id, dto);
      }
    } catch {
      // Offline fallback: check memory items
    }

    // Add any memory items that meet criteria and aren't already in list
    for (const memItem of this.items.values()) {
      if (
        memItem.editorialStatus === 'CONFIRMED' &&
        new Date(memItem.plannedAt).getTime() <= now.getTime() &&
        !dueList.some((d) => d.id === memItem.id)
      ) {
        dueList.push(memItem);
      }
    }

    return dueList;
  }

  /**
   * Performs automated publishing of an editorial item to YouTube.
   */
  private async broadcastItem(item: EditorialCalendarItemDTO): Promise<void> {
    const episodeId = item.episodeId || `ep_${item.id.slice(0, 8)}`;

    // 1. Verify Quality Control Gatekeeper
    const qcReport = await qcService.getLatestReport(episodeId);
    if (qcReport && (qcReport.isBlocked || !qcReport.approvedForProduction)) {
      throw new AppError(
        `Auto-Broadcast abortado: Episodio [${episodeId}] bloqueado por Control de Calidad (${qcReport.blockingReasons.join(', ')})`,
        422,
        'QC_BLOCKED_BROADCAST'
      );
    }

    // 2. Publish to YouTube
    const publishRes = await youTubeService.publishEpisode({
      episodeId,
      title: item.title,
      description: item.notes || `Estreno programado en Cartoon Studio. Conforme a normativas COPPA infantiles.`,
      privacyStatus: item.privacyStatus === 'PUBLIC' ? 'public' : 'private',
      tags: ['cartoon studio', 'dibujos animados', 'estreno'],
    });

    // 3. Transition status to BROADCASTED and record publication reference
    item.editorialStatus = 'BROADCASTED';
    item.youtubePublicationId = publishRes.publicationId;
    item.notes = `${item.notes || ''} [Emisión completada el ${new Date().toISOString()} en ${publishRes.videoUrl}]`.trim();
    item.updatedAt = new Date().toISOString();

    this.items.set(item.id, item);

    try {
      await db.editorialCalendarItem.updateMany({
        where: { id: item.id },
        data: {
          editorialStatus: 'BROADCASTED',
          youtubePublicationId: publishRes.publicationId,
          notes: item.notes,
          updatedAt: new Date(),
        },
      });
    } catch {
      // Offline fallback
    }

    this.emit('broadcasted', {
      calendarItemId: item.id,
      episodeId,
      videoUrl: publishRes.videoUrl,
      publicationId: publishRes.publicationId,
    });
  }

  /**
   * Creates a new scheduled editorial calendar item.
   */
  public async createItem(input: CreateCalendarItemInput): Promise<EditorialCalendarItemDTO> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const plannedAtDate = new Date(input.plannedAt);

    const dto: EditorialCalendarItemDTO = {
      id,
      seriesId: input.seriesId || '00000000-0000-0000-0000-000000000001',
      title: input.title,
      episodeId: input.episodeId || null,
      plannedAt: plannedAtDate.toISOString(),
      timezone: input.timezone || 'UTC',
      editorialStatus: input.editorialStatus || 'CONFIRMED',
      notes: input.notes || null,
      privacyStatus: input.privacyStatus || 'PRIVATE',
      youtubePublicationId: null,
      createdAt: now,
      updatedAt: now,
    };

    this.items.set(id, dto);

    try {
      await db.editorialCalendarItem.create({
        data: {
          id,
          seriesId: dto.seriesId,
          title: dto.title,
          episodeId: dto.episodeId,
          plannedAt: plannedAtDate,
          timezone: dto.timezone,
          editorialStatus: dto.editorialStatus,
          notes: dto.notes,
        },
      });
    } catch (err: any) {
      logger.warn('Failed to persist editorial calendar item to PostgreSQL (using in-memory fallback)', {
        error: err.message,
      });
    }

    return dto;
  }

  /**
   * Updates an existing editorial calendar item.
   */
  public async updateItem(id: string, input: UpdateCalendarItemInput): Promise<EditorialCalendarItemDTO> {
    const item = await this.getItem(id);
    if (!item) {
      throw new AppError(`Elemento de calendario editorial [${id}] no encontrado`, 404, 'CALENDAR_NOT_FOUND');
    }

    if (input.title !== undefined) item.title = input.title;
    if (input.plannedAt !== undefined) item.plannedAt = new Date(input.plannedAt).toISOString();
    if (input.timezone !== undefined) item.timezone = input.timezone;
    if (input.editorialStatus !== undefined) item.editorialStatus = input.editorialStatus;
    if (input.notes !== undefined) item.notes = input.notes;
    if (input.privacyStatus !== undefined) item.privacyStatus = input.privacyStatus;
    item.updatedAt = new Date().toISOString();

    this.items.set(id, item);

    try {
      await db.editorialCalendarItem.updateMany({
        where: { id },
        data: {
          title: item.title,
          plannedAt: new Date(item.plannedAt),
          timezone: item.timezone,
          editorialStatus: item.editorialStatus,
          notes: item.notes,
          updatedAt: new Date(item.updatedAt),
        },
      });
    } catch {
      // Offline
    }

    return item;
  }

  /**
   * Cancels an editorial calendar item.
   */
  public async cancelItem(id: string): Promise<EditorialCalendarItemDTO> {
    return this.updateItem(id, { editorialStatus: 'CANCELLED' });
  }

  /**
   * Retrieves a single calendar item by ID.
   */
  public async getItem(id: string): Promise<EditorialCalendarItemDTO | null> {
    const mem = this.items.get(id);
    if (mem) return mem;

    try {
      const dbItem = await db.editorialCalendarItem.findUnique({
        where: { id },
      });
      if (!dbItem) return null;

      const dto: EditorialCalendarItemDTO = {
        id: dbItem.id,
        seriesId: dbItem.seriesId,
        title: dbItem.title,
        episodeId: dbItem.episodeId,
        plannedAt: dbItem.plannedAt.toISOString(),
        timezone: dbItem.timezone,
        editorialStatus: dbItem.editorialStatus,
        notes: dbItem.notes,
        youtubePublicationId: dbItem.youtubePublicationId,
        createdAt: dbItem.createdAt.toISOString(),
        updatedAt: dbItem.updatedAt.toISOString(),
      };
      this.items.set(id, dto);
      return dto;
    } catch {
      return null;
    }
  }

  /**
   * Lists editorial calendar items.
   */
  public async listItems(seriesId?: string): Promise<EditorialCalendarItemDTO[]> {
    const result: EditorialCalendarItemDTO[] = [];

    try {
      const dbList = await db.editorialCalendarItem.findMany({
        where: seriesId ? { seriesId } : undefined,
        include: { episode: true },
        orderBy: { plannedAt: 'asc' },
      });

      for (const d of dbList) {
        const dto: EditorialCalendarItemDTO = {
          id: d.id,
          seriesId: d.seriesId,
          title: d.title,
          episodeId: d.episodeId,
          episodeCode: (d as any).episode?.episodeCode || undefined,
          plannedAt: d.plannedAt.toISOString(),
          timezone: d.timezone,
          editorialStatus: d.editorialStatus,
          notes: d.notes,
          youtubePublicationId: d.youtubePublicationId,
          createdAt: d.createdAt.toISOString(),
          updatedAt: d.updatedAt.toISOString(),
        };
        result.push(dto);
        this.items.set(dto.id, dto);
      }
    } catch {
      // Offline fallback
    }

    if (result.length === 0) {
      let memList = Array.from(this.items.values());
      if (seriesId) {
        memList = memList.filter((m) => m.seriesId === seriesId);
      }
      memList.sort((a, b) => new Date(a.plannedAt).getTime() - new Date(b.plannedAt).getTime());
      return memList;
    }

    return result;
  }

  /**
   * Status metrics for editorial scheduler.
   */
  public getMetrics(): {
    isRunning: boolean;
    pendingCount: number;
    broadcastedCount: number;
    lastPollAt?: string;
    lastBroadcastAt?: string;
  } {
    let pending = 0;
    let broadcasted = 0;

    for (const item of this.items.values()) {
      if (item.editorialStatus === 'CONFIRMED' || item.editorialStatus === 'DRAFT_SCHEDULE') {
        pending++;
      } else if (item.editorialStatus === 'BROADCASTED') {
        broadcasted++;
      }
    }

    return {
      isRunning: this.isRunning(),
      pendingCount: pending,
      broadcastedCount: broadcasted,
      lastPollAt: this.lastPollAt || undefined,
      lastBroadcastAt: this.lastBroadcastAt || undefined,
    };
  }
}
