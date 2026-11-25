import { BIOMES, type BiomeKind } from "@frontier/schema";
import { describe, expect, it } from "vitest";
import type { Px } from "../findAreas/contour.ts";
import { biomeCells, biomeFactor, kmByBiome, type TerrainBiome, waterWeights } from "./biomes.ts";
import { type Ground, MODES, surfaceFor } from "./cost.ts";
import { Engine } from "./engine.ts";
import { flatGrid } from "./grid.ts";
import { courseFrom, flow } from "./hydro.ts";
import { routeThrough, type Terrain } from "./route.ts";

const W = 40;
const H = 30;
const at = (x: number, y: number) => y * W + x;
const box = (x0: number, y0: number, x1: number, y1: number): Px[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];
const zone = (
  id: string,
  kind: BiomeKind,
  ring: Px[],
  label: string | null = null,
): TerrainBiome => ({
  id,
  biome: kind,
  name: BIOMES[kind].name,
  label,
  ring,
  speed: BIOMES[kind].speed,
  rivers: BIOMES[kind].rivers,
});

function ground(paint: (g: Ground) => void = () => {}): Ground {
  const n = W * H;
  const g: Ground = {
    sea: new Uint8Array(n),
    forest: new Uint8Array(n),
    marsh: new Uint8Array(n),
    upland: new Float32Array(n),
    road: new Uint8Array(n),
    river: new Uint8Array(n),
    riverWide: new Uint8Array(n),
  };
  paint(g);
  return g;
}

describe("the biome of each cell", () => {
  const grid = flatGrid(W, H);
  it("is the smallest zone that holds it: an oasis in a desert", () => {
    const cells = biomeCells(grid, [
      zone("oasis", "wetland", box(10, 10, 14, 14)),
      zone("desert", "desert-sand", box(0, 0, 30, 25)),
    ])!;
    expect(cells.list[cells.at[at(12, 12)]! - 1]!.id).toBe("oasis");
    expect(cells.list[cells.at[at(3, 3)]! - 1]!.id).toBe("desert");
    expect(cells.at[at(35, 28)]).toBe(0);
    expect(biomeCells(grid, [])).toBeUndefined();
  });
});

describe("what a biome does to travel", () => {
  const grid = flatGrid(W, H);
  it("multiplies the open-ground speed of each way of travelling, in place of the picture's forest", () => {
    const cells = biomeCells(grid, [zone("d", "desert-sand", box(0, 0, 9.5, 29))]);
    const g = ground((x) => {
      x.forest[at(5, 5)] = 1;
      x.biomes = cells!;
    });
    const cart = surfaceFor(g, "cart", "fast");
    expect(1 / cart.inv[at(5, 5)]!).toBeCloseTo(MODES.cart.open * 0.35);
    expect(1 / cart.inv[at(20, 5)]!).toBeCloseTo(MODES.cart.open);
    expect(biomeFactor(cells, "ship", at(5, 5))).toBe(BIOMES["desert-sand"].speed.foot);
    expect(biomeFactor(cells, "foot", at(20, 5))).toBe(-1);
  });

  it("blocks a cart in the jungle except on the road through it", () => {
    const cells = biomeCells(grid, [zone("j", "jungle", box(15, -1, 25, 31))]);
    const t: Terrain = { grid, heights: new Float32Array(W * H), kmPerCell: 1, rise: 1 };
    const without = surfaceFor(
      ground((x) => (x.biomes = cells!)),
      "cart",
      "fast",
    );
    expect(without.inv[at(20, 5)]).toBe(Infinity);
    expect(routeThrough(t, without, [at(2, 15), at(37, 15)])).toBeNull();
    const withRoad = surfaceFor(
      ground((x) => {
        x.biomes = cells!;
        for (let xx = 10; xx < 30; xx++) x.road[at(xx, 20)] = 1;
      }),
      "cart",
      "fast",
    );
    const legs = routeThrough(t, withRoad, [at(2, 15), at(37, 15)]);
    expect(legs).not.toBeNull();
    // On foot the jungle is slow, not closed.
    expect(
      1 /
        surfaceFor(
          ground((x) => (x.biomes = cells!)),
          "foot",
          "fast",
        ).inv[at(20, 5)]!,
    ).toBeCloseTo(MODES.foot.open * 0.4);
  });

  it("tallies the km of a route in each biome", () => {
    const cells = biomeCells(grid, [zone("d", "desert-sand", box(0, 0, 9.5, 29))]);
    const route = [at(8, 5), at(9, 5), at(10, 5), at(11, 5)];
    expect(kmByBiome(cells, route, () => 2)).toEqual([
      { biome: "desert-sand", name: "Desert (sand)", km: 2, speed: BIOMES["desert-sand"].speed },
    ]);
  });
});

describe("what a biome does to water", () => {
  // A long slope falling east, off the map's edge.
  const w = 60;
  const h = 9;
  const grid = flatGrid(w, h);
  const heights = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) heights[y * w + x] = 1 - x / w + Math.abs(y - 4) * 0.05;
  const sea = new Uint8Array(w * h);
  const ring = (x0: number, x1: number): Px[] => [
    [x0, -1],
    [x1, -1],
    [x1, h],
    [x0, h],
  ];
  const zoneOn = (kind: BiomeKind, x0: number, x1: number) =>
    biomeCells(grid, [{ ...zone("z", kind, ring(x0, x1)), biome: kind }])!;

  it("dries a small river out in a desert, and lets a big one cross", () => {
    const desert = zoneOn("desert-sand", 30, 61);
    const stopIn = (f: ReturnType<typeof flow>) => (_a: number, b: number) =>
      f.acc[b]! < 3 && desert.at[b] ? ("dry" as const) : null;
    // Each row on its own, falling east: a small stream.
    const ramp = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) ramp[y * w + x] = 1 - x / w;
    const small = flow(grid, ramp, sea, waterWeights(desert, 1));
    const course = courseFrom(small, sea, 1 * w + 20, null, stopIn(small));
    expect(course.end).toBe("dry");
    expect(course.cells.length).toBeLessThan(25);
    // The whole valley gathered: a big river, which crosses with less water than it had.
    const big = flow(grid, heights, sea, waterWeights(desert, 1));
    expect(courseFrom(big, sea, 4 * w + 25, null, stopIn(big)).end).toBe("edge");
    expect(flow(grid, heights, sea).acc[4 * w + 50]!).toBeGreaterThan(big.acc[4 * w + 50]!);
  });

  it("gives more water where rivers rise", () => {
    const wet = zoneOn("jungle", 0, 30);
    const f = flow(grid, heights, sea, waterWeights(wet, 1));
    expect(f.acc[4 * w + 40]!).toBeGreaterThan(flow(grid, heights, sea).acc[4 * w + 40]!);
  });
});

describe("Find paths with biome zones", () => {
  const Wp = 120;
  const Hp = 60;
  /** Land falling gently east, with no picture: the heights alone. */
  function engine(): Engine {
    const e = new Engine(null, null, { w: Wp, h: Hp });
    const heights = new Float32Array(Wp * Hp);
    for (let y = 0; y < Hp; y++)
      for (let x = 0; x < Wp; x++)
        heights[y * Wp + x] = 0.6 - (x / Wp) * 0.5 + Math.abs(y - 30) * 0.004;
    e.setHeights(heights, { seaLevel: 0, top: 500 });
    return e;
  }

  it("ends a river in a marsh it reaches, naming it", () => {
    const e = engine();
    e.setTerrain({
      useHeights: true,
      follow: false,
      features: [],
      kmPerPx: 1,
      biomes: [zone("m", "wetland", box(70, 10, 90, 50), "Mire of Ost")],
    });
    const river = e.river({
      at: [10, 30],
      from: "source",
      exact: true,
      meander: 0,
      eps: 0.5,
      snap: false,
    });
    expect(river.ok && river.end).toBe("marsh");
    expect(river.ok && river.endIn).toBe("the Mire of Ost");
    const last = river.ok ? river.points[river.points.length - 1]! : [0, 0];
    expect(last[0]).toBeGreaterThan(68);
    expect(last[0]).toBeLessThan(80);
  });

  it("times a route with and without the biomes, and gives the km in each", () => {
    const e = engine();
    e.setTerrain({
      useHeights: true,
      follow: false,
      features: [],
      kmPerPx: 1,
      biomes: [
        zone("s", "scrub", box(-1, -1, 121, 61)),
        zone("d", "desert-sand", box(40, 20, 80, 40)),
      ],
    });
    const r = e.route({
      stops: [
        [5, 30],
        [115, 30],
      ],
      mode: "cart",
      variant: "fast",
      eps: 0.5,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.withoutBiomes).not.toBeNull();
    expect(r.hours!).toBeGreaterThan(r.withoutBiomes!);
    expect(r.byBiome.map((b) => b.biome)).toContain("scrub");
    const total = r.byBiome.reduce((s, b) => s + b.km, 0);
    expect(total).toBeGreaterThan(100);
    // Without biomes nothing is told.
    e.setTerrain({ useHeights: true, follow: false, features: [], kmPerPx: 1 });
    const plain = e.route({
      stops: [
        [5, 30],
        [115, 30],
      ],
      mode: "cart",
      variant: "fast",
      eps: 0.5,
    });
    expect(plain.ok && plain.withoutBiomes).toBeNull();
    expect(plain.ok && plain.byBiome).toEqual([]);
  });
});
