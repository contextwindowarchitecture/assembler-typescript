// assemble(): a valid snapshot in; its payload bytes, or a refusal, and its trace out (R-17, R-21, R-23).
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { admit, type AdmittedItem } from './admission.js';
import { resolveConflicts } from './conflicts.js';
import { snapshotDigest } from './digest.js';
import { PublishedTokenizerIdError, SnapshotRejectedError, UnsupportedComponentError } from './errors.js';
import { fit, type Fitted } from './fitting.js';
import { capSources, dedupe, supersede } from './pruning.js';
import { RENDERERS, renderedBody, sha256 } from './renderers.js';
import { checkSnapshot } from './snapshot-checks.js';
import { PUBLISHED_TOKENIZERS, TOKENIZERS, type Tokenizer } from './tokenizers.js';
import type { CompressedRow, ExcludedRow, IncludedRow, Recovery, Snapshot, Trace } from './types.js';

export interface AssembleOptions {
  /** The trace's id. Defaults to a random UUID; trace ids may differ between runs (R-23). */
  traceId?: string;
  /**
   * Tokenizers to provide beside the published ones, keyed by the ID a snapshot names. No key may be the ID of a
   * published tokenizer, even one the snapshot does not name: assemble() throws PublishedTokenizerIdError (R-16).
   */
  tokenizers?: Readonly<Record<string, Tokenizer>>;
}

export interface Assembly {
  /** The rendered payload's UTF-8 bytes, or null when the assembly is refused (R-17). */
  payload: Uint8Array | null;
  trace: Trace;
}

type Refusal = 'required_slot_missing' | 'protected_slot_unplaced' | 'conflict_unresolved'
  | 'protected_content_over_budget' | 'slot_floor_over_budget' | 'evidence_required';

const EVIDENCE = ['evidence.knowledge', 'evidence.tool_results'] as const;

/**
 * Assembles a snapshot. Throws PublishedTokenizerIdError, before it checks the snapshot, when options.tokenizers
 * names a published tokenizer's ID (R-16); SnapshotRejectedError when the snapshot fails its schemas or the snapshot
 * checks (R-17); and UnsupportedComponentError when it names a tokenizer or renderer this implementation lacks.
 * None of them has a payload or a trace.
 */
export function assemble(value: unknown, options: AssembleOptions = {}): Assembly {
  // R-16: a trace that names a published tokenizer always means its published count, so the caller may not supply
  // one under a published ID, whether or not this snapshot names it.
  const supplied = options.tokenizers ?? {};
  const published = PUBLISHED_TOKENIZERS.filter(id => Object.hasOwn(supplied, id));
  if (published.length > 0) throw new PublishedTokenizerIdError(published);
  const problems = checkSnapshot(value);
  if (problems.length > 0) throw new SnapshotRejectedError(problems);
  const snapshot = value as Snapshot;
  const count = TOKENIZERS[snapshot.tokenizer] ?? options.tokenizers?.[snapshot.tokenizer];
  if (!count) throw new UnsupportedComponentError('tokenizer', snapshot.tokenizer);
  if (!RENDERERS.includes(snapshot.renderer)) throw new UnsupportedComponentError('renderer', snapshot.renderer);

  const policy = snapshot.route_policy;
  const timings: Record<string, number> = {};
  const timed = <T>(stage: string, run: () => T): T => {
    const start = performance.now();
    try { return run(); } finally { timings[stage] = performance.now() - start; }
  };

  const admission = timed('admission', () => admit(snapshot));
  const resolution = timed('conflicts', () => resolveConflicts(snapshot, admission.admitted));
  const named = new Set(snapshot.conflicts.flatMap(group => group.items));
  const exempt = (a: AdmittedItem): boolean => a.tier === 'protected' || named.has(a.item.id);
  const afterConflicts = admission.admitted.filter(a => !resolution.rows.some(row => row.item_id === a.item.id));
  const superseded = timed('supersession', () => supersede(policy, afterConflicts, exempt));
  const deduplicated = timed('deduplication', () => dedupe(policy, superseded.kept, exempt));
  const capped = timed('diversity', () => capSources(policy, deduplicated.kept, exempt));
  const survivors = capped.kept;

  const excluded: ExcludedRow[] = [...admission.producerRows, ...admission.rows, ...resolution.rows,
    ...superseded.rows, ...deduplicated.rows, ...capped.rows];
  const trace = (fields: Pick<Trace, 'result' | 'included' | 'compressed' | 'refused'> & { recovery?: Recovery }): Trace => ({
    trace_id: options.traceId ?? randomUUID(),
    profile: { id: snapshot.profile.id, version: snapshot.profile.version },
    budget: { ...snapshot.budget },
    result: fields.result,
    included: fields.included,
    compressed: fields.compressed,
    excluded,
    conflicts: resolution.conflicts,
    refused: fields.refused,
    context: {
      spec: snapshot.profile.spec,
      assembly_time: snapshot.assembly_time,
      route_policy_version: policy.version,
      tokenizer: snapshot.tokenizer,
      renderer: snapshot.renderer,
      snapshot_digest: snapshotDigest(snapshot),
    },
    defaults_filled: admission.defaultsFilled,
    ...(fields.recovery ? { recovery: fields.recovery } : {}),
    timings,
  });
  const refuse = (reason: Refusal, recovery?: Recovery): Assembly => ({
    payload: null,
    trace: trace({ result: null, included: [], compressed: [], refused: { bool: true, reason }, ...(recovery ? { recovery } : {}) }),
  });

  // Refusal checks before fitting, in contract/reasons.json order (R-21).
  const required = ['governance.instructions', 'interaction.query', ...(policy.parser === true ? ['governance.output_contract'] : [])];
  if (required.some(slot => !admission.admitted.some(a => a.item.slot === slot))) return refuse('required_slot_missing');
  const placed = new Set<string>(snapshot.profile.placement.map(p => p.slot));
  if (survivors.some(a => a.tier === 'protected' && !placed.has(a.item.slot))) return refuse('protected_slot_unplaced');
  if (resolution.refusing.length > 0) {
    return refuse('conflict_unresolved', resolution.refusing.every(action => action === 'request_context') ? { action: 'request_context' } : undefined);
  }

  const fitted = timed('fitting', () => fit(snapshot, survivors.filter(a => placed.has(a.item.slot)), resolution.marks, count));
  excluded.push(...fitted.rows);
  if (fitted.refusal) return refuse(fitted.refusal);

  // R-12: a route that requires evidence refuses when too little survived admission and fitting.
  if (policy.requires_evidence === true) {
    const inSlot = (slot: string) => [...fitted.included.values()].filter(c => c.admitted.item.slot === slot).length;
    const short = EVIDENCE.every(slot => inSlot(slot) === 0) ||
      EVIDENCE.some(slot => inSlot(slot) < (policy.slots?.[slot]?.min_included ?? 0));
    if (short) return refuse('evidence_required', { action: evidenceRecovery(fitted) });
  }

  const { payload, tokens, occurrences } = fitted.rendered;
  const wrapOf = (index: number) => snapshot.profile.placement[index]!.wrap;
  const included: IncludedRow[] = occurrences.map(o => {
    const { item } = fitted.included.get(o.item.id)!.admitted;
    return { slot: item.slot, item_id: item.id, tokens: o.tokens, source_version: item.source_version, eligibility: item.eligibility };
  });
  const compressed: CompressedRow[] = occurrences.flatMap(o => {
    const current = fitted.included.get(o.item.id)!;
    if (!current.variant) return [];
    return [{ slot: o.item.slot, item_id: o.item.id, from: count(renderedBody(wrapOf(o.placement), current.admitted.item.body)),
      to: o.tokens, method: current.variant.method, variant_id: current.variant.id }];
  });
  return {
    payload: new Uint8Array(payload),
    trace: trace({ result: { input_tokens: tokens, hash: sha256(payload) }, included, compressed, refused: { bool: false, reason: null } }),
  };
}

/** R-12's recovery: request_context when budget omitted no evidence, precompute_summary when an omitted evidence
 * item had no variants, retrieve_narrower when every omitted one had variants that did not fit. */
function evidenceRecovery(fitted: Fitted): Recovery['action'] {
  const omitted = fitted.omitted.filter(a => (EVIDENCE as readonly string[]).includes(a.item.slot));
  if (omitted.length === 0) return 'request_context';
  return omitted.some(a => a.item.variants.length === 0) ? 'precompute_summary' : 'retrieve_narrower';
}
