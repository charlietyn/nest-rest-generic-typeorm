import { BaseEntity, BaseService, RestController, GenericRestModule, mergeConfig, type RestGenericConfigInput, type FilterParams, type RgcCacheStore, type OneToManyConfig } from '@charlietyn/nest-rest-typeorm';
import type { Repository } from 'typeorm';

class Product extends BaseEntity { id!: number; name!: string; }
class Service extends BaseService<Product> { constructor(repo: Repository<Product>) { super(repo, mergeConfig()); } }
class Controller extends RestController<Product> { constructor(service: Service) { super(service); } }
const config: RestGenericConfigInput = { cache: { enabled: true }, filtering: { maxDepth: 3 } };
const query: FilterParams = { oper: { and: ['name|=|book'] }, pagination: { page: 1, pageSize: 10 } };
const store: RgcCacheStore = { get: () => undefined, set: () => undefined };
const relation: OneToManyConfig<Product, Product> = { relationship: 'children', relatedModel: Product, parentModel: Product, foreignKey: 'parent_id' };
GenericRestModule.forRoot({ config, cacheStore: store });
void [Controller, query, relation];
