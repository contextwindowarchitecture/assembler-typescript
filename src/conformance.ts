// Runs the conformance cases (conformance/README.md, Running a case and Reporting results) and reports the run
// in the shape of schema/conformance_report.schema.json.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { assemble } from './assemble.js';
import { SnapshotRejectedError, UnsupportedComponentError } from './errors.js';
import { CONTRACT_SOURCE } from './generated/contract.js';
import { IMPLEMENTATION } from './implementation.js';
import { RENDERERS } from './renderers.js';
import { validateTrace } from './schemas.js';
import { compareStrings } from './strings.js';
import { TOKENIZERS } from './tokenizers.js';
import type { ConformanceReport } from './types.js';

type CaseRow = ConformanceReport['cases'][number];
type RejectionRow = NonNullable<ConformanceReport['rejections']>[number];

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
const ids = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir).sort(compareStrings) : []);
const rulesOf = (dir: string): string[] => (readJson(join(dir, 'case.json')) as { rules: string[] }).rules;
const describe = (error: unknown): string => (error instanceof Error ? `${error.name}: ${error.message}` : String(error));

/** Why a snapshot would be skipped: it names a tokenizer or renderer this implementation does not provide. */
function unsupported(snapshot: unknown): string | undefined {
  const { tokenizer, renderer } = (snapshot ?? {}) as { tokenizer?: unknown; renderer?: unknown };
  if (typeof tokenizer === 'string' && !Object.hasOwn(TOKENIZERS, tokenizer)) return `tokenizer ${tokenizer} is not provided`;
  if (typeof renderer === 'string' && !RENDERERS.includes(renderer)) return `renderer ${renderer} is not provided`;
  return undefined;
}

/** The JSON Pointer of the first place two JSON values differ, with both values; undefined when they are equal. */
export function firstDifference(expected: unknown, actual: unknown, path = ''): string | undefined {
  const show = (value: unknown) => (value === undefined ? 'nothing' : JSON.stringify(value));
  if (expected === actual) return undefined;
  const both = (test: (v: unknown) => boolean) => test(expected) && test(actual);
  if (both(Array.isArray)) {
    const [e, a] = [expected as unknown[], actual as unknown[]];
    for (let i = 0; i < Math.max(e.length, a.length); i++) {
      const found = firstDifference(e[i], a[i], `${path}/${i}`);
      if (found) return found;
    }
    return undefined;
  }
  if (both(v => v !== null && typeof v === 'object' && !Array.isArray(v))) {
    const [e, a] = [expected as Record<string, unknown>, actual as Record<string, unknown>];
    for (const key of [...new Set([...Object.keys(e), ...Object.keys(a)])].sort(compareStrings)) {
      const found = firstDifference(e[key], a[key], `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`);
      if (found) return found;
    }
    return undefined;
  }
  return `${path || '/'}: expected ${show(expected)}, got ${show(actual)}`;
}

/** Trace ids and timings may differ between runs (R-23); every other member is compared. */
const comparable = (trace: unknown): unknown => {
  const { trace_id: _id, timings: _timings, ...rest } = trace as Record<string, unknown>;
  return rest;
};

function runCase(dir: string): Pick<CaseRow, 'outcome' | 'detail'> {
  const snapshot = readJson(join(dir, 'snapshot.json'));
  const skip = unsupported(snapshot);
  if (skip) return { outcome: 'skipped', detail: skip };
  const payloadPath = join(dir, 'expected.payload.txt');
  const expectedPayload = existsSync(payloadPath) ? readFileSync(payloadPath) : null;
  let result;
  try {
    result = assemble(snapshot);
  } catch (error) {
    return { outcome: 'failed', detail: describe(error) };
  }
  if (!validateTrace(result.trace)) {
    return { outcome: 'failed', detail: `the trace fails trace.schema.json: ${JSON.stringify(validateTrace.errors)}` };
  }
  if (expectedPayload === null && result.payload !== null) return { outcome: 'failed', detail: 'rendered a payload where the case expects a refusal' };
  if (expectedPayload !== null && result.payload === null) {
    return { outcome: 'failed', detail: `refused with ${String(result.trace.refused.reason)} where the case expects a payload` };
  }
  if (expectedPayload !== null && !expectedPayload.equals(result.payload!)) return { outcome: 'failed', detail: 'the payload bytes differ from expected.payload.txt' };
  const difference = firstDifference(comparable(readJson(join(dir, 'expected.trace.json'))), comparable(result.trace));
  return difference ? { outcome: 'failed', detail: `the trace differs at ${difference}` } : { outcome: 'passed' };
}

function runRejection(dir: string): Pick<RejectionRow, 'outcome' | 'detail'> {
  const snapshot = readJson(join(dir, 'snapshot.json'));
  const skip = unsupported(snapshot);
  if (skip) return { outcome: 'skipped', detail: skip };
  try {
    const { trace } = assemble(snapshot);
    return { outcome: 'failed', detail: trace.refused.bool ? `refused with ${String(trace.refused.reason)} instead of rejecting` : 'assembled a payload instead of rejecting' };
  } catch (error) {
    if (error instanceof SnapshotRejectedError) return { outcome: 'rejected' };
    if (error instanceof UnsupportedComponentError) return { outcome: 'skipped', detail: error.message };
    return { outcome: 'failed', detail: describe(error) };
  }
}

/** Runs every case under `<dir>/cases` and every rejection under `<dir>/rejections`, in id order. */
export function runConformance(dir: string): ConformanceReport {
  return {
    implementation: { ...IMPLEMENTATION },
    contract: { ...CONTRACT_SOURCE },
    cases: ids(join(dir, 'cases')).map(id => ({ id, rules: rulesOf(join(dir, 'cases', id)), ...runCase(join(dir, 'cases', id)) })),
    rejections: ids(join(dir, 'rejections')).map(id => ({ id, rules: rulesOf(join(dir, 'rejections', id)), ...runRejection(join(dir, 'rejections', id)) })),
  };
}
