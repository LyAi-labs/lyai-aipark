/**
 * YouTube Channel Management Service
 * Synchronizes channel metadata from YouTube Data API v3 into PostgreSQL.
 * Manages M:N relations between GoogleOAuthAccount and YouTubeChannel.
 */

import { db } from '../db';
import { logger } from '../utils/logger';
import { AppError } from '../errors';
import { DEMO_ONLY_YOUTUBE_CHANNEL } from '../mocks/demo-data';
import type { YouTubeChannelStatus, YouTubeChannelItem, YouTubeChannelListResponse } from './types';

export class YouTubeChannelService {
  /**
   * Discovers and retrieves the authenticated user's YouTube Channel via YouTube Data API v3.
   */
  async fetchUserChannel(accessToken: string): Promise<YouTubeChannelItem> {
    const url = 'https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails&mine=true';
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      const errText = await response.text();
      logger.error('Failed to fetch YouTube channels list', { status: response.status, body: errText });
      throw new AppError(`Failed to fetch YouTube channel: ${errText}`, 502, 'YOUTUBE_API_ERROR');
    }

    const data = (await response.json()) as YouTubeChannelListResponse;
    if (!data.items || data.items.length === 0) {
      throw new AppError(
        'No YouTube channel found for this Google account. Create a channel in YouTube Studio first.',
        404,
        'YOUTUBE_CHANNEL_NOT_FOUND'
      );
    }

    return data.items[0];
  }

  /**
   * Persists channel and establishes connection with Google OAuth account in PostgreSQL.
   */
  async syncChannelWithDatabase(
    googleOAuthAccountId: string,
    channelData: YouTubeChannelItem
  ) {
    const snippet = channelData.snippet || {};
    const stats = channelData.statistics || {};

    const avatarUrl =
      snippet.thumbnails?.high?.url ||
      snippet.thumbnails?.medium?.url ||
      snippet.thumbnails?.default?.url ||
      null;

    // 1. Upsert YouTubeChannel
    const channel = await db.youTubeChannel.upsert({
      where: { channelId: channelData.id },
      update: {
        channelTitle: snippet.title || 'Canal de YouTube',
        channelCustomUrl: snippet.customUrl || null,
        subscriberCount: stats.subscriberCount ? Number(stats.subscriberCount).toLocaleString('es-ES') : '0',
        videoCount: stats.videoCount ? parseInt(String(stats.videoCount), 10) : 0,
        viewCount: stats.viewCount ? Number(stats.viewCount).toLocaleString('es-ES') : '0',
        avatarUrl,
        isDemoMode: false,
        statusMessage: 'Canal oficial conectado mediante Google OAuth 2.0 y verificado.',
      },
      create: {
        channelId: channelData.id,
        channelTitle: snippet.title || 'Canal de YouTube',
        channelCustomUrl: snippet.customUrl || null,
        subscriberCount: stats.subscriberCount ? Number(stats.subscriberCount).toLocaleString('es-ES') : '0',
        videoCount: stats.videoCount ? parseInt(String(stats.videoCount), 10) : 0,
        viewCount: stats.viewCount ? Number(stats.viewCount).toLocaleString('es-ES') : '0',
        avatarUrl,
        isDemoMode: false,
        statusMessage: 'Canal oficial conectado mediante Google OAuth 2.0 y verificado.',
      },
    });

    // 2. Link YouTubeChannelConnection (M:N)
    await db.youTubeChannelConnection.upsert({
      where: {
        uq_channel_connection: {
          googleOAuthAccountId,
          youtubeChannelId: channel.id,
        },
      },
      update: {
        status: 'ACTIVE',
        lastVerifiedAt: new Date(),
        revokedAt: null,
      },
      create: {
        googleOAuthAccountId,
        youtubeChannelId: channel.id,
        status: 'ACTIVE',
        lastVerifiedAt: new Date(),
      },
    });

    logger.info('YouTube channel synchronized to database', {
      channelId: channel.channelId,
      title: channel.channelTitle,
    });

    return channel;
  }

  /**
   * Returns current active channel status for a given user.
   * If not connected or in sandbox dev mode, returns the clean demo channel status.
   */
  async getConnectedChannelForUser(userId: string): Promise<YouTubeChannelStatus> {
    const account = await db.googleOAuthAccount.findFirst({
      where: { userId },
      include: {
        channelConnections: {
          where: { status: 'ACTIVE' },
          include: { youtubeChannel: true },
          orderBy: { updatedAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const activeConn = account?.channelConnections?.[0];
    if (activeConn?.youtubeChannel) {
      const ch = activeConn.youtubeChannel;
      return {
        connected: true,
        isDemoMode: false,
        channelId: ch.channelId,
        channelTitle: ch.channelTitle,
        channelCustomUrl: ch.channelCustomUrl || '@canalsinurl',
        subscriberCount: ch.subscriberCount || '0',
        videoCount: ch.videoCount,
        viewCount: ch.viewCount || '0',
        avatarUrl: ch.avatarUrl || 'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=160',
        statusMessage: 'Canal de YouTube conectado y activo mediante OAuth 2.0.',
      };
    }

    // Default Fallback: Sandbox Demo Channel
    return {
      connected: false,
      isDemoMode: true,
      channelId: DEMO_ONLY_YOUTUBE_CHANNEL.channelId,
      channelTitle: DEMO_ONLY_YOUTUBE_CHANNEL.channelTitle,
      channelCustomUrl: DEMO_ONLY_YOUTUBE_CHANNEL.channelCustomUrl,
      subscriberCount: DEMO_ONLY_YOUTUBE_CHANNEL.subscriberCount,
      videoCount: DEMO_ONLY_YOUTUBE_CHANNEL.videoCount,
      viewCount: DEMO_ONLY_YOUTUBE_CHANNEL.viewCount,
      avatarUrl: DEMO_ONLY_YOUTUBE_CHANNEL.avatarUrl,
      statusMessage: DEMO_ONLY_YOUTUBE_CHANNEL.statusMessage,
    };
  }

  /**
   * Disconnects / revokes channel connection for a user.
   */
  async disconnectChannel(userId: string): Promise<void> {
    const accounts = await db.googleOAuthAccount.findMany({
      where: { userId },
      select: { id: true },
    });

    for (const acc of accounts) {
      await db.youTubeChannelConnection.updateMany({
        where: { googleOAuthAccountId: acc.id, status: 'ACTIVE' },
        data: {
          status: 'REVOKED',
          revokedAt: new Date(),
        },
      });
    }

    logger.info('Disconnected YouTube channel for user', { userId });
  }
}

export const youTubeChannelService = new YouTubeChannelService();
