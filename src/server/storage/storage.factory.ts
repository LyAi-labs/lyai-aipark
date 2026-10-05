import { config, type StorageConfig, type AuthConfig } from '../config';
import type { StorageProvider } from './storage.interface';
import { LocalStorageProvider } from './local.storage';
import { S3CompatibleStorageProvider } from './s3.storage';
import { logger } from '../utils/logger';

/**
 * Factoría que instancia el StorageProvider apropiado según la configuración activa.
 */
export function createStorageProvider(
  storageConfig: StorageConfig = config.storage,
  authConfig: AuthConfig = config.auth
): StorageProvider {
  if (storageConfig.driver === 's3') {
    logger.info('Inicializando StorageProvider: S3CompatibleStorageProvider', {
      endpoint: storageConfig.s3.endpoint || 'https://s3.amazonaws.com',
      bucket: storageConfig.s3.bucket,
      region: storageConfig.s3.region,
    });

    return new S3CompatibleStorageProvider({
      endpoint: storageConfig.s3.endpoint || 'https://s3.amazonaws.com',
      bucket: storageConfig.s3.bucket || 'cartoon-studio-assets',
      accessKey: storageConfig.s3.accessKey || '',
      secretKey: storageConfig.s3.secretKey || '',
      region: storageConfig.s3.region || 'auto',
      forcePathStyle: Boolean(storageConfig.s3.endpoint && !storageConfig.s3.endpoint.includes('amazonaws.com')),
    });
  }

  logger.info('Inicializando StorageProvider: LocalStorageProvider', {
    localPath: storageConfig.localPath,
  });

  return new LocalStorageProvider({
    baseDir: storageConfig.localPath || './storage/assets',
    publicBaseUrl: '/api/assets',
    secret: authConfig.jwtSecret || 'cartoon-factory-local-storage-secret-key-32chars',
  });
}

/**
 * Instancia singleton activa del StorageProvider para todo el backend
 */
export const storageProvider: StorageProvider = createStorageProvider();

export function getStorageProvider(): StorageProvider {
  return storageProvider;
}
