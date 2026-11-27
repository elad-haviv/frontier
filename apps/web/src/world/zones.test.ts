import { BIOME_KINDS, MapFile } from "@frontier/schema";
import { describe, expect, it } from "vitest";
import { worldMap } from "./make.ts";
import { DEFAULT_SETTINGS, driftStep, ensure, isWater, METRES, newWorld } from "./model.ts";
import { HEIGHT_LOW, HEIGHT_SEA, paintWorld } from "./picture.ts";
import { MAX_STEP, worldZones, zoneCounts } from "./zones.ts";

function drifted() {
  const world = newWorld({ ...DEFAULT_SETTINGS, seed: 2024 });
  ensure(world, "sim");
  for (let n = 0; n < 20; n++) driftStep(world);
  return world;
}

describe("the world's biome zones", () => {
  const world = drifted();
  const zones = worldZones(world);

  it("outlines the land's biomes and the ice, never the open sea, the largest first", () => {
    expect(zones.length).toBeGreaterThan(5);
    expect(zones.every((z) => !isWater(BIOME_KINDS.indexOf(z.kind)))).toBe(true);
    expect(zones.map((z) => z.cells)).toEqual([...zones.map((z) => z.cells)].sort((a, b) => b - a));
    expect(zoneCounts(zones).reduce((n, c) => n + c.count, 0)).toBe(zones.length);
  });

  it("keeps every outline on the globe, off the poles, and in short steps of longitude", () => {
    for (const zone of zones) {
      expect(zone.points.length).toBeGreaterThanOrEqual(3);
      zone.points.forEach((p, n) => {
        const next = zone.points[(n + 1) % zone.points.length]!;
        expect(Math.abs(p[0])).toBeLessThanOrEqual(180);
        expect(Math.abs(p[1])).toBeLessThan(90);
        expect(Math.abs(next[0] - p[0])).toBeLessThanOrEqual(MAX_STEP + 0.01);
      });
    }
  });

  it("gives the map its size, its terrain and the zones as biome zones in the Biomes layer", () => {
    const made = MapFile.parse({
      version: 1,
      id: "abcd1234",
      title: "Salt Coast",
      space: { kind: "sphere", radius: null, unit: "km" },
      images: [
        {
          id: "img00001",
          name: "map",
          path: "map.png",
          extent: [-180, -90, 180, 90],
          visible: true,
        },
      ],
      markerSets: [],
      layers: [{ id: "places01", name: "Places", visible: true, color: "#9a3b1f" }],
      features: [],
    });
    const { map, add } = worldMap(made, world, zones, "Salt Coast heights.png", []);
    // What the wizard writes is a map the rest of Frontier accepts.
    const read = MapFile.parse(map);
    expect(read.space).toMatchObject({ kind: "sphere", radius: 6371 });
    expect(read.terrain).toMatchObject({
      image: "Salt Coast heights.png",
      range: [Math.round(HEIGHT_LOW * METRES), METRES],
      rangeUnit: "m",
    });
    const biomes = read.layers.find((l) => l.name === "Biomes")!;
    const drawn = read.features.filter((f) => f.kind === "zone");
    expect(drawn).toHaveLength(zones.length);
    expect(drawn.every((f) => f.layer === biomes.id && f.kind === "zone" && !!f.biome)).toBe(true);
    // Each biome used brings its usual style, once.
    expect(add.length).toBe(zoneCounts(zones).length);
    expect(new Set(add.map((s) => s.id)).size).toBe(add.length);
    // A library that has the styles is asked for none.
    expect(worldMap(made, world, zones, "h.png", add).add).toHaveLength(0);
  });
});

describe("the painted world", () => {
  it("paints a picture and a height picture that agree on where the sea is", () => {
    const world = drifted();
    ensure(world, "biome");
    const { picture, heights, w, h } = paintWorld(world, 256, 128);
    expect(picture.length).toBe(w * h * 4);
    const sea = Math.round(HEIGHT_SEA * 255);
    let land = 0;
    for (let i = 0; i < w * h; i++) {
      expect(picture[i * 4 + 3]).toBe(255);
      if (heights[i * 4]! > sea) land++;
    }
    // About as much land as the world has.
    const cells = world.elev.filter((e) => e > 0).length / world.elev.length;
    expect(Math.abs(land / (w * h) - cells)).toBeLessThan(0.05);
  });
});
