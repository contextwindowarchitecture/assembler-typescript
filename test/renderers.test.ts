import test from 'node:test';
import assert from 'node:assert/strict';
import { render, type RenderItem } from '../src/renderers.js';
import { TOKENIZERS } from '../src/tokenizers.js';
import type { Profile } from '../src/types.js';

const count = TOKENIZERS['fixture-whitespace/v1']!;
const FRESHNESS = '2026-09-22T11:59:00Z';

test('cwa-messages/v1 marks a surfaced member in its system or tools text, and only the payload counts the mark (R-11)', () => {
  // conformance/README.md, Tokenizers and renderers: the model receives each entry's text and nothing else, so the
  // mark is in the text; the group id is escaped as fixture-xml/v1 escapes attribute values, the body is not.
  const placement: Profile['placement'] = [
    { slot: 'governance.instructions', wrap: 'system' },
    { slot: 'governance.capabilities', wrap: 'tools' },
    { slot: 'interaction.query', wrap: 'xml:query' },
  ];
  const items: RenderItem[] = [
    { id: 'policy:a', slot: 'governance.instructions', body: 'Cite <every> source & quote.', lineage: 'verified', freshness: FRESHNESS, conflict: 'g"<&>' },
    { id: 'policy:b', slot: 'governance.instructions', body: 'Be brief.', lineage: 'verified', freshness: FRESHNESS },
    { id: 'cap:x', slot: 'governance.capabilities', body: '{"name": "x"}', lineage: 'verified', freshness: FRESHNESS, conflict: 'g-tools' },
    { id: 'turn:1', slot: 'interaction.query', body: 'Hello?', lineage: 'user', freshness: FRESHNESS },
  ];
  const rendered = render('cwa-messages/v1', placement, items, count);
  const request = JSON.parse(rendered.payload.toString('utf8')) as { system: object[]; tools: object[]; messages: { content: string }[] };
  assert.deepEqual(request.system, [
    { conflict: 'g"<&>', id: 'policy:a', text: '<conflict group="g&quot;&lt;&amp;&gt;">\nCite <every> source & quote.\n</conflict>' },
    { id: 'policy:b', text: 'Be brief.' },
  ]);
  assert.deepEqual(request.tools, [{ conflict: 'g-tools', id: 'cap:x', text: '<conflict group="g-tools">\n{"name": "x"}\n</conflict>' }]);
  // Per-item tokens count the body alone; the <conflict> wrapper, like an xml: wrapper, counts only in the payload.
  assert.deepEqual(rendered.occurrences.map(o => [o.item.id, o.tokens]), [['policy:a', 5], ['policy:b', 2], ['cap:x', 2], ['turn:1', 1]]);
  const content = request.messages[0]!.content;
  assert.equal(rendered.tokens, (5 + 3) + 2 + (2 + 3) + count(content));
});

test('history turns render in the order they were said: by freshness at full precision, then by id (R-7)', () => {
  // conformance/README.md, Ordering: every other placement goes by id alone. Freshness compares as an instant, so an
  // offset or a fraction's trailing zeros do not move a turn, and an id decides only between turns said at the same
  // instant. Here id order, the freshness strings' order and the instants' order all differ.
  const placement: Profile['placement'] = [
    { slot: 'evidence.knowledge', wrap: 'xml:evidence' },
    { slot: 'interaction.history', wrap: 'xml:history' },
    { slot: 'interaction.query', wrap: 'xml:query' },
  ];
  const item = (id: string, slot: RenderItem['slot'], freshness: string): RenderItem => ({ id, slot, body: id, lineage: 'user', freshness });
  const items: RenderItem[] = [
    item('turn:0', 'interaction.query', '2026-09-22T11:00:00Z'),
    item('turn:1', 'interaction.history', '2026-09-22T13:47:00+02:00'),
    item('turn:2', 'interaction.history', '2026-09-22T11:46:00Z'),
    item('turn:3', 'interaction.history', '2026-09-22T11:48:00.25Z'),
    item('turn:4', 'interaction.history', '2026-09-22T11:48:00.5Z'),
    item('turn:30', 'interaction.history', '2026-09-22T11:48:00.500Z'),
    item('kb:a', 'evidence.knowledge', '2026-09-22T11:50:00Z'),
    item('kb:b', 'evidence.knowledge', '2026-09-22T11:40:00Z'),
  ];
  const expected = ['kb:a', 'kb:b', 'turn:2', 'turn:1', 'turn:3', 'turn:30', 'turn:4', 'turn:0'];
  const ids = (text: string) => [...text.matchAll(/<\w+ id="([^"]+)"/g)].map(([, id]) => id);
  const texts: Record<string, (payload: string) => string> = {
    'fixture-xml/v1': payload => payload,
    'cwa-messages/v1': payload => (JSON.parse(payload) as { messages: { content: string }[] }).messages[0]!.content,
  };
  for (const [renderer, text] of Object.entries(texts)) {
    const rendered = render(renderer, placement, items, count);
    assert.deepEqual(rendered.occurrences.map(o => o.item.id), expected, renderer);
    assert.deepEqual(ids(text(rendered.payload.toString('utf8'))), expected, renderer);
  }
});
