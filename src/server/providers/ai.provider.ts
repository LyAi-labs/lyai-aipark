/**
 * AI Provider Interface
 * Decouples business logic from specific LLM implementations (Gemini, Claude, GPT, etc.).
 */

export interface StoryGenerationPrompt {
  idea: string;
  title?: string;
  targetAge?: string;
  language?: string;
  durationCategory?: string;
  educationalObjective?: string;
  tone?: string;
  numberOfScenes?: number;
  seriesContext?: Record<string, unknown>;
}

export interface StoryGenerationResult {
  title: string;
  logline: string;
  target_age: string;
  educational_objective: string;
  characters: Array<{
    name: string;
    species: string;
    personality: string;
    age: string;
    visualFeatures: string;
    clothing: string;
    colorPalette: string[];
    voiceProfile: string;
    visualConsistencyPrompt: string;
    masterPrompt: string;
  }>;
  scenes: Array<{
    scene_id: string;
    location: string;
    time: string;
    characters: string[];
    action: string;
    camera: string;
    dialogue: string;
    narration: string;
    sound_effects: string;
    music: string;
    duration: number;
    visual_prompt: string;
  }>;
  ending: string;
  moral: string;
  quality_notes: string;
}

export interface AIProviderMetrics {
  inputTokens: number;
  outputTokens: number;
  estimatedCostEur: number;
  modelUsed: string;
  isRealAi: boolean;
}

export interface AIProvider {
  generateStory(prompt: StoryGenerationPrompt): Promise<{ story: StoryGenerationResult; metrics: AIProviderMetrics }>;
  generateCharacterBible(input: Record<string, unknown>): Promise<{ character: Record<string, unknown>; isRealAi: boolean }>;
  evaluateQualityControl(story: Record<string, unknown>, targetAge?: string): Promise<{ report: Record<string, unknown>; isRealAi: boolean }>;
  generateYouTubeMetadata(story: Record<string, unknown>, language?: string, channelName?: string): Promise<{ metadata: Record<string, unknown>; isRealAi: boolean }>;
}
