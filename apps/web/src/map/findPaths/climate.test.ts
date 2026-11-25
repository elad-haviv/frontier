import { BIOME_KINDS, type BiomeKind } from "@frontier/schema";
import { describe, expect, it } from "vitest";
import type { Px } from "../findAreas/contour.ts";
import { type ClimateInput, classify, climateOf, SEA, seaDistance } from "./climate.ts";
import { flatGrid } from "./grid.ts";
import { regionsOf } from "./regions.ts";
import { suggestBiomes } from "./suggest.ts";

const W = 120;
const H = 60;

/** Sea along the west edge, land rising to a north–south ridge at x = 60, and falling east. */
function ridge(top = 2400): { metres: Float32Array; sea: Uint8Array } {
  const metres = new Float32Array(W * H);
  const sea = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (x < 10) sea[i] = 1;
      else metres[i] = Math.max(0, top * (1 - Math.abs(x - 60) / 50));
    }
  }
  return { metres, sea };
}

const input = (over: Partial<ClimateInput> = {}): ClimateInput => {
  const { metres, sea } = ridge();
  return {
    w: W,
    h: H,
    metres,
    sea,
    kmPerCell: 2,
    catchment: new Float32Array(W * H),
    lat: 40,
    span: 1,
    wind: "W",
    temp: 0,
    wet: 1,
    ...over,
  };
};

const mean = (field: Float32Array, x0: number, x1: number) => {
  let s = 0;
  let n = 0;
  for (let y = 5; y < H - 5; y++) {
    for (let x = x0; x < x1; x++) {
      s += field[y * W + x]!;
      n++;
    }
  }
  return s / n;
};
const share = (label: Uint8Array, kinds: BiomeKind[], x0: number, x1: number) => {
  const want = new Set(kinds.map((k) => BIOME_KINDS.indexOf(k)));
  let hit = 0;
  let n = 0;
  for (let y = 5; y < H - 5; y++)
    for (let x = x0; x < x1; x++) {
      n++;
      if (want.has(label[y * W + x]!)) hit++;
    }
  return hit / n;
};

describe("the biome table", () => {
  it("reads temperature, rain and height as Whittaker does", () => {
    expect(classify(-10, 50, 0)).toBe("ice");
    expect(classify(-3, 50, 2000)).toBe("alpine");
    expect(classify(-3, 50, 100)).toBe("tundra");
    expect(classify(3, 60, 100)).toBe("taiga");
    expect(classify(10, 100, 100)).toBe("forest");
    expect(classify(10, 50, 100)).toBe("grassland");
    expect(classify(15, 50, 100)).toBe("scrub");
    expect(classify(16, 10, 100)).toBe("desert-sand");
    expect(classify(8, 10, 100)).toBe("desert-rock");
    expect(classify(25, 80, 100)).toBe("savanna");
    expect(classify(25, 200, 100)).toBe("jungle");
    expect(classify(25, 20, 100)).toBe("desert-sand");
  });

  it("measures the distance to the sea in km", () => {
    const sea = new Uint8Array(10 * 3);
    for (let y = 0; y < 3; y++) sea[y * 10] = 1;
    const d = seaDistance(10, 3, sea, 2);
    expect(d[1 * 10 + 5]).toBeCloseTo(10);
  });
});

describe("the climate", () => {
  it("rains on the windward side of a range and leaves a shadow behind it", () => {
    const west = climateOf(input({ wind: "W" }));
    expect(mean(west.P, 30, 55)).toBeGreaterThan(mean(west.P, 70, 110) * 1.5);
    // With the wind from the east, the shadow moves to the west side.
    const east = climateOf(input({ wind: "E" }));
    expect(mean(east.P, 70, 110)).toBeGreaterThan(mean(east.P, 30, 55));
    // Drier behind the range: desert or scrub there, forest or grass in front.
    expect(share(west.label, ["desert-sand", "desert-rock", "scrub"], 75, 110)).toBeGreaterThan(
      0.5,
    );
    expect(share(west.label, ["forest", "grassland", "taiga"], 15, 45)).toBeGreaterThan(0.5);
  });

  it("is colder on the heights and towards the poles: alpine and ice on a cold top", () => {
    const cold = climateOf(input({ lat: 58, metres: ridge(4200).metres }));
    const top = cold.label[30 * W + 60]!;
    expect(["alpine", "ice"]).toContain(BIOME_KINDS[top]);
    const warm = climateOf(input({ lat: 5 }));
    expect(warm.T[30 * W + 20]!).toBeGreaterThan(cold.T[30 * W + 20]!);
    expect(climateOf(input({ temp: 5 })).T[30 * W + 20]!).toBeCloseTo(
      climateOf(input()).T[30 * W + 20]! + 5,
    );
    expect(cold.label[30 * W + 2]).toBe(SEA);
  });

  it("makes wetland where much water gathers on low flat ground", () => {
    const metres = new Float32Array(W * H).fill(40);
    const sea = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < 5; x++) sea[y * W + x] = 1;
    const catchment = new Float32Array(W * H);
    for (let x = 5; x < 40; x++) catchment[30 * W + x] = 2000;
    const c = climateOf(input({ metres, sea, catchment, lat: 45, wet: 2 }));
    expect(BIOME_KINDS[c.label[30 * W + 20]!]).toBe("wetland");
    expect(BIOME_KINDS[c.label[5 * W + 100]!]).not.toBe("wetland");
  });
});

describe("the regions suggested", () => {
  /** Two biomes side by side, with a speck of a third. */
  const label = new Uint8Array(40 * 20);
  const sand = BIOME_KINDS.indexOf("desert-sand");
  const grass = BIOME_KINDS.indexOf("grassland");
  const ice = BIOME_KINDS.indexOf("ice");
  // A border that wanders: x = 20 ± 3.
  const edge = (y: number) => 20 + Math.round(3 * Math.sin(y / 2.5));
  for (let y = 0; y < 20; y++)
    for (let x = 0; x < 40; x++) label[y * 40 + x] = x < edge(y) ? sand : grass;
  label[5 * 40 + 5] = ice;

  it("joins a small patch to its neighbour and outlines each region", () => {
    const rs = regionsOf(label, 40, 20, null, 10);
    expect(rs.map((r) => r.kind).sort()).toEqual(["desert-sand", "grassland"]);
    expect(rs.every((r) => r.ring.length >= 4)).toBe(true);
  });

  it("gives two neighbours the same border, to within a cell's width", () => {
    const [a, b] = regionsOf(label, 40, 20, null, 10);
    const dist = (p: Px, ring: Px[]) => {
      let best = Infinity;
      for (let i = 0; i < ring.length; i++) {
        const s = ring[i]!;
        const e = ring[(i + 1) % ring.length]!;
        const dx = e[0] - s[0];
        const dy = e[1] - s[1];
        const l = dx * dx + dy * dy;
        const t = l ? Math.max(0, Math.min(1, ((p[0] - s[0]) * dx + (p[1] - s[1]) * dy) / l)) : 0;
        best = Math.min(best, Math.hypot(p[0] - s[0] - t * dx, p[1] - s[1] - t * dy));
      }
      return best;
    };
    // Points every half cell along one's outline, where it runs beside the other.
    const along: Px[] = [];
    a!.ring.forEach((s, i) => {
      const e = a!.ring[(i + 1) % a!.ring.length]!;
      const steps = Math.ceil(Math.hypot(e[0] - s[0], e[1] - s[1]) * 2);
      for (let k = 0; k < steps; k++) {
        along.push([s[0] + ((e[0] - s[0]) * k) / steps, s[1] + ((e[1] - s[1]) * k) / steps]);
      }
    });
    const shared = along.filter((p) => p[0] > 15 && p[0] < 25 && p[1] > 2 && p[1] < 18);
    expect(shared.length).toBeGreaterThan(10);
    for (const p of shared) expect(dist(p, b!.ring)).toBeLessThan(0.6);
  });

  it("leaves out what is already drawn", () => {
    const blocked = new Uint8Array(40 * 20);
    for (let y = 0; y < 20; y++) for (let x = 0; x < 24; x++) blocked[y * 40 + x] = 1;
    expect(regionsOf(label, 40, 20, blocked, 10).map((r) => r.kind)).toEqual(["grassland"]);
  });
});

describe("Suggest biomes on the terrain in use", () => {
  it("suggests ghosts in the picture's pixels, with areas from the scale, and keeps clear of drawn biomes", () => {
    const { metres, sea } = ridge();
    const heights = Float32Array.from(metres, (m) => m / 2400);
    const t = {
      grid: flatGrid(W, H, 2),
      heights,
      sea,
      acc: new Float32Array(W * H).fill(1),
      kmPerCell: 2,
      top: 2400,
      seaLevel: 0,
      guessed: false,
    };
    const req = {
      wind: "W" as const,
      lat: 40,
      span: null,
      temp: 0,
      wet: 1,
      minArea: 150,
      biomes: [],
      view: "biomes" as const,
    };
    const r = suggestBiomes(t, req);
    expect(r.ghosts.length).toBeGreaterThan(1);
    expect(r.leastSpan).toBeCloseTo((H * 2) / 111);
    for (const g of r.ghosts) {
      expect(g.km2).toBeGreaterThan(100);
      for (const [x, y] of g.ring) {
        expect(x).toBeGreaterThanOrEqual(-1);
        expect(x).toBeLessThanOrEqual(W * 2);
        expect(y).toBeLessThanOrEqual(H * 2);
      }
    }
    const first = r.ghosts[0]!;
    const covered = suggestBiomes(t, {
      ...req,
      biomes: [
        {
          id: "z",
          biome: "forest",
          name: "Temperate forest",
          label: null,
          ring: [
            [-1, -1],
            [W * 2, -1],
            [W * 2, H * 2],
            [-1, H * 2],
          ],
          speed: { foot: 1, horse: 1, cart: 1 },
          rivers: "normal",
        },
      ],
    });
    expect(covered.ghosts).toEqual([]);
    expect(first.key).toContain(first.kind);
    const temp = suggestBiomes(t, { ...req, view: "temp" });
    expect(temp.field!.rgba.length).toBe(temp.field!.w * temp.field!.h * 4);
    expect(temp.field!.high).toBeGreaterThan(temp.field!.low);
  });
});
