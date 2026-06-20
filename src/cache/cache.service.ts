import { createHash } from 'crypto';
import { CacheConfig } from '../config/rest-generic.config';

/**
 * Cache store contract. **Async-first**: every method may return a Promise, so
 * out-of-process stores (Redis, Memcached) work exactly like the in-memory one —
 * this is what makes versioned invalidation behave correctly with Redis, the
 * same way the Laravel package relies on Laravel's `Cache::store()` abstraction.
 */
export interface RgcCacheStore {
  get<T = unknown>(key: string): Promise<T | undefined> | T | undefined;
  /** `ttlSeconds === 0` means "no expiry" (used for version keys). */
  set(key: string, value: unknown, ttlSeconds?: number): Promise<void> | void;
  del?(key: string): Promise<void> | void;
}

/** Minimal slice of a `cache-manager` Cache (as exposed by `@nestjs/cache-manager`). */
export interface CacheManagerLike {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown, ttl?: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

/**
 * Adapter that turns any `cache-manager` Cache (Redis, Memcached, file, …) into
 * an `RgcCacheStore`. It bridges the TTL unit: this library speaks **seconds**,
 * cache-manager v5+/Keyv speak **milliseconds**.
 *
 *   // app module
 *   const store = new CacheManagerStore(cacheManager); // cacheManager: Cache
 *   GenericRestModule.forRoot({ config: { cache: { enabled: true } }, cacheStore: store });
 */
export class CacheManagerStore implements RgcCacheStore {
  constructor(
    private readonly cache: CacheManagerLike,
    private readonly ttlUnit: 'ms' | 's' = 'ms',
  ) {}

  get<T>(key: string): Promise<T | undefined> {
    return this.cache.get<T>(key);
  }

  async set(key: string, value: unknown, ttlSeconds = 0): Promise<void> {
    if (!ttlSeconds) {
      // No expiry — important for version keys, which must outlive entries.
      await this.cache.set(key, value);
      return;
    }
    const ttl = this.ttlUnit === 'ms' ? ttlSeconds * 1000 : ttlSeconds;
    await this.cache.set(key, value, ttl);
  }

  async del(key: string): Promise<void> {
    await this.cache.del(key);
  }
}

/** Per-request context folded into the cache key (vary headers, user, query). */
export interface CacheContext {
  headers?: Record<string, string | undefined>;
  userId?: string | number | null;
  routeId?: string;
  method?: string;
  query?: Record<string, unknown>;
}

/** Simple Map-based store used when no external store is provided. */
export class InMemoryCacheStore implements RgcCacheStore {
  private readonly data = new Map<string, { value: unknown; expires: number }>();

  get<T>(key: string): T | undefined {
    const entry = this.data.get(key);
    if (!entry) return undefined;
    if (entry.expires !== 0 && entry.expires < Date.now()) {
      this.data.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set(key: string, value: unknown, ttlSeconds = 0): void {
    this.data.set(key, { value, expires: ttlSeconds ? Date.now() + ttlSeconds * 1000 : 0 });
  }

  del(key: string): void {
    this.data.delete(key);
  }
}

/**
 * Versioned cache façade — logical invalidation by bumping a per-model version
 * counter instead of deleting individual keys. Faithful to the original
 * `rememberWithCache` / `bumpCacheVersion` / `getRelationVersions` design.
 *
 * Every store access is awaited, so the version read on the key-building path
 * reflects the real value held in Redis (or any async store).
 *
 * @author Charlietyn (TypeScript/TypeORM port)
 */
export class RgcCacheService {
  constructor(
    private readonly store: RgcCacheStore,
    private readonly config: CacheConfig,
  ) {}

  shouldUseCache(
    operation: string,
    serviceCacheable: boolean | null,
    serviceMethods: string[],
    params: { cache?: boolean },
  ): boolean {
    if (serviceCacheable === false) return false;
    if (serviceCacheable === null && !this.config.enabled) return false;

    const methods = serviceMethods.length ? serviceMethods : this.config.cacheableMethods;
    if (!methods.includes(operation)) return false;
    if (params.cache === false) return false;
    return true;
  }

  async remember<T>(
    operation: string,
    modelName: string,
    params: Record<string, unknown>,
    ctx: CacheContext | undefined,
    serviceTtl: number | null,
    relationVersions: Record<string, number>,
    factory: () => Promise<T>,
  ): Promise<T> {
    const key = await this.buildKey(operation, modelName, params, ctx, relationVersions);
    const cached = await this.store.get<T>(key);
    if (cached !== undefined && cached !== null) return cached;

    const value = await factory();
    const ttl = this.resolveTtl(operation, params, serviceTtl);
    await this.store.set(key, value, ttl);
    return value;
  }

  async buildKey(
    operation: string,
    modelName: string,
    params: Record<string, unknown>,
    ctx: CacheContext | undefined,
    relationVersions: Record<string, number>,
  ): Promise<string> {
    const vary: Record<string, string | undefined> = {};
    for (const header of this.config.varyHeaders) {
      vary[header] = ctx?.headers?.[header.toLowerCase()] ?? ctx?.headers?.[header];
    }
    const fingerprint = {
      op: operation,
      model: modelName,
      route: ctx?.routeId ?? 'cli',
      method: ctx?.method,
      query: ctx?.query,
      headers: vary,
      user: ctx?.userId ?? null,
      params,
      version: await this.getVersion(modelName),
      rel_versions: relationVersions,
    };
    return `${this.config.prefix}:${createHash('sha1').update(JSON.stringify(fingerprint)).digest('hex')}`;
  }

  /** Read the model's cache version. Awaits the store, so Redis works correctly. */
  async getVersion(modelName: string): Promise<number> {
    const value = await this.store.get<number>(this.versionKey(modelName));
    return typeof value === 'number' ? value : 1;
  }

  async bumpVersion(modelName: string, invalidates: string[] = []): Promise<void> {
    if (!this.config.enabled) return;
    const current = (await this.store.get<number>(this.versionKey(modelName))) ?? 1;
    await this.store.set(this.versionKey(modelName), (Number(current) || 1) + 1, 0);
    for (const related of invalidates) {
      const v = (await this.store.get<number>(this.versionKey(related))) ?? 1;
      await this.store.set(this.versionKey(related), (Number(v) || 1) + 1, 0);
    }
  }

  async getRelationVersions(relationModelNames: string[]): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const name of relationModelNames) {
      out[name] = (await this.store.get<number>(this.versionKey(name))) ?? 1;
    }
    return out;
  }

  private resolveTtl(operation: string, params: Record<string, unknown>, serviceTtl: number | null): number {
    const reqTtl = params['cache_ttl'];
    if (typeof reqTtl === 'number' && !Number.isNaN(reqTtl)) return reqTtl;
    if (serviceTtl !== null) return serviceTtl;
    return this.config.ttlByMethod[operation] ?? this.config.ttl;
  }

  private versionKey(modelName: string): string {
    return `${this.config.prefix}:version:${modelName}`;
  }
}
