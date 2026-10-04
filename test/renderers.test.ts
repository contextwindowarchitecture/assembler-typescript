import test from 'node:test';
import assert from 'node:assert/strict';
import { countPayload, realizationProblems, render, type RenderItem } from '../src/renderers.js';
import { canonicalize } from '../src/strings.js';
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
    'cwa-message-blocks/v1': payload =>
      (JSON.parse(payload) as { messages: { content: { text: string }[] }[] }).messages[0]!.content.map(e => e.text).join(''),
  };
  for (const [renderer, text] of Object.entries(texts)) {
    const rendered = render(renderer, placement, items, count);
    assert.deepEqual(rendered.occurrences.map(o => o.item.id), expected, renderer);
    assert.deepEqual(ids(text(rendered.payload.toString('utf8'))), expected, renderer);
  }
});

type Entry = { id: string; text: string; conflict?: string };
type Request<Content> = { system: Entry[]; tools: Entry[]; messages: { role: string; content: Content }[] };

/** A profile with every kind of wrap, and items that show escaping, both speakers, history order and conflict marks. */
const BLOCKS_PLACEMENT: Profile['placement'] = [
  { slot: 'governance.instructions', wrap: 'system' },
  { slot: 'governance.capabilities', wrap: 'tools' },
  { slot: 'evidence.knowledge', wrap: 'xml:evidence' },
  { slot: 'interaction.history', wrap: 'xml:history' },
  { slot: 'interaction.query', wrap: 'xml:query' },
];
const BLOCKS_ITEMS: RenderItem[] = [
  { id: 'policy:a', slot: 'governance.instructions', body: 'Cite every source.', lineage: 'verified', freshness: FRESHNESS, conflict: 'g-cite' },
  { id: 'policy:b', slot: 'governance.instructions', body: 'Be brief & <exact>.', lineage: 'verified', freshness: FRESHNESS },
  { id: 'cap:x', slot: 'governance.capabilities', body: '{"name": "x"}', lineage: 'verified', freshness: FRESHNESS },
  { id: 'kb:a', slot: 'evidence.knowledge', body: 'Refunds take <5> days & more.', lineage: 'retrieved', freshness: FRESHNESS, conflict: 'g"kb' },
  { id: 'kb:b', slot: 'evidence.knowledge', body: 'Pro plans refund in full.', lineage: 'retrieved', freshness: FRESHNESS },
  { id: 'turn:2', slot: 'interaction.history', body: 'Which order?', lineage: 'generated', freshness: '2026-09-22T11:47:00Z' },
  { id: 'turn:10', slot: 'interaction.history', body: 'I bought Pro.', lineage: 'user', freshness: '2026-09-22T11:48:00Z' },
  { id: 'turn:11', slot: 'interaction.query', body: 'Can I refund it?', lineage: 'user', freshness: FRESHNESS },
];

test("cwa-message-blocks/v1 renders cwa-messages/v1's request with one user message entry per xml: occurrence (R-7, R-11)", () => {
  // conformance/README.md, Tokenizers and renderers, Optional: system and tools are cwa-messages/v1's; the one user
  // message's content is an array of {id, text} entries, each text that occurrence as cwa-messages/v1 writes it, so
  // the texts joined in order are cwa-messages/v1's content. A surfaced member's entry also names its group.
  const blocks = render('cwa-message-blocks/v1', BLOCKS_PLACEMENT, BLOCKS_ITEMS, count);
  const messages = render('cwa-messages/v1', BLOCKS_PLACEMENT, BLOCKS_ITEMS, count);
  const payload = blocks.payload.toString('utf8');
  const request = JSON.parse(payload) as Request<Entry[]>;
  const flat = JSON.parse(messages.payload.toString('utf8')) as Request<string>;
  assert.equal(payload, canonicalize(request), 'the payload is RFC 8785');
  assert.deepEqual(request.system, flat.system);
  assert.deepEqual(request.tools, flat.tools);
  assert.deepEqual(request.messages.map(m => m.role), ['user']);
  const content = request.messages[0]!.content;
  assert.deepEqual(content.map(e => e.id), ['kb:a', 'kb:b', 'turn:2', 'turn:10', 'turn:11']);
  assert.equal(content.map(e => e.text).join(''), flat.messages[0]!.content);
  assert.deepEqual(content[0], { conflict: 'g"kb', id: 'kb:a',
    text: '<evidence id="kb:a" conflict="g&quot;kb">\nRefunds take &lt;5&gt; days &amp; more.\n</evidence>\n' });
  assert.deepEqual(content[1], { id: 'kb:b', text: '<evidence id="kb:b">\nPro plans refund in full.\n</evidence>\n' });
  assert.deepEqual(content[2], { id: 'turn:2', text: '<history id="turn:2" speaker="assistant">\nWhich order?\n</history>\n' });
  assert.deepEqual(content[3], { id: 'turn:10', text: '<history id="turn:10" speaker="user">\nI bought Pro.\n</history>\n' });
  assert.deepEqual(content[4], { id: 'turn:11', text: '<query id="turn:11">\nCan I refund it?\n</query>\n' });
  // Per-item tokens count the rendered body, as in cwa-messages/v1.
  assert.deepEqual(blocks.occurrences.map(o => [o.item.id, o.placement, o.tokens]), messages.occurrences.map(o => [o.item.id, o.placement, o.tokens]));
});

test('cwa-message-blocks/v1 counts every system, tools and message entry text separately, and fitting uses that count (R-16)', () => {
  // estimate-utf8/v1 rounds each text up, so the entries' sum exceeds cwa-messages/v1's count of the joined content.
  const estimate = TOKENIZERS['estimate-utf8/v1']!;
  const blocks = render('cwa-message-blocks/v1', BLOCKS_PLACEMENT, BLOCKS_ITEMS, estimate);
  const request = JSON.parse(blocks.payload.toString('utf8')) as Request<Entry[]>;
  const entries = [...request.system, ...request.tools, ...request.messages[0]!.content];
  assert.equal(entries.length, 8);
  assert.equal(blocks.tokens, entries.reduce((sum, e) => sum + estimate(e.text), 0));
  assert.ok(blocks.tokens > render('cwa-messages/v1', BLOCKS_PLACEMENT, BLOCKS_ITEMS, estimate).tokens);
  assert.equal(countPayload('cwa-message-blocks/v1', BLOCKS_PLACEMENT, BLOCKS_ITEMS, estimate), blocks.tokens);
});

test('cwa-message-blocks/v1 realizes exactly the profiles cwa-messages/v1 realizes (R-7, R-20)', () => {
  const placements: Profile['placement'][] = [
    BLOCKS_PLACEMENT,
    [{ slot: 'interaction.query', wrap: 'xml:query' }, { slot: 'governance.instructions', wrap: 'system' }],
    [{ slot: 'evidence.knowledge', wrap: 'system' }],
    [{ slot: 'governance.instructions', wrap: 'tools' }],
    [{ slot: 'interaction.query', wrap: 'json' }],
    [{ slot: 'interaction.query', wrap: 'xml:1query' }],
  ];
  for (const [i, placement] of placements.entries()) {
    const problems = realizationProblems('cwa-message-blocks/v1', placement);
    assert.deepEqual(problems, realizationProblems('cwa-messages/v1', placement), String(i));
    assert.equal(problems.length, i === 0 ? 0 : 1, String(i));
  }
});
