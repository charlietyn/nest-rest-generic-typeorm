# @charlietyn/nest-rest-typeorm

Biblioteca reutilizable de CRUD REST para **NestJS 11/12 y TypeORM**. Proporciona
entidades base, servicios y controladores heredables sin abrir conexiones ni arrancar
servidores al importarse. Conserva el contrato de consultas del port de `rest-generic-class`.

## Características

- Filtros AND/OR y de relaciones, selección de columnas y ordenación.
- Relaciones permitidas por `RELATIONS`, paginación por offset/cursor y jerarquías.
- CRUD individual y por lotes; relaciones uno-a-muchos y muchos-a-muchos.
- Caché opcional con versiones y adaptadores asíncronos.
- Roles, restricciones de escritura por campo y traducción de errores de BD.
- Exportación Excel/PDF opcional con `exceljs` y `pdfkit`.

## Compatibilidad

| Componente | Requisito |
|---|---|
| Node.js de consumidores | 22.12 o posterior; LTS recomendado |
| NestJS common/core | 11.x o 12.x, ambos de la misma major |
| TypeORM | ^0.3.31 |
| @nestjs/typeorm | 11.x para Nest 11, 12.x para Nest 12; opcional si inyectas repositorios manualmente |
| reflect-metadata / rxjs | ^0.2.2 / ^7.8.2 |
| Desarrollo y Jest con Nest 12 | Node.js 24.9+; npm test activa VM modules |
| TypeScript | Compilado y probado con 5.9; declaraciones incluidas |

Se distribuye CommonJS, consumible desde `require` o `import` de Node moderno,
incluso con los peers ESM de NestJS 12. No hay dos runtimes ni compilación dual.
Si una plataforma desactiva `require(esm)`, debes habilitarlo siguiendo sus instrucciones.
NestJS 9/10 y Node.js 20 quedan fuera del contrato de este paquete scoped.

## Instalación

Una vez publicada la versión:

```sh
npm install @charlietyn/nest-rest-typeorm @nestjs/common@12 @nestjs/core@12 @nestjs/typeorm@12 typeorm@^0.3.31 reflect-metadata rxjs
# Con NestJS 11, usa @11 para los tres paquetes @nestjs anteriores.
# Instala también el driver de tu aplicación, por ejemplo PostgreSQL:
npm install pg
```

Antes de publicar, genera `npm pack` e instala el `.tgz` con `npm install /ruta/al/paquete.tgz`.
La preparación del repositorio no publica automáticamente ninguna versión.

## Inicio rápido

Activa `experimentalDecorators` y `emitDecoratorMetadata` en tu aplicación.
Ejemplo autocontenido en `products.module.ts`:

```typescript
import 'reflect-metadata';
import { Controller, Inject, Injectable, Module, Optional } from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Column, Entity, PrimaryGeneratedColumn, Repository } from 'typeorm';
import {
  BaseEntity, BaseService, RestController, DEFAULT_CONFIG,
  REST_GENERIC_CONFIG, RgcCacheService, type RestGenericConfig,
} from '@charlietyn/nest-rest-typeorm';

@Entity('products')
export class Product extends BaseEntity {
  static readonly MODEL = 'product';
  @PrimaryGeneratedColumn() id!: number;
  @Column() name!: string;
  @Column('float') price!: number;
}

@Injectable()
export class ProductService extends BaseService<Product> {
  constructor(
    @InjectRepository(Product) repo: Repository<Product>,
    @Optional() @Inject(REST_GENERIC_CONFIG) config?: RestGenericConfig,
    @Optional() @Inject(RgcCacheService) cache?: RgcCacheService,
  ) { super(repo, config ?? DEFAULT_CONFIG, cache); }
}

@Controller('products')
export class ProductController extends RestController<Product> {
  constructor(service: ProductService) { super(service); }
}

@Module({
  imports: [TypeOrmModule.forFeature([Product])],
  providers: [ProductService], controllers: [ProductController],
  exports: [ProductService],
})
export class ProductsModule {}
```

En el módulo raíz de tu aplicación:

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GenericRestModule } from '@charlietyn/nest-rest-typeorm';
import { ProductsModule } from './products.module';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres', url: process.env.DATABASE_URL,
      autoLoadEntities: true, synchronize: false,
    }),
    GenericRestModule.forRoot({ config: { cache: { enabled: true } } }),
    ProductsModule,
  ],
})
export class AppModule {}
```

Tu aplicación valida `DATABASE_URL`, crea tablas con migraciones y arranca Nest.
La biblioteca no exige variables de entorno. Declara constructores explícitos y repite
sus decoradores `@Optional()` en subclases: NestJS 12 no hereda esos marcadores.

```typescript
await productService.create({ name: 'Libro', price: 20 });
await productService.listAll({
  oper: { and: ['price|>=|10', 'price|<=|50'] },
  orderby: [{ price: 'asc' }], pagination: { page: 1, pageSize: 20 },
});
await productService.update({ price: 25 }, 1);
await productService.show({}, 1);
```

El controlador ofrece GET/POST en `/products`, GET en `/products/get/one`, GET/PUT/DELETE
en `/products/:id`, PUT en `/products/update/multiple` y DELETE en `/products/delete/by-id`.
Los parámetros complejos de query se envían como JSON codificado para la URL.
Más ejemplos: [referencia de consultas](docs/QUERY-REFERENCE.md) y `src/example`.

## Configuración

```typescript
GenericRestModule.forRoot({
  config: {
    filtering: { maxDepth: 5, maxConditions: 100, strictRelations: true },
    cache: { enabled: false, ttl: 60, ttlByMethod: { get_one: 30 } },
  },
});
```

`RestGenericConfigInput` admite bloques parciales. `mergeConfig()` combina con
`DEFAULT_CONFIG`: reemplaza arrays y combina `ttlByMethod` por clave. TTL está en segundos.
El store predeterminado vive en memoria, local a cada proceso. Para compartir caché,
pasa `cacheStore: new CacheManagerStore(cacheManager)` o un `RgcCacheStore` propio.
La aplicación configura e inyecta ese backend.

Las entidades pueden declarar `MODEL`, `RELATIONS`, `HIERARCHY_FIELD_ID`, `CACHE_INVALIDATES`,
`FIELD_KEY_UPDATE` y `FIELDS_BY_ROLE`. Los controladores habilitan relaciones de escritura
mediante `oneToManyConfig` / `manyToManyConfig`.

## API pública

Importa siempre desde `@charlietyn/nest-rest-typeorm`; las subrutas internas están cerradas.

| Área | Exportaciones |
|---|---|
| Base | BaseEntity, BaseService, RestController, EntityClass, getStatic, getDeclaredRelations |
| Configuración | GenericRestModule, GenericRestModuleOptions, REST_GENERIC_CONFIG, RGC_CACHE_STORE, DEFAULT_CONFIG, DEFAULT_ALLOWED_OPERATORS, mergeConfig, RestGenericConfigInput, RestGenericConfig, FilteringConfig, CacheConfig |
| Consultas | TypeormQueryTranslator, parseConditionString, decodeValue, toBetweenArray, maybeJson, parseRelationWithFields, normalizeRelations, ParsedCondition, ParsedRelation |
| Contratos | FilterParams, OrderByEntry, LogicalOperator, OperNode, OperCondition, PaginationParams, HierarchyConfig, HierarchyFilterMode, DataResult, PaginatedResult, CursorPaginatedResult, WriteResult, ValidationErrors |
| Caché | RgcCacheService, RgcCacheStore, InMemoryCacheStore, CacheManagerStore, CacheManagerLike, CacheContext |
| Relaciones | RelationManager, OneToManyConfig, ManyToManyConfig, OneToManyConfigMap, ManyToManyConfigMap, RelationMutationConfig, ResolvedRelationConfig, RelationType, ModelClass, isManyToMany |
| Escenarios | registerDataSource, findDataSourceFor, resolveDataSource, resolveRepository, injectParams, isBulkScenario, resolveRelationConfig, extractMutationData, Scenario, RelationName, SCENARIO_PARAM, RELATION_PARAM |
| Jerarquías/exportación | HierarchyEngine, ExportService, ExportFile, ExportOptions |
| Seguridad/errores | Roles, RolesGuard, ROLES_KEY, getDeniedFieldsForUser, extractUserRoles, isSuperuser, stripDeniedFields, RoleAwareUser, DatabaseErrorParser, ParsedDbError |

Firmas completas: [src/index.ts](src/index.ts).

## Errores y límites

Los errores de consulta son excepciones HTTP de Nest. `show()` lanza 404 si falta la fila.
`DatabaseErrorParser` traduce códigos PostgreSQL/MySQL a 400, 409, 422 o 500; revisa los
detalles del driver antes de exponerlos en producción.

`exceljs`/`pdfkit` se cargan al exportar; si faltan, el error explica qué instalar y el
CRUD sigue disponible. Los handlers genéricos no validan DTOs automáticamente. Configura
DTOs/pipes propios y, si los necesitas, instala `class-validator`/`class-transformer`.
`actionValidate()` devuelve éxito por defecto y debe sobrescribirse para reglas propias.

No hay transacciones distribuidas entre conexiones. El registro de DataSources se
rellena al crear servicios o mediante `registerDataSource`; si varias conexiones tienen
la misma entidad puede ganar la primera registrada e inicializada. Evita esa ambigüedad.
Los incrementos de caché no son atómicos entre procesos. Los dialectos PostgreSQL/MySQL
requieren pruebas propias; la suite de regresión usa SQLite.
Consulta [SECURITY.md](SECURITY.md) para límites de autorización y dependencias.

## Build y pruebas

```sh
npm ci
npm run check          # ESLint y tipos de código, ejemplos y tests
npm test               # SQLite, Nest DI y release simulado
npm run build          # limpia dist y genera JS + .d.ts con tsc
npm run package:check  # inspección de npm pack --dry-run
npm run test:package   # instalación aislada, CJS/ESM, tipos y HTTP
npm pack               # tarball con build previo
```

No se empaquetan NestJS/TypeORM. Solo se distribuyen JavaScript compilado, declaraciones,
README, changelog y licencia. Fuentes, ejemplos, tests, mapas y configuración local
quedan fuera mediante `files` y la inspección del contenido.

## Publicación

```sh
npm run release                 # publica la versión actual de package.json
npm run release -- patch        # corrección compatible
npm run release -- minor        # funcionalidad compatible
npm run release -- major        # cambio incompatible
npm run release -- --dry-run    # verifica sin versionar, publicar ni hacer push
```

Exige Git limpio, upstream sincronizado, validaciones correctas y versión/tag inéditos.
El release real requiere autenticación y permiso NPM sobre `@charlietyn`, crea commit/tag,
publica el tarball inspeccionado y sincroniza Git. Si NPM publica pero falla el push,
informa que el paquete ya existe y no vuelve a publicarlo. CI únicamente valida.
Recuperación, SemVer y OIDC: [CONTRIBUTING.md](CONTRIBUTING.md).

## Contribuciones y licencia

Lee [CONTRIBUTING.md](CONTRIBUTING.md), [CHANGELOG.md](CHANGELOG.md) y [SECURITY.md](SECURITY.md).
Se conserva **MIT © Charlietyn**, ya declarada por el proyecto; ver [LICENSE](LICENSE).
