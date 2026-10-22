import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cliArgs, parseArgs, releaseVersion, release, REGISTRY } from '../scripts/release.mjs';
import { validatePack } from '../scripts/check-package.mjs';

function fixture(t, { dirty = false, fail = '', existing = [], remoteHead = 'abc', existingTag = false } = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'release-test-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const pkg = { name: '@charlietyn/test', version: '1.2.3', publishConfig: { access: 'public', registry: REGISTRY } };
  writeFileSync(join(cwd, 'package.json'), JSON.stringify(pkg));
  writeFileSync(join(cwd, 'package-lock.json'), JSON.stringify({ name: pkg.name, version: pkg.version, packages: { '': { version: pkg.version } } }));
  const calls = [];
  let target = pkg.version;
  const runner = (cmd, args) => {
    const call = `${cmd} ${args.join(' ')}`;
    calls.push(call);
    if (fail && call.startsWith(fail)) throw new Error(`simulated ${fail} failure`);
    let stdout = '';
    if (call === 'git rev-parse --show-toplevel') stdout = cwd;
    if (call === 'git status --porcelain --untracked-files=all' && dirty) stdout = ' M src/index.ts';
    if (call === 'git symbolic-ref --short HEAD') stdout = 'main';
    if (call === 'git config --get branch.main.remote') stdout = 'origin';
    if (call === 'git config --get branch.main.merge') stdout = 'refs/heads/main';
    if (call === 'git rev-parse HEAD') stdout = 'abc';
    if (call.startsWith('git ls-remote --heads')) stdout = `${remoteHead}\trefs/heads/main`;
    if (call.startsWith('git tag --list') && existingTag) stdout = 'v1.2.3';
    if (cmd === 'npm' && args[0] === 'version') {
      target = args[1];
      writeFileSync(join(cwd, 'package.json'), JSON.stringify({ ...pkg, version: target }));
    }
    if (cmd === 'npm' && args[0] === 'pack') stdout = JSON.stringify([{ name: pkg.name, version: target, filename: 'test.tgz' }]);
    return { stdout, stderr: '', status: 0 };
  };
  return { cwd, calls, runner, versions: async () => existing, inspect: () => calls.push('inspect'), pkg };
}

test('arguments and SemVer preserve current version unless a bump is requested', () => {
  assert.deepEqual(parseArgs([]), { bump: undefined, dryRun: false });
  assert.deepEqual(parseArgs(['minor', '--dry-run']), { bump: 'minor', dryRun: true });
  for (const args of [['--yes'], ['patch', 'major'], ['--dry-run', '--dry-run']]) assert.throws(() => parseArgs(args));
  assert.equal(releaseVersion('1.2.3'), '1.2.3');
  assert.equal(releaseVersion('1.2.3', 'patch'), '1.2.4');
  assert.equal(releaseVersion('1.2.3', 'minor'), '1.3.0');
  assert.equal(releaseVersion('1.2.3', 'major'), '2.0.0');
  assert.throws(() => releaseVersion('invalid', 'patch'));
});

test('npm 12 dry-run environment cannot accidentally trigger a real release', () => {
  const env = { npm_config_dry_run: 'true' };
  assert.deepEqual(cliArgs(['minor'], env), ['minor', '--dry-run']);
  assert.equal(env.npm_config_dry_run, undefined);
  assert.deepEqual(cliArgs(['--dry-run'], { npm_config_dry_run: 'true' }), ['--dry-run']);
});

test('dry-run validates but never authenticates, bumps, commits, tags, publishes or pushes', async t => {
  const f = fixture(t);
  const original = readFileSync(join(f.cwd, 'package.json'), 'utf8');
  const result = await release(['minor', '--dry-run'], f);
  assert.equal(result.version, '1.3.0');
  assert.ok(f.calls.includes('npm test'));
  assert.ok(f.calls.includes('npm run build'));
  assert.ok(f.calls.includes('npm run test:package'));
  assert.ok(!f.calls.some(c => /^(npm (version|publish|whoami)|git (add|commit|tag -a|push))/.test(c)));
  assert.equal(readFileSync(join(f.cwd, 'package.json'), 'utf8'), original);
});

for (const [label, options, pattern] of [
  ['dirty Git', { dirty: true }, /pending changes/],
  ['duplicate version', { existing: ['1.2.3'] }, /already published/],
  ['existing tag', { existingTag: true }, /already exists/],
  ['unsynchronized remote', { remoteHead: 'different' }, /Synchronize Git/],
  ['lint/type failure', { fail: 'npm run check' }, /simulated/],
  ['test failure', { fail: 'npm test' }, /simulated/],
  ['build failure', { fail: 'npm run build' }, /simulated/],
  ['consumer failure', { fail: 'npm run test:package' }, /simulated/],
  ['authentication failure', { fail: 'npm whoami' }, /simulated/],
]) {
  test(`${label} stops before version or publication`, async t => {
    const f = fixture(t, options);
    await assert.rejects(release([], f), pattern);
    assert.ok(!f.calls.some(c => /^(npm (version|publish)|git (commit|tag -a|push))/.test(c)));
    assert.equal(JSON.parse(readFileSync(join(f.cwd, 'package.json'), 'utf8')).version, '1.2.3');
  });
}

for (const bump of [undefined, 'patch', 'minor', 'major']) {
  test(`release ${bump ?? 'current'} orders validation, commit, publication and push`, async t => {
    const f = fixture(t);
    const result = await release(bump ? [bump] : [], f);
    assert.equal(result.version, releaseVersion('1.2.3', bump));
    const publish = f.calls.findIndex(c => c.startsWith('npm publish'));
    assert.ok(f.calls.findIndex(c => c.startsWith('git tag -a')) < publish);
    assert.ok(f.calls.findIndex(c => c.startsWith('git push --atomic')) > publish);
    assert.equal(f.calls.filter(c => c.startsWith('npm publish')).length, 1);
  });
}

test('published package is explicitly reported when Git push fails', async t => {
  const f = fixture(t, { fail: 'git push --atomic' });
  await assert.rejects(release(['patch'], f), /IS ALREADY PUBLISHED.*Do NOT publish again/);
  assert.equal(f.calls.filter(c => c.startsWith('npm publish')).length, 1);
});

test('uncertain publish failure never triggers push or automatic retry', async t => {
  const f = fixture(t, { fail: 'npm publish' });
  await assert.rejects(release([], f), /publication may have succeeded/);
  assert.equal(f.calls.filter(c => c.startsWith('npm publish')).length, 1);
  assert.ok(!f.calls.some(c => c.startsWith('git push --atomic')));
});

test('registry failures and package inspection failures stop before mutation', async t => {
  const f = fixture(t);
  await assert.rejects(release(['patch'], { ...f, versions: async () => { throw new Error('registry offline'); } }), /registry offline/);
  await assert.rejects(release(['patch'], { ...f, inspect: () => { throw new Error('sensitive file'); } }), /sensitive file/);
  assert.ok(!f.calls.some(c => c.startsWith('npm version')));
});

test('package validator rejects unexpected files and broken export paths', t => {
  const f = fixture(t);
  const pkg = { ...f.pkg, main: 'index.js', types: 'index.d.ts', exports: { '.': { default: './missing.js' } } };
  const pack = { name: pkg.name, version: pkg.version, files: ['package.json', 'README.md', 'LICENSE', 'index.js', 'index.d.ts'].map(path => ({ path })) };
  assert.throws(() => validatePack(pack, pkg, f.cwd), /Broken export/);
  const valid = { ...pkg, main: 'package.json', types: 'package.json', exports: { '.': { default: './package.json' } } };
  writeFileSync(join(f.cwd, 'README.md'), 'Readme');
  writeFileSync(join(f.cwd, 'LICENSE'), 'License');
  assert.throws(() => validatePack({ ...pack, files: ['package.json', 'README.md', 'LICENSE', '.env'].map(path => ({ path })) }, valid, f.cwd), /Unexpected or sensitive/);
  writeFileSync(join(f.cwd, 'README.md'), '-----BEGIN PRIVATE KEY-----');
  assert.throws(() => validatePack({ ...pack, files: ['package.json', 'README.md', 'LICENSE'].map(path => ({ path })) }, valid, f.cwd), /Possible embedded credential/);
});
