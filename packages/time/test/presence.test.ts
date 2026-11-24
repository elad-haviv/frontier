import { describe, expect, it } from "vitest";
import { presenceAt, spanPoints } from "../src/index.js";
import type { Span } from "../src/index.js";

const span = (extra: Partial<Span>): Span => ({
  id: "s",
  lane: "l",
  name: "s",
  point: false,
  start: null,
  end: null,
  length: null,
  ...extra,
});
const at = (low: number, high = low) => ({ words: "", low, high });
const at_ = (s: Span, year: number) => presenceAt(spanPoints(s), s.point, year);

describe("presence at a year", () => {
  it("runs not yet, perhaps, there, perhaps, gone across a span with rough ends", () => {
    const s = span({ start: at(270, 290), end: at(300, 320) });
    expect([269, 270, 289, 290, 300, 301, 320, 321].map((y) => at_(s, y))).toEqual([
      "not_yet",
      "perhaps",
      "perhaps",
      "there",
      "there",
      "perhaps",
      "perhaps",
      "gone",
    ]);
  });

  it("takes an exact start and end as sharp edges", () => {
    const s = span({ start: at(0), end: at(10) });
    expect([-1, 0, 10, 11].map((y) => at_(s, y))).toEqual(["not_yet", "there", "there", "gone"]);
  });

  it("counts an unknown start as begun and an unknown end as going on", () => {
    expect(at_(span({ end: at(50) }), -1e6)).toBe("there");
    expect(at_(span({ end: at(50) }), 51)).toBe("gone");
    expect(at_(span({ start: at(5) }), 1e6)).toBe("there");
    expect(at_(span({ start: at(5) }), 4)).toBe("not_yet");
  });

  it("never reaches an open start or end", () => {
    const s = span({ start: "open", end: "open" });
    expect([-1e9, 0, 1e9].map((y) => at_(s, y))).toEqual(["there", "there", "there"]);
    expect(at_(span({ start: "open", end: at(3) }), 4)).toBe("gone");
  });

  it("works from a length when one end is worked out", () => {
    const s = span({ start: at(0), length: { ...at(10, 20), clock: "ezob" } });
    expect([5, 10, 15, 20, 21].map((y) => at_(s, y))).toEqual([
      "there",
      "there",
      "perhaps",
      "perhaps",
      "gone",
    ]);
  });

  it("is undated with no numbers, or with numbers that disagree", () => {
    expect(at_(span({}), 0)).toBe("undated");
    expect(at_(span({ length: { ...at(5), clock: "ezob" } }), 0)).toBe("undated");
    expect(at_(span({ start: at(100), end: at(50) }), 75)).toBe("undated");
  });

  it("is gone once its end is surely past, even where its start is still rough", () => {
    const s = span({ start: at(100, 200), end: at(150, 160) });
    expect([120, 155, 161, 180].map((y) => at_(s, y))).toEqual([
      "perhaps",
      "perhaps",
      "gone",
      "gone",
    ]);
  });

  it("still reads a start and an end whose stored length disagrees with them", () => {
    const s = span({ start: at(0), end: at(10), length: { ...at(500), clock: "ezob" } });
    expect(at_(s, 5)).toBe("there");
  });

  it("keeps what an event stands for from its moment on", () => {
    const e = span({ point: true, start: at(300, 310) });
    expect([299, 300, 309, 310, 9999].map((y) => at_(e, y))).toEqual([
      "not_yet",
      "perhaps",
      "perhaps",
      "there",
      "there",
    ]);
    expect(at_(span({ point: true }), 0)).toBe("undated");
    expect(at_(span({ point: true, start: "open" }), -1e9)).toBe("there");
  });
});
