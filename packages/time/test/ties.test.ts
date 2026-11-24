import { describe, expect, it } from "vitest";
import {
  type Span,
  type Tie,
  placeable,
  resolveTies,
  tiedValue,
  wouldCircle,
} from "../src/index.js";
import { event, len, rel, rough, span } from "./helpers.js";

const tie = (to: string, edge: "start" | "end", low = 0, high = low): Tie => ({
  span: to,
  edge,
  plus: { low, high },
});
const tied = (s: Span, more: Partial<Span>): Span => ({ ...s, ...more });

describe("ties", () => {
  it("places a tied start, and its length then places its end", () => {
    const landing = event("landing", rough(0));
    const fading = tied(span("fading", { length: len(60, 175) }), {
      startFrom: tie("landing", "start"),
    });
    const out = resolveTies([landing, fading]);
    expect(out.moved).toEqual(["fading"]);
    expect(out.spans[1]!.start).toEqual({ words: "", low: 0, high: 0 });
    expect(out.spans[0]).toBe(landing);
  });

  it("moves what is tied when its anchor moves, through a chain, in one pass", () => {
    const war = span("war", { start: rough(270, 290), end: rough(300) });
    // Listed before what it is tied to, so the order of the file does not matter.
    const treaty = tied(event("treaty"), { startFrom: tie("peace", "start", 5) });
    const peace = tied(span("peace", { length: len(10) }), { startFrom: tie("war", "end", 10) });
    const out = resolveTies([treaty, war, peace]);
    expect(out.spans.find((s) => s.id === "peace")!.start).toMatchObject({ low: 310, high: 310 });
    expect(out.spans.find((s) => s.id === "treaty")!.start).toMatchObject({ low: 315, high: 315 });

    const later = resolveTies(
      out.spans.map((s) => (s.id === "war" ? { ...s, end: rough(320, 330) } : s)),
    );
    expect(later.spans.find((s) => s.id === "treaty")!.start).toMatchObject({
      low: 335,
      high: 345,
    });
  });

  it("gives back the same array when nothing moved", () => {
    const spans = [
      event("a", rough(0)),
      tied(event("b", rough(0)), { startFrom: tie("a", "start") }),
    ];
    expect(resolveTies(spans).spans).toBe(spans);
  });

  it("keeps the words typed, and ties an end before a start", () => {
    const kingdom = span("kingdom", { start: rough(100), end: rough(400) });
    const era = tied(
      span("era", { start: rough(0), end: { words: "20-40 before", low: 0, high: 0 } }),
      {
        endFrom: tie("kingdom", "start", -40, -20),
      },
    );
    const out = resolveTies([kingdom, era]).spans[1]!;
    expect(out.end).toEqual({ words: "20-40 before", low: 60, high: 80 });
  });

  it("leaves a circle, a missing anchor, and an anchor with no number as they are or unknown", () => {
    const a = tied(span("a", { start: rough(1) }), { startFrom: tie("b", "start") });
    const b = tied(span("b", { start: rough(2) }), { startFrom: tie("a", "start") });
    const c = tied(span("c", { start: rough(3) }), { startFrom: tie("gone", "start") });
    const d = tied(span("d", { start: rough(4) }), { startFrom: tie("e", "end") });
    const e = span("e");
    const out = resolveTies([a, b, c, d, e]);
    expect(out.circles.sort()).toEqual(["a", "b"]);
    expect(out.spans[0]).toBe(a);
    expect(out.spans[1]).toBe(b);
    expect(out.spans[2]).toBe(c);
    expect(out.spans[3]!.start).toBeNull();
  });

  it("reads open points as open, and an event's end tie not at all", () => {
    expect(tiedValue({ lo: -Infinity, hi: -Infinity }, tie("x", "start"), "start", "")).toBe(
      "open",
    );
    expect(tiedValue({ lo: Infinity, hi: Infinity }, tie("x", "end"), "end", "")).toBe("open");
    expect(tiedValue({ lo: Infinity, hi: Infinity }, tie("x", "end"), "start", "")).toBeNull();
    expect(tiedValue(null, tie("x", "end"), "start", "")).toBeNull();
    const moment = tied(event("m", rough(5)), { endFrom: tie("other", "end") });
    const other = span("other", { start: rough(0), end: rough(50) });
    expect(resolveTies([moment, other]).moved).toEqual([]);
  });

  it("refuses a tie that would go in a circle", () => {
    const a = span("a", { start: rough(0) });
    const b = tied(span("b"), { startFrom: tie("a", "start") });
    const c = tied(span("c", { length: len(5) }), { endFrom: tie("b", "end") });
    expect(wouldCircle([a, b, c], "a", "c")).toBe(true);
    expect(wouldCircle([a, b, c], "a", "a")).toBe(true);
    expect(wouldCircle([a, b, c], "c", "a")).toBe(false);
    expect(
      wouldCircle([a, b, c, tied(span("d"), { startFrom: tie("d", "start") })], "a", "d"),
    ).toBe(false);
  });
});

describe("statements that can place a span", () => {
  it("offers starts with, ends with and after, once per point", () => {
    const landing = event("landing", rough(0));
    const fading = span("fading", { length: len(60, 175) });
    const war = span("war", { start: rough(270, 290), end: rough(300) });
    const peace = span("peace");
    const fall = span("fall", { start: rough(0) });
    const offers = placeable({
      spans: [landing, fading, war, peace, fall],
      relations: [
        rel("r1", "fading", "starts_with", "landing"),
        rel("r2", "landing", "starts_with", "fading"),
        rel("r3", "peace", "after", "war"),
        rel("r4", "war", "before", "peace"),
        rel("r5", "fall", "ends_with", "war"),
        rel("r6", "peace", "during", "war"),
        rel("r7", "peace", "mirrors", "war"),
      ],
    });
    expect(offers).toEqual([
      { span: "fading", part: "start", tie: tie("landing", "start"), relation: "r1" },
      { span: "peace", part: "start", tie: tie("war", "end"), relation: "r3" },
      { span: "fall", part: "end", tie: tie("war", "end"), relation: "r5" },
    ]);
  });

  it("offers nothing for a point already placed, or from a point with no number", () => {
    const placed = span("placed", { end: rough(10), length: len(5) });
    const empty = span("empty");
    const open = span("open", { start: "open" });
    const moment = event("moment");
    const tiedAlready = tied(span("tied"), { startFrom: tie("x", "start") });
    expect(
      placeable({
        spans: [placed, empty, open, moment, tiedAlready],
        relations: [
          rel("r1", "placed", "starts_with", "open"),
          rel("r2", "moment", "after", "empty"),
          rel("r3", "moment", "starts_with", "open"),
          rel("r4", "moment", "ends_with", "placed"),
          rel("r5", "tied", "starts_with", "placed"),
          rel("r6", "gone", "starts_with", "placed"),
        ],
      }),
    ).toEqual([]);
  });

  it("does not offer a tie that would go in a circle", () => {
    const a = tied(span("a", { start: rough(0) }), { startFrom: tie("b", "end") });
    const b = span("b", { end: rough(9) });
    const offers = placeable({ spans: [a, b], relations: [rel("r1", "b", "starts_with", "a")] });
    expect(offers).toEqual([]);
  });
});
