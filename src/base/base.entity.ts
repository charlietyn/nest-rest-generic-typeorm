/**
 * Base entity carrying the static conventions used across the library.
 * These mirror the PHP `BaseModel` constants:
 *
 *   const MODEL              -> static MODEL
 *   const RELATIONS          -> static RELATIONS
 *   const HIERARCHY_FIELD_ID -> static HIERARCHY_FIELD_ID
 *   const CACHE_INVALIDATES  -> static CACHE_INVALIDATES
 *   protected $fieldKeyUpdate-> static FIELD_KEY_UPDATE
 *   protected $fieldsByRole  -> static FIELDS_BY_ROLE
 *
 * Concrete entities extend this and add the usual TypeORM decorators.
 *
 * @author Charlietyn (TypeScript/TypeORM port)
 */
export abstract class BaseEntity {
  /** Logical entity name; used as the root key for bulk create payloads. */
  static readonly MODEL: string = '';

  /** Whitelist of relations that may be eager-loaded / filtered / ordered by. */
  static readonly RELATIONS: readonly string[] = [];

  /**
   * Self-referencing FK column enabling hierarchical listing
   * (adjacency-list). When null, the `hierarchy` parameter is rejected.
   */
  static readonly HIERARCHY_FIELD_ID: string | null = null;

  /** FQN class references whose cache version must also bump on writes. */
  static readonly CACHE_INVALIDATES: readonly Function[] = [];

  /** Alternative business key used to resolve updates (defaults to the PK). */
  static readonly FIELD_KEY_UPDATE: string | null = null;

  /**
   * Role-to-field write restriction map: `{ role: [field, ...] }`.
   * Fields not listed anywhere are writable by anyone.
   */
  static readonly FIELDS_BY_ROLE: Record<string, string[]> = {};
}

/** Constructor type that also exposes the static convention members. */
export interface EntityClass<T = unknown> extends Function {
  new (...args: any[]): T;
  MODEL?: string;
  RELATIONS?: readonly string[];
  HIERARCHY_FIELD_ID?: string | null;
  CACHE_INVALIDATES?: readonly Function[];
  FIELD_KEY_UPDATE?: string | null;
  FIELDS_BY_ROLE?: Record<string, string[]>;
}

export function getStatic<T>(cls: Function, key: string, fallback: T): T {
  const value = (cls as unknown as Record<string, unknown>)[key];
  return (value === undefined || value === null ? fallback : value) as T;
}

export function getDeclaredRelations(cls: Function): string[] {
  return [...getStatic<readonly string[]>(cls, 'RELATIONS', [])];
}
