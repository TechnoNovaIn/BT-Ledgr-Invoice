import { logger } from '../utils/logger.js';

export class AppError extends Error {
  constructor(message, statusCode = 500, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function errorHandler(err, req, res, next) {
  const status = err.statusCode || 500;

  logger.error(err.message, {
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  res.status(status).json({
    success: false,
    error: err.message || 'Internal server error',
    ...(err.details && { details: err.details }),
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
}
