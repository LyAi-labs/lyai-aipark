import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  checkFfmpegAvailability,
  parseFfmpegTime,
  buildMotionFilter,
  renderSceneClip,
  concatSceneClips,
  mixAudioTracks,
} from './ffmpeg.wrapper';
import { synthesizePreschoolMusic } from './music.synthesizer';
import { RenderService, renderService } from './render.service';
import { renderRouter } from './render.router';
import { signAccessToken } from '../auth/jwt.service';
import { db } from '../db';
import { createWavHeader } from '../audio/wav.utils';
import { RasterCanvas } from '../visuals/png.encoder';

describe('Phase 08 — Real Video Rendering Engine (FFmpeg Worker)', () => {
  beforeEach(() => {
    vi.spyOn(db.asset, 'create').mockResolvedValue({ id: 'mock_asset_render_1' } as any);
    vi.spyOn(db.assetVersion, 'create').mockResolvedValue({ id: 'mock_ver_render_1' } as any);
    vi.spyOn(db.productionJob, 'create').mockResolvedValue({ id: 'mock_job_1' } as any);
    vi.spyOn(db.productionJob, 'updateMany').mockResolvedValue({ count: 1 } as any);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 1. FFmpeg Binary & Capabilities Detection
  // ──────────────────────────────────────────────────────────────────────────
  describe('1. FFmpeg Binary Detection & Utility Functions', () => {
    it('detects native FFmpeg installation and parses version correctly', () => {
      const caps = checkFfmpegAvailability();
      expect(caps.available).toBe(true);
      expect(caps.version).toBeTruthy();
      expect(typeof caps.version).toBe('string');
      expect(caps.version.length).toBeGreaterThan(0);
    });

    it('parses FFmpeg timecode strings into fractional seconds', () => {
      expect(parseFfmpegTime('00:00:00.00')).toBe(0);
      expect(parseFfmpegTime('00:00:05.50')).toBeCloseTo(5.5, 2);
      expect(parseFfmpegTime('00:01:30.25')).toBeCloseTo(90.25, 2);
      expect(parseFfmpegTime('01:00:00.00')).toBe(3600);
      expect(parseFfmpegTime('invalid')).toBe(0);
    });

    it('builds motion filters for static, zoom and pan effects', () => {
      const staticFilter = buildMotionFilter('static', 1920, 1080);
      expect(staticFilter).toContain('scale=1920:1080');
      expect(staticFilter).toContain('pad=1920:1080');

      const zoomInFilter = buildMotionFilter('zoom-in', 1920, 1080, 5, 24);
      expect(zoomInFilter).toContain('zoompan=');
      expect(zoomInFilter).toContain('scale=1920:1080');

      const kenBurnsFilter = buildMotionFilter('ken-burns', 1280, 720, 3, 24);
      expect(kenBurnsFilter).toContain('zoompan=');
      expect(kenBurnsFilter).toContain('scale=1280:720');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. Preschool Background Music Synthesizer
  // ──────────────────────────────────────────────────────────────────────────
  describe('2. Preschool Background Music Synthesizer (Mechanical RIFF/WAVE)', () => {
    it('synthesizes a valid 16-bit 44.1kHz stereo WAV music track of specified duration', () => {
      const durationSeconds = 3;
      const wavBuffer = synthesizePreschoolMusic(durationSeconds, {
        sampleRate: 44100,
        channels: 2,
        volume: 0.5,
      });

      // Check RIFF header
      expect(wavBuffer.subarray(0, 4).toString('ascii')).toBe('RIFF');
      expect(wavBuffer.subarray(8, 12).toString('ascii')).toBe('WAVE');
      expect(wavBuffer.subarray(12, 16).toString('ascii')).toBe('fmt ');

      // Check channels (stereo = 2)
      expect(wavBuffer.readUInt16LE(22)).toBe(2);
      // Check sample rate
      expect(wavBuffer.readUInt32LE(24)).toBe(44100);
      // Check bits per sample (16-bit)
      expect(wavBuffer.readUInt16LE(34)).toBe(16);

      // Verify file size: 44 header + (3 * 44100 * 2 * 2) = 44 + 529200 = 529244 bytes
      const expectedDataSize = durationSeconds * 44100 * 2 * 2;
      expect(wavBuffer.length).toBe(44 + expectedDataSize);
    });

    it('handles short durations gracefully without clipping or NaN', () => {
      const wavBuffer = synthesizePreschoolMusic(1, { volume: 0.8 });
      expect(wavBuffer.length).toBeGreaterThan(44);
      // Ensure buffer is not entirely zeroed
      let nonZeroCount = 0;
      for (let i = 44; i < Math.min(1000, wavBuffer.length); i++) {
        if (wavBuffer[i] !== 0) nonZeroCount++;
      }
      expect(nonZeroCount).toBeGreaterThan(50);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. Native FFmpeg Child Process Scene & Timeline Compilation
  // ──────────────────────────────────────────────────────────────────────────
  describe('3. Native FFmpeg Scene Clip Compilation & Concat Demuxing', () => {
    let testTempDir: string;

    beforeEach(async () => {
      testTempDir = join(tmpdir(), `test_ffmpeg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
      await fs.mkdir(testTempDir, { recursive: true });
    });

    it('renders a real playable MP4 scene clip from PNG image and WAV audio', async () => {
      // 1. Generate small PNG frame
      const canvas = new RasterCanvas(320, 180);
      canvas.clear('#1E293B');
      canvas.fillCircle(160, 90, 40, '#F59E0B');
      const pngBuffer = canvas.toPngBuffer();
      const imagePath = join(testTempDir, 'scene.png');
      await fs.writeFile(imagePath, pngBuffer);

      // 2. Generate small 1-second WAV audio
      const pcmData = Buffer.alloc(44100 * 2);
      const header = createWavHeader({ sampleRate: 44100, numChannels: 1, bitsPerSample: 16, dataSize: pcmData.length });
      const wavBuffer = Buffer.concat([header, pcmData]);
      const audioPath = join(testTempDir, 'scene.wav');
      await fs.writeFile(audioPath, wavBuffer);

      // 3. Render clip to MP4
      const clipPath = join(testTempDir, 'clip.mp4');
      await renderSceneClip({
        imagePath,
        audioPath,
        outputPath: clipPath,
        duration: 1,
        width: 320,
        height: 180,
        fps: 24,
      });

      const stat = await fs.stat(clipPath);
      expect(stat.size).toBeGreaterThan(500);

      // Verify MP4 ftyp box signature in header
      const fileHeader = await fs.readFile(clipPath);
      expect(fileHeader.subarray(4, 8).toString('ascii')).toBe('ftyp');

      // Cleanup
      await fs.rm(testTempDir, { recursive: true, force: true });
    }, 15000);

    it('concatenates multiple MP4 scene clips into a single continuous video', async () => {
      const canvas = new RasterCanvas(320, 180);
      canvas.clear('#0284C7');
      const pngBuffer = canvas.toPngBuffer();
      const imagePath = join(testTempDir, 'base.png');
      await fs.writeFile(imagePath, pngBuffer);

      const clip1 = join(testTempDir, 'clip1.mp4');
      const clip2 = join(testTempDir, 'clip2.mp4');

      await renderSceneClip({
        imagePath,
        outputPath: clip1,
        duration: 1,
        width: 320,
        height: 180,
        fps: 24,
      });

      await renderSceneClip({
        imagePath,
        outputPath: clip2,
        duration: 1,
        width: 320,
        height: 180,
        fps: 24,
      });

      const concatOutput = join(testTempDir, 'concat.mp4');
      await concatSceneClips([clip1, clip2], concatOutput, testTempDir);

      const stat = await fs.stat(concatOutput);
      expect(stat.size).toBeGreaterThan(1000);

      // Verify MP4 container
      const fileHeader = await fs.readFile(concatOutput);
      expect(fileHeader.subarray(4, 8).toString('ascii')).toBe('ftyp');

      await fs.rm(testTempDir, { recursive: true, force: true });
    }, 20000);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. RenderService End-to-End Orchestration & Lifecycle
  // ──────────────────────────────────────────────────────────────────────────
  describe('4. RenderService End-to-End Orchestration', () => {
    it('dispatches async job with HTTP 202 semantics and transitions through status lifecycle', async () => {
      const service = RenderService.getInstance();

      const canvas = new RasterCanvas(320, 180);
      canvas.clear('#10B981');
      const frameBuf = canvas.toPngBuffer();

      const result = await service.startRender({
        episodeId: 'ep_test_001',
        title: 'Milo y el Bosque Mágico',
        scenes: [
          {
            sceneId: 'SC_01',
            index: 0,
            duration: 1,
            dialogue: 'Hola Milo!',
            imageBuffer: frameBuf,
          },
          {
            sceneId: 'SC_02',
            index: 1,
            duration: 1,
            dialogue: 'Vamos a jugar!',
            imageBuffer: frameBuf,
          },
        ],
        options: {
          resolution: '720p',
          fps: 24,
        },
      });

      expect(result.jobId).toMatch(/^job_render_/);
      expect(result.status).toBe('QUEUED');
      expect(result.pollUrl).toBe(`/api/render/jobs/${result.jobId}`);
      expect(result.streamUrl).toBe(`/api/render/jobs/${result.jobId}/events`);

      // Poll until completed or timeout (max 20 seconds)
      let state = service.getJobState(result.jobId);
      expect(state).toBeTruthy();

      const maxWait = 25000;
      const startTime = Date.now();
      while (state && state.status !== 'COMPLETED' && state.status !== 'FAILED' && Date.now() - startTime < maxWait) {
        await new Promise((r) => setTimeout(r, 400));
        state = service.getJobState(result.jobId);
      }

      expect(state?.status).toBe('COMPLETED');
      expect(state?.progress).toBe(100);
      expect(state?.result).toBeTruthy();
      expect(state?.result?.videoPublicUrl).toContain('/api/assets/');
      expect(state?.result?.checksumSha256).toHaveLength(64);
      expect(state?.result?.sizeBytes).toBeGreaterThan(1000);
      expect(state?.result?.vttPublicUrl).toBeTruthy();
    }, 30000);

    it('cancels active job gracefully when requested', async () => {
      const service = RenderService.getInstance();
      const canvas = new RasterCanvas(320, 180);
      canvas.clear('#6366F1');
      const frameBuf = canvas.toPngBuffer();

      const dispatch = await service.startRender({
        episodeId: 'ep_cancel_test',
        title: 'Episodio Cancelable',
        scenes: [
          { sceneId: 'SC_01', index: 0, duration: 5, imageBuffer: frameBuf },
          { sceneId: 'SC_02', index: 1, duration: 5, imageBuffer: frameBuf },
        ],
      });

      const cancelled = await service.cancelJob(dispatch.jobId);
      expect(cancelled).toBe(true);

      const state = service.getJobState(dispatch.jobId);
      expect(state?.status).toBe('CANCELLED');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 5. Render Router REST API Endpoints & Auth Guarding
  // ──────────────────────────────────────────────────────────────────────────
  describe('5. Render Router REST API Endpoints', () => {
    let app: express.Express;
    let validToken: string;

    beforeEach(async () => {
      process.env['JWT_SECRET'] = 'test-secret-key-must-be-at-least-32-chars-long';
      validToken = signAccessToken({
        userId: 'user_render_1',
        email: 'director@cartoonfactory.io',
        role: 'PRODUCER',
      });

      app = express();
      app.use(express.json());
      app.use(cookieParser());
      app.use('/api/render', renderRouter);
      const { errorHandler } = await import('../errors');
      app.use(errorHandler);
    });

    it('GET /api/render/capabilities returns host FFmpeg capabilities without auth', async () => {
      const res = await fakeHttpRequest(app, '/api/render/capabilities', { method: 'GET' });
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.capabilities.available).toBe(true);
      expect(res.body.capabilities.version).toBeTruthy();
    });

    it('POST /api/render/start returns 401 Unauthorized when unauthenticated', async () => {
      const res = await fakeHttpRequest(app, '/api/render/start', {
        method: 'POST',
        body: JSON.stringify({
          episodeId: 'ep_01',
          title: 'Episodio 1',
          scenes: [{ sceneId: 'SC_01', index: 0, duration: 2 }],
        }),
      });
      expect(res.statusCode).toBe(401);
    });

    it('POST /api/render/start returns 400 Bad Request on invalid payload', async () => {
      const res = await fakeHttpRequest(app, '/api/render/start', {
        method: 'POST',
        headers: { authorization: `Bearer ${validToken}` },
        body: JSON.stringify({
          episodeId: 'ep_01',
          // missing title and scenes
        }),
      });
      expect(res.statusCode).toBe(400);
    });

    it('POST /api/render/start returns 202 Accepted with jobId and pollUrl when authenticated', async () => {
      const res = await fakeHttpRequest(app, '/api/render/start', {
        method: 'POST',
        headers: { authorization: `Bearer ${validToken}` },
        body: JSON.stringify({
          episodeId: 'ep_auth_01',
          title: 'Aventura de Milo',
          scenes: [
            {
              sceneId: 'SC_01',
              index: 0,
              duration: 1,
              dialogue: 'Buenos días!',
            },
          ],
        }),
      });

      expect(res.statusCode).toBe(202);
      expect(res.body.success).toBe(true);
      expect(res.body.jobId).toMatch(/^job_render_/);
      expect(res.body.status).toBe('QUEUED');
      expect(res.body.pollUrl).toBe(`/api/render/jobs/${res.body.jobId}`);
    });

    it('GET /api/render/jobs/:jobId returns 404 for non-existent job', async () => {
      const res = await fakeHttpRequest(app, '/api/render/jobs/job_render_nonexistent', {
        method: 'GET',
        headers: { authorization: `Bearer ${validToken}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it('GET /api/render/jobs/:jobId returns job details for valid job', async () => {
      const startRes = await fakeHttpRequest(app, '/api/render/start', {
        method: 'POST',
        headers: { authorization: `Bearer ${validToken}` },
        body: JSON.stringify({
          episodeId: 'ep_query_01',
          title: 'Aventura 2',
          scenes: [{ sceneId: 'SC_01', index: 0, duration: 1, dialogue: 'Test' }],
        }),
      });

      expect(startRes.statusCode).toBe(202);
      const jobId = startRes.body.jobId;

      const jobRes = await fakeHttpRequest(app, `/api/render/jobs/${jobId}`, {
        method: 'GET',
        headers: { authorization: `Bearer ${validToken}` },
      });

      expect(jobRes.statusCode).toBe(200);
      expect(jobRes.body.success).toBe(true);
      expect(jobRes.body.job.jobId).toBe(jobId);
      expect(['QUEUED', 'PROCESSING', 'COMPLETED']).toContain(jobRes.body.job.status);
    });

    it('POST /api/render/jobs/:jobId/cancel cancels active job', async () => {
      const startRes = await fakeHttpRequest(app, '/api/render/start', {
        method: 'POST',
        headers: { authorization: `Bearer ${validToken}` },
        body: JSON.stringify({
          episodeId: 'ep_cancel_endpoint',
          title: 'Episodio a cancelar',
          scenes: [{ sceneId: 'SC_01', index: 0, duration: 10, dialogue: 'Largo' }],
        }),
      });

      expect(startRes.statusCode).toBe(202);
      const jobId = startRes.body.jobId;

      const cancelRes = await fakeHttpRequest(app, `/api/render/jobs/${jobId}/cancel`, {
        method: 'POST',
        headers: { authorization: `Bearer ${validToken}` },
      });

      expect(cancelRes.statusCode).toBe(200);
      expect(cancelRes.body.success).toBe(true);
      expect(cancelRes.body.message).toContain('cancelado');
    });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Lightweight Node HTTP Mock Dispatcher
// ──────────────────────────────────────────────────────────────────────────────
async function fakeHttpRequest(
  app: express.Express,
  path: string,
  options: { method: string; headers?: Record<string, string>; body?: string }
): Promise<{ statusCode: number; body: any; headers: Record<string, any> }> {
  return new Promise((resolve) => {
    const { EventEmitter } = require('node:events');
    const req = new EventEmitter();
    (req as any).method = options.method;
    (req as any).url = path;
    (req as any).headers = {
      host: 'localhost',
      'content-type': 'application/json',
      ...(options.headers || {}),
    };
    (req as any).cookies = {};
    (req as any).socket = { remoteAddress: '127.0.0.1' };

    let statusCode = 200;
    const responseHeaders: Record<string, any> = {};
    let responseBody = '';

    const res: any = {
      statusCode: 200,
      status(code: number) {
        statusCode = code;
        this.statusCode = code;
        return this;
      },
      setHeader(name: string, value: any) {
        responseHeaders[name.toLowerCase()] = value;
        return this;
      },
      getHeader(name: string) {
        return responseHeaders[name.toLowerCase()];
      },
      json(data: any) {
        responseHeaders['content-type'] = 'application/json';
        responseBody = JSON.stringify(data);
        this.end(responseBody);
        return this;
      },
      send(data: any) {
        responseBody = typeof data === 'string' ? data : JSON.stringify(data);
        this.end(responseBody);
        return this;
      },
      end(chunk?: any) {
        if (chunk) {
          responseBody = chunk.toString();
        }
        let parsed = responseBody;
        try {
          parsed = JSON.parse(responseBody);
        } catch {
          // Keep raw string
        }
        resolve({
          statusCode,
          headers: responseHeaders,
          body: parsed,
        });
      },
    };

    if (options.body) {
      try {
        (req as any).body = JSON.parse(options.body);
      } catch {
        (req as any).body = options.body;
      }
    }

    app(req as any, res as any, (err: any) => {
      if (err) {
        const status = err.statusCode || err.status || 500;
        resolve({
          statusCode: status,
          headers: {},
          body: { error: err.message, code: err.code },
        });
      }
    });
  });
}
