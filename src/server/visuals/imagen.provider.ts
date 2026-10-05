import { GoogleGenAI } from '@google/genai';
import { GeneratedImageResult, ImageGenerationOptions, ImageProvider } from '../providers/image.provider';
import { SyntheticImageProvider } from './synthetic.provider';
import { logger } from '../utils/logger';

/**
 * Google Imagen 3 Provider for 16:9 cinematic cartoon imagery.
 * Wraps @google/genai with fail-safe fallback to SyntheticImageProvider.
 */
export class ImagenProvider implements ImageProvider {
  private readonly fallback = new SyntheticImageProvider();
  private readonly aiClient: GoogleGenAI | null = null;
  private readonly modelName: string;

  constructor(apiKey: string, modelName = 'imagen-3.0-generate-002') {
    this.modelName = modelName;
    if (apiKey && apiKey.trim().length > 0) {
      try {
        this.aiClient = new GoogleGenAI({ apiKey });
      } catch (err: any) {
        logger.warn('Failed to initialize GoogleGenAI client for Imagen', { error: err.message });
      }
    }
  }

  /**
   * Generates a 16:9 scene illustration with Imagen, or falls back to synthetic PNG.
   */
  async generateSceneVisual(options: ImageGenerationOptions): Promise<GeneratedImageResult> {
    if (!this.aiClient) {
      return this.fallback.generateSceneVisual(options);
    }

    try {
      logger.info('Requesting Imagen 3 visual generation', {
        model: this.modelName,
        aspectRatio: options.aspectRatio,
        promptLength: options.prompt.length,
      });

      const response = await this.aiClient.models.generateImages({
        model: this.modelName,
        prompt: options.prompt,
        config: {
          numberOfImages: 1,
          aspectRatio: options.aspectRatio,
          outputMimeType: 'image/png',
        },
      });

      const generated = response.generatedImages?.[0];
      if (generated?.image?.imageBytes) {
        const imageBuffer = Buffer.from(generated.image.imageBytes, 'base64');
        return {
          imageBuffer,
          mimeType: 'image/png',
          seedUsed: options.seed,
        };
      }

      logger.warn('Imagen response contained no images. Falling back to synthetic PNG.');
      return this.fallback.generateSceneVisual(options);
    } catch (error: any) {
      logger.warn('Imagen 3 API call failed. Activating deterministic synthetic fallback.', {
        error: error.message,
        promptSample: options.prompt.substring(0, 60),
      });
      return this.fallback.generateSceneVisual(options);
    }
  }

  /**
   * Generates a character turnaround portrait with Imagen or fallback.
   */
  async generateCharacterTurnaround(characterPrompt: string, style: string): Promise<GeneratedImageResult> {
    if (!this.aiClient) {
      return this.fallback.generateCharacterTurnaround(characterPrompt, style);
    }

    try {
      const response = await this.aiClient.models.generateImages({
        model: this.modelName,
        prompt: `${characterPrompt}. Art direction: ${style}. Clean 1:1 character turnaround model sheet.`,
        config: {
          numberOfImages: 1,
          aspectRatio: '1:1',
          outputMimeType: 'image/png',
        },
      });

      const generated = response.generatedImages?.[0];
      if (generated?.image?.imageBytes) {
        return {
          imageBuffer: Buffer.from(generated.image.imageBytes, 'base64'),
          mimeType: 'image/png',
        };
      }

      return this.fallback.generateCharacterTurnaround(characterPrompt, style);
    } catch (error: any) {
      logger.warn('Imagen character generation failed. Falling back to synthetic.', { error: error.message });
      return this.fallback.generateCharacterTurnaround(characterPrompt, style);
    }
  }

  /**
   * Generates a 1280x720 YouTube Thumbnail with Imagen or fallback.
   */
  async generateThumbnail(title: string, overlayText: string, heroVisualPrompt: string): Promise<GeneratedImageResult> {
    if (!this.aiClient) {
      return this.fallback.generateThumbnail(title, overlayText, heroVisualPrompt);
    }

    try {
      const prompt = `Cinematic 16:9 YouTube video thumbnail for children animation: "${title}". Featuring ${heroVisualPrompt}. Large bold text space on left reading: "${overlayText}". Ultra high quality, vivid lighting, 3D animated movie render.`;
      const response = await this.aiClient.models.generateImages({
        model: this.modelName,
        prompt,
        config: {
          numberOfImages: 1,
          aspectRatio: '16:9',
          outputMimeType: 'image/png',
        },
      });

      const generated = response.generatedImages?.[0];
      if (generated?.image?.imageBytes) {
        return {
          imageBuffer: Buffer.from(generated.image.imageBytes, 'base64'),
          mimeType: 'image/png',
        };
      }

      return this.fallback.generateThumbnail(title, overlayText, heroVisualPrompt);
    } catch (error: any) {
      logger.warn('Imagen thumbnail generation failed. Falling back to synthetic.', { error: error.message });
      return this.fallback.generateThumbnail(title, overlayText, heroVisualPrompt);
    }
  }
}
