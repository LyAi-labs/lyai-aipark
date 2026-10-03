import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';

declare global {
  // eslint-disable-next-line no-var
  var __prismaClientInstance: PrismaClient | undefined;
}

function createPrismaClient(): PrismaClient {
  const client = new PrismaClient({
    log: [
      { emit: 'event', level: 'query' },
      { emit: 'event', level: 'info' },
      { emit: 'event', level: 'warn' },
      { emit: 'event', level: 'error' },
    ],
  });

  // Attach structured logging
  // @ts-ignore prisma query log type
  client.$on('warn', (e: any) => {
    logger.warn('Prisma warning', { message: e.message });
  });

  // @ts-ignore prisma error log type
  client.$on('error', (e: any) => {
    logger.error('Prisma runtime error', { message: e.message, target: e.target });
  });

  return client;
}

// Singleton client to avoid multiple instances across SSR / development hot-reloads
export const db = global.__prismaClientInstance ?? createPrismaClient();

if (process.env['NODE_ENV'] !== 'production') {
  global.__prismaClientInstance = db;
}
