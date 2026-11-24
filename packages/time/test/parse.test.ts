import { describe, expect, it } from "vitest";
import {
  aboutReach,
  formatEnd,
  formatLength,
  formatRange,
  formatTie,
  formatYears,
  parseWhen,
  plural,
  readRange,
} from "../src/index.js";

const units = [{ id: "u1", name: "generation", low: 20, high: 35 }];
const spans = [
  { id: "s1", name: "First Landing" },
  { id: "s2", name: "The war" },
  { id: "s3", name: "The kingdom" },
];
const start = { part: "start" as const, units, spans, self: "s9" };
const end = { part: "end" as const, units, spans, self: "s9" };
const length = { part: "length" as const, units, spans };

describe("reading a year", () => {
  it("reads one year, a range and the ways of saying roughly", () => {
    expect(parseWhen("300", start)).toEqual({ kind: "years", low: 300, high: 300, words: "300" });
    expect(parseWhen("270-290", start)).toMatchObject({ low: 270, high: 290 });
    expect(parseWhen("270 to 290", start)).toMatchObject({ low: 270, high: 290 });
    expect(parseWhen("270–290", start)).toMatchObject({ low: 270, high: 290 });
    expect(parseWhen("about 280", start)).toMatchObject({ low: 270, high: 290 });
    expect(parseWhen("c. 280", start)).toMatchObject({ low: 270, high: 290 });
    expect(parseWhen("280 ±10", start)).toMatchObject({ low: 270, high: 290 });
    expect(parseWhen("280 +/- 10", start)).toMatchObject({ low: 270, high: 290 });
    expect(parseWhen("year 12,000", start)).toMatchObject({ low: 12000, high: 12000 });
    expect(parseWhen("2.5", start)).toMatchObject({ low: 2.5, high: 2.5 });
  });

  it("reads years before year 0", () => {
    expect(parseWhen("-50", start)).toMatchObject({ kind: "years", low: -50, high: -50 });
    expect(parseWhen("−50", start)).toMatchObject({ low: -50, high: -50 });
    expect(parseWhen("50 before", start)).toMatchObject({ low: -50, high: -50 });
    expect(parseWhen("50 years before", start)).toMatchObject({ low: -50, high: -50 });
    expect(parseWhen("30-50 before", start)).toMatchObject({ low: -50, high: -30 });
    expect(parseWhen("-50 to -30", start)).toMatchObject({ low: -50, high: -30 });
    expect(parseWhen("-50-30", start)).toMatchObject({ low: -50, high: 30 });
    expect(parseWhen("50 after", start)).toMatchObject({ low: 50, high: 50 });
  });

  it("reads open and nothing", () => {
    expect(parseWhen("open", start)).toEqual({ kind: "open" });
    expect(parseWhen(" Still going ", end)).toEqual({ kind: "open" });
    expect(parseWhen("   ", start)).toEqual({ kind: "empty" });
  });

  it("says what is wrong", () => {
    expect(parseWhen("290-270", start)).toEqual({
      kind: "error",
      message: "The second number is below the first.",
    });
    expect(parseWhen("soon", start)).toMatchObject({ kind: "error" });
    expect(parseWhen("after Nobody", start)).toEqual({
      kind: "error",
      message: "No event here is called “Nobody”.",
    });
    expect(parseWhen("with Self", { ...start, spans: [{ id: "s9", name: "Self" }] })).toEqual({
      kind: "error",
      message: "An event cannot be tied to itself.",
    });
    expect(parseWhen("20-10 after The war", start)).toMatchObject({ kind: "error" });
    expect(parseWhen("-5 after The war", start)).toMatchObject({ kind: "error" });
    expect(parseWhen("lots after The war", start)).toMatchObject({ kind: "error" });
  });
});

describe("reading a tie", () => {
  it("ties a start to a start and an end to an end with “with”", () => {
    expect(parseWhen("with First Landing", start)).toEqual({
      kind: "tie",
      tie: { span: "s1", edge: "start", plus: { low: 0, high: 0 } },
      words: "with First Landing",
    });
    expect(parseWhen("with the war", end)).toMatchObject({
      tie: { span: "s2", edge: "end", plus: { low: 0, high: 0 } },
    });
    expect(parseWhen("with the end of The war", start)).toMatchObject({
      tie: { span: "s2", edge: "end" },
    });
    expect(parseWhen("with “The war”", start)).toMatchObject({ tie: { span: "s2" } });
  });

  it("counts after from the end and before from the start", () => {
    expect(parseWhen("10 after The war", start)).toMatchObject({
      tie: { span: "s2", edge: "end", plus: { low: 10, high: 10 } },
    });
    expect(parseWhen("10 years after The war", start)).toMatchObject({
      tie: { plus: { low: 10, high: 10 } },
    });
    expect(parseWhen("20-40 before The kingdom", end)).toMatchObject({
      tie: { span: "s3", edge: "start", plus: { low: -40, high: -20 } },
    });
    expect(parseWhen("after The war", start)).toMatchObject({
      tie: { span: "s2", edge: "end", plus: { low: 0, high: 0 } },
    });
    expect(parseWhen("5 after the start of The war", start)).toMatchObject({
      tie: { span: "s2", edge: "start", plus: { low: 5, high: 5 } },
    });
    expect(parseWhen("5 before the end of The war", start)).toMatchObject({
      tie: { span: "s2", edge: "end", plus: { low: -5, high: -5 } },
    });
    expect(parseWhen("the end of The war", start)).toMatchObject({
      tie: { span: "s2", edge: "end", plus: { low: 0, high: 0 } },
    });
  });

  it("writes a tie back so it reads the same", () => {
    const cases = [
      ["with First Landing", start],
      ["10 after The war", start],
      ["20–40 before The kingdom", end],
      ["5 after the start of The war", start],
      ["5 before the end of The war", start],
      ["with the end of The war", start],
    ] as const;
    for (const [text, ctx] of cases) {
      const read = parseWhen(text, ctx);
      if (read.kind !== "tie") throw new Error(text);
      const name = spans.find((s) => s.id === read.tie.span)!.name;
      const written = formatTie(read.tie, ctx.part, name);
      expect(written).toBe(text);
      expect(parseWhen(written, ctx)).toMatchObject({ tie: read.tie });
    }
    expect(formatTie({ span: "s2", edge: "end", plus: { low: -5, high: 5 } }, "start", "X")).toBe(
      "the end of X -5 to 5",
    );
  });
});

describe("reading a length", () => {
  it("reads years, the author's units and well-known lengths", () => {
    expect(parseWhen("400", length)).toEqual({ kind: "years", low: 400, high: 400, words: "400" });
    expect(parseWhen("350-450 years", length)).toMatchObject({ low: 350, high: 450 });
    expect(parseWhen("about 400 years", length)).toMatchObject({ low: 300, high: 500 });
    expect(parseWhen("3-5 generations", length)).toEqual({
      kind: "count",
      low: 60,
      high: 175,
      words: "3-5 generations",
      unit: "u1",
      count: [3, 5],
    });
    expect(parseWhen("1 generation", length)).toMatchObject({ low: 20, high: 35 });
    expect(parseWhen("2 centuries", length)).toMatchObject({ kind: "years", low: 200, high: 200 });
  });

  it("says what is wrong with a length", () => {
    expect(parseWhen("open", length)).toMatchObject({ kind: "error" });
    expect(parseWhen("3 lifetimes", length)).toEqual({
      kind: "error",
      message: "There is no unit called “lifetimes”. Add it under Units.",
    });
    expect(parseWhen("-3", length)).toMatchObject({ kind: "error" });
    expect(parseWhen("5-3 years", length)).toMatchObject({ kind: "error" });
    expect(parseWhen("ages", length)).toMatchObject({ kind: "error" });
    expect(parseWhen("", length)).toEqual({ kind: "empty" });
  });
});

describe("writing numbers back", () => {
  it("writes years and ranges", () => {
    expect(formatYears(300, 300)).toBe("300");
    expect(formatYears(270, 290)).toBe("270–290");
    expect(formatYears(-50, -30)).toBe("-50 to -30");
    expect(formatYears(12000, 12500)).toBe("12,000–12,500");
    expect(readRange(formatYears(12000, 12500))).toEqual({ lo: 12000, hi: 12500 });
    expect(formatEnd(null)).toBe("");
    expect(formatEnd("open")).toBe("open");
    expect(formatEnd({ low: 1, high: 2 })).toBe("1–2");
    expect(formatRange({ lo: -Infinity, hi: -Infinity })).toBe("open");
    expect(formatRange({ lo: 5, hi: Infinity })).toBe("open");
    expect(formatRange({ lo: 5, hi: 6 })).toBe("5–6");
  });

  it("writes lengths in the unit they were typed in", () => {
    const counted = {
      words: "",
      low: 60,
      high: 175,
      clock: "ezob",
      unit: "u1",
      count: [3, 5] as [number, number],
    };
    expect(formatLength(counted, units)).toBe("3–5 generations");
    expect(formatLength(counted, [])).toBe("60–175 years");
    expect(formatLength({ words: "", low: 1, high: 1, clock: "ezob" })).toBe("1 year");
    expect(formatLength(null)).toBe("");
  });

  it("knows how far about reaches, and plurals", () => {
    expect(aboutReach(280)).toBe(10);
    expect(aboutReach(4000)).toBe(1000);
    expect(aboutReach(285)).toBe(5);
    expect(aboutReach(0)).toBe(10);
    expect(plural("generation", 2)).toBe("generations");
    expect(plural("generation", 1)).toBe("generation");
    expect(plural("years", 2)).toBe("years");
  });
});
