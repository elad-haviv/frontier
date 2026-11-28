import { BIOME_KINDS } from "@frontier/schema";
import { describe, expect, it } from "vitest";
import {
  axesOf,
  brushCells,
  buildBiomes,
  buildClimate,
  cellAt,
  classify,
  DEFAULT_SETTINGS,
  DIRECTIONS,
  dirty,
  driftStep,
  ensure,
  factsOf,
  fits,
  H,
  ICE,
  LAT,
  N,
  newWorld,
  OCEAN,
  plateMiddles,
  velocityAt,
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

describe("drift on a globe", () => {
  /** The land's area, by cell, as a share of the globe: rows near a pole count for little. */
  const area = (w: ReturnType<typeof newWorld>) => {
    let land = 0;
    let all = 0;
    for (let i = 0; i < N; i++) {
      const size = Math.cos(LAT[Math.floor(i / W)]!);
      all += size;
      if (w.crust[i]) land += size;
    }
    return land / all;
  };

  it("carries a land past the pole and up the far side, keeping its size", () => {
    // One plate, so nothing meets anything: the whole crust turns as one piece.
    const w = newWorld({ ...DEFAULT_SETTINGS, plates: 1 });
    ensure(w, "plates");
    w.plate.fill(0);
    for (let i = 0; i < N; i++) {
      const x = i % W;
      const y = Math.floor(i / W);
      w.land[i] = y >= 40 && y < 60 && x >= 170 && x < 190 ? 1 : 0; // 30° to 50° north, at 0° east
    }
    // Its middle is put where the land is, so "north" is north there.
    w.drift = [{ dir: 0, speed: 8, axis: [1, 0, 0] }];
    w.ok.land = w.ok.plates = true;
    ensure(w, "sim");
    const before = area(w);
    // 8 cm a year is about 1.44° in a step of two million years: 125 steps is half a turn.
    for (let n = 0; n < 125; n++) driftStep(w);
    // It began at 40° north, 0° east, and went south, under the pole and up the far side: half a
    // turn about that point puts it at 40° south, 180°.
    const far = cellAt((-40 * Math.PI) / 180, Math.PI - 0.01);
    expect(w.crust[far]).toBe(1);
    expect(w.crust[cellAt((40 * Math.PI) / 180, 0)]).toBe(0);
    expect(Math.abs(area(w) - before) / before).toBeLessThan(0.15);
  });

  it("gives each plate a point to turn about that sends its middle the way it was told", () => {
    const w = newWorld({ ...DEFAULT_SETTINGS, plates: 6 });
    ensure(w, "sim");
    const middles = plateMiddles(w);
    axesOf(w).forEach((axis, p) => {
      expect(Math.hypot(...axis)).toBeCloseTo(1, 5);
      const dir = DIRECTIONS[w.drift[p]!.dir]!;
      const v = velocityAt(w, p, middles[p]!);
      // The same way on the grid as its compass says, at its fastest.
      const len = Math.hypot(v[0], v[1]);
      expect(
        (v[0] * dir[0]! + v[1] * dir[1]!) / (len * Math.hypot(dir[0]!, dir[1]!)),
      ).toBeGreaterThan(0.99);
    });
  });
});

describe("going back to the start", () => {
  it("puts the plates and the land back where they lay before the drift", async () => {
    const w = newWorld({ ...DEFAULT_SETTINGS, seed: 77 });
    ensure(w, "sim");
    const plates = w.plate.slice();
    const land = w.crust.slice();
    for (let n = 0; n < 30; n++) driftStep(w);
    expect(Array.from(w.plate)).not.toEqual(Array.from(plates));
    dirty(w, "sim");
    ensure(w, "sim");
    expect(w.my).toBe(0);
    expect(Array.from(w.plate)).toEqual(Array.from(plates));
    expect(Array.from(w.crust)).toEqual(Array.from(land));
    // A world kept in the middle of a drift goes on exactly as it would have.
    const { keep, restore } = await import("./store.ts");
    for (let n = 0; n < 10; n++) driftStep(w);
    const back = restore(keep(w, "W", "plates"))!;
    driftStep(w);
    driftStep(back);
    expect(back.my).toBe(w.my);
    expect(Array.from(back.crust)).toEqual(Array.from(w.crust));
    expect(Array.from(back.plate)).toEqual(Array.from(w.plate));
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
    expect(classify(0.01, 15, 0.7)).toBe(k("wetland"));
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
