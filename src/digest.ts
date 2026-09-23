// context.snapshot_digest (conformance/README.md, Snapshot digest): the SHA-256 of the RFC 8785 serialization
// of the snapshot with the arrays producers do not order sorted, so the same inputs give the same digest.
import { createHash } from 'node:crypto';
import { canonicalize, compareStrings, isBlank } from './strings.js';
import type { Snapshot } from './types.js';

const compareBytes = (a: string, b: string): number => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));

/** A candidate's id when it is a non-blank string, the only ids R-2 lets a trace record as given. */
export function usableId(candidate: unknown): string | undefined {
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) return undefined;
  const id = (candidate as { id?: unknown }).id;
  return typeof id === 'string' && !isBlank(id) ? id : undefined;
}

/** Orders values that share a key by the bytes of their RFC 8785 serialization. */
export const compareSerialized = (a: unknown, b: unknown): number => compareBytes(canonicalize(a), canonicalize(b));

export function normalizeSnapshot(snapshot: Snapshot): Snapshot {
  const batches = snapshot.batches.map(batch => {
    const named = batch.items.filter(item => usableId(item) !== undefined);
    const unnamed = batch.items.filter(item => usableId(item) === undefined);
    named.sort((a, b) => compareStrings(usableId(a)!, usableId(b)!) || compareSerialized(a, b));
    const excluded = [...batch.excluded].sort((a, b) => compareStrings(a.item_id, b.item_id) || compareSerialized(a, b));
    return { ...batch, items: [...named, ...unnamed], excluded };
  }).sort((a, b) => compareStrings(a.producer.id, b.producer.id));
  const conflicts = snapshot.conflicts
    .map(group => ({ ...group, items: [...group.items].sort(compareStrings) }))
    .sort((a, b) => compareStrings(a.id, b.id));
  return { ...snapshot, batches, conflicts };
}

export function snapshotDigest(snapshot: Snapshot): string {
  return createHash('sha256').update(canonicalize(normalizeSnapshot(snapshot)), 'utf8').digest('hex');
}
