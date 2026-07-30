import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Express 5 forwards rejected promises returned from handlers to the error
 * middleware, so this wrapper is not strictly required. It is kept because it
 * makes the async contract explicit at the call site and keeps handler
 * signatures uniform, which matters when handlers are registered dynamically.
 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    void handler(req, res, next).catch(next);
  };
}
