// Route-requested pruning after conflict resolution and before any refusal check: supersession (R-25),
// exact deduplication (R-24) and the source diversity cap (R-26). None excludes an exempt item: a protected one,
// or one a conflict group names, whatever the group's resolution.
import { parseInstant } from './instant.js';
import { byRank } from './rank.js';
import { WHITESPACE_RUN, compareStrings } from './strings.js';
import type { AdmittedItem } from './admission.js';
import type { ExcludedRow, RoutePolicy, Slot } from './types.js';

export interface Pruned {
  kept: AdmittedItem[];
  /** This stage's rows, ordered by item_id. */
  rows: ExcludedRow[];
}

type Exempt = (item: AdmittedItem) => boolean;

/** Groups the items of each slot whose rules satisfy `applies`, by a key within the slot. */
function groups(items: AdmittedItem[], applies: (slot: Slot) => boolean, key: (item: AdmittedItem) => string): AdmittedItem[][] {
  const map = new Map<string, AdmittedItem[]>();
  for (const item of items) {
    if (!applies(item.item.slot)) continue;
    const k = JSON.stringify([item.item.slot, key(item)]);
    map.set(k, [...(map.get(k) ?? []), item]);
  }
  return [...map.values()];
}

function finish(items: AdmittedItem[], rows: ExcludedRow[]): Pruned {
  const excluded = new Set(rows.map(row => row.item_id));
  return { kept: items.filter(item => !excluded.has(item.item.id)), rows: rows.sort((a, b) => compareStrings(a.item_id, b.item_id)) };
}

/** R-25: within a slot, a call is one authenticated producer's items with the same source; its latest are kept. */
export function supersede(policy: RoutePolicy, items: AdmittedItem[], exempt: Exempt): Pruned {
  const rows: ExcludedRow[] = [];
  for (const call of groups(items, slot => policy.slots?.[slot]?.supersede === 'source', i => JSON.stringify([i.producer, i.item.source]))) {
    const latest = call.filter(a => call.every(b => parseInstant(a.item.freshness).compare(parseInstant(b.item.freshness)) >= 0));
    const keeper = byRank(policy, latest)[0]!;
    for (const item of call) {
      if (latest.includes(item) || exempt(item)) continue;
      rows.push({ item_id: item.item.id, reason: 'superseded', stage: 'assembler', slot: item.item.slot, superseded_by: keeper.item.id });
    }
  }
  return finish(items, rows);
}

/** A body's deduplication key: whitespace runs collapsed to one space, and the ends trimmed. No normalization. */
export const dedupeKey = (body: string): string => body.replace(WHITESPACE_RUN, ' ').replace(/^ | $/g, '');

/** R-24: within a slot, items with equal keys keep their exempt members, or else their highest-ranked one. */
export function dedupe(policy: RoutePolicy, items: AdmittedItem[], exempt: Exempt): Pruned {
  const rows: ExcludedRow[] = [];
  for (const set of groups(items, slot => policy.slots?.[slot]?.dedupe === 'exact', i => dedupeKey(i.item.body))) {
    if (set.length < 2) continue;
    const ranked = byRank(policy, set);
    const exempted = ranked.filter(exempt);
    const kept = exempted.length > 0 ? exempted : [ranked[0]!];
    for (const item of ranked) {
      if (kept.includes(item)) continue;
      rows.push({ item_id: item.item.id, reason: 'duplicate_content', stage: 'assembler', slot: item.item.slot, duplicate_of: kept[0]!.item.id });
    }
  }
  return finish(items, rows);
}

/** R-26: within a slot, each producer and source keeps its exempt items, then its highest-ranked up to the cap. */
export function capSources(policy: RoutePolicy, items: AdmittedItem[], exempt: Exempt): Pruned {
  const rows: ExcludedRow[] = [];
  for (const source of groups(items, slot => policy.slots?.[slot]?.max_per_source !== undefined, i => JSON.stringify([i.producer, i.item.source]))) {
    const cap = policy.slots![source[0]!.item.slot]!.max_per_source!;
    let places = cap - source.filter(exempt).length;
    for (const item of byRank(policy, source.filter(i => !exempt(i)))) {
      if (places-- > 0) continue;
      rows.push({ item_id: item.item.id, reason: 'source_diversity_cap', stage: 'assembler', slot: item.item.slot });
    }
  }
  return finish(items, rows);
}
