/**
 * Cartoon Studio — Real Voice & Audio Pipeline Test Suite
 * Phase 06: Voice Synthesis, WAV Mechanical Engine, Subtitles & Telemetry
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import {
  createWavHeader,
  parseWavInfo,
  ensureWavWithHeader,
  generateSyntheticVoiceWave,
  isWavBuffer,
  WavFormatError,
} from './wav.utils';
import {
  formatSrtTimestamp,
  formatVttTimestamp,
  buildSrtTrack,
  buildVttTrack,
  computeAlignedTimeline,
} from './subtitle.generator';
import { VOICE_CATALOG, findVoicePresetById, getVoicesForLanguage } from './voice.catalog';
import { GoogleCloudTTSProvider } from './google-tts.provider';
import { VoicePipelineService } from './voice.service';
import { voiceRouter } from './voice.router';
import { LocalStorageProvider } from '../storage/local.storage';
import { calculateTtsCostEur } from '../ai/cost.calculator';
import { signAccessToken } from '../auth/jwt.service';
import { telemetryService } from '../ai/telemetry.service';
import fs from 'node:fs';
import path from 'node:path';

const TEST_STORAGE_DIR = path.resolve('./storage/test_audio_vault');
process.env['JWT_SECRET'] = 'cartoon-studio-test-secret-at-least-32-chars-long';

describe('Phase 06 — Real Voice & Audio Pipeline', () => {
  beforeEach(() => {
    vi.spyOn(telemetryService, 'recordExecution').mockResolvedValue();
    if (fs.existsSync(TEST_STORAGE_DIR)) {
      fs.rmSync(TEST_STORAGE_DIR, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(TEST_STORAGE_DIR)) {
      fs.rmSync(TEST_STORAGE_DIR, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // 1. WAV Mechanical Header & Binary Encoding
  // --------------------------------------------------------------------------
  describe('1. WAV Mechanical Header & Binary Encoding', () => {
    it('creates a standard 44-byte RIFF/WAVE PCM header with correct byte offsets', () => {
      const header = createWavHeader({
        numChannels: 1,
        sampleRate: 24000,
        bitsPerSample: 16,
        dataSize: 48000, // Exactly 1 second of mono 24kHz 16-bit audio
      });

      expect(header.length).toBe(44);
      expect(header.subarray(0, 4).toString('ascii')).toBe('RIFF');
      expect(header.readUInt32LE(4)).toBe(36 + 48000); // 48036 totalFileSize - 8
      expect(header.subarray(8, 12).toString('ascii')).toBe('WAVE');
      expect(header.subarray(12, 16).toString('ascii')).toBe('fmt ');
      expect(header.readUInt32LE(16)).toBe(16); // Subchunk1Size
      expect(header.readUInt16LE(20)).toBe(1); // PCM format = 1
      expect(header.readUInt16LE(22)).toBe(1); // Mono
      expect(header.readUInt32LE(24)).toBe(24000); // Sample rate
      expect(header.readUInt32LE(28)).toBe(48000); // Byte rate (24000 * 1 * 2)
      expect(header.readUInt16LE(32)).toBe(2); // Block align (1 * 2)
      expect(header.readUInt16LE(34)).toBe(16); // Bits per sample
      expect(header.subarray(36, 40).toString('ascii')).toBe('data');
      expect(header.readUInt32LE(40)).toBe(48000); // Data size
    });

    it('identifies valid and invalid WAV buffers using isWavBuffer', () => {
      const valid = createWavHeader({ dataSize: 100 });
      const invalid = Buffer.from('NOT_A_WAV_FILE_BUFFER_FOR_TESTING');

      expect(isWavBuffer(valid)).toBe(true);
      expect(isWavBuffer(invalid)).toBe(false);
      expect(isWavBuffer(Buffer.alloc(4))).toBe(false);
    });

    it('throws WavFormatError if buffer is smaller than 44 bytes', () => {
      expect(() => parseWavInfo(Buffer.alloc(20))).toThrow(WavFormatError);
    });

    it('throws WavFormatError if magic bytes are not RIFF/WAVE', () => {
      const bad = Buffer.alloc(44);
      bad.write('ABCD', 0, 4, 'ascii');
      expect(() => parseWavInfo(bad)).toThrow(WavFormatError);
    });
  });

  // --------------------------------------------------------------------------
  // 2. WAV Audio Info & Duration Parsing
  // --------------------------------------------------------------------------
  describe('2. WAV Audio Info & Duration Parsing', () => {
    it('accurately parses sample rate, channels, and calculates duration in seconds', () => {
      const sampleRate = 24000;
      const dataSize = 72000; // 72000 bytes / (24000 * 2 bytes/sample) = exactly 1.500 seconds
      const header = createWavHeader({
        numChannels: 1,
        sampleRate,
        bitsPerSample: 16,
        dataSize,
      });
      const pcmPayload = Buffer.alloc(dataSize);
      const fullWav = Buffer.concat([header, pcmPayload]);

      const info = parseWavInfo(fullWav);
      expect(info.numChannels).toBe(1);
      expect(info.sampleRate).toBe(24000);
      expect(info.bitsPerSample).toBe(16);
      expect(info.dataSize).toBe(72000);
      expect(info.durationSeconds).toBe(1.500);
    });

    it('ensureWavWithHeader returns buffer unchanged if it already has a WAV header', () => {
      const header = createWavHeader({ dataSize: 50 });
      const sample = Buffer.concat([header, Buffer.alloc(50)]);
      const ensured = ensureWavWithHeader(sample);

      expect(ensured.length).toBe(sample.length);
      expect(ensured.subarray(0, 4).toString('ascii')).toBe('RIFF');
    });

    it('ensureWavWithHeader prepends 44-byte header if raw PCM buffer is passed', () => {
      const rawPcm = Buffer.alloc(4800);
      const ensured = ensureWavWithHeader(rawPcm, { sampleRate: 24000 });

      expect(ensured.length).toBe(4800 + 44);
      expect(isWavBuffer(ensured)).toBe(true);
      const info = parseWavInfo(ensured);
      expect(info.sampleRate).toBe(24000);
      expect(info.dataSize).toBe(4800);
    });
  });

  // --------------------------------------------------------------------------
  // 3. Synthetic Speech Waveform Generator
  // --------------------------------------------------------------------------
  describe('3. Synthetic Speech Waveform Generator', () => {
    it('synthesizes a valid, audible 16-bit PCM RIFF WAV wave for text phrases', () => {
      const text = '¡Hola amigos! Bienvenidos a la gran fábrica de sueños de Milo.';
      const res = generateSyntheticVoiceWave(text, {
        pitch: 1.15,
        speed: 1.0,
      });

      expect(isWavBuffer(res.buffer)).toBe(true);
      expect(res.durationSeconds).toBeGreaterThan(1.2);
      expect(res.sampleRate).toBe(24000);

      const info = parseWavInfo(res.buffer);
      expect(info.sampleRate).toBe(24000);
      expect(info.numChannels).toBe(1);
      expect(info.durationSeconds).toBe(res.durationSeconds);
    });

    it('duration scales inversely with speed modifier', () => {
      const text = 'Una frase larga para comprobar la velocidad de síntesis.';
      const slow = generateSyntheticVoiceWave(text, { speed: 0.7 });
      const fast = generateSyntheticVoiceWave(text, { speed: 1.3 });

      expect(slow.durationSeconds).toBeGreaterThan(fast.durationSeconds);
    });

    it('clamps pitch and speed within safe physiological limits', () => {
      const extreme = generateSyntheticVoiceWave('Test', { pitch: 99.0, speed: 0.01 });
      expect(extreme.durationSeconds).toBeGreaterThan(0);
      expect(isWavBuffer(extreme.buffer)).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // 4. Voice Catalog & Archetype Presets
  // --------------------------------------------------------------------------
  describe('4. Voice Catalog & Archetype Presets', () => {
    it('contains preschool cartoon character presets', () => {
      expect(VOICE_CATALOG.length).toBeGreaterThanOrEqual(4);

      const milo = findVoicePresetById('milo-preschool');
      expect(milo).toBeDefined();
      expect(milo?.language).toBe('es-ES');
      expect(milo?.providerVoiceId).toContain('Neural2');

      const tula = findVoicePresetById('tula-hare');
      expect(tula).toBeDefined();
      expect(tula?.targetAgeGroup).toBe('child');
    });

    it('filters catalog by language', () => {
      const spanish = getVoicesForLanguage('es-ES');
      const english = getVoicesForLanguage('en-US');

      expect(spanish.length).toBeGreaterThan(0);
      expect(spanish.every((v) => v.language.startsWith('es'))).toBe(true);
      expect(english.length).toBeGreaterThan(0);
      expect(english.every((v) => v.language.startsWith('en'))).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // 5. Google Cloud TTS Provider & Resilient Fallback
  // --------------------------------------------------------------------------
  describe('5. Google Cloud TTS Provider & Resilient Fallback', () => {
    it('falls back seamlessly to synthetic WAV synthesis when API key is absent', async () => {
      const provider = new GoogleCloudTTSProvider({ apiKey: '' });
      const result = await provider.synthesize({
        text: 'Prueba de voz en modo local sin credenciales externas.',
        voiceProfile: {
          voiceType: 'es-ES-Neural2-A',
          pitch: 1.1,
          speed: 1.0,
        },
        characterId: 'Milo',
        sceneId: 'sc_01',
      });

      expect(result.format).toBe('wav');
      expect(result.mimeType).toBe('audio/wav');
      expect(result.durationSeconds).toBeGreaterThan(1.0);
      expect(isWavBuffer(result.audioBuffer)).toBe(true);
    });

    it('throws error if text is empty or whitespace only', async () => {
      const provider = new GoogleCloudTTSProvider({ apiKey: '' });
      await expect(
        provider.synthesize({
          text: '   ',
          voiceProfile: { voiceType: 'test', pitch: 1, speed: 1 },
          characterId: 'test',
          sceneId: 'test',
        })
      ).rejects.toThrow('SynthesisRequest text cannot be empty');
    });

    it('falls back safely to synthetic wave if remote fetch fails with network error', async () => {
      const provider = new GoogleCloudTTSProvider({
        apiKey: 'fake-key',
        endpoint: 'http://127.0.0.1:1/nonexistent', // Unreachable address
      });

      const result = await provider.synthesize({
        text: 'Fallback ante error de red.',
        voiceProfile: { voiceType: 'es-ES-Neural2-B', pitch: 1, speed: 1 },
        characterId: 'Narrador',
        sceneId: 'sc_02',
      });

      expect(result.format).toBe('wav');
      expect(isWavBuffer(result.audioBuffer)).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // 6. Subtitle & Timeline Alignment Engine (SRT & WebVTT)
  // --------------------------------------------------------------------------
  describe('6. Subtitle & Timeline Alignment Engine', () => {
    it('formats SRT timestamps with comma separator: 00:01:23,456', () => {
      expect(formatSrtTimestamp(0)).toBe('00:00:00,000');
      expect(formatSrtTimestamp(83.456)).toBe('00:01:23,456');
      expect(formatSrtTimestamp(3661.123)).toBe('01:01:01,123');
    });

    it('formats WebVTT timestamps with dot separator: 00:01:23.456', () => {
      expect(formatVttTimestamp(0)).toBe('00:00:00.000');
      expect(formatVttTimestamp(83.456)).toBe('00:01:23.456');
      expect(formatVttTimestamp(3661.123)).toBe('01:01:01.123');
    });

    it('builds standard SRT subtitle blocks', () => {
      const cues = [
        { index: 1, startSeconds: 0.0, endSeconds: 2.5, speaker: 'Milo', text: '¡Hola a todos!' },
        { index: 2, startSeconds: 3.0, endSeconds: 5.8, speaker: 'Tula', text: '¿Qué estamos construyendo?' },
      ];

      const srt = buildSrtTrack(cues);
      expect(srt).toContain('1\n00:00:00,000 --> 00:00:02,500\n[Milo]: ¡Hola a todos!');
      expect(srt).toContain('2\n00:00:03,000 --> 00:00:05,800\n[Tula]: ¿Qué estamos construyendo?');
    });

    it('builds standard WebVTT tracks with voice cue tags', () => {
      const cues = [
        { index: 1, startSeconds: 0.0, endSeconds: 2.5, speaker: 'Milo', text: '¡Hola a todos!' },
      ];

      const vtt = buildVttTrack(cues, 'Test Episode');
      expect(vtt).toContain('WEBVTT');
      expect(vtt).toContain('00:00:00.000 --> 00:00:02.500');
      expect(vtt).toContain('<v Milo>¡Hola a todos!</v>');
    });

    it('computes aligned timeline and drift telemetry across scenes', () => {
      const scenes = [
        { sceneIndex: 0, sceneCode: 'sc_01', nominalDuration: 15, audioDuration: 4.25, speaker: 'Milo', text: 'Escena 1' },
        { sceneIndex: 1, sceneCode: 'sc_02', nominalDuration: 15, audioDuration: 16.10, speaker: 'Tula', text: 'Escena 2' },
      ];

      const timeline = computeAlignedTimeline(scenes);
      expect(timeline.alignedScenes.length).toBe(2);
      expect(timeline.alignedScenes[0].driftSeconds).toBe(-10.75); // 4.25 - 15
      expect(timeline.alignedScenes[1].driftSeconds).toBe(1.10);  // 16.10 - 15
      expect(timeline.maxDriftSeconds).toBe(10.75);
      expect(timeline.totalAudioDurationSeconds).toBe(20.35); // 4.25 + 16.10
    });
  });

  // --------------------------------------------------------------------------
  // 7. Voice Pipeline Service & Storage Integration
  // --------------------------------------------------------------------------
  describe('7. Voice Pipeline Service & Storage Integration', () => {
    it('synthesizes scene audio, uploads WAV to StorageProvider and returns public URL', async () => {
      const testStorage = new LocalStorageProvider({
        baseDir: TEST_STORAGE_DIR,
        publicBaseUrl: '/api/assets',
        secret: 'test-secret-at-least-32-characters-long',
      });

      const fastTts = new GoogleCloudTTSProvider({ apiKey: '' });
      const service = new VoicePipelineService(fastTts, testStorage);
      const result = await service.synthesizeSceneAudio({
        episodeId: 'ep_test_01',
        sceneIndex: 0,
        sceneCode: 'sc_01',
        text: '¡Hola Milo, el tren de las sorpresas ya está listo!',
        speakerName: 'Tula',
        voiceProfile: { voiceType: 'tula-hare', pitch: 1.2, speed: 1.0 },
        nominalDuration: 10,
      });

      expect(result.storageKey).toBe('episodes/ep_test_01/scenes/sc_01/voice.wav');
      expect(result.publicUrl).toBe('/api/assets/episodes/ep_test_01/scenes/sc_01/voice.wav');
      expect(result.durationSeconds).toBeGreaterThan(1.0);
      expect(result.mimeType).toBe('audio/wav');
      expect(result.costEur).toBeGreaterThan(0);

      // Verify that the file was physically saved in the storage vault
      const physicalFile = path.join(TEST_STORAGE_DIR, 'episodes/ep_test_01/scenes/sc_01/voice.wav');
      expect(fs.existsSync(physicalFile)).toBe(true);

      const savedBuffer = fs.readFileSync(physicalFile);
      expect(isWavBuffer(savedBuffer)).toBe(true);
    });

    it('synthesizes episode batch, generating dialogue tracks and WebVTT/SRT subtitles', async () => {
      const testStorage = new LocalStorageProvider({
        baseDir: TEST_STORAGE_DIR,
        publicBaseUrl: '/api/assets',
        secret: 'test-secret-at-least-32-characters-long',
      });

      const fastTts = new GoogleCloudTTSProvider({ apiKey: '' });
      const service = new VoicePipelineService(fastTts, testStorage);
      const batchResult = await service.synthesizeEpisodeBatch('ep_batch_01', [
        {
          sceneIndex: 0,
          sceneCode: 'sc_01',
          dialogue: '¡Mira lo que encontré en la caja misteriosa!',
          speakerName: 'Milo',
        },
        {
          sceneIndex: 1,
          sceneCode: 'sc_02',
          narration: 'Y así comenzó un día lleno de descubrimientos.',
          speakerName: 'Narrador',
        },
      ]);

      expect(batchResult.scenes.length).toBe(2);
      expect(batchResult.subtitlesVttUrl).toBe('/api/assets/episodes/ep_batch_01/subtitles/dialogue.vtt');
      expect(batchResult.subtitlesSrtUrl).toBe('/api/assets/episodes/ep_batch_01/subtitles/dialogue.srt');
      expect(batchResult.totalAudioDurationSeconds).toBeGreaterThan(2.0);

      // Verify subtitles are physically saved
      const vttFile = path.join(TEST_STORAGE_DIR, 'episodes/ep_batch_01/subtitles/dialogue.vtt');
      expect(fs.existsSync(vttFile)).toBe(true);
      const vttText = fs.readFileSync(vttFile, 'utf-8');
      expect(vttText).toContain('WEBVTT');
      expect(vttText).toContain('<v Milo>');
    });

    it('performs quick character audition returning audio buffer and duration', async () => {
      const fastTts = new GoogleCloudTTSProvider({ apiKey: '' });
      const service = new VoicePipelineService(fastTts);
      const audition = await service.auditionCharacterVoice('Milo', '¡Probando mi voz de zorro!', {
        pitch: 1.15,
        speed: 1.0,
      });

      expect(isWavBuffer(audition.audioBuffer)).toBe(true);
      expect(audition.durationSeconds).toBeGreaterThan(1.0);
      expect(audition.mimeType).toBe('audio/wav');
    });
  });

  // --------------------------------------------------------------------------
  // 8. Voice Router REST API Endpoints & Auth Guards
  // --------------------------------------------------------------------------
  describe('8. Voice Router REST API Endpoints', () => {
    let app: express.Express;
    let validToken: string;

    beforeEach(() => {
      app = express();
      app.use(express.json());
      app.use(cookieParser());
      app.use('/api/voice', voiceRouter);

      validToken = signAccessToken({
        sub: '00000000-0000-0000-0000-000000000001',
        email: 'creator@cartoonfactory.io',
      });
    });

    it('GET /api/voice/catalog returns list of available voices publicly', async () => {
      const res = await fetchResponse(app, 'GET', '/api/voice/catalog');
      expect(res.status).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.success).toBe(true);
      expect(data.voices.length).toBeGreaterThan(0);
    });

    it('POST /api/voice/test produces base64 audio preview for character audition', async () => {
      const res = await fetchResponse(app, 'POST', '/api/voice/test', {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          characterName: 'Milo',
          text: '¡Hola amigos, esta es una audición rápida!',
          voiceProfile: { voiceType: 'milo-preschool', pitch: 1.15, speed: 1.0, language: 'es-ES' },
          format: 'json',
        }),
      });

      expect(res.status).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.success).toBe(true);
      expect(data.characterName).toBe('Milo');
      expect(typeof data.audioBase64).toBe('string');
      expect(data.audioBase64.length).toBeGreaterThan(100);
    });

    it('POST /api/voice/scene returns 401 Unauthorized without auth token', async () => {
      const res = await fetchResponse(app, 'POST', '/api/voice/scene', {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          episodeId: 'ep_01',
          sceneIndex: 0,
          sceneCode: 'sc_01',
          text: 'Diálogo de prueba sin autenticación',
        }),
      });

      expect(res.status).toBe(401);
      const data = JSON.parse(res.body);
      expect(data.error).toBe('UNAUTHENTICATED');
    });

    it('POST /api/voice/scene synthesizes scene audio when authenticated', async () => {
      const res = await fetchResponse(app, 'POST', '/api/voice/scene', {
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${validToken}`,
        },
        body: JSON.stringify({
          episodeId: 'ep_auth_01',
          sceneIndex: 0,
          sceneCode: 'sc_01',
          text: 'Diálogo autenticado en producción.',
          speakerName: 'Milo',
          nominalDuration: 12,
        }),
      });

      expect(res.status).toBe(201);
      const data = JSON.parse(res.body);
      expect(data.success).toBe(true);
      expect(data.sceneAudio.sceneCode).toBe('sc_01');
      expect(data.sceneAudio.publicUrl).toContain('sc_01/voice.wav');
      expect(data.sceneAudio.durationSeconds).toBeGreaterThan(1.0);
    });

    it('POST /api/voice/batch returns 401 Unauthorized without auth token', async () => {
      const res = await fetchResponse(app, 'POST', '/api/voice/batch', {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          episodeId: 'ep_batch_no_auth',
          scenes: [{ sceneIndex: 0, sceneCode: 'sc_01', dialogue: 'Test' }],
        }),
      });

      expect(res.status).toBe(401);
    });
  });
});

async function fetchResponse(
  app: express.Express,
  method: string,
  urlPath: string,
  options: { headers?: Record<string, string>; body?: string } = {}
): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  const { createServer } = await import('node:http');

  return new Promise((resolve, reject) => {
    const server = createServer(app);
    server.listen(0, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        return reject(new Error('Failed to bind server address'));
      }

      const port = address.port;
      const fullUrl = `http://127.0.0.1:${port}${urlPath}`;

      fetch(fullUrl, {
        method,
        headers: options.headers,
        body: options.body,
      })
        .then(async (res) => {
          const body = await res.text();
          const headers: Record<string, string> = {};
          res.headers.forEach((val, key) => {
            headers[key.toLowerCase()] = val;
          });

          server.close(() => {
            resolve({
              status: res.status,
              headers,
              body,
            });
          });
        })
        .catch((err) => {
          server.close(() => reject(err));
        });
    });
  });
}
