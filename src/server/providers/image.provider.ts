/**
 * Image Generation Provider Interface
 * Decouples visual generation from Imagen 3, Stable Diffusion, Flux, or DALL-E.
 */

export interface ImageGenerationOptions {
  prompt: string;
  negativePrompt?: string;
  aspectRatio: '16:9' | '9:16' | '1:1';
  stylePreset?: string;
  seed?: number;
  width?: number;
  height?: number;
}

export interface GeneratedImageResult {
  imageBuffer: Buffer;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  seedUsed?: number;
}

export interface ImageProvider {
  generateSceneVisual(options: ImageGenerationOptions): Promise<GeneratedImageResult>;
  generateCharacterTurnaround(characterPrompt: string, style: string): Promise<GeneratedImageResult>;
  generateThumbnail(title: string, overlayText: string, heroVisualPrompt: string): Promise<GeneratedImageResult>;
}
