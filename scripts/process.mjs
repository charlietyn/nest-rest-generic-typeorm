import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';

export function npmCli() {
  if (process.env.npm_execpath) return process.env.npm_execpath;
  const adjacent = resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  if (existsSync(adjacent)) return adjacent;
  return createRequire(import.meta.url).resolve('npm/bin/npm-cli.js');
}

// npm 10/11 return an array; npm 12 keys results by package name.
export function parsePackOutput(stdout) {
  const value = JSON.parse(stdout);
  const entries = Array.isArray(value) ? value : Object.values(value);
  if (entries.length !== 1 || !entries[0]?.filename) throw new Error('Expected exactly one npm pack result.');
  return entries[0];
}

export function run(command, args, { cwd = process.cwd(), capture = false, allowFailure = false } = {}) {
  const executable = command === 'npm' ? process.execPath : command;
  const argv = command === 'npm' ? [npmCli(), ...args] : args;
  const result = spawnSync(executable, argv, {
    cwd, encoding: 'utf8', shell: false, windowsHide: true,
    stdio: capture ? 'pipe' : 'inherit', maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`${command} ${args.join(' ')} failed (${result.status}). ${result.stderr ?? ''}`);
  }
  return result;
}
