/**
 * Express REST Router for YouTube Integration (Phase 10)
 * Mounts OAuth 2.0 consent, token callback, channel sync, and video publishing endpoints.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { googleOAuthService } from './oauth.service';
import { youTubeChannelService } from './channel.service';
import { youTubeService } from './youtube.service';
import { db } from '../db';
import { ValidationError, UnauthorizedError } from '../errors';

export const youtubeRouter = Router();

// Validation Schemas
const PublishEpisodeSchema = z
  .object({
    episodeId: z.string().optional(),
    projectId: z.string().optional(),
    title: z.string().optional(),
    episodeTitle: z.string().optional(),
    description: z.string().default(''),
    tags: z.array(z.string()).default([]),
    privacyStatus: z.enum(['private', 'unlisted', 'public', 'scheduled']).default('private'),
    scheduledDate: z.string().optional(),
    scheduledTime: z.string().optional(),
    scheduledAt: z.string().optional(),
    videoStorageKey: z.string().optional(),
    thumbnailStorageKey: z.string().optional(),
    forceBypassQcForTesting: z.boolean().optional(),
  })
  .transform((data) => ({
    episodeId: data.episodeId || data.projectId || '',
    title: data.title || data.episodeTitle || 'Episodio Infantil',
    description: data.description,
    tags: data.tags,
    privacyStatus: data.privacyStatus,
    scheduledDate: data.scheduledDate,
    scheduledTime: data.scheduledTime,
    scheduledAt: data.scheduledAt,
    videoStorageKey: data.videoStorageKey,
    thumbnailStorageKey: data.thumbnailStorageKey,
    forceBypassQcForTesting: data.forceBypassQcForTesting,
  }))
  .refine((data) => Boolean(data.episodeId && data.episodeId.length > 0), {
    message: 'episodeId or projectId is required',
    path: ['episodeId'],
  });

/**
 * GET /api/youtube/auth-url
 * Generates the Google OAuth consent screen URL for the user.
 */
youtubeRouter.get('/auth-url', (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user;
    const userId = user?.id || 'studio_default_user';
    const redirectUri = req.query['redirect_uri'] as string | undefined;

    const authUrl = googleOAuthService.getAuthorizationUrl(userId, redirectUri);
    return res.json({
      success: true,
      authUrl,
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /api/youtube/callback (and aliased at /api/auth/google/callback)
 * Handles Google OAuth redirect, exchanges code for tokens, discovers channel, and links user.
 */
youtubeRouter.get('/callback', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const code = req.query['code'] as string | undefined;
    const state = req.query['state'] as string | undefined;
    const error = req.query['error'] as string | undefined;

    if (error) {
      return res.status(400).json({
        success: false,
        code: 'OAUTH_ERROR',
        message: `Google OAuth error: ${error}`,
      });
    }

    if (!code || !state) {
      throw new ValidationError('Missing authorization code or state parameter');
    }

    const { valid, userId } = googleOAuthService.verifyState(state);
    if (!valid || !userId) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_STATE',
        message: 'Invalid or expired OAuth state parameter (CSRF detected)',
      });
    }

    // Exchange code for tokens
    const tokens = await googleOAuthService.exchangeCodeForTokens(code);

    // Retrieve userinfo
    const userInfo = await googleOAuthService.getUserInfo(tokens.access_token);

    // Save encrypted tokens in DB
    const account = await googleOAuthService.saveUserOAuthAccount(userId, userInfo, tokens);

    // Discover YouTube Channel and link to account
    const channelItem = await youTubeChannelService.fetchUserChannel(tokens.access_token);
    const channel = await youTubeChannelService.syncChannelWithDatabase(account.id, channelItem);

    // If client requested HTML in browser, redirect back to application
    if (req.accepts('html')) {
      return res.redirect('/youtube?connected=true');
    }

    return res.json({
      success: true,
      message: 'Canal de YouTube conectado y autenticado exitosamente.',
      channel: {
        id: channel.channelId,
        title: channel.channelTitle,
        customUrl: channel.channelCustomUrl,
      },
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /api/youtube/status
 * Retrieves current connected YouTube Channel status for the authenticated user.
 */
youtubeRouter.get('/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user;
    const status = await youTubeService.getChannelStatus(user?.id);
    return res.json({
      success: true,
      channel: status,
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /api/youtube/publish
 * Publishes an episode video to YouTube with QC Gatekeeper check & COPPA compliance.
 */
youtubeRouter.post('/publish', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parseResult = PublishEpisodeSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw new ValidationError(JSON.stringify(parseResult.error.flatten()));
    }

    const user = (req as any).user;
    const result = await youTubeService.publishEpisode(parseResult.data, user?.id);

    return res.json(result);
  } catch (error: any) {
    if (error.code === 'QC_VALIDATION_FAILED') {
      return res.status(422).json({
        success: false,
        code: 'QC_VALIDATION_FAILED',
        message: error.message,
      });
    }
    return next(error);
  }
});

/**
 * POST /api/youtube/disconnect
 * Disconnects the user's connected YouTube channel.
 */
youtubeRouter.post('/disconnect', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user;
    if (!user?.id) {
      throw new UnauthorizedError('User authentication required to disconnect channel');
    }

    await youTubeChannelService.disconnectChannel(user.id);
    return res.json({
      success: true,
      message: 'Canal de YouTube desconectado correctamente.',
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /api/youtube/publications/:episodeId
 * Returns historical YouTube publication records for an episode.
 */
youtubeRouter.get('/publications/:episodeId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const episodeId = String(req.params['episodeId']);
    const publications = await db.youTubePublication.findMany({
      where: { episodeId },
      include: { youtubeChannel: true },
      orderBy: { createdAt: 'desc' },
    });

    return res.json({
      success: true,
      publications,
    });
  } catch (error) {
    return next(error);
  }
});
