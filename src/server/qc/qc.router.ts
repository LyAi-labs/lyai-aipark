/**
 * Cartoon Studio — Quality Control REST Router
 * Phase 09: Objective Quality Control (Audio Drift & COPPA Checks)
 *
 * REST Endpoints:
 *  - POST /api/qc/audit         — Full episode objective audit (Drift, COPPA, Subtitles)
 *  - POST /api/qc/check-drift   — Standalone millisecond drift verification (|A - V| <= 0.05s)
 *  - POST /api/qc/check-coppa   — Standalone COPPA & child safety rule evaluation
 *  - GET  /api/qc/reports/:id   — Retrieve latest QC report summary for an episode
 *  - POST /api/qc/approve/:id   — Formally approve episode or reject if critically blocked
 */

import { Router, Request, Response, NextFunction } from 'express';
import {
  AuditEpisodeInputSchema,
  CheckDriftInputSchema,
  CheckCoppaInputSchema,
  ApproveEpisodeInputSchema,
} from './qc.schemas';
import { qcService } from './qc.service';
import { verifyAudioDrift } from './drift.verifier';
import { verifyCoppaCompliance } from './coppa.verifier';
import { ValidationError } from '../errors';

export const qcRouter: Router = Router();

/**
 * POST /api/qc/audit
 * Executes full quality control suite across audiovisual and compliance dimensions.
 */
qcRouter.post('/audit', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parseResult = AuditEpisodeInputSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw new ValidationError('Parámetros de auditoría de calidad inválidos: ' + JSON.stringify(parseResult.error.flatten()));
    }

    const userId = (req as any).user?.id;
    const report = await qcService.auditEpisode(parseResult.data, userId);

    return res.status(200).json({
      success: true,
      report,
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /api/qc/check-drift
 * Rapid millisecond-precision audio drift check.
 */
qcRouter.post('/check-drift', (req: Request, res: Response, next: NextFunction) => {
  try {
    const parseResult = CheckDriftInputSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw new ValidationError('Parámetros de verificación de drift inválidos: ' + JSON.stringify(parseResult.error.flatten()));
    }

    const { audioDurationSeconds, videoDurationSeconds, maxToleranceSeconds } = parseResult.data;
    const check = verifyAudioDrift(audioDurationSeconds, videoDurationSeconds, maxToleranceSeconds);

    return res.status(200).json({
      success: true,
      check,
      isSynchronized: check.status === 'PASS',
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /api/qc/check-coppa
 * Rapid standalone COPPA and child safety compliance check.
 */
qcRouter.post('/check-coppa', (req: Request, res: Response, next: NextFunction) => {
  try {
    const parseResult = CheckCoppaInputSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw new ValidationError('Parámetros de verificación COPPA inválidos: ' + JSON.stringify(parseResult.error.flatten()));
    }

    const checks = verifyCoppaCompliance(parseResult.data);
    const hasFailures = checks.some((c) => c.status === 'FAIL');

    return res.status(200).json({
      success: true,
      isCompliant: !hasFailures,
      checks,
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /api/qc/reports/:episodeId
 * Retrieves the latest QC report summary for the specified episode.
 */
qcRouter.get('/reports/:episodeId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const episodeId = String(req.params['episodeId']);
    const report = await qcService.getLatestReport(episodeId);

    if (!report) {
      return res.status(404).json({
        success: false,
        message: `No se encontró informe de Control de Calidad previo para el episodio [${episodeId}].`,
      });
    }

    return res.status(200).json({
      success: true,
      report,
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /api/qc/approve/:episodeId
 * Manually approves an episode for broadcast or rejects if critical violations remain.
 */
qcRouter.post('/approve/:episodeId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const episodeId = String(req.params['episodeId']);
    const parseResult = ApproveEpisodeInputSchema.safeParse({ episodeId, ...req.body });

    if (!parseResult.success) {
      throw new ValidationError('Parámetros de aprobación inválidos: ' + JSON.stringify(parseResult.error.flatten()));
    }

    const report = await qcService.approveEpisode(episodeId, parseResult.data.notes);

    return res.status(200).json({
      success: true,
      message: 'Episodio aprobado con éxito para producción y publicación.',
      report,
    });
  } catch (error) {
    return next(error);
  }
});
