import { describe, expect, it } from "vitest";
import type { ChronicleFile, ChronicleSpan, MapFeature, MapFile } from "@frontier/schema";
import {
  addShape,
  changeYears,
  clampYear,
  countFeatures,
  presenceOf,
  readTime,
  reasonFor,
  removeShape,
  resolve,
  shapeAt,
  shapeStart,
  spanFor,
  tie,
  writeShape,
} from "./time.ts";

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
const chronicle = (spans: ChronicleSpan[]) => ({ spans }) as unknown as ChronicleFile;

const time = readTime(
  chronicle([
    span("kingdom", { start: at(0) }),
    span("war", { start: at(270, 290), end: at(300), entry: "fort" }),
    span("warAgain", { start: at(500), entry: "fort" }),
    span("treaty", { point: true, start: at(300) }),
    span("reform", { point: true, start: at(300) }),
    span("ancient", { start: "open", end: at(100) }),
    span("vague"),
  ]),
);

const base = { layer: "l1", entry: null, label: null, child: null };
const zone = (id: string, extra: Record<string, unknown> = {}) =>
  ({
    id,
    kind: "zone",
    ...base,
    points: [
      [0, 0],
      [10, 0],
      [10, 10],
    ],
    ...extra,
  }) as MapFeature;
const marker = (id: string, extra: Record<string, unknown> = {}) =>
  ({ id, kind: "marker", ...base, at: [1, 1], icon: null, ...extra }) as MapFeature;
const later = (id: string, from: string) => ({
  id,
  from,
  points: [
    [0, 0],
    [14, 0],
    [14, 12],
  ] as [number, number][],
});
const map = (features: MapFeature[]) => ({ features }) as unknown as MapFile;
const plain = { selected: null, pin: null, editing: false, showAll: false };

describe("which span decides", () => {
  it("gives each of the five outcomes", () => {
    expect(spanFor(zone("z", { span: "kingdom" }), time)).toMatchObject({ how: "tied" });
    expect(spanFor(zone("z", { span: "nowhere", entry: "fort" }), time).how).toBe("tie_missing");
    expect(spanFor(marker("m", { entry: "fort" }), time)).toMatchObject({
      how: "entry",
      span: { id: "war" },
    });
    expect(spanFor(marker("m", { entry: "other" }), time).how).toBe("no_span");
    expect(spanFor(marker("m"), time).how).toBe("timeless");
    expect(spanFor(marker("m", { span: null }), time).how).toBe("timeless");
  });

  it("lets a tie win over the entry's span", () => {
    expect(spanFor(marker("m", { entry: "fort", span: "kingdom" }), time).span?.id).toBe("kingdom");
  });

  it("reads presence through it", () => {
    const fort = marker("m", { entry: "fort" });
    expect([0, 280, 295, 301].map((y) => presenceOf(fort, time, y))).toEqual([
      "not_yet",
      "perhaps",
      "there",
      "gone",
    ]);
    expect(presenceOf(zone("z", { span: "nowhere" }), time, 0)).toBe("undated");
    expect(presenceOf(zone("z", { span: "vague" }), time, 0)).toBe("undated");
    expect(presenceOf(marker("m"), time, 0)).toBe("timeless");
    expect(presenceOf(marker("m", { entry: "other" }), time, 0)).toBe("no_span");
  });
});

describe("the shape in force", () => {
  const z = zone("z", { shapes: [later("h1", "treaty"), later("h2", "warAgain")] });

  it("is the first shape, then each later one from its span's start", () => {
    expect([0, 299, 300, 499, 500, 9999].map((y) => shapeAt(z, time, y)?.id ?? null)).toEqual([
      null,
      null,
      "h1",
      "h1",
      "h2",
      "h2",
    ]);
  });

  it("takes the later in the list when two start together", () => {
    const two = zone("z", { shapes: [later("h1", "treaty"), later("h2", "reform")] });
    expect(shapeAt(two, time, 300)?.id).toBe("h2");
  });

  it("is never one whose span is missing, has no start, or starts in the open", () => {
    const odd = zone("z", {
      shapes: [later("a", "nowhere"), later("b", "vague"), later("c", "ancient")],
    });
    expect(shapeAt(odd, time, 9999)).toBeNull();
    expect(odd.shapes!.map((h) => shapeStart(odd, h, time))).toEqual([
      "unplaced",
      "unplaced",
      "unplaced",
    ]);
  });

  it("is never one that does not fit the feature", () => {
    const few = zone("z", { shapes: [{ id: "h", from: "treaty", points: [[1, 1]] }] });
    const wrong = marker("m", { shapes: [later("h", "treaty")] });
    expect(shapeStart(few, few.shapes![0]!, time)).toBe("broken");
    expect(shapeAt(wrong, time, 9999)).toBeNull();
  });
});

describe("the features as drawn", () => {
  const z = zone("z", { span: "kingdom", shapes: [later("h1", "treaty")] });
  const fort = marker("fort", { entry: "fort" });
  const coast = zone("coast");
  const m = map([z, fort, coast]);

  it("with time off, draws every feature as it is", () => {
    const drawn = resolve(m, null, 0, plain);
    expect(drawn.map((r) => [r.feature, r.opacity, r.shape])).toEqual([
      [z, 1, null],
      [fort, 1, null],
      [coast, 1, null],
    ]);
  });

  it("leaves out what is not there, fades what is perhaps there, and swaps shapes", () => {
    const ids = (year: number) => resolve(m, time, year, plain).map((r) => r.feature.id);
    expect(ids(0)).toEqual(["z", "coast"]);
    expect(ids(295)).toEqual(["z", "fort", "coast"]);
    expect(ids(310)).toEqual(["z", "coast"]);
    expect(resolve(m, time, 280, plain)[1]).toMatchObject({ presence: "perhaps", opacity: 0.45 });
    const before = resolve(m, time, 299, plain)[0]!;
    const after = resolve(m, time, 300, plain)[0]!;
    expect(before.shape).toBeNull();
    expect(after.shape).toBe("h1");
    expect((after.feature as { points: unknown }).points).toEqual(later("h1", "treaty").points);
    expect((before.feature as { points: unknown }).points).toEqual(
      (z as { points: unknown }).points,
    );
  });

  it("keeps the selected feature in sight while editing, and all of them when asked", () => {
    const editing = { ...plain, editing: true, selected: "fort" };
    expect(resolve(m, time, 0, editing)[1]).toMatchObject({ presence: "not_yet", opacity: 0.25 });
    expect(resolve(m, time, 0, { ...plain, selected: "fort" })).toHaveLength(2);
    expect(resolve(m, time, 0, { ...plain, editing: true, showAll: true })).toHaveLength(3);
  });

  it("draws a pinned shape whatever the year", () => {
    const pinLater = { ...plain, pin: { feature: "z", shape: "h1" } };
    const pinFirst = { ...plain, pin: { feature: "z", shape: null } };
    expect(resolve(m, time, 0, pinLater)[0]!.shape).toBe("h1");
    expect(resolve(m, time, 9999, pinFirst)[0]!.shape).toBeNull();
  });

  it("marks an undated feature with dashes", () => {
    const loose = map([zone("z", { span: "nowhere" })]);
    expect(resolve(loose, time, 0, plain)[0]).toMatchObject({ dashed: true, opacity: 1 });
  });
});

describe("writing a shape", () => {
  const z = zone("z", { shapes: [later("h1", "treaty")] });
  const moved: [number, number][] = [
    [5, 5],
    [6, 5],
    [6, 6],
  ];

  it("goes to the first shape or to the later one named", () => {
    expect(writeShape(z, null, { points: moved })).toMatchObject({
      points: moved,
      shapes: [later("h1", "treaty")],
    });
    const second = writeShape(z, "h1", { points: moved });
    expect((second as { points: unknown }).points).toEqual((z as { points: unknown }).points);
    expect(second.shapes).toEqual([{ id: "h1", from: "treaty", points: moved }]);
  });

  it("adds and removes later shapes, dropping the key with the last", () => {
    const one = addShape(zone("z"), "h9", "treaty", { points: moved });
    expect(one.shapes).toEqual([{ id: "h9", from: "treaty", points: moved }]);
    expect("shapes" in removeShape(one, "h9")).toBe(false);
  });

  it("ties and unties, dropping the key", () => {
    expect(tie(zone("z"), "kingdom").span).toBe("kingdom");
    expect("span" in tie(zone("z", { span: "kingdom" }), null)).toBe(false);
  });

  it("writes keys in the file's order", () => {
    const built = addShape(tie(marker("m"), "kingdom"), "h", "treaty", { at: [2, 2] });
    expect(Object.keys(built)).toEqual([
      "id",
      "kind",
      "layer",
      "at",
      "entry",
      "label",
      "icon",
      "child",
      "span",
      "shapes",
    ]);
    expect(Object.keys(built.shapes![0]!)).toEqual(["id", "from", "at"]);
  });
});

describe("the slider", () => {
  it("runs a little beyond what is placed, on round years", () => {
    expect(time.range).toEqual({ from: -5, to: 505, step: 5, latest: 500 });
    expect(clampYear(time, 1e9)).toBe(505);
    expect(clampYear(time, 12.6)).toBe(13);
    expect(clampYear(time, Number.NaN)).toBe(0);
  });

  it("has no range when nothing is placed, and a range around a single moment", () => {
    expect(readTime(chronicle([span("a"), span("b", { start: "open" })])).range).toBeNull();
    expect(readTime(chronicle([span("a", { point: true, start: at(40) })])).range).toEqual({
      from: 39,
      to: 41,
      step: 1,
      latest: 40,
    });
  });

  it("steps by a round number of years on a long chronicle", () => {
    const long = readTime(chronicle([span("a", { start: at(0), end: at(20000) })]));
    expect(long.range).toMatchObject({ step: 100, from: -100, to: 20100 });
  });

  it("visits every year at which something on the map changes", () => {
    const m = map([
      zone("z", { span: "kingdom", shapes: [later("h1", "treaty")] }),
      marker("fort", { entry: "fort" }),
      zone("coast"),
    ]);
    expect(changeYears(m, time)).toEqual([0, 270, 290, 300, 301]);
    expect(changeYears(m, readTime(chronicle([])))).toEqual([]);
  });

  it("counts the features of shown layers in four groups", () => {
    const m = map([
      zone("a", { span: "kingdom" }),
      marker("b", { entry: "fort" }),
      zone("c", { span: "vague" }),
      zone("d", { span: "nowhere" }),
      marker("e", { entry: "other" }),
      zone("f"),
      zone("g", { shapes: [later("h", "treaty")] }),
      zone("h", { layer: "hidden", span: "kingdom" }),
    ]);
    expect(countFeatures(m, time, new Set(["hidden"]))).toEqual({
      follows: 3,
      undated: 2,
      noSpan: 1,
      timeless: 1,
    });
  });

  it("says why a feature is faded, hidden or dashed", () => {
    const name = (s: ChronicleSpan) => s.name;
    const fort = marker("m", { entry: "fort" });
    expect(reasonFor(fort, time, 0, name)).toBe("Not yet: begins year 270 to 290.");
    expect(reasonFor(fort, time, 280, name)).toBe("Perhaps: begins year 270 to 290.");
    expect(reasonFor(fort, time, 295, name)).toBeNull();
    expect(reasonFor(fort, time, 400, name)).toBe("Gone: ended year 300.");
    expect(reasonFor(zone("z", { span: "vague" }), time, 0, name)).toBe(
      "Undated: vague has no numbers that say when.",
    );
    expect(reasonFor(zone("z", { span: "nowhere" }), time, 0, name)).toContain("not in this");
    expect(reasonFor(zone("z"), time, 0, name)).toBeNull();
  });
});
