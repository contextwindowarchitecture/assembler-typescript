// Admission (R-1, R-2, R-3, R-8, R-9, R-10, R-13, R-15, R-16, R-18, R-20): each candidate is admitted or excluded
// with the earliest applicable code in contract/reasons.json order (R-21).
import { compareSerialized, usableId } from './digest.js';
import { POLICY_FIELDS, isSlot, itemTier, reasonRank, slotDefaults, slotTier, tierRank, type FilledItem } from './contract.js';
import { parseInstant, type Instant } from './instant.js';
import { validateItem } from './schemas.js';
import { compareStrings } from './strings.js';
import type { ContextItem, DefaultFilledRow, ExcludedRow, Snapshot, Tier } from './types.js';

export interface AdmittedItem {
  item: FilledItem;
  /** The authenticated producer of the item's batch (R-15). */
  producer: string;
  tier: Tier;
}

export interface Admission {
  admitted: AdmittedItem[];
  /** Producer-stage rows, as reported, from every batch (R-9). */
  producerRows: ExcludedRow[];
  /** Admission rows, ordered by producer id, recorded item_id, then the candidate's RFC 8785 bytes. */
  rows: ExcludedRow[];
  defaultsFilled: DefaultFilledRow[];
}

/** Schema errors as reason codes: missing_field names the item's own fields, and anything else is structural. */
function schemaCodes(): string[] {
  return (validateItem.errors ?? []).filter(error => error.keyword !== 'if').map(error => {
    if (error.keyword === 'required' && error.instancePath === '') return `missing_field:${String(error.params['missingProperty'])}`;
    if (error.keyword === 'enum' && error.instancePath === '/slot') return 'unknown_slot';
    if (error.keyword === 'enum' && error.instancePath === '/authority') return 'unknown_authority';
    return 'invalid_structure';
  });
}

/** The earliest code by reasons.json order; among missing_field codes, the alphabetically first field (R-21). */
const earliest = (codes: string[]): string | undefined =>
  [...codes].sort((a, b) => reasonRank(a) - reasonRank(b) || compareStrings(a, b))[0];

/** Fills omitted policy fields from the route's default_overrides, then the slot defaults (R-3). */
function fillDefaults(item: ContextItem, snapshot: Snapshot): { item: FilledItem; filled: string[] } {
  const overrides = (snapshot.route_policy.default_overrides?.[item.slot] ?? {}) as Record<string, unknown>;
  const defaults = slotDefaults(item.slot) as Record<string, unknown>;
  const filled = POLICY_FIELDS.filter(field => item[field] === undefined);
  const values = Object.fromEntries(filled.map(field =>
    [field, structuredClone(Object.hasOwn(overrides, field) ? overrides[field] : defaults[field])]));
  return { item: { ...values, ...item } as FilledItem, filled };
}

export function admit(snapshot: Snapshot): Admission {
  const policy = snapshot.route_policy;
  const now = parseInstant(snapshot.assembly_time);
  const skew = policy.clock_skew_seconds ?? 0;
  const placed = new Set(snapshot.profile.placement.map(p => p.slot));

  // duplicate_item_id: every candidate's non-blank string id and every producer exclusion, in any batch.
  const uses = new Map<string, number>();
  for (const batch of snapshot.batches) {
    for (const id of [...batch.items.map(usableId), ...batch.excluded.map(row => row.item_id)]) {
      if (id !== undefined) uses.set(id, (uses.get(id) ?? 0) + 1);
    }
  }

  const admitted: AdmittedItem[] = [];
  const rejected: { producer: string; row: ExcludedRow; raw: unknown }[] = [];
  const defaultsFilled: DefaultFilledRow[] = [];
  for (const batch of snapshot.batches) {
    const producer = batch.producer;
    const route = policy.producers[producer.id];
    const authenticated = route !== undefined && route.kind === producer.kind;
    let invalid = 0;
    for (const raw of batch.items) {
      const id = usableId(raw) ?? `${producer.id}#invalid-${invalid++}`;
      const rawSlot = (raw as { slot?: unknown }).slot;
      const codes: string[] = authenticated ? [] : ['producer_not_authenticated'];
      let filledItem: FilledItem | undefined;
      if (!validateItem(raw)) {
        codes.push(...schemaCodes());
      } else {
        const { item, filled } = fillDefaults(raw as ContextItem, snapshot);
        filledItem = item;
        if (authenticated) defaultsFilled.push(...filled.map(field => ({ item_id: id, field }) as DefaultFilledRow));
        if ((uses.get(id) ?? 0) > 1) codes.push('duplicate_item_id');
        if (route) codes.push(...itemCodes(item, producer.id, route, snapshot, now, skew, placed));
      }
      const code = earliest(codes);
      if (code === undefined && filledItem) {
        admitted.push({ item: filledItem, producer: producer.id, tier: itemTier(filledItem, policy) });
      } else {
        rejected.push({ producer: producer.id, raw, row: { item_id: id, reason: code!, stage: 'assembler', ...(isSlot(rawSlot) ? { slot: rawSlot } : {}) } });
      }
    }
  }
  rejected.sort((a, b) => compareStrings(a.producer, b.producer) || compareStrings(a.row.item_id, b.row.item_id) || compareSerialized(a.raw, b.raw));

  const producerRows = snapshot.batches
    .flatMap(batch => batch.excluded.map(row => ({ producer: batch.producer.id, row })))
    .sort((a, b) => compareStrings(a.producer, b.producer) || compareStrings(a.row.item_id, b.row.item_id) || compareSerialized(a.row, b.row))
    .map(({ row }) => ({ ...row }) as ExcludedRow);

  const fieldRank = (field: string): number => POLICY_FIELDS.indexOf(field as never);
  defaultsFilled.sort((a, b) => compareStrings(a.item_id, b.item_id) || fieldRank(a.field) - fieldRank(b.field));
  return { admitted, producerRows, rows: rejected.map(r => r.row), defaultsFilled };
}

type RouteProducer = NonNullable<Snapshot['route_policy']['producers'][string]>;

const EVIDENCE = ['evidence.knowledge', 'evidence.tool_results'] as const;
// A producer's kind limits its slots, whatever the route lists: retrieval and mcp output is evidence (R-13, R-15), and a
// memory producer sends only memory (R-14). A tool specification an mcp producer sends to governance.capabilities falls
// to the capability check, which excludes it with capability_not_allowed.
const KIND_SLOTS: Readonly<Record<string, readonly string[]>> = {
  retrieval: EVIDENCE, memory: ['interaction.memory'], mcp: [...EVIDENCE, 'governance.capabilities'],
};
// R-1: only these slots may carry untrusted instead of their own role. Not governance or knowledge, not state, which the
// application writes (R-8), and not the query, which always carries user.
const UNTRUSTED_ALLOWED: ReadonlySet<string> = new Set(['evidence.tool_results', 'interaction.memory', 'interaction.history']);

/** The admission codes that apply to a schema-valid item from an authenticated producer, in any order. */
function itemCodes(item: FilledItem, producer: string, route: RouteProducer, snapshot: Snapshot, now: Instant,
  skew: number, placed: Set<string>): string[] {
  const policy = snapshot.route_policy;
  const defaults = slotDefaults(item.slot);
  const rules = policy.slots?.[item.slot] ?? {};
  const governance = item.slot.startsWith('governance.');
  const codes: string[] = [];

  // R-15, R-8, R-13, R-14: the route lists the slot for this producer, state comes only from producers of kind state,
  // and the producer's kind allows the slot.
  const kindSlots = KIND_SLOTS[route.kind];
  if (!route.slots.includes(item.slot) || (item.slot.startsWith('state.') && route.kind !== 'state') ||
    (kindSlots !== undefined && !kindSlots.includes(item.slot))) {
    codes.push('producer_slot_not_allowed');
  }
  // R-1: the slot's authority, or untrusted where the slot allows it; model turns in history (lineage generated) must.
  const untrustedAllowed = UNTRUSTED_ALLOWED.has(item.slot);
  if (item.authority !== defaults.authority && !(untrustedAllowed && item.authority === 'untrusted')) codes.push('authority_not_allowed');
  if (item.slot === 'interaction.history' && item.lineage === 'generated' && item.authority !== 'untrusted') codes.push('authority_not_allowed');
  // R-15: only the authenticated capability policy grants capabilities on the allow-list.
  if (item.slot === 'governance.capabilities') {
    const grant = snapshot.capabilities;
    if (!grant || grant.policy_producer !== producer || !grant.allowed_ids.includes(item.id)) codes.push('capability_not_allowed');
  }
  // R-10: governance is verified with no injection risk; untrusted material stays marked unless the route
  // verified the MCP server that produced it.
  if (governance && (item.trust !== 'verified' || item.injection_risk !== 'none')) codes.push('untrusted_in_governance');
  const verifiedMcp = route.kind === 'mcp' && route.verified === true;
  if (defaults.injection_risk === 'untrusted_content' && item.injection_risk !== 'untrusted_content' && !verifiedMcp) {
    codes.push('untrusted_content_unmarked');
  }
  // R-16: no item lowers a slot protected by default, and none claims a tier above its slot's effective tier.
  if (defaults.tier === 'protected' && item.tier !== undefined && item.tier !== 'protected') codes.push('protected_tier_changed');
  if (item.tier !== undefined && tierRank(item.tier) > tierRank(slotTier(item.slot, policy))) codes.push('tier_upgrade_not_allowed');
  // R-18: variant ids are distinct and differ from the item's.
  const variantIds = item.variants.map(v => v.id);
  if (new Set(variantIds).size !== variantIds.length || variantIds.includes(item.id)) codes.push('duplicate_variant_id');
  // R-9, R-2: lifetime against the explicit assembly_time; freshness may lead it by clock_skew_seconds.
  if (item.revoked_by !== undefined) codes.push('revoked');
  if (item.expires !== undefined && parseInstant(item.expires).compare(now) <= 0) codes.push('expired');
  const freshness = parseInstant(item.freshness);
  if (freshness.compare(now.plusSeconds(skew)) > 0) codes.push('future_freshness');
  // R-8, R-3: max_age_seconds; an item exactly that old is admitted.
  const tooOld = rules.max_age_seconds !== undefined && freshness.compare(now.plusSeconds(-rules.max_age_seconds)) < 0;
  if (tooOld && item.slot.startsWith('state.')) codes.push('stale_state');
  if (rules.source_prefix !== undefined && !item.source.startsWith(rules.source_prefix)) codes.push('source_invalid');
  // R-2: every scope key the item carries equals the request's, and it carries every key the slot requires.
  const scope = (item.scope ?? {}) as Record<string, string>;
  const request = snapshot.scope as Record<string, string | undefined>;
  if (Object.entries(scope).some(([key, value]) => request[key] !== value) ||
    (rules.required_scope ?? []).some(key => scope[key] === undefined)) codes.push('out_of_scope');
  // R-13: the rerank threshold; an unscored item cannot clear it.
  if (rules.min_relevance !== undefined && (item.relevance === undefined || item.relevance < rules.min_relevance)) codes.push('below_threshold');
  if (tooOld && !item.slot.startsWith('state.')) codes.push('not_eligible');
  // R-20: placement is the last check, and a protected item is admitted wherever it goes.
  if (!placed.has(item.slot) && itemTier(item, policy) !== 'protected') codes.push('slot_unplaced');
  return codes;
}
