/**
 * Every response body this API emits is one of these two shapes. The Angular
 * client mirrors these types, so changing them is a breaking API change.
 */

export interface ApiSuccessResponse<T> {
  readonly success: true;
  readonly data: T;
  readonly meta?: ApiResponseMeta;
}

export interface ApiErrorResponse {
  readonly success: false;
  readonly error: {
    /** Stable machine-readable code — clients branch on this, not on message. */
    readonly code: string;
    /** Human-readable summary, safe to surface in a toast. */
    readonly message: string;
    /** Field-level validation failures, keyed by dotted field path. */
    readonly details?: Readonly<Record<string, readonly string[]>>;
  };
  readonly meta?: ApiResponseMeta;
}

export interface ApiResponseMeta {
  readonly requestId?: string;
  readonly timestamp: string;
  readonly pagination?: {
    readonly page: number;
    readonly pageSize: number;
    readonly total: number;
    readonly totalPages: number;
    readonly hasNext: boolean;
    readonly hasPrevious: boolean;
  };
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;
