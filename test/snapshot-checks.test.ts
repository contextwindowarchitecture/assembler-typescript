import test from 'node:test';
import assert from 'node:assert/strict';
import { checkSnapshot } from '../src/snapshot-checks.js';
import { loadCases, loadRejections } from './cases.js';

test('every published case is a valid snapshot (conformance/README.md, Snapshot checks)', () => {
  for (const c of loadCases()) assert.deepEqual(checkSnapshot(c.snapshot), [], c.id);
});

test('each rejection case breaks exactly one snapshot check or its schemas (R-17)', () => {
  const rejections = loadRejections();
  assert.equal(rejections.length, 14);
  for (const r of rejections) {
    const problems = checkSnapshot(r.snapshot);
    assert.equal(problems.length, 1, `${r.id}: ${problems.join('; ')}`);
  }
});

test('a problem is reported in words, naming what is wrong', () => {
  const [base] = loadCases().filter(c => c.id === 'fixture-three-slot');
  const snapshot = structuredClone(base!.snapshot) as { profile: { route: string } };
  snapshot.profile.route = 'another-route';
  assert.match(checkSnapshot(snapshot).join('\n'), /another-route/);
});

test('an unknown tokenizer or renderer is not a problem with the snapshot', () => {
  const [base] = loadCases().filter(c => c.id === 'fixture-three-slot');
  const snapshot = structuredClone(base!.snapshot) as { tokenizer: string; renderer: string };
  snapshot.tokenizer = 'some-model/v9';
  snapshot.renderer = 'some-renderer/v1';
  assert.deepEqual(checkSnapshot(snapshot), []);
});

test('a snapshot that is not an object, or is missing a member, fails its schema', () => {
  for (const value of [null, [], 'snapshot', 42, {}]) assert.ok(checkSnapshot(value).length > 0, JSON.stringify(value));
});
