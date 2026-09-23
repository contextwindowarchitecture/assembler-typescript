import test from 'node:test';
import assert from 'node:assert/strict';
import { TOKENIZERS } from '../src/tokenizers.js';

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
