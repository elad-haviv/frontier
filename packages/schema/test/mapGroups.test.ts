import { describe, expect, it } from "vitest";
import {
  type MapFeature,
  type MapFile,
  type MapGroup,
  mergeMaps,
  orderGroup,
  parseMap,
  repairGroups,
  serialiseMap,
} from "../src/index.js";

const zone = (id: string, x: number, extra: Record<string, unknown> = {}): MapFeature =>
  ({
    id,
    kind: "zone",
    layer: "l1",
    points: [
      [x, 0],
      [x + 10, 0],
      [x + 10, 10],
    ],
    entry: null,
    label: id,
    child: null,
    ...extra,
  }) as MapFeature;

const realm: MapGroup = { id: "g1", layer: "l1", label: "Aldmere", entry: null };

const base: MapFile = {
  version: 1,
  id: "m8k2x0aa",
  title: "The Aldmere Isles",
  space: { kind: "flat", width: 100, height: 100, scale: null, unit: "km" },
  images: [],
  markerSets: [],
  layers: [
    { id: "l1", name: "Realms", visible: true, color: "#8a5a9e" },
    { id: "l2", name: "Places", visible: true, color: "#2f5d8a" },
  ],
  features: [
    zone("calder", 0, { group: "g1" }),
    zone("skerra", 20, { group: "g1" }),
    zone("wyn", 40),
  ],
  groups: [realm],
};
const copy = (m: MapFile): MapFile => JSON.parse(JSON.stringify(m)) as MapFile;
const edit = (change: (m: MapFile) => void): MapFile => {
  const m = copy(base);
  change(m);
  return m;
};
const read = (text: string) => {
  const parsed = parseMap(text);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.map;
};
const membersOf = (m: MapFile, group: string) =>
  m.features.filter((f) => f.group === group).map((f) => f.id);
const ungrouped = (m: MapFile) => {
  delete m.groups;
  for (const f of m.features) delete (f as { group?: string }).group;
};

describe("groups in the map file", () => {
  it("leaves a map without groups byte for byte as it was", () => {
    const old = edit(ungrouped);
    const text = serialiseMap(old);
    expect(text).not.toContain("group");
    expect(serialiseMap(read(text))).toBe(text);
    // An empty list and a null membership say nothing, and are left out too.
    const empty = {
      ...old,
      groups: [],
      features: old.features.map((f) => ({ ...f, group: null })),
    };
    expect(serialiseMap(empty)).toBe(text);
  });

  it("writes the groups after the features, and a membership last on its feature", () => {
    const text = serialiseMap(base);
    const lines = text.split("\n");
    expect(lines.findIndex((l) => l.includes('"groups"'))).toBeGreaterThan(
      lines.findIndex((l) => l.includes('"features"')),
    );
    expect(text).toContain('"child":null,"group":"g1"}');
    expect(text).toContain('{"id":"g1","layer":"l1","label":"Aldmere","entry":null}');
    expect(serialiseMap(read(text))).toBe(text);
  });

  it("writes a group's keys in a steady order and leaves out the defaults", () => {
    const full = orderGroup({
      locked: true,
      spacing: 0.4,
      at: [5, 5],
      write: false,
      span: "s1",
      child: null,
      entry: "k3f9x2ab",
      label: null,
      layer: "l1",
      id: "g1",
    } as MapGroup);
    expect(Object.keys(full)).toEqual([
      "id",
      "layer",
      "label",
      "entry",
      "span",
      "write",
      "at",
      "spacing",
      "locked",
    ]);
    const plain = orderGroup({ ...realm, locked: false, child: null, span: null });
    expect(Object.keys(plain)).toEqual(["id", "layer", "label", "entry"]);
  });

  it("refuses two groups with one id, and a name colour that is not one", () => {
    const twice = edit((m) => (m.groups = [realm, { ...realm, label: "Again" }]));
    expect(parseMap(JSON.stringify(twice))).toMatchObject({ ok: false });
    const odd = edit((m) => (m.groups = [{ ...realm, color: "purple" }]));
    expect(parseMap(JSON.stringify(odd)).ok).toBe(false);
  });

  it("reads a membership that names no group, or a group in another layer, as none", () => {
    const wrong = edit((m) => {
      m.features[2] = zone("wyn", 40, { group: "gone" });
      m.features.push(zone("isle", 60, { group: "g1", layer: "l2" }));
    });
    const map = read(JSON.stringify(wrong));
    expect(membersOf(map, "g1")).toEqual(["calder", "skerra"]);
    expect(map.features.find((f) => f.id === "wyn")!.group).toBeUndefined();
    expect(map.features.find((f) => f.id === "isle")!.group).toBeUndefined();
  });

  it("drops a group with no members, and moves one out of a missing layer with its members", () => {
    const empty = edit((m) => {
      for (const f of m.features) delete (f as { group?: string }).group;
    });
    expect(repairGroups(empty).groups).toBeUndefined();
    const lost = edit((m) => {
      m.groups = [{ ...realm, layer: "nowhere" }];
      for (const f of m.features) if (f.group) f.layer = "nowhere";
    });
    const merged = mergeMaps(lost, lost, lost).map;
    expect(merged.groups![0]!.layer).toBe("l1");
    expect(membersOf(merged, "g1")).toEqual(["calder", "skerra"]);
    expect(repairGroups(base)).toBe(base);
  });
});

describe("merging groups", () => {
  it("keeps members added on both devices", () => {
    const mine = edit((m) => (m.features[2] = zone("wyn", 40, { group: "g1" })));
    const theirs = edit((m) => m.features.push(zone("isle", 60, { group: "g1" })));
    const { map, clashes } = mergeMaps(base, mine, theirs);
    expect(clashes).toEqual([]);
    expect(membersOf(map, "g1").sort()).toEqual(["calder", "isle", "skerra", "wyn"]);
  });

  it("keeps a rename on one device and a moved member on the other, without a clash", () => {
    const mine = edit((m) => (m.groups![0]!.label = "Aldmere Isles"));
    const theirs = edit((m) => {
      (m.features[0] as { points: number[][] }).points[0] = [1, 1];
    });
    const { map, clashes } = mergeMaps(base, mine, theirs);
    expect(clashes).toEqual([]);
    expect(map.groups![0]!.label).toBe("Aldmere Isles");
    expect((map.features[0] as { points: number[][] }).points[0]).toEqual([1, 1]);
  });

  it("takes members out of a group the other device removed", () => {
    // I added Wyn to the realm; they ungrouped it.
    const mine = edit((m) => (m.features[2] = zone("wyn", 40, { group: "g1" })));
    const theirs = edit(ungrouped);
    const { map } = mergeMaps(base, mine, theirs);
    expect(map.groups).toBeUndefined();
    expect(map.features.every((f) => f.group == null)).toBe(true);
  });

  it("takes a member out when the other device moved it to another layer", () => {
    const mine = edit((m) => (m.groups![0]!.label = "Aldmere Isles"));
    const theirs = edit((m) => {
      m.features[1]!.layer = "l2";
    });
    const { map } = mergeMaps(base, mine, theirs);
    expect(membersOf(map, "g1")).toEqual(["calder"]);
    expect(map.features[1]!.layer).toBe("l2");
  });

  it("names a group both devices changed differently as a clash, and keeps mine", () => {
    const mine = edit((m) => (m.groups![0]!.label = "Mine"));
    const theirs = edit((m) => (m.groups![0]!.label = "Theirs"));
    const { map, clashes } = mergeMaps(base, mine, theirs);
    expect(clashes).toEqual(["g1"]);
    expect(map.groups![0]!.label).toBe("Mine");
  });
});
