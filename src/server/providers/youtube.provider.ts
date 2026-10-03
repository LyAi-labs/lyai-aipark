/**
 * YouTube Provider Interface
 * Decouples YouTube Publishing and Channel Management from direct Google APIs SDK.
 */

export interface YouTubeChannelStatus {
  connected: boolean;
  isDemoMode: boolean;
  channelId: string;
  channelTitle: string;
  channelCustomUrl: string;
  subscriberCount: string;
  videoCount: number;
  viewCount: string;
  avatarUrl: string;
  statusMessage: string;
}

export interface YouTubeUploadPayload {
  videoBuffer: Buffer | NodeJS.ReadableStream;
  title: string;
  description: string;
  tags: string[];
  privacyStatus: 'private' | 'unlisted' | 'public';
  madeForKids: boolean;
  categoryId?: string;
  scheduledAt?: string;
  thumbnailBuffer?: Buffer;
}

export interface YouTubeUploadResult {
  videoId: string;
  videoUrl: string;
  privacyStatus: string;
  publishedAt?: string;
  scheduledAt?: string;
}

export interface YouTubeProvider {
  getChannelStatus(): Promise<YouTubeChannelStatus>;
  uploadVideo(payload: YouTubeUploadPayload): Promise<YouTubeUploadResult>;
  setThumbnail(videoId: string, imageBuffer: Buffer): Promise<void>;
  getAnalyticsSummary(): Promise<Record<string, unknown>>;
}
