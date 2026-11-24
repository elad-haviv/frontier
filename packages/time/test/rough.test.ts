import { describe, expect, it } from "vitest";
import {
  addRanges,
  countOfUnit,
  rangeOf,
  rangeWidth,
  rangesOverlap,
  staleLength,
  subtractRanges,
} from "../src/index.js";

const generation = { id: "u1", name: "generation", low: 20, high: 35 };

describe("rough numbers", () => {
  it("adds lows to lows and highs to highs", () => {
    expect(addRanges({ lo: 0, hi: 10 }, { lo: 60, hi: 175 })).toEqual({ lo: 60, hi: 185 });
  });

  it("subtracts the most for the lowest and the least for the highest", () => {
    expect(subtractRanges({ lo: 100, hi: 120 }, { lo: 30, hi: 50 })).toEqual({ lo: 50, hi: 90 });
  });

  it("tells whether ranges overlap, touching included", () => {
    expect(rangesOverlap({ lo: 0, hi: 10 }, { lo: 10, hi: 20 })).toBe(true);
    expect(rangesOverlap({ lo: 0, hi: 10 }, { lo: 11, hi: 20 })).toBe(false);
    expect(rangesOverlap({ lo: 30, hi: 40 }, { lo: 11, hi: 20 })).toBe(false);
  });

  it("gives an open point width 0", () => {
    expect(rangeWidth({ lo: Infinity, hi: Infinity })).toBe(0);
    expect(rangeWidth({ lo: 2, hi: 5 })).toBe(3);
  });

  it("reads a rough number's range", () => {
    expect(rangeOf({ low: 1, high: 2 })).toEqual({ lo: 1, hi: 2 });
  });

  it("turns a count of a unit into years", () => {
    expect(countOfUnit([3, 5], generation)).toEqual({ lo: 60, hi: 175 });
  });
});

describe("a length against its unit", () => {
  const length = {
    words: "3 to 5 generations",
    low: 60,
    high: 175,
    clock: "ezob",
    unit: "u1",
    count: [3, 5] as const,
  };

  it("is up to date while the unit is as it was", () => {
    expect(staleLength(length, [generation])).toBeNull();
  });

  it("is stale once the unit's range changes, and says what it was written with", () => {
    const now = { ...generation, low: 25, high: 40 };
    expect(staleLength(length, [now])).toEqual({
      unit: now,
      writtenWith: { lo: 20, hi: 35 },
      now: { lo: 25, hi: 40 },
      recalculated: { lo: 75, hi: 200 },
    });
  });

  it("is not stale without a unit, without a count, or when the unit is gone", () => {
    expect(staleLength({ words: "", low: 1, high: 2, clock: "ezob" }, [generation])).toBeNull();
    expect(
      staleLength({ words: "", low: 1, high: 2, clock: "ezob", unit: "u1" }, [generation]),
    ).toBeNull();
    expect(staleLength(length, [])).toBeNull();
  });

  it("ignores differences that come only from decimal arithmetic", () => {
    const tenth = { id: "u2", name: "season", low: 0.1, high: 0.1 };
    const typed = {
      words: "",
      low: 0.3,
      high: 0.3,
      clock: "ezob",
      unit: "u2",
      count: [3, 3] as const,
    };
    expect(staleLength(typed, [tenth])).toBeNull();
  });

  it("copes with a count of 0", () => {
    const none = { ...length, low: 0, high: 0, count: [0, 0] as const };
    expect(staleLength(none, [generation])).toBeNull();
    expect(staleLength({ ...none, low: 5 }, [generation])?.writtenWith).toEqual({ lo: 20, hi: 35 });
  });
});
