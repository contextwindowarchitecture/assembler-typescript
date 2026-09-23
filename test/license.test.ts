import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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
  const [pack] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: ROOT, encoding: 'utf8' })) as
    { files: { path: string }[] }[];
  const paths = pack!.files.map(file => file.path);
  for (const path of ['LICENSE', 'NOTICE']) assert.ok(paths.includes(path), path);
});
