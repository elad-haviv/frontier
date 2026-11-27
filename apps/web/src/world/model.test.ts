import { BIOME_KINDS } from "@frontier/schema";
import { describe, expect, it } from "vitest";
import {
  brushCells,
  buildBiomes,
  buildClimate,
  cellAt,
  classify,
  DEFAULT_SETTINGS,
  dirty,
  driftStep,
  ensure,
  factsOf,
  fits,
  H,
  ICE,
  N,
  newWorld,
  OCEAN,
  W,
} from "./model.ts";

const k = (name: (typeof BIOME_KINDS)[number]) => BIOME_KINDS.indexOf(name);
const row = (deg: number) => Math.floor(((90 - deg) / 180) * H);

describe("the world's stages", () => {
  it("rebuilds the same world from the same seed and choices", () => {
    const a = newWorld();
    const b = newWorld();
    ensure(a, "biome");
    ensure(b, "biome");
    expect(Array.from(a.biome)).toEqual(Array.from(b.biome));
    const c = newWorld({ ...DEFAULT_SETTINGS, seed: 99 });
    ensure(c, "biome");
    expect(Array.from(c.land)).not.toEqual(Array.from(a.land));
  });

  it("rolls about as much land as was asked for, by area", () => {
    for (const landPct of [15, 40, 65]) {
      const w = newWorld({ ...DEFAULT_SETTINGS, landPct, rough: 0, mountains: 0 });
      expect(Math.abs(factsOf(w).land - landPct)).toBeLessThan(8);
    }
  });

  it("builds a later stage again only when an earlier one changes", () => {
    const w = newWorld();
    ensure(w, "biome");
    expect(w.ok.biome).toBe(true);
    dirty(w, "climate");
    expect(w.ok).toMatchObject({
      land: true,
      sim: true,
      height: true,
      climate: false,
      biome: false,
    });
  });
});

describe("drifting plates", () => {
  /** Two plates, split down the middle, with a block of land on each. */
  function twoPlates(dirWest: number, dirEast: number) {
    const w = newWorld({ ...DEFAULT_SETTINGS, plates: 2 });
    ensure(w, "plates");
    for (let i = 0; i < N; i++) {
      const x = i % W;
      const y = Math.floor(i / W);
      w.plate[i] = x < W / 2 ? 0 : 1;
      w.land[i] = y > 60 && y < 120 && ((x > 130 && x < 170) || (x > 190 && x < 230)) ? 1 : 0;
    }
    w.drift = [
      { dir: dirWest, speed: 6 },
      { dir: dirEast, speed: 6 },
    ];
    w.ok.land = w.ok.plates = true;
    ensure(w, "sim");
    return w;
  }
  const highest = (w: ReturnType<typeof newWorld>) => w.h.reduce((m, v) => Math.max(m, v), -1);

  it("raises mountains where two lands meet", () => {
    const w = twoPlates(2, 6); // east and west: toward each other
    const before = highest(w);
    for (let n = 0; n < 60; n++) driftStep(w);
    expect(w.my).toBe(120);
    expect(highest(w)).toBeGreaterThan(before + 0.2);
  });

  it("opens new sea floor where they part, and leaves no cell without a plate", () => {
    const w = twoPlates(6, 2); // west and east: apart
    for (let n = 0; n < 40; n++) driftStep(w);
    const mid = 90 * W + W / 2;
    expect(w.crust[mid]).toBe(0);
    expect(w.h[mid]!).toBeLessThan(0);
    expect(w.plate.every((p) => p < 2)).toBe(true);
    // Lands that only moved apart were not raised. (Round the back of the globe the two plates meet.)
    const near = w.h.filter((_, i) => i % W > 60 && i % W < 300);
    expect(near.reduce((m, v) => Math.max(m, v), -1)).toBeLessThan(0.3);
  });
});

describe("climate", () => {
  /** A world of sea with one north-south range across the westerlies. */
  function withRange(spin: 1 | -1) {
    const w = newWorld({ ...DEFAULT_SETTINGS, spin });
    for (let i = 0; i < N; i++) {
      const x = i % W;
      w.elev[i] = x >= 150 && x <= 210 ? (x >= 176 && x <= 184 ? 0.6 : 0.1) : -0.5;
    }
    buildClimate(w);
    return w;
  }
  const at = (w: ReturnType<typeof newWorld>, deg: number, x: number) => w.rain[row(deg) * W + x]!;

  it("is dry behind a range and wet in front of it, and the spin decides which side that is", () => {
    const earth = withRange(1);
    // At 45°N the wind blows to the east: the west side is wet.
    expect(at(earth, 45, 160)).toBeGreaterThan(at(earth, 45, 200) * 1.5);
    const other = withRange(-1);
    expect(at(other, 45, 200)).toBeGreaterThan(at(other, 45, 160) * 1.5);
  });

  it("is colder toward the poles and up high, and less so on a world that leans far over", () => {
    const w = withRange(1);
    const t = (deg: number, x: number) => w.temp[row(deg) * W + x]!;
    expect(t(0, 10)).toBeGreaterThan(t(60, 10) + 20);
    expect(t(30, 10)).toBeGreaterThan(t(30, 180) + 15);
    const leaning = newWorld({ ...DEFAULT_SETTINGS, tilt: 60 });
    leaning.elev.fill(-0.5);
    buildClimate(leaning);
    expect(leaning.temp[row(80) * W]!).toBeGreaterThan(t(80, 10));
  });
});

describe("biomes", () => {
  it("reads height, warmth and rain as Frontier's kinds", () => {
    expect(classify(-0.5, 15, 0.5)).toBe(OCEAN);
    expect(classify(-0.05, 15, 0.5)).toBe(k("coast"));
    expect(classify(-0.5, -10, 0.5)).toBe(ICE);
    expect(classify(0.2, 26, 0.6)).toBe(k("jungle"));
    expect(classify(0.2, 26, 0.02)).toBe(k("desert-sand"));
    expect(classify(0.2, 12, 0.5)).toBe(k("forest"));
    expect(classify(0.2, 3, 0.4)).toBe(k("taiga"));
    expect(classify(0.7, 2, 0.4)).toBe(k("alpine"));
    expect(classify(0.02, 15, 0.7)).toBe(k("wetland"));
  });

  it("keeps a painted biome where it still fits the ground, and not where it does not", () => {
    const w = newWorld();
    ensure(w, "biome");
    const land = w.elev.findIndex((e, i) => e > 0.1 && w.temp[i]! > 10);
    const sea = w.elev.findIndex((e) => e < -0.3);
    w.painted[land] = k("jungle");
    w.painted[sea] = k("jungle");
    buildBiomes(w);
    expect(w.biome[land]).toBe(k("jungle"));
    expect(w.biome[sea]).not.toBe(k("jungle"));
    expect(fits(ICE, 0.3) && fits(ICE, -0.3)).toBe(true);
    // The sea rises over it: the painted jungle is no longer used, but is not forgotten.
    w.elev[land] = -0.2;
    buildBiomes(w);
    expect(w.biome[land]).not.toBe(k("jungle"));
    expect(w.painted[land]).toBe(k("jungle"));
  });
});

describe("the brush", () => {
  it("is a disc on the globe: wider in cells near a pole, and it wraps round the seam", () => {
    const equator = brushCells(cellAt(0, 0), 4);
    const north = brushCells(cellAt((70 * Math.PI) / 180, 0), 4);
    expect(north.length).toBeGreaterThan(equator.length * 2);
    const seam = brushCells(90 * W, 3);
    expect(seam.some((c) => c % W > W - 5)).toBe(true);
    expect(seam.every((c) => c >= 0 && c < N)).toBe(true);
  });
});
