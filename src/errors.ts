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

/**
 * The caller's options.tokenizers names the ID of a tokenizer conformance/README.md publishes, so assembly stops
 * before it starts: no payload and no trace (R-16). A trace that names a published tokenizer always means its
 * published count, so an application's own tokenizer takes an ID no published one uses, including one this package
 * does not provide. `ids` holds every published ID the options name, in the README's order.
 */
export class PublishedTokenizerIdError extends Error {
  constructor(readonly ids: readonly string[]) {
    super(`options.tokenizers names the published tokenizer ID ${ids.join(', ')}: ` +
      'an application\'s own tokenizer takes an ID no published tokenizer uses (R-16)');
    this.name = 'PublishedTokenizerIdError';
  }
}
