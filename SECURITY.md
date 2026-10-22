# Seguridad

## Alcance

La distribución incluye únicamente JavaScript compilado, declaraciones, README,
changelog y licencia. `package:check` rechaza rutas inesperadas, enlaces simbólicos,
archivos sensibles y patrones conocidos de credenciales. Es una comprobación concreta,
no una garantía de detección universal de secretos: revisa también el contenido antes
de publicar. No incluyas `.env`, `.npmrc`, claves ni credenciales en cambios o tarballs.

Mantén autenticación y autorización en la aplicación consumidora. `RolesGuard` lee
`request.user` y no autentica credenciales. `FIELDS_BY_ROLE` restringe determinados
campos de escritura, no filtra campos de lectura ni impone aislamiento entre tenants.
Los endpoints de relaciones requieren sus propias reglas de autorización.

No hay validación automática de DTOs en los handlers genéricos. Configura DTOs concretos,
pipes y/o handlers especializados. `actionValidate()` devuelve éxito por defecto y debe
sobrescribirse para reglas de negocio. No expongas modelos completos sin revisar columnas,
relaciones, permisos y límites de consulta/exportación.

Las respuestas de `DatabaseErrorParser` pueden incluir detalles del driver. En producción
usa un filtro de excepciones que suprima esos detalles. `strictRelations` es una lista
permitida de relaciones, no un control completo de autorización de filas o columnas.

## Dependencias

Ejecuta `npm audit` antes de cada release y revisa el árbol de la aplicación consumidora.
Los peers y sus drivers se instalan en esa aplicación; no van empaquetados en el tarball.
No uses `npm audit fix --force` sin evaluar compatibilidad.

La revisión del 21-10-2026 actualizó TypeORM a 0.3.31 y SQLite de pruebas a 6.0.1,
eliminando los avisos altos y críticos del lockfile. Permanecen avisos moderados:

- `sprintf-js` a través de `argparse`/`js-yaml`/cobertura de Jest: herramientas de desarrollo;
  no se distribuyen. Evita procesar configuraciones de cobertura no confiables.
- `uuid` antiguo dentro de `exceljs` 4.4.0: exportación Excel opcional. El aviso afecta
  funciones v3/v5/v6 con buffers, no las llamadas de generación de hojas de esta biblioteca;
  esa delimitación no equivale a declarar segura toda la dependencia. No se fuerza una
  versión mayor de `uuid` incompatible mediante overrides.

Avisos: https://github.com/advisories/GHSA-hp3w-g68c-fv3c y
https://github.com/advisories/GHSA-w5hq-g745-h8pq.

## Reportar un problema

Usa el reporte privado de vulnerabilidad de GitHub si está habilitado en
https://github.com/charlietyn/nest-rest-generic-typeorm/security .
Si no está habilitado, solicita un canal privado al mantenedor sin publicar detalles
de explotación, secretos ni datos personales. No se promete un plazo de respuesta
ni un canal privado cuya configuración no se haya comprobado.
