import { NotFoundException } from '@nestjs/common';
import {
  DeepPartial,
  FindManyOptions,
  FindOptionsWhere,
  In,
  MoreThan,
  ObjectLiteral,
  Repository,
} from 'typeorm';
import { DEFAULT_CONFIG, RestGenericConfig } from '../config/rest-generic.config';
import {
  CursorPaginatedResult,
  DataResult,
  PaginatedResult,
  WriteResult,
} from '../interfaces/service-result.interface';
import { FilterParams, PaginationParams } from '../interfaces/filter-params.interface';
import { TypeormQueryTranslator } from '../query/typeorm.translator';
import { maybeJson } from '../query/condition.parser';
import { normalizeRelations } from '../query/relations.parser';
import { getStatic } from './base.entity';
import { CacheContext, RgcCacheService } from '../cache/cache.service';
import { HierarchyEngine } from '../hierarchy/hierarchy.engine';
import { ExportFile, ExportOptions, ExportService } from '../export/export.service';
import {
  getDeniedFieldsForUser,
  RoleAwareUser,
  stripDeniedFields,
} from '../security/field-access';

/**
 * Generic base service. Concrete services inject their repository and pass it
 * to `super(repo, ...)`. The public method surface mirrors the original Laravel
 * `BaseService` (snake_case names retained, camelCase aliases added).
 *
 * Read methods (`list_all`, `get_one`) are cache-aware; write methods run inside
 * a transaction and bump the model cache version on success.
 *
 * @author Charlietyn (TypeScript/TypeORM port)
 */
export abstract class BaseService<T extends ObjectLiteral> {
  protected readonly translator: TypeormQueryTranslator<T>;
  protected readonly primaryKey: string;
  protected readonly modelName: string;

  /** Service-level cache override: true forces on, false forces off, null defers to config. */
  protected cacheable: boolean | null = null;
  /** Service-level TTL override (seconds). */
  protected cacheTtl: number | null = null;
  /** Operations this service is allowed to cache (overrides config when non-empty). */
  protected cacheableOperations: string[] = [];

  constructor(
    protected readonly repo: Repository<T>,
    protected readonly config: RestGenericConfig = DEFAULT_CONFIG,
    protected readonly cache?: RgcCacheService,
  ) {
    this.translator = new TypeormQueryTranslator<T>(repo, config);
    this.primaryKey = repo.metadata.primaryColumns[0]?.propertyName ?? 'id';
    this.modelName =
      getStatic<string>(repo.metadata.target as Function, 'MODEL', '') ||
      (repo.metadata.target as Function).name;
  }

  // ==========================================================================
  // READ
  // ==========================================================================

  async list_all(params: FilterParams = {}, toJson = true, ctx?: CacheContext): Promise<unknown> {
    if (this.cache && this.shouldCache('list_all', params)) {
      return this.cache.remember(
        'list_all',
        this.modelName,
        params as Record<string, unknown>,
        ctx,
        this.cacheTtl,
        await this.relationVersions(params),
        () => this.listAllRaw(params, toJson),
      );
    }
    return this.listAllRaw(params, toJson);
  }

  /** camelCase alias. */
  listAll(params?: FilterParams, toJson?: boolean, ctx?: CacheContext): Promise<unknown> {
    return this.list_all(params, toJson, ctx);
  }

  private async listAllRaw(params: FilterParams, toJson: boolean): Promise<unknown> {
    if (params.hierarchy && this.hierarchyFieldId()) {
      return this.listHierarchy(params, toJson);
    }

    const options = this.translator.buildFindOptions(params);
    const pagination = maybeJson<PaginationParams>(params.pagination);

    if (pagination) {
      return this.paginate(options, pagination);
    }

    const rows = await this.repo.find(options);
    return toJson ? { data: rows } : rows;
  }

  async get_one(params: FilterParams = {}, toJson = true, ctx?: CacheContext): Promise<unknown> {
    if (this.cache && this.shouldCache('get_one', params)) {
      return this.cache.remember(
        'get_one',
        this.modelName,
        params as Record<string, unknown>,
        ctx,
        this.cacheTtl,
        await this.relationVersions(params),
        () => this.getOneRaw(params, toJson),
      );
    }
    return this.getOneRaw(params, toJson);
  }

  getOne(params?: FilterParams, toJson?: boolean, ctx?: CacheContext): Promise<unknown> {
    return this.get_one(params, toJson, ctx);
  }

  private async getOneRaw(params: FilterParams, toJson: boolean): Promise<unknown> {
    const options = this.translator.buildFindOptions(params);
    options.take = 1;
    delete (options as FindManyOptions<T>).skip;
    const row = await this.repo.findOne({ ...options, where: options.where ?? {} });
    return toJson ? { data: row ?? null } : (row ?? {});
  }

  /** Fetch a single record by id (with relations/select), throwing 404 if missing. */
  async show(params: FilterParams, id: unknown): Promise<T | Record<string, unknown>[]> {
    if (params.hierarchy && this.hierarchyFieldId()) {
      return this.showHierarchy(params, id);
    }
    const options = this.translator.buildFindOptions({ ...params, pagination: null, orderby: null });
    const where = { [this.primaryKey]: id } as FindOptionsWhere<T>;
    const merged = this.andWhere(options.where, where);
    const row = await this.repo.findOne({ ...options, where: merged });
    if (!row) throw new NotFoundException(`${this.modelName} with id ${String(id)} not found.`);
    return row;
  }

  // ==========================================================================
  // WRITE (transactional)
  // ==========================================================================

  async create(params: Record<string, unknown>): Promise<WriteResult<T>> {
    const modelKey = String(getStatic<string>(this.repo.metadata.target as Function, 'MODEL', '')).toLowerCase();
    const isBulk = (modelKey && params[modelKey] !== undefined) || Array.isArray(params);
    const result = await this.repo.manager.transaction(async (em) => {
      const repo = em.getRepository<T>(this.repo.metadata.target as new () => T);
      if (isBulk) {
        const list = (Array.isArray(params) ? params : (params[modelKey] as unknown[])) ?? [];
        return this.saveArray(repo, list as DeepPartial<T>[]);
      }
      return this.saveOne(repo, params as DeepPartial<T>);
    });
    if (result.success) await this.bumpCache();
    return result;
  }

  async update(attributes: Record<string, unknown>, id: unknown): Promise<WriteResult<T>> {
    const fieldKey =
      getStatic<string | null>(this.repo.metadata.target as Function, 'FIELD_KEY_UPDATE', null) ??
      this.primaryKey;
    const result = await this.repo.manager.transaction(async (em) => {
      const repo = em.getRepository<T>(this.repo.metadata.target as new () => T);
      const entity = await repo.findOne({ where: { [fieldKey]: id } as FindOptionsWhere<T> });
      if (!entity) throw new NotFoundException(`${this.modelName} with ${fieldKey} ${String(id)} not found.`);
      const merged = repo.merge(entity, attributes as DeepPartial<T>);
      const saved = await repo.save(merged as DeepPartial<T>);
      return { success: true, model: saved } as WriteResult<T>;
    });
    if (result.success) await this.bumpCache();
    return result;
  }

  async update_multiple(list: Record<string, unknown>[]): Promise<WriteResult<T>> {
    const result = await this.repo.manager.transaction(async (em) => {
      const repo = em.getRepository<T>(this.repo.metadata.target as new () => T);
      const out: WriteResult<T> = { success: true, models: [] };
      for (const item of list) {
        const id = item[this.primaryKey];
        const entity = await repo.findOne({ where: { [this.primaryKey]: id } as FindOptionsWhere<T> });
        if (!entity) {
          out.success = false;
          out.models!.push({ success: false, message: `Record ${String(id)} not found.` });
          continue;
        }
        const saved = await repo.save(repo.merge(entity, item as DeepPartial<T>) as DeepPartial<T>);
        out.models!.push({ success: true, model: saved });
      }
      return out;
    });
    if (result.success) await this.bumpCache();
    return result;
  }

  updateMultiple(list: Record<string, unknown>[]): Promise<WriteResult<T>> {
    return this.update_multiple(list);
  }

  async destroy(id: unknown): Promise<WriteResult<T>> {
    const result = await this.repo.manager.transaction(async (em) => {
      const repo = em.getRepository<T>(this.repo.metadata.target as new () => T);
      const entity = await repo.findOne({ where: { [this.primaryKey]: id } as FindOptionsWhere<T> });
      if (!entity) throw new NotFoundException(`${this.modelName} with id ${String(id)} not found.`);
      if (this.repo.metadata.deleteDateColumn) await repo.softRemove(entity as DeepPartial<T>);
      else await repo.remove(entity);
      return { success: true, model: entity } as WriteResult<T>;
    });
    if (result.success) await this.bumpCache();
    return result;
  }

  async destroybyid(ids: unknown): Promise<WriteResult<T>> {
    const list = Array.isArray(ids) ? ids : maybeJson<unknown[]>(ids);
    const idArray = Array.isArray(list) ? list : [list];
    const where = { [this.primaryKey]: In(idArray) } as FindOptionsWhere<T>;
    const res = this.repo.metadata.deleteDateColumn
      ? await this.repo.softDelete(where)
      : await this.repo.delete(where);
    const success = (res.affected ?? 0) > 0;
    if (success) await this.bumpCache();
    return { success };
  }

  destroyById(ids: unknown): Promise<WriteResult<T>> {
    return this.destroybyid(ids);
  }

  // ==========================================================================
  // EXPORT (data hooks — wire your file generator over these)
  // ==========================================================================

  async exportData(params: FilterParams): Promise<{ data: Record<string, unknown>[]; columns: string[] }> {
    const result = (await this.list_all(params)) as DataResult<unknown[]> | PaginatedResult;
    const raw = Array.isArray((result as DataResult).data)
      ? ((result as DataResult<unknown[]>).data as unknown[])
      : ((result as PaginatedResult).data ?? []);
    const data = raw.map((r) => (r && typeof r === 'object' ? { ...(r as object) } : { value: r })) as Record<string, unknown>[];
    const columns = this.resolveExportColumns(params);
    return { data, columns };
  }

  /** Generate an .xlsx file from the current query (requires `exceljs`). */
  async exportExcel(params: FilterParams, options: ExportOptions = {}): Promise<ExportFile> {
    const { data, columns } = await this.exportData(params);
    return ExportService.toExcel(data, columns, {
      filename: params.filename ?? 'export.xlsx',
      ...options,
    });
  }

  /** Generate a PDF file from the current query (requires `pdfkit`). */
  async exportPdf(params: FilterParams, options: ExportOptions = {}): Promise<ExportFile> {
    const { data, columns } = await this.exportData(params);
    return ExportService.toPdf(data, columns, {
      filename: params.filename ?? 'export.pdf',
      title: options.title ?? this.modelName,
      ...options,
    });
  }

  // ==========================================================================
  // Role-based field restriction (FIELDS_BY_ROLE)
  // ==========================================================================

  /** The entity class backing this service. */
  getModelClass(): Function {
    return this.repo.metadata.target as Function;
  }

  /** Fields the given user may not write, per the entity's FIELDS_BY_ROLE map. */
  getDeniedFields(user: RoleAwareUser | null | undefined): string[] {
    return getDeniedFieldsForUser(this.getModelClass(), user);
  }

  /** Strip restricted fields from a write payload for the given user. */
  stripForUser<P extends Record<string, unknown>>(payload: P | P[], user: RoleAwareUser | null | undefined): P | P[] {
    return stripDeniedFields(payload, this.getDeniedFields(user));
  }

  protected resolveExportColumns(params: FilterParams): string[] {
    if (params.columns) {
      return Array.isArray(params.columns)
        ? params.columns
        : String(params.columns).split(',').map((c) => c.trim());
    }
    const select = params.select ?? '*';
    if (select === '*' || (Array.isArray(select) && select[0] === '*')) {
      return this.repo.metadata.columns.map((c) => c.propertyName);
    }
    return Array.isArray(select) ? select : String(select).split(',').map((c) => c.trim());
  }

  // ==========================================================================
  // HIERARCHY
  // ==========================================================================

  async listHierarchy(params: FilterParams, toJson = true): Promise<unknown> {
    const fieldId = this.hierarchyFieldId();
    if (!fieldId) {
      throw new NotFoundException(
        `Model ${this.modelName} does not support hierarchical listing. Define static HIERARCHY_FIELD_ID.`,
      );
    }
    const config = HierarchyEngine.normalizeParams(params.hierarchy);
    if (!config) {
      const { hierarchy, ...rest } = params;
      return this.list_all(rest, toJson);
    }

    const options = this.translator.buildFindOptions({ ...params, pagination: null });
    const matched = await this.repo.find(options);
    const engine = new HierarchyEngine<T & Record<string, unknown>>(
      this.repo as Repository<T & Record<string, unknown>>,
      fieldId,
      this.primaryKey,
    );
    const tree = await engine.build(matched as (T & Record<string, unknown>)[], config);

    if (params.pagination) {
      return engine.paginateRoots(tree, maybeJson(params.pagination), config.children_key, this.defaultPageSize());
    }
    return toJson ? { data: tree } : tree;
  }

  async showHierarchy(params: FilterParams, id: unknown): Promise<Record<string, unknown>[]> {
    const fieldId = this.hierarchyFieldId();
    if (!fieldId) {
      throw new NotFoundException(`Model ${this.modelName} does not support hierarchy.`);
    }
    const config = HierarchyEngine.normalizeParams(params.hierarchy) ?? {
      enabled: true,
      children_key: 'children',
      max_depth: null,
      filter_mode: 'with_descendants',
      include_empty_children: true,
    };
    const root = await this.repo.findOne({ where: { [this.primaryKey]: id } as FindOptionsWhere<T> });
    if (!root) throw new NotFoundException(`${this.modelName} with id ${String(id)} not found.`);
    const engine = new HierarchyEngine<T & Record<string, unknown>>(
      this.repo as Repository<T & Record<string, unknown>>,
      fieldId,
      this.primaryKey,
    );
    return engine.build([root as T & Record<string, unknown>], config);
  }

  // ==========================================================================
  // Internals
  // ==========================================================================

  protected async saveOne(repo: Repository<T>, attributes: DeepPartial<T>): Promise<WriteResult<T>> {
    const entity = repo.create(attributes);
    const saved = await repo.save(entity as DeepPartial<T>);
    return { success: true, model: saved };
  }

  protected async saveArray(repo: Repository<T>, list: DeepPartial<T>[]): Promise<WriteResult<T>> {
    const out: WriteResult<T> = { success: true, models: [] };
    for (const item of list) {
      const saved = await this.saveOne(repo, item);
      out.models!.push(saved);
    }
    return out;
  }

  protected async paginate(
    options: FindManyOptions<T>,
    pg: PaginationParams,
  ): Promise<PaginatedResult | CursorPaginatedResult> {
    const pageSize = pg.pageSize ?? pg.pagesize ?? this.defaultPageSize();

    if (pg.infinity === true) {
      const cursor = pg.cursor ?? null;
      const where = cursor
        ? this.andWhere(options.where, { [this.primaryKey]: MoreThan(cursor) } as FindOptionsWhere<T>)
        : options.where;
      const rows = await this.repo.find({
        ...options,
        where,
        order: { [this.primaryKey]: 'ASC' } as never,
        take: pageSize + 1,
      });
      const hasMore = rows.length > pageSize;
      const data = hasMore ? rows.slice(0, pageSize) : rows;
      const last = data[data.length - 1] as Record<string, unknown> | undefined;
      return {
        data,
        next_cursor: hasMore && last ? String(last[this.primaryKey]) : null,
        has_more: hasMore,
      };
    }

    const page = pg.page ?? 1;
    const [rows, total] = await this.repo.findAndCount({
      ...options,
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    const lastPage = Math.ceil(total / pageSize) || 1;
    return {
      current_page: page,
      data: rows,
      per_page: pageSize,
      total,
      last_page: lastPage,
      from: total > 0 ? (page - 1) * pageSize + 1 : null,
      to: total > 0 ? Math.min(page * pageSize, total) : null,
    };
  }

  protected andWhere(
    existing: FindManyOptions<T>['where'],
    extra: FindOptionsWhere<T>,
  ): FindManyOptions<T>['where'] {
    if (!existing) return extra;
    if (Array.isArray(existing)) return existing.map((w) => ({ ...w, ...extra }));
    return { ...existing, ...extra };
  }

  protected shouldCache(operation: string, params: FilterParams): boolean {
    if (!this.cache) return false;
    return this.cache.shouldUseCache(operation, this.cacheable, this.cacheableOperations, params);
  }

  protected async bumpCache(): Promise<void> {
    if (!this.cache) return;
    const invalidates = getStatic<readonly Function[]>(
      this.repo.metadata.target as Function,
      'CACHE_INVALIDATES',
      [],
    ).map((c) => getStatic<string>(c, 'MODEL', '') || c.name);
    await this.cache.bumpVersion(this.modelName, invalidates);
  }

  protected async relationVersions(params: FilterParams): Promise<Record<string, number>> {
    if (!this.cache || !params.relations) return {};
    const allowed = getStatic<readonly string[]>(this.repo.metadata.target as Function, 'RELATIONS', []);
    const parsed = normalizeRelations(params.relations, [...allowed]);
    const names: string[] = [];
    for (const rel of parsed) {
      const meta = this.repo.metadata.relations.find((r) => r.propertyName === rel.base);
      if (meta) {
        const related = meta.inverseEntityMetadata.target as Function;
        names.push(getStatic<string>(related, 'MODEL', '') || related.name);
      }
    }
    return this.cache.getRelationVersions(names);
  }

  protected hierarchyFieldId(): string | null {
    return getStatic<string | null>(this.repo.metadata.target as Function, 'HIERARCHY_FIELD_ID', null);
  }

  protected defaultPageSize(): number {
    return 15;
  }
}
