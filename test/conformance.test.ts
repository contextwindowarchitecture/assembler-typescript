import test from 'node:test';
import assert from 'node:assert/strict';
import { assemble, SnapshotRejectedError } from '../src/index.js';
import { comparable } from '../src/conformance.js';
import { validateTrace } from '../src/schemas.js';
import { loadCases, loadRejections } from './cases.js';

// Cases this implementation does not pass yet. The list only shrinks; it is empty when M13 is done.
const PENDING = new Set<string>([]);

// The trace is compared as Running a case compares it: without trace_id, timings and recovery.detail.

for (const c of loadCases()) {
  test(`case ${c.id}`, { todo: PENDING.has(c.id) }, () => {
    const { payload, trace } = assemble(c.snapshot);
    assert.equal(validateTrace(trace), true, JSON.stringify(validateTrace.errors));
    assert.deepEqual(comparable(trace), comparable(c.trace));
    if (c.payload === null) assert.equal(payload, null);
    else assert.equal(Buffer.from(payload!).toString('utf8'), c.payload.toString('utf8'));
    if (c.payload !== null) assert.ok(Buffer.from(payload!).equals(c.payload), 'payload bytes');
  });
}

for (const r of loadRejections()) {
  test(`rejection ${r.id}`, () => {
    assert.throws(() => assemble(r.snapshot), SnapshotRejectedError);
  });
}
