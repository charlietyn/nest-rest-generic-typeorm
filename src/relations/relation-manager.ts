import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  DeepPartial,
  EntityManager,
  FindManyOptions,
  FindOptionsWhere,
  In,
  ObjectLiteral,
  Repository,
} from 'typeorm';
import { RestGenericConfig } from '../config/rest-generic.config';
import { FilterParams, PaginationParams } from '../interfaces/filter-params.interface';
import { WriteResult } from '../interfaces/service-result.interface';
import { TypeormQueryTranslator } from '../query/typeorm.translator';
import { maybeJson } from '../query/condition.parser';
import { getStatic } from '../base/base.entity';
import {
  ManyToManyConfig,
  OneToManyConfig,
  RelationMutationConfig,
  ResolvedRelationConfig,
  isManyToMany,
} from './relation-config';
import { resolveDataSource, resolveRepository } from './datasource-registry';

/**
 * Executes relation CRUD/pivot operations driven purely by the relation config
 * (foreign/local keys for O2M, pivot model + parent/related keys for M2M), so it
 * does not depend on TypeORM relation decorators being present. This is the
 * behavioural port of the Laravel `ManagesRelations` trait.
 *
 * Single vs. bulk mode follows the original semantics: any `_scenario`
 * containing "bulk" triggers bulk behaviour.
 *
 * @author Charlietyn (TypeScript/TypeORM port)
 */
export class RelationManager<P extends ObjectLiteral> {
  private readonly parentPk: string;

  constructor(
    private readonly parentRepo: Repository<P>,
    private readonly restConfig: RestGenericConfig,
  ) {
    this.parentPk = parentRepo.metadata.primaryColumns[0]?.propertyName ?? 'id';
  }

  // ── Read ────────────────────────────────────────────────────────────────

  async list(config: ResolvedRelationConfig, parentId: unknown, params: FilterParams): Promise<unknown> {
    const parent = await this.resolveParent(config, parentId);
    return isManyToMany(config)
      ? this.listM2M(config, parent, params)
      : this.listO2M(config, parent, params);
  }

  async show(
    config: ResolvedRelationConfig,
    parentId: unknown,
    relatedId: unknown,
    params: FilterParams,
  ): Promise<unknown> {
    const parent = await this.resolveParent(config, parentId);
    const relatedRepo = this.relatedRepo(config);
    const pk = this.pkOf(relatedRepo);
    const base = this.translator(relatedRepo).buildFindOptions({ ...params, pagination: null, orderby: null });

    if (isManyToMany(config)) {
      await this.assertLinked(config, parent, relatedId);
      const row = await relatedRepo.findOne({
        ...base,
        where: this.and(base.where, { [pk]: relatedId } as FindOptionsWhere<ObjectLiteral>),
      });
      if (!row) throw this.notFound(config, relatedId);
      return row;
    }

    const where = this.and(base.where, {
      [pk]: relatedId,
      [config.foreignKey]: this.localKeyValue(config, parent),
    } as FindOptionsWhere<ObjectLiteral>);
    const row = await relatedRepo.findOne({ ...base, where });
    if (!row) throw this.notFound(config, relatedId);
    return row;
  }

  private async listO2M(
    config: OneToManyConfig & { _type: 'o2m' },
    parent: P,
    params: FilterParams,
  ): Promise<unknown> {
    const relatedRepo = this.relatedRepo(config);
    const options = this.translator(relatedRepo).buildFindOptions(params);
    options.where = this.and(options.where, {
      [config.foreignKey]: this.localKeyValue(config, parent),
    } as FindOptionsWhere<ObjectLiteral>);
    return this.fetch(relatedRepo, options, params);
  }

  private async listM2M(
    config: ManyToManyConfig & { _type: 'm2m' },
    parent: P,
    params: FilterParams,
  ): Promise<unknown> {
    const ids = await this.linkedIds(config, parent);
    const relatedRepo = this.relatedRepo(config);
    const pk = this.pkOf(relatedRepo);
    if (!ids.length) return { data: [] };
    const options = this.translator(relatedRepo).buildFindOptions(params);
    options.where = this.and(options.where, { [pk]: In(ids) } as FindOptionsWhere<ObjectLiteral>);
    return this.fetch(relatedRepo, options, params);
  }

  // ── Create / Update / Delete (shared) ─────────────────────────────────────

  async create(
    config: ResolvedRelationConfig,
    parentId: unknown,
    data: Record<string, unknown> | Record<string, unknown>[],
    bulk: boolean,
  ): Promise<WriteResult> {
    const parent = await this.resolveParent(config, parentId);
    const relatedRepo = this.relatedRepo(config);

    return this.tx(config, async (em) => {
      const repo = em.getRepository<ObjectLiteral>(config.relatedModel);
      const list = bulk ? (data as Record<string, unknown>[]) : [data as Record<string, unknown>];
      const models: WriteResult[] = [];

      for (const item of list) {
        const payload = { ...item } as Record<string, unknown>;
        if (!isManyToMany(config)) {
          payload[config.foreignKey] = this.localKeyValue(config, parent);
        }
        const saved = await repo.save(repo.create(payload as DeepPartial<ObjectLiteral>));
        if (isManyToMany(config)) {
          await this.attachPivot(em, config, parent, [{ id: this.idOf(relatedRepo, saved) }]);
        }
        models.push({ success: true, model: saved });
      }
      return bulk ? { success: true, models } : models[0];
    });
  }

  async update(
    config: ResolvedRelationConfig,
    parentId: unknown,
    relatedId: unknown,
    data: Record<string, unknown> | Record<string, unknown>[],
    bulk: boolean,
  ): Promise<WriteResult> {
    const parent = await this.resolveParent(config, parentId);
    const relatedRepo = this.relatedRepo(config);
    const pk = this.pkOf(relatedRepo);

    return this.tx(config, async (em) => {
      const repo = em.getRepository<ObjectLiteral>(config.relatedModel);

      if (bulk) {
        const list = data as Record<string, unknown>[];
        const models: WriteResult[] = [];
        const notFound: unknown[] = [];
        for (const item of list) {
          const id = item[pk] ?? (item as Record<string, unknown>).id;
          const entity = await repo.findOne({ where: { [pk]: id } as FindOptionsWhere<ObjectLiteral> });
          if (!entity) {
            notFound.push(id);
            continue;
          }
          const saved = await repo.save(repo.merge(entity, item as DeepPartial<ObjectLiteral>));
          models.push({ success: true, model: saved });
        }
        const out: WriteResult = { success: notFound.length === 0, models };
        if (notFound.length) out.error = this.bulkNotFound(config, notFound);
        return out;
      }

      const where = isManyToMany(config)
        ? ({ [pk]: relatedId } as FindOptionsWhere<ObjectLiteral>)
        : ({ [pk]: relatedId, [config.foreignKey]: this.localKeyValue(config, parent) } as FindOptionsWhere<ObjectLiteral>);
      if (isManyToMany(config)) await this.assertLinked(config, parent, relatedId);
      const entity = await repo.findOne({ where });
      if (!entity) throw this.notFound(config, relatedId);
      const saved = await repo.save(repo.merge(entity, data as DeepPartial<ObjectLiteral>));
      return { success: true, model: saved };
    });
  }

  async delete(
    config: ResolvedRelationConfig,
    parentId: unknown,
    relatedId: unknown,
    data: Record<string, unknown> | unknown[],
    bulk: boolean,
  ): Promise<WriteResult> {
    const parent = await this.resolveParent(config, parentId);
    const relatedRepo = this.relatedRepo(config);
    const pk = this.pkOf(relatedRepo);
    const deleteRelated = config.mutation?.deleteRelated ?? true;
    const m2m = isManyToMany(config);

    return this.tx(config, async (em) => {
      const repo = em.getRepository<ObjectLiteral>(config.relatedModel);
      const ids = bulk ? this.idsFromBody(data) : [relatedId];

      if (!bulk && !m2m) {
        const entity = await repo.findOne({
          where: { [pk]: relatedId, [(config as OneToManyConfig).foreignKey]: this.localKeyValue(config as OneToManyConfig, parent) } as FindOptionsWhere<ObjectLiteral>,
        });
        if (!entity) throw this.notFound(config, relatedId);
        await this.removeRow(repo, entity);
        return { success: true, model: entity };
      }

      const found = await repo.find({ where: { [pk]: In(ids) } as FindOptionsWhere<ObjectLiteral> });
      const foundIds = found.map((r) => (r as Record<string, unknown>)[pk]);
      const notFound = ids.filter((id) => !foundIds.some((f) => String(f) === String(id)));

      if (m2m) await this.detachPivot(em, config as ManyToManyConfig & { _type: 'm2m' }, parent, foundIds);
      if (deleteRelated) for (const row of found) await this.removeRow(repo, row);

      const out: WriteResult = { success: notFound.length === 0, models: found.map((m) => ({ success: true, model: m })) };
      if (notFound.length) out.error = this.bulkNotFound(config, notFound);
      return out;
    });
  }

  // ── M2M-only: attach / detach / pivot ─────────────────────────────────────

  async attach(
    config: ResolvedRelationConfig,
    parentId: unknown,
    data: Record<string, unknown> | unknown[],
    scenario: string,
  ): Promise<unknown> {
    const m2m = this.assertM2M(config, 'attachRelation');
    const parent = await this.resolveParent(config, parentId);
    return this.tx(config, async (em) => {
      if (scenario.includes('sync')) return this.syncPivot(em, m2m, parent, data);
      if (scenario.includes('toggle')) return this.togglePivot(em, m2m, parent, data);
      // Single attach receives one object; bulk receives an array. Wrap the
      // single object so it is read as one entry (not an assoc pivot map).
      const entries = this.pivotEntries(m2m, Array.isArray(data) ? data : [data]);
      await this.attachPivot(em, m2m, parent, entries);
      return { attached: entries.map((e) => e.id) };
    });
  }

  async detach(
    config: ResolvedRelationConfig,
    parentId: unknown,
    relatedId: unknown,
    data: Record<string, unknown> | unknown[],
    bulk: boolean,
  ): Promise<unknown> {
    const m2m = this.assertM2M(config, 'detachRelation');
    const parent = await this.resolveParent(config, parentId);
    const ids = bulk ? this.idsFromBody(data) : [relatedId];
    return this.tx(config, async (em) => {
      await this.detachPivot(em, m2m, parent, ids);
      return { detached: ids };
    });
  }

  async updatePivot(
    config: ResolvedRelationConfig,
    parentId: unknown,
    relatedId: unknown,
    data: Record<string, unknown> | Record<string, unknown>[],
    bulk: boolean,
  ): Promise<unknown> {
    const m2m = this.assertM2M(config, 'updatePivotRelation');
    const parent = await this.resolveParent(config, parentId);
    const pivotRepo = (em: EntityManager) => em.getRepository<ObjectLiteral>(m2m.pivotModel);
    return this.tx(config, async (em) => {
      const repo = pivotRepo(em);
      const parentVal = this.idOf(this.parentRepo, parent);
      if (bulk) {
        const results: unknown[] = [];
        for (const item of data as Record<string, unknown>[]) {
          const id = item[m2m.relatedKey] ?? item.id;
          if (id == null) continue;
          const pivotData = { ...item };
          delete pivotData[m2m.relatedKey];
          delete pivotData.id;
          await repo.update(
            { [m2m.parentKey]: parentVal, [m2m.relatedKey]: id } as FindOptionsWhere<ObjectLiteral>,
            this.whitelistPivot(pivotData, m2m.mutation) as DeepPartial<ObjectLiteral>,
          );
          results.push(await repo.findOne({ where: { [m2m.parentKey]: parentVal, [m2m.relatedKey]: id } as FindOptionsWhere<ObjectLiteral> }));
        }
        return results;
      }
      await repo.update(
        { [m2m.parentKey]: parentVal, [m2m.relatedKey]: relatedId } as FindOptionsWhere<ObjectLiteral>,
        this.whitelistPivot(data as Record<string, unknown>, m2m.mutation) as DeepPartial<ObjectLiteral>,
      );
      return repo.findOne({ where: { [m2m.parentKey]: parentVal, [m2m.relatedKey]: relatedId } as FindOptionsWhere<ObjectLiteral> });
    });
  }

  // ── Pivot primitives ──────────────────────────────────────────────────────

  private async linkedIds(config: ManyToManyConfig & { _type: 'm2m' }, parent: P): Promise<unknown[]> {
    const pivot = this.pivotRepo(config);
    const rows = await pivot.find({ where: { [config.parentKey]: this.idOf(this.parentRepo, parent) } as FindOptionsWhere<ObjectLiteral> });
    return rows.map((r) => (r as Record<string, unknown>)[config.relatedKey]);
  }

  private async assertLinked(config: ManyToManyConfig & { _type: 'm2m' }, parent: P, relatedId: unknown): Promise<void> {
    const pivot = this.pivotRepo(config);
    const exists = await pivot.findOne({
      where: { [config.parentKey]: this.idOf(this.parentRepo, parent), [config.relatedKey]: relatedId } as FindOptionsWhere<ObjectLiteral>,
    });
    if (!exists) throw this.notFound(config, relatedId);
  }

  private async attachPivot(
    em: EntityManager,
    config: ManyToManyConfig & { _type: 'm2m' },
    parent: P,
    entries: { id: unknown; pivot?: Record<string, unknown> }[],
  ): Promise<void> {
    const repo = em.getRepository<ObjectLiteral>(config.pivotModel);
    const parentVal = this.idOf(this.parentRepo, parent);
    for (const e of entries) {
      const existing = await repo.findOne({
        where: { [config.parentKey]: parentVal, [config.relatedKey]: e.id } as FindOptionsWhere<ObjectLiteral>,
      });
      if (existing) continue;
      const row = {
        [config.parentKey]: parentVal,
        [config.relatedKey]: e.id,
        ...this.whitelistPivot(e.pivot ?? {}, config.mutation),
      };
      await repo.save(repo.create(row as DeepPartial<ObjectLiteral>));
    }
  }

  private async detachPivot(
    em: EntityManager,
    config: ManyToManyConfig & { _type: 'm2m' },
    parent: P,
    ids: unknown[],
  ): Promise<void> {
    if (!ids.length) return;
    const repo = em.getRepository<ObjectLiteral>(config.pivotModel);
    await repo.delete({
      [config.parentKey]: this.idOf(this.parentRepo, parent),
      [config.relatedKey]: In(ids),
    } as FindOptionsWhere<ObjectLiteral>);
  }

  private async syncPivot(em: EntityManager, config: ManyToManyConfig & { _type: 'm2m' }, parent: P, data: unknown): Promise<unknown> {
    const entries = this.pivotEntries(config, data);
    const target = entries.map((e) => e.id);
    const current = await this.linkedIds(config, parent);
    const detached = current.filter((id) => !target.some((t) => String(t) === String(id)));
    const attached = target.filter((id) => !current.some((c) => String(c) === String(id)));
    await this.detachPivot(em, config, parent, detached);
    await this.attachPivot(em, config, parent, entries.filter((e) => attached.some((a) => String(a) === String(e.id))));
    return { attached, detached, updated: [] };
  }

  private async togglePivot(em: EntityManager, config: ManyToManyConfig & { _type: 'm2m' }, parent: P, data: unknown): Promise<unknown> {
    const entries = this.pivotEntries(config, data);
    const current = await this.linkedIds(config, parent);
    const toDetach = entries.filter((e) => current.some((c) => String(c) === String(e.id)));
    const toAttach = entries.filter((e) => !current.some((c) => String(c) === String(e.id)));
    await this.detachPivot(em, config, parent, toDetach.map((e) => e.id));
    await this.attachPivot(em, config, parent, toAttach);
    return { attached: toAttach.map((e) => e.id), detached: toDetach.map((e) => e.id) };
  }

  /** Normalize heterogeneous pivot input (scalar list / object list / assoc map). */
  private pivotEntries(
    config: ManyToManyConfig & { _type: 'm2m' },
    data: unknown,
  ): { id: unknown; pivot?: Record<string, unknown> }[] {
    if (Array.isArray(data)) {
      return data.map((item) => {
        if (item && typeof item === 'object') {
          const obj = item as Record<string, unknown>;
          const id = obj[config.relatedKey] ?? obj.id;
          const pivot = { ...obj };
          delete pivot[config.relatedKey];
          delete pivot.id;
          return { id, pivot };
        }
        return { id: item };
      });
    }
    if (data && typeof data === 'object') {
      return Object.entries(data as Record<string, unknown>).map(([id, pivot]) => ({
        id,
        pivot: pivot && typeof pivot === 'object' ? (pivot as Record<string, unknown>) : {},
      }));
    }
    return [];
  }

  private whitelistPivot(pivot: Record<string, unknown>, mutation?: RelationMutationConfig): Record<string, unknown> {
    const allowed = mutation?.pivotColumns;
    if (!allowed?.length) return pivot;
    return Object.fromEntries(Object.entries(pivot).filter(([k]) => allowed.includes(k)));
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async fetch(repo: Repository<ObjectLiteral>, options: FindManyOptions<ObjectLiteral>, params: FilterParams): Promise<unknown> {
    const pagination = maybeJson<PaginationParams>(params.pagination);
    if (pagination) {
      const pageSize = pagination.pageSize ?? pagination.pagesize ?? 15;
      const page = pagination.page ?? 1;
      const [rows, total] = await repo.findAndCount({ ...options, skip: (page - 1) * pageSize, take: pageSize });
      return {
        current_page: page,
        data: rows,
        per_page: pageSize,
        total,
        last_page: Math.ceil(total / pageSize) || 1,
        from: total > 0 ? (page - 1) * pageSize + 1 : null,
        to: total > 0 ? Math.min(page * pageSize, total) : null,
      };
    }
    return { data: await repo.find(options) };
  }

  private async resolveParent(config: ResolvedRelationConfig, parentId: unknown): Promise<P> {
    if (parentId == null) {
      throw new BadRequestException('A parent id is required to resolve this relation.');
    }
    const parent = await this.parentRepo.findOne({ where: { [this.parentPk]: parentId } as FindOptionsWhere<P> });
    if (!parent) {
      throw new NotFoundException(`${config.parentModel.name} with id ${String(parentId)} not found.`);
    }
    return parent;
  }

  private async removeRow(repo: Repository<ObjectLiteral>, entity: ObjectLiteral): Promise<void> {
    if (repo.metadata.deleteDateColumn) await repo.softRemove(entity);
    else await repo.remove(entity);
  }

  /**
   * Runs a unit of work transactionally on the RELATED model's connection (where
   * the relation's writes land). Cross-connection writes cannot share the parent's
   * transaction; the pivot is assumed to live on the related model's connection.
   * With a single connection this is the parent's connection — unchanged behaviour.
   */
  private tx<R>(config: ResolvedRelationConfig, work: (em: EntityManager) => Promise<R>): Promise<R> {
    return resolveDataSource(config.relatedModel, this.parentRepo.manager.connection).transaction(work);
  }

  private relatedRepo(config: ResolvedRelationConfig): Repository<ObjectLiteral> {
    return resolveRepository<ObjectLiteral>(config.relatedModel, this.parentRepo.manager.connection);
  }

  /** The pivot repository, resolved from the connection that owns the pivot model. */
  private pivotRepo(config: ManyToManyConfig): Repository<ObjectLiteral> {
    return resolveRepository<ObjectLiteral>(config.pivotModel, this.parentRepo.manager.connection);
  }

  private translator(repo: Repository<ObjectLiteral>): TypeormQueryTranslator<ObjectLiteral> {
    return new TypeormQueryTranslator<ObjectLiteral>(repo, this.restConfig);
  }

  private pkOf(repo: Repository<any>): string {
    return repo.metadata.primaryColumns[0]?.propertyName ?? 'id';
  }

  private idOf(repo: Repository<any>, entity: ObjectLiteral): unknown {
    return (entity as Record<string, unknown>)[this.pkOf(repo)];
  }

  private localKeyValue(config: OneToManyConfig, parent: P): unknown {
    return (parent as Record<string, unknown>)[config.localKey ?? this.parentPk];
  }

  private idsFromBody(data: Record<string, unknown> | unknown[]): unknown[] {
    if (Array.isArray(data)) {
      return data.map((d) => (d && typeof d === 'object' ? (d as Record<string, unknown>).id ?? d : d));
    }
    if (data && typeof data === 'object') {
      const obj = data as Record<string, unknown>;
      if (Array.isArray(obj.ids)) return obj.ids as unknown[];
      return Object.values(obj);
    }
    return [];
  }

  private assertM2M(config: ResolvedRelationConfig, method: string): ManyToManyConfig & { _type: 'm2m' } {
    if (!isManyToMany(config)) {
      throw new BadRequestException(
        `${method}() can only be used with many-to-many relations. Configure the relation in manyToManyConfig.`,
      );
    }
    return config;
  }

  private notFound(config: ResolvedRelationConfig, id: unknown): NotFoundException {
    return new NotFoundException(`${config.relatedModel.name} with id ${String(id)} not found in this relation.`);
  }

  private bulkNotFound(config: ResolvedRelationConfig, ids: unknown[]): Record<string, unknown> {
    return {
      message: `${ids.length} ${config.relatedModel.name} record(s) not found: [${ids.join(', ')}]`,
      not_found_ids: ids,
    };
  }

  private and(
    existing: FindManyOptions<ObjectLiteral>['where'],
    extra: FindOptionsWhere<ObjectLiteral>,
  ): FindManyOptions<ObjectLiteral>['where'] {
    if (!existing) return extra;
    if (Array.isArray(existing)) return existing.map((w) => ({ ...w, ...extra }));
    return { ...existing, ...extra };
  }

  /** Read a static convention member off the parent entity class. */
  static parentRelationsWhitelist(cls: Function): readonly string[] {
    return getStatic<readonly string[]>(cls, 'RELATIONS', []);
  }
}
