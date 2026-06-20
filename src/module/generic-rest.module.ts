import { DynamicModule, Global, Module, Provider } from '@nestjs/common';
import {
  DEFAULT_CONFIG,
  mergeConfig,
  REST_GENERIC_CONFIG,
  RestGenericConfig,
} from '../config/rest-generic.config';
import {
  InMemoryCacheStore,
  RgcCacheService,
  RgcCacheStore,
} from '../cache/cache.service';

export const RGC_CACHE_STORE = 'RGC_CACHE_STORE';

export interface GenericRestModuleOptions {
  config?: Partial<RestGenericConfig>;
  /** Provide a cache-manager store (or any RgcCacheStore). Defaults to in-memory. */
  cacheStore?: RgcCacheStore;
}

/**
 * Global module that exposes the shared `RestGenericConfig` and `RgcCacheService`
 * so generic services can resolve them through DI.
 *
 *   GenericRestModule.forRoot({ config: { cache: { enabled: true } } })
 *
 * @author Charlietyn (TypeScript/TypeORM port)
 */
@Global()
@Module({})
export class GenericRestModule {
  static forRoot(options: GenericRestModuleOptions = {}): DynamicModule {
    const config = mergeConfig(options.config) ?? DEFAULT_CONFIG;

    const providers: Provider[] = [
      { provide: REST_GENERIC_CONFIG, useValue: config },
      { provide: RGC_CACHE_STORE, useValue: options.cacheStore ?? new InMemoryCacheStore() },
      {
        provide: RgcCacheService,
        useFactory: (store: RgcCacheStore) => new RgcCacheService(store, config.cache),
        inject: [RGC_CACHE_STORE],
      },
    ];

    return {
      module: GenericRestModule,
      providers,
      exports: [REST_GENERIC_CONFIG, RGC_CACHE_STORE, RgcCacheService],
    };
  }
}
