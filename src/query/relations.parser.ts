import { maybeJson } from './condition.parser';

/**
 * Relation-string parsing, faithful to the original
 * `parseRelationWithFields()` / `normalizeRelations()` methods.
 *
 * Examples:
 *   "user"               -> { relation: 'user', fields: null, segments: ['user'], base: 'user' }
 *   "user:id,name"       -> { relation: 'user', fields: ['id','name'], ... }
 *   "user.roles:id,name" -> { relation: 'user.roles', fields: ['id','name'], segments: ['user','roles'], base: 'user' }
 *
 * @author Charlietyn (TypeScript/TypeORM port)
 */
export interface ParsedRelation {
  relation: string;
  fields: string[] | null;
  segments: string[];
  base: string;
}

export function parseRelationWithFields(relationString: string): ParsedRelation {
  const colon = relationString.indexOf(':');
  const relation = (colon >= 0 ? relationString.slice(0, colon) : relationString).trim();
  const fields =
    colon >= 0
      ? relationString
          .slice(colon + 1)
          .split(',')
          .map((f) => f.trim())
          .filter((f) => f.length > 0)
      : null;

  const segments = relation.split('.');
  return { relation, fields, segments, base: segments[0] };
}

/**
 * Normalize the `relations` param into descriptors. Supports:
 *  - JSON string, single string, or string array
 *  - the `"all"` shortcut (expanded against the model's allowed list)
 */
export function normalizeRelations(
  relations: unknown,
  allowedRelations: string[],
): ParsedRelation[] {
  if (!relations) return [];

  let value: unknown = relations;
  if (typeof value === 'string') {
    if (value === 'all') {
      value = ['all'];
    } else {
      const decoded = maybeJson(value);
      value = decoded !== value ? decoded : [value];
    }
  }

  if (!Array.isArray(value)) return [];

  if (value.includes('all')) {
    value = [...allowedRelations];
  }

  return (value as unknown[])
    .filter((r): r is string => typeof r === 'string')
    .map((r) => parseRelationWithFields(r));
}
