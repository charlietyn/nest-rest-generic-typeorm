import { BadRequestException } from '@nestjs/common';
import {
  And,
  Between,
  EntityMetadata,
  Equal,
  FindManyOptions,
  FindOperator,
  FindOptionsOrder,
  FindOptionsRelations,
  FindOptionsSelect,
  FindOptionsWhere,
  ILike,
  In,
  IsNull,
  LessThan,
  LessThanOrEqual,
  Like,
  MoreThan,
  MoreThanOrEqual,
  Not,
  ObjectLiteral,
  Raw,
  Repository,
} from 'typeorm';
import { RestGenericConfig } from '../config/rest-generic.config';
import { FilterParams, OperNode } from '../interfaces/filter-params.interface';
import {
  decodeValue,
  maybeJson,
  parseConditionString,
  toBetweenArray,
} from './condition.parser';
import { getDeclaredRelations } from '../base/base.entity';
import { normalizeRelations, ParsedRelation } from './relations.parser';

type WhereObject = FindOptionsWhere<any>;

/**
 * Translates the universal `FilterParams` into TypeORM `FindManyOptions`.
 *
 * Filtering fidelity: the recursive `oper` tree (arbitrary AND/OR nesting plus
 * relation sub-filters) is expanded to **disjunctive normal form** — an array of
 * conjunction objects — which is exactly how TypeORM represents `OR` (array) and
 * `AND` (object). Relation sub-filters become nested `where` objects, the precise
 * analogue of Eloquent's `whereHas`.
 *
 * Pagination correctness with eager to-many relations is guaranteed by forcing
 * `relationLoadStrategy: 'query'`, so `skip`/`take` apply to root rows only.
 *
 * @author Charlietyn (TypeScript/TypeORM port)
 */
export class TypeormQueryTranslator<T extends ObjectLiteral> {
  private readonly driver: string;

  constructor(
    private readonly repo: Repository<T>,
    private readonly config: RestGenericConfig,
  ) {
    this.driver = (repo.metadata.connection.options as { type?: string }).type ?? 'postgres';
  }

  // ---------------------------------------------------------------------------
  // Public entry point
  // ---------------------------------------------------------------------------

  buildFindOptions(params: FilterParams): FindManyOptions<T> {
    const where = this.buildWhere(params);
    const relations = this.buildRelations(params);
    const select = this.buildSelect(params, relations);
    const order = this.buildOrder(params.orderby);

    const options: FindManyOptions<T> = {
      relationLoadStrategy: 'query',
    };
    if (where) options.where = where;
    if (relations) options.relations = relations;
    if (select) options.select = select;
    if (order && Object.keys(order).length) options.order = order;
    if (params.soft_delete === false || params.soft_delete === true) {
      options.withDeleted = true;
    }
    return options;
  }

  // ---------------------------------------------------------------------------
  // WHERE
  // ---------------------------------------------------------------------------

  /** Build the final where: oper DNF combined (AND) with legacy `attr` equality. */
  buildWhere(params: FilterParams): WhereObject | WhereObject[] | undefined {
    let dnf: WhereObject[] = [{}];

    const oper = this.normalizeOper(params.oper);
    if (oper && Object.keys(oper).length) {
      this.assertConditionCount(oper);
      dnf = this.translateNode(oper, this.repo.metadata.target as Function, 0);
    }

    const attr = this.normalizeAttr(params.attr);
    if (attr) {
      dnf = this.mergeAnd(dnf, [attr]);
    }

    if (params.soft_delete === true) {
      // "only trashed" — emulate via deletedAt IS NOT NULL when the column exists.
      const del = this.repo.metadata.deleteDateColumn?.propertyName;
      if (del) dnf = this.mergeAnd(dnf, [{ [del]: Not(IsNull()) } as WhereObject]);
    }

    const cleaned = dnf.filter((o) => o && Object.keys(o).length);
    if (!cleaned.length) return undefined;
    return cleaned.length === 1 ? cleaned[0] : cleaned;
  }

  /**
   * Recursively translate an oper node into DNF (an OR-list of AND-objects).
   * Logical keys (`and`/`or`) and relation keys are processed together so that
   * `{ and: [...], roles: {...} }` yields `(base...) AND whereHas(roles)`.
   */
  private translateNode(node: OperNode, modelClass: Function, depth: number): WhereObject[] {
    if (depth > this.config.filtering.maxDepth) {
      throw new BadRequestException(
        `Maximum nesting depth (${this.config.filtering.maxDepth}) exceeded.`,
      );
    }

    const allowed = getDeclaredRelations(modelClass);
    // Start with the "AND identity": a single empty conjunction.
    let dnf: WhereObject[] = [{}];

    for (const [key, value] of Object.entries(node)) {
      if (value === undefined) continue;

      if (key === 'and') {
        dnf = this.mergeAnd(dnf, this.translateConditionList(value, modelClass, depth, 'and'));
      } else if (key === 'or') {
        dnf = this.mergeAnd(dnf, this.translateConditionList(value, modelClass, depth, 'or'));
      } else {
        // Relation sub-filter (whereHas). Supports dot notation (`user.roles`).
        const relationWhere = this.translateRelationFilter(key, value, modelClass, allowed, depth);
        dnf = this.mergeAnd(dnf, [relationWhere]);
      }
    }
    return dnf;
  }

  /** Translate an array of conditions joined by `and` or `or`. */
  private translateConditionList(
    list: unknown,
    modelClass: Function,
    depth: number,
    boolean: 'and' | 'or',
  ): WhereObject[] {
    const items = Array.isArray(list) ? list : [list];
    const parts: WhereObject[][] = items.map((item) => {
      if (typeof item === 'string') {
        return [this.translateLeaf(item)];
      }
      if (item && typeof item === 'object') {
        return this.translateNode(item as OperNode, modelClass, depth + 1);
      }
      throw new BadRequestException('Invalid oper condition entry.');
    });

    if (boolean === 'or') {
      // OR = concatenation of each operand's DNF.
      return parts.flat();
    }
    // AND = cartesian product (distribution) of operand DNFs.
    return parts.reduce((acc, cur) => this.mergeAnd(acc, cur), [{}] as WhereObject[]);
  }

  /** Translate one `"field|operator|value"` leaf into a single conjunction object. */
  private translateLeaf(condition: string): WhereObject {
    const { field, operator, value } = parseConditionString(condition);
    const op = operator.toLowerCase().trim();
    if (!this.config.filtering.allowedOperators.includes(op)) {
      throw new BadRequestException(`The ${operator} value is not a valid operator.`);
    }
    const column = field.includes('.') ? field.split('.').pop()! : field;
    const decoded = decodeValue(value);
    return { [column]: this.operatorToFindOperator(op, decoded) } as WhereObject;
  }

  /** Build a nested relation `where` (whereHas). Walks dot-notation paths. */
  private translateRelationFilter(
    relationPath: string,
    subOper: unknown,
    modelClass: Function,
    allowed: string[],
    depth: number,
  ): WhereObject {
    const segments = relationPath.split('.');
    const base = segments[0];
    if (this.config.filtering.strictRelations && !allowed.includes(base)) {
      throw new BadRequestException(
        `Relation '${relationPath}' is not allowed for filtering. Allowed relations: ${allowed.join(', ')}`,
      );
    }

    // Resolve against the metadata of the CURRENT model, not the root repository —
    // otherwise nested paths (`category.parent`, `user.roles`) look their second
    // segment up on the root entity and are wrongly rejected.
    const relationMeta = this.metadataFor(modelClass).relations.find(
      (r) => r.propertyName === base,
    );
    if (!relationMeta) {
      throw new BadRequestException(`Relation '${base}' does not exist on ${modelClass.name}.`);
    }
    const relatedClass = relationMeta.inverseEntityMetadata.target as Function;

    let inner: WhereObject | WhereObject[];
    if (segments.length > 1) {
      inner = this.translateRelationFilter(
        segments.slice(1).join('.'),
        subOper,
        relatedClass,
        getDeclaredRelations(relatedClass),
        depth + 1,
      );
    } else {
      const node = this.normalizeOper(subOper);
      const dnf = node ? this.translateNode(node, relatedClass, depth + 1) : [{}];
      inner = dnf.length === 1 ? dnf[0] : dnf;
    }
    return { [base]: inner } as WhereObject;
  }

  /** Map an operator + decoded value to a TypeORM FindOperator / literal. */
  private operatorToFindOperator(op: string, value: unknown): unknown {
    switch (op) {
      case '=':
        return value === null ? IsNull() : Equal(value as any);
      case '!=':
      case '<>':
        return value === null ? Not(IsNull()) : Not(Equal(value as any));
      case '<':
        return LessThan(value as any);
      case '>':
        return MoreThan(value as any);
      case '<=':
        return LessThanOrEqual(value as any);
      case '>=':
        return MoreThanOrEqual(value as any);
      case 'like':
        return Like(value as string);
      case 'not like':
        return Not(Like(value as string));
      case 'ilike':
      case 'ilikeu':
        return this.driver === 'postgres' ? ILike(value as string) : Like(value as string);
      case 'not ilike':
        return Not(this.driver === 'postgres' ? ILike(value as string) : Like(value as string));
      case 'in':
        return In(this.toArray(value));
      case 'not in':
      case 'notin':
        return Not(In(this.toArray(value)));
      case 'between': {
        const [a, b] = toBetweenArray(value);
        return Between(a as any, b as any);
      }
      case 'not between':
      case 'notbetween': {
        const [a, b] = toBetweenArray(value);
        return Not(Between(a as any, b as any));
      }
      case 'null':
        return IsNull();
      case 'not null':
      case 'notnull':
        return Not(IsNull());
      case 'date':
        return Raw((alias) => `DATE(${alias}) = :rgcDate`, { rgcDate: value });
      case 'not date':
      case 'notdate':
        return Raw((alias) => `DATE(${alias}) <> :rgcDate`, { rgcDate: value });
      case 'regexp':
        return Raw((alias) => `${alias} ${this.regexpKeyword()} :rgcRe`, { rgcRe: value });
      case 'not regexp':
        return Raw((alias) => `${alias} ${this.regexpKeyword(true)} :rgcRe`, { rgcRe: value });
      default:
        throw new BadRequestException(`The ${op} value is not a valid operator.`);
    }
  }

  private regexpKeyword(negated = false): string {
    if (this.driver === 'postgres') return negated ? '!~' : '~';
    return negated ? 'NOT REGEXP' : 'REGEXP';
  }

  // ---------------------------------------------------------------------------
  // RELATIONS + SELECT
  // ---------------------------------------------------------------------------

  buildRelations(params: FilterParams): FindOptionsRelations<T> | undefined {
    const allowed = getDeclaredRelations(this.repo.metadata.target as Function);
    const parsed = normalizeRelations(params.relations, allowed);

    // Relations referenced only in oper filters must also be present so the
    // generated join exists.
    const filterRelations = this.collectFilterRelationPaths(this.normalizeOper(params.oper));

    if (!parsed.length && !filterRelations.length) return undefined;

    const tree: FindOptionsRelations<T> = {};
    for (const rel of parsed) {
      this.validateRelationBase(rel, allowed);
      this.assignRelationPath(tree as Record<string, unknown>, rel.segments);
    }
    for (const path of filterRelations) {
      this.assignRelationPath(tree as Record<string, unknown>, path.split('.'));
    }
    return Object.keys(tree).length ? tree : undefined;
  }

  buildSelect(
    params: FilterParams,
    relations: FindOptionsRelations<T> | undefined,
  ): FindOptionsSelect<T> | undefined {
    const select: FindOptionsSelect<T> = {};

    // Root projection.
    const raw = params.select;
    const list = this.normalizeColumnList(raw);
    if (list && !(list.length === 1 && list[0] === '*')) {
      for (const col of list) (select as Record<string, unknown>)[col] = true;
    }

    // Per-relation field selection from the `rel:f1,f2` syntax.
    const allowed = getDeclaredRelations(this.repo.metadata.target as Function);
    for (const rel of normalizeRelations(params.relations, allowed)) {
      if (rel.fields && rel.fields.length) {
        this.assignSelectPath(select as Record<string, unknown>, rel.segments, rel.fields);
      }
    }

    if (!Object.keys(select).length) return undefined;
    // When projecting relation fields, TypeORM needs the root id; include it.
    const pk = this.repo.metadata.primaryColumns[0]?.propertyName;
    if (relations && pk && (select as Record<string, unknown>)[pk] === undefined) {
      // only force when a root projection already narrows columns
      if (Object.keys(select).some((k) => (select as Record<string, unknown>)[k] === true)) {
        (select as Record<string, unknown>)[pk] = true;
      }
    }
    return select;
  }

  // ---------------------------------------------------------------------------
  // ORDER
  // ---------------------------------------------------------------------------

  buildOrder(orderby: FilterParams['orderby']): FindOptionsOrder<T> {
    const order: FindOptionsOrder<T> = {};
    let entries = maybeJson<unknown>(orderby);
    if (!Array.isArray(entries)) {
      entries = entries ? [entries] : [];
    }
    for (const entry of entries as unknown[]) {
      const obj = typeof entry === 'string' ? maybeJson(entry) : entry;
      if (!obj || typeof obj !== 'object') continue;
      for (const [column, dirRaw] of Object.entries(obj as Record<string, unknown>)) {
        const dir = String(dirRaw).toLowerCase() === 'desc' ? 'DESC' : 'ASC';
        const segments = column.split('.');
        // Ordering crosses the same relation whitelist as filtering and loading.
        if (segments.length > 1) this.validateOrderPath(segments);
        this.assignOrderPath(order as Record<string, unknown>, segments, dir);
      }
    }
    return order;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Cartesian distribution: (A ∨ B) ∧ (C ∨ D) = AC ∨ AD ∨ BC ∨ BD. */
  private mergeAnd(left: WhereObject[], right: WhereObject[]): WhereObject[] {
    const out: WhereObject[] = [];
    for (const l of left) {
      for (const r of right) {
        out.push(...this.conjoin(l, r));
      }
    }
    return out.length ? out : [{}];
  }

  /**
   * AND two conjunction objects. A plain object spread would let the right-hand
   * side overwrite a condition the left-hand side already placed on the same key,
   * silently dropping it (`price >= 100 AND price <= 800` collapsing to
   * `price <= 800`). Shared keys are therefore combined, and because combining
   * may yield alternatives (an OR-list on one side distributes), the result is a
   * DNF list rather than a single object.
   */
  private conjoin(left: WhereObject, right: WhereObject): WhereObject[] {
    let variants: Record<string, unknown>[] = [{ ...(left as Record<string, unknown>) }];

    for (const [key, value] of Object.entries(right as Record<string, unknown>)) {
      if (value === undefined) continue;
      const next: Record<string, unknown>[] = [];
      for (const base of variants) {
        if (base[key] === undefined) {
          next.push({ ...base, [key]: value });
          continue;
        }
        for (const combined of this.combineValues(base[key], value)) {
          next.push({ ...base, [key]: combined });
        }
      }
      variants = next;
    }
    return variants as WhereObject[];
  }

  /**
   * Combine two conditions that landed on the same key. Returns one entry per
   * alternative: OR-lists distribute, nested relation `where`s merge recursively,
   * and two column conditions become a real conjunction via TypeORM's `And`.
   */
  private combineValues(a: unknown, b: unknown): unknown[] {
    if (Array.isArray(a) || Array.isArray(b)) {
      const left = Array.isArray(a) ? a : [a];
      const right = Array.isArray(b) ? b : [b];
      const out: unknown[] = [];
      for (const l of left) {
        for (const r of right) out.push(...this.combineValues(l, r));
      }
      return out;
    }
    if (this.isWhereObject(a) && this.isWhereObject(b)) {
      return this.conjoin(a as WhereObject, b as WhereObject);
    }
    return [this.andConditions(a, b)];
  }

  /** Two conditions on one column → `And(...)`. Literals are lifted to `Equal`. */
  private andConditions(a: unknown, b: unknown): unknown {
    if (typeof And !== 'function') {
      throw new BadRequestException(
        'Combining two conditions on the same field requires the TypeORM `And` operator ' +
          '(TypeORM >= 0.3.11). Upgrade TypeORM or split the conditions across separate requests.',
      );
    }
    const left = a instanceof FindOperator ? a : Equal(a as any);
    const right = b instanceof FindOperator ? b : Equal(b as any);
    return And(left as FindOperator<any>, right as FindOperator<any>);
  }

  /** True for a nested relation `where` object (not a FindOperator or a Date). */
  private isWhereObject(value: unknown): boolean {
    return (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      !(value instanceof FindOperator) &&
      !(value instanceof Date)
    );
  }

  /** Entity metadata for an arbitrary model reachable from this connection. */
  private metadataFor(modelClass: Function): EntityMetadata {
    if (modelClass === this.repo.metadata.target) return this.repo.metadata;
    try {
      return this.repo.manager.connection.getMetadata(modelClass);
    } catch {
      throw new BadRequestException(
        `Entity '${modelClass.name}' is not registered on this connection.`,
      );
    }
  }

  private normalizeOper(oper: unknown): OperNode | null {
    if (oper === null || oper === undefined || oper === '') return null;
    let node: unknown = typeof oper === 'string' ? maybeJson(oper) : oper;
    if (Array.isArray(node)) {
      node = { and: node };
    }
    if (!node || typeof node !== 'object') return null;
    return node as OperNode;
  }

  private normalizeAttr(attr: FilterParams['attr']): WhereObject | null {
    if (!attr) return null;
    const obj = typeof attr === 'string' ? maybeJson<Record<string, unknown>>(attr) : attr;
    if (!obj || typeof obj !== 'object') return null;
    const where: WhereObject = {};
    for (const [k, v] of Object.entries(obj)) {
      (where as Record<string, unknown>)[k] = Array.isArray(v) ? In(v) : Equal(v as any);
    }
    return Object.keys(where).length ? where : null;
  }

  private assertConditionCount(node: OperNode): void {
    let count = 0;
    const walk = (n: unknown): void => {
      if (typeof n === 'string') {
        count++;
        return;
      }
      if (Array.isArray(n)) {
        n.forEach(walk);
        return;
      }
      if (n && typeof n === 'object') {
        Object.values(n).forEach(walk);
      }
    };
    walk(node);
    if (count > this.config.filtering.maxConditions) {
      throw new BadRequestException(
        `Maximum conditions (${this.config.filtering.maxConditions}) exceeded.`,
      );
    }
  }

  private collectFilterRelationPaths(oper: OperNode | null): string[] {
    if (!oper) return [];
    const paths: string[] = [];
    const walk = (node: OperNode): void => {
      for (const [key, value] of Object.entries(node)) {
        if (key === 'and' || key === 'or') {
          const items = Array.isArray(value) ? value : [value];
          // Walk every object entry: `walk` itself tells logical keys apart from
          // relation keys, so skipping logical wrappers here would hide any
          // relation filter nested inside an and/or block.
          items.forEach((it) => {
            if (it && typeof it === 'object') walk(it as OperNode);
          });
        } else if (value && typeof value === 'object') {
          // Only the base segment. TypeORM resolves the deeper chain of a nested
          // `where` on its own; adding the full path here would additionally
          // eager-load relations nobody requested and, on a self-referencing
          // relation under `relationLoadStrategy: 'query'`, produce an ambiguous
          // column alias.
          paths.push(key.split('.')[0]);
        }
      }
    };
    walk(oper);
    return paths;
  }

  /**
   * Gate every relation segment of a dotted `orderby` path against the model's
   * `RELATIONS` whitelist, walking the chain so nested paths are checked on the
   * entity that actually owns them. The trailing segment is the column.
   */
  private validateOrderPath(segments: string[]): void {
    let modelClass = this.repo.metadata.target as Function;
    for (const segment of segments.slice(0, -1)) {
      const allowed = getDeclaredRelations(modelClass);
      if (this.config.filtering.strictRelations && !allowed.includes(segment)) {
        throw new BadRequestException(
          `Relation '${segment}' is not allowed for ordering. Allowed relations: ${allowed.join(', ')}`,
        );
      }
      const relationMeta = this.metadataFor(modelClass).relations.find(
        (r) => r.propertyName === segment,
      );
      if (!relationMeta) {
        throw new BadRequestException(
          `Relation '${segment}' does not exist on ${modelClass.name}.`,
        );
      }
      modelClass = relationMeta.inverseEntityMetadata.target as Function;
    }
  }

  private validateRelationBase(rel: ParsedRelation, allowed: string[]): void {
    if (this.config.filtering.strictRelations && !allowed.includes(rel.base)) {
      throw new BadRequestException(
        `Relation '${rel.base}' is not allowed. Allowed: ${allowed.join(', ')}`,
      );
    }
    if (!this.repo.metadata.relations.some((r) => r.propertyName === rel.base)) {
      throw new BadRequestException(
        `Relation '${rel.base}' does not exist on ${(this.repo.metadata.target as Function).name}.`,
      );
    }
  }

  private assignRelationPath(tree: Record<string, unknown>, segments: string[]): void {
    let cursor = tree;
    for (const seg of segments) {
      if (cursor[seg] === undefined || cursor[seg] === true) cursor[seg] = {};
      cursor = cursor[seg] as Record<string, unknown>;
    }
  }

  private assignSelectPath(
    tree: Record<string, unknown>,
    segments: string[],
    fields: string[],
  ): void {
    let cursor = tree;
    segments.forEach((seg, i) => {
      if (i === segments.length - 1) {
        const leaf: Record<string, boolean> = {};
        for (const f of fields) leaf[f] = true;
        cursor[seg] = leaf;
      } else {
        if (typeof cursor[seg] !== 'object' || cursor[seg] === null) cursor[seg] = {};
        cursor = cursor[seg] as Record<string, unknown>;
      }
    });
  }

  private assignOrderPath(tree: Record<string, unknown>, segments: string[], dir: string): void {
    let cursor = tree;
    segments.forEach((seg, i) => {
      if (i === segments.length - 1) {
        cursor[seg] = dir;
      } else {
        if (typeof cursor[seg] !== 'object' || cursor[seg] === null) cursor[seg] = {};
        cursor = cursor[seg] as Record<string, unknown>;
      }
    });
  }

  private normalizeColumnList(raw: unknown): string[] | null {
    if (raw === undefined || raw === null || raw === '*') return null;
    if (typeof raw === 'string') {
      const decoded = maybeJson(raw);
      if (Array.isArray(decoded)) return decoded as string[];
      return raw === '' ? null : raw.split(',').map((s) => s.trim());
    }
    if (Array.isArray(raw)) return raw as string[];
    return null;
  }

  private toArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [value];
  }
}
