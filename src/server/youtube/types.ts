/**
 * Phase 10 — Real YouTube Integration Types & Interfaces
 * Architecture: Server-First, Zero Bloat, Cryptographically Secured
 */

export type { YouTubeChannelStatus } from '../providers/youtube.provider';

export interface EncryptedOAuthCredentials {
  encryptedAccessToken: string;
  encryptedRefreshToken: string;
  iv: string;
  authTag: string;
}

export interface DecryptedOAuthCredentials {
  accessToken: string;
  refreshToken: string;
}

export interface GoogleOAuthTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  id_token?: string;
}

export interface GoogleUserInfo {
  id: string;
  email: string;
  verified_email?: boolean;
  name?: string;
  picture?: string;
}

export interface YouTubeChannelItem {
  id: string;
  snippet?: {
    title?: string;
    description?: string;
    customUrl?: string;
    thumbnails?: {
      default?: { url?: string };
      medium?: { url?: string };
      high?: { url?: string };
    };
  };
  statistics?: {
    viewCount?: string;
    subscriberCount?: string;
    videoCount?: string | number;
  };
}

export interface YouTubeChannelListResponse {
  items?: YouTubeChannelItem[];
}

export interface YouTubeVideoSnippet {
  title: string;
  description: string;
  tags?: string[];
  categoryId?: string;
}

export interface YouTubeVideoStatus {
  privacyStatus: 'private' | 'unlisted' | 'public';
  selfDeclaredMadeForKids: boolean;
  publishAt?: string;
}

export interface YouTubeVideoMetadata {
  snippet: YouTubeVideoSnippet;
  status: YouTubeVideoStatus;
}

export interface YouTubeVideoInsertResponse {
  id: string;
  snippet?: {
    title?: string;
    publishedAt?: string;
  };
  status?: {
    privacyStatus?: string;
    uploadStatus?: string;
  };
}

export interface YouTubePublishInput {
  episodeId: string;
  title: string;
  description: string;
  tags?: string[];
  privacyStatus?: 'private' | 'unlisted' | 'public' | 'scheduled';
  scheduledDate?: string;
  scheduledTime?: string;
  videoBuffer?: Buffer;
  videoStorageKey?: string;
  thumbnailBuffer?: Buffer;
  thumbnailStorageKey?: string;
  forceBypassQcForTesting?: boolean;
}

export interface YouTubePublishResult {
  success: boolean;
  publicationId: string;
  videoId: string;
  videoUrl: string;
  channelId: string;
  channelTitle: string;
  privacyStatus: 'private' | 'unlisted' | 'public' | 'scheduled';
  madeForKids: boolean;
  scheduledAt?: string;
  publishedAt?: string;
  isDemoMode: boolean;
  message: string;
}
