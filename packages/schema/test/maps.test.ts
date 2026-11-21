import { describe, expect, it } from "vitest";
import {
  extentProblem,
  type MapFeature,
  type MapFile,
  mapIdOf,
  mapPath,
  mergeMaps,
  parseMap,
  reorderFeature,
  serialiseMap,
  wholeExtent,
} from "../src/index.js";

const marker = (
  id: string,
  at: [number, number],
  extra: Record<string, unknown> = {},
): MapFeature =>
  ({
    id,
    kind: "marker",
    layer: "l1",
    at,
    entry: null,
    label: id,
    icon: null,
    child: null,
    ...extra,
  }) as MapFeature;

const base: MapFile = {
  version: 1,
  id: "m8k2x0aa",
  title: "Ezob",
  space: { kind: "sphere", radius: null, unit: "km" },
  images: [
    {
      id: "i1",
      name: "Political",
      path: "99 Appendices/01 Images/ezob-map.png",
      extent: [-180, -90, 180, 90],
      visible: true,
    },
  ],
  markerSets: ["Skyrim"],
  layers: [{ id: "l1", name: "Cities", visible: true, color: "#9a3b1f" }],
  features: [
    marker("f1", [12.5, 44.1], { entry: "k3f9x2ab", icon: { set: "Skyrim", name: "Fort" } }),
    {
      id: "f2",
      kind: "path",
      layer: "l1",
      points: [
        [12.5, 44.1],
        [20, 40],
      ],
      entry: null,
      label: "The Salt Road",
      child: null,
    },
    {
      id: "f3",
      kind: "zone",
      layer: "l1",
      points: [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
      entry: "p2m4q8zz",
      label: null,
      child: "c7d1e5ff",
    },
  ],
};
const copy = (m: MapFile): MapFile => JSON.parse(JSON.stringify(m)) as MapFile;
const edit = (change: (m: MapFile) => void): MapFile => {
  const m = copy(base);
  change(m);
  return m;
};
const ids = (m: MapFile) => m.features.map((f) => f.id);

describe("the map file", () => {
  it("is written with one item per line and reads back the same", () => {
    const text = serialiseMap(base);
    const lines = text.split("\n");
    expect(lines[0]).toBe("{");
    expect(lines[1]).toBe('  "version": 1,');
    expect(lines.filter((l) => l.startsWith('    {"id":"f'))).toHaveLength(3);
    expect(text.endsWith("}\n")).toBe(true);
    const back = parseMap(text);
    expect(back.ok && back.map).toEqual(base);
    // The same map gives the same bytes whatever order its keys arrived in.
    const shuffled = Object.fromEntries(Object.entries(base).reverse()) as MapFile;
    expect(serialiseMap(shuffled)).toBe(text);
    expect(serialiseMap(edit((m) => (m.features = [])))).toContain('  "features": []\n');
  });

  it("keeps keys it does not know, on the map and on its items", () => {
    const text = serialiseMap(base)
      .replace('"child":null}', '"child":null,"from":"founded","until":"destroyed"}')
      .replace('  "title": "Ezob",', '  "title": "Ezob",\n  "note": "kept",');
    const back = parseMap(text);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    const again = serialiseMap(back.map);
    expect(again).toContain('"from":"founded","until":"destroyed"');
    expect(again).toContain('"note": "kept"');
  });

  it("says why a file is not a map", () => {
    const bad = (change: (m: Record<string, unknown>) => void) => {
      const m = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
      change(m);
      const r = parseMap(JSON.stringify(m));
      return r.ok ? "ok" : r.message;
    };
    expect(parseMap("{ nope").ok).toBe(false);
    expect(bad((m) => (m["version"] = 2))).toMatch(/version 2/);
    expect(bad((m) => delete m["title"])).toMatch(/title/);
    expect(bad((m) => ((m["features"] as { layer: string }[])[0]!.layer = "gone"))).toMatch(
      /layer that does not exist/,
    );
    expect(bad((m) => ((m["features"] as { id: string }[])[1]!.id = "f1"))).toMatch(/share an id/);
    expect(bad((m) => ((m["features"] as { points: unknown }[])[1]!.points = [[1, 2]]))).not.toBe(
      "ok",
    );
    expect(bad((m) => (m["layers"] = []))).not.toBe("ok");
    expect(bad(() => undefined)).toBe("ok");
  });

  it("knows where a map is kept", () => {
    expect(mapPath("m8k2x0aa")).toBe(".frontier/maps/m8k2x0aa.json");
    expect(mapIdOf(".frontier/maps/m8k2x0aa.json")).toBe("m8k2x0aa");
    expect(mapIdOf(".frontier/maps/readme.md")).toBeNull();
    expect(mapIdOf("02 People/Mira.md")).toBeNull();
  });
});

describe("merging two versions of a map", () => {
  it("takes what each side added, in a steady order", () => {
    const mine = edit((m) => m.features.push(marker("mine", [1, 1])));
    const theirs = edit((m) => m.features.push(marker("theirs", [2, 2])));
    const merged = mergeMaps(base, mine, theirs);
    expect(merged.clashes).toEqual([]);
    expect(ids(merged.map)).toEqual(["f1", "f2", "f3", "theirs", "mine"]);
    expect(parseMap(serialiseMap(merged.map)).ok).toBe(true);
  });

  it("takes a change or a removal made on one side only", () => {
    const mine = edit((m) => {
      (m.features[0] as { at: number[] }).at = [13, 45];
      m.title = "Ezob, the world";
    });
    const theirs = edit((m) => {
      m.features.splice(1, 1);
      m.layers.push({ id: "l2", name: "Roads", visible: true, color: "#333333" });
      m.space = { kind: "sphere", radius: 6000, unit: "km" };
    });
    const { map, clashes } = mergeMaps(base, mine, theirs);
    expect(clashes).toEqual([]);
    expect(ids(map)).toEqual(["f1", "f3"]);
    expect((map.features[0] as { at: number[] }).at).toEqual([13, 45]);
    expect(map.title).toBe("Ezob, the world");
    expect(map.space).toMatchObject({ radius: 6000 });
    expect(map.layers.map((l) => l.id)).toEqual(["l1", "l2"]);
    // And the other way round.
    const swapped = mergeMaps(base, theirs, mine);
    expect(swapped.clashes).toEqual([]);
    expect(ids(swapped.map)).toEqual(["f1", "f3"]);
    expect(swapped.map.title).toBe("Ezob, the world");
  });

  it("accepts the same change made on both sides", () => {
    const both = edit((m) => ((m.features[0] as { at: number[] }).at = [13, 45]));
    expect(mergeMaps(base, both, copy(both)).clashes).toEqual([]);
  });

  it("names each clash and keeps mine", () => {
    const mine = edit((m) => {
      (m.features[0] as { at: number[] }).at = [1, 1];
      m.features.splice(1, 1);
      (m.features[1] as { label: string | null }).label = "Mine";
      m.title = "Mine";
    });
    const theirs = edit((m) => {
      (m.features[0] as { at: number[] }).at = [2, 2];
      (m.features[1] as { label: string | null }).label = "Changed by them";
      m.features.splice(2, 1);
      m.title = "Theirs";
    });
    const { map, clashes } = mergeMaps(base, mine, theirs);
    expect(clashes.sort()).toEqual(["f1", "f2", "f3", "title"]);
    expect((map.features.find((f) => f.id === "f1") as { at: number[] }).at).toEqual([1, 1]);
    // I removed f2 while they changed it: my removal stands. They removed f3 while I changed it: mine stays.
    expect(ids(map).sort()).toEqual(["f1", "f3"]);
    expect(map.title).toBe("Mine");
  });

  it("moves a feature out of a layer the other side removed", () => {
    const withTwo = edit((m) =>
      m.layers.push({ id: "l2", name: "Roads", visible: true, color: "#333333" }),
    );
    const mine = JSON.parse(JSON.stringify(withTwo)) as MapFile;
    mine.features.push(marker("new", [3, 3], { layer: "l2" }));
    const theirs = JSON.parse(JSON.stringify(withTwo)) as MapFile;
    theirs.layers.pop();
    const { map } = mergeMaps(withTwo, mine, theirs);
    expect(map.layers.map((l) => l.id)).toEqual(["l1"]);
    expect(map.features.find((f) => f.id === "new")!.layer).toBe("l1");
    expect(parseMap(serialiseMap(map)).ok).toBe(true);
  });
});

describe("the extent of an image", () => {
  const sphere = base.space;
  const flat = { kind: "flat", width: 800, height: 600, scale: null, unit: "km" } as const;

  it("starts as the whole of the map's space", () => {
    expect(wholeExtent(sphere)).toEqual([-180, -90, 180, 90]);
    expect(wholeExtent(flat)).toEqual([0, 0, 800, 600]);
    expect(extentProblem(sphere, wholeExtent(sphere))).toBeNull();
    expect(extentProblem(flat, wholeExtent(flat))).toBeNull();
  });

  it("accepts a part of the globe and says what is wrong with anything else", () => {
    expect(extentProblem(sphere, [-20, 10, 40, 55])).toBeNull();
    expect(extentProblem(sphere, [-20, 10, 40])).toMatch(/number/);
    expect(extentProblem(sphere, [-20, Number.NaN, 40, 55])).toMatch(/number/);
    expect(extentProblem(sphere, [-200, 10, 40, 55])).toMatch(/West and east/);
    expect(extentProblem(sphere, [-20, 10, 200, 55])).toMatch(/West and east/);
    expect(extentProblem(sphere, [-20, -100, 40, 55])).toMatch(/South and north/);
    expect(extentProblem(sphere, [-20, 10, 40, 95])).toMatch(/South and north/);
    expect(extentProblem(sphere, [40, 10, -20, 55])).toMatch(/West must be less/);
    expect(extentProblem(sphere, [-20, 55, 40, 55])).toMatch(/South must be less/);
  });

  it("lets an image of a flat map lie anywhere, as long as it has a size", () => {
    expect(extentProblem(flat, [-100, -50, 2000, 900])).toBeNull();
    expect(extentProblem(flat, [100, 0, 100, 50])).toMatch(/Left must be less/);
    expect(extentProblem(flat, [0, 50, 100, 20])).toMatch(/Top must be less/);
  });
});

describe("reordering features", () => {
  const list: MapFeature[] = [
    marker("a", [0, 0]),
    marker("b", [1, 1], { layer: "l2" }),
    base.features[1]!,
    marker("c", [2, 2]),
    marker("d", [3, 3]),
  ];
  const order = (features: MapFeature[]) => features.map((f) => f.id).join("");

  it("passes the nearest feature of the same kind in the same layer", () => {
    expect(order(reorderFeature(list, "a", 1))).toBe("cbf2ad");
    expect(order(reorderFeature(list, "d", -1))).toBe("abf2dc");
    expect(order(reorderFeature(list, "c", -1))).toBe("cbf2ad");
    expect(list.map((f) => f.id)).toEqual(["a", "b", "f2", "c", "d"]);
  });

  it("returns the same list when there is nothing to pass", () => {
    expect(reorderFeature(list, "a", -1)).toBe(list);
    expect(reorderFeature(list, "d", 1)).toBe(list);
    expect(reorderFeature(list, "b", 1)).toBe(list);
    expect(reorderFeature(list, "f2", -1)).toBe(list);
    expect(reorderFeature(list, "nobody", 1)).toBe(list);
  });
});
