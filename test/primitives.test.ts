import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize, compareStrings, isBlank } from '../src/strings.js';
import { compareInstants, parseInstant } from '../src/instant.js';
import { snapshotDigest } from '../src/digest.js';
import { loadCases } from './cases.js';

test('strings order by UTF-16 code units, not code points (conformance/README.md, Ordering)', () => {
  assert.ok(compareStrings('\u{1F600}', 'ｚ') < 0);
  assert.ok(compareStrings('a', 'ab') < 0);
  assert.equal(compareStrings('x', 'x'), 0);
});

test('a blank string holds only ECMAScript whitespace and line terminators (Blank strings)', () => {
  for (const blank of ['', ' ', '\t\n\v\f\r', '        　﻿']) {
    assert.equal(isBlank(blank), true, JSON.stringify(blank));
  }
  for (const text of ['\u001c', '\u001f', '​', 'x', ' x ']) assert.equal(isBlank(text), false, JSON.stringify(text));
});

test('RFC 8785 serializes with sorted member names and ECMAScript numbers', () => {
  assert.equal(canonicalize({ b: [1, 2.5, -0, 1e21, 1e-7], a: 'é "', '\u{1F600}': null, 'ｚ': true }),
    '{"a":"é \\"","b":[1,2.5,0,1e+21,1e-7],"\u{1F600}":null,"ｚ":true}');
});

test('instants compare at full stated precision, across offsets (R-2)', () => {
  assert.equal(compareInstants('2026-09-22T12:00:00.0005Z', '2026-09-22T12:00:00Z'), 1);
  assert.equal(compareInstants('2026-09-22T11:58:00Z', '2026-09-22T11:58:00.000Z'), 0);
  assert.equal(compareInstants('2026-09-22T13:58:00+02:00', '2026-09-22t11:58:00z'), 0);
  assert.equal(compareInstants('2026-09-22T12:00:05.000001Z', '2026-09-22T12:00:05Z'), 1);
  assert.equal(compareInstants('0001-01-01T00:00:00Z', '0099-01-01T00:00:00Z'), -1);
  assert.equal(compareInstants('2026-09-22T00:00:00-23:59', '2026-09-22T23:58:59Z'), 1);
});

test('an instant shifts by whole seconds without losing its fraction', () => {
  const later = parseInstant('2026-09-22T12:00:00.123456789Z').plusSeconds(5);
  assert.equal(later.compare(parseInstant('2026-09-22T12:00:05.123456789Z')), 0);
  assert.equal(later.compare(parseInstant('2026-09-22T12:00:05.12345679Z')), -1);
});

test('snapshot_digest matches every case: RFC 8785 of the normalized snapshot (Snapshot digest)', () => {
  for (const c of loadCases()) {
    const expected = (c.trace['context'] as { snapshot_digest: string }).snapshot_digest;
    assert.equal(snapshotDigest(c.snapshot as never), expected, c.id);
  }
});
