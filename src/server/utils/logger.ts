/**
 * Server-Side Structured Logger
 * Provides consistent logging levels, timestamps, and redaction of sensitive tokens.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_PRIORITIES: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const CURRENT_LEVEL: LogLevel = (process.env['LOG_LEVEL'] as LogLevel) || 'info';

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITIES[level] >= LEVEL_PRIORITIES[CURRENT_LEVEL];
}

function formatLog(level: LogLevel, message: string, context?: Record<string, unknown>): string {
  const timestamp = new Date().toISOString();
  const contextStr = context ? ` ${JSON.stringify(sanitizeContext(context))}` : '';
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${contextStr}`;
}

function sanitizeContext(ctx: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  const sensitiveKeys = ['key', 'secret', 'password', 'token', 'authorization', 'api_key'];

  for (const [k, v] of Object.entries(ctx)) {
    const isSensitive = sensitiveKeys.some(s => k.toLowerCase().includes(s));
    if (isSensitive) {
      clean[k] = '***REDACTED***';
    } else if (v instanceof Error) {
      clean[k] = { message: v.message, stack: v.stack };
    } else {
      clean[k] = v;
    }
  }
  return clean;
}

export const logger = {
  debug(message: string, context?: Record<string, unknown>): void {
    if (shouldLog('debug')) {
      console.debug(formatLog('debug', message, context));
    }
  },
  info(message: string, context?: Record<string, unknown>): void {
    if (shouldLog('info')) {
      console.info(formatLog('info', message, context));
    }
  },
  warn(message: string, context?: Record<string, unknown>): void {
    if (shouldLog('warn')) {
      console.warn(formatLog('warn', message, context));
    }
  },
  error(message: string, context?: Record<string, unknown>): void {
    if (shouldLog('error')) {
      console.error(formatLog('error', message, context));
    }
  },
};
