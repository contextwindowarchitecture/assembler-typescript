import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RENDERERS } from '../src/renderers.js';
import { PUBLISHED_TOKENIZERS, TOKENIZERS } from '../src/tokenizers.js';
import { CONFORMANCE } from './cases.js';

test('the published tokenizers are the ones conformance/README.md lists', () => {
  // Tokenizers and renderers lists one bullet per published component: a tokenizer's bullet says it "counts" a text,
  // and every other bullet is a renderer's. A re-vendor that publishes a tokenizer fails here until
  // PUBLISHED_TOKENIZERS names it. Every implementation provides these bullets, and the conformance runner reads both
  // lists as the required components (Reporting results).
  const readme = readFileSync(join(CONFORMANCE, 'README.md'), 'utf8');
  const section = readme.split(/^## /m).find(part => part.startsWith('Tokenizers and renderers\n'))!;
  const bullets = [...section.matchAll(/^- `([^`]+)` (\w+) /gm)].map(([, id, verb]) => ({ id: id!, verb: verb! }));
  assert.deepEqual(bullets.filter(b => b.verb === 'counts').map(b => b.id), PUBLISHED_TOKENIZERS);
  assert.deepEqual(bullets.filter(b => b.verb !== 'counts').map(b => b.id), RENDERERS);
});

test('fixture-whitespace/v1 counts runs outside the ECMAScript whitespace set', () => {
  const count = TOKENIZERS['fixture-whitespace/v1']!;
  assert.equal(count(''), 0);
  assert.equal(count('  a  b c﻿d　'), 4);
  assert.equal(count('a\u001cb'), 1); // U+001C is not whitespace in ECMAScript
  assert.equal(count('a​b'), 1); // nor is U+200B
});

test('estimate-utf8/v1 counts UTF-8 bytes divided by 4, rounded up', () => {
  const count = TOKENIZERS['estimate-utf8/v1']!;
  assert.equal(count(''), 0);
  assert.equal(count('abcd'), 1);
  assert.equal(count('abcde'), 2);
  assert.equal(count('é'), 1);
  assert.equal(count('日本'), 2); // 6 bytes
  assert.equal(count('\u{1F600}\u{1F600}\u{1F600}'), 3); // 12 bytes
});
