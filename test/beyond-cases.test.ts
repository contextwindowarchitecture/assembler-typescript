// Behaviors the published cases leave unexercised, checked on variants of fixture-three-slot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { assemble } from '../src/index.js';
import type { Snapshot } from '../src/index.js';
import { loadCases } from './cases.js';

const fixture = (): Snapshot => structuredClone(loadCases().find(c => c.id === 'fixture-three-slot')!.snapshot) as Snapshot;
const text = (payload: Uint8Array | null): string => Buffer.from(payload!).toString('utf8');

test('fixture-xml/v1 escapes " in attribute values, and & < > everywhere (Tokenizers and renderers)', () => {
  const snapshot = fixture();
  const conversation = snapshot.batches.find(b => b.producer.id === 'conversation')!;
  (conversation.items[0] as { id: string }).id = 'turn:"18"&<x>';
  const policyBatch = snapshot.batches.find(b => b.producer.id === 'policy-registry')!;
  const policy = policyBatch.items[0] as Record<string, unknown>;
  policyBatch.items.push({ ...policy, id: 'policy:v13', body: 'Answer "briefly" & <politely>.' });
  snapshot.route_policy.on_unresolved_instruction = 'surface';
  snapshot.conflicts = [{ id: 'g"1&', kind: 'instruction', items: ['policy:v12', 'policy:v13'] }];
  const { payload, trace } = assemble(snapshot);
  const out = text(payload);
  assert.match(out, /<interaction\.query id="turn:&quot;18&quot;&amp;&lt;x&gt;">\n/);
  assert.match(out, /<governance\.instructions id="policy:v13" conflict="g&quot;1&amp;">\nAnswer "briefly" &amp; &lt;politely&gt;\.\n/);
  assert.equal(trace.conflicts[0]!.resolution, 'surfaced');
});

test('the margin charge rounds up: 34 tokens at 1% charge 35 (R-16)', () => {
  const snapshot = fixture();
  snapshot.budget = { input: 35, reserved_output: 0, margin_percent: 1 };
  const fits = assemble(snapshot).trace;
  assert.equal(fits.result?.input_tokens, 34);
  assert.deepEqual(fits.excluded.filter(row => row.reason === 'over_budget'), []);
  snapshot.budget.input = 34;
  const shed = assemble(snapshot).trace;
  assert.deepEqual(shed.excluded.filter(row => row.reason === 'over_budget').map(row => row.item_id), ['refunds-eu:v17#p4']);
  assert.equal(shed.budget.margin_percent, 1);
});
