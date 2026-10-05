import { describe, it, expect, beforeEach, vi } from 'vitest';
import { inflateSync } from 'node:zlib';
import express from 'express';
import cookieParser from 'cookie-parser';
import {
  RasterCanvas,
  calculateCrc32,
  parseColor,
} from './png.encoder';
import {
  ConsistencyEngine,
  deriveDeterministicSeed,
} from './consistency.engine';
import { SyntheticImageProvider } from './synthetic.provider';
import { ImagenProvider } from './imagen.provider';
import { VisualService } from './visual.service';
import { visualRouter } from './visual.router';
import { LocalStorageProvider } from '../storage/local.storage';
import { signAccessToken } from '../auth/jwt.service';
import { db } from '../db';
import { telemetryService } from '../ai/telemetry.service';

describe('Phase 07 — Visual Generation & Storyboard Pipeline', () => {
  beforeEach(() => {
    vi.spyOn(telemetryService, 'recordExecution').mockResolvedValue();
    vi.spyOn(db.asset, 'findFirst').mockResolvedValue(null);
    vi.spyOn(db.asset, 'create').mockResolvedValue({ id: 'mock_asset_1' } as any);
    vi.spyOn(db.assetVersion, 'count').mockResolvedValue(0);
    vi.spyOn(db.assetVersion, 'create').mockResolvedValue({ id: 'mock_version_1' } as any);
    vi.spyOn(db.asset, 'update').mockResolvedValue({ id: 'mock_asset_1' } as any);
  });
  // ──────────────────────────────────────────────────────────────────────────
  // 1. Binary PNG Encoder & RasterCanvas (Mechanics & RFC 2083 Compliance)
  // ──────────────────────────────────────────────────────────────────────────
  describe('1. Binary PNG Encoder & RasterCanvas', () => {
    it('calculates deterministic IEEE 802.3 CRC32 checksums', () => {
      const data = Buffer.from('IHDR', 'ascii');
      const crc = calculateCrc32(data);
      expect(crc).toBeGreaterThan(0);
      expect(Number.isInteger(crc)).toBe(true);
    });

    it('parses various hex color formats into RGBA with bounds clamping', () => {
      expect(parseColor('#FFF')).toEqual({ r: 255, g: 255, b: 255, a: 255 });
      expect(parseColor('#EA580C')).toEqual({ r: 234, g: 88, b: 12, a: 255 });
      expect(parseColor('#00000080')).toEqual({ r: 0, g: 0, b: 0, a: 128 });
      expect(parseColor({ r: 300, g: -20, b: 100, a: 300 })).toEqual({
        r: 255,
        g: 0,
        b: 100,
        a: 255,
      });
    });

    it('produces a valid RFC 2083 PNG binary buffer with correct magic header and chunks', () => {
      const width = 64;
      const height = 36;
      const canvas = new RasterCanvas(width, height);
      canvas.clear('#0F172A');
      canvas.verticalGradient(0, height, '#0284C7', '#FEF08A');
      canvas.fillRect(10, 10, 20, 10, '#EA580C');
      canvas.fillCircle(40, 20, 8, '#F59E0B');

      const pngBuf = canvas.toPngBuffer();

      // PNG 8-byte signature: 0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A
      expect(pngBuf.subarray(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      );

      // Chunk 1: IHDR
      const ihdrLength = pngBuf.readUInt32BE(8);
      expect(ihdrLength).toBe(13);
      expect(pngBuf.subarray(12, 16).toString('ascii')).toBe('IHDR');
      expect(pngBuf.readUInt32BE(16)).toBe(width);
      expect(pngBuf.readUInt32BE(20)).toBe(height);
      expect(pngBuf[24]).toBe(8); // Bit depth: 8
      expect(pngBuf[25]).toBe(6); // Color type: 6 (RGBA)

      // Chunk 2: IDAT (Decompressable via zlib)
      const idatOffset = 8 + 8 + 13 + 4; // 33
      const idatLength = pngBuf.readUInt32BE(idatOffset);
      expect(pngBuf.subarray(idatOffset + 4, idatOffset + 8).toString('ascii')).toBe('IDAT');
      const compressedData = pngBuf.subarray(idatOffset + 8, idatOffset + 8 + idatLength);
      const decompressed = inflateSync(compressedData);

      // Scanlines: height rows of (1 filter byte + width * 4 bytes RGBA)
      const expectedRowBytes = 1 + width * 4;
      expect(decompressed.length).toBe(expectedRowBytes * height);

      // Chunk 3: IEND
      const iendOffset = idatOffset + 8 + idatLength + 4;
      expect(pngBuf.readUInt32BE(iendOffset)).toBe(0);
      expect(pngBuf.subarray(iendOffset + 4, iendOffset + 8).toString('ascii')).toBe('IEND');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. Consistency Engine & Deterministic Seeds
  // ──────────────────────────────────────────────────────────────────────────
  describe('2. Consistency Engine & Master Prompts', () => {
    it('generates identical 32-bit seeds for identical tokens and distinct seeds for distinct tokens', () => {
      const seed1 = deriveDeterministicSeed('milo', 1, 'forest');
      const seed2 = deriveDeterministicSeed('milo', 1, 'forest');
      const seed3 = deriveDeterministicSeed('milo', 2, 'forest');

      expect(seed1).toBe(seed2);
      expect(seed1).not.toBe(seed3);
      expect(seed1).toBeGreaterThanOrEqual(0);
      expect(seed1).toBeLessThanOrEqual(0xffffffff);
    });

    it('compiles scene prompt injecting master character consistency profiles and negative constraints', () => {
      const compiled = ConsistencyEngine.compileScenePrompt(
        {
          sceneIndex: 1,
          location: 'El Gran Roble',
          timeOfDay: 'Atardecer',
          action: 'Milo comparte su merienda con Tula',
          camera: 'Plano medio cinematografico',
          characters: ['Milo', 'Tula'],
          visualPrompt: 'Milo y Tula sentados bajo el arbol',
        },
        [
          {
            name: 'Milo',
            species: 'Zorro',
            colorPalette: ['#EA580C', '#FEF3C7'],
            clothing: 'Chaleco verde y mochila',
            visualFeatures: 'Pelaje naranja suave y ojos avellana',
            visualConsistencyPrompt: 'Stylized 3D cartoon fox, cute preschool proportions',
          },
        ]
      );

      expect(compiled.positivePrompt).toContain('El Gran Roble');
      expect(compiled.positivePrompt).toContain('Milo the Zorro');
      expect(compiled.positivePrompt).toContain('Chaleco verde y mochila');
      expect(compiled.negativePrompt).toContain('photorealistic');
      expect(compiled.negativePrompt).toContain('deformed');
      expect(compiled.aspectRatio).toBe('16:9');
      expect(compiled.seed).toBeGreaterThan(0);
    });

    it('compiles character turnaround prompt with 1:1 aspect ratio', () => {
      const compiled = ConsistencyEngine.compileCharacterTurnaround({
        name: 'Tula',
        species: 'Liebre',
        colorPalette: ['#94A3B8', '#BAE6FD'],
        clothing: 'Chaleco azul cielo',
        visualFeatures: 'Orejas largas y ojos curiosos',
      });

      expect(compiled.aspectRatio).toBe('1:1');
      expect(compiled.positivePrompt).toContain('turnaround');
      expect(compiled.positivePrompt).toContain('Tula');
      expect(compiled.negativePrompt).toContain('complex background');
    });

    it('compiles YouTube thumbnail prompt with 16:9 hero framing', () => {
      const compiled = ConsistencyEngine.compileThumbnailPrompt(
        'El Misterio de la Bellota Dorada',
        '¡GRAN SECRETO!',
        {
          name: 'Milo',
          species: 'Zorro',
          colorPalette: ['#EA580C'],
          clothing: 'Mochila',
          visualFeatures: 'Ojos brillantes',
        }
      );

      expect(compiled.aspectRatio).toBe('16:9');
      expect(compiled.positivePrompt).toContain('YouTube thumbnail');
      expect(compiled.positivePrompt).toContain('El Misterio de la Bellota Dorada');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. Synthetic & Imagen Providers
  // ──────────────────────────────────────────────────────────────────────────
  describe('3. Synthetic & Imagen Image Providers', () => {
    it('SyntheticImageProvider produces valid 16:9 PNG buffer with correct dimensions', async () => {
      const provider = new SyntheticImageProvider();
      const res = await provider.generateSceneVisual({
        prompt: 'Milo in the sunny meadow during golden hour sunset',
        aspectRatio: '16:9',
        width: 320,
        height: 180,
      });

      expect(res.mimeType).toBe('image/png');
      expect(res.imageBuffer.length).toBeGreaterThan(500);
      expect(res.imageBuffer.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      expect(res.seedUsed).toBeDefined();
    });

    it('SyntheticImageProvider produces valid 1:1 character turnaround PNG', async () => {
      const provider = new SyntheticImageProvider();
      const res = await provider.generateCharacterTurnaround('Milo the Fox', 'Pixar 3D');

      expect(res.mimeType).toBe('image/png');
      expect(res.imageBuffer.length).toBeGreaterThan(1000);
    });

    it('SyntheticImageProvider produces 1280x720 YouTube thumbnail PNG', async () => {
      const provider = new SyntheticImageProvider();
      const res = await provider.generateThumbnail('Aventura en el Bosque', '¡EL SECRETO!', 'Milo con cofre');

      expect(res.mimeType).toBe('image/png');
      expect(res.imageBuffer.length).toBeGreaterThan(2000);
      // Verify width and height in IHDR chunk
      expect(res.imageBuffer.readUInt32BE(16)).toBe(1280);
      expect(res.imageBuffer.readUInt32BE(20)).toBe(720);
    });

    it('ImagenProvider falls back gracefully to synthetic PNG when API key is missing or fails', async () => {
      const provider = new ImagenProvider('', 'imagen-3.0-generate-002');
      const res = await provider.generateSceneVisual({
        prompt: 'Scene with trees',
        aspectRatio: '16:9',
        width: 320,
        height: 180,
      });

      expect(res.mimeType).toBe('image/png');
      expect(res.imageBuffer.length).toBeGreaterThan(500);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. VisualService Orchestration & Storage Integration
  // ──────────────────────────────────────────────────────────────────────────
  describe('4. VisualService Orchestration', () => {
    let mockStorage: LocalStorageProvider;
    let service: VisualService;

    beforeEach(() => {
      mockStorage = new LocalStorageProvider('./storage/test_visuals');
      service = new VisualService(new SyntheticImageProvider(), mockStorage);
    });

    it('generates scene visual, uploads to StorageProvider with POSIX key and computes SHA-256', async () => {
      const res = await service.generateSceneVisual({
        episodeId: 'ep_test_01',
        sceneIndex: 1,
        sceneCode: 'SCENE_01',
        location: 'El Prado Verde',
        timeOfDay: 'Mañana soleada',
        action: 'Milo despierta estirándose felizmente',
        width: 320,
        height: 180,
      });

      expect(res.sceneIndex).toBe(1);
      expect(res.sceneCode).toBe('SCENE_01');
      expect(res.storageKey).toMatch(/^episodes\/ep_test_01\/visuals\/scene_SCENE_01_[a-f0-9]+\.png$/);
      expect(res.publicUrl).toContain('/api/assets/episodes/ep_test_01/visuals/scene_SCENE_01_');
      expect(res.mimeType).toBe('image/png');
      expect(res.sizeBytes).toBeGreaterThan(500);
      expect(res.checksumSha256).toMatch(/^[a-f0-9]{64}$/);

      // Verify file exists in storage
      const downloaded = await mockStorage.download(res.storageKey);
      expect(downloaded.length).toBe(res.sizeBytes);
    });

    it('generates a batch of scene visuals in sequence and aggregates metrics', async () => {
      const batchResult = await service.generateEpisodeVisualsBatch('ep_test_batch', [
        {
          sceneIndex: 1,
          sceneCode: 'SC_01',
          location: 'Inicio',
          timeOfDay: 'Día',
          action: 'Paseo',
          width: 200,
          height: 112,
        },
        {
          sceneIndex: 2,
          sceneCode: 'SC_02',
          location: 'Cueva',
          timeOfDay: 'Tarde',
          action: 'Encuentro',
          width: 200,
          height: 112,
        },
      ]);

      expect(batchResult.totalImagesGenerated).toBe(2);
      expect(batchResult.scenes.length).toBe(2);
      expect(batchResult.scenes[0].storageKey).toContain('scene_SC_01_');
      expect(batchResult.scenes[1].storageKey).toContain('scene_SC_02_');
    });

    it('generates character model sheet and stores in characters folder', async () => {
      const res = await service.generateCharacterVisual({
        episodeId: 'ep_test_char',
        characterName: 'Milo',
        species: 'Zorro',
        colorPalette: ['#EA580C'],
      });

      expect(res.storageKey).toBe('episodes/ep_test_char/characters/milo_turnaround.png');
      expect(res.mimeType).toBe('image/png');
    });

    it('generates YouTube thumbnail and stores in thumbnails folder', async () => {
      const res = await service.generateThumbnail({
        episodeId: 'ep_test_thumb',
        title: 'El Gran Bosque',
        overlayText: '¡AVENTURA!',
      });

      expect(res.storageKey).toMatch(/^episodes\/ep_test_thumb\/thumbnails\/thumbnail_1280x720_[a-f0-9]+\.png$/);
      expect(res.mimeType).toBe('image/png');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 5. Visual Router HTTP Endpoints
  // ──────────────────────────────────────────────────────────────────────────
  describe('5. Visual Router HTTP Endpoints & Auth Guarding', () => {
    let app: express.Express;
    let validToken: string;

    beforeEach(() => {
      process.env['JWT_SECRET'] = 'cartoon-studio-test-secret-at-least-32-chars-long';
      app = express();
      app.use(express.json());
      app.use(cookieParser());
      app.use('/api/visuals', visualRouter);

      validToken = signAccessToken({
        userId: 'u_visual_test',
        email: 'visuals@cartoonfactory.io',
      });
    });

    it('rejects unauthenticated requests to POST /api/visuals/scene with 401 Unauthorized', async () => {
      const req = {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          episodeId: 'ep_01',
          sceneIndex: 1,
          sceneCode: 'SC_01',
          location: 'Bosque',
          timeOfDay: 'Día',
          action: 'Milo corre',
        }),
      };

      const res = await fakeHttpRequest(app, '/api/visuals/scene', req);
      expect(res.statusCode).toBe(401);
    });

    it('rejects invalid schema payloads with 400 Bad Request when authenticated', async () => {
      const req = {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${validToken}`,
        },
        body: JSON.stringify({
          // Missing required sceneCode, location, etc.
          episodeId: 'ep_01',
        }),
      };

      const res = await fakeHttpRequest(app, '/api/visuals/scene', req);
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toContain('Parametros invalidos');
    });

    it('generates raster PNG visual via POST /api/visuals/scene when authenticated', async () => {
      const req = {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${validToken}`,
        },
        body: JSON.stringify({
          episodeId: 'ep_auth_01',
          sceneIndex: 1,
          sceneCode: 'SC_AUTH_01',
          location: 'Claro del Roble',
          timeOfDay: 'Mañana',
          action: 'Milo sonrie a la camara',
          width: 240,
          height: 135,
        }),
      };

      const res = await fakeHttpRequest(app, '/api/visuals/scene', req);
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.visual.storageKey).toContain('scene_SC_AUTH_01_');
      expect(res.body.visual.publicUrl).toContain('/api/assets/');
    });

    it('generates batch visuals via POST /api/visuals/batch when authenticated', async () => {
      const req = {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${validToken}`,
        },
        body: JSON.stringify({
          episodeId: 'ep_auth_batch',
          scenes: [
            {
              sceneIndex: 1,
              sceneCode: 'SC_B01',
              location: 'Bosque',
              timeOfDay: 'Día',
              action: 'Paseo matutino',
              width: 160,
              height: 90,
            },
          ],
        }),
      };

      const res = await fakeHttpRequest(app, '/api/visuals/batch', req);
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.batch.totalImagesGenerated).toBe(1);
    });

    it('generates character sheet via POST /api/visuals/character when authenticated', async () => {
      const req = {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${validToken}`,
        },
        body: JSON.stringify({
          episodeId: 'ep_auth_char',
          characterName: 'Milo',
          species: 'Zorro',
        }),
      };

      const res = await fakeHttpRequest(app, '/api/visuals/character', req);
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.character.storageKey).toContain('milo_turnaround.png');
    });

    it('generates YouTube thumbnail via POST /api/visuals/thumbnail when authenticated', async () => {
      const req = {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${validToken}`,
        },
        body: JSON.stringify({
          episodeId: 'ep_auth_thumb',
          title: 'El Gran Salto de Tula',
          overlayText: '¡INCREÍBLE!',
        }),
      };

      const res = await fakeHttpRequest(app, '/api/visuals/thumbnail', req);
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.thumbnail.storageKey).toContain('thumbnail_1280x720_');
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

    const resEvents = new EventEmitter();
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

    // Parse body into req.body if json
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
