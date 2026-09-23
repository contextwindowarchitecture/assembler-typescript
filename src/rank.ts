// A slot's rank (conformance/README.md, Fitting): its order_by keys, then id, with the first item ranked
// highest. Shedding takes slots by ascending priority, then name, and each slot's items from the lowest rank up.
import { parseInstant } from './instant.js';
import { compareStrings } from './strings.js';
import type { AdmittedItem } from './admission.js';
import type { RoutePolicy, Slot } from './types.js';

const DEFAULT_ORDER = ['-relevance', '-freshness'] as const;

/** Negative when a ranks above b in its slot. */
export function compareRank(policy: RoutePolicy, a: AdmittedItem, b: AdmittedItem): number {
  for (const key of policy.slots?.[a.item.slot]?.order_by ?? DEFAULT_ORDER) {
    let order = 0;
    if (key === '-relevance') {
      const [x, y] = [a.item.relevance, b.item.relevance];
      order = x === undefined ? (y === undefined ? 0 : 1) : y === undefined ? -1 : y - x;
    } else {
      const newer = parseInstant(b.item.freshness).compare(parseInstant(a.item.freshness));
      order = key === '-freshness' ? newer : -newer;
    }
    if (order !== 0) return order;
  }
  return compareStrings(a.item.id, b.item.id);
}

/** Items from the highest rank down. */
export const byRank = (policy: RoutePolicy, items: readonly AdmittedItem[]): AdmittedItem[] =>
  [...items].sort((a, b) => compareRank(policy, a, b));

/** Slots in shedding order: ascending priority (default 0), then name. */
export const shedSlots = (policy: RoutePolicy, slots: Iterable<Slot>): Slot[] =>
  [...new Set(slots)].sort((a, b) =>
    (policy.slots?.[a]?.priority ?? 0) - (policy.slots?.[b]?.priority ?? 0) || compareStrings(a, b));
