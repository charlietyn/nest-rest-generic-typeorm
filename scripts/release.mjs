import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import semver from 'semver';
import { run, parsePackOutput } from './process.mjs';
import { inspectPackage } from './check-package.mjs';

export const REGISTRY = 'https://registry.npmjs.org/';

export function parseArgs(args) {
  let bump;
  let dryRun = false;
  for (const arg of args) {
    if (arg === '--dry-run' && !dryRun) dryRun = true;
    else if (['patch', 'minor', 'major'].includes(arg) && !bump) bump = arg;
    else throw new Error(`Invalid argument: ${arg}. Usage: npm run release -- [patch|minor|major] [--dry-run]`);
  }
  return { bump, dryRun };
}

export function cliArgs(args, env = process.env) {
  // npm 12 consumes --dry-run as an npm option instead of forwarding it.
  // Capture it here, then remove it so validation installs really run in temp dirs.
  const fromNpm = env.npm_config_dry_run === 'true';
  delete env.npm_config_dry_run;
  return fromNpm && !args.includes('--dry-run') ? [...args, '--dry-run'] : args;
}

export function releaseVersion(current, bump) {
  if (!semver.valid(current)) throw new Error(`Invalid package version: ${current}`);
  return bump ? semver.inc(current, bump) : current;
}

async function publishedVersions(name) {
  const response = await fetch(`${REGISTRY}${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(30000) });
  if (response.status === 404) return [];
  if (!response.ok) throw new Error(`NPM registry returned HTTP ${response.status}; cannot confirm version availability.`);
  const body = await response.json();
  if (!body.versions || typeof body.versions !== 'object') throw new Error('Invalid NPM registry response.');
  return Object.keys(body.versions);
}

// Dependency injection makes failure paths testable without publishing or pushing.
export async function release(args, {
  cwd = process.cwd(), runner = run, versions = publishedVersions, inspect = inspectPackage,
} = {}) {
  const { bump, dryRun } = parseArgs(args);
  const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(join(cwd, 'package-lock.json'), 'utf8'));
  if (!/^@charlietyn\/[a-z0-9][a-z0-9._-]*$/.test(pkg.name)) throw new Error('Package name must start with @charlietyn/.');
  if (pkg.private || pkg.publishConfig?.access !== 'public' || pkg.publishConfig?.registry !== REGISTRY) {
    throw new Error('Package must be public and target the official NPM registry.');
  }
  if (lock.name !== pkg.name || lock.version !== pkg.version || lock.packages?.['']?.version !== pkg.version) {
    throw new Error('package-lock.json is not synchronized with package.json. Run npm install first.');
  }
  const version = releaseVersion(pkg.version, bump);
  const tag = `v${version}`;
  const exec = (command, argv, options = {}) => runner(command, argv, { cwd, ...options });
  const git = (...argv) => exec('git', argv, { capture: true }).stdout.trim();
  const clean = () => {
    if (git('status', '--porcelain', '--untracked-files=all')) throw new Error('Working tree has pending changes. Commit or stash them before release (including dry-run).');
  };
  if (resolve(git('rev-parse', '--show-toplevel')) !== resolve(cwd)) throw new Error('Run release from the repository root.');
  clean();
  const branch = git('symbolic-ref', '--short', 'HEAD');
  if (!branch || branch.startsWith('-')) throw new Error('Release requires a named branch.');
  if (git('tag', '--list', tag)) throw new Error(`Release tag ${tag} already exists; no automatic retry.`);
  const remote = git('config', '--get', `branch.${branch}.remote`);
  const merge = git('config', '--get', `branch.${branch}.merge`);
  if (!remote || remote === '.' || remote.startsWith('-') || merge !== `refs/heads/${branch}`) {
    throw new Error('Configure an upstream remote branch with the same branch name before release.');
  }
  const initialHead = git('rev-parse', 'HEAD');
  const remoteHead = git('ls-remote', '--heads', remote, merge).split(/\s/)[0];
  if (remoteHead !== initialHead) throw new Error('Local HEAD and the remote branch differ. Synchronize Git before release.');
  if (git('ls-remote', '--tags', remote, `refs/tags/${tag}`)) throw new Error(`Remote tag ${tag} already exists.`);
  if ((await versions(pkg.name)).includes(version)) throw new Error(`${pkg.name}@${version} is already published.`);
  console.log(`${dryRun ? 'DRY RUN' : 'RELEASE'}: ${pkg.name} ${pkg.version} -> ${version}`);
  exec('npm', ['run', 'check']);
  exec('npm', ['test']);
  exec('npm', ['run', 'build']);
  inspect(cwd, runner);
  exec('npm', ['run', 'test:package']);
  clean();
  if (git('rev-parse', 'HEAD') !== initialHead) throw new Error('HEAD changed during validation. Start again.');
  if (dryRun) {
    console.log(`Dry run passed. Planned version: ${version}. No version, commit, tag, publication or push was made. Authentication and publish permission were not checked.`);
    return { version, published: false, dryRun: true };
  }
  exec('npm', ['whoami', '--registry', REGISTRY]);
  git('var', 'GIT_AUTHOR_IDENT');
  git('var', 'GIT_COMMITTER_IDENT');
  exec('git', ['push', '--dry-run', remote, `HEAD:${merge}`]);
  // Repeat availability checks after the potentially long validations.
  if ((await versions(pkg.name)).includes(version)) throw new Error(`${pkg.name}@${version} was published during validation.`);
  if (git('ls-remote', '--heads', remote, merge).split(/\s/)[0] !== initialHead) throw new Error('Remote branch changed during validation.');
  if (git('ls-remote', '--tags', remote, `refs/tags/${tag}`)) throw new Error(`Remote tag ${tag} appeared during validation.`);

  let phase = 'version preparation';
  let published = false;
  const staging = mkdtempSync(join(tmpdir(), 'nest-rest-release-'));
  try {
    if (bump) exec('npm', ['version', version, '--no-git-tag-version', '--ignore-scripts']);
    inspect(cwd, runner);
    const result = exec('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', staging], { capture: true });
    const pack = parsePackOutput(result.stdout);
    if (pack.name !== pkg.name || pack.version !== version || !/^[a-zA-Z0-9._-]+\.tgz$/.test(pack.filename)) throw new Error('Unexpected release tarball metadata.');
    exec('git', ['add', '--', 'package.json', 'package-lock.json']);
    exec('git', ['commit', '--allow-empty', '-m', `chore(release): ${tag}`]);
    exec('git', ['tag', '-a', tag, '-m', `Release ${pkg.name}@${version}`]);
    clean();
    phase = 'npm publication';
    // Publish the inspected artifact; prepublishOnly on the directory blocks accidental direct publication.
    exec('npm', ['publish', join(staging, pack.filename), '--access', 'public', '--registry', REGISTRY, '--ignore-scripts']);
    published = true;
    phase = 'git synchronization';
    exec('git', ['push', '--atomic', remote, `HEAD:${merge}`, `refs/tags/${tag}`]);
    console.log(`Published ${pkg.name}@${version}; release commit and ${tag} synchronized.`);
    return { version, published: true, dryRun: false };
  } catch (error) {
    if (published) throw new Error(`${pkg.name}@${version} IS ALREADY PUBLISHED. Git push failed. Do NOT publish again. Push the release commit and ${tag} manually. ${error.message}`);
    throw new Error(`Release failed during ${phase}. Local version/commit/tag may remain. Check npm view ${pkg.name}@${version} version --registry=${REGISTRY} before any manual recovery; publication may have succeeded despite a network failure. Nothing will be retried automatically. ${error.message}`);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  release(cliArgs(process.argv.slice(2))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
