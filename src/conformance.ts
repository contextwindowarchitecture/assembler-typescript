// Runs the conformance cases (conformance/README.md, Running a case and Reporting results) and reports the run
// in the shape of schema/conformance_report.schema.json.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { assemble } from './assemble.js';
import { SnapshotRejectedError, UnsupportedComponentError } from './errors.js';
import { CONTRACT_SOURCE } from './generated/contract.js';
import { IMPLEMENTATION } from './implementation.js';
import { RENDERERS, REQUIRED_RENDERERS } from './renderers.js';
import { validateTrace } from './schemas.js';
import { compareStrings } from './strings.js';
import { REQUIRED_TOKENIZERS, TOKENIZERS } from './tokenizers.js';
import type { ConformanceReport } from './types.js';

type CaseRow = ConformanceReport['cases'][number];
type RejectionRow = NonNullable<ConformanceReport['rejections']>[number];

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
const ids = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir).sort(compareStrings) : []);
const rulesOf = (dir: string): string[] => (readJson(join(dir, 'case.json')) as { rules: string[] }).rules;
const describe = (error: unknown): string => (error instanceof Error ? `${error.name}: ${error.message}` : String(error));

type Component = 'tokenizer' | 'renderer';

/** The IDs of the tokenizers and renderers an implementation provides. */
export type Provided = Readonly<Record<Component, readonly string[]>>;

/** What this package provides: the own keys of TOKENIZERS, and RENDERERS. */
const PROVIDED: Provided = { tokenizer: Object.keys(TOKENIZERS), renderer: RENDERERS };

/** What every implementation provides: the bullets under Tokenizers and renderers before Optional. A test holds
 * REQUIRED_TOKENIZERS and REQUIRED_RENDERERS to those bullets. Any other ID is optional, listed under Optional or not. */
const REQUIRED: Provided = { tokenizer: REQUIRED_TOKENIZERS, renderer: REQUIRED_RENDERERS };

/**
 * The outcome Reporting results gives a run that needs a component the implementation does not provide, or
 * undefined when it provides every one the run needs. A case needs its snapshot's tokenizer and renderer; a
 * rejection snapshot needs only its renderer, since no snapshot check needs a tokenizer. An optional component it
 * lacks skips the run, whatever else it lacks. Otherwise a required one it lacks fails the run: a case that uses only
 * required components is never skipped. `detail` names the component. `provided` is this package's unless a test
 * makes an implementation lack one, which no published case can.
 */
export function componentOutcome(snapshot: unknown, needs: readonly Component[], provided: Provided = PROVIDED):
  { outcome: 'skipped' | 'failed'; detail: string } | undefined {
  const named = (snapshot ?? {}) as Partial<Record<Component, unknown>>;
  const missing = needs.flatMap(component => {
    const id = named[component];
    return typeof id === 'string' && !provided[component].includes(id) ? [{ component, id }] : [];
  });
  const optional = missing.find(({ component, id }) => !REQUIRED[component].includes(id));
  if (optional) return { outcome: 'skipped', detail: `${optional.component} ${optional.id} is not provided` };
  const [required] = missing;
  return required && { outcome: 'failed', detail: `${required.component} ${required.id} is required and not provided` };
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

/** A trace as Running a case compares it: without trace_id, timings and recovery.detail, which may differ (R-23).
 * recovery.detail is free text for people that no requirement defines. Every other member is compared. */
export const comparable = (trace: unknown): unknown => {
  const { trace_id: _id, timings: _timings, ...rest } = trace as Record<string, unknown>;
  if (rest['recovery'] !== null && typeof rest['recovery'] === 'object') {
    const { detail: _detail, ...recovery } = rest['recovery'] as Record<string, unknown>;
    rest['recovery'] = recovery;
  }
  return rest;
};

function runCase(dir: string): Pick<CaseRow, 'outcome' | 'detail'> {
  const snapshot = readJson(join(dir, 'snapshot.json'));
  const missing = componentOutcome(snapshot, ['tokenizer', 'renderer']);
  if (missing) return missing;
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

/** Every snapshot check but realizability runs before a renderer is needed, and none needs a tokenizer, so assemble()
 * rejects a rejection snapshot before resolving either component unless the check it breaks is the renderer's. It
 * gets that far only when the snapshot breaks no check it can run: the snapshot is skipped when it names an optional
 * renderer this implementation lacks, and fails otherwise, when that renderer is required or when only the tokenizer
 * is missing (Reporting results). */
function runRejection(dir: string): Pick<RejectionRow, 'outcome' | 'detail'> {
  const snapshot = readJson(join(dir, 'snapshot.json'));
  try {
    const { trace } = assemble(snapshot);
    return { outcome: 'failed', detail: trace.refused.bool ? `refused with ${String(trace.refused.reason)} instead of rejecting` : 'assembled a payload instead of rejecting' };
  } catch (error) {
    if (error instanceof SnapshotRejectedError) return { outcome: 'rejected' };
    if (error instanceof UnsupportedComponentError) return componentOutcome(snapshot, ['renderer']) ?? { outcome: 'failed', detail: describe(error) };
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
