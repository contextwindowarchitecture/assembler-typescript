// Contract data the pipeline reads: reason order (R-21), slot defaults and tiers (R-3, R-16).
import { REASONS, SLOT_DEFAULTS } from './generated/contract.js';
import type { ContextItem, RoutePolicy, Slot, Tier } from './types.js';

export const SLOTS = Object.keys(SLOT_DEFAULTS) as Slot[];
export const isSlot = (value: unknown): value is Slot => typeof value === 'string' && Object.hasOwn(SLOT_DEFAULTS, value);
export const slotDefaults = (slot: Slot) => SLOT_DEFAULTS[slot];

/** The policy fields R-3 fills, in the order defaults_filled lists them. */
export const POLICY_FIELDS = ['token_budget', 'variants', 'conflict_policy', 'lineage', 'eligibility', 'injection_risk'] as const;
export type PolicyField = (typeof POLICY_FIELDS)[number];

/** An item with every policy field present, after defaults are filled (R-3). */
export type FilledItem = ContextItem & Required<Pick<ContextItem, PolicyField>>;

const REASON_INDEX = new Map<string, number>(REASONS.map((reason, index) => [reason.code, index]));
/** A reason code's rank in contract/reasons.json: when several apply, the earliest is recorded (R-21). */
export function reasonRank(code: string): number {
  const rank = REASON_INDEX.get(code.startsWith('missing_field:') ? 'missing_field:<name>' : code);
  if (rank === undefined) throw new Error(`reason ${code} is not published`);
  return rank;
}

const TIER_RANK: Record<Tier, number> = { droppable: 0, compressible: 1, protected: 2 };
export const tierRank = (tier: Tier): number => TIER_RANK[tier];

/** A slot's default tier, raised (never lowered) by the route's tier_upgrades (R-16). */
export function slotTier(slot: Slot, policy: RoutePolicy): Tier {
  const base = SLOT_DEFAULTS[slot].tier as Tier;
  const upgrade = policy.tier_upgrades?.[slot] as Tier | undefined;
  return upgrade !== undefined && TIER_RANK[upgrade] > TIER_RANK[base] ? upgrade : base;
}

/** An item's tier: its own when it sets one, otherwise its slot's effective tier (conformance/README.md). */
export const itemTier = (item: ContextItem, policy: RoutePolicy): Tier => item.tier ?? slotTier(item.slot, policy);
