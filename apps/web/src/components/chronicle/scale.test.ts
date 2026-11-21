import { describe, expect, it } from "vitest";
import type { ChronicleFile, ChronicleSpan } from "@frontier/schema";
import { allSpanPoints } from "@frontier/time";
import { applyOffer, countFrom, shiftSpan } from "./model.ts";
import { layoutOrder } from "./orderLayout.ts";
import { type ScaleSizes, layoutScale, rulerStep, scaleBounds } from "./scaleLayout.ts";
import { alignable, compareVersions } from "./versions.ts";

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

  it("rules the whole length however much room there is", () => {
    const one = [span("a", { start: at(0), end: at(1000) })];
    const wide = layoutScale(one, allSpanPoints(one), ["l1"], 76800, SIZES);
    expect(wide.marks.at(-1)!.year).toBeGreaterThanOrEqual(1000);
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

  it("an offered end keeps a span's own numbers in agreement, whatever it was built from", () => {
    const fits = (x: ChronicleSpan) => allSpanPoints([x]).get(x.id)!.disagrees === false;
    const end = { start: null, end: { lo: 60, hi: 100 } };
    const start = { start: { lo: 100, hi: 100 }, end: null };
    // A start and a length: the end is taken, and the start is worked out from the length.
    const byLength = applyOffer(span("a", { start: at(0), length: long(50) }), end);
    expect(byLength).toMatchObject({ start: null, end: { low: 60, high: 100 } });
    expect(allSpanPoints([byLength]).get("a")!.start).toEqual({ lo: 10, hi: 50 });
    // An end and a length, given a start.
    const moved = applyOffer(span("a", { end: at(50), length: long(20) }), start);
    expect(moved).toMatchObject({ start: { low: 100 }, end: null });
    // Only the other end stored, with nothing to say how far it lies: it is forgotten.
    expect(applyOffer(span("a", { start: at(200) }), end).start).toBeNull();
    // An open start stays open.
    expect(applyOffer(span("a", { start: "open", end: at(50) }), end).start).toBe("open");
    expect(applyOffer(span("a", { start: "open", end: at(50) }), start).end).toBeNull();
    for (const x of [byLength, moved]) expect(fits(x)).toBe(true);
  });

  it("shifting by nothing keeps the author's words", () => {
    const s = span("a", { start: { words: "40 years after the start of b", low: 40, high: 40 } });
    expect(shiftSpan(s, 0)).toEqual(s);
    expect(shiftSpan(s, 5).start).toMatchObject({ words: "", low: 45 });
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

describe("two versions", () => {
  const file = (spans: ChronicleSpan[], relations: ChronicleFile["relations"] = []) =>
    ({ spans, relations }) as unknown as ChronicleFile;
  const rel = (a: string, kind: string, b: string) => ({ id: `${a}${kind}${b}`, a, kind, b });
  const mine = file(
    [
      span("a", { start: at(0) }),
      span("b", { start: at(100), end: at(200) }),
      span("c", { name: "Shared name", start: at(10) }),
      span("mineOnly"),
    ],
    [rel("b", "after", "a")],
  );

  it("matches spans by id, then by name, and marks what differs or is in one only", () => {
    const theirs = file(
      [
        span("a", { start: at(0) }),
        span("b", { start: at(-400), end: at(-300) }),
        span("other", { name: "Shared name", start: at(10) }),
        span("theirsOnly"),
      ],
      [rel("b", "after", "a")],
    );
    const v = compareVersions(mine, theirs, 0);
    expect(v.match.get("other")).toBe("c");
    expect([...v.mine]).toEqual([
      ["mineOnly", "only"],
      ["b", "differs"],
    ]);
    expect([...v.theirs]).toEqual([
      ["b", "differs"],
      ["theirsOnly", "only"],
    ]);
  });

  it("counts a different statement as a difference, and not a renamed id", () => {
    const sameSaid = file(mine.spans, [rel("b", "after", "a")]);
    expect(compareVersions(mine, sameSaid, 0).mine.size).toBe(0);
    const said = file(mine.spans, [rel("b", "during", "a")]);
    expect([...compareVersions(mine, said, 0).mine.keys()].sort()).toEqual(["a", "b"]);
  });

  it("brings the other onto this ruler by an offset, and offers spans to align on", () => {
    const theirs = file([
      span("a", { start: at(1000) }),
      span("b", { start: at(1100), end: at(1200) }),
    ]);
    const anchors = alignable(mine, theirs, compareVersions(mine, theirs, 0));
    expect(anchors.map((x) => [x.mine.id, x.offset])).toEqual([
      ["a", -1000],
      ["b", -1000],
    ]);
    // Without the statement the other lacks, both spans that it names still differ.
    expect(compareVersions(mine, theirs, -1000).mine.get("a")).toBe("differs");
    const withSaid = file(theirs.spans, [rel("b", "after", "a")]);
    const v = compareVersions(mine, withSaid, -1000);
    expect(v.mine.get("a")).toBeUndefined();
    expect(v.mine.get("b")).toBeUndefined();
  });

  it("does not call an identical copy different for a statement about a removed span", () => {
    const broken = file(mine.spans, [rel("b", "after", "gone")]);
    expect(compareVersions(broken, file(broken.spans, broken.relations), 0).mine.size).toBe(0);
  });

  it("allows for decimals when comparing after an offset", () => {
    const one = file([span("a", { start: at(0.3) }), span("b", { start: at(1.1) })]);
    const two = file([span("a", { start: at(0.1) }), span("b", { start: at(0.9) })]);
    expect(compareVersions(one, two, 0.3 - 0.1).mine.size).toBe(0);
  });

  it("rules two chronicles alike when given the same years", () => {
    const one = [span("a", { start: at(0), end: at(10) })];
    const two = [span("a", { start: at(-500), end: at(-490) })];
    const within = scaleBounds([...allSpanPoints(one).values(), ...allSpanPoints(two).values()])!;
    const first = layoutScale(one, allSpanPoints(one), ["l1"], 800, SIZES, within);
    const second = layoutScale(two, allSpanPoints(two), ["l1"], 800, SIZES, within);
    expect(first.length).toBeCloseTo(second.length);
    expect(first.perYear).toBeCloseTo(second.perYear);
    expect(first.spans[0]!.t0 - second.spans[0]!.t0).toBeCloseTo(500 * first.perYear);
  });
});
