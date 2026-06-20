/**
 * Result envelopes returned by BaseService methods. They preserve the shapes
 * produced by the original Laravel service so clients do not have to change.
 */

/** Wrapper for single-record / collection reads: `{ data: ... }`. */
export interface DataResult<T = unknown> {
  data: T;
}

/** Standard offset pagination payload (Laravel LengthAwarePaginator shape). */
export interface PaginatedResult<T = unknown> {
  current_page: number;
  data: T[];
  per_page: number;
  total: number;
  last_page: number;
  from: number | null;
  to: number | null;
}

/** Keyset / infinite-scroll payload. */
export interface CursorPaginatedResult<T = unknown> {
  data: T[];
  next_cursor: string | null;
  has_more: boolean;
}

/** Validation error map: field -> messages. */
export type ValidationErrors = Record<string, string[]>;

/** Outcome of a write operation (create/update/destroy). */
export interface WriteResult<T = unknown> {
  success: boolean;
  model?: T | string;
  models?: WriteResult<T>[];
  errors?: ValidationErrors | unknown;
  error?: unknown;
  message?: string;
}
