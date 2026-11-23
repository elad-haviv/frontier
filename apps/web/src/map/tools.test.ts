import type { Shape, View } from "@frontier/geo";
import type { ChronicleFile, MapFeature, MapFile } from "@frontier/schema";
import { describe, expect, it } from "vitest";
import { readTime, resolve } from "./time.ts";
import { addSketchPoint, dragShape, finishSketch, placeMarker, tapSelect } from "./tools.ts";

/** A view whose screen is the map's own units, so taps land where the numbers say. */
const view = {
  project: (p: [number, number]) => p,
  projectClamped: (p: [number, number]) => ({ point: p }),
  unproject: (x: number, y: number) => [x, y],
} as unknown as View;
/** A view on which every tap misses the map, as off the edge of a globe. */
const offTheMap = { ...view, unproject: () => null } as unknown as View;

const base = { layer: "l1", entry: null, label: null, child: null };
const marker = (id: string, extra: Record<string, unknown> = {}) =>
  ({ id, kind: "marker", ...base, at: [1, 1], icon: null, ...extra }) as MapFeature;
const zone = (id: string, extra: Record<string, unknown> = {}) =>
  ({
    id,
    kind: "zone",
    ...base,
    points: [
      [0, 0],
      [100, 0],
      [100, 100],
    ],
    ...extra,
  }) as MapFeature;
const flat = (features: MapFeature[]) =>
  ({
    space: { kind: "flat", width: 1000, height: 1000, scale: null, unit: "" },
    features,
  }) as unknown as MapFile;
const plain = { selected: null, pin: null, editing: false, showAll: false };

describe("the marker tool", () => {
  it("adds a marker to the layer drawn into, selects it, and goes back to Select", () => {
    const step = placeMarker(flat([zone("z")]), "l2", [5, 6]);
    const added = step.map!.features[1]!;
    expect(added).toMatchObject({ kind: "marker", layer: "l2", at: [5, 6], entry: null });
    expect(step.selected).toBe(added.id);
    expect(step.tool).toBe("select");
  });
});

describe("drawing a path or zone", () => {
  const map = flat([]);

  it("adds each tap as a point", () => {
    expect(addSketchPoint(map, view, "path", [[0, 0]], "l1", [50, 50])).toEqual({
      sketch: [
        [0, 0],
        [50, 50],
      ],
    });
  });

  it("ignores a tap off the map", () => {
    expect(addSketchPoint(map, offTheMap, "path", [], "l1", [50, 50])).toBeNull();
  });

  it("finishes on a tap on the last point", () => {
    const sketch: [number, number][] = [
      [0, 0],
      [100, 0],
    ];
    const step = addSketchPoint(map, view, "path", sketch, "l1", [105, 5])!;
    expect(step.map!.features[0]).toMatchObject({ kind: "path", points: sketch, layer: "l1" });
    expect(step).toMatchObject({ sketch: [], tool: "select" });
    expect(step.selected).toBe(step.map!.features[0]!.id);
  });

  it("adds nothing on the last point of a measured line", () => {
    expect(addSketchPoint(map, view, "measure", [[0, 0]], "l1", [3, 3])).toBeNull();
  });

  it("drops a zone with fewer than three points, and goes back to Select", () => {
    const step = finishSketch(
      map,
      "zone",
      [
        [0, 0],
        [10, 0],
      ],
      "l1",
    );
    expect(step).toEqual({ sketch: [], tool: "select" });
    const zoneStep = finishSketch(
      map,
      "zone",
      [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
      "l1",
    );
    expect(zoneStep.map!.features[0]).toMatchObject({ kind: "zone" });
  });
});

describe("selecting", () => {
  const shapes: Shape[] = [
    { id: "m", kind: "marker", at: [300, 300] },
    {
      id: "z",
      kind: "zone",
      points: [
        [0, 0],
        [100, 0],
        [100, 100],
      ],
    },
  ];

  it("picks a corner of the selected path or zone while editing", () => {
    expect(tapSelect(view, true, zone("z"), shapes, [98, 3])).toEqual({ vertex: 1 });
  });

  it("selects what is under the tap, and drops the picked corner", () => {
    expect(tapSelect(view, false, zone("z"), shapes, [298, 301])).toEqual({
      selected: "m",
      vertex: null,
    });
    expect(tapSelect(view, true, marker("m"), shapes, [600, 600])).toEqual({
      selected: null,
      vertex: null,
    });
  });
});

describe("dragging", () => {
  it("moves one corner of the shape on screen", () => {
    const map = flat([zone("z")]);
    const drawn = resolve(map, null, 0, plain)[0]!;
    const moved = dragShape(map, drawn, 2, [120, 130], null, 0)!;
    expect((moved as { points: number[][] }).points).toEqual([
      [0, 0],
      [100, 0],
      [120, 130],
    ]);
  });

  it("moves the later shape in force, and leaves the first", () => {
    const time = readTime({
      spans: [
        {
          id: "treaty",
          lane: "l1",
          name: "treaty",
          point: true,
          start: { words: "", low: 300, high: 300 },
          end: null,
          length: null,
          entry: null,
          note: "",
        },
      ],
    } as unknown as ChronicleFile);
    const later = {
      id: "h1",
      from: "treaty",
      points: [
        [0, 0],
        [50, 0],
        [50, 50],
      ],
    };
    const map = flat([zone("z", { shapes: [later] })]);
    const drawn = resolve(map, time, 310, plain)[0]!;
    const moved = dragShape(map, drawn, 0, [-5, -5], time, 310) as MapFeature & {
      points: number[][];
      shapes: { points: number[][] }[];
    };
    expect(moved.points[0]).toEqual([0, 0]);
    expect(moved.shapes[0]!.points[0]).toEqual([-5, -5]);
  });

  it("drops a revolving marker where the pointer is at the year shown", () => {
    const time = readTime({ spans: [] } as unknown as ChronicleFile);
    const centre = marker("ezob", { at: [500, 500] });
    const korr = marker("korr", { at: [600, 500], orbit: { around: "ezob", period: 1000 } });
    const map = flat([centre, korr]);
    // At year 250 the marker has turned a quarter of the way round.
    const drawn = resolve(map, time, 250, plain).find((r) => r.feature.id === "korr")!;
    const moved = dragShape(map, drawn, null, [500, 300], time, 250) as { at: number[] };
    // Turned back by the orbit, its own place is a quarter of the way round the other way.
    expect(moved.at[0]).toBeCloseTo(700);
    expect(moved.at[1]).toBeCloseTo(500);
    // Drawn at that year, it is where it was dropped.
    const again = resolve({ ...map, features: [centre, moved as MapFeature] }, time, 250, plain);
    expect((again[1]!.feature as { at: number[] }).at[0]).toBeCloseTo(500);
    expect((again[1]!.feature as { at: number[] }).at[1]).toBeCloseTo(300);
  });

  it("gives nothing when the feature is gone", () => {
    const map = flat([zone("z")]);
    const drawn = resolve(map, null, 0, plain)[0]!;
    expect(dragShape(flat([]), drawn, 0, [1, 1], null, 0)).toBeNull();
  });
});
