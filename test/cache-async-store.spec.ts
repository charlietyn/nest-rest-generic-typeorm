import 'reflect-metadata';
import { RgcCacheService, RgcCacheStore, CacheManagerStore } from '../src/cache/cache.service';
import { DEFAULT_CONFIG } from '../src/config/rest-generic.config';

/**
 * Simulates an out-of-process store (Redis): every operation is async.
 * This proves the versioned-invalidation path reads the real version through a
 * Promise — the bug that previously made `getVersion()` always return 1.
 */
class FakeRedisStore implements RgcCacheStore {
  private readonly data = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | undefined> {
    await Promise.resolve();
    return this.data.get(key) as T | undefined;
  }
  async set(key: string, value: unknown): Promise<void> {
    await Promise.resolve();
    this.data.set(key, value);
  }
  async del(key: string): Promise<void> {
    this.data.delete(key);
  }
}

describe('nest-rest-generic-typeorm · cache with async (Redis-like) store', () => {
  const cacheConfig = { ...DEFAULT_CONFIG.cache, enabled: true };

  it('reads the version through a Promise (not stuck at 1)', async () => {
    const store = new FakeRedisStore();
    const cache = new RgcCacheService(store, cacheConfig);
    expect(await cache.getVersion('Product')).toBe(1);
    await cache.bumpVersion('Product');
    expect(await cache.getVersion('Product')).toBe(2); // would be 1 with the sync bug
  });

  it('serves cached value, then invalidates after a write (bumpVersion)', async () => {
    const store = new FakeRedisStore();
    const cache = new RgcCacheService(store, cacheConfig);
    let hits = 0;
    const factory = async () => ({ data: ++hits });

    const first = await cache.remember('list_all', 'Product', { a: 1 }, undefined, null, {}, factory);
    const second = await cache.remember('list_all', 'Product', { a: 1 }, undefined, null, {}, factory);
    expect(first).toEqual({ data: 1 });
    expect(second).toEqual({ data: 1 }); // served from cache, factory not re-run

    await cache.bumpVersion('Product'); // a write happened → version changes → key changes
    const third = await cache.remember('list_all', 'Product', { a: 1 }, undefined, null, {}, factory);
    expect(third).toEqual({ data: 2 }); // recomputed because the version is part of the key
  });

  it('CacheManagerStore bridges the TTL unit (seconds → ms)', async () => {
    const calls: { key: string; ttl?: number }[] = [];
    const cacheManager = {
      async get<T>() {
        return undefined as T | undefined;
      },
      async set(key: string, _value: unknown, ttl?: number) {
        calls.push({ key, ttl });
      },
      async del() {
        /* noop */
      },
    };
    const store = new CacheManagerStore(cacheManager, 'ms');
    await store.set('k', 'v', 60); // 60 seconds
    await store.set('version', 'v', 0); // no expiry
    expect(calls[0].ttl).toBe(60_000); // converted to ms
    expect(calls[1].ttl).toBeUndefined(); // forever
  });
});
