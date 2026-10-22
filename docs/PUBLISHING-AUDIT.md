# Auditoría de preparación NPM

Fecha: 21-10-2026. No se publicó ningún paquete durante esta transformación.

## Repositorio observado

Biblioteca TypeScript, no aplicación ni monorepo. `src/index.ts` ya era el barrel público.
El flujo principal es `RestController -> BaseService -> TypeormQueryTranslator -> Repository`.
Caché, jerarquías, exportación, roles y relaciones son componentes reutilizables.
`src/example` contiene ejemplos y fixtures; no forma parte del tarball.

Existían cambios locales en servicio, controlador, configuración, entidades, traductor,
relaciones, documentación y pruebas antes de comenzar. Se conservaron; los cambios
ya existentes no se atribuyen a la preparación NPM. No se creó commit en el repositorio.

## Decisiones

- Nombre: `@charlietyn/nest-rest-typeorm`, conservando `1.0.0`. No se infiere una publicación.
- Metadatos de repositorio obtenidos de `git remote`; autor y MIT ya constaban en
  `package.json` y README. `LICENSE` materializa esa licencia sin cambiarla.
- CommonJS y `tsc` se mantienen para conservar decoradores y metadatos. `NodeNext`
  resuelve los peers ESM modernos. No hay bundling ni distribución dual innecesaria.
- Node 22.12 es el mínimo de consumidores; las pruebas Jest/Nest 12 requieren Node 24.9+.
- NestJS 11/12 son peers. TypeORM exige 0.3.31 por correcciones de seguridad y los
  operadores usados. `@nestjs/typeorm` es opcional para consumidores con DI manual.
- `class-transformer` y `class-validator` se movieron a desarrollo: solo los ejemplos
  requieren sus DTOs. No se eliminó ninguna importación de ejecución.
- `exceljs` y `pdfkit` ahora están declarados como peers opcionales reales, no solo en
  `peerDependenciesMeta`. CacheManagerStore usa una interfaz estructural; no importa
  cache-manager y no necesita declarar ese paquete como peer.
- Build limpio, declaraciones y tipos estrictos; sourcemaps omitidos para no publicar
  rutas de fuentes ausentes. El campo `exports` permite solo el contrato raíz.
- Correcciones de compatibilidad: configuración parcial anidada y `req.query` de Express 5.
- Solo release local publica. CI no contiene publicación ni tokens. OIDC se documentó
  como futura migración que sustituiría ese mecanismo, no como publicador concurrente.

## Validación y límites de evidencia

Resultados comprobados localmente en Windows:

| Comprobación | Estado y resultado |
|---|---|
| Instalación limpia | Verificado: `npm ci` en copia independiente |
| NestJS 12.2.0 / Node 24.21.0 | Verificado: lint, tipos, build, 45 tests de biblioteca + 20 de release |
| NestJS 11.2.7 / Node 24.21.0 | Verificado: misma suite completa |
| Tarball NestJS 11 y 12 | Verificado: instalación independiente, CJS/ESM, tipos, DI, HTTP, optional peers ausentes |
| Mínimo Node 22.12.0 / NestJS 12 | Verificado: consumidor del tarball completo |
| `npm pack` | Verificado: ejecuta prepack/build; 46 entradas, 51 977 bytes en el artefacto revisado |
| Contenido distribuido | Verificado: exports presentes, sin rutas prohibidas ni patrones de credenciales detectados |
| SemVer patch/minor/major | Verificado mediante tests aislados; no publicación real |
| Dry-run completo | Verificado con Git independiente: manifiestos, HEAD y tags idénticos antes/después |
| Fallos de validación/publicación/push | Verificado mediante inyección de fallos; sin llamadas reales a publicar |
| Audit sin desarrollo | Verificado: 0 avisos; no representa todas las combinaciones de peers de consumidores |
| Audit completo | Verificado: 22 moderados, 0 altos/críticos; documentados |
| Workflow remoto Linux/Windows, Node 24/26 | Implementado, pendiente de ejecución en GitHub |
| NPM auth, permiso de scope, publicación y push GitHub | Pendiente; deliberadamente no ejecutado |

Las suites cubren SQLite real en memoria, filtros, relaciones, múltiples conexiones,
caché asíncrona, exportación y seguridad de campos. Se añadieron DI de Nest,
regresión Express 5, tests de release y consumidor de tarball independiente.

Los tests de release simulan las operaciones irreversibles: publicación y push de
release no se ejecutan contra NPM/GitHub. El dry-run completo se ejecuta en una copia
temporal con su propio Git y remoto local. La versión, lockfile, HEAD y tags se
comparan antes/después. Los cambios del usuario permanecen sin commit.

El consumidor se instala fuera del repositorio, sin acceso a su node_modules, carga
CommonJS/ESM y declaraciones, levanta una app HTTP en loopback y comprueba optional
peers ausentes. La instalación de peers necesita conexión a NPM.

GitHub Actions contiene una matriz Windows/Linux, Node 24/26, Nest 11/12 y consumidores
Node 22.12. La ejecución remota de esos jobs requiere un push; crear YAML y reproducir
comandos localmente no demuestra que GitHub haya ejecutado la matriz.

No se verificaron permisos de publicación en `@charlietyn`, OTP, un publish real ni
el push de release al remoto GitHub. El release los comprueba cuando se invoca para
publicar; no se usaron credenciales durante esta preparación.

## Seguridad y licencias de dependencias

La inspección del paquete usa una lista permitida de rutas y búsqueda de patrones de
credenciales. No se incluyen fuentes, tests, ejemplos, .env, .npmrc, scripts de trabajo
ni el grafo. No equivale a un escáner universal de secretos.

La revisión del lockfile eliminó vulnerabilidades altas/críticas actualizando TypeORM
y SQLite de desarrollo. Persisten avisos moderados en herramientas de cobertura y en
UUID de ExcelJS opcional; detalles y alcance en SECURITY.md. No se aplicaron overrides
mayores incompatibles ni `audit fix --force`.

Se revisaron declaraciones de licencia del lockfile: predominan MIT, ISC, BSD y Apache.
Hay alternativas MIT en licencias duales y atribuciones específicas en dependencias
de desarrollo. Se consultaron LICENSE locales de busboy, streamsearch y png-js, cuyo
lockfile no incluía ese campo. `buffers` no declara licencia en su package.json instalado;
queda pendiente aclarar esa dependencia transitiva antes de adoptar su exportador en
un producto que exija inventario completo de licencias. Ninguna dependencia se copia
dentro del tarball de esta biblioteca. Esto es un inventario técnico, no un dictamen legal.

## Riesgos conservados y documentados

- Autorización, validación DTO y aislamiento por tenant pertenecen a la aplicación.
- Datos de error del driver pueden requerir supresión mediante un filtro de excepciones.
- Registro de DataSources por proceso; entidades repetidas en conexiones pueden ser ambiguas.
- No hay atomicidad distribuida entre conexiones ni incremento atómico de caché.
- PostgreSQL/MySQL no se validaron contra servidores reales en esta sesión.
- Graphify rechazó reemplazar 552 nodos por 516 y conservó el grafo anterior. Ese artefacto
  no representa los cambios finales de empaquetado; no se burló su protección de reducción.
