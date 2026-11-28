import { BIOME_KINDS, MapFile } from "@frontier/schema";
import { describe, expect, it } from "vitest";
import { RIVERS_LAYER, systemMap, worldMap } from "./make.ts";
import { DEFAULT_SETTINGS, driftStep, ensure, isWater, METRES, newWorld } from "./model.ts";
import { HEIGHT_LOW, HEIGHT_SEA, paintWorld } from "./picture.ts";
import { lakesOf, riversOf } from "./rivers.ts";
import { DEFAULT_SYSTEM } from "./system.ts";
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

    // With rivers: paths in a Rivers layer, in the River style, which is added once.
    const rivers = riversOf(world);
    const wet = worldMap(made, world, zones, "h.png", [], rivers);
    const readWet = MapFile.parse(wet.map);
    const layer = readWet.layers.find((l) => l.name === RIVERS_LAYER)!;
    const paths = readWet.features.filter((f) => f.kind === "path");
    expect(paths.length).toBeGreaterThanOrEqual(rivers.length);
    expect(
      paths.every((f) => f.layer === layer.id && f.kind === "path" && f.style === "strriver"),
    ).toBe(true);
    expect(wet.add.filter((s) => s.id === "strriver")).toHaveLength(1);
    // And lakes: zones in the same layer, in the Water style, under the rivers.
    const lakes = lakesOf(world);
    const both = worldMap(made, world, zones, "h.png", [], rivers, lakes);
    const readBoth = MapFile.parse(both.map);
    const waterLayer = readBoth.layers.find((l) => l.name === RIVERS_LAYER)!;
    const shores = readBoth.features.filter((f) => f.kind === "zone" && f.style === "strwater");
    expect(shores.length).toBeGreaterThan(0);
    expect(shores.every((f) => f.layer === waterLayer.id)).toBe(true);
    expect(both.add.filter((s) => s.id === "strwater")).toHaveLength(1);
  });

  it("fills the system model: the star, a companion, the planets, the world as home with its moons", () => {
    const made = MapFile.parse({
      version: 1,
      id: "sys00001",
      title: "Salt Coast system",
      space: { kind: "system", unit: "AU" },
      images: [],
      markerSets: [],
      layers: [{ id: "bodies01", name: "Bodies", visible: true, color: "#f2d28a" }],
      features: [
        {
          id: "star0001",
          kind: "marker",
          layer: "bodies01",
          at: [0, 0],
          entry: null,
          label: "The star",
          icon: null,
          child: null,
          body: { type: "star", a: 0, mass: 1 },
        },
      ],
    });
    const map = MapFile.parse(
      systemMap(
        made,
        { ...DEFAULT_SYSTEM, star: "K", twin: true, moons: 2 },
        "Salt Coast",
        "globe001",
      ),
    );
    const bodies = map.features.flatMap((f) =>
      f.kind === "marker" && f.body ? [{ f, b: f.body }] : [],
    );
    expect(bodies.find((x) => x.b.type === "star")).toMatchObject({
      f: { label: "Orange star" },
      b: { mass: 0.75 },
    });
    expect(bodies.filter((x) => x.b.type === "companion")).toHaveLength(1);
    const planets = bodies.filter((x) => ["rocky", "gas", "ice"].includes(x.b.type));
    expect(planets).toHaveLength(DEFAULT_SYSTEM.planets.length);
    expect(planets.every((x) => x.b.parent === "star0001")).toBe(true);
    const home = planets.filter((x) => x.b.home);
    expect(home).toHaveLength(1);
    expect(home[0]!.f).toMatchObject({ label: "Salt Coast", child: "globe001" });
    expect(home[0]!.b.a).toBeCloseTo(1.02, 2);
    const moons = bodies.filter((x) => x.b.type === "moon");
    expect(moons.map((x) => x.b.parent)).toEqual([home[0]!.f.id, home[0]!.f.id]);
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
