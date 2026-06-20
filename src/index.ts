/**
 * nest-rest-generic-typeorm — public API barrel.
 * TypeScript/TypeORM port of the Laravel package `rest-generic-class`.
 *
 * @author Charlietyn
 */

// Base classes
export { BaseEntity, EntityClass, getStatic, getDeclaredRelations } from './base/base.entity';
export { BaseService } from './base/base.service';
export { RestController } from './base/rest.controller';

// Module + config
export { GenericRestModule, GenericRestModuleOptions, RGC_CACHE_STORE } from './module/generic-rest.module';
export {
  RestGenericConfig,
  FilteringConfig,
  CacheConfig,
  REST_GENERIC_CONFIG,
  DEFAULT_CONFIG,
  DEFAULT_ALLOWED_OPERATORS,
  mergeConfig,
} from './config/rest-generic.config';

// Interfaces
export * from './interfaces/filter-params.interface';
export * from './interfaces/service-result.interface';

// Query engine (advanced / custom usage)
export { TypeormQueryTranslator } from './query/typeorm.translator';
export {
  parseConditionString,
  decodeValue,
  toBetweenArray,
  maybeJson,
  ParsedCondition,
} from './query/condition.parser';
export { parseRelationWithFields, normalizeRelations, ParsedRelation } from './query/relations.parser';

// Cache
export {
  RgcCacheService,
  RgcCacheStore,
  InMemoryCacheStore,
  CacheManagerStore,
  CacheManagerLike,
  CacheContext,
} from './cache/cache.service';

// Hierarchy
export { HierarchyEngine } from './hierarchy/hierarchy.engine';

// Export (Excel / PDF)
export { ExportService, ExportFile, ExportOptions } from './export/export.service';

// Security (role-based access + field restriction)
export {
  Roles,
  RolesGuard,
  ROLES_KEY,
} from './security/roles.guard';
export {
  getDeniedFieldsForUser,
  extractUserRoles,
  isSuperuser,
  stripDeniedFields,
  RoleAwareUser,
} from './security/field-access';

// Errors
export { DatabaseErrorParser, ParsedDbError } from './errors/database-error-parser';
