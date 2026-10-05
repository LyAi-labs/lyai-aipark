/**
 * Centralized Server Configuration Module
 * Loads and provides typed access to environment configuration.
 * Avoids scattered process.env calls across the codebase.
 */

export interface AppConfig {
  env: 'development' | 'production' | 'test';
  port: number;
  appUrl: string;
  isProduction: boolean;
}

export interface DatabaseConfig {
  url: string;
}

export interface AiConfig {
  geminiApiKey: string;
  hasApiKey: boolean;
  defaultModel: string;
}

export interface StorageConfig {
  driver: 'local' | 's3';
  localPath: string;
  s3: {
    endpoint?: string;
    bucket?: string;
    accessKey?: string;
    secretKey?: string;
    region?: string;
  };
}

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  isConfigured: boolean;
}

export interface AuthConfig {
  /** HS256 signing secret for JWT access and refresh tokens. Min 32 chars. */
  jwtSecret: string;
  /** Cookie signing secret for cookie-parser (defence-in-depth). Min 32 chars. */
  sessionSecret: string;
  /** True when both secrets are set and long enough for production use. */
  isConfigured: boolean;
}

export interface TtsConfig {
  provider: 'google-cloud-tts' | 'synthetic';
  apiKey: string;
  hasApiKey: boolean;
  defaultLanguage: string;
  defaultVoice: string;
}

export interface VisualsConfig {
  provider: 'imagen' | 'synthetic';
  apiKey: string;
  hasApiKey: boolean;
  defaultModel: string;
  defaultAspectRatio: '16:9' | '9:16' | '1:1';
}

export interface FfmpegConfig {
  ffmpegPath: string;
  ffprobePath: string;
  defaultResolution: '1080p' | '720p';
  defaultFps: number;
}

export interface SchedulerConfig {
  jobPollIntervalMs: number;
  calendarPollIntervalMs: number;
  maxConcurrentJobs: number;
  autoStart: boolean;
}

export interface ServerConfig {
  app: AppConfig;
  database: DatabaseConfig;
  ai: AiConfig;
  tts: TtsConfig;
  visuals: VisualsConfig;
  ffmpeg: FfmpegConfig;
  storage: StorageConfig;
  googleOAuth: GoogleOAuthConfig;
  auth: AuthConfig;
  scheduler: SchedulerConfig;
}

function parsePort(val: string | undefined, defaultPort = 4000): number {
  if (!val) return defaultPort;
  const parsed = parseInt(val, 10);
  return isNaN(parsed) ? defaultPort : parsed;
}

export function loadConfig(): ServerConfig {
  const env = (process.env['NODE_ENV'] || 'development') as 'development' | 'production' | 'test';
  const geminiApiKey = process.env['GEMINI_API_KEY'] || '';
  const clientId = process.env['GOOGLE_CLIENT_ID'] || '';
  const clientSecret = process.env['GOOGLE_CLIENT_SECRET'] || '';
  const ttsApiKey = process.env['TTS_API_KEY'] || geminiApiKey;
  const ttsProviderEnv = process.env['TTS_PROVIDER'];
  const ttsProvider: 'google-cloud-tts' | 'synthetic' =
    ttsProviderEnv === 'synthetic'
      ? 'synthetic'
      : ttsApiKey && ttsApiKey.length > 0
      ? 'google-cloud-tts'
      : 'synthetic';

  const imageApiKey = process.env['IMAGEN_API_KEY'] || geminiApiKey;
  const imageProviderEnv = process.env['IMAGE_PROVIDER'];
  const imageProvider: 'imagen' | 'synthetic' =
    imageProviderEnv === 'synthetic'
      ? 'synthetic'
      : imageApiKey && imageApiKey.length > 0
      ? 'imagen'
      : 'synthetic';

  return {
    app: {
      env,
      port: parsePort(process.env['PORT'], 4000),
      appUrl: process.env['APP_URL'] || 'http://localhost:4000',
      isProduction: env === 'production',
    },
    database: {
      url: process.env['DATABASE_URL'] || 'postgresql://postgres:postgres@localhost:5432/cartoon_studio?schema=public',
    },
    ai: {
      geminiApiKey,
      hasApiKey: Boolean(geminiApiKey && geminiApiKey.length > 0),
      defaultModel: 'gemini-3.8-flash',
    },
    tts: {
      provider: ttsProvider,
      apiKey: ttsApiKey,
      hasApiKey: Boolean(ttsApiKey && ttsApiKey.length > 0),
      defaultLanguage: process.env['TTS_DEFAULT_LANGUAGE'] || 'es-ES',
      defaultVoice: process.env['TTS_DEFAULT_VOICE'] || 'es-ES-Neural2-A',
    },
    visuals: {
      provider: imageProvider,
      apiKey: imageApiKey,
      hasApiKey: Boolean(imageApiKey && imageApiKey.length > 0),
      defaultModel: process.env['IMAGEN_MODEL'] || 'imagen-3.0-generate-002',
      defaultAspectRatio: '16:9',
    },
    ffmpeg: {
      ffmpegPath: process.env['FFMPEG_PATH'] || 'ffmpeg',
      ffprobePath: process.env['FFPROBE_PATH'] || 'ffprobe',
      defaultResolution: (process.env['RENDER_RESOLUTION'] === '720p' ? '720p' : '1080p'),
      defaultFps: parseInt(process.env['RENDER_FPS'] || '24', 10) || 24,
    },
    storage: {
      driver: (process.env['STORAGE_DRIVER'] === 's3' ? 's3' : 'local'),
      localPath: process.env['STORAGE_PATH'] || './storage/assets',
      s3: {
        endpoint: process.env['S3_ENDPOINT'],
        bucket: process.env['S3_BUCKET'] || 'cartoon-studio-assets',
        accessKey: process.env['S3_ACCESS_KEY'],
        secretKey: process.env['S3_SECRET_KEY'],
        region: process.env['S3_REGION'] || 'auto',
      },
    },
    googleOAuth: {
      clientId,
      clientSecret,
      redirectUri: process.env['GOOGLE_REDIRECT_URI'] || 'http://localhost:4000/api/auth/google/callback',
      isConfigured: Boolean(clientId && clientSecret),
    },
    auth: {
      jwtSecret: process.env['JWT_SECRET'] || '',
      sessionSecret: process.env['SESSION_SECRET'] || '',
      isConfigured:
        Boolean(process.env['JWT_SECRET'] && process.env['JWT_SECRET'].length >= 32) &&
        Boolean(process.env['SESSION_SECRET'] && process.env['SESSION_SECRET'].length >= 32),
    },
    scheduler: {
      jobPollIntervalMs: parseInt(process.env['JOB_POLL_INTERVAL_MS'] || '2000', 10) || 2000,
      calendarPollIntervalMs: parseInt(process.env['CALENDAR_POLL_INTERVAL_MS'] || '5000', 10) || 5000,
      maxConcurrentJobs: parseInt(process.env['WORKER_CONCURRENCY'] || '2', 10) || 2,
      autoStart: process.env['SCHEDULER_AUTO_START'] !== 'false' && env !== 'test',
    },
  };
}

// Singleton frozen instance for server runtime
export const config: ServerConfig = Object.freeze(loadConfig());
