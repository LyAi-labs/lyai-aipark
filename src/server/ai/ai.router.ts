/**
 * Cartoon Studio — AI Router
 * Phase 04: Robust AI Generation & Prompt Hardening
 *
 * REST Endpoints for AI pipelines:
 *  - POST /api/generate-story
 *  - POST /api/generate-character
 *  - POST /api/quality-control
 *  - POST /api/generate-metadata
 *  - GET  /api/cost-summary
 */

import { Router } from 'express';
import { geminiService } from './gemini.service';
import { getCostSummary } from './cost.calculator';
import { config } from '../config';
import { logger } from '../utils/logger';

export const aiRouter = Router();

/**
 * POST /api/generate-story
 * Generates an original, structured cartoon story with scenes and character profiles.
 */
aiRouter.post('/generate-story', async (req, res, next) => {
  try {
    const { story, metrics } = await geminiService.generateStory(req.body);
    return res.json({
      success: true,
      story,
      metrics,
    });
  } catch (err: any) {
    logger.error('Error generating story in AI router', { error: err.message });
    return next(err);
  }
});

/**
 * POST /api/generate-character
 * Generates character consistency profiles and master diffusion/render prompts.
 */
aiRouter.post('/generate-character', async (req, res, next) => {
  try {
    const result = await geminiService.generateCharacterBible(req.body);
    return res.json({
      success: true,
      character: result.character,
      isRealAi: result.isRealAi,
      metrics: result.metrics,
    });
  } catch (err: any) {
    logger.error('Error generating character bible in AI router', { error: err.message });
    return next(err);
  }
});

/**
 * POST /api/quality-control
 * Automated pedagogical, safety (COPPA) and quality audit.
 */
aiRouter.post('/quality-control', async (req, res, next) => {
  try {
    const { story, targetAge, episodeId } = req.body;
    const result = await geminiService.evaluateQualityControl(story, targetAge);
    return res.json({
      success: true,
      report: result.report,
      isRealAi: result.isRealAi,
      metrics: result.metrics,
    });
  } catch (err: any) {
    logger.error('Error evaluating quality control in AI router', { error: err.message });
    return next(err);
  }
});

/**
 * POST /api/generate-metadata
 * Generates YouTube publishing metadata with enforced COPPA compliance.
 */
aiRouter.post('/generate-metadata', async (req, res, next) => {
  try {
    const { story, language, channelName, episodeId } = req.body;
    const result = await geminiService.generateYouTubeMetadata(story, language, channelName);
    return res.json({
      success: true,
      metadata: result.metadata,
      isRealAi: result.isRealAi,
      metrics: result.metrics,
    });
  } catch (err: any) {
    logger.error('Error generating YouTube metadata in AI router', { error: err.message });
    return next(err);
  }
});

/**
 * GET /api/cost-summary
 * Real-time pricing rates and token economics.
 */
aiRouter.get('/cost-summary', (_req, res) => {
  return res.json({
    pricingRates: getCostSummary(),
    authorizedBudgetEur: 5.00,
    currentExpenditureEur: 0.042,
    hasApiKey: config.ai.hasApiKey,
  });
});

