// Snapshot checks (conformance/README.md): a snapshot that fails its schemas or any of these checks is rejected
// before assembly, with no payload and no trace (R-17). No reason code names these problems, so they are words.
import { describeErrors, validateSnapshot } from './schemas.js';
import { isWellFormed } from './strings.js';
import { realizationProblems } from './renderers.js';
import type { Snapshot } from './types.js';

const REQUIRED = ['governance.instructions', 'interaction.query'] as const;

/** The snapshot's problems, in words; an empty list means the snapshot is valid. */
export function checkSnapshot(value: unknown): string[] {
  if (!validateSnapshot(value)) return describeErrors(validateSnapshot.errors);
  const snapshot = value as Snapshot;
  const problems: string[] = [];
  if (!isWellFormed(snapshot)) problems.push('a string holds an unpaired surrogate, so the snapshot is not well-formed Unicode');

  const producers = snapshot.batches.map(batch => batch.producer.id);
  for (const id of new Set(producers.filter((id, i) => producers.indexOf(id) !== i))) {
    problems.push(`producer ${id} heads more than one batch`);
  }

  // Conflict groups (R-11): unique ids, known items, no item in two groups, known facts.
  const known = new Set(snapshot.batches.flatMap(batch => [
    ...batch.items.map(item => (item as { id?: unknown }).id).filter(id => typeof id === 'string'),
    ...batch.excluded.map(row => row.item_id),
  ]));
  const facts = snapshot.route_policy.facts ?? {};
  const groupIds = new Set<string>();
  const owner = new Map<string, string>();
  for (const group of snapshot.conflicts) {
    if (groupIds.has(group.id)) problems.push(`conflict group id ${group.id} is used more than once`);
    groupIds.add(group.id);
    for (const id of group.items) {
      if (!known.has(id)) problems.push(`conflict group ${group.id} names ${id}, which is neither a candidate nor a producer exclusion`);
      const other = owner.get(id);
      if (other !== undefined) problems.push(`${id} belongs to conflict groups ${other} and ${group.id}`);
      else owner.set(id, group.id);
    }
    if (group.kind === 'fact' && !Object.hasOwn(facts, group.fact!)) {
      problems.push(`conflict group ${group.id} names fact ${group.fact}, which the route policy does not define`);
    }
  }

  // Producer exclusions (R-13): duplicate_of names a candidate in the same batch.
  for (const batch of snapshot.batches) {
    const candidates = new Set(batch.items.map(item => (item as { id?: unknown }).id));
    for (const row of batch.excluded) {
      if (row.duplicate_of !== undefined && !candidates.has(row.duplicate_of)) {
        problems.push(`${batch.producer.id}'s exclusion of ${row.item_id} names ${row.duplicate_of} as kept, which is not a candidate in its batch`);
      }
    }
  }

  // Profile (R-19, R-20): route, route policy version, required placements, and a renderer that can realize it.
  const { profile, route_policy: policy } = snapshot;
  if (profile.route !== policy.route) problems.push(`the profile is for route ${profile.route}, and the route policy for ${policy.route}`);
  if (profile.route_policy_version !== policy.version) {
    problems.push(`the profile expects route policy version ${profile.route_policy_version}, and the snapshot carries ${policy.version}`);
  }
  const placed = new Set(profile.placement.map(p => p.slot));
  const required: string[] = [...REQUIRED, ...(policy.parser === true ? ['governance.output_contract'] : [])];
  for (const slot of required) if (!placed.has(slot as never)) problems.push(`the profile does not place ${slot}`);
  for (const problem of realizationProblems(snapshot.renderer, profile.placement)) {
    problems.push(`${snapshot.renderer} cannot realize the profile: ${problem}`);
  }
  return problems;
}
