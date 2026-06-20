import { getStatic } from '../base/base.entity';

/**
 * Role-based field-write restriction — the TypeScript counterpart of the
 * original `BaseModel::getDeniedFieldsForUser()` and the `FilterRequestByRole`
 * middleware. Fields are declared per role on the entity via the static
 * `FIELDS_BY_ROLE` map; fields not listed anywhere are writable by anyone.
 *
 * @author Charlietyn (TypeScript port)
 */

export interface RoleAwareUser {
  is_superuser?: boolean;
  isSuperuser?: boolean;
  roles?: unknown;
  role?: unknown;
  [key: string]: unknown;
}

/**
 * Normalize a user's roles into a flat list of role names. Accepts:
 *  - `roles: ['admin', 'editor']`
 *  - `roles: [{ name: 'admin' }, { slug: 'editor' }]`
 *  - `role: 'admin'` or `role: { name: 'admin' }`
 */
export function extractUserRoles(user: RoleAwareUser | null | undefined): string[] {
  if (!user) return [];
  const out = new Set<string>();
  const consume = (value: unknown): void => {
    if (value == null) return;
    if (typeof value === 'string') {
      out.add(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(consume);
      return;
    }
    if (typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      const name = obj.name ?? obj.slug ?? obj.role ?? obj.title;
      if (typeof name === 'string') out.add(name);
    }
  };
  consume(user.roles);
  consume(user.role);
  return [...out];
}

export function isSuperuser(user: RoleAwareUser | null | undefined): boolean {
  return Boolean(user?.is_superuser ?? user?.isSuperuser ?? false);
}

/**
 * Returns the fields the user is NOT allowed to write, derived from the
 * model's `FIELDS_BY_ROLE`. Algorithm (identical to the original):
 *  1. no map declared           → []  (fast path)
 *  2. superuser                 → []  (fast path)
 *  3. universe = ∪ all listed fields
 *  4. allowed  = ∪ fields of the roles the user holds
 *  5. denied   = universe − allowed
 */
export function getDeniedFieldsForUser(
  modelClass: Function,
  user: RoleAwareUser | null | undefined,
): string[] {
  const fieldsByRole = getStatic<Record<string, string[]>>(modelClass, 'FIELDS_BY_ROLE', {});
  const roles = Object.keys(fieldsByRole);
  if (!roles.length) return [];
  if (isSuperuser(user)) return [];

  const universe = new Set<string>();
  for (const list of Object.values(fieldsByRole)) list.forEach((f) => universe.add(f));

  const userRoles = extractUserRoles(user);
  const allowed = new Set<string>();
  for (const role of roles) {
    if (userRoles.includes(role)) fieldsByRole[role].forEach((f) => allowed.add(f));
  }

  return [...universe].filter((f) => !allowed.has(f));
}

/** Remove denied fields from a request payload (single object or array). */
export function stripDeniedFields<T extends Record<string, unknown>>(
  payload: T | T[],
  denied: string[],
): T | T[] {
  if (!denied.length) return payload;
  const clean = (obj: T): T => {
    const copy = { ...obj };
    for (const field of denied) delete copy[field];
    return copy;
  };
  return Array.isArray(payload) ? payload.map(clean) : clean(payload);
}
