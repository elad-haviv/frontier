import { describe, expect, it } from "vitest";
import {
  type MapFeature,
  type MapFile,
  type MapTerrainHint,
  mergeMaps,
  parseMap,
  serialiseMap,
} from "../src/index.js";

const zone = (id: string): MapFeature =>
  ({
    id,
    kind: "zone",
    layer: "l1",
    points: [
      [10, 10],
      [30, 10],
      [30, 30],
    ],
    entry: null,
    label: null,
    child: null,
  }) as MapFeature;

const flat = {
  version: 1,
  id: "ab12cd34",
  title: "Greywater",
  space: { kind: "flat", width: 100, height: 50, scale: 1, unit: "km" },
  images: [{ id: "i1", name: "Map", path: "maps/map.png", extent: [0, 0, 100, 50], visible: true }],
  markerSets: [],
  layers: [{ id: "l1", name: "Places", visible: true, color: "#9a3b1c" }],
  features: [zone("z1")],
} as unknown as MapFile;

const peak: MapTerrainHint = {
  id: "k3m9p2qa",
  kind: "peak",
  at: [40, 20],
  h: 0.94,
  strength: 0.7,
  state: "accepted",
  by: "found",
  conf: 0.88,
};
const river: MapTerrainHint = {
  id: "q8w2x0ra",
  kind: "river",
  points: [
    [60, 10],
    [70, 30],
  ],
  state: "waiting",
  by: "found",
  conf: 0.62,
};
const sea: MapTerrainHint = { id: "s0a1b2c3", kind: "sea", state: "accepted", by: "found" };
const tied: MapTerrainHint = {
  id: "f7g8h9j0",
  kind: "highland",
  state: "accepted",
  by: "feature:z1",
};

const withHints = (map: MapFile, hints: MapTerrainHint[]): MapFile =>
  ({ ...map, terrainHints: hints }) as MapFile;

describe("a map's terrain hints", () => {
  it("keeps the bytes of a map without any", () => {
    const text = serialiseMap(flat);
    expect(text).not.toContain("terrainHints");
    expect(serialiseMap(withHints(flat, []))).toBe(text);
  });

  it("writes them last, one a line, their keys in order, and reads them back", () => {
    const shuffled = {
      conf: 0.88,
      by: "found",
      state: "accepted",
      h: 0.94,
      at: [40, 20],
      kind: "peak",
      id: "k3m9p2qa",
      strength: 0.7,
    };
    const text = serialiseMap(
      withHints({ ...flat, terrain: { image: "maps/h.png" } } as MapFile, [
        shuffled as unknown as MapTerrainHint,
        river,
        sea,
      ]),
    );
    expect(text.indexOf('"terrainHints"')).toBeGreaterThan(text.indexOf('"terrain"'));
    expect(text).toContain(
      '{"id":"k3m9p2qa","kind":"peak","at":[40,20],"h":0.94,"strength":0.7,"state":"accepted","by":"found","conf":0.88}',
    );
    const read = parseMap(text);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.map.terrainHints).toEqual([peak, river, sea]);
    expect(serialiseMap(read.map)).toBe(text);
  });

  it("keeps the generated terrain's settings", () => {
    const generated = {
      from: "hints",
      seed: 3,
      rough: 0.5,
      sharp: 0.55,
      erosion: 0.45,
      detail: 2,
      carve: true,
      lakes: true,
      hints: "c41f0a9e",
    } as const;
    const map = { ...flat, terrain: { image: "maps/h.png", seaLevel: 0.13, generated } } as MapFile;
    const read = parseMap(serialiseMap(map));
    expect(read.ok && read.map.terrain?.generated).toEqual(generated);
  });

  it("refuses a hint of an unknown kind and two hints with one id", () => {
    const bad = { ...peak, kind: "volcano" };
    expect(parseMap(JSON.stringify(withHints(flat, [bad as never]))).ok).toBe(false);
    expect(parseMap(JSON.stringify(withHints(flat, [peak, { ...river, id: peak.id }]))).ok).toBe(
      false,
    );
  });

  it("drops a hint tied to a feature that is not there", () => {
    const read = parseMap(JSON.stringify(withHints({ ...flat, features: [] }, [peak, tied])));
    expect(read.ok && read.map.terrainHints).toEqual([peak]);
    const kept = parseMap(JSON.stringify(withHints(flat, [peak, tied])));
    expect(kept.ok && kept.map.terrainHints).toEqual([peak, tied]);
  });

  it("merges hint by hint: two devices' reviews both stay", () => {
    const base = withHints(flat, [peak, river]);
    // This device accepts the river; the other moves the peak and draws a ridge.
    const mine = withHints(flat, [peak, { ...river, state: "accepted" }]);
    const ridge: MapTerrainHint = {
      id: "r1d9e000",
      kind: "ridge",
      points: [
        [5, 5],
        [20, 5],
      ],
      h: 0.8,
      state: "accepted",
      by: "you",
    };
    const theirs = withHints(flat, [{ ...peak, at: [42, 21] }, river, ridge]);
    const { map, clashes } = mergeMaps(base, mine, theirs);
    expect(clashes).toEqual([]);
    expect(map.terrainHints).toEqual([
      { ...peak, at: [42, 21] },
      { ...river, state: "accepted" },
      ridge,
    ]);
  });

  it("names a hint both devices changed, keeping mine", () => {
    const base = withHints(flat, [river]);
    const mine = withHints(flat, [{ ...river, state: "accepted" }]);
    const theirs = withHints(flat, [{ ...river, state: "rejected" }]);
    const { map, clashes } = mergeMaps(base, mine, theirs);
    expect(clashes).toEqual([river.id]);
    expect(map.terrainHints?.[0]?.state).toBe("accepted");
  });

  it("is read by an older reader that does not know it, and kept", () => {
    // Older Frontier passes unknown keys through: a hint list from a newer device survives.
    const text = serialiseMap(withHints(flat, [peak]));
    const raw = JSON.parse(text) as Record<string, unknown>;
    const older = parseMap(JSON.stringify({ ...raw, laterThing: [1] }));
    expect(older.ok && serialiseMap(older.map)).toContain('"laterThing"');
    expect(older.ok && older.map.terrainHints?.length).toBe(1);
  });
});
