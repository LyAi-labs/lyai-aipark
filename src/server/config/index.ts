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

export interface ServerConfig {
  app: AppConfig;
  database: DatabaseConfig;
  ai: AiConfig;
  storage: StorageConfig;
  googleOAuth: GoogleOAuthConfig;
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
  };
}

// Singleton frozen instance for server runtime
export const config: ServerConfig = Object.freeze(loadConfig());
