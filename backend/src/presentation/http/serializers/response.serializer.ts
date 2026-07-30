import type { Response } from 'express';
import type {
  ApiErrorResponse,
  ApiResponseMeta,
  ApiSuccessResponse,
} from '../../../shared/types/api-response.js';
import type { Page } from '../../../shared/pagination.js';
import { HttpStatus, type HttpStatusCode } from '../../../shared/http-status.js';

/**
 * The only place response bodies are constructed.
 *
 * Centralising the envelope means the Angular client can rely on one shape, and
 * adding a field (say, API deprecation warnings) is a one-file change.
 */

function baseMeta(res: Response): ApiResponseMeta {
  return {
    timestamp: new Date().toISOString(),
    ...(res.req.requestId !== undefined && { requestId: res.req.requestId }),
  };
}

export function sendSuccess<T>(
  res: Response,
  data: T,
  status: HttpStatusCode = HttpStatus.OK,
): void {
  const body: ApiSuccessResponse<T> = { success: true, data, meta: baseMeta(res) };
  res.status(status).json(body);
}

export function sendCreated<T>(res: Response, data: T): void {
  sendSuccess(res, data, HttpStatus.CREATED);
}

export function sendNoContent(res: Response): void {
  res.status(HttpStatus.NO_CONTENT).send();
}

/** Emits a page of items with its pagination metadata in `meta`. */
export function sendPage<T>(res: Response, page: Page<T>): void {
  const body: ApiSuccessResponse<readonly T[]> = {
    success: true,
    data: page.items,
    meta: {
      ...baseMeta(res),
      pagination: {
        page: page.page,
        pageSize: page.pageSize,
        total: page.total,
        totalPages: page.totalPages,
        hasNext: page.hasNext,
        hasPrevious: page.hasPrevious,
      },
    },
  };

  res.status(HttpStatus.OK).json(body);
}

export function sendError(
  res: Response,
  status: HttpStatusCode,
  code: string,
  message: string,
  details?: Readonly<Record<string, readonly string[]>>,
): void {
  const body: ApiErrorResponse = {
    success: false,
    error: { code, message, ...(details !== undefined && { details }) },
    meta: baseMeta(res),
  };

  res.status(status).json(body);
}
