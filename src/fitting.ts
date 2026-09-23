// Fitting (R-16, R-17; conformance/README.md, Fitting): reduce the placed items until the payload fits.
// Every reduction is decided per item, and every fit test renders and counts the whole payload.
import { SLOTS } from './contract.js';
import { byRank, shedSlots } from './rank.js';
import { render, renderedBody, type Rendered } from './renderers.js';
import type { AdmittedItem } from './admission.js';
import type { Tokenizer } from './tokenizers.js';
import type { ExcludedRow, Slot, Snapshot, Variant } from './types.js';

/** An included item's current body: its own, or the variant a cap or step chose. */
export interface Current {
  admitted: AdmittedItem;
  body: string;
  variant?: Variant;
}

export interface Fitted {
  refusal?: 'protected_content_over_budget' | 'slot_floor_over_budget';
  /** over_budget rows, in the order items were omitted. */
  rows: ExcludedRow[];
  /** Items omitted for budget, for R-12's recovery action. */
  omitted: AdmittedItem[];
  included: Map<string, Current>;
  rendered: Rendered;
}

type State = Map<string, Current>;
type Step = { slot: Slot; action: 'compress' | 'omit' };

export function fit(snapshot: Snapshot, items: AdmittedItem[], marks: Map<string, string>, count: Tokenizer): Fitted {
  const policy = snapshot.route_policy;
  const { placement } = snapshot.profile;
  const margin = snapshot.budget.margin_percent ?? 0;
  const rules = (slot: Slot) => policy.slots?.[slot] ?? {};
  const wraps = (slot: Slot) => placement.filter(p => p.slot === slot).map(p => p.wrap);

  // A body's size is the largest of its occurrences' renderings; a slot's size counts every occurrence.
  const size = (slot: Slot, body: string): number => Math.max(...wraps(slot).map(wrap => count(renderedBody(wrap, body))));
  const slotSize = (state: State, slot: Slot): number => [...state.values()]
    .filter(c => c.admitted.item.slot === slot)
    .reduce((sum, c) => sum + wraps(slot).reduce((n, wrap) => n + count(renderedBody(wrap, c.body)), 0), 0);
  const renderState = (state: State): Rendered => render(snapshot.renderer, placement, [...state.values()].map(c => ({
    id: c.admitted.item.id, slot: c.admitted.item.slot, body: c.body, lineage: c.admitted.item.lineage, conflict: marks.get(c.admitted.item.id),
  })), count);
  // The charged count, n × (100 + margin) / 100 rounded up, must be at most budget.input.
  const fits = (state: State): boolean => Math.floor((renderState(state).tokens * (100 + margin) + 99) / 100) <= snapshot.budget.input;

  const state: State = new Map(items.map(admitted => [admitted.item.id, { admitted, body: admitted.item.body }]));
  const rows: ExcludedRow[] = [];
  const omitted: AdmittedItem[] = [];
  const done = (refusal?: Fitted['refusal']): Fitted => ({ ...(refusal ? { refusal } : {}), rows, omitted, included: state, rendered: renderState(state) });

  // 1. Protected content alone must fit: its own caps, its slots' caps and the budget. Nothing is shed first.
  const protectedState: State = new Map([...state].filter(([, c]) => c.admitted.tier === 'protected'));
  const capped = SLOTS.filter(slot => rules(slot).max_tokens !== undefined);
  if ([...protectedState.values()].some(c => c.admitted.item.token_budget !== null && size(c.admitted.item.slot, c.body) > c.admitted.item.token_budget) ||
    capped.some(slot => slotSize(protectedState, slot) > rules(slot).max_tokens!) || !fits(protectedState)) {
    return done('protected_content_over_budget');
  }

  const inSlot = (slot: Slot) => items.filter(a => a.item.slot === slot && state.has(a.item.id));
  /** A slot's items in shedding order: from the lowest rank up. */
  const shedding = (slot: Slot) => byRank(policy, inSlot(slot)).reverse();
  const omit = (a: AdmittedItem): void => {
    state.delete(a.item.id);
    rows.push({ item_id: a.item.id, reason: 'over_budget', stage: 'assembler', slot: a.item.slot });
    omitted.push(a);
  };
  const withBody = (a: AdmittedItem, body: string, variant?: Variant): State =>
    new Map(state).set(a.item.id, { admitted: a, body, ...(variant ? { variant } : {}) });
  /** The largest (or smallest) of the variants by size; the earlier in `variants` on ties. */
  const pick = (slot: Slot, variants: Variant[], largest: boolean): Variant | undefined => variants.reduce<Variant | undefined>((best, v) =>
    best === undefined || (largest ? size(slot, v.body) > size(slot, best.body) : size(slot, v.body) < size(slot, best.body)) ? v : best, undefined);
  const occupied = () => shedSlots(policy, items.map(a => a.item.slot));

  // 2. token_budget caps, whether or not the payload fits: a droppable item over its cap is omitted, and a
  //    compressible one takes its largest variant within the cap, or is omitted.
  for (const slot of occupied()) {
    for (const a of shedding(slot)) {
      const cap = a.item.token_budget;
      if (a.tier === 'protected' || cap === null || size(slot, a.item.body) <= cap) continue;
      const within = a.tier === 'compressible' ? pick(slot, a.item.variants.filter(v => size(slot, v.body) <= cap), true) : undefined;
      if (within) state.set(a.item.id, { admitted: a, body: within.body, variant: within });
      else omit(a);
    }
  }

  // One compress or omit step over a slot's compressible items, from the lowest rank up, until `satisfied`.
  // `floor` withholds a reduction that would leave the slot below min_tokens, and then the step stops.
  const runStep = (step: Step, satisfied: (s: State) => boolean, floor?: (slot: Slot, after: State) => boolean): void => {
    for (const a of shedding(step.slot).filter(x => x.tier === 'compressible')) {
      if (satisfied(state)) return;
      let after: State;
      let variant: Variant | undefined;
      if (step.action === 'omit') {
        after = new Map(state);
        after.delete(a.item.id);
      } else {
        const current = state.get(a.item.id)!;
        const shorter = a.item.variants.filter(v => size(step.slot, v.body) < size(step.slot, current.body));
        if (shorter.length === 0) continue;
        variant = pick(step.slot, shorter.filter(v => satisfied(withBody(a, v.body, v))), true) ?? pick(step.slot, shorter, false)!;
        after = withBody(a, variant.body, variant);
      }
      if (floor && !floor(step.slot, after)) return;
      if (variant) state.set(a.item.id, after.get(a.item.id)!);
      else omit(a);
    }
  };
  const listed = policy.fitting_order ?? [];
  const isListed = (slot: Slot, action: Step['action']) => listed.some(s => s.slot === slot && s.action === action);

  // 3. Slot caps, whether or not the payload fits, slot by slot in shedding order, with no floors.
  for (const slot of occupied().filter(s => rules(s).max_tokens !== undefined)) {
    const within = (s: State) => slotSize(s, slot) <= rules(slot).max_tokens!;
    for (const a of shedding(slot).filter(x => x.tier === 'droppable')) {
      if (within(state)) break;
      omit(a);
    }
    const steps: Step[] = [...listed.filter(s => s.slot === slot), ...(['compress', 'omit'] as const)
      .filter(action => !isListed(slot, action)).map(action => ({ slot, action }))];
    for (const step of steps) runStep(step, within);
  }

  // Slot floors guard steps 4 and 5: a reduction that would leave a floored slot below min_tokens is withheld,
  // and the slot is frozen, so neither step reduces it again.
  const frozen = new Set<Slot>();
  const floor = (slot: Slot, after: State): boolean => {
    if (frozen.has(slot)) return false;
    const min = rules(slot).min_tokens;
    if (min === undefined || slotSize(after, slot) >= min) return true;
    frozen.add(slot);
    return false;
  };

  // 4. While the payload does not fit, omit droppable items one at a time, in shedding order.
  for (const slot of occupied()) {
    for (const a of shedding(slot).filter(x => x.tier === 'droppable')) {
      if (fits(state)) break;
      const after = new Map(state);
      after.delete(a.item.id);
      if (floor(slot, after)) omit(a);
    }
  }

  // 5. Then compress and omit steps: the route's fitting_order first, then a compress step for each slot and an
  //    omit step for each slot, in shedding order, skipping the steps the route listed.
  const slots = occupied();
  const steps: Step[] = [...listed,
    ...slots.filter(slot => !isListed(slot, 'compress')).map(slot => ({ slot, action: 'compress' as const })),
    ...slots.filter(slot => !isListed(slot, 'omit')).map(slot => ({ slot, action: 'omit' as const }))];
  for (const step of steps) {
    if (fits(state)) break;
    if (!frozen.has(step.slot)) runStep(step, fits, floor);
  }

  // 7. Only a slot floor can leave the payload over budget now.
  return done(fits(state) ? undefined : 'slot_floor_over_budget');
}
