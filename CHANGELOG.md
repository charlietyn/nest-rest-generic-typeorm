# Changelog

Este archivo registra cambios reales. La versión de `package.json` es `1.0.0`;
no se ha publicado ninguna versión durante la preparación del paquete.

## Unreleased

### Distribución

- Nombre público `@charlietyn/nest-rest-typeorm`.
- Soporte objetivo NestJS 11 y 12, TypeORM 0.3.31+, Node.js 22.12+.
- CommonJS con declaraciones TypeScript y acceso desde ESM; exportación raíz explícita.
- Build limpio, lint sin mutaciones, tipos estrictos y pruebas del tarball independiente.
- Release local con SemVer, dry-run, controles de Git/NPM y recuperación explícita de errores.
- CI de compatibilidad y documentación de contribución y seguridad.
- Licencia MIT existente incorporada como archivo distribuible.

### Correcciones

- `injectParams()` admite el getter sin setter de `req.query` en Express 5 (NestJS 11/12).

- `GenericRestModule.forRoot()` acepta configuración parcial de `cache` y `filtering`,
  como ya admitía `mergeConfig()` en ejecución.

### Migración desde el nombre sin scope

- Sustituir imports `nest-rest-generic-typeorm` por `@charlietyn/nest-rest-typeorm`.
- NestJS 9/10 y Node antiguos quedan fuera del contrato de compatibilidad de este paquete.
- Las importaciones profundas `.../dist/...` quedan cerradas; usar la API raíz.
- `class-validator` y `class-transformer` solo los necesitan las aplicaciones que
  opten por DTOs y `ValidationPipe`; no son dependencias de ejecución de esta biblioteca.
