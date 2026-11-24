import { describe, expect, it } from "vitest";
import { allSpanPoints, spanPoints } from "../src/index.js";
import { event, len, rough, span } from "./helpers.js";

describe("the range of a point", () => {
  it("works out the end from start and length", () => {
    expect(spanPoints(span("a", { start: rough(0, 10), length: len(60, 175) }))).toEqual({
      start: { lo: 0, hi: 10 },
      end: { lo: 60, hi: 185 },
      length: { lo: 60, hi: 175 },
      disagrees: false,
    });
  });

  it("works out the start from end and length", () => {
    expect(spanPoints(span("a", { end: rough(100, 120), length: len(30, 50) }))).toEqual({
      start: { lo: 50, hi: 90 },
      end: { lo: 100, hi: 120 },
      length: { lo: 30, hi: 50 },
      disagrees: false,
    });
  });

  it("works out the length from start and end", () => {
    expect(spanPoints(span("a", { start: rough(0, 10), end: rough(100, 120) }))).toEqual({
      start: { lo: 0, hi: 10 },
      end: { lo: 100, hi: 120 },
      length: { lo: 90, hi: 120 },
      disagrees: false,
    });
  });

  it("never works out a negative length", () => {
    expect(spanPoints(span("a", { start: rough(0, 10), end: rough(5, 8) })).length).toEqual({
      lo: 0,
      hi: 8,
    });
  });

  it("knows only what is given when one number stands alone", () => {
    expect(spanPoints(span("a"))).toEqual({
      start: null,
      end: null,
      length: null,
      disagrees: false,
    });
    expect(spanPoints(span("a", { length: len(5) })).start).toBeNull();
    expect(spanPoints(span("a", { start: rough(5) })).end).toBeNull();
    expect(spanPoints(span("a", { end: rough(5) })).start).toBeNull();
  });

  it("puts an open start at minus infinity and an open end at plus infinity, with no length", () => {
    const openStart = spanPoints(span("a", { start: "open", end: rough(5), length: len(3) }));
    expect(openStart.start).toEqual({ lo: -Infinity, hi: -Infinity });
    expect(openStart.end).toEqual({ lo: 5, hi: 5 });
    expect(openStart.length).toBeNull();

    const openEnd = spanPoints(span("a", { start: rough(5), end: "open", length: len(3) }));
    expect(openEnd.end).toEqual({ lo: Infinity, hi: Infinity });
    expect(openEnd.start).toEqual({ lo: 5, hi: 5 });
    expect(openEnd.length).toBeNull();

    // A length does not place the other point of a span with an open end.
    expect(spanPoints(span("a", { end: "open", length: len(3) })).start).toBeNull();
    expect(spanPoints(span("a", { start: "open", length: len(3) })).end).toBeNull();
  });

  it("gives an event one point and length 0", () => {
    expect(spanPoints(event("e", rough(3, 4)))).toEqual({
      start: { lo: 3, hi: 4 },
      end: { lo: 3, hi: 4 },
      length: { lo: 0, hi: 0 },
      disagrees: false,
    });
    expect(spanPoints(event("e")).start).toBeNull();
    expect(spanPoints(event("e", "open")).end).toEqual({ lo: -Infinity, hi: -Infinity });
  });

  it("says a span's own numbers disagree when the given length is outside the other two", () => {
    const off = span("a", { start: rough(0, 10), end: rough(100, 120), length: len(10, 20) });
    expect(spanPoints(off).disagrees).toBe(true);
    const fits = span("a", { start: rough(0, 10), end: rough(100, 120), length: len(80, 95) });
    expect(spanPoints(fits).disagrees).toBe(false);
  });

  it("says so too when the given end is wholly before the given start", () => {
    expect(spanPoints(span("a", { start: rough(50), end: rough(10, 20) })).disagrees).toBe(true);
  });

  it("gathers every span's points by id", () => {
    const all = allSpanPoints([span("a", { start: rough(1) }), event("e")]);
    expect(all.get("a")?.start).toEqual({ lo: 1, hi: 1 });
    expect(all.get("e")?.length).toEqual({ lo: 0, hi: 0 });
  });
});
