import { ObjectLiteral } from 'typeorm';

/**
 * Relation configuration types — the TypeScript/TypeORM port of the PHP
 * `ManagesRelations` trait's `$oneToManyConfig` / `$manyToManyConfig` arrays.
 *
 * A controller declares the relations it manages and the generic relation
 * endpoints (list/show/create/update/delete + attach/detach/pivot for M2M)
 * resolve the matching config by name, exactly like the Laravel original.
 *
 * @author Charlietyn (TypeScript/TypeORM port)
 */

/** Entity constructor (the TypeORM model class). */
export type ModelClass<T extends ObjectLiteral = ObjectLiteral> = new (...args: any[]) => T;

/** Mutation behaviour shared by O2M and M2M relations. */
export interface RelationMutationConfig {
  /**
   * Body key(s) under which the related payload is sent, tried in order.
   * Mirrors Laravel's `dataKey` (e.g. `['Collections', 'collections']`).
   * When none match, the whole body (minus `_relation`/`_scenario`) is used.
   */
  dataKey?: string | string[];
  /** Whether deleting the relation also deletes the related row (default true). */
  deleteRelated?: boolean;
  /** Whitelist of pivot columns accepted on attach/sync/toggle (M2M only). */
  pivotColumns?: string[];
}

/** One-to-many (HasMany) relationship configuration. */
export interface OneToManyConfig<
  P extends ObjectLiteral = ObjectLiteral,
  R extends ObjectLiteral = ObjectLiteral,
> {
  /** Property/relation name (informational; resolution is key-driven). */
  relationship: string;
  relatedModel: ModelClass<R>;
  parentModel: ModelClass<P>;
  /** FK column on the related model pointing at the parent. */
  foreignKey: string;
  /** Parent key the FK references (defaults to the parent PK). */
  localKey?: string;
  mutation?: RelationMutationConfig;
}

/** Many-to-many (BelongsToMany) relationship configuration. */
export interface ManyToManyConfig<
  P extends ObjectLiteral = ObjectLiteral,
  R extends ObjectLiteral = ObjectLiteral,
  V extends ObjectLiteral = ObjectLiteral,
> {
  relationship: string;
  relatedModel: ModelClass<R>;
  parentModel: ModelClass<P>;
  /** Pivot entity holding the parentKey/relatedKey columns. */
  pivotModel: ModelClass<V>;
  /** Pivot column referencing the parent. */
  parentKey: string;
  /** Pivot column referencing the related model. */
  relatedKey: string;
  mutation?: RelationMutationConfig;
}

export type RelationType = 'o2m' | 'm2m';

/** A resolved config tagged with its kind so handlers can branch. */
export type ResolvedRelationConfig =
  | (OneToManyConfig & { _type: 'o2m' })
  | (ManyToManyConfig & { _type: 'm2m' });

/** Map shapes a controller declares. */
export type OneToManyConfigMap = Record<string, OneToManyConfig>;
export type ManyToManyConfigMap = Record<string, ManyToManyConfig>;

/** Type guard: true when the resolved config is many-to-many. */
export function isManyToMany(
  config: ResolvedRelationConfig,
): config is ManyToManyConfig & { _type: 'm2m' } {
  return config._type === 'm2m';
}
