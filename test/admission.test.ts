import test from 'node:test';
import assert from 'node:assert/strict';
import { admit } from '../src/admission.js';
import type { ContextItem, Snapshot } from '../src/types.js';
import { loadCases } from './cases.js';

const snapshot = (id: string): Snapshot => structuredClone(loadCases().find(c => c.id === id)!.snapshot) as Snapshot;
const rows = (s: Snapshot) => admit(s).rows.map(r => [r.item_id, r.reason]);
const admitted = (s: Snapshot) => admit(s).admitted.map(a => a.item.id);

test('a producer ID only Object.prototype has is unlisted unless the route lists it as its own key (R-15)', () => {
  // fixture-three-slot's policy-corpus batch carries one candidate, refunds-eu:v17#p4.
  const renamed = (id: string): Snapshot => {
    const s = snapshot('fixture-three-slot');
    s.batches.find(b => b.producer.id === 'policy-corpus')!.producer.id = id;
    return s;
  };
  for (const id of ['unlisted', 'toString', 'constructor', '__proto__', 'hasOwnProperty', 'valueOf']) {
    assert.deepEqual(rows(renamed(id)), [['refunds-eu:v17#p4', 'producer_not_authenticated']], id);
  }
  const listed = renamed('toString');
  listed.route_policy.producers['toString'] = listed.route_policy.producers['policy-corpus']!;
  assert.deepEqual(rows(listed), []);
  assert.ok(admitted(listed).includes('refunds-eu:v17#p4'));
});

test("a capability is admitted only from the grant's producer when the route lists it with kind capability_policy (R-15)", () => {
  // The grant names tool-registry and allows the tool, but the route lists that producer with kind policy.
  const policy = snapshot('capability-policy-kind');
  assert.deepEqual(rows(policy), [['cap:issue_refund', 'capability_not_allowed']]);
  assert.ok(!admitted(policy).includes('cap:issue_refund'));
  // Listed and authenticated with kind capability_policy, the same producer and grant admit it.
  const capabilityPolicy = structuredClone(policy);
  capabilityPolicy.route_policy.producers['tool-registry']!.kind = 'capability_policy';
  capabilityPolicy.batches.find(b => b.producer.id === 'tool-registry')!.producer.kind = 'capability_policy';
  assert.deepEqual(rows(capabilityPolicy), []);
  assert.ok(admitted(capabilityPolicy).includes('cap:issue_refund'));
});

test('relevance compares with min_relevance as the double JSON.parse reads, so integers beyond 2^53 tie when they round alike (R-2)', () => {
  const beyond = snapshot('threshold-beyond-2-53');
  const number = (digits: string): number => JSON.parse(digits) as number;
  beyond.route_policy.slots!['evidence.knowledge']!.min_relevance = number('9007199254740993'); // rounds to 2^53
  const items = beyond.batches.find(b => b.producer.id === 'policy-corpus')!.items as ContextItem[];
  items.find(i => i.id === 'kb:a')!.relevance = number('9007199254740992'); // 2^53: a tie clears the threshold
  items.find(i => i.id === 'kb:b')!.relevance = number('9007199254740995'); // rounds to 2^53 + 4
  items.find(i => i.id === 'kb:c')!.relevance = number('9007199254740991'); // 2^53 - 1: below
  assert.deepEqual(admitted(beyond).filter(id => id.startsWith('kb:')), ['kb:a', 'kb:b']);
  assert.deepEqual(rows(beyond), [['kb:c', 'below_threshold']]);
});
