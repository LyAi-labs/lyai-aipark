/**
 * Cartoon Studio — AI Domain Schemas & Contracts
 * Phase 04: Robust AI Generation & Prompt Hardening
 *
 * Enforces 100% strict Zod validation for inputs and AI outputs.
 */

import { z } from 'zod';

// ==============================================================================
// 1. INPUT SCHEMAS (Request Validation)
// ==============================================================================

export const GenerateStoryInputSchema = z.object({
  idea: z.string().min(1, 'La idea de la historia es obligatoria').max(1000, 'La idea no puede superar 1000 caracteres'),
  title: z.string().max(150, 'El título no puede superar 150 caracteres').optional(),
  targetAge: z.string().max(50).default('4-6 years'),
  language: z.string().max(50).default('Spanish'),
  duration: z.string().max(50).optional(),
  educationalObjective: z.string().max(500).default('Teaching empathy, problem solving and sharing'),
  tone: z.string().max(100).default('Warm, humorous and curious'),
  numberOfScenes: z.coerce.number().int().min(1).max(12).default(4),
  seriesContext: z.record(z.string(), z.unknown()).optional(),
  episodeId: z.string().uuid().optional(),
});

export type GenerateStoryInput = z.infer<typeof GenerateStoryInputSchema>;

export const GenerateCharacterInputSchema = z.object({
  name: z.string().max(100).default('Oliver'),
  species: z.string().max(100).default('Oso pequeño'),
  personality: z.string().max(300).default('Curioso y comilón'),
  age: z.string().max(50).default('5'),
  seriesStyle: z.string().max(250).default('3D stylized cartoon, rounded shapes, Pixar-inspired, soft textures'),
  episodeId: z.string().uuid().optional(),
});

export type GenerateCharacterInput = z.infer<typeof GenerateCharacterInputSchema>;

export const QualityControlInputSchema = z.object({
  story: z.object({
    title: z.string().min(1),
    logline: z.string().min(1),
    educational_objective: z.string().default('Valores y aprendizaje infantil'),
    scenes: z.array(z.object({
      scene_id: z.string().optional(),
      action: z.string().optional(),
      dialogue: z.string().optional(),
    })).optional(),
  }).passthrough(),
  targetAge: z.string().max(50).default('4-6'),
  episodeId: z.string().uuid().optional(),
});

export type QualityControlInput = z.infer<typeof QualityControlInputSchema>;

export const GenerateMetadataInputSchema = z.object({
  story: z.object({
    title: z.string().min(1),
    logline: z.string().min(1),
    moral: z.string().optional(),
  }).passthrough(),
  language: z.string().max(50).default('Spanish'),
  channelName: z.string().max(100).default('KidsToon Studio'),
  episodeId: z.string().uuid().optional(),
});

export type GenerateMetadataInput = z.infer<typeof GenerateMetadataInputSchema>;

// ==============================================================================
// 2. OUTPUT SCHEMAS (Gemini Response Validation)
// ==============================================================================

export const StoryCharacterSchema = z.object({
  name: z.string().min(1),
  species: z.string().min(1),
  personality: z.string().min(1),
  age: z.string().min(1),
  visualFeatures: z.string().min(1),
  clothing: z.string().min(1),
  colorPalette: z.array(z.string()).min(1),
  voiceProfile: z.string().min(1),
  visualConsistencyPrompt: z.string().min(1),
  masterPrompt: z.string().min(1),
});

export type StoryCharacter = z.infer<typeof StoryCharacterSchema>;

export const StorySceneSchema = z.object({
  scene_id: z.string().min(1),
  location: z.string().min(1),
  time: z.string().min(1),
  characters: z.array(z.string()).default([]),
  action: z.string().min(1),
  camera: z.string().min(1),
  dialogue: z.string().default(''),
  narration: z.string().default(''),
  sound_effects: z.string().default(''),
  music: z.string().default(''),
  duration: z.coerce.number().positive(),
  visual_prompt: z.string().min(1),
});

export type StoryScene = z.infer<typeof StorySceneSchema>;

export const StoryOutputSchema = z.object({
  title: z.string().min(1),
  logline: z.string().min(1),
  target_age: z.string().min(1),
  educational_objective: z.string().min(1),
  characters: z.array(StoryCharacterSchema).min(1),
  scenes: z.array(StorySceneSchema).min(1),
  ending: z.string().min(1),
  moral: z.string().min(1),
  quality_notes: z.string().default(''),
});

export type StoryOutput = z.infer<typeof StoryOutputSchema>;

export const CharacterVoiceProfileSchema = z.object({
  voiceType: z.string().min(1),
  pitch: z.coerce.number().min(0.5).max(2.0).default(1.0),
  speed: z.coerce.number().min(0.5).max(2.0).default(1.0),
  timbre: z.string().min(1),
});

export const CharacterBibleOutputSchema = z.object({
  name: z.string().min(1),
  species: z.string().min(1),
  tagline: z.string().default(''),
  personality: z.string().min(1),
  colorPalette: z.array(z.string()).min(1),
  visualFeatures: z.string().min(1),
  clothing: z.string().min(1),
  voiceProfile: CharacterVoiceProfileSchema,
  visualConsistencyPrompt: z.string().min(1),
  masterPrompt: z.string().min(1),
  turnaroundNotes: z.string().default(''),
});

export type CharacterBibleOutput = z.infer<typeof CharacterBibleOutputSchema>;

export const QCCategoryReportSchema = z.object({
  score: z.coerce.number().min(0).max(100),
  status: z.enum(['pass', 'warning', 'fail']),
  notes: z.string().default(''),
});

export const QCReportOutputSchema = z.object({
  overallScore: z.coerce.number().min(0).max(100),
  approvedForProduction: z.boolean(),
  categories: z.record(z.string(), QCCategoryReportSchema),
  flags: z.array(z.string()).default([]),
  recommendations: z.array(z.string()).default([]),
});

export type QCReportOutput = z.infer<typeof QCReportOutputSchema>;

export const YouTubeMetadataOutputSchema = z.object({
  title: z.string().min(1).max(100),
  description: z.string().min(1),
  tags: z.array(z.string()).min(1),
  hashtags: z.array(z.string()).default([]),
  // COPPA Invariant: strictly true for kids animation
  madeForKids: z.literal(true),
  privacyStatus: z.enum(['private', 'unlisted', 'public']).default('private'),
  category: z.string().default('Film & Animation (1)'),
  thumbnailOverlayText: z.string().max(60).default(''),
  recommendedPlaylist: z.string().default(''),
  coppaComplianceConfirmed: z.boolean().default(true),
  monetizationNotice: z.string().default(''),
});

export type YouTubeMetadataOutput = z.infer<typeof YouTubeMetadataOutputSchema>;
