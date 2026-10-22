import { DataSource, EntityTarget, ObjectLiteral, Repository } from 'typeorm';

/**
 * Cross-connection repository resolution (polyglot persistence).
 *
 * In a multi-connection app the related/pivot entity of a relation may live on a
 * DIFFERENT data source than the parent. TypeORM's `parentRepo.manager` only knows
 * the parent's connection, so resolving the related repository through it throws
 * "No metadata for <Entity> was found". To support this, every {@link BaseService}
 * registers its data source here on construction; the relation manager then
 * resolves a related/pivot repository from whichever registered data source owns
 * that entity, falling back to the parent's when none is found.
 *
 * With a single connection only one data source is registered, so resolution is
 * identical to the previous `parentRepo.manager.getRepository(...)` behaviour.
 */
const dataSources = new Set<DataSource>();

/** Registers a data source so cross-connection relations can resolve through it. */
export function registerDataSource(ds: DataSource | undefined | null): void {
  if (ds) dataSources.add(ds);
}

/** The registered, initialized data source that owns `target`, or `undefined`. */
export function findDataSourceFor<T extends ObjectLiteral>(
  target: EntityTarget<T>,
): DataSource | undefined {
  for (const ds of dataSources) {
    try {
      if (ds.isInitialized && ds.hasMetadata(target)) return ds;
    } catch {
      /* a data source without this entity's metadata — skip */
    }
  }
  return undefined;
}

/** The data source that owns `target` (its own connection), else `fallback`. */
export function resolveDataSource<T extends ObjectLiteral>(
  target: EntityTarget<T>,
  fallback: DataSource,
): DataSource {
  return findDataSourceFor(target) ?? fallback;
}

/** The repository for `target` from the connection that owns it (else via `fallback`). */
export function resolveRepository<T extends ObjectLiteral>(
  target: EntityTarget<T>,
  fallback: DataSource,
): Repository<T> {
  return resolveDataSource(target, fallback).getRepository<T>(target);
}
