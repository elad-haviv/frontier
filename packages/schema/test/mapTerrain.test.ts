import { describe, expect, it } from "vitest";
import {
  countsAs,
  type MapFeature,
  type MapFile,
  type MapStyle,
  mergeMaps,
  parseMap,
  parseMapStyles,
  serialiseMap,
  serialiseMapStyles,
} from "../src/index.js";

const marker = (id: string, at: [number, number]): MapFeature =>
  ({ id, kind: "marker", layer: "l1", at, entry: null, label: id, icon: null, child: null }) as
    MapFeature;

const flat = {
  version: 1,
  id: "ab12cd34",
  title: "Greywater",
  space: { kind: "flat", width: 100, height: 50, scale: 1, unit: "km" },
  images: [{ id: "i1", name: "Map", path: "maps/map.png", extent: [0, 0, 100, 50], visible: true }],
  markerSets: [],
  layers: [{ id: "l1", name: "Places", visible: true, color: "#9a3b1c" }],
  features: [marker("a", [5, 5])],
} as unknown as MapFile;
const terrain = { image: "maps/heights.png", extent: [0, 0, 100, 50], seaLevel: 0.3 };
const withTerrain = { ...flat, terrain } as unknown as MapFile;

describe("a map's terrain", () => {
  it("keeps the bytes of a map without one", () => {
    const text = serialiseMap(flat);
    expect(text).not.toContain("terrain");
    expect(serialiseMap({ ...flat, terrain: null } as MapFile)).toBe(text);
    const read = parseMap(text);
    expect(read.ok && serialiseMap(read.map)).toBe(text);
  });

  it("writes it last, its keys in order, and reads it back", () => {
    const text = serialiseMap({
      ...flat,
      terrain: {
        smoothing: 2,
        rangeUnit: "m",
        range: [-360, 2600],
        seaLevel: 0.3,
        invert: true,
        extent: [0, 0, 100, 50],
        image: "maps/heights.png",
      },
    } as unknown as MapFile);
    expect(text).toContain(
      '"terrain": {"image":"maps/heights.png","extent":[0,0,100,50],"invert":true,"seaLevel":0.3,"range":[-360,2600],"rangeUnit":"m","smoothing":2}',
    );
    expect(text.indexOf('"terrain"')).toBeGreaterThan(text.indexOf('"features"'));
    const read = parseMap(text);
    expect(read.ok && serialiseMap(read.map)).toBe(text);
  });

  it("refuses a path out of the vault, a sea level off the scale and an empty extent", () => {
    const reads = (t: object) =>
      parseMap(JSON.stringify({ ...flat, terrain: { ...terrain, ...t } })).ok;
    expect(reads({})).toBe(true);
    expect(reads({ image: "../secret.png" })).toBe(false);
    expect(reads({ image: "/etc/heights.png" })).toBe(false);
    expect(reads({ seaLevel: 1.5 })).toBe(false);
    expect(reads({ range: [100, 0] })).toBe(false);
    expect(reads({ smoothing: 9 })).toBe(false);
    // Over the whole map when no extent is given.
    expect(parseMap(JSON.stringify({ ...flat, terrain: { image: "maps/h.png" } })).ok).toBe(true);
    expect(reads({ extent: [10, 0, 10, 50] })).toBe(false);
  });

  it("merges one set, changed or taken away on one side, and clashes when both change it", () => {
    expect(mergeMaps(flat, withTerrain, flat).map.terrain).toEqual(terrain);
    expect(mergeMaps(flat, flat, withTerrain).map.terrain).toEqual(terrain);
    expect(mergeMaps(withTerrain, flat, withTerrain).map.terrain).toBeUndefined();
    expect(mergeMaps(withTerrain, withTerrain, flat).map.terrain).toBeUndefined();
    const mine = { ...flat, terrain: { ...terrain, seaLevel: 0.4 } } as unknown as MapFile;
    const theirs = { ...flat, terrain: { ...terrain, seaLevel: 0.5 } } as unknown as MapFile;
    const merged = mergeMaps(withTerrain, mine, theirs);
    expect(merged.clashes).toEqual(["terrain"]);
    expect(merged.map.terrain?.seaLevel).toBe(0.4);
    // A feature added on the other side still merges beside a terrain set on this one.
    const added = { ...flat, features: [...flat.features, marker("zz", [1, 1])] };
    const both = mergeMaps(flat, withTerrain, added);
    expect(both.map.terrain).toEqual(terrain);
    expect(both.map.features.some((f) => f.id === "zz")).toBe(true);
  });
});

describe("what a style counts as", () => {
  const style = (over: object): MapStyle =>
    ({
      id: "abcd1234",
      name: "S",
      for: "path",
      color: null,
      width: 2,
      dash: "solid",
      ...over,
    }) as MapStyle;

  it("is nothing unless it says, and a usual style counts by its id", () => {
    expect(countsAs(style({}))).toBeNull();
    expect(countsAs(style({ counts: "road" }))).toBe("road");
    expect(countsAs(style({ id: "strriver" }))).toBe("river");
    expect(countsAs(style({ id: "strriver", counts: "nothing" }))).toBeNull();
    expect(countsAs(style({ id: "strwater", for: "zone" }))).toBe("water");
    expect(countsAs(null)).toBeNull();
  });

  it("is written last on its line, and a file without it keeps its bytes", () => {
    expect(serialiseMapStyles({ version: 1, styles: [style({})] })).not.toContain("counts");
    const text = serialiseMapStyles({ version: 1, styles: [style({ counts: "river" })] });
    expect(text).toContain('"dash":"solid","counts":"river"}');
    expect(parseMapStyles(text).ok).toBe(true);
  });

  it("refuses a path that counts as ground, or a zone as a line", () => {
    const reads = (s: object) => parseMapStyles(JSON.stringify({ version: 1, styles: [s] })).ok;
    expect(reads(style({ counts: "forest" }))).toBe(false);
    expect(reads(style({ for: "zone", counts: "road" }))).toBe(false);
    expect(reads(style({ for: "zone", counts: "mountains" }))).toBe(true);
  });
});
