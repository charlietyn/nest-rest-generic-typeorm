import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BaseService } from '../base/base.service';
import { Product } from './product.entity';
import { REST_GENERIC_CONFIG, RestGenericConfig, DEFAULT_CONFIG } from '../config/rest-generic.config';
import { RgcCacheService } from '../cache/cache.service';
import { Inject } from '@nestjs/common';

/**
 * Concrete service — just inject the repository and forward to `super`.
 * Override the protected `cacheable*` fields to tune caching per model.
 */
@Injectable()
export class ProductService extends BaseService<Product> {
  protected cacheableOperations = ['list_all', 'get_one'];

  constructor(
    @InjectRepository(Product) repo: Repository<Product>,
    @Optional() @Inject(REST_GENERIC_CONFIG) config?: RestGenericConfig,
    @Optional() cache?: RgcCacheService,
  ) {
    super(repo, config ?? DEFAULT_CONFIG, cache);
  }
}
