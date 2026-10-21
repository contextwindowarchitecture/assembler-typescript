// The examples run as the README shows them. The quickstart the README mirrors admits relevant evidence and leaves
// out the rest (R-13), renders governance apart from untrusted material (R-7, R-10), and refuses when the evidence
// is missing (R-12).
import test from 'node:test';
import assert from 'node:assert/strict';
import { assemble } from '../src/index.js';
import { buildSnapshot, DOCS, main, toAnthropic, toOpenAI, type MessageRequest } from '../examples/quickstart.js';

const request = (): MessageRequest =>
  JSON.parse(new TextDecoder().decode(assemble(buildSnapshot(DOCS)).payload!)) as MessageRequest;

test('the quickstart sends the relevant chunk and traces the weak one', () => {
  const { payload, trace } = assemble(buildSnapshot(DOCS));
  const sent = JSON.parse(new TextDecoder().decode(payload!)) as MessageRequest;
  assert.deepEqual(sent.system.map(entry => entry.id), ['policy:tone']);
  assert.equal(sent.messages.length, 1);
  const [message] = sent.messages;
  assert.equal(message!.role, 'user');
  assert.match(message!.content, /kb:refunds/);
  assert.doesNotMatch(message!.content, /kb:pricing/);
  assert.deepEqual(trace.excluded.map(row => [row.item_id, row.reason]), [['kb:pricing', 'below_threshold']]);
});

test('the quickstart refuses before any model call without evidence', () => {
  const { payload, trace } = assemble(buildSnapshot([]));
  assert.equal(payload, null);
  assert.equal(trace.refused.reason, 'evidence_required');
  assert.equal(trace.recovery?.action, 'request_context');
});

test('the quickstart maps the payload to provider requests', () => {
  const sent = request();
  const anthropic = toAnthropic(sent);
  const openai = toOpenAI(sent);
  assert.equal(anthropic.system, sent.system[0]!.text);
  assert.deepEqual(anthropic.messages, sent.messages);
  assert.deepEqual(openai.messages, [{ role: 'system', content: sent.system[0]!.text }, ...sent.messages]);
  assert.ok(!('tools' in anthropic) && !('tools' in openai));
});

test('the quickstart runs', () => {
  const lines: string[] = [];
  main(line => lines.push(line));
  const out = lines.join('\n');
  assert.match(out, /kb:pricing {2}below_threshold/);
  assert.match(out, /refused: evidence_required/);
});
