import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { GenericRestModule, REST_GENERIC_CONFIG, RgcCacheService, mergeConfig, injectParams, resolveRelationConfig } from '../src';

describe('Public module configuration', () => {
  it('injects scenarios on Express 5 getter-only queries and preserves existing values', () => {
    const prototype = Object.defineProperty({}, 'query', { get: () => ({ page: '2', _scenario: 'old' }) });
    const request = Object.create(prototype);
    let called = false;
    injectParams({ _scenario: 'bulk_update' })(request, {}, () => { called = true; });
    expect(request.query).toEqual({ page: '2', _scenario: 'bulk_update' });
    expect(called).toBe(true);
  });

  it('rejects an unconfigured managed relation', () => {
    expect(() => resolveRelationConfig('unknown', undefined, undefined)).toThrow(/not configured/);
  });

  it('resolves nested partial config and the cache service through Nest DI', async () => {
    const module = await Test.createTestingModule({
      imports: [GenericRestModule.forRoot({ config: { cache: { enabled: true, ttl: 10 } } })],
    }).compile();
    try {
      expect(module.get(REST_GENERIC_CONFIG).cache.ttl).toBe(10);
      expect(module.get(RgcCacheService)).toBeInstanceOf(RgcCacheService);
      expect(mergeConfig().cache.enabled).toBe(false);
    } finally { await module.close(); }
  });
});
