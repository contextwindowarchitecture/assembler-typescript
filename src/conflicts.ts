// Conflict resolution (R-6, R-11; conformance/README.md, Conflicts). It acts only on declared groups and never
// reads a body. A group's members are the items it names that admission admitted.
import { parseInstant } from './instant.js';
import { compareStrings } from './strings.js';
import type { AdmittedItem } from './admission.js';
import type { ConflictRow, ExcludedRow, Snapshot } from './types.js';

type Action = 'surface' | 'request_context' | 'refuse';
const RESOLUTION = { surface: 'surfaced', request_context: 'context_requested', refuse: 'refused' } as const;

export interface Resolution {
  conflicts: ConflictRow[];
  /** conflict_deferred and conflict_lost rows, ordered by item_id. */
  rows: ExcludedRow[];
  /** The id of the surfaced group each member belongs to, for the renderer to mark. */
  marks: Map<string, string>;
  /** The actions of escalated groups that refuse the assembly (conflict_unresolved). */
  refusing: Action[];
}

interface Decision {
  decided_by: ConflictRow['decided_by'];
  winner?: AdmittedItem;
  losers: AdmittedItem[];
  reason?: 'conflict_deferred' | 'conflict_lost';
}

function decideInstruction(members: AdmittedItem[]): Decision | undefined {
  // Only governing and user may instruct; the peers are those at the highest instructing authority present.
  const top = members.some(m => m.item.authority === 'governing') ? 'governing' : 'user';
  const peers = members.filter(m => m.item.authority === top);
  if (peers.length <= 1) return { decided_by: 'authority', ...(peers[0] ? { winner: peers[0] } : {}), losers: [] };
  const governing = peers.filter(m => m.item.conflict_policy === 'governs');
  const deferring = peers.filter(m => m.item.conflict_policy === 'defers');
  if (governing.length === 1 && deferring.length === peers.length - 1) {
    return { decided_by: 'policy', winner: governing[0]!, losers: deferring, reason: 'conflict_deferred' };
  }
  return undefined;
}

function decideFact(members: AdmittedItem[], fact: NonNullable<Snapshot['route_policy']['facts']>[string]): Decision | undefined {
  if (!fact) return undefined;
  const required = fact.scope ?? [];
  const eligible = members.filter(m => fact.precedence.includes(m.producer) &&
    required.every(key => (m.item.scope as Record<string, unknown> | undefined)?.[key] !== undefined));
  if (eligible.length === 0) return undefined;
  const best = Math.min(...eligible.map(m => fact.precedence.indexOf(m.producer)));
  const leaders = eligible.filter(m => fact.precedence.indexOf(m.producer) === best);
  let winner: AdmittedItem | undefined;
  let decidedBy: ConflictRow['decided_by'] = 'policy';
  if (leaders.length === 1) winner = leaders[0];
  else if (fact.freshness_tiebreak === true) {
    const newest = leaders.filter(m => leaders.every(o => o === m || parseInstant(m.item.freshness).compare(parseInstant(o.item.freshness)) > 0));
    if (newest.length === 1) [winner, decidedBy] = [newest[0], 'freshness'];
  }
  if (!winner) return undefined;
  return { decided_by: decidedBy, winner, losers: members.filter(m => m !== winner), reason: 'conflict_lost' };
}

export function resolveConflicts(snapshot: Snapshot, admitted: AdmittedItem[]): Resolution {
  const byId = new Map(admitted.map(a => [a.item.id, a]));
  const resolution: Resolution = { conflicts: [], rows: [], marks: new Map(), refusing: [] };
  for (const group of [...snapshot.conflicts].sort((a, b) => compareStrings(a.id, b.id))) {
    const items = [...group.items].sort(compareStrings);
    const base = { group_id: group.id, kind: group.kind, items };
    const members = items.flatMap(id => byId.get(id) ?? []);
    if (members.length < 2) {
      resolution.conflicts.push({ ...base, resolution: 'moot', decided_by: 'moot' });
      continue;
    }
    const fact = group.kind === 'fact' ? snapshot.route_policy.facts?.[group.fact!] : undefined;
    let decision = group.kind === 'instruction' ? decideInstruction(members) : decideFact(members, fact);
    // A decision that would exclude a protected item escalates instead (R-11).
    if (decision?.losers.some(m => m.tier === 'protected')) decision = undefined;
    if (decision) {
      resolution.conflicts.push({ ...base, resolution: 'resolved', decided_by: decision.decided_by,
        ...(decision.winner ? { winner: decision.winner.item.id } : {}) });
      for (const loser of decision.losers) {
        resolution.rows.push({ item_id: loser.item.id, reason: decision.reason!, stage: 'assembler', slot: loser.item.slot });
      }
      continue;
    }
    const action: Action = group.kind === 'instruction' ? snapshot.route_policy.on_unresolved_instruction ?? 'refuse' : fact!.on_unresolved;
    resolution.conflicts.push({ ...base, resolution: RESOLUTION[action], decided_by: 'escalated' });
    if (action === 'surface') for (const m of members) resolution.marks.set(m.item.id, group.id);
    else resolution.refusing.push(action);
  }
  resolution.rows.sort((a, b) => compareStrings(a.item_id, b.item_id));
  return resolution;
}
