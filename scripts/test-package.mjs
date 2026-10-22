import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, parsePackOutput } from './process.mjs';
import { inspectPackage, validatePack } from './check-package.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const major = process.env.NEST_MAJOR ?? '12';
if (!['11', '12'].includes(major)) throw new Error('NEST_MAJOR must be 11 or 12.');
const consumer = mkdtempSync(join(tmpdir(), 'nest-rest-consumer-'));
try {
  inspectPackage(root);
  const result = run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', consumer], { cwd: root, capture: true });
  const pack = parsePackOutput(result.stdout);
  validatePack(pack, pkg, root);
  const dependencies = {
    [pkg.name]: `file:${join(consumer, pack.filename).replaceAll('\\', '/')}`,
    '@nestjs/common': `^${major}.0.0`, '@nestjs/core': `^${major}.0.0`,
    '@nestjs/testing': `^${major}.0.0`, '@nestjs/platform-express': `^${major}.0.0`,
    '@nestjs/typeorm': `^${major}.0.0`, typeorm: '^0.3.31',
    'reflect-metadata': '^0.2.2', rxjs: '^7.8.2',
    typescript: pkg.devDependencies.typescript, '@types/node': pkg.devDependencies['@types/node'],
  };
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'isolated-library-consumer', version: '0.0.0', private: true, dependencies }, null, 2));
  run('npm', ['install', '--ignore-scripts', '--omit=optional', '--no-audit', '--no-fund', '--registry', 'https://registry.npmjs.org/'], { cwd: consumer });
  for (const name of ['consumer.cjs', 'consumer.mjs', 'types.cts', 'types.mts']) {
    writeFileSync(join(consumer, name), readFileSync(join(root, 'test/consumer', name)));
  }
  // Real consumer has no access to this repository's node_modules or source files.
  run(process.execPath, ['consumer.cjs'], { cwd: consumer });
  run(process.execPath, ['consumer.mjs'], { cwd: consumer });
  run(process.execPath, [resolve(consumer, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--module', 'nodenext', '--moduleResolution', 'nodenext', '--target', 'ES2022', '--types', 'node', '--typeRoots', './node_modules/@types', '--skipLibCheck', 'false', 'types.cts', 'types.mts'], { cwd: consumer });
  console.log(`Isolated tarball consumer passed: NestJS ${major}, Node ${process.version}; CJS, ESM, declarations, DI, HTTP and missing optional exports.`);
} finally {
  rmSync(consumer, { recursive: true, force: true });
}
