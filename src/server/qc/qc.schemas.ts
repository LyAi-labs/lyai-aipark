/**
 * Cartoon Studio — Quality Control Zod Schemas
 * Phase 09: Objective Quality Control (Audio Drift & COPPA Checks)
 */

import { z } from 'zod';

export const CheckDriftInputSchema = z.object({
  audioDurationSeconds: z.number().nonnegative('La duración de audio debe ser un número no negativo'),
  videoDurationSeconds: z.number().nonnegative('La duración de vídeo debe ser un número no negativo'),
  maxToleranceSeconds: z.number().positive().max(1.0).optional().default(0.05),
});

export const CheckCoppaInputSchema = z.object({
  targetAge: z.string().min(1, 'La edad objetivo es requerida'),
  title: z.string().min(1, 'El título es requerido'),
  dialogueTexts: z.array(z.string()).optional().default([]),
  narrationTexts: z.array(z.string()).optional().default([]),
  educationalObjective: z.string().optional(),
  madeForKids: z.boolean().optional().default(true),
  privacyStatus: z.enum(['private', 'unlisted', 'public', 'scheduled']).optional().default('private'),
  coppaComplianceConfirmed: z.boolean().optional().default(true),
  youtubeMetadata: z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
    madeForKids: z.boolean().optional(),
    privacyStatus: z.string().optional(),
  }).optional(),
});

export const AuditEpisodeInputSchema = z.object({
  episodeId: z.string().min(1, 'episodeId es requerido'),
  episodeVersionId: z.string().optional(),
  targetAge: z.string().default('4-6'),
  title: z.string().min(1, 'El título es requerido'),
  audioDurationSeconds: z.number().nonnegative().optional(),
  videoDurationSeconds: z.number().nonnegative().optional(),
  videoFilePath: z.string().optional(),
  audioFilePath: z.string().optional(),
  scenes: z.array(z.object({
    sceneIndex: z.number().int().optional(),
    sceneCode: z.string().optional(),
    nominalDurationSeconds: z.number().positive(),
    audioDurationSeconds: z.number().nonnegative().optional(),
    dialogue: z.string().optional(),
    narration: z.string().optional(),
    text: z.string().optional(),
  })).optional().default([]),
  subtitlesVtt: z.string().optional(),
  subtitlesSrt: z.string().optional(),
  madeForKids: z.boolean().default(true),
  privacyStatus: z.enum(['private', 'unlisted', 'public', 'scheduled']).default('private'),
  coppaComplianceConfirmed: z.boolean().default(true),
  youtubeMetadata: z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
    madeForKids: z.boolean().optional(),
    privacyStatus: z.string().optional(),
  }).optional(),
});

export const ApproveEpisodeInputSchema = z.object({
  episodeId: z.string().min(1, 'episodeId es requerido'),
  notes: z.string().optional(),
});

export type CheckDriftInput = z.infer<typeof CheckDriftInputSchema>;
export type CheckCoppaInput = z.infer<typeof CheckCoppaInputSchema>;
export type AuditEpisodeInput = z.infer<typeof AuditEpisodeInputSchema>;
export type ApproveEpisodeInput = z.infer<typeof ApproveEpisodeInputSchema>;
