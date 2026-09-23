import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { ROOT } from './root.js';

test('src/generated matches what the vendored contract generates', () => {
  const run = spawnSync(process.execPath, [join(ROOT, 'scripts', 'generate.mjs'), '--check'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
});
