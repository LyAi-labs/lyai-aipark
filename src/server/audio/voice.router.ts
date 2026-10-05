/**
 * Cartoon Studio — Voice & Audio REST Router
 * Phase 06: Real Voice & Audio Pipeline
 *
 * REST Endpoints:
 * - GET  /api/voice/catalog    — Lists available cartoon voice presets
 * - POST /api/voice/test       — Character audition (synthesizes phrase & returns audio/wav stream or base64)
 * - POST /api/voice/scene      — Synthesizes scene speech, stores in StorageProvider, returns audio URL
 * - POST /api/voice/batch      — Batch synthesis of all scenes in an episode with WebVTT/SRT subtitles
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { voicePipelineService } from './voice.service';
import { VOICE_CATALOG, getVoicesForLanguage } from './voice.catalog';
import { ValidationError } from '../errors';
import { requireAuth } from '../auth';
import { logger } from '../utils/logger';

export const voiceRouter = Router();

// ------------------------------------------------------------------------------
// Zod Schemas
// ------------------------------------------------------------------------------

const VoiceProfileSchema = z.object({
  voiceType: z.string().min(1).default('es-ES-Neural2-A'),
  pitch: z.number().min(0.5).max(1.8).default(1.0),
  speed: z.number().min(0.6).max(1.4).default(1.0),
  timbre: z.string().optional(),
  language: z.string().min(2).default('es-ES'),
});

const AuditionRequestSchema = z.object({
  characterName: z.string().min(1).max(100).default('Milo'),
  text: z.string().min(1).max(500),
  voiceProfile: VoiceProfileSchema.optional().default({
    voiceType: 'es-ES-Neural2-A',
    pitch: 1.0,
    speed: 1.0,
    language: 'es-ES',
  }),
  format: z.enum(['binary', 'json']).default('json'),
});

const SceneSynthesizeSchema = z.object({
  episodeId: z.string().min(1),
  sceneIndex: z.number().int().min(0),
  sceneCode: z.string().min(1),
  text: z.string().min(1).max(2000),
  speakerName: z.string().optional().default('Narrator'),
  voiceProfile: VoiceProfileSchema.optional(),
  nominalDuration: z.number().positive().optional().default(15),
});

const BatchSynthesizeSchema = z.object({
  episodeId: z.string().min(1),
  scenes: z.array(
    z.object({
      sceneIndex: z.number().int().min(0),
      sceneCode: z.string().min(1),
      dialogue: z.string().optional(),
      narration: z.string().optional(),
      speakerName: z.string().optional(),
      voiceProfile: VoiceProfileSchema.optional(),
      duration: z.number().positive().optional(),
    })
  ).min(1),
});

// ------------------------------------------------------------------------------
// Endpoints
// ------------------------------------------------------------------------------

/**
 * GET /api/voice/catalog
 * Public voice presets catalog
 */
voiceRouter.get('/catalog', (req: Request, res: Response) => {
  const language = req.query['language'] as string | undefined;
  const list = language ? getVoicesForLanguage(language) : VOICE_CATALOG;
  return res.json({
    success: true,
    total: list.length,
    voices: list,
  });
});

/**
 * POST /api/voice/test
 * Character voice audition
 */
voiceRouter.post('/test', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parseResult = AuditionRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw new ValidationError(`Parámetros de audición vocal inválidos: ${JSON.stringify(parseResult.error.format())}`);
    }

    const { characterName, text, voiceProfile, format } = parseResult.data;
    const audition = await voicePipelineService.auditionCharacterVoice(
      characterName,
      text,
      voiceProfile
    );

    if (format === 'binary') {
      res.setHeader('Content-Type', audition.mimeType);
      res.setHeader('Content-Length', audition.audioBuffer.length);
      res.setHeader('Content-Disposition', `inline; filename="audition_${characterName}.wav"`);
      res.status(200).send(audition.audioBuffer);
      return;
    }

    res.json({
      success: true,
      characterName,
      durationSeconds: audition.durationSeconds,
      mimeType: audition.mimeType,
      audioBase64: audition.audioBuffer.toString('base64'),
    });
    return;
  } catch (err) {
    next(err);
    return;
  }
});

/**
 * POST /api/voice/scene
 * Synthesize audio for a single scene (Requires Auth)
 */
voiceRouter.post('/scene', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parseResult = SceneSynthesizeSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw new ValidationError(`Payload de síntesis de escena inválido: ${JSON.stringify(parseResult.error.format())}`);
    }

    const data = parseResult.data;
    const audioResult = await voicePipelineService.synthesizeSceneAudio({
      episodeId: data.episodeId,
      sceneIndex: data.sceneIndex,
      sceneCode: data.sceneCode,
      text: data.text,
      speakerName: data.speakerName,
      voiceProfile: data.voiceProfile,
      nominalDuration: data.nominalDuration,
    });

    res.status(201).json({
      success: true,
      sceneAudio: audioResult,
    });
    return;
  } catch (err) {
    next(err);
    return;
  }
});

/**
 * POST /api/voice/batch
 * Synthesize all scenes for an episode and generate subtitle tracks (Requires Auth)
 */
voiceRouter.post('/batch', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parseResult = BatchSynthesizeSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw new ValidationError(`Payload de síntesis de lote inválido: ${JSON.stringify(parseResult.error.format())}`);
    }

    const { episodeId, scenes } = parseResult.data;
    const batchResult = await voicePipelineService.synthesizeEpisodeBatch(episodeId, scenes);

    res.status(201).json({
      success: true,
      batch: batchResult,
    });
    return;
  } catch (err) {
    next(err);
    return;
  }
});
