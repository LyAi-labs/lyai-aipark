import { createHash } from 'node:crypto';

/**
 * Consistency Engine for 3D Cartoon Characters and Episodic Scenes.
 * Orchestrates master prompt synthesis, style preservation, negative prompt enforcement,
 * and deterministic seed derivation.
 */

export interface MasterCharacterProfile {
  name: string;
  species: string;
  colorPalette: string[];
  clothing: string;
  visualFeatures: string;
  visualConsistencyPrompt?: string;
  masterPrompt?: string;
}

export interface SceneVisualComposition {
  sceneIndex: number;
  location: string;
  timeOfDay: string;
  action: string;
  camera: string;
  characters: string[];
  visualPrompt: string;
  seriesStyle?: string;
}

export interface CompiledVisualPrompt {
  positivePrompt: string;
  negativePrompt: string;
  aspectRatio: '16:9' | '9:16' | '1:1';
  seed: number;
  stylePreset: string;
}

const DEFAULT_SERIES_STYLE =
  'Pixar and Dreamworks 3D animation style, adorable preschool characters, vibrant friendly color palette, soft ambient lighting, Octane Render, clean topology, warm and whimsical';

const MANDATORY_NEGATIVE_PROMPT =
  'photorealistic, realistic human skin, terrifying, dark, sinister, blood, horror, deformed, distorted limbs, bad anatomy, blurry, low resolution, watermark, text overlay, violent, sharp edges';

/**
 * Computes a deterministic 32-bit unsigned integer seed from string tokens.
 */
export function deriveDeterministicSeed(...tokens: (string | number | undefined)[]): number {
  const input = tokens.filter(t => t !== undefined).join('::');
  const hash = createHash('sha256').update(input).digest();
  return hash.readUInt32BE(0);
}

export class ConsistencyEngine {
  /**
   * Compiles an image generation prompt for a specific storyboard scene,
   * injecting master character consistency profiles and scene lighting.
   */
  static compileScenePrompt(
    scene: SceneVisualComposition,
    characters: MasterCharacterProfile[] = [],
    customStyle?: string
  ): CompiledVisualPrompt {
    const style = customStyle || scene.seriesStyle || DEFAULT_SERIES_STYLE;

    // Build character consistency snippet
    const activeChars = characters.filter(c =>
      scene.characters.some(sc => sc.toLowerCase().includes(c.name.toLowerCase()))
    );

    const charDescriptions = activeChars.map(c => {
      const palette = c.colorPalette.length > 0 ? `colors: [${c.colorPalette.join(', ')}]` : '';
      const promptSnippet = c.visualConsistencyPrompt || c.visualFeatures || '';
      return `${c.name} the ${c.species} (${promptSnippet}, wearing ${c.clothing}, ${palette})`;
    }).join('; ');

    const timeOfDayNormalized = normalizeTimeOfDay(scene.timeOfDay);
    const cameraPrompt = normalizeCamera(scene.camera);

    const parts = [
      `Cinematic 16:9 3D cartoon scene: ${scene.visualPrompt || scene.action}.`,
      `Setting: ${scene.location}, during ${timeOfDayNormalized}.`,
      activeChars.length > 0 ? `Featuring: ${charDescriptions}.` : '',
      `Action: ${scene.action}.`,
      `Camera framing: ${cameraPrompt}.`,
      `Art direction: ${style}.`
    ].filter(p => p.length > 0);

    const positivePrompt = parts.join(' ');
    const seed = deriveDeterministicSeed(scene.sceneIndex, scene.location, scene.timeOfDay, charDescriptions);

    return {
      positivePrompt,
      negativePrompt: MANDATORY_NEGATIVE_PROMPT,
      aspectRatio: '16:9',
      seed,
      stylePreset: '3d-cartoon-animation',
    };
  }

  /**
   * Compiles an image generation prompt for a character turnaround or model sheet portrait.
   */
  static compileCharacterTurnaround(
    character: MasterCharacterProfile,
    customStyle?: string
  ): CompiledVisualPrompt {
    const style = customStyle || DEFAULT_SERIES_STYLE;
    const paletteStr = character.colorPalette.length > 0
      ? `Color palette: ${character.colorPalette.join(', ')}.`
      : '';

    const positivePrompt = [
      `Character design model sheet and 3D turnaround of ${character.name} the ${character.species}.`,
      `Features: ${character.visualFeatures}.`,
      `Outfit: ${character.clothing}.`,
      character.visualConsistencyPrompt ? `Visual details: ${character.visualConsistencyPrompt}.` : '',
      paletteStr,
      `Front, 3/4 and side view, neutral studio lighting, clean solid grey background, high detail model sheet.`,
      `Art direction: ${style}.`
    ].filter(p => p.length > 0).join(' ');

    const seed = deriveDeterministicSeed(character.name, character.species, character.clothing);

    return {
      positivePrompt,
      negativePrompt: MANDATORY_NEGATIVE_PROMPT + ', complex background, clutter',
      aspectRatio: '1:1',
      seed,
      stylePreset: 'character-sheet',
    };
  }

  /**
   * Compiles an image generation prompt for a high-impact YouTube thumbnail (1280x720 / 16:9).
   */
  static compileThumbnailPrompt(
    title: string,
    overlayText: string,
    heroCharacter: MasterCharacterProfile,
    customStyle?: string
  ): CompiledVisualPrompt {
    const style = customStyle || DEFAULT_SERIES_STYLE;

    const positivePrompt = [
      `High-energy 16:9 cinematic YouTube thumbnail for kids animated cartoon: "${title}".`,
      `Featuring prominent hero character ${heroCharacter.name} the ${heroCharacter.species} on the right side with huge expressive curious eyes and joyful smile.`,
      `Dramatic glowing warm background lighting, sparkles, mystery treasure chest or magical discovery in center.`,
      `Vivid contrasting colors, high saturation, sharp focus on character expressions, YouTube Kids masterpiece.`,
      `Art direction: ${style}.`
    ].join(' ');

    const seed = deriveDeterministicSeed('thumbnail', title, overlayText, heroCharacter.name);

    return {
      positivePrompt,
      negativePrompt: MANDATORY_NEGATIVE_PROMPT + ', dull colors, dark mood, empty frame',
      aspectRatio: '16:9',
      seed,
      stylePreset: 'youtube-thumbnail-hero',
    };
  }
}

function normalizeTimeOfDay(time: string): string {
  const t = (time || '').toLowerCase();
  if (t.includes('sunset') || t.includes('tarde') || t.includes('puesta') || t.includes('atardecer')) {
    return 'golden hour sunset with warm orange and pink sky glow';
  }
  if (t.includes('night') || t.includes('noche') || t.includes('luna')) {
    return 'peaceful starry night with soft blue moonlight glow';
  }
  if (t.includes('noon') || t.includes('mediodía') || t.includes('claro')) {
    return 'bright midday sun with crisp clear blue sky';
  }
  return 'warm sunny morning with soft golden volumetric sunbeams';
}

function normalizeCamera(camera: string): string {
  const c = (camera || '').toLowerCase();
  if (c.includes('close') || c.includes('primer')) {
    return 'cinematic medium close-up shot focused on character facial emotion';
  }
  if (c.includes('wide') || c.includes('general') || c.includes('paisaje')) {
    return 'wide cinematic landscape establishing shot with depth of field';
  }
  if (c.includes('low') || c.includes('contrapicado')) {
    return 'dynamic low angle heroic shot';
  }
  return 'medium eye-level cinematic shot with subtle parallax';
}
