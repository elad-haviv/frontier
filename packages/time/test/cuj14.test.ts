import { describe, expect, it } from "vitest";
import {
  checkRelations,
  countOfUnit,
  orderOf,
  sentenceFor,
  staleLength,
  type ChronicleInput,
  type RoughLength,
  type Span,
  type Unit,
} from "../src/index.js";

// CUJ 14 from the design: "Find out what is too quick and what is too slow".
const generation: Unit = { id: "u1", name: "generation", low: 20, high: 35 };

function fadingLength(count: readonly [number, number], words: string): RoughLength {
  const years = countOfUnit(count, generation);
  return { words, low: years.lo, high: years.hi, clock: "ezob", unit: "u1", count };
}

function cuj(fading: RoughLength): ChronicleInput {
  const blank = { start: null, end: null, length: null };
  const spans: Span[] = [
    { ...blank, id: "s1", lane: "humans", name: "First Landing", point: true },
    {
      ...blank,
      id: "s2",
      lane: "humans",
      name: "Earth memory fades",
      point: false,
      length: fading,
    },
    { ...blank, id: "s3", lane: "humans", name: "Earth technology is lost", point: false },
    {
      ...blank,
      id: "s4",
      lane: "nirani",
      name: "Nirani presence",
      point: false,
      length: { words: "about 400 years", low: 350, high: 450, clock: "ezob" },
    },
  ];
  return {
    lanes: [{ id: "humans" }, { id: "nirani" }],
    spans,
    relations: [
      { id: "r1", a: "s2", kind: "starts_with", b: "s1" },
      { id: "r2", a: "s3", kind: "during", b: "s2" },
      { id: "r3", a: "s4", kind: "longer_than", b: "s2" },
    ],
  };
}

describe("CUJ 14", () => {
  const first = fadingLength([3, 5], "3 to 5 generations");
  const before = cuj(first);

  it("makes 3 to 5 generations 60 to 175 years", () => {
    expect([first.low, first.high]).toEqual([60, 175]);
  });

  it("draws the fading from the landing with the loss of technology inside it", () => {
    const order = orderOf(before);
    expect(order.groups).toEqual([
      {
        spans: [
          { id: "s1", lane: "humans", start: 0, end: 0 },
          { id: "s2", lane: "humans", start: 0, end: 3 },
          { id: "s3", lane: "humans", start: 1, end: 2 },
        ],
        depth: 3,
      },
    ]);
    expect(order.circles).toEqual([]);
  });

  it("shows the Nirani lane as not yet related to the Humans lane", () => {
    expect(orderOf(before).notOrdered).toEqual(["s4"]);
  });

  it("finds that the Nirani presence is longer than the fading", () => {
    expect(checkRelations(before).map((c) => c.state)).toEqual([
      "cannot_tell",
      "cannot_tell",
      "holds",
    ]);
  });

  describe("after the fading becomes 15 to 30 generations", () => {
    const second = fadingLength([15, 30], "15 to 30 generations");
    const after = cuj(second);
    const checks = checkRelations(after);

    it("is 300 to 1050 years", () => {
      expect([second.low, second.high]).toEqual([300, 1050]);
    });

    it("turns the same statement amber, and it is the only amber", () => {
      expect(checks.map((c) => c.state)).toEqual(["cannot_tell", "cannot_tell", "may_not_fit"]);
    });

    it("says the fading's range is the one that decides it", () => {
      expect(checks[2]?.deciding).toEqual({
        span: "s2",
        part: "length",
        range: { lo: 300, hi: 1050 },
        toward: "low",
      });
      expect(sentenceFor(checks[2]!, after)).toBe(
        "Nirani presence is longer than Earth memory fades only if Earth memory fades is nearer 300 years than 1050.",
      );
    });

    it("changes nothing else", () => {
      expect(orderOf(after)).toEqual(orderOf(before));
      expect(checks.slice(0, 2)).toEqual(checkRelations(before).slice(0, 2));
    });
  });

  it("marks the fading as written with the old generation once the unit changes", () => {
    expect(staleLength(first, [generation])).toBeNull();
    expect(staleLength(first, [{ ...generation, low: 25, high: 40 }])?.recalculated).toEqual({
      lo: 75,
      hi: 200,
    });
  });
});
