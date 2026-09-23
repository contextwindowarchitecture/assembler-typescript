import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { ROOT } from './root.js';

interface Lock {
  website_commit: string;
  dirty: boolean;
  files: Record<string, string>;
}

const VENDOR = join(ROOT, 'vendor', 'cwa');

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : Promise.resolve([join(dir, entry.name)])));
  return nested.flat();
}

test('the vendored contract matches its lock, file for file and hash for hash', async () => {
  const lock = JSON.parse(await readFile(join(ROOT, 'vendor', 'cwa.lock.json'), 'utf8')) as Lock;
  assert.match(lock.website_commit, /^[0-9a-f]{40}$/);
  assert.equal(typeof lock.dirty, 'boolean');
  const onDisk = (await walk(VENDOR)).map(file => relative(VENDOR, file).split(sep).join('/')).sort();
  assert.deepEqual(onDisk, Object.keys(lock.files).sort());
  for (const [path, sha256] of Object.entries(lock.files)) {
    const actual = createHash('sha256').update(await readFile(join(VENDOR, path))).digest('hex');
    assert.equal(actual, sha256, path);
  }
});

test('the vendored contract holds the schemas, contract data and every conformance case', async () => {
  const lock = JSON.parse(await readFile(join(ROOT, 'vendor', 'cwa.lock.json'), 'utf8')) as Lock;
  const paths = Object.keys(lock.files);
  for (const path of ['contract/requirements.json', 'contract/reasons.json', 'contract/slot-defaults.json',
    'conformance/README.md', 'schema/snapshot.schema.json', 'schema/trace.schema.json',
    'schema/conformance_report.schema.json', 'LICENSE', 'NOTICE']) {
    assert.ok(paths.includes(path), path);
  }
  assert.equal(paths.filter(path => /^conformance\/cases\/[^/]+\/case\.json$/.test(path)).length, 46);
  assert.equal(paths.filter(path => /^conformance\/rejections\/[^/]+\/case\.json$/.test(path)).length, 14);
});
