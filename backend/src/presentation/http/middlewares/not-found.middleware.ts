import type { RequestHandler } from 'express';
import { HttpStatus } from '../../../shared/http-status.js';
import { sendError } from '../serializers/response.serializer.js';

/**
 * Catch-all for unmatched routes, so a bad URL returns the standard error
 * envelope instead of Express's default HTML page. Registered after all routes
 * but before `errorHandler`.
 */
export function notFoundHandler(): RequestHandler {
  return (req, res) => {
    sendError(
      res,
      HttpStatus.NOT_FOUND,
      'ROUTE_NOT_FOUND',
      `Cannot ${req.method} ${req.originalUrl}`,
    );
  };
}
