import {
  Body,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Req,
  StreamableFile,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ObjectLiteral } from 'typeorm';
import { BaseService } from './base.service';
import { FilterParams } from '../interfaces/filter-params.interface';
import { CacheContext } from '../cache/cache.service';
import { DatabaseErrorParser } from '../errors/database-error-parser';
import { RoleAwareUser } from '../security/field-access';
import { ManyToManyConfigMap, OneToManyConfigMap } from '../relations/relation-config';
import {
  extractMutationData,
  isBulkScenario,
  resolveRelationConfig,
  SCENARIO_PARAM,
} from '../relations/scenario';

/**
 * Generic REST controller. Subclasses only need:
 *
 *   @Controller('products')
 *   export class ProductController extends RestController<Product> {
 *     constructor(service: ProductService) { super(service); }
 *   }
 *
 * Route decorators declared here are inherited by the decorated subclass, so the
 * full CRUD surface is available without rewriting a single handler — the exact
 * ergonomics of the original Laravel `RestController`.
 *
 * @author Charlietyn (TypeScript/TypeORM port)
 */
export abstract class RestController<T extends ObjectLiteral> {
  protected constructor(protected readonly service: BaseService<T>) {}

  /**
   * One-to-many relations this controller manages, keyed by the `:relation`
   * route segment. Mirrors the PHP `$oneToManyConfig`.
   */
  protected oneToManyConfig?: OneToManyConfigMap;

  /**
   * Many-to-many relations this controller manages, keyed by the `:relation`
   * route segment. Mirrors the PHP `$manyToManyConfig`.
   */
  protected manyToManyConfig?: ManyToManyConfigMap;

  /** Extract the universal query contract from the request (query + body). */
  protected process_request(req: { query?: Record<string, unknown>; body?: Record<string, unknown> }): FilterParams {
    const payload: Record<string, unknown> = { ...(req.query ?? {}), ...(req.body ?? {}) };
    const has = (k: string): boolean => Object.prototype.hasOwnProperty.call(payload, k);

    const params: FilterParams = {
      relations: has('relations') ? (payload.relations as FilterParams['relations']) : null,
      _nested: has('_nested') ? this.toBool(payload._nested) ?? false : false,
      soft_delete: has('soft_delete') ? this.toBool(payload.soft_delete) : null,
      select: has('select') ? (payload.select as FilterParams['select']) : '*',
      pagination: has('pagination') ? (payload.pagination as FilterParams['pagination']) : null,
      orderby: has('orderby') ? (payload.orderby as FilterParams['orderby']) : null,
      oper: has('oper') ? (payload.oper as FilterParams['oper']) : null,
      hierarchy: has('hierarchy') ? (payload.hierarchy as FilterParams['hierarchy']) : null,
    };

    // Legacy equality filters: `attr` and/or `eq` merge into `attr`.
    if (has('attr') && has('eq')) {
      params.attr = { ...(payload.attr as object), ...(payload.eq as object) } as Record<string, unknown>;
    } else if (has('attr')) {
      params.attr = payload.attr as FilterParams['attr'];
    } else if (has('eq')) {
      params.attr = payload.eq as FilterParams['attr'];
    }

    if (has('cache')) params.cache = this.toBool(payload.cache) ?? undefined;
    if (has('cache_ttl')) params.cache_ttl = Number(payload.cache_ttl);
    if (has('columns')) params.columns = payload.columns as FilterParams['columns'];
    if (has('filename')) params.filename = String(payload.filename);
    return params;
  }

  protected buildContext(req: {
    headers?: Record<string, string | undefined>;
    user?: { id?: string | number };
    method?: string;
    path?: string;
    query?: Record<string, unknown>;
  }): CacheContext {
    return {
      headers: req.headers,
      userId: req.user?.id ?? null,
      method: req.method,
      routeId: req.path,
      query: req.query,
    };
  }

  // ----- Read --------------------------------------------------------------

  @Get()
  async index(@Req() req: any): Promise<unknown> {
    try {
      return await this.service.list_all(this.process_request(req), true, this.buildContext(req));
    } catch (e) {
      throw DatabaseErrorParser.handle(e);
    }
  }

  @Get('get/one')
  async getOne(@Req() req: any): Promise<unknown> {
    try {
      return await this.service.get_one(this.process_request(req), true, this.buildContext(req));
    } catch (e) {
      throw DatabaseErrorParser.handle(e);
    }
  }

  @Get(':id')
  async show(@Param('id') id: string, @Req() req: any): Promise<unknown> {
    try {
      return await this.service.show(this.process_request(req), id);
    } catch (e) {
      throw DatabaseErrorParser.handle(e);
    }
  }

  // ----- Write -------------------------------------------------------------

  @Post()
  async store(@Body() body: Record<string, unknown>, @Req() req: any): Promise<unknown> {
    try {
      return await this.service.create(this.applyFieldRestriction(body, req?.user));
    } catch (e) {
      throw DatabaseErrorParser.handle(e);
    }
  }

  @Put('update/multiple')
  async updateMultiple(@Body() body: Record<string, unknown>, @Req() req: any): Promise<unknown> {
    try {
      const entity = String((this.service as unknown as { modelName: string }).modelName).toLowerCase();
      let list = (body[entity] as Record<string, unknown>[]) ?? (body.data as Record<string, unknown>[]) ?? [];
      list = this.service.stripForUser(list, req?.user) as Record<string, unknown>[];
      return await this.service.update_multiple(list);
    } catch (e) {
      throw DatabaseErrorParser.handle(e);
    }
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() body: Record<string, unknown>, @Req() req: any): Promise<unknown> {
    try {
      return await this.service.update(this.service.stripForUser(body, req?.user) as Record<string, unknown>, id);
    } catch (e) {
      throw DatabaseErrorParser.handle(e);
    }
  }

  @Delete('delete/by-id')
  async deleteById(@Body() body: Record<string, unknown>): Promise<unknown> {
    try {
      const ids = (body.ids ?? body) as unknown;
      return await this.service.destroybyid(ids);
    } catch (e) {
      throw DatabaseErrorParser.handle(e);
    }
  }

  @Delete(':id')
  async destroy(@Param('id') id: string): Promise<unknown> {
    try {
      return await this.service.destroy(id);
    } catch (e) {
      throw DatabaseErrorParser.handle(e);
    }
  }

  // ----- Export ------------------------------------------------------------

  @Get('export/data')
  async exportData(@Req() req: any): Promise<unknown> {
    return this.service.exportData(this.process_request(req));
  }

  @Get('export/excel')
  async exportExcel(@Req() req: any): Promise<StreamableFile> {
    const file = await this.service.exportExcel(this.process_request(req));
    return new StreamableFile(file.buffer, {
      type: file.mimeType,
      disposition: `attachment; filename="${file.filename}"`,
    });
  }

  @Get('export/pdf')
  async exportPdf(@Req() req: any): Promise<StreamableFile> {
    const file = await this.service.exportPdf(this.process_request(req));
    return new StreamableFile(file.buffer, {
      type: file.mimeType,
      disposition: `attachment; filename="${file.filename}"`,
    });
  }

  // ----- Validate-only ------------------------------------------------------

  @Post('validate')
  @HttpCode(200)
  async actionValidate(@Body() body: Record<string, unknown>, @Req() req: any): Promise<unknown> {
    const scenario = String(req.query?.[SCENARIO_PARAM] ?? body?.[SCENARIO_PARAM] ?? 'none');
    const result = await this.service.actionValidate(scenario, body);
    if (!result.success) throw new UnprocessableEntityException(result.errors ?? { message: 'Validation failed.' });
    return result;
  }

  // ----- Relations (ManagesRelations port) ---------------------------------
  //
  // Route ordering matters: literal segments (validate/attach/detach/pivot/bulk)
  // are declared before their `:relatedId` param siblings so Express matches the
  // specific route first.

  // --- M2M pivot-only ---
  @Put(':parent_id/:relation/pivot/bulk')
  async updatePivotBulk(@Param('parent_id') parentId: string, @Param('relation') relation: string, @Body() body: Record<string, unknown>): Promise<unknown> {
    return this.runRelation(relation, (config) =>
      this.service.updatePivotRelation(config, parentId, null, this.relationData(config, body), true),
    );
  }

  @Put(':parent_id/:relation/pivot/:related_id')
  async updatePivot(@Param('parent_id') parentId: string, @Param('relation') relation: string, @Param('related_id') relatedId: string, @Body() body: Record<string, unknown>): Promise<unknown> {
    return this.runRelation(relation, (config) =>
      this.service.updatePivotRelation(config, parentId, relatedId, this.relationData(config, body), false),
    );
  }

  @Post(':parent_id/:relation/attach')
  @HttpCode(200)
  async attachRelation(@Param('parent_id') parentId: string, @Param('relation') relation: string, @Body() body: Record<string, unknown>, @Req() req: any): Promise<unknown> {
    const scenario = String(req.query?.[SCENARIO_PARAM] ?? body?.[SCENARIO_PARAM] ?? 'attach');
    return this.runRelation(relation, (config) =>
      this.service.attachRelation(config, parentId, this.relationData(config, body) as unknown[], scenario),
    );
  }

  @Delete(':parent_id/:relation/detach/bulk')
  async detachBulk(@Param('parent_id') parentId: string, @Param('relation') relation: string, @Body() body: Record<string, unknown>): Promise<unknown> {
    return this.runRelation(relation, (config) =>
      this.service.detachRelation(config, parentId, null, this.relationData(config, body) as unknown[], true),
    );
  }

  @Delete(':parent_id/:relation/detach/:related_id')
  async detach(@Param('parent_id') parentId: string, @Param('relation') relation: string, @Param('related_id') relatedId: string): Promise<unknown> {
    return this.runRelation(relation, (config) =>
      this.service.detachRelation(config, parentId, relatedId, [], false),
    );
  }

  // --- Bulk create/update/delete ---
  @Post(':parent_id/:relation/bulk')
  @HttpCode(201)
  async createRelationBulk(@Param('parent_id') parentId: string, @Param('relation') relation: string, @Body() body: Record<string, unknown>): Promise<unknown> {
    return this.runRelation(relation, (config) =>
      this.service.createRelation(config, parentId, this.relationData(config, body) as Record<string, unknown>[], true),
    );
  }

  @Put(':parent_id/:relation/bulk')
  async updateRelationBulk(@Param('parent_id') parentId: string, @Param('relation') relation: string, @Body() body: Record<string, unknown>): Promise<unknown> {
    return this.runRelation(relation, (config) =>
      this.service.updateRelation(config, parentId, null, this.relationData(config, body) as Record<string, unknown>[], true),
    );
  }

  @Delete(':parent_id/:relation/bulk')
  async deleteRelationBulk(@Param('parent_id') parentId: string, @Param('relation') relation: string, @Body() body: Record<string, unknown>): Promise<unknown> {
    return this.runRelation(relation, (config) =>
      this.service.deleteRelation(config, parentId, null, this.relationData(config, body) as unknown[], true),
    );
  }

  // --- Single create/show/update/delete + list ---
  @Get(':parent_id/:relation/:related_id')
  async showRelation(@Param('parent_id') parentId: string, @Param('relation') relation: string, @Param('related_id') relatedId: string, @Req() req: any): Promise<unknown> {
    return this.runRelation(relation, (config) =>
      this.service.showRelation(config, parentId, relatedId, this.process_request(req)),
    );
  }

  @Put(':parent_id/:relation/:related_id')
  async updateRelation(@Param('parent_id') parentId: string, @Param('relation') relation: string, @Param('related_id') relatedId: string, @Body() body: Record<string, unknown>): Promise<unknown> {
    return this.runRelation(relation, (config) =>
      this.service.updateRelation(config, parentId, relatedId, this.relationData(config, body) as Record<string, unknown>, false),
    );
  }

  @Delete(':parent_id/:relation/:related_id')
  async deleteRelation(@Param('parent_id') parentId: string, @Param('relation') relation: string, @Param('related_id') relatedId: string): Promise<unknown> {
    return this.runRelation(relation, (config) =>
      this.service.deleteRelation(config, parentId, relatedId, [], false),
    );
  }

  @Get(':parent_id/:relation')
  async listRelation(@Param('parent_id') parentId: string, @Param('relation') relation: string, @Req() req: any): Promise<unknown> {
    return this.runRelation(relation, (config) =>
      this.service.listRelation(config, parentId, this.process_request(req)),
    );
  }

  @Post(':parent_id/:relation')
  @HttpCode(201)
  async createRelation(@Param('parent_id') parentId: string, @Param('relation') relation: string, @Body() body: Record<string, unknown>, @Req() req: any): Promise<unknown> {
    const bulk = isBulkScenario(String(req.query?.[SCENARIO_PARAM] ?? body?.[SCENARIO_PARAM] ?? ''));
    return this.runRelation(relation, (config) =>
      this.service.createRelation(config, parentId, this.relationData(config, body) as Record<string, unknown>, bulk),
    );
  }

  /** Resolve the relation config and run an operation, mapping DB errors. */
  protected async runRelation<R>(
    relation: string,
    op: (config: ReturnType<typeof resolveRelationConfig>) => Promise<R>,
  ): Promise<R> {
    try {
      const config = resolveRelationConfig(relation, this.oneToManyConfig, this.manyToManyConfig, this.constructor.name);
      return await op(config);
    } catch (e) {
      throw DatabaseErrorParser.handle(e);
    }
  }

  /** Extract the related payload from the body using the config's dataKey. */
  protected relationData(
    config: ReturnType<typeof resolveRelationConfig>,
    body: Record<string, unknown>,
  ): Record<string, unknown> | Record<string, unknown>[] {
    return extractMutationData(body, config.mutation?.dataKey);
  }

  /** Strip role-restricted fields from a create payload (single or bulk shape). */
  protected applyFieldRestriction(
    body: Record<string, unknown>,
    user: RoleAwareUser | undefined,
  ): Record<string, unknown> {
    const denied = this.service.getDeniedFields(user);
    if (!denied.length) return body;
    const key = String((this.service as unknown as { modelName: string }).modelName).toLowerCase();
    if (Array.isArray(body[key])) {
      return { ...body, [key]: this.service.stripForUser(body[key] as Record<string, unknown>[], user) };
    }
    return this.service.stripForUser(body, user) as Record<string, unknown>;
  }

  private toBool(value: unknown): boolean | null {
    if (value === true || value === 'true' || value === '1' || value === 1) return true;
    if (value === false || value === 'false' || value === '0' || value === 0) return false;
    return null;
  }
}
