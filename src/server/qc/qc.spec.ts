/**
 * Cartoon Studio — Quality Control & COPPA Compliance Test Suite
 * Phase 09: Objective Quality Control (Audio Drift & COPPA Checks)
 *
 * Exhaustively validates:
 * 1. Audio Drift mathematical invariants (tolerance: abs(audio - video) <= 0.05s).
 * 2. Scene-by-scene cumulative drift telemetry.
 * 3. Media probe with ffprobe stream inspection.
 * 4. Deterministic COPPA & FTC 16 CFR Part 312 child safety verification.
 * 5. PII extraction and commercial call-to-action blocking.
 * 6. Automatic production blocking (isBlocked = true) on critical failure.
 * 7. QualityControlService orchestration and PostgreSQL persistence.
 * 8. REST API endpoints under /api/qc/*.
 * 9. YouTube publication gatekeeper invariant.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import { EventEmitter } from 'node:events';
import { db } from '../db';
import {
  calculateDriftSeconds,
  verifyAudioDrift,
  verifySceneDriftTimeline,
  probeMediaDuration,
  DEFAULT_MAX_DRIFT_SECONDS,
} from './drift.verifier';
import { verifyCoppaCompliance } from './coppa.verifier';
import { qcService } from './qc.service';
import { qcRouter } from './qc.router';
import { ValidationError } from '../errors';

describe('Phase 09 — Objective Quality Control (Audio Drift & COPPA Checks)', () => {
  let testApp: express.Express;

  beforeEach(() => {
    vi.spyOn(db.episodeVersion, 'findFirst').mockResolvedValue(null);
    vi.spyOn(db.episode, 'findUnique').mockResolvedValue(null);
    vi.spyOn(db.qCReport, 'findFirst').mockResolvedValue(null);
    vi.spyOn(db.qCReport, 'updateMany').mockResolvedValue({ count: 1 } as any);
    vi.spyOn(db.episode, 'updateMany').mockResolvedValue({ count: 1 } as any);
    vi.spyOn(db.qCReport, 'create').mockResolvedValue({ id: 'mock_report_1' } as any);
    vi.spyOn(db.qCCheck, 'createMany').mockResolvedValue({ count: 5 } as any);

    testApp = express();
    testApp.use(express.json());
    testApp.use('/api/qc', qcRouter);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 1. Audio Drift Mathematical & Broadcast Invariants
  // ──────────────────────────────────────────────────────────────────────────
  describe('1. Audio Drift Mathematical & Broadcast Invariants', () => {
    it('calculates signed drift seconds with 4-decimal precision', () => {
      expect(calculateDriftSeconds(15.045, 15.000)).toBe(0.045);
      expect(calculateDriftSeconds(15.000, 15.060)).toBe(-0.06);
      expect(calculateDriftSeconds(0, 0)).toBe(0);
      expect(calculateDriftSeconds(NaN as any, 15)).toBe(0);
    });

    it('passes when drift is strictly within the 0.05s (50ms) tolerance threshold', () => {
      // 0ms drift
      const check0 = verifyAudioDrift(15.0, 15.0);
      expect(check0.status).toBe('PASS');
      expect(check0.score).toBe(100);
      expect(check0.severity).toBe('CRITICAL');

      // 40ms drift (within 50ms)
      const check40 = verifyAudioDrift(15.04, 15.0);
      expect(check40.status).toBe('PASS');
      expect(check40.score).toBe(100);

      // Exact 50ms limit boundary
      const check50 = verifyAudioDrift(15.05, 15.0);
      expect(check50.status).toBe('PASS');
      expect(check50.score).toBe(100);

      // Negative 50ms limit boundary
      const checkNeg50 = verifyAudioDrift(14.95, 15.0);
      expect(checkNeg50.status).toBe('PASS');
      expect(checkNeg50.score).toBe(100);
    });

    it('fails with CRITICAL severity when drift exceeds 0.05s by even 1 millisecond', () => {
      // 51ms drift (just over 50ms boundary)
      const check51 = verifyAudioDrift(15.051, 15.0);
      expect(check51.status).toBe('FAIL');
      expect(check51.severity).toBe('CRITICAL');
      expect(check51.telemetry?.driftMs).toBe(51);
      expect(check51.remediation).toBeDefined();

      // Negative 60ms drift
      const checkNeg60 = verifyAudioDrift(14.94, 15.0);
      expect(checkNeg60.status).toBe('FAIL');
      expect(checkNeg60.telemetry?.driftMs).toBe(60);

      // Severe 250ms drift
      const checkSevere = verifyAudioDrift(15.25, 15.0);
      expect(checkSevere.status).toBe('FAIL');
      expect(checkSevere.score).toBe(0);
    });

    it('analyzes scene-by-scene cadence and detects individual scene discrepancies', () => {
      const syncedScenes = [
        { sceneIndex: 1, sceneCode: 'SC_01', nominalDurationSeconds: 5.0, audioDurationSeconds: 5.02 },
        { sceneIndex: 2, sceneCode: 'SC_02', nominalDurationSeconds: 6.0, audioDurationSeconds: 6.01 },
      ];
      const resSynced = verifySceneDriftTimeline(syncedScenes, DEFAULT_MAX_DRIFT_SECONDS);
      expect(resSynced.isSynchronized).toBe(true);
      expect(resSynced.checkResult.status).toBe('PASS');

      const desyncedScenes = [
        { sceneIndex: 1, sceneCode: 'SC_01', nominalDurationSeconds: 5.0, audioDurationSeconds: 5.02 },
        { sceneIndex: 2, sceneCode: 'SC_02', nominalDurationSeconds: 6.0, audioDurationSeconds: 6.12 }, // 120ms drift!
      ];
      const resDesynced = verifySceneDriftTimeline(desyncedScenes, DEFAULT_MAX_DRIFT_SECONDS);
      expect(resDesynced.isSynchronized).toBe(false);
      expect(resDesynced.maxDriftSeconds).toBe(0.12);
      expect(resDesynced.checkResult.status).toBe('WARNING');
    });

    it('probes media streams gracefully and falls back if file does not exist', async () => {
      const probe = await probeMediaDuration('non_existent_file.mp4');
      expect(probe.durationSeconds).toBe(0);
      expect(probe.hasVideo).toBe(false);
      expect(probe.hasAudio).toBe(false);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. Deterministic COPPA & FTC 16 CFR Part 312 Verifications
  // ──────────────────────────────────────────────────────────────────────────
  describe('2. Deterministic COPPA & FTC 16 CFR Part 312 Verifications', () => {
    it('approves compliant episode with madeForKids: true and private visibility', () => {
      const checks = verifyCoppaCompliance({
        targetAge: '4-6',
        title: 'Milo comparte sus peonzas',
        dialogueTexts: ['¡Hola Tula! ¿Quieres jugar con mis peonzas brillantes?'],
        narrationTexts: ['El bosque se iluminó de sonrisas y alegría.'],
        madeForKids: true,
        privacyStatus: 'private',
        coppaComplianceConfirmed: true,
      });

      expect(checks.length).toBeGreaterThanOrEqual(5);
      const failures = checks.filter((c) => c.status === 'FAIL');
      expect(failures).toHaveLength(0);

      const piiCheck = checks.find((c) => c.ruleCode === 'COPPA_PII_DATA_COLLECTION');
      expect(piiCheck?.status).toBe('PASS');
      expect(piiCheck?.score).toBe(100);

      const madeForKidsCheck = checks.find((c) => c.ruleCode === 'COPPA_MADE_FOR_KIDS_CLASSIFICATION');
      expect(madeForKidsCheck?.status).toBe('PASS');
    });

    it('fails critically if madeForKids is false or undefined', () => {
      const checks = verifyCoppaCompliance({
        targetAge: '4-6',
        title: 'Aventura en el Bosque',
        dialogueTexts: ['Vamos a jugar.'],
        madeForKids: false,
        privacyStatus: 'private',
      });

      const madeForKidsCheck = checks.find((c) => c.ruleCode === 'COPPA_MADE_FOR_KIDS_CLASSIFICATION');
      expect(madeForKidsCheck?.status).toBe('FAIL');
      expect(madeForKidsCheck?.severity).toBe('CRITICAL');
      expect(madeForKidsCheck?.score).toBe(0);
    });

    it('fails critically if initial publish visibility is public', () => {
      const checks = verifyCoppaCompliance({
        targetAge: '4-6',
        title: 'Aventura de Milo',
        madeForKids: true,
        privacyStatus: 'public', // Direct public publishing violates human review safety rule
      });

      const privacyCheck = checks.find((c) => c.ruleCode === 'COPPA_PRIVATE_PUBLISH_DEFAULT');
      expect(privacyCheck?.status).toBe('FAIL');
      expect(privacyCheck?.severity).toBe('CRITICAL');
    });

    it('detects and flags personally identifiable information (PII) emails', () => {
      const checks = verifyCoppaCompliance({
        targetAge: '4-6',
        title: 'Contacto de Amigos',
        dialogueTexts: ['Escríbeme a milo.zorro@escuela-infantil.com para ser amigos.'],
        madeForKids: true,
        privacyStatus: 'private',
      });

      const piiCheck = checks.find((c) => c.ruleCode === 'COPPA_PII_DATA_COLLECTION');
      expect(piiCheck?.status).toBe('FAIL');
      expect(piiCheck?.severity).toBe('CRITICAL');
      expect(piiCheck?.telemetry?.emails).toContain('milo.zorro@escuela-infantil.com');
    });

    it('detects and flags personal phone numbers', () => {
      const checks = verifyCoppaCompliance({
        targetAge: '4-6',
        title: 'Teléfono Secreto',
        dialogueTexts: ['Llama a mi teléfono +34 612 345 678 para más juegos.'],
        madeForKids: true,
        privacyStatus: 'private',
      });

      const piiCheck = checks.find((c) => c.ruleCode === 'COPPA_PII_DATA_COLLECTION');
      expect(piiCheck?.status).toBe('FAIL');
      expect(piiCheck?.severity).toBe('CRITICAL');
    });

    it('detects sensitive child data solicitation patterns (address, full name, school)', () => {
      const checkAddress = verifyCoppaCompliance({
        targetAge: '4-6',
        title: 'Pregunta Curiosa',
        dialogueTexts: ['¿Dónde vives tú? Dime tu dirección exacta para visitarte.'],
        madeForKids: true,
        privacyStatus: 'private',
      });
      expect(checkAddress.find((c) => c.ruleCode === 'COPPA_PII_DATA_COLLECTION')?.status).toBe('FAIL');

      const checkFullName = verifyCoppaCompliance({
        targetAge: '4-6',
        title: 'Pregunta Curiosa',
        dialogueTexts: ['Dime tu nombre completo y apellido para anotarlo.'],
        madeForKids: true,
        privacyStatus: 'private',
      });
      expect(checkFullName.find((c) => c.ruleCode === 'COPPA_PII_DATA_COLLECTION')?.status).toBe('FAIL');
    });

    it('detects and blocks dangerous acts, weapons and profanity', () => {
      const checkWeapon = verifyCoppaCompliance({
        targetAge: '4-6',
        title: 'Peligro',
        dialogueTexts: ['Milo agarró una pistola y apuntó.'],
        madeForKids: true,
        privacyStatus: 'private',
      });
      expect(checkWeapon.find((c) => c.ruleCode === 'COPPA_CHILD_SAFETY_CONTENT')?.status).toBe('FAIL');

      const checkFire = verifyCoppaCompliance({
        targetAge: '4-6',
        title: 'Fuego',
        dialogueTexts: ['Vamos a jugar con fuego y cerillas en la cocina.'],
        madeForKids: true,
        privacyStatus: 'private',
      });
      expect(checkFire.find((c) => c.ruleCode === 'COPPA_CHILD_SAFETY_CONTENT')?.status).toBe('FAIL');

      const checkProfanity = verifyCoppaCompliance({
        targetAge: '4-6',
        title: 'Lenguaje Inadecuado',
        dialogueTexts: ['¡Eres un idiota estúpido!'],
        madeForKids: true,
        privacyStatus: 'private',
      });
      expect(checkProfanity.find((c) => c.ruleCode === 'COPPA_CHILD_SAFETY_CONTENT')?.status).toBe('FAIL');
    });

    it('detects and blocks aggressive commercial calls to action (CTAs)', () => {
      const checkCommercial = verifyCoppaCompliance({
        targetAge: '4-6',
        title: 'Juguetes',
        dialogueTexts: ['¡Pide a tus padres que compren el juguete ahora mismo en la tienda!'],
        madeForKids: true,
        privacyStatus: 'private',
      });

      const commCheck = checkCommercial.find((c) => c.ruleCode === 'COPPA_COMMERCIAL_EXPLOITATION');
      expect(commCheck?.status).toBe('FAIL');
      expect(commCheck?.severity).toBe('CRITICAL');
    });

    it('warns about interactions that YouTube disables on Made for Kids videos', () => {
      const checkComments = verifyCoppaCompliance({
        targetAge: '4-6',
        title: 'Interacción',
        dialogueTexts: ['Deja un comentario abajo y activa la campanita.'],
        madeForKids: true,
        privacyStatus: 'private',
      });

      const intCheck = checkComments.find((c) => c.ruleCode === 'COPPA_INTERACTION_RESTRICTIONS');
      expect(intCheck?.status).toBe('WARNING');
      expect(intCheck?.severity).toBe('WARNING');
      expect(intCheck?.score).toBe(60);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. QualityControlService Orchestration & Production Blocking
  // ──────────────────────────────────────────────────────────────────────────
  describe('3. QualityControlService Orchestration & Production Blocking', () => {
    it('audits clean episode and awards approved status with overall score >= 90', async () => {
      const report = await qcService.auditEpisode({
        episodeId: 'ep_clean_01',
        title: 'Milo y el Bosque Mágico',
        targetAge: '4-6',
        audioDurationSeconds: 15.02,
        videoDurationSeconds: 15.00,
        scenes: [
          { nominalDurationSeconds: 7.5, audioDurationSeconds: 7.51, dialogue: 'Hola amigos del bosque.' },
          { nominalDurationSeconds: 7.5, audioDurationSeconds: 7.51, dialogue: 'Hoy vamos a compartir juntos.' },
        ],
        madeForKids: true,
        privacyStatus: 'private',
        coppaComplianceConfirmed: true,
      });

      expect(report.approvedForProduction).toBe(true);
      expect(report.isBlocked).toBe(false);
      expect(report.blockingReasons).toHaveLength(0);
      expect(report.overallScore).toBeGreaterThanOrEqual(90);
      expect(report.driftTelemetry?.isSynchronized).toBe(true);
      expect(report.driftTelemetry?.driftSeconds).toBe(0.02);
    });

    it('blocks production when audio drift exceeds 0.05s', async () => {
      const report = await qcService.auditEpisode({
        episodeId: 'ep_drift_fail',
        title: 'Episodio Desincronizado',
        targetAge: '4-6',
        audioDurationSeconds: 15.12, // 120ms drift vs 15.0s video!
        videoDurationSeconds: 15.00,
        madeForKids: true,
        privacyStatus: 'private',
      });

      expect(report.approvedForProduction).toBe(false);
      expect(report.isBlocked).toBe(true);
      expect(report.blockingReasons.some((r) => r.includes('AUDIO_DRIFT_SYNC_LIMIT'))).toBe(true);
      expect(report.overallScore).toBeLessThan(50);
    });

    it('blocks production when a critical COPPA violation is present', async () => {
      const report = await qcService.auditEpisode({
        episodeId: 'ep_coppa_fail',
        title: 'Episodio Infractor',
        targetAge: '4-6',
        audioDurationSeconds: 10.0,
        videoDurationSeconds: 10.0,
        scenes: [
          { nominalDurationSeconds: 10.0, dialogue: 'Dime tu teléfono y dirección para enviarte un regalo.' },
        ],
        madeForKids: true,
        privacyStatus: 'private',
      });

      expect(report.approvedForProduction).toBe(false);
      expect(report.isBlocked).toBe(true);
      expect(report.blockingReasons.some((r) => r.includes('COPPA_PII_DATA_COLLECTION'))).toBe(true);
      expect(report.overallScore).toBeLessThan(50);
    });

    it('assertPublicationAllowed enforces QC gatekeeper and throws on blocked or missing reports', async () => {
      // 1. Missing report
      await expect(qcService.assertPublicationAllowed('ep_non_existent')).rejects.toThrow(ValidationError);

      // 2. Blocked report
      await qcService.auditEpisode({
        episodeId: 'ep_blocked_test',
        title: 'Test Blocked',
        targetAge: '4-6',
        audioDurationSeconds: 15.2, // Drift 200ms
        videoDurationSeconds: 15.0,
      });

      await expect(qcService.assertPublicationAllowed('ep_blocked_test')).rejects.toThrow(ValidationError);

      // 3. Approved report
      await qcService.auditEpisode({
        episodeId: 'ep_ok_test',
        title: 'Test OK',
        targetAge: '4-6',
        audioDurationSeconds: 15.02,
        videoDurationSeconds: 15.00,
        madeForKids: true,
        privacyStatus: 'private',
      });

      const allowed = await qcService.assertPublicationAllowed('ep_ok_test');
      expect(allowed.allowed).toBe(true);
    });

    it('approveEpisode approves a valid episode but refuses to approve a blocked episode', async () => {
      // Clean episode
      await qcService.auditEpisode({
        episodeId: 'ep_to_approve',
        title: 'Episodio Bueno',
        targetAge: '4-6',
        audioDurationSeconds: 10.0,
        videoDurationSeconds: 10.0,
        madeForKids: true,
        privacyStatus: 'private',
      });
      const approved = await qcService.approveEpisode('ep_to_approve', 'Supervisión humana completada');
      expect(approved.approvedForProduction).toBe(true);

      // Blocked episode
      await qcService.auditEpisode({
        episodeId: 'ep_to_reject',
        title: 'Episodio Malo',
        targetAge: '4-6',
        audioDurationSeconds: 10.3,
        videoDurationSeconds: 10.0,
      });
      await expect(qcService.approveEpisode('ep_to_reject')).rejects.toThrow(ValidationError);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. REST API Endpoints under /api/qc
  // ──────────────────────────────────────────────────────────────────────────
  describe('4. REST API Endpoints under /api/qc', () => {
    it('POST /api/qc/check-drift validates audio-video drift and returns telemetry', async () => {
      const resPass = await fakeHttpRequest(testApp, '/api/qc/check-drift', {
        method: 'POST',
        body: JSON.stringify({
          audioDurationSeconds: 12.03,
          videoDurationSeconds: 12.00,
        }),
      });

      expect(resPass.statusCode).toBe(200);
      expect(resPass.body.success).toBe(true);
      expect(resPass.body.isSynchronized).toBe(true);
      expect(resPass.body.check.ruleCode).toBe('AUDIO_DRIFT_SYNC_LIMIT');

      const resFail = await fakeHttpRequest(testApp, '/api/qc/check-drift', {
        method: 'POST',
        body: JSON.stringify({
          audioDurationSeconds: 12.15,
          videoDurationSeconds: 12.00,
        }),
      });

      expect(resFail.statusCode).toBe(200);
      expect(resFail.body.isSynchronized).toBe(false);
      expect(resFail.body.check.status).toBe('FAIL');
    });

    it('POST /api/qc/check-drift rejects invalid negative numbers with 400 Bad Request', async () => {
      const res = await fakeHttpRequest(testApp, '/api/qc/check-drift', {
        method: 'POST',
        body: JSON.stringify({
          audioDurationSeconds: -5,
          videoDurationSeconds: 10,
        }),
      });

      expect(res.statusCode).toBe(400);
    });

    it('POST /api/qc/check-coppa returns compliance verdict', async () => {
      const res = await fakeHttpRequest(testApp, '/api/qc/check-coppa', {
        method: 'POST',
        body: JSON.stringify({
          targetAge: '4-6',
          title: 'Cuentos del Bosque',
          dialogueTexts: ['Milo y Tula son muy buenos amigos.'],
          madeForKids: true,
          privacyStatus: 'private',
        }),
      });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.isCompliant).toBe(true);
      expect(res.body.checks.length).toBeGreaterThan(0);
    });

    it('POST /api/qc/audit executes full audit and returns report summary', async () => {
      const res = await fakeHttpRequest(testApp, '/api/qc/audit', {
        method: 'POST',
        body: JSON.stringify({
          episodeId: 'ep_api_audit_01',
          title: 'Aventura Completa',
          targetAge: '4-6',
          audioDurationSeconds: 20.01,
          videoDurationSeconds: 20.00,
          madeForKids: true,
          privacyStatus: 'private',
        }),
      });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.report.id).toBeDefined();
      expect(res.body.report.approvedForProduction).toBe(true);
      expect(res.body.report.driftTelemetry).toBeDefined();
    });

    it('GET /api/qc/reports/:episodeId retrieves latest report or returns 404', async () => {
      // 404 for unknown
      const res404 = await fakeHttpRequest(testApp, '/api/qc/reports/non_existent_id', {
        method: 'GET',
      });
      expect(res404.statusCode).toBe(404);

      // Create report first
      await fakeHttpRequest(testApp, '/api/qc/audit', {
        method: 'POST',
        body: JSON.stringify({
          episodeId: 'ep_cached_01',
          title: 'Episodio Guardado',
          targetAge: '4-6',
          audioDurationSeconds: 10.0,
          videoDurationSeconds: 10.0,
        }),
      });

      const res200 = await fakeHttpRequest(testApp, '/api/qc/reports/ep_cached_01', {
        method: 'GET',
      });
      expect(res200.statusCode).toBe(200);
      expect(res200.body.report.episodeId).toBe('ep_cached_01');
    });

    it('POST /api/qc/approve/:episodeId returns 400/422 when approving critically blocked episode', async () => {
      // Create blocked episode
      await fakeHttpRequest(testApp, '/api/qc/audit', {
        method: 'POST',
        body: JSON.stringify({
          episodeId: 'ep_blocked_api',
          title: 'Bloqueado',
          targetAge: '4-6',
          audioDurationSeconds: 10.5, // 500ms drift!
          videoDurationSeconds: 10.0,
        }),
      });

      const resApprove = await fakeHttpRequest(testApp, '/api/qc/approve/ep_blocked_api', {
        method: 'POST',
        body: JSON.stringify({ notes: 'Intentando aprobar a la fuerza' }),
      });

      expect(resApprove.statusCode).toBe(400); // ValidationError is handled with 400
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 5. YouTube Publication Gatekeeper Invariant
  // ──────────────────────────────────────────────────────────────────────────
  describe('5. YouTube Publication Gatekeeper Invariant', () => {
    it('aborts YouTube publication when episode has active QC blocks', async () => {
      // Mount the publication gatekeeper handler in testApp
      testApp.post('/api/youtube/publish', async (req, res) => {
        try {
          const { projectId } = req.body;
          if (projectId) {
            const qcReport = await qcService.getLatestReport(projectId);
            if (qcReport && (qcReport.isBlocked || !qcReport.approvedForProduction)) {
              return res.status(422).json({
                success: false,
                code: 'QC_VALIDATION_FAILED',
                message: `Publicación abortada por Control de Calidad (QC): ${qcReport.blockingReasons.join(' | ')}`,
                blockingReasons: qcReport.blockingReasons,
              });
            }
          }
          return res.status(200).json({ success: true, message: 'Publicado' });
        } catch {
          return res.status(500).json({ error: 'Internal error' });
        }
      });

      // Audit and block an episode
      await qcService.auditEpisode({
        episodeId: 'ep_yt_block',
        title: 'Episodio Bloqueado para YT',
        targetAge: '4-6',
        audioDurationSeconds: 15.3,
        videoDurationSeconds: 15.0,
      });

      // Attempt to publish
      const res = await fakeHttpRequest(testApp, '/api/youtube/publish', {
        method: 'POST',
        body: JSON.stringify({
          projectId: 'ep_yt_block',
          episodeTitle: 'Episodio Bloqueado para YT',
          privacyStatus: 'private',
        }),
      });

      expect(res.statusCode).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('QC_VALIDATION_FAILED');
      expect(res.body.message).toContain('AUDIO_DRIFT_SYNC_LIMIT');
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
          responseBody = typeof chunk === 'string' ? chunk : chunk.toString();
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
