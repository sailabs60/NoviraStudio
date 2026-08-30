import type { NextFunction, Request, Response } from 'express';
import { ERROR_CODES, type ErrorCode } from '@novira/shared';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode | string;
  readonly details?: unknown;

  constructor(status: number, code: ErrorCode | string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(message: string, details?: unknown) {
    return new ApiError(400, ERROR_CODES.VALIDATION_FAILED, message, details);
  }
  static unauthorized(message = 'Sign in to continue.') {
    return new ApiError(401, ERROR_CODES.UNAUTHENTICATED, message);
  }
  static forbidden(message = 'You do not have access to this.', code: ErrorCode | string = ERROR_CODES.FORBIDDEN) {
    return new ApiError(403, code, message);
  }
  static notFound(message = 'Not found.') {
    return new ApiError(404, ERROR_CODES.NOT_FOUND, message);
  }
  static conflict(code: ErrorCode | string, message: string, details?: unknown) {
    return new ApiError(409, code, message, details);
  }
  static upgradeRequired(message = 'This feature is available on Plus and Pro plans.') {
    return new ApiError(402, ERROR_CODES.PLAN_UPGRADE_REQUIRED, message);
  }
  static insufficientCredits(required: number, available: number) {
    return new ApiError(
      402,
      ERROR_CODES.INSUFFICIENT_CREDITS,
      `This action needs ${required} credits; you have ${available}.`,
      { required, available }
    );
  }
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
    });
  }
  const message = err instanceof Error ? err.message : 'Unexpected error.';
  if (process.env.NODE_ENV !== 'test') console.error('[api]', err);
  return res.status(500).json({ error: { code: 'INTERNAL', message } });
}

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: { code: ERROR_CODES.NOT_FOUND, message: 'No such endpoint.' } });
}
