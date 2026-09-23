// RFC 3339 instants compared at their full stated precision (R-2). JavaScript's Date keeps milliseconds only,
// so an instant is held as whole seconds since the epoch plus its fraction's decimal digits.

const INSTANT = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:([Zz])|([+-])(\d{2}):(\d{2}))$/;

export class Instant {
  /** seconds: whole seconds since 1970-01-01T00:00:00Z; fraction: decimal digits, trailing zeros removed. */
  private constructor(readonly seconds: bigint, readonly fraction: string) {}

  static of(seconds: bigint, fraction: string): Instant {
    return new Instant(seconds, fraction.replace(/0+$/, ''));
  }

  plusSeconds(seconds: number | bigint): Instant {
    return Instant.of(this.seconds + BigInt(seconds), this.fraction);
  }

  compare(other: Instant): number {
    if (this.seconds !== other.seconds) return this.seconds < other.seconds ? -1 : 1;
    const width = Math.max(this.fraction.length, other.fraction.length);
    const [a, b] = [this.fraction.padEnd(width, '0'), other.fraction.padEnd(width, '0')];
    return a < b ? -1 : a > b ? 1 : 0;
  }
}

/** Parses a timestamp in the portable RFC 3339 profile the schemas enforce (conformance/README.md, Timestamps). */
export function parseInstant(text: string): Instant {
  const match = INSTANT.exec(text);
  if (!match) throw new RangeError(`not an RFC 3339 date-time: ${JSON.stringify(text)}`);
  const [, year, month, day, hour, minute, second, fraction = '', , sign, offsetHour, offsetMinute] = match;
  const date = new Date(0);
  date.setUTCFullYear(Number(year), Number(month) - 1, Number(day)); // Date.UTC maps years 0-99 to 1900-1999
  const days = BigInt(date.getTime() / 86_400_000);
  const offset = sign ? (sign === '-' ? -1 : 1) * (Number(offsetHour) * 3600 + Number(offsetMinute) * 60) : 0;
  const seconds = days * 86_400n + BigInt(Number(hour) * 3600 + Number(minute) * 60 + Number(second) - offset);
  return Instant.of(seconds, fraction);
}

export const compareInstants = (a: string, b: string): number => parseInstant(a).compare(parseInstant(b));
