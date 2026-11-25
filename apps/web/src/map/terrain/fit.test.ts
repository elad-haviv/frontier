import { describe, expect, it } from "vitest";
import { flatGrid } from "../findPaths/grid.ts";
import type { Extent, HeightPicture } from "../findPaths/terrain.ts";
import {
  bestSea,
  cover,
  lineUp,
  looksInverted,
  matchTwoPoints,
  measure,
  prepared,
  verdict,
} from "./fit.ts";

const G = flatGrid(120, 80);
const WHOLE: Extent = [0, 0, 600, 400];
/** An island: land inside an ellipse, sea round it. */
const inside = (x: number, y: number) => ((x - 0.45) / 0.3) ** 2 + ((y - 0.5) / 0.32) ** 2 < 1;
const water = Uint8Array.from({ length: 120 * 80 }, (_, i) =>
  inside(((i % 120) + 0.5) / 120, (Math.floor(i / 120) + 0.5) / 80) ? 0 : 1,
);
/** The height picture that matches it: black sea, land rising to the middle of the island. */
function heights(change: (h: number, x: number, y: number) => number = (h) => h): HeightPicture {
  const w = 240;
  const h = 160;
  const data = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w;
      const v = (y + 0.5) / h;
      const r = ((u - 0.45) / 0.3) ** 2 + ((v - 0.5) / 0.32) ** 2;
      data[y * w + x] = change(r < 1 ? 0.25 + 0.6 * (1 - r) : 0, x, y);
    }
  }
  return { w, h, data };
}

describe("measuring a height map against the picture", () => {
  it("finds the sea level and a full coast match when it lines up", () => {
    const fit = measure(heights(), WHOLE, water, G, WHOLE, null);
    expect(fit.seaLevel).toBeGreaterThan(0);
    expect(fit.seaLevel).toBeLessThanOrEqual(0.26);
    expect(fit.match!).toBeGreaterThan(0.9);
    expect(verdict(fit.match)).toBe("good");
    expect(fit.floods + fit.bares).toBeLessThan(0.02);
    expect(fit.cover).toBe(1);
  });

  it("scores a shifted copy lower, and Line up for me brings it back", () => {
    const shifted: Extent = [60, 36, 660, 436];
    const before = measure(heights(), shifted, water, G, WHOLE, null);
    expect(before.match!).toBeLessThan(0.6);
    expect(verdict(before.match)).toBe("off");
    expect(before.cover).toBeCloseTo(0.9 * 0.91, 2);
    const found = lineUp(heights(), shifted, water, G, WHOLE);
    const after = measure(heights(), found, water, G, WHOLE, null);
    expect(after.match!).toBeGreaterThan(0.9);
    expect(Math.abs(found[0])).toBeLessThan(8);
    expect(Math.abs(found[1])).toBeLessThan(8);
    // Already in place, it stays where it is.
    expect(lineUp(heights(), WHOLE, water, G, WHOLE)).toEqual(WHOLE);
    // With no sea in the picture there is nothing to line up with.
    expect(lineUp(heights(), shifted, null, G, WHOLE)).toEqual(shifted);
    expect(measure(heights(), shifted, null, G, WHOLE, null).match).toBeNull();
  });

  it("sees a height map that is upside down", () => {
    const upsideDown = heights((h) => 1 - h);
    expect(looksInverted(upsideDown, WHOLE, water, G, WHOLE)).toBe(true);
    expect(looksInverted(heights(), WHOLE, water, G, WHOLE)).toBe(false);
    const read = prepared(upsideDown, { invert: true, smoothing: 0 });
    expect(measure(read, WHOLE, water, G, WHOLE, null).match!).toBeGreaterThan(0.9);
  });

  it("reads a banded picture as flat and a grainy one as noisy, which smoothing cures", () => {
    const banded = heights((h) => Math.round(h * 4) / 4);
    expect(measure(banded, WHOLE, water, G, WHOLE, null).flat).toBeGreaterThan(0.3);
    let seed = 7;
    const grainy = heights((h) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
      return h > 0 ? h + ((seed >>> 8) / 16777216 - 0.5) * 0.9 : 0;
    });
    const rough = measure(grainy, WHOLE, water, G, WHOLE, null);
    expect(rough.noisy).toBeGreaterThan(0.015);
    const smooth = measure(prepared(grainy, { invert: false, smoothing: 3 }), WHOLE, water, G, WHOLE, null);
    expect(smooth.noisy).toBeLessThan(rough.noisy / 3);
    const fine = measure(heights(), WHOLE, water, G, WHOLE, null);
    expect(fine.flat).toBeLessThan(0.05);
    expect(fine.noisy).toBeLessThan(0.02);
  });

  it("follows a sea level set on purpose, and says what it floods", () => {
    const high = measure(heights(), WHOLE, water, G, WHOLE, 0.5);
    expect(high.seaLevel).toBe(0.5);
    expect(high.floods).toBeGreaterThan(0.05);
    expect(high.bares).toBe(0);
    expect(high.match!).toBeLessThan(0.9);
    expect(bestSea(high.heights, null)).toEqual({ level: 0, agree: 0 });
  });

  it("places the height map by two matched points, keeping its proportions", () => {
    // The height picture is drawn too small and off: two places on it, and where they belong.
    const now: Extent = [100, 50, 400, 250];
    const fixed = matchTwoPoints(
      now,
      [
        [100, 50],
        [400, 250],
      ],
      [
        [0, 0],
        [600, 400],
      ],
    )!;
    fixed.forEach((v, i) => expect(v).toBeCloseTo(WHOLE[i]!, 6));
    // Two places too close together say nothing of the size.
    expect(
      matchTwoPoints(
        now,
        [
          [100, 50],
          [102, 51],
        ],
        [
          [0, 0],
          [600, 400],
        ],
      ),
    ).toBeNull();
    expect(cover([300, 0, 900, 400], WHOLE)).toBe(0.5);
  });
});
