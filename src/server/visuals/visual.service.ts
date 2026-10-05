import { createHash } from 'node:crypto';
import { AssetType, ProviderType, StorageDriver } from '@prisma/client';
import { ImageProvider } from '../providers/image.provider';
import { StorageProvider } from '../storage';
import { storageProvider as defaultStorage } from '../storage/storage.factory';
import { ImagenProvider } from './imagen.provider';
import { SyntheticImageProvider } from './synthetic.provider';
import { ConsistencyEngine, MasterCharacterProfile, SceneVisualComposition } from './consistency.engine';
import { calculateImageCostEur } from '../ai/cost.calculator';
import { telemetryService } from '../ai/telemetry.service';
import { config } from '../config';
import { db } from '../db';
import { logger } from '../utils/logger';

export interface SceneVisualInput {
  episodeId: string;
  sceneIndex: number;
  sceneCode: string;
  location: string;
  timeOfDay: string;
  action: string;
  camera?: string;
  characters?: string[];
  visualPrompt?: string;
  seriesStyle?: string;
  masterCharacters?: MasterCharacterProfile[];
  width?: number;
  height?: number;
}

export interface SceneVisualResult {
  sceneIndex: number;
  sceneCode: string;
  storageKey: string;
  publicUrl: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
  seedUsed?: number;
  costEur: number;
  assetId?: string;
  assetVersionId?: string;
}

export interface EpisodeVisualsBatchResult {
  episodeId: string;
  scenes: SceneVisualResult[];
  totalImagesGenerated: number;
  totalCostEur: number;
}

export interface CharacterVisualInput {
  episodeId: string;
  characterName: string;
  species: string;
  colorPalette?: string[];
  clothing?: string;
  visualFeatures?: string;
  visualConsistencyPrompt?: string;
  seriesStyle?: string;
}

export interface ThumbnailVisualInput {
  episodeId: string;
  title: string;
  overlayText: string;
  heroCharacterName?: string;
  heroSpecies?: string;
  heroVisualFeatures?: string;
  seriesStyle?: string;
}

export class VisualService {
  private readonly imageProvider: ImageProvider;
  private readonly storage: StorageProvider;

  constructor(customImageProvider?: ImageProvider, customStorage?: StorageProvider) {
    this.storage = customStorage || defaultStorage;

    if (customImageProvider) {
      this.imageProvider = customImageProvider;
    } else if (config.visuals.provider === 'imagen' && config.visuals.hasApiKey) {
      this.imageProvider = new ImagenProvider(config.visuals.apiKey, config.visuals.defaultModel);
    } else {
      this.imageProvider = new SyntheticImageProvider();
    }
  }

  /**
   * Generates a single 16:9 cinematic raster PNG visual for an episodic scene,
   * uploads to StorageProvider (POSIX path), registers asset in DB, and emits telemetry.
   */
  async generateSceneVisual(input: SceneVisualInput): Promise<SceneVisualResult> {
    const startTime = Date.now();
    logger.info(`Starting visual generation for episode [${input.episodeId}] scene [${input.sceneCode}]`, {
      location: input.location,
      timeOfDay: input.timeOfDay,
      characters: input.characters,
    });

    // 1. Compile prompt using ConsistencyEngine
    const sceneComposition: SceneVisualComposition = {
      sceneIndex: input.sceneIndex,
      location: input.location,
      timeOfDay: input.timeOfDay,
      action: input.action,
      camera: input.camera || 'medium eye-level cinematic shot',
      characters: input.characters || [],
      visualPrompt: input.visualPrompt || input.action,
      seriesStyle: input.seriesStyle,
    };

    const compiled = ConsistencyEngine.compileScenePrompt(
      sceneComposition,
      input.masterCharacters,
      input.seriesStyle
    );

    // 2. Generate Image via ImageProvider
    const genResult = await this.imageProvider.generateSceneVisual({
      prompt: compiled.positivePrompt,
      negativePrompt: compiled.negativePrompt,
      aspectRatio: compiled.aspectRatio,
      seed: compiled.seed,
      stylePreset: compiled.stylePreset,
      width: input.width,
      height: input.height,
    });

    const latencyMs = Date.now() - startTime;
    const checksumSha256 = createHash('sha256').update(genResult.imageBuffer).digest('hex');
    const sizeBytes = genResult.imageBuffer.length;
    const isSynthetic = config.visuals.provider === 'synthetic' || !config.visuals.hasApiKey;
    const costEur = isSynthetic ? 0.0 : calculateImageCostEur(1);

    // 3. Store in StorageProvider with normalized POSIX key (zero Windows path hardcoding)
    const slotName = `scene_${input.sceneCode}`;
    const storageKey = `episodes/${input.episodeId}/visuals/${slotName}_${checksumSha256.substring(0, 10)}.png`;
    await this.storage.upload(storageKey, genResult.imageBuffer, genResult.mimeType);
    const publicUrl = this.storage.getPublicUrl(storageKey);

    // 4. Database Persistence (Asset & AssetVersion) — fail-safe if DB is offline
    let assetId: string | undefined;
    let assetVersionId: string | undefined;

    try {
      // Find or create logical Asset slot
      let asset = await db.asset.findFirst({
        where: {
          episodeId: input.episodeId,
          type: AssetType.IMAGE_SCENE,
          slotName,
        },
      });

      if (!asset) {
        asset = await db.asset.create({
          data: {
            episodeId: input.episodeId,
            type: AssetType.IMAGE_SCENE,
            slotName,
          },
        });
      }
      assetId = asset.id;

      // Count existing versions to increment version number
      const versionCount = await db.assetVersion.count({
        where: { assetId: asset.id },
      });
      const nextVersion = versionCount + 1;

      const createdVersion = await db.assetVersion.create({
        data: {
          assetId: asset.id,
          versionNumber: nextVersion,
          storageDriver: config.storage.driver === 's3' ? StorageDriver.S3 : StorageDriver.LOCAL,
          storageKey,
          mimeType: genResult.mimeType,
          sizeBytes: BigInt(sizeBytes),
          checksumSha256,
          generationParameters: {
            prompt: compiled.positivePrompt,
            negativePrompt: compiled.negativePrompt,
            seed: genResult.seedUsed,
            stylePreset: compiled.stylePreset,
            width: input.width || 640,
            height: input.height || 360,
          },
        },
      });
      assetVersionId = createdVersion.id;

      // Update current version pointer
      await db.asset.update({
        where: { id: asset.id },
        data: { currentVersionId: createdVersion.id },
      });
    } catch (dbErr: any) {
      logger.warn('Database asset persistence skipped (DB offline or demo mode)', { error: dbErr.message });
    }

    // 5. Telemetry Recording
    await telemetryService.recordExecution({
      episodeId: input.episodeId,
      provider: ProviderType.IMAGEN,
      modelOrService: config.visuals.defaultModel,
      operation: 'generate-scene-visual',
      requestPayload: {
        sceneCode: input.sceneCode,
        prompt: compiled.positivePrompt,
        seed: genResult.seedUsed,
      },
      latencyMs,
      httpStatus: 200,
      inputUnits: compiled.positivePrompt.length,
      outputUnits: sizeBytes,
      costEur,
    });

    return {
      sceneIndex: input.sceneIndex,
      sceneCode: input.sceneCode,
      storageKey,
      publicUrl,
      mimeType: genResult.mimeType,
      sizeBytes,
      checksumSha256,
      seedUsed: genResult.seedUsed,
      costEur,
      assetId,
      assetVersionId,
    };
  }

  /**
   * Generates raster visual assets for an entire batch of storyboard scenes.
   */
  async generateEpisodeVisualsBatch(
    episodeId: string,
    scenes: Array<Omit<SceneVisualInput, 'episodeId'>>
  ): Promise<EpisodeVisualsBatchResult> {
    const results: SceneVisualResult[] = [];
    let totalCostEur = 0;

    for (const sc of scenes) {
      const res = await this.generateSceneVisual({
        ...sc,
        episodeId,
      });
      results.push(res);
      totalCostEur += res.costEur;
    }

    return {
      episodeId,
      scenes: results,
      totalImagesGenerated: results.length,
      totalCostEur: Number(totalCostEur.toFixed(6)),
    };
  }

  /**
   * Generates a 1:1 character turnaround model sheet and persists it to StorageProvider.
   */
  async generateCharacterVisual(input: CharacterVisualInput): Promise<{
    storageKey: string;
    publicUrl: string;
    sizeBytes: number;
    checksumSha256: string;
    mimeType: string;
    costEur: number;
  }> {
    const characterProfile: MasterCharacterProfile = {
      name: input.characterName,
      species: input.species,
      colorPalette: input.colorPalette || ['#EA580C', '#FEF3C7'],
      clothing: input.clothing || 'Standard preschool cartoon outfit',
      visualFeatures: input.visualFeatures || 'Expressive large eyes, rounded soft silhouette',
      visualConsistencyPrompt: input.visualConsistencyPrompt,
    };

    const compiled = ConsistencyEngine.compileCharacterTurnaround(characterProfile, input.seriesStyle);
    const genResult = await this.imageProvider.generateCharacterTurnaround(
      compiled.positivePrompt,
      compiled.stylePreset
    );

    const checksumSha256 = createHash('sha256').update(genResult.imageBuffer).digest('hex');
    const sizeBytes = genResult.imageBuffer.length;
    const isSynthetic = config.visuals.provider === 'synthetic' || !config.visuals.hasApiKey;
    const costEur = isSynthetic ? 0.0 : calculateImageCostEur(1);

    const cleanName = input.characterName.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const storageKey = `episodes/${input.episodeId}/characters/${cleanName}_turnaround.png`;
    await this.storage.upload(storageKey, genResult.imageBuffer, genResult.mimeType);
    const publicUrl = this.storage.getPublicUrl(storageKey);

    return {
      storageKey,
      publicUrl,
      sizeBytes,
      checksumSha256,
      mimeType: genResult.mimeType,
      costEur,
    };
  }

  /**
   * Generates a 1280x720 YouTube Thumbnail image and stores it in StorageProvider.
   */
  async generateThumbnail(input: ThumbnailVisualInput): Promise<{
    storageKey: string;
    publicUrl: string;
    sizeBytes: number;
    checksumSha256: string;
    mimeType: string;
    costEur: number;
  }> {
    const heroProfile: MasterCharacterProfile = {
      name: input.heroCharacterName || 'Milo',
      species: input.heroSpecies || 'Zorro',
      colorPalette: ['#EA580C', '#FEF3C7', '#65A30D'],
      clothing: 'Green backpack, adventure vest',
      visualFeatures: input.heroVisualFeatures || 'Huge bright amber eyes, radiant smile',
    };

    const compiled = ConsistencyEngine.compileThumbnailPrompt(
      input.title,
      input.overlayText,
      heroProfile,
      input.seriesStyle
    );

    const genResult = await this.imageProvider.generateThumbnail(
      input.title,
      input.overlayText,
      compiled.positivePrompt
    );

    const checksumSha256 = createHash('sha256').update(genResult.imageBuffer).digest('hex');
    const sizeBytes = genResult.imageBuffer.length;
    const isSynthetic = config.visuals.provider === 'synthetic' || !config.visuals.hasApiKey;
    const costEur = isSynthetic ? 0.0 : calculateImageCostEur(1);

    const storageKey = `episodes/${input.episodeId}/thumbnails/thumbnail_1280x720_${checksumSha256.substring(0, 10)}.png`;
    await this.storage.upload(storageKey, genResult.imageBuffer, genResult.mimeType);
    const publicUrl = this.storage.getPublicUrl(storageKey);

    return {
      storageKey,
      publicUrl,
      sizeBytes,
      checksumSha256,
      mimeType: genResult.mimeType,
      costEur,
    };
  }
}

// Export singleton instance
export const visualService = new VisualService();
