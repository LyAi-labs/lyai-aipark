/**
 * Standardized Backend Error Hierarchy
 * Distinguishes between operational errors (expected) and programmer errors (bugs).
 */
import type { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode = 500, code = 'INTERNAL_ERROR', isOperational = true) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400, 'VALIDATION_ERROR');
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Permission denied') {
    super(message, 403, 'FORBIDDEN');
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404, 'NOT_FOUND');
  }
}

export class ExternalServiceError extends AppError {
  constructor(service: string, message: string) {
    super(`External service error [${service}]: ${message}`, 502, 'EXTERNAL_SERVICE_ERROR');
  }
}

/**
 * Global Express Error Handling Middleware
 */
export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    logger.warn(`Operational Error: ${err.message}`, { code: err.code, statusCode: err.statusCode });
    res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
      },
    });
    return;
  }

  // Unhandled programmer or unexpected error
  logger.error(`Unhandled Exception: ${err.message}`, { stack: err.stack });
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: process.env['NODE_ENV'] === 'production' ? 'An unexpected internal error occurred' : err.message,
    },
  });
}
