/**
 * Cartoon Studio — Google Cloud Text-to-Speech Provider
 * Phase 06: Real Voice & Audio Pipeline
 *
 * Implements Google Cloud TTS REST API with Neural2 & Journey voices.
 * Translates character pitch & speed modifiers, ensures linear PCM WAV format,
 * and provides seamless deterministic fallback to synthetic wave synthesis
 * when credentials are unconfigured or in offline/development environments.
 */

import { TTSProvider, SynthesisRequest, SynthesisResult, VoiceProfileConfig } from '../providers/tts.provider';
import { ensureWavWithHeader, parseWavInfo, generateSyntheticVoiceWave } from './wav.utils';
import { VOICE_CATALOG, findVoicePresetById } from './voice.catalog';
import { logger } from '../utils/logger';

export interface GoogleTtsOptions {
  apiKey?: string;
  defaultLanguage?: string;
  endpoint?: string;
  timeoutMs?: number;
}

export class GoogleCloudTTSProvider implements TTSProvider {
  private readonly apiKey: string;
  private readonly defaultLanguage: string;
  private readonly endpoint: string;
  private readonly timeoutMs: number;

  constructor(options: GoogleTtsOptions = {}) {
    this.apiKey = options.apiKey || '';
    this.defaultLanguage = options.defaultLanguage || 'es-ES';
    this.endpoint = options.endpoint || 'https://texttospeech.googleapis.com/v1/text:synthesize';
    this.timeoutMs = options.timeoutMs || 10000;
  }

  /**
   * Converts linear pitch multiplier (0.5 to 1.8) to Google Cloud TTS semitones (-10.0 to +10.0).
   */
  private pitchToSemitones(pitchMultiplier: number): number {
    const clamped = Math.max(0.5, Math.min(1.8, pitchMultiplier));
    // 1.0 -> 0 semitones. 1.25 -> ~3.8 semitones. 0.8 -> -3.8 semitones.
    const semitones = 12 * Math.log2(clamped);
    return Number(Math.max(-10.0, Math.min(10.0, semitones)).toFixed(2));
  }

  /**
   * Resolves voice parameters from profile config.
   */
  private resolveVoiceParams(profile: VoiceProfileConfig): {
    languageCode: string;
    voiceName: string;
    ssmlGender: 'FEMALE' | 'MALE' | 'NEUTRAL';
  } {
    const preset = findVoicePresetById(profile.voiceType);
    if (preset) {
      return {
        languageCode: preset.language,
        voiceName: preset.providerVoiceId,
        ssmlGender: preset.gender,
      };
    }

    const languageCode = profile.language || this.defaultLanguage;
    return {
      languageCode,
      voiceName: profile.voiceType || (languageCode.startsWith('es') ? 'es-ES-Neural2-A' : 'en-US-Neural2-A'),
      ssmlGender: 'FEMALE',
    };
  }

  public async synthesize(request: SynthesisRequest): Promise<SynthesisResult> {
    const { text, voiceProfile, characterId, sceneId } = request;
    const cleanText = text.trim();

    if (!cleanText) {
      throw new Error('SynthesisRequest text cannot be empty');
    }

    // If no API key configured, use deterministic local synthetic wave generator
    if (!this.apiKey) {
      logger.info('TTS API Key not present. Generating deterministic synthetic WAV audio.', {
        characterId,
        sceneId,
        pitch: voiceProfile.pitch,
        speed: voiceProfile.speed,
      });

      const synthetic = generateSyntheticVoiceWave(cleanText, {
        pitch: voiceProfile.pitch,
        speed: voiceProfile.speed,
        language: voiceProfile.language || this.defaultLanguage,
      });

      return {
        audioBuffer: synthetic.buffer,
        durationSeconds: synthetic.durationSeconds,
        format: 'wav',
        mimeType: 'audio/wav',
      };
    }

    const voiceParams = this.resolveVoiceParams(voiceProfile);
    const semitones = this.pitchToSemitones(voiceProfile.pitch);
    const speedClamped = Math.max(0.6, Math.min(1.4, voiceProfile.speed || 1.0));

    const payload = {
      input: { text: cleanText },
      voice: {
        languageCode: voiceParams.languageCode,
        name: voiceParams.voiceName,
        ssmlGender: voiceParams.ssmlGender,
      },
      audioConfig: {
        audioEncoding: 'LINEAR16', // Uncompressed 16-bit PCM (WAV)
        sampleRateHertz: 24000,
        speakingRate: speedClamped,
        pitch: semitones,
      },
    };

    try {
      const url = `${this.endpoint}?key=${encodeURIComponent(this.apiKey)}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Google Cloud TTS error HTTP ${response.status}: ${errorText}`);
      }

      const data: any = await response.json();
      if (!data.audioContent) {
        throw new Error('Google Cloud TTS response missing audioContent');
      }

      const rawBuffer = Buffer.from(data.audioContent, 'base64');
      const wavBuffer = ensureWavWithHeader(rawBuffer, {
        numChannels: 1,
        sampleRate: 24000,
        bitsPerSample: 16,
      });

      const info = parseWavInfo(wavBuffer);

      return {
        audioBuffer: wavBuffer,
        durationSeconds: info.durationSeconds,
        format: 'wav',
        mimeType: 'audio/wav',
      };
    } catch (err: any) {
      logger.warn('Google Cloud TTS request failed. Falling back to synthetic WAV generator.', {
        error: err.message,
        characterId,
        sceneId,
      });

      const synthetic = generateSyntheticVoiceWave(cleanText, {
        pitch: voiceProfile.pitch,
        speed: voiceProfile.speed,
        language: voiceProfile.language || this.defaultLanguage,
      });

      return {
        audioBuffer: synthetic.buffer,
        durationSeconds: synthetic.durationSeconds,
        format: 'wav',
        mimeType: 'audio/wav',
      };
    }
  }

  public async getAvailableVoices(language?: string): Promise<Array<{ id: string; name: string; gender: string; targetAgeGroup?: string }>> {
    const list = language
      ? VOICE_CATALOG.filter((v) => v.language.toLowerCase().startsWith(language.toLowerCase().slice(0, 2)))
      : VOICE_CATALOG;

    return list.map((v) => ({
      id: v.id,
      name: v.name,
      gender: v.gender,
      targetAgeGroup: v.targetAgeGroup,
    }));
  }
}
