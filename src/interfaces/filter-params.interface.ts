/**
 * Public query contract — mirrors the parameters processed by the original
 * Laravel `RestController::process_request()` so the HTTP surface is identical.
 *
 * @author Charlietyn (TypeScript/TypeORM port)
 */

/** A single ordering entry, e.g. `{ "name": "asc" }` or `{ "user.role.name": "desc" }`. */
export type OrderByEntry = Record<string, 'asc' | 'desc' | 'ASC' | 'DESC'>;

/** Logical key accepted inside an `oper` node. */
export type LogicalOperator = 'and' | 'or';

/**
 * The recursive `oper` tree.
 *
 *  - A leaf condition is the string `"field|operator|value"`.
 *  - `{ and: [...] }` / `{ or: [...] }` group conditions logically.
 *  - Any other string key is treated as a **relation filter** (whereHas-style),
 *    e.g. `{ "roles": { and: ["name|=|admin"] } }`. Dot-notation is supported:
 *    `{ "user.roles": { and: [...] } }`.
 */
export interface OperNode {
  and?: OperCondition[];
  or?: OperCondition[];
  [relation: string]: OperCondition[] | OperNode | string | undefined;
}

export type OperCondition = string | OperNode;

/** Pagination block. `infinity: true` switches to keyset/cursor pagination. */
export interface PaginationParams {
  page?: number;
  pageSize?: number;
  pagesize?: number;
  infinity?: boolean;
  cursor?: string | null;
}

/** Hierarchy filter modes — identical semantics to the original library. */
export type HierarchyFilterMode =
  | 'match_only'
  | 'with_ancestors'
  | 'with_descendants'
  | 'full_branch'
  | 'root_filter';

export interface HierarchyConfig {
  enabled?: boolean;
  children_key?: string;
  max_depth?: number | null;
  filter_mode?: HierarchyFilterMode;
  include_empty_children?: boolean;
}

/**
 * Everything the controller extracts from the request and forwards to the
 * service. Every field accepts the raw string form (as it arrives over HTTP)
 * or the already-decoded structure, exactly like the PHP implementation.
 */
export interface FilterParams {
  /** Relations to eager-load: `["user", "roles:id,name", "user.role"]` or `"all"`. */
  relations?: string | string[] | null;
  /** When true, `oper` relation filters are also applied to the eager-loaded rows. */
  _nested?: boolean;
  /** Soft-delete handling: null = default, true = only trashed, false = with trashed. */
  soft_delete?: boolean | null;
  /** Legacy equality filters (`attr`/`eq`): `{ "status": "active", "id": [1,2,3] }`. */
  attr?: Record<string, unknown> | string | null;
  /** Column projection for the root entity. `"*"` or `["id", "name"]`. */
  select?: string | string[];
  /** Pagination block or its JSON string. */
  pagination?: PaginationParams | string | null;
  /** Ordering directives or their JSON string. */
  orderby?: OrderByEntry[] | string | null;
  /** Dynamic filter tree or its JSON string. */
  oper?: OperNode | OperCondition[] | string | null;
  /** Hierarchy config: `true`, an object, or its JSON string. */
  hierarchy?: boolean | HierarchyConfig | string | null;

  /** Per-request cache disable switch. */
  cache?: boolean;
  /** Per-request cache TTL override (seconds). */
  cache_ttl?: number;

  /** Export helpers (used by exportExcel/exportPdf). */
  columns?: string | string[];
  filename?: string;
  template?: string;

  [key: string]: unknown;
}
