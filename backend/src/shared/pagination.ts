import { PAGINATION } from '../config/constants.js';

export interface PageRequest {
  readonly page: number;
  readonly pageSize: number;
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly totalPages: number;
  readonly hasNext: boolean;
  readonly hasPrevious: boolean;
}

/** Coerces one caller-supplied value into a positive integer, or the fallback. */
function toPositiveInt(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}

/** Clamps caller-supplied paging values into the range the API guarantees. */
export function toPageRequest(page?: number, pageSize?: number): PageRequest {
  return {
    page: toPositiveInt(page, PAGINATION.defaultPage),
    // Capped so a client cannot request the entire table in one response.
    pageSize: Math.min(toPositiveInt(pageSize, PAGINATION.defaultPageSize), PAGINATION.maxPageSize),
  };
}

/** Translates a page request into Prisma's `skip`/`take`. */
export function toSkipTake({ page, pageSize }: PageRequest): { skip: number; take: number } {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

export function createPage<T>(items: readonly T[], total: number, request: PageRequest): Page<T> {
  const totalPages = request.pageSize > 0 ? Math.ceil(total / request.pageSize) : 0;

  return {
    items,
    total,
    page: request.page,
    pageSize: request.pageSize,
    totalPages,
    hasNext: request.page < totalPages,
    hasPrevious: request.page > 1,
  };
}
