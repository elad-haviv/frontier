import { describe, expect, it } from "vitest";
import { type ChronicleFile, type ChronicleSpan, emptyChronicle } from "@frontier/schema";
import { allSpanPoints } from "@frontier/time";
import { dragLabel, dragSpans, placeSpan, typeWhen } from "./edit.ts";
import { listOf } from "./ListView.tsx";
import { withTies, work } from "./model.ts";
import { moveRow } from "./Timeline.tsx";
import {
  barOf,
  centuryOf,
  extentOf,
  levelOf,
  rowsOf,
  snapYears,
  ticksOf,
  whenText,
} from "./timelineLayout.ts";

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

const example: ChronicleFile = {
  ...emptyChronicle("c4h7x2ab", "Ezob", "l1"),
  origin: "landing",
  lanes: [
    { id: "l1", name: "Humans", color: "#9a3b1f", clock: "ezob" },
    { id: "l2", name: "Nirani", color: "#2f6f73", clock: "ezob" },
  ],
  units: [{ id: "u1", name: "generation", low: 20, high: 35 }],
  spans: [
    span("landing", { name: "First Landing", point: true, start: at(0) }),
    span("fading", {
      name: "Earth memory fades",
      length: { words: "", low: 60, high: 175, clock: "ezob" },
    }),
    span("kingdom", { name: "The kingdom", start: at(0), end: at(380, 450) }),
    span("war", { name: "The war", start: at(270, 290), end: at(300) }),
    span("nirani", { name: "Nirani presence", lane: "l2", start: "open", end: at(380, 450) }),
  ],
};

describe("the timeline's layout", () => {
  it("names the zoom level nearest a scale and snaps by it", () => {
    expect(levelOf(7).id).toBe("years");
    expect(levelOf(1.5).id).toBe("decades");
    expect(levelOf(0.05).id).toBe("centuries");
    expect(levelOf(0.0001).id).toBe("millennia");
    expect(snapYears(283, 5)).toBe(285);
    expect(snapYears(-12, 10)).toBe(-10);
  });

  it("covers everything placed and the map year, at least a screen wide", () => {
    const e = extentOf({ lo: 0, hi: 450 }, 600, 1, 300);
    expect(e.from).toBeLessThan(0);
    expect(e.to).toBeGreaterThan(600);
    const empty = extentOf(null, null, 7, 1000);
    expect(empty.from).toBeLessThanOrEqual(0);
    expect(empty.to).toBeGreaterThanOrEqual(100);
    expect(empty.width).toBeGreaterThanOrEqual(1000);
  });

  it("rules labelled marks with finer ones between", () => {
    const t = ticksOf({ from: 0, to: 100, width: 700 }, 7);
    expect(t.major.map((m) => m.year)).toEqual([0, 20, 40, 60, 80, 100]);
    expect(t.minor.length).toBeGreaterThan(0);
    expect(t.minor.every((m) => m.year % 20 !== 0)).toBe(true);
  });

  it("lists a header, the events and an add row per group, folded groups shut", () => {
    const rows = rowsOf(example, new Set(["l2"]));
    expect(rows.map((r) => r.kind)).toEqual([
      "group",
      "event",
      "event",
      "event",
      "event",
      "add",
      "group",
    ]);
    expect(rows[6]).toMatchObject({ kind: "group", folded: true, count: 1 });
  });

  it("draws a solid core between soft ends, open ends to the edge, and moments", () => {
    const points = allSpanPoints(example.spans);
    const e = { from: -100, to: 600, width: 700 };
    const war = barOf(example.spans[3]!, points.get("war"), e, 1);
    expect(war).toMatchObject({
      kind: "range",
      x0: 370,
      x1: 400,
      core: [390, 400],
      soft0: [370, 390],
      soft1: null,
    });
    const nirani = barOf(example.spans[4]!, points.get("nirani"), e, 1);
    expect(nirani).toMatchObject({ kind: "range", x0: 0, openStart: true, soft1: [480, 550] });
    expect(barOf(example.spans[0]!, points.get("landing"), e, 1)).toEqual({
      kind: "moment",
      x: 100,
      whisker: null,
      open: false,
    });
    expect(barOf(example.spans[1]!, points.get("fading"), e, 1)).toEqual({
      kind: "none",
      length: { lo: 60, hi: 175 },
    });
    const rough = barOf(
      span("m", { point: true, start: at(10, 20) }),
      allSpanPoints([span("m", { point: true, start: at(10, 20) })]).get("m"),
      e,
      1,
    );
    expect(rough).toMatchObject({ kind: "moment", x: 115, whisker: [110, 120] });
    const stub = barOf(
      span("s", { start: at(0) }),
      allSpanPoints([span("s", { start: at(0) })]).get("s"),
      e,
      1,
    );
    expect(stub).toMatchObject({ kind: "range", x0: 100, unknownEnd: true });
  });

  it("says when in short words", () => {
    const points = allSpanPoints(example.spans);
    expect(whenText(example.spans[3]!, points.get("war"))).toBe("270–290 → 300");
    expect(whenText(example.spans[4]!, points.get("nirani"))).toBe("open → 380–450");
    expect(whenText(example.spans[0]!, points.get("landing"))).toBe("0");
    expect(whenText(example.spans[1]!, points.get("fading"))).toBe("No dates yet");
    expect(centuryOf(-5)).toBe("Before year 0");
    expect(centuryOf(250)).toBe("Year 200 to 299");
  });

  it("lists events by start under centuries, with no dates last", () => {
    const groups = listOf(example, work(example));
    expect(groups.map((g) => g.head)).toEqual([
      "Older than anything shown",
      "Year 0 to 99",
      "Year 200 to 299",
      "No dates yet",
    ]);
    expect(groups[1]!.items.map((i) => i.span.id)).toEqual(["landing", "kingdom"]);
  });
});

describe("editing by hand", () => {
  it("moves a bar, its soft ends with it", () => {
    const moved = dragSpans(example, ["war"], "move", 10);
    expect(moved.spans[3]).toMatchObject({ start: at(280, 300), end: at(310) });
    expect(dragSpans(example, ["war"], "move", 0)).toBe(example);
  });

  it("stretches one end and lets a length go once both ends are stored", () => {
    const placed = withTies({
      ...example,
      spans: example.spans.map((s) =>
        s.id === "fading"
          ? {
              ...s,
              start: at(0),
              startFrom: { span: "landing", edge: "start" as const, plus: { low: 0, high: 0 } },
            }
          : s,
      ),
    });
    const longer = dragSpans(placed, ["fading"], "end", 25);
    const fading = longer.spans[1]!;
    expect(fading.end).toEqual(at(85, 200));
    expect(fading.length).toBeNull();
    // The start is still tied.
    expect(fading.startFrom).toBeDefined();
    // A stretch never turns a bar inside out.
    expect(dragSpans(example, ["war"], "start", 100)).toEqual(example);
  });

  it("moves a tied point by changing its tie, so it keeps following", () => {
    const tied = withTies({
      ...example,
      spans: example.spans.map((s) =>
        s.id === "war"
          ? {
              ...s,
              startFrom: { span: "landing", edge: "start" as const, plus: { low: 270, high: 290 } },
            }
          : s,
      ),
    });
    const moved = withTies(dragSpans(tied, ["war"], "move", 5));
    expect(moved.spans[3]!.startFrom!.plus).toEqual({ low: 275, high: 295 });
    const landed = withTies(dragSpans(moved, ["landing"], "move", 100));
    expect(landed.spans[3]!.start).toMatchObject({ low: 375, high: 395 });
  });

  it("places an event with no dates, and makes the first one placed year 0", () => {
    const placed = placeSpan(example, "fading", 40, null);
    expect(placed.spans[1]!.start).toEqual(at(40));
    const fresh: ChronicleFile = {
      ...emptyChronicle("c4h7x2ab", "New", "l1"),
      spans: [span("a"), span("b", { point: true })],
    };
    const first = placeSpan(fresh, "a", 37, 80);
    expect(first.origin).toBe("a");
    expect(first.spans[0]).toMatchObject({ start: at(0), end: at(43) });
    const moment = placeSpan(first, "b", 12, null);
    expect(moment.spans[1]!.start).toEqual(at(12));
    expect(placeSpan(first, "gone", 1, 2)).toBe(first);
  });

  it("types dates, lengths, open ends and ties, and refuses a circle", () => {
    const typed = typeWhen(example, "fading", "start", "with First Landing");
    expect(typed.ok).toBe(true);
    if (!typed.ok) return;
    expect(typed.chronicle.spans[1]).toMatchObject({
      start: { low: 0, high: 0 },
      startFrom: { span: "landing", edge: "start" },
    });
    const circle = typeWhen(typed.chronicle, "landing", "start", "with Earth memory fades");
    expect(circle).toEqual({ ok: false, message: "Earth memory fades is already tied to this." });
    const unit = typeWhen(example, "fading", "length", "3-5 generations");
    expect(unit.ok && unit.chronicle.spans[1]!.length).toMatchObject({
      low: 60,
      high: 175,
      unit: "u1",
    });
    const open = typeWhen(example, "war", "end", "open");
    expect(open.ok && open.chronicle.spans[3]!.end).toBe("open");
    const cleared = typeWhen(example, "war", "start", "");
    expect(cleared.ok && cleared.chronicle.spans[3]!.start).toBeNull();
    expect(typeWhen(example, "war", "start", "soon").ok).toBe(false);
    expect(typeWhen(example, "gone", "start", "1").ok).toBe(false);
    const plain = typeWhen(typed.chronicle, "fading", "start", "10");
    expect(plain.ok && plain.chronicle.spans[1]!.startFrom).toBeUndefined();
    const years = typeWhen(example, "war", "length", "30 years");
    expect(years.ok && years.chronicle.spans[3]!.length).toMatchObject({ low: 30, clock: "ezob" });
    const noLength = typeWhen(example, "war", "length", "");
    expect(noLength.ok && noLength.chronicle.spans[3]!.length).toBeNull();
  });

  it("gives the first typed start year 0's place", () => {
    const fresh: ChronicleFile = { ...emptyChronicle("c4h7x2ab", "New", "l1"), spans: [span("a")] };
    const out = typeWhen(fresh, "a", "start", "300");
    expect(out.ok && out.chronicle.origin).toBe("a");
  });

  it("moves a row to another group, above another event or last", () => {
    const moved = moveRow(example, "nirani", "l1", "war");
    expect(moved.spans.map((s) => s.id)).toEqual(["landing", "fading", "kingdom", "nirani", "war"]);
    expect(moved.spans[3]!.lane).toBe("l1");
    expect(moveRow(example, "landing", "l2", null).spans.at(-1)).toMatchObject({
      id: "landing",
      lane: "l2",
    });
    expect(moveRow(example, "gone", "l2", null)).toBe(example);
  });

  it("labels a drag", () => {
    expect(dragLabel("The war", "280–300 → 310", 10)).toBe("The war: 280–300 → 310 (+10 yrs)");
    expect(dragLabel("The war", "269–289 → 299", -1)).toBe("The war: 269–289 → 299 (−1 yr)");
  });
});
