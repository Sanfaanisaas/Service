import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}
export const asyncHandler = (handler: RequestHandler): RequestHandler =>
  (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
export const notFound: RequestHandler = (_req, _res, next) =>
  next(new ApiError(404, 'NOT_FOUND', 'The requested resource was not found.'));
export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof ZodError) {
    res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Please correct the highlighted information.', details: error.flatten() } });
    return;
  }
  if (error instanceof ApiError) {
    res.status(error.status).json({ success: false, error: { code: error.code, message: error.message, details: error.details } });
    return;
  }
  if ((error as { code?: number }).code === 11000) {
    res.status(409).json({ success: false, error: { code: 'DUPLICATE_RECORD', message: 'A record with that unique value already exists.' } });
    return;
  }
  console.error(error);
  res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'SANFAANI could not complete this operation.' } });
};
