/**
 * Mirrors the backend's response envelope (`backend/src/shared/types/api-response.ts`).
 *
 * These two definitions must stay in step; they are the wire contract. When the
 * API grows, consider generating this file from an OpenAPI document rather than
 * hand-maintaining it.
 */

export interface ApiResponseMeta {
  readonly requestId?: string;
  readonly timestamp: string;
  readonly pagination?: PaginationMeta;
}

export interface PaginationMeta {
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
  readonly hasNext: boolean;
  readonly hasPrevious: boolean;
}

export interface ApiSuccessResponse<T> {
  readonly success: true;
  readonly data: T;
  readonly meta?: ApiResponseMeta;
}

export interface ApiErrorBody {
  readonly code: string;
  readonly message: string;
  /** Field-level validation failures, keyed by dotted path (e.g. `body.email`). */
  readonly details?: Readonly<Record<string, readonly string[]>>;
}

export interface ApiErrorResponse {
  readonly success: false;
  readonly error: ApiErrorBody;
  readonly meta?: ApiResponseMeta;
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

/** A page of results, flattened from the envelope's `data` + `meta.pagination`. */
export interface Paginated<T> {
  readonly items: readonly T[];
  readonly pagination: PaginationMeta;
}
