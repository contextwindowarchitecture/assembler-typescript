// String rules from conformance/README.md: Blank strings, Ordering, and RFC 8785 serialization.

// The ECMAScript whitespace and line-terminator set, listed explicitly (Blank strings).
const WHITESPACE = '\\t\\n\\v\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff';
const NON_BLANK = new RegExp(`[^${WHITESPACE}]`, 'u');
/** A maximal run of whitespace, as Deduplication collapses it. */
export const WHITESPACE_RUN = new RegExp(`[${WHITESPACE}]+`, 'gu');
/** A maximal run of other characters: one fixture-whitespace/v1 token. */
export const NON_WHITESPACE_RUN = new RegExp(`[^${WHITESPACE}]+`, 'gu');

/** True when every character is ECMAScript whitespace or a line terminator. */
export const isBlank = (text: string): boolean => !NON_BLANK.test(text);

/** Orders strings by UTF-16 code units, the order RFC 8785 uses for member names (Ordering). */
export const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The RFC 8785 (JSON Canonicalization Scheme) serialization of a JSON value. */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('RFC 8785 has no serialization for a non-finite number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const members = Object.keys(record).filter(key => record[key] !== undefined).sort(compareStrings);
    return `{${members.map(key => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(',')}}`;
  }
  throw new TypeError(`RFC 8785 has no serialization for ${typeof value}`);
}

/** True when no string in the value, member names included, holds an unpaired surrogate (RFC 7493). */
export function isWellFormed(value: unknown): boolean {
  if (typeof value === 'string') return value.isWellFormed();
  if (Array.isArray(value)) return value.every(isWellFormed);
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).every(([key, member]) => key.isWellFormed() && isWellFormed(member));
  }
  return true;
}
