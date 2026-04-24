import { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors';
import logger from '../config/logger';

/**
 * Global error handler middleware following RFC 7807 Problem Details.
 */
export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const requestId = (res.getHeader('x-request-id') || req.headers['x-request-id']) as string;
  const instance = req.path;

  if (err instanceof AppError) {
    return res.status(err.status).json({
      type: err.type,
      title: err.title,
      status: err.status,
      detail: err.detail,
      instance,
      requestId,
      ...err.extensions,
    });
  }

  // Unexpected errors
  logger.error('Unhandled server error:', {
    message: err.message,
    stack: err.stack,
    requestId,
    path: req.path,
    method: req.method,
  });

  // Don't leak internals in production
  res.status(500).json({
    type: 'https://syncro.app/errors/internal',
    title: 'Internal Server Error',
    status: 500,
    detail: process.env.NODE_ENV === 'production' 
      ? 'An unexpected error occurred.' 
      : err.message,
    instance,
    requestId,
  });
};
