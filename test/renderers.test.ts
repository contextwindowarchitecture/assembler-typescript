import test from 'node:test';
import assert from 'node:assert/strict';
import { render, type RenderItem } from '../src/renderers.js';
import { TOKENIZERS } from '../src/tokenizers.js';
import type { Profile } from '../src/types.js';

const count = TOKENIZERS['fixture-whitespace/v1']!;

test('cwa-messages/v1 marks a surfaced member in its system or tools text, and only the payload counts the mark (R-11)', () => {
  // conformance/README.md, Tokenizers and renderers: the model receives each entry's text and nothing else, so the
  // mark is in the text; the group id is escaped as fixture-xml/v1 escapes attribute values, the body is not.
  const placement: Profile['placement'] = [
    { slot: 'governance.instructions', wrap: 'system' },
    { slot: 'governance.capabilities', wrap: 'tools' },
    { slot: 'interaction.query', wrap: 'xml:query' },
  ];
  const items: RenderItem[] = [
    { id: 'policy:a', slot: 'governance.instructions', body: 'Cite <every> source & quote.', lineage: 'verified', conflict: 'g"<&>' },
    { id: 'policy:b', slot: 'governance.instructions', body: 'Be brief.', lineage: 'verified' },
    { id: 'cap:x', slot: 'governance.capabilities', body: '{"name": "x"}', lineage: 'verified', conflict: 'g-tools' },
    { id: 'turn:1', slot: 'interaction.query', body: 'Hello?', lineage: 'user' },
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
