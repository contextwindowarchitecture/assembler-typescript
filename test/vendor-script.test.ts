import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ROOT } from './root.js';

// The vendor script resolves vendor/ and the lock from its own location, so a copy of it under a scratch
// root writes there. The fixture website holds one file under each source the script copies.
const SOURCES = ['LICENSE', 'NOTICE', 'schema/snapshot.schema.json', 'contract/requirements.json',
  'contract/reasons.json', 'contract/slot-defaults.json', 'conformance/README.md',
  'conformance/cases/one/case.json', 'conformance/rejections/one/case.json'];

async function scratch(): Promise<{ script: string; website: string; lock: string }> {
  const root = await mkdtemp(join(tmpdir(), 'cwa-vendor-'));
  const script = join(root, 'scripts', 'vendor-contract.mjs');
  await mkdir(dirname(script), { recursive: true });
  await copyFile(join(ROOT, 'scripts', 'vendor-contract.mjs'), script);
  const website = join(root, 'website');
  for (const source of SOURCES) {
    await mkdir(dirname(join(website, source)), { recursive: true });
    await writeFile(join(website, source), `${source}\n`);
  }
  const git = (...args: string[]) => execFileSync('git', ['-C', website, '-c', `core.hooksPath=${join(root, 'no-hooks')}`,
    '-c', 'commit.gpgsign=false', '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.com', ...args],
  { encoding: 'utf8' }).trim();
  git('init', '-q');
  git('add', '-A');
  git('commit', '-q', '-m', 'fixture');
  return { script, website, lock: join(root, 'vendor', 'cwa.lock.json') };
}

async function vendor(script: string, website: string, lock: string): Promise<{ website_commit: string; dirty: boolean }> {
  execFileSync(process.execPath, [script, website], { encoding: 'utf8' });
  return JSON.parse(await readFile(lock, 'utf8')) as { website_commit: string; dirty: boolean };
}

test('an untracked file in the website checkout does not mark the vendored contract dirty', async () => {
  const { script, website, lock } = await scratch();
  await mkdir(join(website, '.tool'));
  await writeFile(join(website, '.tool', 'state.json'), '{}\n');
  const result = await vendor(script, website, lock);
  assert.match(result.website_commit, /^[0-9a-f]{40}$/);
  assert.equal(result.dirty, false);
});

test('a modified tracked file in the website checkout marks the vendored contract dirty', async () => {
  const { script, website, lock } = await scratch();
  await writeFile(join(website, 'NOTICE'), 'changed after the commit\n');
  const result = await vendor(script, website, lock);
  assert.equal(result.dirty, true);
});
