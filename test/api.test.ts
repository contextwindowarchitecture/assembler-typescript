import test from 'node:test';
import assert from 'node:assert/strict';
import { assemble, checkSnapshot, PublishedTokenizerIdError, SnapshotRejectedError, UnsupportedComponentError } from '../src/index.js';
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

test('a caller tokenizer under a published ID stops before assembly, with no payload and no trace (R-16)', () => {
  // conformance/README.md, Tokenizers and renderers: a trace that names a published tokenizer always means its
  // published count, so options.tokenizers may name no published ID, whether or not the snapshot uses it.
  // fixture-three-slot names fixture-whitespace/v1 and not estimate-utf8/v1.
  let calls = 0;
  const own = (text: string) => { calls += 1; return text.length; };
  const rejected = loadRejections().find(r => r.id === 'profile-route-policy-mismatch')!.snapshot;
  const stops = (snapshot: unknown, tokenizers: Record<string, typeof own>, ids: string[]) =>
    assert.throws(() => assemble(snapshot, { tokenizers }), (error: unknown) => {
      assert.ok(error instanceof PublishedTokenizerIdError);
      assert.deepEqual(error.ids, ids);
      return true;
    });
  for (const id of ['fixture-whitespace/v1', 'estimate-utf8/v1']) {
    stops(fixture(), { [id]: own }, [id]);
    stops(fixture(), { 'characters/v1': own, [id]: own }, [id]);
    stops(rejected, { [id]: own }, [id]); // the options are checked before the snapshot
  }
  stops(fixture(), { 'estimate-utf8/v1': own, 'fixture-whitespace/v1': own }, ['fixture-whitespace/v1', 'estimate-utf8/v1']);
  assert.equal(calls, 0);
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
