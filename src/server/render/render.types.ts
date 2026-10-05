/**
 * Cartoon Studio — Video Rendering Engine Types & Schemas
 * Phase 08: Real Video Rendering Engine (FFmpeg Worker)
 *
 * Defines canonical data contracts for asynchronous video compilation,
 * scene audio-visual assembly, multi-track mixing, and progress telemetry.
 */

import { z } from 'zod';

export type RenderResolution = '1080p' | '720p';
export type MotionEffect = 'pan-left' | 'pan-right' | 'zoom-in' | 'zoom-out' | 'static' | 'ken-burns';
export type RenderJobStatus = 'PENDING' | 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface RenderSceneInput {
  sceneId: string;
  index: number;
  duration: number; // nominal seconds
  imageStorageKey?: string;
  imageUrl?: string;
  imageBuffer?: Buffer;
  audioStorageKey?: string;
  audioUrl?: string;
  audioBuffer?: Buffer;
  dialogue?: string;
  narration?: string;
  speaker?: string;
  motionType?: MotionEffect;
}

export interface RenderOptions {
  resolution?: RenderResolution;
  fps?: number;
  musicVolume?: number; // 0.0 to 1.0 (default: 0.15)
  voiceVolume?: number; // 0.0 to 1.0 (default: 1.0)
  sfxVolume?: number;   // 0.0 to 1.0 (default: 0.5)
  includeSubtitles?: boolean; // default: true
  generateMusicIfMissing?: boolean; // default: true
}

export interface StartRenderInput {
  episodeId: string;
  title: string;
  scenes: RenderSceneInput[];
  options?: RenderOptions;
}

export interface RenderResult {
  videoStorageKey: string;
  videoPublicUrl: string;
  vttStorageKey?: string;
  vttPublicUrl?: string;
  srtStorageKey?: string;
  srtPublicUrl?: string;
  durationSeconds: number;
  sizeBytes: number;
  checksumSha256: string;
  resolution: string;
  fps: number;
  renderedAt: string;
  driftSeconds?: number;
  isSynchronized?: boolean;
}

export interface JobStepProgress {
  stepKey: string;
  name: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  progress: number;
  durationMs?: number;
  description?: string;
}

export interface RenderJobState {
  jobId: string;
  episodeId: string;
  status: RenderJobStatus;
  progress: number; // 0 to 100
  stepDescription: string;
  activeStepKey?: string;
  steps: JobStepProgress[];
  startedAt: string;
  completedAt?: string;
  errorMessage?: string;
  result?: RenderResult;
}

export interface JobProgressEvent {
  jobId: string;
  episodeId: string;
  status: RenderJobStatus;
  progress: number;
  stepDescription: string;
  timestamp: string;
  result?: RenderResult;
  error?: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// ZOD VALIDATION SCHEMAS
// ──────────────────────────────────────────────────────────────────────────────

export const SceneInputSchema = z.object({
  sceneId: z.string().min(1, 'sceneId es obligatorio'),
  index: z.number().int().min(0),
  duration: z.number().positive('duration debe ser > 0').max(300, 'duration max 300s'),
  imageStorageKey: z.string().optional(),
  imageUrl: z.string().optional(),
  audioStorageKey: z.string().optional(),
  audioUrl: z.string().optional(),
  dialogue: z.string().default(''),
  narration: z.string().default(''),
  speaker: z.string().optional(),
  motionType: z.enum(['pan-left', 'pan-right', 'zoom-in', 'zoom-out', 'static', 'ken-burns']).default('static'),
});

export const RenderOptionsSchema = z.object({
  resolution: z.enum(['1080p', '720p']).default('1080p'),
  fps: z.number().int().min(12).max(60).default(24),
  musicVolume: z.number().min(0).max(1).default(0.15),
  voiceVolume: z.number().min(0).max(1).default(1.0),
  sfxVolume: z.number().min(0).max(1).default(0.5),
  includeSubtitles: z.boolean().default(true),
  generateMusicIfMissing: z.boolean().default(true),
});

export const StartRenderRequestSchema = z.object({
  episodeId: z.string().min(1, 'episodeId es obligatorio'),
  title: z.string().min(1, 'title es obligatorio').max(200),
  scenes: z.array(SceneInputSchema).min(1, 'Se requiere al menos una escena para renderizar'),
  options: RenderOptionsSchema.optional(),
});

export const CancelRenderRequestSchema = z.object({
  jobId: z.string().min(1, 'jobId es obligatorio'),
});
