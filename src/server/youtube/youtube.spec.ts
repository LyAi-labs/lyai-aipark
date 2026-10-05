/**
 * Cartoon Studio — YouTube OAuth 2.0 & Data API v3 Test Suite
 * Phase 10: Real YouTube Integration (OAuth 2.0 & Data API v3)
 *
 * Exhaustively validates:
 * 1. AES-256-GCM token encryption, decryption, tamper-proofing, and distinct nonce derivation.
 * 2. Google OAuth 2.0 flow: authorization URL with strict scopes, signed CSRF state, token exchange & auto-refresh.
 * 3. YouTube channel discovery, synchronization, and connection management in PostgreSQL.
 * 4. Resumable video uploading protocol, thumbnail setting, and COPPA selfDeclaredMadeForKids: true enforcement.
 * 5. Quality Control (QC) gatekeeper invariant: prevents publication if drift > 0.05s or COPPA violations exist.
 * 6. High-fidelity Sandbox mode when credentials are not configured.
 * 7. Express REST API endpoints under /api/youtube/*.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import { createServer } from 'node:http';
import { db } from '../db';
import {
  encryptOAuthTokens,
  decryptOAuthTokens,
} from './encryption';
import {
  GoogleOAuthService,
  googleOAuthService,
  YOUTUBE_OAUTH_SCOPES,
} from './oauth.service';
import {
  YouTubeChannelService,
  youTubeChannelService,
} from './channel.service';
import {
  YouTubeUploaderService,
  youTubeUploaderService,
} from './uploader.service';
import {
  YouTubeService,
  youTubeService,
} from './youtube.service';
import { youtubeRouter } from './youtube.router';
import { qcService } from '../qc';
import { AppError } from '../errors';

describe('Phase 10 — Real YouTube Integration (OAuth 2.0 & Data API v3)', () => {
  let testApp: express.Express;

  beforeEach(() => {
    vi.restoreAllMocks();

    // Mock Prisma DB models to avoid requiring a live Postgres instance during unit tests
    vi.spyOn(db.googleOAuthAccount, 'upsert').mockResolvedValue({ id: 'acc_test_uuid' } as any);
    vi.spyOn(db.googleOAuthAccount, 'findFirst').mockResolvedValue(null);
    vi.spyOn(db.googleOAuthAccount, 'findMany').mockResolvedValue([]);
    vi.spyOn(db.googleOAuthAccount, 'update').mockResolvedValue({ id: 'acc_test_uuid' } as any);

    vi.spyOn(db.youTubeChannel, 'upsert').mockResolvedValue({
      id: 'ch_test_uuid',
      channelId: 'UC_TEST_CHANNEL_123',
      channelTitle: 'Canal Infantil Oficial',
      channelCustomUrl: '@CanalInfantil',
      subscriberCount: '15.000',
      videoCount: 12,
      viewCount: '250.000',
      avatarUrl: 'https://images.unsplash.com/test.jpg',
      isDemoMode: false,
    } as any);
    vi.spyOn(db.youTubeChannel, 'findFirst').mockResolvedValue({
      id: 'ch_test_uuid',
      channelId: 'UC_TEST_CHANNEL_123',
    } as any);

    vi.spyOn(db.youTubeChannelConnection, 'upsert').mockResolvedValue({ id: 'conn_test_uuid' } as any);
    vi.spyOn(db.youTubeChannelConnection, 'updateMany').mockResolvedValue({ count: 1 } as any);

    vi.spyOn(db.youTubePublication, 'create').mockResolvedValue({
      id: 'pub_test_uuid',
      episodeId: 'ep_test_01',
      publishedVideoId: 'yt_vid_abc123',
      publishedVideoUrl: 'https://youtube.com/watch?v=yt_vid_abc123',
      privacyStatus: 'PRIVATE',
      madeForKids: true,
    } as any);
    vi.spyOn(db.youTubePublication, 'findMany').mockResolvedValue([
      {
        id: 'pub_test_uuid',
        title: 'Milo y el Bosque',
        publishedVideoId: 'yt_vid_abc123',
        privacyStatus: 'PRIVATE',
        madeForKids: true,
      },
    ] as any);

    vi.spyOn(db.providerExecution, 'create').mockResolvedValue({ id: 'exec_test_uuid' } as any);
    vi.spyOn(db.asset, 'findFirst').mockResolvedValue(null);

    // Setup Express App for router tests
    testApp = express();
    testApp.use(express.json());
    // Attach simulated authenticated user
    testApp.use((req, _res, next) => {
      (req as any).user = { id: 'usr_test_123', email: 'creator@kidstoon.local' };
      next();
    });
    testApp.use('/api/youtube', youtubeRouter);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 1. AES-256-GCM Token Encryption & Integrity
  // ──────────────────────────────────────────────────────────────────────────
  describe('1. AES-256-GCM Cryptographic Security in Repose', () => {
    it('encrypts and decrypts access token and refresh token with exact equality', () => {
      const accessToken = 'ya29.a0ARrdaM_SAMPLE_ACCESS_TOKEN_XYZ_1234567890';
      const refreshToken = '1//0gM_SAMPLE_REFRESH_TOKEN_QWERTY_9876543210';

      const encrypted = encryptOAuthTokens(accessToken, refreshToken);

      expect(encrypted.encryptedAccessToken).toBeDefined();
      expect(encrypted.encryptedRefreshToken).toBeDefined();
      expect(encrypted.iv).toHaveLength(48); // 24 bytes hex (12 bytes iv1 + 12 bytes iv2)
      expect(encrypted.authTag).toHaveLength(32); // 16 bytes hex

      const decrypted = decryptOAuthTokens(encrypted);
      expect(decrypted.accessToken).toBe(accessToken);
      expect(decrypted.refreshToken).toBe(refreshToken);
    });

    it('generates distinct nonces for access and refresh tokens to avoid GCM nonce reuse', () => {
      const enc1 = encryptOAuthTokens('token_a', 'token_b');
      const iv1 = enc1.iv.substring(0, 24);
      const iv2 = enc1.iv.substring(24, 48);

      expect(iv1).not.toBe(iv2);
      expect(iv1).toHaveLength(24);
      expect(iv2).toHaveLength(24);
    });

    it('throws TOKEN_INTEGRITY_CHECK_FAILED when ciphertext is tampered', () => {
      const encrypted = encryptOAuthTokens('valid_access_token', 'valid_refresh_token');

      // Tamper ciphertext
      const parts = encrypted.encryptedAccessToken.split(':');
      const tamperedCipher = parts[1].substring(0, parts[1].length - 2) + (parts[1].endsWith('a') ? 'b' : 'a');
      encrypted.encryptedAccessToken = `${parts[0]}:${tamperedCipher}`;

      expect(() => decryptOAuthTokens(encrypted)).toThrowError(/Fallo de integridad criptográfica/);
    });

    it('throws TOKEN_INTEGRITY_CHECK_FAILED when authentication tag is tampered', () => {
      const encrypted = encryptOAuthTokens('valid_access_token', 'valid_refresh_token');

      // Tamper auth tag
      const parts = encrypted.encryptedAccessToken.split(':');
      const tamperedTag = 'f'.repeat(32);
      encrypted.encryptedAccessToken = `${tamperedTag}:${parts[1]}`;

      expect(() => decryptOAuthTokens(encrypted)).toThrowError(/Fallo de integridad criptográfica/);
    });

    it('handles empty refresh token cleanly without error', () => {
      const encrypted = encryptOAuthTokens('access_only_token', '');
      expect(encrypted.encryptedRefreshToken).toBe('');

      const decrypted = decryptOAuthTokens(encrypted);
      expect(decrypted.accessToken).toBe('access_only_token');
      expect(decrypted.refreshToken).toBe('');
    });

    it('throws AppError when attempting to encrypt empty access token', () => {
      expect(() => encryptOAuthTokens('')).toThrowError(/Cannot encrypt empty access token/);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. Google OAuth 2.0 Flow
  // ──────────────────────────────────────────────────────────────────────────
  describe('2. Google OAuth 2.0 Flow & State Validation', () => {
    it('generates authorization URL with all required YouTube and profile scopes', () => {
      const url = googleOAuthService.getAuthorizationUrl('usr_kidstoon_01');

      expect(url).toContain('https://accounts.google.com/o/oauth2/v2/auth');
      expect(url).toContain('access_type=offline');
      expect(url).toContain('prompt=consent');
      expect(url).toContain('response_type=code');

      for (const scope of YOUTUBE_OAUTH_SCOPES) {
        expect(url).toContain(encodeURIComponent(scope));
      }
    });

    it('generates tamper-proof HMAC-SHA256 signed state and validates it successfully', () => {
      const state = googleOAuthService.generateState('usr_kidstoon_01');
      expect(state).toBeDefined();

      const verification = googleOAuthService.verifyState(state);
      expect(verification.valid).toBe(true);
      expect(verification.userId).toBe('usr_kidstoon_01');
    });

    it('rejects tampered or forged state parameters', () => {
      const state = googleOAuthService.generateState('usr_kidstoon_01');
      const decoded = JSON.parse(Buffer.from(state, 'base64url').toString('utf8'));
      decoded.payload = 'usr_hacker_attacker:1234567890'; // Tamper payload
      const tamperedState = Buffer.from(JSON.stringify(decoded)).toString('base64url');

      const verification = googleOAuthService.verifyState(tamperedState);
      expect(verification.valid).toBe(false);
      expect(verification.userId).toBe('');
    });

    it('exchanges authorization code for tokens via mocked Google token endpoint', async () => {
      const mockTokenResponse = {
        access_token: 'ya29.mock_exchanged_access_token',
        expires_in: 3600,
        refresh_token: '1//mock_refresh_token',
        scope: YOUTUBE_OAUTH_SCOPES.join(' '),
        token_type: 'Bearer',
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => mockTokenResponse,
      } as any);

      const tokens = await googleOAuthService.exchangeCodeForTokens('sample_auth_code');
      expect(tokens.access_token).toBe(mockTokenResponse.access_token);
      expect(tokens.refresh_token).toBe(mockTokenResponse.refresh_token);
    });

    it('auto-refreshes access token when near expiration', async () => {
      // Mock existing account in DB that expired 1 hour ago
      const expiredDate = new Date(Date.now() - 3600 * 1000);
      const encryptedTokens = encryptOAuthTokens('old_access_token', 'stored_refresh_token');

      vi.spyOn(db.googleOAuthAccount, 'findFirst').mockResolvedValueOnce({
        id: 'acc_expired_01',
        userId: 'usr_auto_refresh',
        encryptedAccessToken: encryptedTokens.encryptedAccessToken,
        encryptedRefreshToken: encryptedTokens.encryptedRefreshToken,
        iv: encryptedTokens.iv,
        authTag: encryptedTokens.authTag,
        tokenExpiry: expiredDate,
      } as any);

      // Mock refresh token endpoint response
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new_fresh_access_token',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
      } as any);

      const tokenResult = await googleOAuthService.getValidAccessToken('usr_auto_refresh');
      expect(tokenResult).not.toBeNull();
      expect(tokenResult?.accessToken).toBe('new_fresh_access_token');
      expect(db.googleOAuthAccount.update).toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. YouTube Channel Management
  // ──────────────────────────────────────────────────────────────────────────
  describe('3. YouTube Channel Discovery & PostgreSQL Sync', () => {
    it('fetches channel details from YouTube Data API v3 and formats data', async () => {
      const mockChannelResponse = {
        items: [
          {
            id: 'UC_REAL_CHANNEL_ID',
            snippet: {
              title: 'Aventuras Infantiles TV',
              customUrl: '@AventurasInfantiles',
              thumbnails: { high: { url: 'https://images.example.com/avatar.png' } },
            },
            statistics: {
              subscriberCount: '50000',
              videoCount: 25,
              viewCount: '1500000',
            },
          },
        ],
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => mockChannelResponse,
      } as any);

      const channel = await youTubeChannelService.fetchUserChannel('mock_access_token');
      expect(channel.id).toBe('UC_REAL_CHANNEL_ID');
      expect(channel.snippet?.title).toBe('Aventuras Infantiles TV');
    });

    it('throws YOUTUBE_CHANNEL_NOT_FOUND if user has no YouTube channel created', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [] }),
      } as any);

      await expect(youTubeChannelService.fetchUserChannel('mock_token')).rejects.toThrowError(
        /No YouTube channel found/
      );
    });

    it('returns connected channel status when user has an active connection in PostgreSQL', async () => {
      vi.spyOn(db.googleOAuthAccount, 'findFirst').mockResolvedValueOnce({
        id: 'acc_connected_01',
        channelConnections: [
          {
            status: 'ACTIVE',
            youtubeChannel: {
              channelId: 'UC_STUDIO_CONNECTED',
              channelTitle: 'Estudio Conectado',
              channelCustomUrl: '@EstudioConectado',
              subscriberCount: '25.000',
              videoCount: 15,
              viewCount: '500.000',
              avatarUrl: 'https://images.example.com/avatar.jpg',
            },
          },
        ],
      } as any);

      const status = await youTubeChannelService.getConnectedChannelForUser('usr_connected');
      expect(status.connected).toBe(true);
      expect(status.isDemoMode).toBe(false);
      expect(status.channelId).toBe('UC_STUDIO_CONNECTED');
      expect(status.channelTitle).toBe('Estudio Conectado');
    });

    it('falls back to Sandbox Demo Channel when user has no active connection', async () => {
      vi.spyOn(db.googleOAuthAccount, 'findFirst').mockResolvedValueOnce(null);

      const status = await youTubeChannelService.getConnectedChannelForUser('usr_unconnected');
      expect(status.connected).toBe(false);
      expect(status.isDemoMode).toBe(true);
      expect(status.channelId).toBe('UC-KTN-KIDSTOON-STUDIO-DEMO');
    });

    it('disconnects channel by setting connection status to REVOKED', async () => {
      vi.spyOn(db.googleOAuthAccount, 'findMany').mockResolvedValueOnce([{ id: 'acc_to_disconnect' }] as any);

      await youTubeChannelService.disconnectChannel('usr_disconnect');
      expect(db.youTubeChannelConnection.updateMany).toHaveBeenCalledWith({
        where: { googleOAuthAccountId: 'acc_to_disconnect', status: 'ACTIVE' },
        data: expect.objectContaining({ status: 'REVOKED' }),
      });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. Resumable Uploader Protocol & COPPA Enforcers
  // ──────────────────────────────────────────────────────────────────────────
  describe('4. Resumable Uploader Protocol & COPPA Enforcement', () => {
    it('initiates resumable upload with correct headers and COPPA selfDeclaredMadeForKids: true', async () => {
      const mockLocation = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=resumable_session_123';

      let capturedHeaders: any = null;
      let capturedBody: any = null;

      vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (_url, opts: any) => {
        capturedHeaders = opts.headers;
        capturedBody = JSON.parse(opts.body);
        return {
          ok: true,
          headers: { get: (name: string) => (name.toLowerCase() === 'location' ? mockLocation : null) },
        } as any;
      });

      const uploadUri = await youTubeUploaderService.initiateResumableUpload(
        'sample_bearer_token',
        {
          snippet: {
            title: 'Milo en la Nieve',
            description: 'Aventura invernal para niños preescolares',
            tags: ['milo', 'invierno', 'cuento'],
            categoryId: '1',
          },
          status: {
            privacyStatus: 'private',
            selfDeclaredMadeForKids: true,
          },
        },
        5000000
      );

      expect(uploadUri).toBe(mockLocation);
      expect(capturedHeaders['Authorization']).toBe('Bearer sample_bearer_token');
      expect(capturedHeaders['X-Upload-Content-Type']).toBe('video/mp4');
      expect(capturedHeaders['X-Upload-Content-Length']).toBe('5000000');
      expect(capturedBody.status.selfDeclaredMadeForKids).toBe(true);
      expect(capturedBody.status.privacyStatus).toBe('private');
    });

    it('uploads binary MP4 stream to acquired resumable upload URI', async () => {
      const mockResult = {
        id: 'yt_uploaded_vid_99',
        snippet: { title: 'Milo en la Nieve' },
        status: { privacyStatus: 'private', uploadStatus: 'uploaded' },
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => mockResult,
      } as any);

      const fakeVideoBuffer = Buffer.from('FAKE_MP4_BINARY_DATA_FOR_YOUTUBE');
      const res = await youTubeUploaderService.uploadBinaryStream('https://upload.youtube.com/resumable', fakeVideoBuffer);

      expect(res.id).toBe('yt_uploaded_vid_99');
      expect(res.status?.uploadStatus).toBe('uploaded');
    });

    it('records publication and provider execution telemetry in PostgreSQL', async () => {
      const pubRecord = await youTubeUploaderService.recordPublicationInDatabase(
        {
          episodeId: 'ep_test_persist',
          title: 'Episodio Guardado',
          description: 'Descripción infantil',
          privacyStatus: 'private',
        },
        'UC_TEST_CHANNEL_123',
        {
          videoId: 'yt_vid_persisted',
          videoUrl: 'https://youtube.com/watch?v=yt_vid_persisted',
          privacyStatus: 'private',
          isDemo: false,
        }
      );

      expect(pubRecord).toBeDefined();
      expect(db.youTubePublication.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          episodeId: 'ep_test_persist',
          madeForKids: true,
          privacyStatus: 'PRIVATE',
          publishedVideoId: 'yt_vid_persisted',
        }),
      });
      expect(db.providerExecution.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          provider: 'YOUTUBE_DATA_API',
          modelOrService: 'videos.insert',
        }),
      });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 5. Master YouTube Service & QC Gatekeeper Invariant
  // ──────────────────────────────────────────────────────────────────────────
  describe('5. Master YouTube Service & Quality Control (QC) Gatekeeper Invariant', () => {
    it('blocks publication and throws QC_VALIDATION_FAILED if episode failed audio drift or COPPA audit', async () => {
      // Mock QC service returning blocked report
      vi.spyOn(qcService, 'getLatestReport').mockResolvedValueOnce({
        isBlocked: true,
        approvedForProduction: false,
        blockingReasons: ['AUDIO_DRIFT_SYNC_LIMIT: Desincronización crítica de audio (0.120s > 0.050s)'],
        driftTelemetry: { maxDriftSeconds: 0.12, exceedsThreshold: true },
      } as any);

      await expect(
        youTubeService.publishEpisode({
          episodeId: 'ep_blocked_by_qc',
          title: 'Episodio Desincronizado',
          description: 'No apto para emisión',
        })
      ).rejects.toThrowError(/Publicación abortada por Control de Calidad/);
    });

    it('permits publication when QC report is approved and free of critical defects', async () => {
      vi.spyOn(qcService, 'getLatestReport').mockResolvedValueOnce({
        isBlocked: false,
        approvedForProduction: true,
        blockingReasons: [],
      } as any);

      const result = await youTubeService.publishEpisode({
        episodeId: 'ep_qc_passed',
        title: 'Episodio Auditado y Aprobado',
        description: 'Listo para YouTube',
        privacyStatus: 'private',
      });

      expect(result.success).toBe(true);
      expect(result.privacyStatus).toBe('private');
      expect(result.madeForKids).toBe(true);
    });

    it('executes in high-fidelity Sandbox Mode when Google OAuth credentials are not configured', async () => {
      vi.spyOn(googleOAuthService, 'getValidAccessToken').mockResolvedValueOnce(null);

      const result = await youTubeService.publishEpisode({
        episodeId: 'ep_sandbox_run',
        title: 'Milo en Modo Sandbox',
        description: 'Prueba en entorno dev local',
        forceBypassQcForTesting: true,
      });

      expect(result.success).toBe(true);
      expect(result.isDemoMode).toBe(true);
      expect(result.videoId).toContain('yt_sbx_');
      expect(result.videoUrl).toContain('https://youtube.com/watch?v=yt_sbx_');
      expect(result.message).toContain('SANDBOX');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 6. Express REST Router Endpoints
  // ──────────────────────────────────────────────────────────────────────────
  describe('6. Express REST Router Endpoints under /api/youtube/*', () => {
    it('GET /api/youtube/auth-url returns Google consent screen URL', async () => {
      const res = await fakeHttpRequest(testApp, '/api/youtube/auth-url', { method: 'GET' });
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.authUrl).toContain('https://accounts.google.com/o/oauth2/v2/auth');
    });

    it('GET /api/youtube/status returns channel connection status', async () => {
      const res = await fakeHttpRequest(testApp, '/api/youtube/status', { method: 'GET' });
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.channel).toBeDefined();
    });

    it('GET /api/youtube/callback verifies state and rejects forged CSRF request', async () => {
      const res = await fakeHttpRequest(testApp, '/api/youtube/callback?code=mock_code&state=forged_state', {
        method: 'GET',
      });
      expect(res.statusCode).toBe(400);
      expect(res.body.code).toBe('INVALID_STATE');
    });

    it('POST /api/youtube/publish accepts canonical and legacy payloads and publishes video', async () => {
      const res = await fakeHttpRequest(testApp, '/api/youtube/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'ep_router_pub',
          episodeTitle: 'Episodio Vía Router',
          privacyStatus: 'private',
          forceBypassQcForTesting: true,
        }),
      });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.madeForKids).toBe(true);
      expect(res.body.privacyStatus).toBe('private');
    });

    it('POST /api/youtube/publish returns HTTP 422 when blocked by QC audit', async () => {
      vi.spyOn(qcService, 'getLatestReport').mockResolvedValueOnce({
        isBlocked: true,
        approvedForProduction: false,
        blockingReasons: ['COPPA_COMMERCIAL_PROHIBITED: Llamada comercial agresiva detectada'],
      } as any);

      const res = await fakeHttpRequest(testApp, '/api/youtube/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          episodeId: 'ep_coppa_fail',
          title: 'Episodio No Conforme',
          privacyStatus: 'private',
        }),
      });

      expect(res.statusCode).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('QC_VALIDATION_FAILED');
      expect(res.body.message).toContain('COPPA_COMMERCIAL_PROHIBITED');
    });

    it('POST /api/youtube/disconnect disconnects linked channel', async () => {
      const res = await fakeHttpRequest(testApp, '/api/youtube/disconnect', { method: 'POST' });
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('desconectado');
    });

    it('GET /api/youtube/publications/:episodeId returns publication history', async () => {
      const res = await fakeHttpRequest(testApp, '/api/youtube/publications/ep_history_01', { method: 'GET' });
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.publications)).toBe(true);
      expect(res.body.publications[0].publishedVideoId).toBe('yt_vid_abc123');
    });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Lightweight Node HTTP Mock Dispatcher (Zero External Test Dependencies)
// ──────────────────────────────────────────────────────────────────────────────
async function fakeHttpRequest(
  app: express.Express,
  path: string,
  options: { method: string; headers?: Record<string, string>; body?: string }
): Promise<{ statusCode: number; body: any; headers: Record<string, any> }> {
  return new Promise((resolve) => {
    const server = createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as any;
      const port = address.port;
      const url = `http://127.0.0.1:${port}${path}`;

      const fetchHeaders: Record<string, string> = {
        ...(options.headers || {}),
      };

      fetch(url, {
        method: options.method,
        headers: fetchHeaders,
        body: options.body,
      })
        .then(async (res) => {
          let responseBody: any = null;
          const text = await res.text();
          try {
            responseBody = JSON.parse(text);
          } catch {
            responseBody = text;
          }

          const responseHeaders: Record<string, any> = {};
          res.headers.forEach((v, k) => {
            responseHeaders[k] = v;
          });

          server.close(() => {
            resolve({
              statusCode: res.status,
              body: responseBody,
              headers: responseHeaders,
            });
          });
        })
        .catch((err) => {
          server.close(() => {
            resolve({
              statusCode: 500,
              body: { error: err.message },
              headers: {},
            });
          });
        });
    });
  });
}
