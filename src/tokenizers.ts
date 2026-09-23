// Tokenizers (conformance/README.md, Tokenizers and renderers). A caller may add its own through assemble()'s
// options, keyed by the ID a snapshot names in `tokenizer`.
import { NON_WHITESPACE_RUN } from './strings.js';

/** Counts the tokens of a text. It must be deterministic (R-23). */
export type Tokenizer = (text: string) => number;

export const TOKENIZERS: Readonly<Record<string, Tokenizer>> = {
  /** Maximal runs outside the ECMAScript whitespace set: a test fixture, not a model tokenizer. */
  'fixture-whitespace/v1': text => text.match(NON_WHITESPACE_RUN)?.length ?? 0,
  /** UTF-8 bytes divided by 4, rounded up: a portable estimate, meant for use with budget.margin_percent. */
  'estimate-utf8/v1': text => Math.floor((Buffer.byteLength(text, 'utf8') + 3) / 4),
};
