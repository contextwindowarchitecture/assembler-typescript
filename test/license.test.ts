import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './root.js';

const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');

test('the package is Apache-2.0, like the specification it implements', () => {
  const pkg = JSON.parse(read('package.json')) as { license?: string; files?: string[] };
  assert.equal(pkg.license, 'Apache-2.0');
  assert.equal(read('LICENSE'), read('vendor/cwa/LICENSE'));
  assert.match(read('NOTICE'), /Apache License, Version 2\.0/);
});

test('the packed package carries LICENSE and NOTICE', () => {
  const pack = JSON.parse(execFileSync('pnpm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: ROOT, encoding: 'utf8' })) as
    { files: { path: string }[] };
  const paths = pack.files.map(file => file.path);
  for (const path of ['LICENSE', 'NOTICE']) assert.ok(paths.includes(path), path);
});

test('the package is installed and run with pnpm, from its lockfile', () => {
  const pkg = JSON.parse(read('package.json')) as { packageManager?: string; scripts: Record<string, string> };
  assert.match(pkg.packageManager ?? '', /^pnpm@\d+\.\d+\.\d+$/);
  assert.ok(existsSync(join(ROOT, 'pnpm-lock.yaml')), 'pnpm-lock.yaml');
  assert.ok(!existsSync(join(ROOT, 'package-lock.json')), 'package-lock.json must not exist');
  for (const [name, script] of Object.entries(pkg.scripts)) assert.doesNotMatch(script, /\bnpm\b/, name);
});

test('the package publishes publicly under its scope, and only after a build that passes the tests', () => {
  const pkg = JSON.parse(read('package.json')) as { name: string; private?: boolean; publishConfig?: { access?: string }; scripts: Record<string, string> };
  assert.match(pkg.name, /^@contextwindowarchitecture\//);
  assert.notEqual(pkg.private, true);
  assert.equal(pkg.publishConfig?.access, 'public');
  assert.match(pkg.scripts['prepublishOnly'] ?? '', /pnpm test/);
  assert.match(pkg.scripts['prepublishOnly'] ?? '', /pnpm run build/);
});

test('the package names its GitHub repository, the one its origin remote points at', () => {
  const pkg = JSON.parse(read('package.json')) as { repository?: { type: string; url: string } };
  assert.deepEqual(pkg.repository, { type: 'git', url: 'git+https://github.com/contextwindowarchitecture/assembler-typescript.git' });
  let origin: string | undefined;
  try {
    origin = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    origin = undefined; // a checkout without an origin remote has nothing to compare
  }
  if (origin !== undefined) {
    const repo = (url: string) => url.replace(/^git\+/, '').replace(/^git@github\.com:/, 'https://github.com/').replace(/\.git$/, '');
    assert.equal(repo(pkg.repository!.url), repo(origin));
  }
});
