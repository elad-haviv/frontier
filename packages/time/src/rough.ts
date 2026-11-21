import type { Range, Rough, RoughLength, Unit } from "./types.js";

/** The range of a rough number, without its words. */
export function rangeOf(rough: Pick<Rough, "low" | "high">): Range {
  return { lo: rough.low, hi: rough.high };
}

/** `a + b`: lows added, highs added. */
export function addRanges(a: Range, b: Range): Range {
  return { lo: a.lo + b.lo, hi: a.hi + b.hi };
}

/**
 * `a − b`. The design's "lows added, highs added" is about addition. For a difference the least
 * result takes away the most and the greatest takes away the least, so the lowest is
 * `a.lo − b.hi` and the highest is `a.hi − b.lo`. This is what `start = end − length` and
 * `length = end − start` use.
 */
export function subtractRanges(a: Range, b: Range): Range {
  return { lo: a.lo - b.hi, hi: a.hi - b.lo };
}

/** Whether two ranges share at least one value. Touching ends count as sharing. */
export function rangesOverlap(a: Range, b: Range): boolean {
  return a.lo <= b.hi && b.lo <= a.hi;
}

/**
 * How wide a range is. A point at an open end is infinite at both ends, where the plain
 * difference is not a number, so a range whose two ends are equal is given width 0.
 */
export function rangeWidth(range: Range): number {
  return range.lo === range.hi ? 0 : range.hi - range.lo;
}

/** A count of a unit as years: 3 to 5 of a unit of 20 to 35 is 60 to 175. */
export function countOfUnit(
  count: readonly [number, number],
  unit: Pick<Unit, "low" | "high">,
): Range {
  return { lo: count[0] * unit.low, hi: count[1] * unit.high };
}

/** What a length written as a count of a unit says now that the unit has changed. */
export interface StaleLength {
  readonly unit: Unit;
  /** The unit's range when the length was written, read back from the stored numbers. */
  readonly writtenWith: Range;
  /** The unit's range now. */
  readonly now: Range;
  /** What the length would be if recalculated with the unit as it is now. */
  readonly recalculated: Range;
}

// Counts and units may be decimals, so two ways of reaching the same number can differ in the
// last digits. Differences this small are not a change the author made.
function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}

/**
 * Whether a length was written with a unit whose range has since changed: its stored low and
 * high no longer equal its count times the unit. Returns null when the length is up to date,
 * was not typed as a count, or names a unit that is gone (there is then nothing to compare
 * with).
 */
export function staleLength(length: RoughLength, units: readonly Unit[]): StaleLength | null {
  if (length.unit === undefined || length.count === undefined) return null;
  const unit = units.find((u) => u.id === length.unit);
  if (!unit) return null;
  const recalculated = countOfUnit(length.count, unit);
  if (nearlyEqual(recalculated.lo, length.low) && nearlyEqual(recalculated.hi, length.high)) {
    return null;
  }
  const [least, most] = length.count;
  return {
    unit,
    // A count of 0 says nothing about the unit it was written with, so today's value stands in.
    writtenWith: {
      lo: least === 0 ? unit.low : length.low / least,
      hi: most === 0 ? unit.high : length.high / most,
    },
    now: { lo: unit.low, hi: unit.high },
    recalculated,
  };
}
