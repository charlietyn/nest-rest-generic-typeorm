# Guía para juniors — `nest-rest-generic-typeorm`

Esta guía te lleva desde "no sé qué es esto" hasta "puedo añadir una entidad nueva y
depurar un filtro raro". Está pensada para leerse en orden la primera vez y luego
usarse como referencia.

> **Requisito previo:** lo básico de NestJS (módulos, providers, controladores) y de
> TypeORM (entidad, repositorio, relación). No necesitas saber Laravel.

---

## 1. ¿Qué problema resuelve?

En una API REST normal escribes, **para cada entidad**, el mismo código una y otra vez:
listar con filtros, paginar, ordenar, cargar relaciones, crear, actualizar, borrar,
manejar errores de base de datos, cachear…

Esta librería te da todo eso **heredando de tres clases**. Escribes la entidad, un
servicio de 5 líneas y un controlador de 3 líneas, y obtienes una API REST completa con
un lenguaje de consulta avanzado por query string.

Es un **port de la librería Laravel `rest-generic-class`**. Por eso verás nombres en
`snake_case` (`list_all`, `get_one`, `soft_delete`): se mantuvieron a propósito para que
el contrato HTTP sea idéntico al original. Cuando dudes de cómo *debería* comportarse
algo, el paquete de Laravel es la especificación.

---

## 2. El patrón de tres ficheros

Todo lo que necesitas para exponer una entidad son estos tres ficheros (están en
`src/example/` como referencia viva).

### 2.1 La entidad

```ts
@Entity('products')
export class Product extends BaseEntity {
  static readonly MODEL = 'product';                  // nombre lógico
  static readonly RELATIONS = ['category'] as const;  // whitelist de relaciones

  @PrimaryGeneratedColumn() id!: number;
  @Column() name!: string;
  @Column('decimal', { precision: 10, scale: 2 }) price!: number;
  @Column({ default: 'active' }) status!: string;

  @Column({ name: 'category_id', type: 'int', nullable: true })
  category_id!: number | null;

  @ManyToOne(() => Category, (c) => c.products)
  @JoinColumn({ name: 'category_id' })   // ⚠️ ver "trampa nº 1"
  category!: Category;
}
```

### 2.2 El servicio

```ts
@Injectable()
export class ProductService extends BaseService<Product> {
  protected cacheableOperations = ['list_all', 'get_one'];

  constructor(
    @InjectRepository(Product) repo: Repository<Product>,
    @Optional() @Inject(REST_GENERIC_CONFIG) config?: RestGenericConfig,
    @Optional() cache?: RgcCacheService,
  ) {
    super(repo, config ?? DEFAULT_CONFIG, cache);
  }
}
```

`@Optional()` es lo que permite que el servicio funcione **también sin** importar
`GenericRestModule` (cae en `DEFAULT_CONFIG`). No lo quites.

### 2.3 El controlador

```ts
@Controller('products')
export class ProductController extends RestController<Product> {
  constructor(service: ProductService) {
    super(service);
  }
}
```

### 2.4 El módulo

```ts
@Module({
  imports: [TypeOrmModule.forFeature([Product, Category])],
  providers: [ProductService],
  controllers: [ProductController],
})
export class ProductModule {}
```

Y **una sola vez** en la raíz de la app:

```ts
GenericRestModule.forRoot({ cache: { enabled: true, ttl: 60 } })
```

---

## 3. Configuración por miembros estáticos

Aquí está la idea central que más cuesta al principio: **el comportamiento no se
configura con decoradores ni con opciones, sino con miembros `static` en la entidad**.
Son el equivalente de las constantes del modelo en PHP.

| Static | Para qué sirve | Si no lo pones |
|---|---|---|
| `MODEL` | Nombre lógico. Es la clave raíz del *bulk create* (`{ "product": [...] }`) y el namespace de la caché. | Bulk create y caché quedan sin nombre útil |
| `RELATIONS` | **Whitelist** de relaciones que se pueden cargar, filtrar y ordenar. | Con `strictRelations: true` (por defecto) no podrás usar **ninguna** relación |
| `HIERARCHY_FIELD_ID` | Columna FK auto-referenciada que habilita `?hierarchy=...` | Cualquier petición con `hierarchy` se rechaza |
| `CACHE_INVALIDATES` | Otras entidades cuya versión de caché sube al escribir en esta | La caché de las entidades relacionadas queda obsoleta |
| `FIELD_KEY_UPDATE` | Clave de negocio alternativa a la PK para `update` | Se usa la PK |
| `FIELDS_BY_ROLE` | Mapa rol → campos escribibles | Todos los campos son escribibles por cualquiera |

`RELATIONS` **no es una comodidad, es una frontera de seguridad**. Sin ella, un cliente
podría filtrar u ordenar por relaciones que no quieres exponer.

---

## 4. El lenguaje de consulta

Todos los parámetros viajan por query string **o** por body: `process_request()` en el
controlador los fusiona en un único objeto `FilterParams`. Cada valor puede llegar como
JSON string o como objeto real (`maybeJson()` tolera ambos).

### 4.1 `oper` — filtrado dinámico

Las condiciones son cadenas `"campo|operador|valor"` agrupadas en bloques `and` / `or`.
Los bloques anidan. **Cualquier clave que no sea `and`/`or` es un filtro de relación**
(el equivalente a `whereHas` de Eloquent).

```jsonc
// precio >= 50 Y estado = activo
?oper={"and":["price|>=|50","status|=|active"]}

// rango sobre la MISMA columna (ambos límites se respetan)
?oper={"and":["price|>=|100","price|<=|800"]}

// anidado: activo Y (precio<100 O destacado)
?oper={"and":["status|=|active",{"or":["price|<|100","featured|=|true"]}]}

// filtro por relación
?oper={"category":{"and":["name|=|Phones"]}}

// ruta anidada de relación
?oper={"category":{"parent":{"and":["name|=|Electronics"]}}}
?oper={"user.roles":{"and":["name|=|admin"]}}
```

**Operadores:** `=`, `!=`, `<`, `>`, `<=`, `>=`, `like`, `not like`, `ilike`,
`not ilike`, `in`, `not in`, `between`, `not between`, `null`, `not null`, `date`,
`not date`, `regexp`, `not regexp`.
Un valor con comas se convierte en array (`status|in|active,pending`).

### 4.2 El resto de parámetros

```jsonc
?relations=["category"]                 // cargar relación
?relations=["category:id,name"]         // cargar solo esos campos
?relations=all                          // todas las de la whitelist
?select=["id","name","price"]
?orderby=[{"price":"desc"},{"category.name":"asc"}]
?pagination={"page":1,"pageSize":20}                        // offset
?pagination={"infinity":true,"pageSize":20,"cursor":"123"}  // keyset
?hierarchy={"filter_mode":"with_descendants","max_depth":3}
?soft_delete=true        // solo borrados;  false = incluir borrados
?cache=true&cache_ttl=120
```

---

## 5. Cómo viaja una petición por dentro

```
HTTP → RestController → BaseService → TypeormQueryTranslator → Repository → BD
                            ├── RgcCacheService   (caché versionada)
                            ├── HierarchyEngine   (árboles)
                            └── manager.transaction (toda escritura)
       RestController captura TODO error → DatabaseErrorParser.handle()
```

1. **`RestController.process_request()`** fusiona query + body en `FilterParams`.
2. **`BaseService`** decide si lee de caché (`list_all`, `get_one`) o abre transacción
   (toda escritura), y llama al traductor.
3. **`TypeormQueryTranslator`** convierte `FilterParams` en `FindManyOptions` de TypeORM.
4. Cualquier excepción sube al controlador y `DatabaseErrorParser` la convierte en un
   error HTTP legible.

### 5.1 El truco central del traductor

TypeORM representa las condiciones así: **objeto = AND, array = OR**. El árbol `oper`
puede anidar arbitrariamente, así que se expande a **forma normal disyuntiva (DNF)**:
una lista OR de objetos AND, que es exactamente lo que TypeORM entiende.

- `and` distribuye por producto cartesiano (`mergeAnd`).
- `or` concatena las listas DNF.

Detalle que sorprende: dos condiciones sobre **la misma columna** no pueden coexistir en
un objeto plano de JS (la segunda pisaría a la primera). Por eso, cuando dos condiciones
caen en la misma clave se combinan con el operador `And` de TypeORM en vez de
sobrescribirse. Eso es lo que hace que `price >= 100 AND price <= 800` funcione de
verdad en lugar de devolver silenciosamente filas de más.

---

## 6. Trampas conocidas (léelas antes de depurar)

### Trampa nº 1 — `@JoinColumn` en relaciones auto-referenciadas

Si declaras una columna FK **y** una relación sin `@JoinColumn`, TypeORM crea una
**segunda** columna FK que nadie rellena, y la relación sale siempre vacía:

```ts
@Column({ name: 'parent_id' }) parent_id!: number | null;
@ManyToOne(() => Category, (c) => c.children)   // ❌ TypeORM crea "parentId"
parent!: Category;
```

```ts
@Column({ name: 'parent_id' }) parent_id!: number | null;
@ManyToOne(() => Category, (c) => c.children)
@JoinColumn({ name: 'parent_id' })              // ✅ ata la relación a tu columna
parent!: Category;
```

Síntoma típico: `HIERARCHY_FIELD_ID` funciona pero `parent`/`children` vienen vacíos.

### Trampa nº 2 — `relationLoadStrategy: 'query'` está forzado a propósito

El traductor siempre fuerza `relationLoadStrategy: 'query'`. Sin eso, `skip`/`take`
paginarían **filas del JOIN** en lugar de filas raíz, y una relación to-many te rompería
el conteo de páginas. **No lo quites.**

Como efecto lateral, al filtrar por una relación anidada solo se añade la **relación
base** al árbol de relaciones: TypeORM resuelve el resto de la cadena por su cuenta, y
añadir la ruta completa provocaría un alias ambiguo en relaciones auto-referenciadas.

### Trampa nº 3 — filtrar ≠ cargar

Filtrar por `category` no garantiza que `category` venga en la respuesta. Si la quieres
en el payload, pídela explícitamente con `?relations=["category"]`.

### Trampa nº 4 — los operadores dependen del dialecto

`ilike`, `regexp` y `date` se traducen distinto en PostgreSQL que en el resto. Los tests
corren sobre **sqlite**, así que un cambio que pasa en local puede comportarse distinto
en Postgres. Revisa `this.driver` en el traductor.

### Trampa nº 5 — la caché es versionada, no se borra por claves

No hay barrido de claves. Cada modelo tiene un contador de versión; al escribir se sube
y las entradas viejas quedan huérfanas al instante. Por eso funciona con Redis entre
varios procesos. La librería habla en **segundos**; `CacheManagerStore` hace de puente
con los milisegundos de `cache-manager`.

---

## 7. Superficie de endpoints heredada

Heredando de `RestController` obtienes:

```
GET    /recurso                      listar (filtros, orden, paginación, jerarquía)
GET    /recurso/get/one              primer registro que cumple el filtro
GET    /recurso/:id                  detalle
POST   /recurso                      crear (uno o bulk con {"model":[...]})
PUT    /recurso/:id                  actualizar
PUT    /recurso/update/multiple      actualizar varios
DELETE /recurso/:id                  borrar
DELETE /recurso/delete/by-id         borrar varios por id
POST   /recurso/validate             validar sin persistir
GET    /recurso/export/data          datos + columnas
GET    /recurso/export/excel         xlsx  (requiere exceljs)
GET    /recurso/export/pdf           pdf   (requiere pdfkit)
```

Y para relaciones gestionadas (`:parent_id/:relation/...`):

```
GET    /:parent_id/:relation                      listar relacionados
GET    /:parent_id/:relation/:related_id          ver uno
POST   /:parent_id/:relation                      crear (y /bulk)
PUT    /:parent_id/:relation/:related_id          actualizar (y /bulk)
DELETE /:parent_id/:relation/:related_id          borrar (y /bulk)
POST   /:parent_id/:relation/attach               asociar (M2M)
DELETE /:parent_id/:relation/detach/:related_id   desasociar (y /bulk)
PUT    /:parent_id/:relation/pivot/:related_id    actualizar pivote (y /bulk)
```

---

## 8. Relaciones y multi-conexión

`RelationManager` hace el CRUD de relaciones **sin necesitar asociaciones del ORM**:
trabaja solo con la configuración resuelta (`OneToManyConfig` / `ManyToManyConfig`).

Lo importante: **la entidad relacionada puede vivir en otra conexión**. Cada
`BaseService` registra su data source al construirse (`datasource-registry.ts`), y el
manager resuelve el repositorio en **la conexión que sea dueña de esa entidad**, y
ejecuta la transacción sobre la conexión **del modelo relacionado**. Una escritura
cross-connection no puede compartir la transacción del padre — de ahí el diseño.

Con una sola conexión todo esto es transparente: solo hay un data source registrado.

---

## 9. Fronteras de dependencias (importante al tocar código)

- Dependencias en runtime: **solo** `class-transformer` y `class-validator`.
- NestJS, TypeORM y `@nestjs/typeorm` son **peerDependencies** — nunca los trates como
  propios.
- `exceljs`, `pdfkit` y `cache-manager` son **peers opcionales**: el código debe degradar
  con elegancia si no están instalados. No metas imports duros de estos paquetes en
  rutas que siempre se cargan.
- Todo lo público se reexporta desde `src/index.ts`. Si añades API pública, expórtala ahí.

---

## 10. Comandos del día a día

```bash
npm run build      # tsc → dist/
npm test           # jest sobre sqlite en memoria
npm run test:cov   # con cobertura

npx jest test/query-translator.spec.ts   # un fichero
npx jest -t "list_all"                   # un test por nombre
```

Los tests levantan un `DataSource` real de TypeORM contra **sqlite en memoria**, sin
mocks. Eso significa que ejercitan de verdad la traducción de consultas, la jerarquía,
la caché y la seguridad de punta a punta.

---

## 11. Tu primera tarea sugerida

1. Copia `src/example/` a una entidad nueva tuya (por ejemplo `Supplier`).
2. Declara `MODEL` y `RELATIONS`.
3. Levanta la app y prueba:
   `GET /suppliers?oper={"and":["name|like|%a%"]}&pagination={"page":1,"pageSize":5}`
4. Añade una relación, mete su nombre en `RELATIONS` y filtra por ella.
5. Quítala de `RELATIONS` y observa el error: acabas de ver la frontera de seguridad.
6. Escribe un test en `test/` copiando el arranque de `test/query-translator.spec.ts`.

Si algo no cuadra, mira primero el traductor (`src/query/typeorm.translator.ts`): es
donde ocurre casi toda la magia y casi todos los malentendidos.


## Distribucion actual

El paquete es `@charlietyn/nest-rest-typeorm`, para NestJS 11/12. Consulta README.md,
CONTRIBUTING.md y SECURITY.md para compatibilidad, build, release y limites.
class-validator/class-transformer se usan en ejemplos y aplicaciones; no son dependencias runtime de la biblioteca.
