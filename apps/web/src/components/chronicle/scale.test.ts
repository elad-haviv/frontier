import { describe, expect, it } from "vitest";
import type { ChronicleFile, ChronicleSpan } from "@frontier/schema";
import { allSpanPoints } from "@frontier/time";
import { applyOffer, countFrom, shiftSpan } from "./model.ts";
import { rulerStep, scaleBounds } from "./scaleLayout.ts";
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

describe("the ruler", () => {
  it("finds the years everything placed may cover", () => {
    const spans = [
      span("landing", { point: true, start: at(0) }),
      span("war", { start: at(300, 320), end: at(400) }),
      span("old", { start: "open", end: at(50) }),
    ];
    expect(scaleBounds(allSpanPoints(spans).values())).toEqual({ lo: 0, hi: 400 });
    expect(scaleBounds(allSpanPoints([span("x")]).values())).toBeNull();
  });

  it("rules the years in round steps", () => {
    expect(rulerStep(1)).toBe(1);
    expect(rulerStep(30)).toBe(50);
    expect(rulerStep(120)).toBe(200);
    expect(rulerStep(0.2)).toBe(1);
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
});
