import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import { REQUEST_ID_HEADER } from '../../../config/constants.js';

/**
 * Assigns every request a correlation id and echoes it back on the response.
 *
 * An inbound id is trusted so a trace can span the Angular app, the API and any
 * future service; otherwise one is generated. Must be registered first, since
 * the logger and error handler both read `req.requestId`.
 */
export function requestContext(): RequestHandler {
  return (req, res, next) => {
    const inbound = req.get(REQUEST_ID_HEADER);
    const requestId = inbound !== undefined && inbound.length <= 128 ? inbound : randomUUID();

    req.requestId = requestId;
    res.setHeader(REQUEST_ID_HEADER, requestId);

    next();
  };
}
