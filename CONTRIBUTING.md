# Contribuir

Usa Node.js 24.9 o posterior para desarrollar y ejecutar Jest con NestJS 12.
La biblioteca puede consumirse con Node.js 22.12 o posterior.

```sh
npm ci
npm run check
npm test
npm run build
npm run package:check
npm run test:package
```

`npm ci` usa el lockfile. npm 12 requiere aprobación de scripts de instalación;
`allowScripts` autoriza únicamente la versión fijada de SQLite necesaria para las
pruebas. Si cambia esa dependencia, revisa su script antes de aprobar la nueva versión.

Las pruebas TypeORM usan SQLite en memoria; no necesitan un servidor de base de datos.
La prueba del paquete instala un tarball en un directorio temporal, prueba CommonJS,
ESM, tipos estrictos, inyección de dependencias y rutas HTTP en loopback. Requiere
acceso al registro NPM para instalar los peers. Se eliminan los archivos temporales.

Para validar el consumidor con NestJS 11:

```powershell
$env:NEST_MAJOR = '11'
npm run test:package
Remove-Item Env:NEST_MAJOR
```

En POSIX: `NEST_MAJOR=11 npm run test:package`.
CI instala también NestJS 11 y ejecuta la suite completa; el lockfile de desarrollo
usa NestJS 12. Los targets de CI incluyen Windows/Linux, Node 24/26 y un consumidor
en Node 22.12. No confundas una configuración de CI con una ejecución remota verificada.

Conserva las firmas y los contratos de consulta existentes. Añade pruebas de regresión
para cambios de comportamiento y actualiza `CHANGELOG.md`. Los ejemplos de `src/example`
no se publican. Todo contrato público pasa por `src/index.ts`; no añadas subrutas internas.

## Versionado y release

La versión actual sigue siendo `1.0.0`. El nuevo nombre scoped no implica que esa
versión se haya publicado. `release` sin argumento publica la versión actual; con
`patch`, `minor` o `major` calcula el incremento SemVer desde `package.json`.

- **patch**: corrección compatible.
- **minor**: funcionalidad compatible.
- **major**: contrato incompatible.

Antes de publicar, revisa el changelog y confirma todos los cambios. Configura una
rama con upstream del mismo nombre, publica previamente esos cambios a Git y asegúrate
de que HEAD coincide con la rama remota. Configura identidad de Git y una cuenta NPM
con permiso de publicación en `@charlietyn`. Usa `npm login`; no guardes tokens en el repo.
La cuenta puede requerir OTP/2FA; sigue el mecanismo de autenticación de NPM.

```sh
npm run release -- --dry-run
npm run release
npm run release -- patch
npm run release -- minor
npm run release -- major
npm run release -- minor --dry-run
```

El dry-run exige Git limpio y sincronizado y acceso de lectura a NPM/Git. Ejecuta lint,
tipos, tests, build, `npm pack --dry-run` y la instalación del tarball. No modifica la
versión, no crea commit/tag, no autentica la publicación y no publica ni hace push.
La salida del build y los directorios temporales sí se regeneran.

El release real verifica autenticación con `npm whoami`, identidad y acceso de escritura
de Git antes de incrementar. Genera el tarball inspeccionado, crea el commit y tag
anotado `vX.Y.Z`, publica ese mismo tarball con acceso público y hace push atómico
del commit y el tag. Un tag local/remoto o versión existente impide repetir el release.
`npm publish` sobre el directorio está bloqueado por `prepublishOnly`.

Si falla antes de publicar, pueden quedar versión, commit o tag locales: revisa el
estado y corrige manualmente; el script no borra historia ni reintenta. Si NPM devuelve
un error de red, comprueba primero `npm view @charlietyn/nest-rest-typeorm@VERSION version`.
Si NPM publicó pero el push falló, **no publiques de nuevo**: sincroniza manualmente
el commit y tag ya creados. La disponibilidad no es una reserva; el registro rechaza
carreras entre publicadores.

## CI y publicación OIDC

GitHub Actions solo valida: no contiene tokens ni publica. El único publicador
implementado es el release local. Se evaluó NPM Trusted Publishing; activarlo requiere
vincular el paquete, propietario, repositorio y nombre exacto del workflow en NPM,
permisos `id-token: write` para ese job y un entorno protegido. Es una migración futura,
no un segundo publicador paralelo. Antes de incorporarlo habría que convertir el
release local en preparación de versión/tag y quitarle la publicación.

Referencia: https://docs.npmjs.com/trusted-publishers/
