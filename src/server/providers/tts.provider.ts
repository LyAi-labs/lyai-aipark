/**
 * Text-to-Speech (TTS) Provider Interface
 * Decouples speech synthesis from Google Cloud TTS, ElevenLabs, or local Piper models.
 */

export interface VoiceProfileConfig {
  voiceType: string;
  pitch: number;
  speed: number;
  timbre?: string;
  language?: string;
}

export interface SynthesisRequest {
  text: string;
  voiceProfile: VoiceProfileConfig;
  characterId: string;
  sceneId: string;
}

export interface SynthesisResult {
  audioBuffer: Buffer;
  durationSeconds: number;
  format: 'wav' | 'mp3' | 'ogg';
  mimeType: string;
}

export interface TTSProvider {
  synthesize(request: SynthesisRequest): Promise<SynthesisResult>;
  getAvailableVoices(language?: string): Promise<Array<{ id: string; name: string; gender: string; targetAgeGroup?: string }>>;
}
