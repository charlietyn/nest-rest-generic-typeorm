# nest-rest-generic-typeorm

> Generic NestJS base classes (**Model / Service / Controller**) for building advanced REST CRUD APIs with **TypeORM**.
> TypeScript port of the Laravel package [`rest-generic-class`](https://github.com/charlietyn/rest-generic-class) — same HTTP contract, same feature set.

Build a fully-featured CRUD endpoint (dynamic filtering, eager relations, ordering, pagination, hierarchical trees, transactions, versioned caching and human-friendly DB errors) in **three small files**.

---

## ✨ Features

| Capability | Supported |
|---|---|
| Dynamic filtering (`oper` AND/OR, nested, relation filters) | ✅ |
| Operators `= != < > <= >= like ilike in between null date regexp …` | ✅ |
| Ordering (`orderby`, dot-notation relations) | ✅ |
| Column projection (`select`) + per-relation field selection (`rel:f1,f2`) | ✅ |
| Eager relations whitelist (`RELATIONS`) + nested (`a.b.c`) | ✅ |
| Offset pagination + cursor / infinite scroll (`infinity`) | ✅ |
| Hierarchical data (adjacency list, 5 filter modes) | ✅ |
| Transactions on every write | ✅ |
| Bulk create / `update_multiple` / `deleteById` | ✅ |
| Versioned cache (vary headers, per-method TTL, relation versions) | ✅ |
| Friendly DB error parsing (PostgreSQL + MySQL) | ✅ |
| DTO validation (class-validator) | ✅ |

---

## 📦 Installation

```bash
npm install nest-rest-generic-typeorm
# peer deps (already in a typical Nest + TypeORM project)
npm install @nestjs/common @nestjs/core @nestjs/typeorm typeorm reflect-metadata
```

---

## 🚀 Quick start (3-file pattern)

### 1. Entity — extend `BaseEntity`, declare the whitelist

```typescript
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from 'typeorm';
import { BaseEntity } from 'nest-rest-generic-typeorm';

@Entity('products')
export class Product extends BaseEntity {
  static readonly MODEL = 'product';
  static readonly RELATIONS = ['category'] as const; // security whitelist

  @PrimaryGeneratedColumn() id!: number;
  @Column() name!: string;
  @Column('decimal') price!: number;
  @Column({ name: 'category_id', type: 'int', nullable: true }) category_id!: number | null;
  @ManyToOne(() => Category, (c) => c.products) category!: Category;
}
```

### 2. Service — extend `BaseService<T>`

```typescript
import { Injectable, Inject, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BaseService, REST_GENERIC_CONFIG, RestGenericConfig, DEFAULT_CONFIG, RgcCacheService } from 'nest-rest-generic-typeorm';
import { Product } from './product.entity';

@Injectable()
export class ProductService extends BaseService<Product> {
  constructor(
    @InjectRepository(Product) repo: Repository<Product>,
    @Optional() @Inject(REST_GENERIC_CONFIG) config?: RestGenericConfig,
    @Optional() cache?: RgcCacheService,
  ) {
    super(repo, config ?? DEFAULT_CONFIG, cache);
  }
}
```

### 3. Controller — extend `RestController<T>`

```typescript
import { Controller } from '@nestjs/common';
import { RestController } from 'nest-rest-generic-typeorm';
import { Product } from './product.entity';
import { ProductService } from './product.service';

@Controller('products')
export class ProductController extends RestController<Product> {
  constructor(service: ProductService) { super(service); }
}
```

### 4. Wire it up

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GenericRestModule } from 'nest-rest-generic-typeorm';

@Module({
  imports: [
    TypeOrmModule.forRoot({ /* ... */ }),
    GenericRestModule.forRoot({ config: { cache: { enabled: true } } }),
    TypeOrmModule.forFeature([Product]),
  ],
  providers: [ProductService],
  controllers: [ProductController],
})
export class AppModule {}
```

You now have:

```
GET    /products                 → list (filter/sort/paginate/relations/hierarchy)
GET    /products/get/one         → first matching record
GET    /products/:id             → single record (relations/select)
POST   /products                 → create (single, or bulk via {product:[...]})
PUT    /products/:id             → update
PUT    /products/update/multiple → bulk update
DELETE /products/:id             → delete
DELETE /products/delete/by-id    → delete many ({ids:[...]})
GET    /products/export/data     → export payload (data + columns)
```

---

## 🔎 Query language

### `oper` — dynamic filtering

Conditions are strings `"field|operator|value"` grouped by `and` / `or` blocks. Blocks nest, and any non-logical key is a **relation filter** (the equivalent of Eloquent `whereHas`).

```jsonc
// price >= 50 AND status = active
?oper={"and":["price|>=|50","status|=|active"]}

// name = iPhone OR name = Pixel
?oper={"or":["name|=|iPhone","name|=|Pixel"]}

// nested: active AND (price<100 OR featured=true)
?oper={"and":["status|=|active",{"or":["price|<|100","featured|=|true"]}]}

// relation filter (whereHas): products whose category name is "Phones"
?oper={"category":{"and":["name|=|Phones"]}}&relations=["category"]

// nested relation path
?oper={"user.roles":{"and":["name|=|admin"]}}
```

**Operators:** `=`, `!=`, `<`, `>`, `<=`, `>=`, `like`, `not like`, `ilike`, `not ilike`,
`in`, `not in`, `between`, `not between`, `null`, `not null`, `date`, `not date`, `regexp`, `not regexp`.
Comma-separated values become arrays (`status|in|active,pending`).

### `relations` — eager loading + field selection

```jsonc
?relations=["category"]                      // load relation
?relations=["category:id,name"]              // select relation fields
?relations=["user.roles:id,name"]            // nested + fields
?relations=all                               // every whitelisted relation
```

### `orderby`

```jsonc
?orderby=[{"price":"desc"},{"name":"asc"}]
?orderby=[{"category.name":"asc"}]           // order by relation field
```

### `select`

```jsonc
?select=["id","name","price"]
```

### `pagination`

```jsonc
?pagination={"page":1,"pageSize":20}                 // offset
?pagination={"infinity":true,"pageSize":20,"cursor":"123"}  // keyset / infinite scroll
```

### `hierarchy` (adjacency list)

Declare `static HIERARCHY_FIELD_ID = 'parent_id'` on the entity.

```jsonc
?hierarchy=true
?hierarchy={"filter_mode":"with_descendants","children_key":"children","max_depth":3}
```

Filter modes: `match_only`, `with_ancestors`, `with_descendants`, `full_branch`, `root_filter`.

---

## 🧠 Caching

Versioned, logical invalidation — no key scanning. Enable via config and (optionally) plug a `cache-manager` store:

```typescript
GenericRestModule.forRoot({
  config: { cache: { enabled: true, ttlByMethod: { list_all: 120 } } },
  cacheStore: myCacheManagerStore, // optional; defaults to in-memory
});
```

- `?cache=false` disables caching for one request.
- `?cache_ttl=300` overrides TTL for one request.
- Every successful write bumps the model's cache version (and any `CACHE_INVALIDATES`).

### Redis (store-agnostic, like Laravel's `Cache::store()`)

The store is fully async, so out-of-process backends like **Redis** invalidate
correctly (the per-model version is read back from the store on every request).
Plug a Redis-backed `cache-manager` store via the bundled `CacheManagerStore`
adapter, which also bridges the TTL unit (this library speaks **seconds**,
cache-manager speaks **milliseconds**). Build the store first, then pass the
adapter to `forRoot`:

```typescript
// cache.provider.ts
import { caching } from 'cache-manager';
import { redisStore } from 'cache-manager-ioredis-yet';
import { CacheManagerStore } from 'nest-rest-generic-typeorm';

export async function createRedisRgcStore() {
  const cache = await caching(await redisStore({ host: 'localhost', port: 6379 }));
  return new CacheManagerStore(cache); // seconds → ms handled here
}
```

```typescript
// main bootstrap (async factory so the Redis store is ready before the module)
const cacheStore = await createRedisRgcStore();

@Module({
  imports: [
    GenericRestModule.forRoot({
      config: { cache: { enabled: true } },
      cacheStore, // ← Redis-backed; versioned invalidation works across processes
    }),
  ],
})
export class AppModule {}
```

Any object implementing `RgcCacheStore` (`get/set/del`, sync **or** async) is
accepted, so you can also wrap a raw `ioredis` client directly:

```typescript
import Redis from 'ioredis';
const redis = new Redis();
const cacheStore = {
  get: async (k) => { const v = await redis.get(k); return v ? JSON.parse(v) : undefined; },
  set: async (k, val, ttl) => { ttl ? await redis.set(k, JSON.stringify(val), 'EX', ttl) : await redis.set(k, JSON.stringify(val)); },
  del: async (k) => { await redis.del(k); },
};
```

---

## ⚙️ Configuration (`GenericRestModule.forRoot`)

```typescript
{
  filtering: {
    maxDepth: 5,            // max nesting for oper/orderby
    maxConditions: 100,     // max leaf conditions per request
    strictRelations: true,  // require RELATIONS whitelist
    allowedOperators: [...],
  },
  cache: {
    enabled: false,
    ttl: 60,
    ttlByMethod: { list_all: 60, get_one: 30 },
    cacheableMethods: ['list_all', 'get_one'],
    varyHeaders: ['Accept-Language', 'X-Tenant-Id'],
    prefix: 'rgc:v1',
  },
}
```

---

## 📤 Exports (Excel / PDF)

Real file generation over the query. `exceljs` and `pdfkit` are **optional** —
install them only if you use the export endpoints:

```bash
npm install exceljs pdfkit
```

Inherited endpoints return a downloadable `StreamableFile`:

```
GET /products/export/excel?select=["id","name","price"]&oper={"and":["price|>=|50"]}
GET /products/export/pdf?orderby=[{"price":"desc"}]
GET /products/export/data        # raw { data, columns } JSON (no extra deps)
```

Programmatic use:

```typescript
const { buffer, filename, mimeType } = await productService.exportExcel({ select: ['id', 'name'] });
const pdf = await productService.exportPdf({ oper: { and: ['price|>=|100'] } }, { title: 'Premium products' });
```

Columns come from `?columns=` → `?select=` → the entity's columns (in that order),
and support dotted relation paths (e.g. `category.name`).

## 🔐 Role-based access & field restriction

The NestJS equivalent of the original Spatie integration (`fieldsByRole` +
`FilterRequestByRole`).

**Endpoint protection** — `@Roles()` + `RolesGuard` (reads `request.user`, set it
with your auth guard first; a `is_superuser` user bypasses all checks):

```typescript
import { Roles, RolesGuard } from 'nest-rest-generic-typeorm';

@Controller('products')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class ProductController extends RestController<Product> {
  constructor(service: ProductService) { super(service); }
}
```

**Field-level write restriction** — declare which roles may write which fields on
the entity. Fields the current user can't write are **silently stripped** from
`POST`/`PUT` bodies (single or bulk) before persistence:

```typescript
@Entity('products')
export class Product extends BaseEntity {
  static readonly FIELDS_BY_ROLE = {
    admin: ['status', 'is_featured'],
    editor: ['status'],
  };
  // ...
}
```

Roles are read from `request.user` as `roles: string[]`, `roles: [{name}]`,
`role: 'x'` or `role: {name}`. Helpers `getDeniedFieldsForUser`,
`extractUserRoles` and `stripDeniedFields` are exported for custom flows.

## 🧱 Architecture

```
HTTP ──▶ RestController ──▶ BaseService ──▶ TypeormQueryTranslator ──▶ Repository ──▶ DB
                │                │
                │                ├── RgcCacheService   (versioned cache)
                │                ├── HierarchyEngine   (tree building)
                │                └── transactions      (manager.transaction)
                └── DatabaseErrorParser (friendly errors)
```

The original library's PHP `oper` tree is translated to TypeORM `FindOptions` by expanding arbitrary AND/OR into **disjunctive normal form** (object = AND, array = OR), and relation filters become nested `where` objects. `relationLoadStrategy: 'query'` keeps pagination correct with to-many eager loads.

---

## 🧪 Testing

```bash
npm test     # in-memory SQLite integration tests
```

## License

MIT © Charlietyn
