# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A **publishable npm library** (not an app): generic NestJS base classes — `BaseEntity`, `BaseService<T>`, `RestController<T>` — that give a TypeORM entity a full advanced REST CRUD surface in three small files. It is a TypeScript/TypeORM port of the Laravel package `rest-generic-class` and deliberately preserves the same HTTP query contract and method names (snake_case retained, camelCase aliases added). When in doubt about intended behavior, the Laravel original is the spec.

## Commands

```bash
npm run build      # tsc -p tsconfig.build.json → dist/ (also runs on prepublishOnly)
npm run lint       # ESLint, no source mutations
npm test           # jest — in-memory SQLite integration tests
npm run test:cov   # jest with coverage

# run a single test file / test by name
npx jest test/base-service.spec.ts
npx jest -t "list_all"
```

Tests live in `test/*.spec.ts` (Jest config is inline in `package.json`, `testRegex: .*\.spec\.ts$`). They boot a real TypeORM DataSource against in-memory **sqlite3** (a devDependency), so query translation, hierarchy, cache, and security are exercised end-to-end without mocks.

## Dependency boundaries (important for changes)

- Runtime deps are only `class-transformer` / `class-validator`. NestJS, TypeORM, `@nestjs/typeorm` are **peerDependencies** — never import them as if owned here.
- `exceljs` and `pdfkit` are **optional** peers. CacheManagerStore accepts a structural interface without importing cache-manager. `export/excel` + `export/pdf` and the cache-manager adapter must degrade gracefully when those packages are absent. Don't add hard imports of optional deps into always-loaded paths.
- Everything public is re-exported from `src/index.ts` — anything added to the public API must be exported there.

## Architecture

Request flow:

```
HTTP → RestController → BaseService → TypeormQueryTranslator → Repository → DB
                            ├── RgcCacheService   (versioned cache)
                            ├── HierarchyEngine   (tree building)
                            └── manager.transaction (all writes)
       RestController catches every error → DatabaseErrorParser.handle()
```

### The query contract (`FilterParams`)
`RestController.process_request()` (`src/base/rest.controller.ts`) is the single funnel that merges `req.query` + `req.body` into a `FilterParams` object: `oper`, `relations`, `select`, `orderby`, `pagination`, `hierarchy`, `attr`/`eq` (legacy equality), `soft_delete`, plus `cache`/`cache_ttl`/`columns`/`filename`. Every value may arrive as a JSON string or a real object — `maybeJson()` in `src/query/condition.parser.ts` is used everywhere to tolerate both.

### Filter translation — the core trick (`src/query/typeorm.translator.ts`)
The recursive `oper` tree (arbitrary AND/OR nesting + relation sub-filters) is expanded into **disjunctive normal form**: an OR-list of AND-objects, which is exactly TypeORM's representation (array = OR, object = AND). Key invariants when editing this file:
- `object = AND`, `array = OR`. `and` distributes via cartesian product (`mergeAnd`), `or` concatenates DNF lists.
- Conjunctions never merge by object spread: two conditions landing on the same key are combined (`conjoin`/`combineValues`) — TypeORM's `And` for column conditions, recursive merge for nested relation `where`s, distribution when either side is an OR-list. A plain spread silently drops the left-hand condition, turning `price >= 100 AND price <= 800` into `price <= 800`.
- A non-`and`/`or` key is a **relation sub-filter** (the Eloquent `whereHas` analogue), supports dot-notation paths, and produces a nested `where`. Relation metadata is resolved per current model via `metadataFor()`, never from the root repository — otherwise nested paths (`category.parent`) are rejected as non-existent.
- `relationLoadStrategy: 'query'` is forced so `skip`/`take` paginate root rows correctly even with to-many eager loads — do not remove it. Because of it, `collectFilterRelationPaths` joins only the **base** relation of a filter: TypeORM resolves the deeper chain itself, and adding the full path eager-loads unrequested relations and yields an ambiguous column alias on self-referencing relations.
- Operators are dialect-aware: `ilike`/`regexp`/`date` branch on `this.driver` (postgres vs others). Tests run on sqlite, so verify cross-dialect behavior carefully.
- `strictRelations` + the entity's static `RELATIONS` whitelist gate every relation used in filtering/loading/ordering — this is a security boundary, not a convenience.

### Entity static conventions (`src/base/base.entity.ts`)
Behavior is configured by **static members** on the entity class (mirroring the PHP model constants), read via `getStatic()`:
- `MODEL` — logical name; also the root key for bulk create payloads (`{ product: [...] }`) and the cache namespace.
- `RELATIONS` — whitelist for eager load / filter / order.
- `HIERARCHY_FIELD_ID` — self-FK enabling `?hierarchy=...`; null rejects hierarchy requests.
- `CACHE_INVALIDATES` — other entity classes whose cache version bumps on writes here.
- `FIELD_KEY_UPDATE` — alternative business key for `update` (defaults to PK).
- `FIELDS_BY_ROLE` — role→writable-fields map for field-level write stripping.

### BaseService (`src/base/base.service.ts`)
- Reads (`list_all`, `get_one`) are cache-aware via `RgcCacheService.remember()`; writes (`create`, `update`, `update_multiple`, `destroy`, `destroybyid`) run inside `repo.manager.transaction()` and call `bumpCache()` on success.
- Soft-delete is automatic when the entity has a `deleteDateColumn` (`softRemove`/`softDelete`).
- `create` detects bulk by the presence of `params[MODEL]` (or an array).
- Pagination has two modes in `paginate()`: offset (`findAndCount`, Laravel-style envelope with `current_page`/`last_page`/etc.) and keyset/`infinity` (cursor on PK via `MoreThan`).

### Relations / polyglot persistence (`src/relations/`)
`RelationManager` drives O2M/M2M CRUD purely from the resolved relation config (no ORM associations needed). It is **multi-connection aware**: the related/pivot entity may live on a DIFFERENT data source than the parent. Every `BaseService` registers its data source in `datasource-registry.ts` on construction; the manager then resolves the related/pivot **repository from whichever registered data source owns that entity** (`resolveRepository`), and runs writes in a transaction on the **related model's connection** (`resolveDataSource(relatedModel).transaction(...)`) — cross-connection writes cannot share the parent's transaction. The pivot is assumed to live on the related model's connection. With a single connection only one data source is registered, so resolution and transactions are identical to the previous `parentRepo.manager.*` behaviour. Covered by `test/cross-connection.spec.ts`.

### Caching (`src/cache/cache.service.ts`)
Versioned, logical invalidation — **no key scanning**. Each model has a version counter; a write bumps it, instantly orphaning old entries. The store (`RgcCacheStore`) is **async-first** so Redis/out-of-process backends invalidate correctly across processes. This library speaks **seconds**; `CacheManagerStore` bridges to cache-manager's milliseconds. In-memory store is the default.

### Module wiring (`src/module/generic-rest.module.ts`)
`GenericRestModule.forRoot()` is `@Global()` and provides `REST_GENERIC_CONFIG`, `RGC_CACHE_STORE`, and `RgcCacheService`. Services pull config/cache via `@Optional() @Inject(...)` so they also work standalone with `DEFAULT_CONFIG`.

### Security (`src/security/`)
`RolesGuard` + `@Roles()` read `request.user` (set by your own auth guard first; `is_superuser` bypasses). `field-access.ts` strips `FIELDS_BY_ROLE`-denied fields from write bodies (single + bulk) silently before persistence — applied in the controller and service `stripForUser`.

### `src/example/`
Reference implementation (Product/Category) showing the 3-file pattern. It documents usage; it is not part of the shipped runtime contract — treat it as living docs/test fixtures.

## Packaging and release

Public name: `@charlietyn/nest-rest-typeorm`. Use Node 24.9+ for Jest with Nest 12.
`npm run check`, `npm test`, `npm run build`, and `npm run test:package` validate the package.
`npm run release -- --dry-run` requires clean, synchronized Git. Only explicit real release publishes.
See CONTRIBUTING.md and SECURITY.md. Never publish during ordinary maintenance.
