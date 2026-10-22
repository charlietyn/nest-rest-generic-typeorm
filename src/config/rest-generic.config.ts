/**
 * Library configuration — the TypeScript equivalent of `config/rest-generic-class.php`.
 * Provide it through `GenericRestModule.forRoot(config)`; sane defaults match the
 * original package.
 *
 * @author Charlietyn (TypeScript/TypeORM port)
 */

export interface FilteringConfig {
  /** Maximum nesting depth for `oper` / `orderby` relation chains. */
  maxDepth: number;
  /** Maximum number of leaf conditions allowed in a single `oper` tree. */
  maxConditions: number;
  /** When true, a model MUST declare `RELATIONS` to be eager-loaded / filtered. */
  strictRelations: boolean;
  /** Whitelisted operators accepted in `oper` conditions. */
  allowedOperators: string[];
}

export interface CacheConfig {
  enabled: boolean;
  /** Default TTL in seconds. */
  ttl: number;
  /** Per-method TTL overrides. */
  ttlByMethod: Record<string, number>;
  /** Service methods that may be cached. */
  cacheableMethods: string[];
  /** Request headers folded into the cache key (multi-tenant / i18n). */
  varyHeaders: string[];
  /** Key namespace/prefix. */
  prefix: string;
}

export interface RestGenericConfig {
  filtering: FilteringConfig;
  cache: CacheConfig;
}

export const REST_GENERIC_CONFIG = 'REST_GENERIC_CONFIG';

export const DEFAULT_ALLOWED_OPERATORS = [
  '=', '!=', '<>', '<', '>', '<=', '>=',
  'like', 'not like', 'ilike', 'not ilike', 'ilikeu',
  'in', 'not in', 'notin',
  'between', 'not between', 'notbetween',
  'null', 'not null', 'notnull',
  'date', 'not date', 'notdate',
  'regexp', 'not regexp',
];

export const DEFAULT_CONFIG: RestGenericConfig = {
  filtering: {
    maxDepth: 5,
    maxConditions: 100,
    strictRelations: true,
    allowedOperators: DEFAULT_ALLOWED_OPERATORS,
  },
  cache: {
    enabled: false,
    ttl: 60,
    ttlByMethod: { list_all: 60, get_one: 30 },
    cacheableMethods: ['list_all', 'get_one'],
    varyHeaders: ['Accept-Language', 'X-Tenant-Id'],
    prefix: 'rgc:v1',
  },
};

/**
 * Merge a partial user config onto the defaults. Scalars and arrays are replaced;
 * `ttlByMethod` is merged key-by-key so overriding one method's TTL does not drop
 * the defaults for the others.
 */
export function mergeConfig(partial?: RestGenericConfigInput): RestGenericConfig {
  if (!partial) return clone(DEFAULT_CONFIG);
  const cache = { ...DEFAULT_CONFIG.cache, ...(partial.cache ?? {}) } as CacheConfig;
  cache.ttlByMethod = {
    ...DEFAULT_CONFIG.cache.ttlByMethod,
    ...(partial.cache?.ttlByMethod ?? {}),
  };
  return {
    filtering: { ...DEFAULT_CONFIG.filtering, ...(partial.filtering ?? {}) } as FilteringConfig,
    cache,
  };
}

export type RestGenericConfigInput = {
  filtering?: Partial<FilteringConfig>;
  cache?: Partial<CacheConfig>;
};
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}
