import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runConformance } from '../src/conformance.js';
import { IMPLEMENTATION } from '../src/implementation.js';
import { validateReport } from '../src/schemas.js';
import { CONFORMANCE } from './cases.js';
import { ROOT } from './root.js';

const lock = JSON.parse(readFileSync(join(ROOT, 'vendor', 'cwa.lock.json'), 'utf8')) as { website_commit: string; dirty: boolean };
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { name: string; version: string };

test('the report passes every case and rejects every rejection snapshot, in the published format', () => {
  const report = runConformance(CONFORMANCE);
  assert.equal(validateReport(report), true, JSON.stringify(validateReport.errors));
  assert.deepEqual(report.implementation, { name: pkg.name, version: pkg.version, language: 'TypeScript' });
  assert.deepEqual(report.contract, { website_commit: lock.website_commit, dirty: lock.dirty });
  assert.equal(report.cases.length, 46);
  assert.deepEqual(report.cases.filter(c => c.outcome !== 'passed'), []);
  assert.equal(report.rejections?.length, 14);
  assert.deepEqual(report.rejections?.filter(r => r.outcome !== 'rejected'), []);
  const ids = report.cases.map(c => c.id);
  assert.deepEqual(ids, [...ids].sort());
  const fixture = report.cases.find(c => c.id === 'fixture-three-slot')!;
  assert.deepEqual(fixture.rules, ['R-9', 'R-21', 'R-22', 'R-23']);
});

test('the implementation named in reports is the package', () => {
  assert.deepEqual({ name: IMPLEMENTATION.name, version: IMPLEMENTATION.version }, { name: pkg.name, version: pkg.version });
});

test('the committed conformance-report.json is the current run', () => {
  const committed = JSON.parse(readFileSync(join(ROOT, 'conformance-report.json'), 'utf8')) as unknown;
  assert.deepEqual(committed, runConformance(CONFORMANCE));
});

/** A conformance directory holding copies of some cases and rejections, for tampering. */
function scratch(cases: string[], rejections: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'cwa-conformance-'));
  for (const id of cases) cpSync(join(CONFORMANCE, 'cases', id), join(dir, 'cases', id), { recursive: true });
  for (const id of rejections) cpSync(join(CONFORMANCE, 'rejections', id), join(dir, 'rejections', id), { recursive: true });
  return dir;
}

test('a case whose payload or trace differs fails, and the detail says where', () => {
  const dir = scratch(['fixture-three-slot', 'protected-over-budget', 'messages-render'], []);
  try {
    writeFileSync(join(dir, 'cases', 'fixture-three-slot', 'expected.payload.txt'), 'something else');
    const tracePath = join(dir, 'cases', 'protected-over-budget', 'expected.trace.json');
    const trace = JSON.parse(readFileSync(tracePath, 'utf8')) as { refused: { reason: string } };
    trace.refused.reason = 'slot_floor_over_budget';
    writeFileSync(tracePath, JSON.stringify(trace));
    const report = runConformance(dir);
    const outcome = (id: string) => report.cases.find(c => c.id === id)!;
    assert.equal(outcome('fixture-three-slot').outcome, 'failed');
    assert.match(outcome('fixture-three-slot').detail!, /payload/);
    assert.equal(outcome('protected-over-budget').outcome, 'failed');
    assert.match(outcome('protected-over-budget').detail!, /\/refused\/reason/);
    assert.equal(outcome('messages-render').outcome, 'passed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a case with an unknown tokenizer or renderer is skipped, and the detail names it', () => {
  const dir = scratch(['fixture-three-slot'], ['profile-route-mismatch']);
  try {
    for (const path of [join(dir, 'cases', 'fixture-three-slot', 'snapshot.json'), join(dir, 'rejections', 'profile-route-mismatch', 'snapshot.json')]) {
      const snapshot = JSON.parse(readFileSync(path, 'utf8')) as { renderer: string };
      snapshot.renderer = 'some-renderer/v1';
      writeFileSync(path, JSON.stringify(snapshot));
    }
    const report = runConformance(dir);
    assert.deepEqual(report.cases[0], { id: 'fixture-three-slot', rules: ['R-9', 'R-21', 'R-22', 'R-23'], outcome: 'skipped', detail: 'renderer some-renderer/v1 is not provided' });
    assert.equal(report.rejections![0]!.outcome, 'skipped');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a rejection snapshot that assembles fails, and the detail says what happened', () => {
  const dir = scratch([], ['profile-route-mismatch', 'schema-missing-budget']);
  try {
    const path = join(dir, 'rejections', 'profile-route-mismatch', 'snapshot.json');
    const snapshot = JSON.parse(readFileSync(path, 'utf8')) as { profile: { route: string } };
    snapshot.profile.route = 'contract-fixture';
    writeFileSync(path, JSON.stringify(snapshot));
    const report = runConformance(dir);
    assert.deepEqual(report.rejections!.map(r => r.outcome), ['failed', 'rejected']);
    assert.match(report.rejections![0]!.detail!, /assembled a payload/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
