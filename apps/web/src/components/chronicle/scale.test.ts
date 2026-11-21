import { describe, expect, it } from "vitest";
import type { ChronicleFile, ChronicleSpan } from "@frontier/schema";
import { allSpanPoints } from "@frontier/time";
import { applyOffer, countFrom, shiftSpan } from "./model.ts";
import { layoutOrder } from "./orderLayout.ts";
import { type ScaleSizes, layoutScale, rulerStep, scaleBounds } from "./scaleLayout.ts";

const span = (id: string, extra: Partial<ChronicleSpan> = {}): ChronicleSpan => ({
  id,
  lane: "l1",
  name: id,
  point: false,
  start: null,
  end: null,
  length: null,
  entry: null,
  note: "",
  ...extra,
});
const at = (low: number, high = low) => ({ words: "", low, high });
const long = (low: number, high = low) => ({ words: "", low, high, clock: "ezob" });
const SIZES: ScaleSizes = {
  eventBefore: 10,
  eventAfter: 100,
  open: 20,
  least: 3,
  tick: 6,
  mark: 80,
};

describe("the scale layout", () => {
  const spans = [
    span("landing", { point: true, start: at(0) }),
    span("fading", { start: at(0), length: long(100, 200) }),
    span("war", { start: at(300, 320), end: at(400) }),
    span("old", { start: "open", end: at(50) }),
    span("begun", { start: at(350) }),
    span("blink", { start: at(100), end: at(100.5) }),
    span("loose", { length: long(40, 60) }),
    span("bare"),
    span("someday", { point: true }),
  ];
  const layout = layoutScale(spans, allSpanPoints(spans), ["l1", "l2"], 1000, SIZES);
  const of = (id: string) => layout.spans.find((s) => s.id === id)!;

  it("finds the years everything placed may cover", () => {
    expect(scaleBounds(allSpanPoints(spans).values())).toEqual({ lo: 0, hi: 400 });
    expect(scaleBounds(allSpanPoints([span("x")]).values())).toBeNull();
  });

  it("draws a bar over every year it may cover, fading across each end's range", () => {
    const fading = of("fading");
    const war = of("war");
    expect(fading.t1 - fading.t0).toBeCloseTo(200 * layout.perYear);
    expect(fading.fade0).toBe(0);
    expect(fading.fade1).toBeCloseTo(100 * layout.perYear);
    expect(war.t0).toBeGreaterThan(fading.t1);
    expect(war.fade0).toBeCloseTo(20 * layout.perYear);
    expect(layout.length).toBeLessThanOrEqual(1000.001);
  });

  it("gives an open or unknown end a broken edge", () => {
    expect(of("old")).toMatchObject({ t0: 0, openStart: true, openEnd: false });
    expect(of("begun").openEnd).toBe(true);
    expect(of("begun").t1 - of("begun").t0).toBeGreaterThanOrEqual(SIZES.open);
  });

  it("marks a bar too narrow to draw, and never an event", () => {
    expect(of("blink").small).toBe(true);
    expect(of("blink").t1 - of("blink").t0).toBe(SIZES.tick);
    expect(of("landing")).toMatchObject({ point: true, small: false });
    expect(of("landing").t0).toBe(of("landing").t1);
  });

  it("keeps apart what has a length but no place, and what has no number", () => {
    expect(layout.notPlaced).toEqual([{ id: "loose", lane: "l1", low: 40, high: 60 }]);
    expect(layout.unnumbered).toEqual(["bare", "someday"]);
  });

  it("puts spans that share years on different tracks, and leaves an empty lane one track", () => {
    expect(of("fading").track).not.toBe(of("old").track);
    expect(of("fading").track).not.toBe(of("blink").track);
    expect(layout.tracks.get("l2")).toBe(1);
  });

  it("rules the years in round steps", () => {
    expect(rulerStep(1)).toBe(1);
    expect(rulerStep(30)).toBe(50);
    expect(rulerStep(120)).toBe(200);
    expect(rulerStep(0.2)).toBe(1);
    const years = layout.marks.map((m) => m.year);
    expect(years).toContain(0);
    expect(years.every((y) => y % (years[1]! - years[0]!) === 0)).toBe(true);
  });

  it("with nothing placed, still lists lengths", () => {
    const only = [span("loose", { length: long(40, 60) }), span("bare")];
    const empty = layoutScale(only, allSpanPoints(only), ["l1"], 600, SIZES);
    expect(empty.spans).toEqual([]);
    expect(empty.notPlaced.map((n) => n.id)).toEqual(["loose"]);
    expect(empty.unnumbered).toEqual(["bare"]);
  });
});

describe("moving spans", () => {
  it("shifts a start and an end and leaves open ends and lengths alone", () => {
    const s = span("a", { start: at(10, 20), end: "open", length: long(5) });
    expect(shiftSpan(s, -500)).toMatchObject({ start: { low: -490, high: -480 }, end: "open" });
    expect(shiftSpan(s, -500).length).toEqual(s.length);
  });

  it("an offered start takes a stored end along, keeping the length", () => {
    const s = span("a", { start: at(50), end: at(80, 90) });
    const moved = applyOffer(s, { start: { lo: 100, hi: 150 }, end: null });
    expect(moved.start).toEqual(at(100, 150));
    expect(moved.end).toEqual(at(130, 140));
    const byEnd = applyOffer(s, { start: null, end: { lo: 20, hi: 20 } });
    expect(byEnd).toMatchObject({ start: { low: -10, high: -10 }, end: { low: 20, high: 20 } });
  });

  it("an offer never gives an event an end", () => {
    const e = span("e", { point: true });
    expect(applyOffer(e, { start: { lo: 5, hi: 6 }, end: { lo: 9, hi: 9 } }).end).toBeNull();
  });

  it("counting from another span moves every stored number by one amount", () => {
    const c = {
      origin: "a",
      spans: [span("a", { start: at(0) }), span("b", { start: at(120, 130), end: at(200) })],
    } as unknown as ChronicleFile;
    const next = countFrom(c, "b");
    expect(next.origin).toBe("b");
    expect(next.spans[0]!.start).toEqual(at(-120));
    expect(next.spans[1]).toMatchObject({ start: { low: 0, high: 10 }, end: { low: 80 } });
    expect(countFrom(c, "missing")).toBe(c);
  });
});

describe("the order layout", () => {
  it("lays groups out as blocks one after another and packs a lane's tracks", () => {
    const order = {
      groups: [
        {
          depth: 2,
          spans: [
            { id: "a", lane: "l1", start: 0, end: 2 },
            { id: "b", lane: "l1", start: 1, end: 2 },
            { id: "e", lane: "l1", start: 2, end: 2 },
          ],
        },
        { depth: 1, spans: [{ id: "c", lane: "l2", start: 0, end: 1 }] },
      ],
      notOrdered: [],
      circles: [],
      leftOut: [],
      droppedNumberSteps: [],
    };
    const sizes = { unit: 100, pad: 10, gap: 50, eventBefore: 10, eventAfter: 80 };
    const layout = layoutOrder(order, new Set(["e"]), ["l1", "l2", "l3"], sizes);
    const of = (id: string) => layout.spans.find((s) => s.id === id)!;
    expect(layout.blocks).toHaveLength(2);
    expect(layout.blocks[1]!.at).toBe(layout.blocks[0]!.length + 50);
    expect(of("a").track).not.toBe(of("b").track);
    expect(of("e").t0).toBe(of("a").t1);
    expect(of("c").t0).toBeGreaterThan(of("a").t1);
    expect(layout.tracks.get("l3")).toBe(1);
  });
});
