import test from 'node:test';
import assert from 'node:assert/strict';
import { checkSnapshot } from '../src/snapshot-checks.js';
import { loadCases, loadRejections } from './cases.js';

test('every published case is a valid snapshot (conformance/README.md, Snapshot checks)', () => {
  for (const c of loadCases()) assert.deepEqual(checkSnapshot(c.snapshot), [], c.id);
});

test('each rejection case breaks exactly one snapshot check or its schemas (R-17)', () => {
  const rejections = loadRejections();
  assert.equal(rejections.length, 22);
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

test('a producer exclusion names the candidate it kept, in its own batch (R-9, R-13)', () => {
  const [base] = loadCases().filter(c => c.id === 'fixture-three-slot');
  for (const [field, reason] of [['duplicate_of', 'duplicate_content'], ['superseded_by', 'superseded']] as const) {
    const snapshot = structuredClone(base!.snapshot) as { batches: { producer: { id: string }; excluded: Record<string, string>[] }[] };
    const corpus = snapshot.batches.find(b => b.producer.id === 'policy-corpus')!;
    corpus.excluded.push({ item_id: 'kb:old', reason, stage: 'producer', [field]: 'turn:18' });
    const problems = checkSnapshot(snapshot);
    assert.equal(problems.length, 1, `${field}: ${problems.join('; ')}`);
    assert.match(problems[0]!, /kb:old.*turn:18/);
  }
});

test('a number beyond the double range makes the snapshot not I-JSON (R-17)', () => {
  // JSON.parse reads a literal such as 1e400 as Infinity.
  const [base] = loadCases().filter(c => c.id === 'fixture-three-slot');
  for (const value of [Infinity, -Infinity]) {
    const snapshot = structuredClone(base!.snapshot) as { batches: { producer: { id: string }; items: { relevance?: number }[] }[] };
    snapshot.batches.find(b => b.producer.id === 'policy-corpus')!.items[0]!.relevance = value;
    const problems = checkSnapshot(snapshot);
    assert.equal(problems.length, 1, problems.join('; '));
    assert.match(problems[0]!, /double range/);
  }
});

test('a value that matches none of a schema\'s alternatives is one problem, not one per alternative', () => {
  // A producer exclusion's reason is an exclusion code or missing_field:<name> (R-9, R-21): one anyOf, one problem.
  const [base] = loadCases().filter(c => c.id === 'fixture-three-slot');
  const snapshot = structuredClone(base!.snapshot) as { batches: { producer: { id: string }; excluded: Record<string, string>[] }[] };
  snapshot.batches.find(b => b.producer.id === 'policy-corpus')!.excluded.push({ item_id: 'kb:late', reason: 'rate_limited', stage: 'producer' });
  const problems = checkSnapshot(snapshot);
  assert.equal(problems.length, 1, problems.join('; '));
  assert.match(problems[0]!, /\/excluded\/\d+\/reason/);
});

test('a snapshot that is not an object, or is missing a member, fails its schema', () => {
  for (const value of [null, [], 'snapshot', 42, {}]) assert.ok(checkSnapshot(value).length > 0, JSON.stringify(value));
});
