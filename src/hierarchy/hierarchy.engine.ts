import { BadRequestException } from '@nestjs/common';
import { In, Repository } from 'typeorm';
import {
  HierarchyConfig,
  HierarchyFilterMode,
  PaginationParams,
} from '../interfaces/filter-params.interface';
import { maybeJson } from '../query/condition.parser';

/**
 * Self-referencing (adjacency-list) hierarchy engine — a faithful port of the
 * hierarchy block in the original `BaseService`: filter modes, tree assembly,
 * depth limiting and root-level pagination.
 *
 * @author Charlietyn (TypeScript/TypeORM port)
 */
const HIERARCHY_DEFAULTS: Required<HierarchyConfig> = {
  enabled: true,
  children_key: 'children',
  max_depth: null,
  filter_mode: 'match_only',
  include_empty_children: true,
};

const FILTER_MODES: HierarchyFilterMode[] = [
  'match_only',
  'with_ancestors',
  'with_descendants',
  'full_branch',
  'root_filter',
];

export class HierarchyEngine<T extends Record<string, unknown>> {
  constructor(
    private readonly repo: Repository<T>,
    private readonly hierarchyFieldId: string,
    private readonly primaryKey: string,
  ) {}

  static normalizeParams(hierarchy: unknown): Required<HierarchyConfig> | null {
    if (hierarchy === null || hierarchy === undefined || hierarchy === false) return null;
    if (hierarchy === true || hierarchy === 'true' || hierarchy === '1') {
      return { ...HIERARCHY_DEFAULTS };
    }
    let cfg: unknown = typeof hierarchy === 'string' ? maybeJson(hierarchy) : hierarchy;
    if (!cfg || typeof cfg !== 'object') return null;
    const obj = cfg as HierarchyConfig;
    if (obj.enabled === false) return null;

    const merged = { ...HIERARCHY_DEFAULTS, ...obj } as Required<HierarchyConfig>;
    if (!FILTER_MODES.includes(merged.filter_mode)) {
      throw new BadRequestException(
        `Invalid hierarchy filter_mode '${merged.filter_mode}'. Valid modes: ${FILTER_MODES.join(', ')}`,
      );
    }
    if (merged.max_depth !== null && (!Number.isInteger(merged.max_depth) || merged.max_depth < 1)) {
      throw new BadRequestException('Hierarchy max_depth must be a positive integer or null.');
    }
    return merged;
  }

  /** Expand the matched set according to the filter mode, then build the tree. */
  async build(matched: T[], config: Required<HierarchyConfig>): Promise<Record<string, unknown>[]> {
    const finalSet = await this.applyFilterMode(matched, config.filter_mode);
    return this.buildTree(finalSet, config);
  }

  async applyFilterMode(matched: T[], mode: HierarchyFilterMode): Promise<T[]> {
    if (!matched.length) return matched;
    switch (mode) {
      case 'match_only':
        return matched;
      case 'with_ancestors':
        return this.addAncestors(matched);
      case 'with_descendants':
        return this.addDescendants(matched);
      case 'full_branch':
        return this.addDescendants(await this.addAncestors(matched));
      case 'root_filter':
        return this.addDescendants(matched.filter((r) => r[this.hierarchyFieldId] == null));
      default:
        return matched;
    }
  }

  private async addAncestors(records: T[]): Promise<T[]> {
    const existing = new Set(records.map((r) => r[this.primaryKey]));
    const ancestorIds = new Set<unknown>();
    for (const record of records) {
      let parentId = record[this.hierarchyFieldId];
      while (parentId != null && !existing.has(parentId) && !ancestorIds.has(parentId)) {
        ancestorIds.add(parentId);
        const parent = await this.repo.findOne({ where: { [this.primaryKey]: parentId } as never });
        parentId = parent ? (parent as T)[this.hierarchyFieldId] : null;
      }
    }
    if (!ancestorIds.size) return records;
    const ancestors = await this.repo.find({ where: { [this.primaryKey]: In([...ancestorIds]) } as never });
    return this.unique([...records, ...ancestors]);
  }

  private async addDescendants(records: T[]): Promise<T[]> {
    const existing = new Set(records.map((r) => r[this.primaryKey]));
    const descendantIds = new Set<unknown>();
    let queue = [...existing];
    while (queue.length) {
      const children = await this.repo.find({
        where: { [this.hierarchyFieldId]: In(queue) } as never,
      });
      const newIds = children
        .map((c) => (c as T)[this.primaryKey])
        .filter((id) => !existing.has(id) && !descendantIds.has(id));
      if (!newIds.length) break;
      newIds.forEach((id) => descendantIds.add(id));
      queue = newIds;
    }
    if (!descendantIds.size) return records;
    const descendants = await this.repo.find({
      where: { [this.primaryKey]: In([...descendantIds]) } as never,
    });
    return this.unique([...records, ...descendants]);
  }

  buildTree(records: T[], config: Required<HierarchyConfig>): Record<string, unknown>[] {
    if (!records.length) return [];
    const childrenKey = config.children_key;
    const byId = new Map<unknown, Record<string, unknown>>();

    for (const record of records) {
      const node: Record<string, unknown> = { ...record };
      if (config.include_empty_children) node[childrenKey] = [];
      byId.set(record[this.primaryKey], node);
    }

    const roots: Record<string, unknown>[] = [];
    for (const node of byId.values()) {
      const parentId = node[this.hierarchyFieldId] ?? null;
      if (parentId === null || !byId.has(parentId)) {
        roots.push(node);
      } else {
        const parent = byId.get(parentId)!;
        if (!Array.isArray(parent[childrenKey])) parent[childrenKey] = [];
        (parent[childrenKey] as Record<string, unknown>[]).push(node);
      }
    }

    let result = roots;
    if (config.max_depth !== null) result = this.limitDepth(result, childrenKey, config.max_depth);
    if (!config.include_empty_children) result = this.removeEmptyChildren(result, childrenKey);
    return result;
  }

  private limitDepth(
    nodes: Record<string, unknown>[],
    childrenKey: string,
    maxDepth: number,
    depth = 0,
  ): Record<string, unknown>[] {
    if (depth >= maxDepth) {
      nodes.forEach((n) => (n[childrenKey] = []));
      return nodes;
    }
    for (const node of nodes) {
      const children = node[childrenKey] as Record<string, unknown>[] | undefined;
      if (children && children.length) {
        node[childrenKey] = this.limitDepth(children, childrenKey, maxDepth, depth + 1);
      }
    }
    return nodes;
  }

  private removeEmptyChildren(
    nodes: Record<string, unknown>[],
    childrenKey: string,
  ): Record<string, unknown>[] {
    for (const node of nodes) {
      const children = node[childrenKey] as Record<string, unknown>[] | undefined;
      if (children !== undefined) {
        if (!children.length) delete node[childrenKey];
        else node[childrenKey] = this.removeEmptyChildren(children, childrenKey);
      }
    }
    return nodes;
  }

  paginateRoots(
    tree: Record<string, unknown>[],
    pagination: PaginationParams | string,
    childrenKey: string,
    defaultPageSize: number,
  ): unknown {
    const pg = (typeof pagination === 'string' ? maybeJson(pagination) : pagination) as PaginationParams;
    const total = tree.length;

    if (pg?.infinity === true) {
      const pageSize = pg.pageSize ?? pg.pagesize ?? defaultPageSize;
      let startIndex = 0;
      if (pg.cursor) {
        const decoded = maybeJson<{ index?: number }>(
          Buffer.from(String(pg.cursor), 'base64').toString('utf8'),
        );
        startIndex = decoded?.index ?? 0;
      }
      const paged = tree.slice(startIndex, startIndex + pageSize);
      const nextIndex = startIndex + pageSize;
      const hasMore = nextIndex < total;
      const nextCursor = hasMore
        ? Buffer.from(JSON.stringify({ index: nextIndex })).toString('base64')
        : null;
      return { data: paged, next_cursor: nextCursor, has_more: hasMore };
    }

    const page = pg?.page ?? 1;
    const pageSize = pg?.pageSize ?? pg?.pagesize ?? defaultPageSize;
    const offset = (page - 1) * pageSize;
    const paged = tree.slice(offset, offset + pageSize);
    const lastPage = Math.ceil(total / pageSize) || 1;
    return {
      current_page: page,
      data: paged,
      per_page: pageSize,
      total,
      last_page: lastPage,
      from: total > 0 ? offset + 1 : null,
      to: total > 0 ? Math.min(offset + pageSize, total) : null,
    };
  }

  private unique(records: T[]): T[] {
    const seen = new Set<unknown>();
    const out: T[] = [];
    for (const r of records) {
      const id = r[this.primaryKey];
      if (!seen.has(id)) {
        seen.add(id);
        out.push(r);
      }
    }
    return out;
  }
}
