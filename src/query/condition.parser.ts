import { BadRequestException } from '@nestjs/common';

/**
 * Parsing primitives shared by every ORM-specific translator.
 * Faithful re-implementation of `HasDynamicFilter::parseConditionString()`,
 * `decodeValue()` and `toBetweenArray()` from the original package.
 *
 * @author Charlietyn (TypeScript/TypeORM port)
 */

export interface ParsedCondition {
  field: string;
  operator: string;
  value: string;
}

/** Split a `"field|operator|value"` string into its three parts. */
export function parseConditionString(condition: unknown): ParsedCondition {
  if (typeof condition !== 'string') {
    const type = condition === null ? 'null' : typeof condition;
    throw new BadRequestException(
      `Invalid condition format: expected a string like 'field|operator|value', but received ${type}. ` +
        `Ensure 'oper' is an array of strings, e.g.: ` +
        `{"oper": {"and": ["category_id|=|1", "status|=|active"]}} or {"oper": ["category_id|=|1"]}.`,
    );
  }

  // Split into at most 3 parts so values may legally contain "|".
  const idx1 = condition.indexOf('|');
  const idx2 = idx1 >= 0 ? condition.indexOf('|', idx1 + 1) : -1;
  if (idx1 < 0 || idx2 < 0) {
    throw new BadRequestException(
      `Invalid condition: '${condition}'. Expected format 'field|operator|value'.`,
    );
  }

  return {
    field: condition.slice(0, idx1),
    operator: condition.slice(idx1 + 1, idx2),
    value: condition.slice(idx2 + 1),
  };
}

/**
 * Decode a raw string value to its proper JS type.
 *  - `"null"` -> null, `"true"/"false"` -> boolean, numeric -> number.
 *  - A comma-separated string becomes an array (used by `in`, `between`, ...).
 */
export function decodeValue(raw: string): unknown {
  const val = raw.trim();
  if (val.includes(',')) {
    return val.split(',').map((part) => decodeValue(part));
  }
  switch (val.toLowerCase()) {
    case 'null':
      return null;
    case 'true':
      return true;
    case 'false':
      return false;
    default:
      return isNumeric(val) ? Number(val) : val;
  }
}

/** Normalize a value to a `[min, max]` tuple for BETWEEN operators. */
export function toBetweenArray(value: unknown): [unknown, unknown] {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new BadRequestException("The 'between' operator requires exactly two values.");
  }
  return [value[0], value[1]];
}

export function isNumeric(val: string): boolean {
  if (val.trim() === '') return false;
  return !Number.isNaN(Number(val)) && Number.isFinite(Number(val));
}

/** True when an object has only logical keys (`and`/`or`). */
export function isLogicalNode(node: Record<string, unknown>): boolean {
  return Object.keys(node).every((k) => k === 'and' || k === 'or');
}

/** Parse a JSON string param if possible, otherwise return the original value. */
export function maybeJson<T = unknown>(value: unknown): T {
  if (typeof value !== 'string') return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return value as unknown as T;
  }
}
