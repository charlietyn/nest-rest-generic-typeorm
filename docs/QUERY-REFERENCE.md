# Query reference

See README.md for installation, compatibility and security limits.

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
import { CacheManagerStore } from '@charlietyn/nest-rest-typeorm';

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
import { Roles, RolesGuard } from '@charlietyn/nest-rest-typeorm';

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
