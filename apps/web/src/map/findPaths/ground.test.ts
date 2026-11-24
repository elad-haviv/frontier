import { describe, expect, it } from "vitest";
import { guessHeights, isRiverInk, isRoadInk, lookAtGround } from "./classes.ts";
import { cellPx, drawLine, fillRing, flatGrid, gridFor, pool, pxCell, thicken } from "./grid.ts";
import { Painter, type Rgb, rgb } from "./paint.ts";
import { matchSeaLevel, reliefPicture, resampleHeights } from "./terrain.ts";

interface Palette {
  sea: Rgb;
  land: Rgb;
  forest: Rgb;
  river: Rgb;
  road: Rgb;
  coast: Rgb;
}

/**
 * A small painted map, 300 × 200: the sea on the left (x < 90) behind a dark coast line; a wood
 * round (170, 60); a river from the east down to the coast; a dashed road across; and a crowd of
 * mountain marks in the north-east.
 */
function paint(c: Palette): Painter {
  const p = new Painter(300, 200, c.land)
    .where((x) => x < 90, c.sea)
    .where((x, y) => Math.hypot(x - 170, y - 60) < 30, c.forest)
    .line(
      [
        [90, 0],
        [90, 199],
      ],
      2,
      c.coast,
    )
    .line(
      [
        [285, 150],
        [90, 120],
      ],
      3,
      c.river,
    )
    .line(
      [
        [120, 180],
        [270, 100],
      ],
      2,
      c.road,
      [8, 4],
    );
  for (let y = 20; y <= 60; y += 11) {
    for (let x = 235; x <= 290; x += 12) {
      p.line(
        [
          [x - 4, y + 3],
          [x, y - 3],
          [x + 4, y + 3],
        ],
        1.5,
        c.coast,
      );
    }
  }
  return p.grain(3);
}

const PARCHMENT: Palette = {
  sea: rgb("#aac5c4"),
  land: rgb("#ded2a2"),
  forest: rgb("#9db37c"),
  river: rgb("#4a7391"),
  road: rgb("#8a3520"),
  coast: rgb("#3c2f21"),
};
/** Another map altogether: pale paper, a bright sea, grey-black ink. */
const ATLAS: Palette = {
  sea: rgb("#7fb7d6"),
  land: rgb("#ece7da"),
  forest: rgb("#b5cc9a"),
  river: rgb("#2d5f8a"),
  road: rgb("#b0452c"),
  coast: rgb("#40454d"),
};

const cases: [string, Painter][] = [
  ["a parchment map", paint(PARCHMENT)],
  ["a map in other colours", paint(ATLAS)],
  ["a yellowed scan of the parchment map", paint(PARCHMENT).tint(1, 0.97, 0.84)],
];

describe("what the picture says of the ground", () => {
  it.each(cases)("finds the water, the wood, the river and the road on %s", (_name, painted) => {
    const { pic, ink } = painted.looked();
    const { ground } = lookAtGround(pic, ink);
    const g = ground.grid;
    expect(g.cell).toBe(1);
    const at = (x: number, y: number) => y * g.w + x;
    const near = (mask: Uint8Array, x: number, y: number, r = 2) => {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (mask[at(x + dx, y + dy)]) return true;
      return false;
    };
    // The sea is water and the land is not, nearly everywhere.
    let agree = 0;
    for (let y = 0; y < 200; y++) for (let x = 0; x < 300; x++) agree += (ground.water[at(x, y)] === 1) === x < 89 ? 1 : 0;
    expect(agree / 60000).toBeGreaterThan(0.97);
    expect(ground.forest[at(170, 60)]).toBe(1);
    expect(ground.forest[at(140, 150)]).toBe(0);
    expect(ground.forest[at(40, 100)]).toBe(0);
    // The river and the road, where they were painted and nowhere else.
    expect(near(ground.river, 187, 135)).toBe(true);
    expect(near(ground.river, 250, 145)).toBe(true);
    expect(near(ground.road, 195, 140)).toBe(true);
    expect(near(ground.river, 150, 60)).toBe(false);
    expect(near(ground.road, 150, 100)).toBe(false);
    // The coast's dark line is neither, and nor are the mountain marks.
    expect(near(ground.river, 90, 40, 1)).toBe(false);
    expect(near(ground.road, 90, 40, 1)).toBe(false);
    expect(near(ground.road, 260, 40, 6)).toBe(false);
    // High ground where the marks crowd.
    expect(ground.upland[at(262, 40)]!).toBeGreaterThan(0.5);
    expect(ground.upland[at(130, 100)]!).toBeLessThan(0.25);
    // The guess: water below nothing, land rising away from the sea and over the high ground.
    expect(ground.guess[at(40, 100)]!).toBeLessThan(0);
    expect(ground.guess[at(250, 180)]!).toBeGreaterThan(ground.guess[at(100, 180)]!);
    expect(ground.guess[at(262, 40)]!).toBeGreaterThan(ground.guess[at(250, 180)]!);
  });

  it("does not take a map's ordinary ink for rivers or roads", () => {
    // A map drawn all in sepia: its coast and borders are brown lines, and none of them a road.
    const sepia = rgb("#7a4a26");
    const p = new Painter(300, 200, rgb("#ead9b0"))
      .line(
        [
          [20, 20],
          [280, 60],
          [260, 180],
          [30, 160],
          [20, 20],
        ],
        2,
        sepia,
      )
      .line(
        [
          [150, 40],
          [140, 170],
        ],
        2,
        sepia,
      );
    const { pic, ink } = p.looked();
    const { ground } = lookAtGround(pic, ink);
    expect(ground.road.reduce((s, v) => s + v, 0)).toBe(0);
    expect(ground.river.reduce((s, v) => s + v, 0)).toBe(0);
    expect(ground.water.reduce((s, v) => s + v, 0)).toBe(0);
  });

  it("judges ink against the picture, and plain dark ink as neither", () => {
    const tan = { l: 84, a: -3, b: 25 };
    expect(isRiverInk({ l: 46, a: -8, b: -21 }, tan)).toBe(true);
    expect(isRiverInk({ l: 21, a: 4, b: 11 }, tan)).toBe(false);
    expect(isRiverInk({ l: 29, a: -1, b: -5 }, tan)).toBe(false);
    expect(isRoadInk({ l: 33, a: 33, b: 32 }, tan)).toBe(true);
    expect(isRoadInk({ l: 21, a: 4, b: 11 }, tan)).toBe(false);
  });

  it("guesses land that falls to the map's edge when the picture has no water", () => {
    const g = flatGrid(40, 30);
    const guess = guessHeights(g, new Uint8Array(1200), new Float32Array(1200));
    expect(guess[15 * 40 + 20]!).toBeGreaterThan(guess[15 * 40 + 1]!);
    expect(Math.min(...guess)).toBeGreaterThan(0);
  });
});

describe("the cell grid", () => {
  it("has about half a million cells at most, and keeps a thin line when shrinking", () => {
    expect(gridFor(600, 400).cell).toBe(1);
    const g = gridFor(1600, 1200);
    expect(g.cell).toBe(2);
    expect([g.w, g.h]).toEqual([800, 600]);
    const small = gridFor(8, 4, 8);
    expect([small.cell, small.w, small.h]).toEqual([2, 4, 2]);
    const mask = new Uint8Array(32);
    mask[1 * 8 + 5] = 1;
    expect(Array.from(pool(mask, 8, 4, small, 1))).toEqual([0, 0, 1, 0, 0, 0, 0, 0]);
    // The majority drops it.
    expect(Array.from(pool(mask, 8, 4, small, 2))).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(pxCell(small, cellPx(small, 6))).toBe(6);
  });

  it("gives a flat map eight neighbours, fewer at an edge, and a longer diagonal step", () => {
    const g = flatGrid(5, 4);
    const out = new Int32Array(8);
    expect(g.neighbours(6, out)).toBe(8);
    expect(g.neighbours(0, out)).toBe(3);
    expect(Array.from(out.subarray(0, 3)).sort()).toEqual([1, 5, 6]);
    expect(g.neighbours(4, out)).toBe(3);
    expect(g.stepLength(6, 7)).toBe(1);
    expect(g.stepLength(6, 1)).toBe(1);
    expect(g.stepLength(6, 12)).toBeCloseTo(Math.SQRT2);
  });

  it("thickens a diagonal river so no diagonal step slips through, and draws lines and rings", () => {
    const g = flatGrid(6, 6);
    const river = new Uint8Array(36);
    drawLine(river, g, [[0, 0], [5, 5]], 1);
    expect(river[14]).toBe(1);
    expect(river[8]).toBe(0);
    const wide = thicken(river, g);
    // The cells either side of the diagonal are closed too.
    expect(wide[8]).toBe(1);
    expect(wide[13]).toBe(1);
    const zone = new Uint8Array(36);
    fillRing(zone, g, [[1, 1], [4, 1], [4, 4], [1, 4]], 1);
    expect(zone[2 * 6 + 2]).toBe(1);
    expect(zone[0]).toBe(0);
    expect(zone[5 * 6 + 5]).toBe(0);
  });
});

describe("the height field", () => {
  const src = { w: 10, h: 10, data: Float32Array.from({ length: 100 }, (_, i) => (i % 10) / 9) };

  it("is read through the two extents onto the grid", () => {
    const g = flatGrid(20, 20);
    const same = resampleHeights(src, [0, 0, 100, 100], g, [0, 0, 100, 100]);
    // West to east it rises as the picture does; north to south it is level.
    expect(same[10 * 20 + 2]!).toBeLessThan(same[10 * 20 + 10]!);
    expect(same[10 * 20 + 10]!).toBeLessThan(same[10 * 20 + 17]!);
    expect(same[10 * 20 + 10]!).toBeCloseTo(4.75 / 9, 1);
    expect(same[3 * 20 + 10]!).toBeCloseTo(same[16 * 20 + 10]!, 5);
    // A height picture laid over the east half only: its west edge is carried on to the west.
    const east = resampleHeights(src, [50, 0, 100, 100], g, [0, 0, 100, 100]);
    expect(east[10 * 20 + 3]!).toBeCloseTo(0, 2);
    expect(east[10 * 20 + 15]!).toBeCloseTo(5 / 9, 1);
    expect(east[10 * 20 + 18]!).toBeGreaterThan(0.8);
  });

  it("finds the sea level that fits the painted coast best", () => {
    const heights = Float32Array.from({ length: 10000 }, (_, i) => (i % 100) / 100);
    const water = Uint8Array.from({ length: 10000 }, (_, i) => (i % 100 < 30 ? 1 : 0));
    expect(matchSeaLevel(heights, water)).toBeCloseTo(0.3, 1);
    // With no water painted, or no picture, only black is sea.
    expect(matchSeaLevel(heights, new Uint8Array(10000))).toBeLessThan(0.01);
    expect(matchSeaLevel(heights, null)).toBeLessThan(0.01);
  });

  it("draws relief only on land", () => {
    const g = flatGrid(10, 10);
    const heights = Float32Array.from({ length: 100 }, (_, i) => (i % 10) / 9);
    const sea = Uint8Array.from({ length: 100 }, (_, i) => (i % 10 < 3 ? 1 : 0));
    const rgba = reliefPicture(g, heights, sea);
    expect(rgba[(5 * 10 + 1) * 4 + 3]).toBe(0);
    expect(rgba[(5 * 10 + 6) * 4 + 3]).toBeGreaterThan(0);
  });
});
