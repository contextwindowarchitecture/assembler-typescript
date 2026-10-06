import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ROOT } from './root.js';

// The vendor script resolves vendor/ and the lock from its own location, so a copy of it under a scratch
// root writes there. The fixture specification checkout holds one file under each source the script copies.
const SOURCES = ['LICENSE', 'NOTICE', 'schema/snapshot.schema.json', 'contract/requirements.json',
  'contract/reasons.json', 'contract/slot-defaults.json', 'conformance/README.md',
  'conformance/cases/one/case.json', 'conformance/rejections/one/case.json'];

async function scratch(remote = 'git@github.com:example/spec.git'): Promise<{ script: string; spec: string; lock: string }> {
  const root = await mkdtemp(join(tmpdir(), 'cwa-vendor-'));
  const script = join(root, 'scripts', 'vendor-contract.mjs');
  await mkdir(dirname(script), { recursive: true });
  await copyFile(join(ROOT, 'scripts', 'vendor-contract.mjs'), script);
  const spec = join(root, 'spec');
  for (const source of SOURCES) {
    await mkdir(dirname(join(spec, source)), { recursive: true });
    await writeFile(join(spec, source), `${source}\n`);
  }
  const git = (...args: string[]) => execFileSync('git', ['-C', spec, '-c', `core.hooksPath=${join(root, 'no-hooks')}`,
    '-c', 'commit.gpgsign=false', '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.com', ...args],
  { encoding: 'utf8' }).trim();
  git('init', '-q');
  git('add', '-A');
  git('commit', '-q', '-m', 'fixture');
  git('remote', 'add', 'origin', remote);
  return { script, spec, lock: join(root, 'vendor', 'cwa.lock.json') };
}

interface Lock { repository: string; spec_commit: string; dirty: boolean }

async function vendor(script: string, spec: string, lock: string): Promise<Lock> {
  execFileSync(process.execPath, [script, spec], { encoding: 'utf8' });
  return JSON.parse(await readFile(lock, 'utf8')) as Lock;
}

test('an untracked file in the spec checkout does not mark the vendored contract dirty', async () => {
  const { script, spec, lock } = await scratch();
  await mkdir(join(spec, '.tool'));
  await writeFile(join(spec, '.tool', 'state.json'), '{}\n');
  const result = await vendor(script, spec, lock);
  assert.match(result.spec_commit, /^[0-9a-f]{40}$/);
  assert.equal(result.dirty, false);
});

test('a modified tracked file in the spec checkout marks the vendored contract dirty', async () => {
  const { script, spec, lock } = await scratch();
  await writeFile(join(spec, 'NOTICE'), 'changed after the commit\n');
  const result = await vendor(script, spec, lock);
  assert.equal(result.dirty, true);
});

test('the lock records the commit and the GitHub repository the checkout\'s origin remote names', async () => {
  const { script, spec, lock } = await scratch();
  const result = await vendor(script, spec, lock);
  const head = execFileSync('git', ['-C', spec, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  assert.equal(result.spec_commit, head);
  assert.equal(result.repository, 'example/spec');
  assert.equal('website_commit' in result, false);
});

test('an https origin remote names the same repository as an ssh one', async () => {
  const { script, spec, lock } = await scratch('https://github.com/example/spec');
  assert.equal((await vendor(script, spec, lock)).repository, 'example/spec');
});
