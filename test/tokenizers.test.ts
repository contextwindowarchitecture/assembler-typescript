import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PUBLISHED_RENDERERS, RENDERERS, REQUIRED_RENDERERS } from '../src/renderers.js';
import { PUBLISHED_TOKENIZERS, REQUIRED_TOKENIZERS, TOKENIZERS } from '../src/tokenizers.js';
import { CONFORMANCE } from './cases.js';

test('the published and required tokenizers and renderers are the ones conformance/README.md lists', () => {
  // Tokenizers and renderers lists one bullet per published component: a tokenizer's bullet says it "counts" a text,
  // and every other bullet is a renderer's. Every implementation provides the bullets before ### Optional, and the
  // conformance runner reads them as the required components (Reporting results). The bullets under it are optional,
  // and still published: an application's own component may take none of their IDs (R-16). A re-vendor that
  // publishes a component fails here until these lists name it.
  const readme = readFileSync(join(CONFORMANCE, 'README.md'), 'utf8');
  const section = readme.split(/^## /m).find(part => part.startsWith('Tokenizers and renderers\n'))!;
  const [required, optional] = section.split(/^### Optional\n/m);
  assert.ok(required !== undefined && optional !== undefined, 'the section has an Optional list');
  const bullets = (text: string) => [...text.matchAll(/^- `([^`]+)` (\w+) /gm)].map(([, id, verb]) => ({ id: id!, verb: verb! }));
  const tokenizers = (text: string) => bullets(text).filter(b => b.verb === 'counts').map(b => b.id);
  const renderers = (text: string) => bullets(text).filter(b => b.verb !== 'counts').map(b => b.id);
  assert.deepEqual(tokenizers(section), PUBLISHED_TOKENIZERS);
  assert.deepEqual(renderers(section), PUBLISHED_RENDERERS);
  assert.deepEqual(tokenizers(required), REQUIRED_TOKENIZERS);
  assert.deepEqual(renderers(required), REQUIRED_RENDERERS);
});

test('the package provides every required component, and only published ones (R-16)', () => {
  // A trace that names a published component always means its published behaviour. The package takes no renderer
  // of the application's own, so R-16 holds for renderers when it renders only with published ones.
  for (const id of REQUIRED_TOKENIZERS) assert.ok(Object.hasOwn(TOKENIZERS, id), id);
  for (const id of Object.keys(TOKENIZERS)) assert.ok(PUBLISHED_TOKENIZERS.includes(id), id);
  for (const id of REQUIRED_RENDERERS) assert.ok(RENDERERS.includes(id), id);
  for (const id of RENDERERS) assert.ok(PUBLISHED_RENDERERS.includes(id), id);
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
