// Tokenizers (conformance/README.md, Tokenizers and renderers). A caller may add its own through assemble()'s
// options, keyed by the ID a snapshot names in `tokenizer`, under an ID no published tokenizer uses (R-16).
import { NON_WHITESPACE_RUN } from './strings.js';

/** Counts the tokens of a text. It must be deterministic (R-23). */
export type Tokenizer = (text: string) => number;

/**
 * The IDs of the tokenizers conformance/README.md publishes, in its order, whether or not this package provides
 * them. A trace that names one always means its published count, so assemble() stops before assembly when the
 * caller's options.tokenizers names any of them (R-16). A test holds this list to the vendored README.
 */
export const PUBLISHED_TOKENIZERS: readonly string[] = ['fixture-whitespace/v1', 'estimate-utf8/v1'];

/**
 * The tokenizers this package provides. The table is frozen, not just typed read-only: a caller that assigned a key
 * could replace a published tokenizer, and a trace naming it would no longer mean its published count (R-16).
 */
export const TOKENIZERS: Readonly<Record<string, Tokenizer>> = Object.freeze({
  /** Maximal runs outside the ECMAScript whitespace set: a test fixture, not a model tokenizer. */
  'fixture-whitespace/v1': text => text.match(NON_WHITESPACE_RUN)?.length ?? 0,
  /** UTF-8 bytes divided by 4, rounded up: a portable estimate, meant for use with budget.margin_percent. */
  'estimate-utf8/v1': text => Math.floor((Buffer.byteLength(text, 'utf8') + 3) / 4),
});
