import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { visualService } from './visual.service';
import { requireAuth } from '../auth';
import { ValidationError } from '../errors';

export const visualRouter = Router();

// Validation Schemas
const SceneVisualSchema = z.object({
  episodeId: z.string().min(1, 'episodeId is required'),
  sceneIndex: z.number().int().min(1),
  sceneCode: z.string().min(1),
  location: z.string().min(1),
  timeOfDay: z.string().min(1),
  action: z.string().min(1),
  camera: z.string().optional(),
  characters: z.array(z.string()).optional(),
  visualPrompt: z.string().optional(),
  seriesStyle: z.string().optional(),
  width: z.number().int().min(64).max(1920).optional(),
  height: z.number().int().min(64).max(1080).optional(),
});

const BatchVisualSchema = z.object({
  episodeId: z.string().min(1, 'episodeId is required'),
  scenes: z.array(SceneVisualSchema.omit({ episodeId: true })).min(1, 'At least one scene is required'),
});

const CharacterVisualSchema = z.object({
  episodeId: z.string().min(1, 'episodeId is required'),
  characterName: z.string().min(1),
  species: z.string().min(1),
  colorPalette: z.array(z.string()).optional(),
  clothing: z.string().optional(),
  visualFeatures: z.string().optional(),
  visualConsistencyPrompt: z.string().optional(),
  seriesStyle: z.string().optional(),
});

const ThumbnailVisualSchema = z.object({
  episodeId: z.string().min(1, 'episodeId is required'),
  title: z.string().min(1),
  overlayText: z.string().min(1),
  heroCharacterName: z.string().optional(),
  heroSpecies: z.string().optional(),
  heroVisualFeatures: z.string().optional(),
  seriesStyle: z.string().optional(),
});

/**
 * POST /api/visuals/scene
 * Generates a raster 16:9 PNG visual for a single storyboard scene and uploads to StorageProvider.
 */
visualRouter.post('/scene', requireAuth, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parseResult = SceneVisualSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw new ValidationError(`Parametros invalidos para generacion visual de escena: ${JSON.stringify(parseResult.error.format())}`);
    }

    const result = await visualService.generateSceneVisual(parseResult.data);
    res.status(200).json({
      success: true,
      visual: result,
      message: 'Visual 16:9 raster PNG generado y almacenado con exito.',
    });
    return;
  } catch (error) {
    next(error);
    return;
  }
});

/**
 * POST /api/visuals/batch
 * Generates raster visual assets for all scenes of an episode in sequence.
 */
visualRouter.post('/batch', requireAuth, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parseResult = BatchVisualSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw new ValidationError(`Parametros invalidos para generacion de lote visual: ${JSON.stringify(parseResult.error.format())}`);
    }

    const { episodeId, scenes } = parseResult.data;
    const result = await visualService.generateEpisodeVisualsBatch(episodeId, scenes);

    res.status(200).json({
      success: true,
      batch: result,
      message: `${result.totalImagesGenerated} visuales 16:9 generados y persistidos en almacenamiento.`,
    });
    return;
  } catch (error) {
    next(error);
    return;
  }
});

/**
 * POST /api/visuals/character
 * Generates a 1:1 character turnaround model sheet.
 */
visualRouter.post('/character', requireAuth, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parseResult = CharacterVisualSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw new ValidationError(`Parametros invalidos para generacion de personaje: ${JSON.stringify(parseResult.error.format())}`);
    }

    const result = await visualService.generateCharacterVisual(parseResult.data);
    res.status(200).json({
      success: true,
      character: result,
      message: 'Model sheet de personaje generado y persistido.',
    });
    return;
  } catch (error) {
    next(error);
    return;
  }
});

/**
 * POST /api/visuals/thumbnail
 * Generates a 1280x720 YouTube Thumbnail image.
 */
visualRouter.post('/thumbnail', requireAuth, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parseResult = ThumbnailVisualSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw new ValidationError(`Parametros invalidos para generacion de miniatura: ${JSON.stringify(parseResult.error.format())}`);
    }

    const result = await visualService.generateThumbnail(parseResult.data);
    res.status(200).json({
      success: true,
      thumbnail: result,
      message: 'Miniatura 1280x720 generada y persistida para YouTube.',
    });
    return;
  } catch (error) {
    next(error);
    return;
  }
});
