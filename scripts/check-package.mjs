import { readFileSync, lstatSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { run, parsePackOutput } from './process.mjs';

const publishedPath = /^(?:package\.json|README\.md|LICENSE|CHANGELOG\.md|dist\/(?:[a-z-]+\/)*[a-z-]+(?:\.[a-z-]+)*\.(?:js|d\.ts))$/;
const secret = /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----|\bnpm_[A-Za-z0-9]{30,}\b|\bgh[pousr]_[A-Za-z0-9]{30,}\b|(?:_authToken|AWS_SECRET_ACCESS_KEY)\s*[=:]\s*["']?[A-Za-z0-9+/=_-]{16,}/;

export function validatePack(pack, pkg, cwd = process.cwd()) {
  if (pack.name !== pkg.name || pack.version !== pkg.version) throw new Error('Tarball metadata does not match package.json.');
  const paths = new Set(pack.files.map(file => file.path));
  for (const required of ['package.json', 'README.md', 'LICENSE', pkg.main, pkg.types]) {
    if (!paths.has(required)) throw new Error(`Missing published file: ${required}`);
  }
  const targets = Object.values(pkg.exports['.']);
  for (const target of targets) {
    if (typeof target !== 'string' || !paths.has(target.replace(/^\.\//, ''))) throw new Error(`Broken export: ${target}`);
  }
  for (const file of paths) {
    if (!publishedPath.test(file) || /(?:^|\/)(?:example|test|tests|node_modules)\//.test(file)) {
      throw new Error(`Unexpected or sensitive file in package: ${file}`);
    }
    const absolute = resolve(cwd, file);
    if (lstatSync(absolute).isSymbolicLink()) throw new Error(`Symlink is not allowed: ${file}`);
    if (secret.test(readFileSync(absolute, 'utf8'))) throw new Error(`Possible embedded credential in ${file}; publication stopped.`);
  }
  return [...paths];
}

export function inspectPackage(cwd = process.cwd(), runner = run) {
  const pkg = JSON.parse(readFileSync(resolve(cwd, 'package.json'), 'utf8'));
  const result = runner('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd, capture: true });
  const pack = parsePackOutput(result.stdout);
  const paths = validatePack(pack, pkg, cwd);
  console.log(`Package ${pack.name}@${pack.version}: ${paths.length} files, ${pack.size} bytes compressed.\n${paths.join('\n')}`);
  return pack;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { inspectPackage(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
