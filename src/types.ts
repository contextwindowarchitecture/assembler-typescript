// Friendlier names for the types generated from the published schemas (src/generated/types.ts).
import type * as G from './generated/types.js';

export type Snapshot = G.CWAAssemblySnapshot;
export type ContextItem = G.CWAContextItem;
export type Variant = G.Variants[number];
export type Profile = G.CWAPlacementProfile;
export type RoutePolicy = G.CWARoutePolicy;
export type SlotRules = G.SlotRules;
export type ConflictGroup = G.CWAConflictGroup;
export type Trace = G.CWAAssemblyTrace;
export type ConformanceReport = G.CWAConformanceReport;
export type Batch = Snapshot['batches'][number];
export type ProducerExclusion = Batch['excluded'][number];
export type Slot = ContextItem['slot'];
export type Tier = NonNullable<ContextItem['tier']>;
export type IncludedRow = Trace['included'][number];
export type CompressedRow = Trace['compressed'][number];
export type ExcludedRow = Trace['excluded'][number];
export type ConflictRow = Trace['conflicts'][number];
export type DefaultFilledRow = NonNullable<Trace['defaults_filled']>[number];
export type Recovery = NonNullable<Trace['recovery']>;
