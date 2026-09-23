import test from 'node:test';
import assert from 'node:assert/strict';
import { assemble, checkSnapshot, SnapshotRejectedError, UnsupportedComponentError } from '../src/index.js';
import type { Snapshot } from '../src/index.js';
import { loadCases, loadRejections } from './cases.js';

const fixture = (): Snapshot => structuredClone(loadCases().find(c => c.id === 'fixture-three-slot')!.snapshot) as Snapshot;

test('a rejected snapshot throws with its problems, and there is no trace (R-17)', () => {
  const rejection = loadRejections().find(r => r.id === 'profile-route-policy-mismatch')!;
  assert.throws(() => assemble(rejection.snapshot), (error: unknown) => {
    assert.ok(error instanceof SnapshotRejectedError);
    assert.deepEqual(error.problems, checkSnapshot(rejection.snapshot));
    assert.match(error.problems[0]!, /fixture\/v2/);
    return true;
  });
});

test('an unknown tokenizer or renderer throws UnsupportedComponentError naming it', () => {
  for (const [component, id] of [['tokenizer', 'some-model/v9'], ['renderer', 'some-renderer/v1']] as const) {
    const snapshot = fixture();
    snapshot[component] = id;
    assert.throws(() => assemble(snapshot), (error: unknown) =>
      error instanceof UnsupportedComponentError && error.component === component && error.id === id);
  }
});

test('a caller may provide a tokenizer by the id its snapshots name', () => {
  const snapshot = fixture();
  snapshot.tokenizer = 'characters/v1';
  const { trace } = assemble(snapshot, { tokenizers: { 'characters/v1': text => text.length } });
  assert.equal(trace.context.tokenizer, 'characters/v1');
  assert.equal(trace.result?.input_tokens, Buffer.from(assemble(fixture()).payload!).toString('utf8').length);
});

test('the payload and trace are deterministic, apart from the trace id and timings (R-23)', () => {
  const [a, b] = [assemble(fixture(), { traceId: 'run-1' }), assemble(fixture())];
  assert.equal(a.trace.trace_id, 'run-1');
  assert.notEqual(b.trace.trace_id, 'run-1');
  assert.deepEqual(a.payload, b.payload);
  const strip = ({ trace_id: _i, timings: _t, ...rest }: typeof a.trace) => rest;
  assert.deepEqual(strip(a.trace), strip(b.trace));
  for (const value of Object.values(a.trace.timings ?? {})) assert.ok(value !== undefined && value >= 0);
});

test('assembly does not change the snapshot it is given', () => {
  for (const c of loadCases()) {
    const snapshot = structuredClone(c.snapshot);
    assemble(snapshot);
    assert.deepEqual(snapshot, c.snapshot, c.id);
  }
});
