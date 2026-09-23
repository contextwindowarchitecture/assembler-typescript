/** The snapshot fails its schemas or a snapshot check, so there is no assembly: no payload and no trace (R-17). */
export class SnapshotRejectedError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`snapshot rejected: ${problems.join('; ')}`);
    this.name = 'SnapshotRejectedError';
  }
}

/** The snapshot names a tokenizer or renderer this implementation does not provide. The case is skipped. */
export class UnsupportedComponentError extends Error {
  constructor(readonly component: 'tokenizer' | 'renderer', readonly id: string) {
    super(`${component} ${id} is not provided`);
    this.name = 'UnsupportedComponentError';
  }
}
