/**
 * Cartoon Studio — Voice Pipeline Service
 * Phase 06: Real Voice & Audio Pipeline
 *
 * Orchestrates voice synthesis across scenes and episodes:
 * 1. Invokes TTS Provider (Google Cloud TTS with automatic synthetic fallback)
 * 2. Uploads physical .wav audio assets to StorageProvider with POSIX paths
 * 3. Calculates microsecond-accurate durations and drift metrics
 * 4. Generates aligned WebVTT and SRT subtitle tracks
 * 5. Emits telemetry to provider_executions (PostgreSQL) with exact cost computation
 */

import { TTSProvider, VoiceProfileConfig } from '../providers/tts.provider';
import { StorageProvider } from '../storage';
import { storageProvider } from '../storage/storage.factory';
import { GoogleCloudTTSProvider } from './google-tts.provider';
import { config } from '../config';
import { computeAlignedTimeline, buildSrtTrack, buildVttTrack, AlignedSceneAudio } from './subtitle.generator';
import { calculateTtsCostEur } from '../ai/cost.calculator';
import { telemetryService } from '../ai/telemetry.service';
import { ProviderType } from '@prisma/client';
import { logger } from '../utils/logger';

export interface SceneSynthesisInput {
  episodeId: string;
  sceneIndex: number;
  sceneCode: string;
  text: string;
  speakerName?: string;
  voiceProfile?: Partial<VoiceProfileConfig>;
  nominalDuration?: number;
}

export interface SceneAudioResult {
  sceneIndex: number;
  sceneCode: string;
  storageKey: string;
  publicUrl: string;
  durationSeconds: number;
  nominalDurationSeconds: number;
  driftSeconds: number;
  mimeType: string;
  costEur: number;
  speakerName?: string;
  text: string;
}

export interface EpisodeBatchResult {
  episodeId: string;
  scenes: SceneAudioResult[];
  totalAudioDurationSeconds: number;
  totalEpisodeDurationSeconds: number;
  maxDriftSeconds: number;
  subtitlesVttUrl: string;
  subtitlesSrtUrl: string;
  totalCostEur: number;
}

export class VoicePipelineService {
  private readonly tts: TTSProvider;
  private readonly storage: StorageProvider;

  constructor(tts?: TTSProvider, storage?: StorageProvider) {
    this.tts = tts || new GoogleCloudTTSProvider({
      apiKey: config.tts.apiKey,
      defaultLanguage: config.tts.defaultLanguage,
    });
    this.storage = storage || storageProvider;
  }

  /**
   * Synthesizes audio for a single scene, stores the .wav file, and records telemetry.
   */
  public async synthesizeSceneAudio(input: SceneSynthesisInput): Promise<SceneAudioResult> {
    const {
      episodeId,
      sceneIndex,
      sceneCode,
      text,
      speakerName = 'Narrator',
      voiceProfile = {},
      nominalDuration = 15,
    } = input;

    const startTime = Date.now();
    const cleanText = text.trim();

    const fullProfile: VoiceProfileConfig = {
      voiceType: voiceProfile.voiceType || (config.tts.defaultVoice || 'es-ES-Neural2-A'),
      pitch: voiceProfile.pitch ?? 1.0,
      speed: voiceProfile.speed ?? 1.0,
      timbre: voiceProfile.timbre,
      language: voiceProfile.language || config.tts.defaultLanguage,
    };

    logger.info(`Starting voice synthesis for episode [${episodeId}] scene [${sceneCode}]`, {
      speaker: speakerName,
      textLength: cleanText.length,
      voiceType: fullProfile.voiceType,
    });

    const result = await this.tts.synthesize({
      text: cleanText,
      voiceProfile: fullProfile,
      characterId: speakerName,
      sceneId: sceneCode,
    });

    const latencyMs = Date.now() - startTime;
    const costEur = calculateTtsCostEur(cleanText.length);

    // Build POSIX normalized key for StorageProvider
    const storageKey = `episodes/${episodeId}/scenes/${sceneCode}/voice.wav`;
    await this.storage.upload(storageKey, result.audioBuffer, result.mimeType);
    const publicUrl = this.storage.getPublicUrl(storageKey);

    const driftSeconds = Number((result.durationSeconds - nominalDuration).toFixed(3));

    // Persist provider execution telemetry in PostgreSQL
    await telemetryService.recordExecution({
      episodeId,
      provider: config.tts.hasApiKey ? ProviderType.GOOGLE_TTS : ProviderType.GEMINI,
      modelOrService: fullProfile.voiceType,
      operation: 'synthesize-voice-scene',
      requestPayload: {
        episodeId,
        sceneCode,
        speakerName,
        text: cleanText,
        voiceProfile: fullProfile,
      },
      latencyMs,
      httpStatus: 200,
      inputUnits: cleanText.length, // Characters synthesized
      outputUnits: Math.round(result.durationSeconds * 1000), // ms audio output
      costEur,
    });

    return {
      sceneIndex,
      sceneCode,
      storageKey,
      publicUrl,
      durationSeconds: result.durationSeconds,
      nominalDurationSeconds: nominalDuration,
      driftSeconds,
      mimeType: result.mimeType,
      costEur,
      speakerName,
      text: cleanText,
    };
  }

  /**
   * Synthesizes audio for all scenes of an episode, builds subtitle tracks, and uploads them.
   */
  public async synthesizeEpisodeBatch(
    episodeId: string,
    scenes: Array<{
      sceneIndex: number;
      sceneCode: string;
      dialogue?: string;
      narration?: string;
      speakerName?: string;
      voiceProfile?: Partial<VoiceProfileConfig>;
      duration?: number;
    }>
  ): Promise<EpisodeBatchResult> {
    const sceneResults: SceneAudioResult[] = [];
    let totalCostEur = 0;

    for (const sc of scenes) {
      const textToSpeak = sc.dialogue || sc.narration || '';
      if (!textToSpeak.trim()) {
        continue;
      }

      const res = await this.synthesizeSceneAudio({
        episodeId,
        sceneIndex: sc.sceneIndex,
        sceneCode: sc.sceneCode,
        text: textToSpeak,
        speakerName: sc.speakerName,
        voiceProfile: sc.voiceProfile,
        nominalDuration: sc.duration || 15,
      });

      sceneResults.push(res);
      totalCostEur += res.costEur;
    }

    // Compute aligned timeline & subtitles
    const timelineData = computeAlignedTimeline(
      sceneResults.map((sr) => ({
        sceneIndex: sr.sceneIndex,
        sceneCode: sr.sceneCode,
        nominalDuration: sr.nominalDurationSeconds,
        audioDuration: sr.durationSeconds,
        speaker: sr.speakerName,
        text: sr.text,
      }))
    );

    const vttContent = buildVttTrack(timelineData.cues, `Episode ${episodeId} Dialogues`);
    const srtContent = buildSrtTrack(timelineData.cues);

    const vttKey = `episodes/${episodeId}/subtitles/dialogue.vtt`;
    const srtKey = `episodes/${episodeId}/subtitles/dialogue.srt`;

    await this.storage.upload(vttKey, Buffer.from(vttContent, 'utf-8'), 'text/vtt');
    await this.storage.upload(srtKey, Buffer.from(srtContent, 'utf-8'), 'application/x-subrip');

    return {
      episodeId,
      scenes: sceneResults,
      totalAudioDurationSeconds: timelineData.totalAudioDurationSeconds,
      totalEpisodeDurationSeconds: timelineData.totalEpisodeDurationSeconds,
      maxDriftSeconds: timelineData.maxDriftSeconds,
      subtitlesVttUrl: this.storage.getPublicUrl(vttKey),
      subtitlesSrtUrl: this.storage.getPublicUrl(srtKey),
      totalCostEur: Number(totalCostEur.toFixed(6)),
    };
  }

  /**
   * Quick audition of a character's voice with a sample text phrase.
   */
  public async auditionCharacterVoice(
    characterName: string,
    sampleText: string,
    voiceProfile: Partial<VoiceProfileConfig>
  ): Promise<{ audioBuffer: Buffer; durationSeconds: number; mimeType: string }> {
    const fullProfile: VoiceProfileConfig = {
      voiceType: voiceProfile.voiceType || 'es-ES-Neural2-A',
      pitch: voiceProfile.pitch ?? 1.0,
      speed: voiceProfile.speed ?? 1.0,
      timbre: voiceProfile.timbre,
      language: voiceProfile.language || 'es-ES',
    };

    const res = await this.tts.synthesize({
      text: sampleText,
      voiceProfile: fullProfile,
      characterId: characterName,
      sceneId: 'audition',
    });

    return {
      audioBuffer: res.audioBuffer,
      durationSeconds: res.durationSeconds,
      mimeType: res.mimeType,
    };
  }
}

export const voicePipelineService = new VoicePipelineService();
