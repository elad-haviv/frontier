import { describe, expect, it } from "vitest";
import type { MapFeature, MapFile } from "@frontier/schema";
import { groupsAt } from "../src/ai/discover.js";

const island = (id: string, x: number, group?: string): MapFeature =>
  ({
    id,
    kind: "zone",
    layer: "l1",
    points: [
      [x, 0],
      [x + 10, 0],
      [x + 10, 10],
      [x, 10],
    ],
    entry: null,
    label: null,
    child: null,
    ...(group ? { group } : {}),
  }) as MapFeature;

const map = {
  version: 1,
  id: "isles001",
  title: "Isles",
  space: { kind: "flat", width: 100, height: 100, scale: null, unit: "km" },
  images: [],
  markerSets: [],
  layers: [{ id: "l1", name: "Realms", visible: true, color: "#884422" }],
  features: [island("calder", 0, "g1"), island("skerra", 20, "g1"), island("wyn", 40)],
  groups: [{ id: "g1", layer: "l1", label: "Aldmere", entry: "aldmere1" }],
} as MapFile;

describe("the groups a place lies in", () => {
  it("holds a point on any of its pieces, and not one on a piece outside it", () => {
    expect(groupsAt(map, [5, 5], map.features).map((g) => g.id)).toEqual(["g1"]);
    expect(groupsAt(map, [25, 5], map.features).map((g) => g.id)).toEqual(["g1"]);
    expect(groupsAt(map, [45, 5], map.features)).toEqual([]);
    expect(groupsAt(map, [15, 5], map.features)).toEqual([]);
  });

  it("leaves out a piece that is not there at the moment shown", () => {
    const now = map.features.filter((f) => f.id !== "skerra");
    expect(groupsAt(map, [25, 5], now)).toEqual([]);
  });
});
