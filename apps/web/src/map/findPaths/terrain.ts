/**
 * The height field Find paths works on. A map's terrain is a greyscale picture (white is high)
 * lying on the map through its own extent; here it is brought onto the tool's cell grid. Also:
 * the sea level that best fits the picture's painted coast, and the terrain in use drawn as soft
 * shading and contour lines ("Show relief"), so the owner can see what the tool believes.
 */
import { boxMean } from "../findAreas/ink.ts";
import type { Grid } from "./grid.ts";

/** A height picture as read: one height, 0 (black) to 1 (white), for each of its pixels. */
export interface HeightPicture {
  w: number;
  h: number;
  data: Float32Array;
}

export type Extent = readonly [number, number, number, number];

/** Heights from the red, green and blue of RGBA pixels, as `getImageData` gives them. */
export function heightsFromRgba(rgba: ArrayLike<number>, w: number, h: number): HeightPicture {
  const data = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    data[i] = (0.299 * rgba[i * 4]! + 0.587 * rgba[i * 4 + 1]! + 0.114 * rgba[i * 4 + 2]!) / 255;
  }
  return { w, h, data };
}

/**
 * The height picture on the grid: each cell's middle is looked up through the two extents (the
 * grid's, and the height picture's own) between the four pixels round it, and the result is
 * blurred by one cell, which hides the steps of an 8-bit picture. Where the height picture does
 * not reach, its nearest edge is carried on.
 */
export function resampleHeights(
  src: HeightPicture,
  srcExtent: Extent,
  grid: Grid,
  gridExtent: Extent,
): Float32Array {
  const out = new Float32Array(grid.w * grid.h);
  const [gx0, gy0, gx1, gy1] = gridExtent;
  const [sx0, sy0, sx1, sy1] = srcExtent;
  const at = (x: number, y: number) =>
    src.data[Math.max(0, Math.min(src.h - 1, y)) * src.w + Math.max(0, Math.min(src.w - 1, x))]!;
  for (let cy = 0; cy < grid.h; cy++) {
    const py = gy0 + ((cy + 0.5) / grid.h) * (gy1 - gy0);
    const v = ((py - sy0) / (sy1 - sy0)) * src.h - 0.5;
    const y0 = Math.floor(v);
    const fy = v - y0;
    for (let cx = 0; cx < grid.w; cx++) {
      const px = gx0 + ((cx + 0.5) / grid.w) * (gx1 - gx0);
      const u = ((px - sx0) / (sx1 - sx0)) * src.w - 0.5;
      const x0 = Math.floor(u);
      const fx = u - x0;
      out[cy * grid.w + cx] =
        (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) +
        (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
    }
  }
  return boxMean(out, grid.w, grid.h, 1);
}

/** The sea level used when nothing says better: only what is all but black is sea. */
export const LOWEST_SEA = 0.002;

/**
 * The sea level at which the heights' shoreline lies closest to the painted one: the level where
 * the most cells agree (water in the picture and below the level, or land and above it). Without
 * any water in the picture there is nothing to match, and only black is sea.
 */
export function matchSeaLevel(heights: Float32Array, water: Uint8Array | null): number {
  if (!water) return LOWEST_SEA;
  const BINS = 256;
  const wet = new Float64Array(BINS + 1);
  const dry = new Float64Array(BINS + 1);
  let wetAll = 0;
  for (let i = 0; i < heights.length; i++) {
    const bin = Math.max(0, Math.min(BINS - 1, Math.floor(heights[i]! * BINS)));
    if (water[i]) {
      wet[bin] = wet[bin]! + 1;
      wetAll++;
    } else dry[bin] = dry[bin]! + 1;
  }
  if (wetAll === 0) return LOWEST_SEA;
  // With the level at the lower edge of bin k: water in bins below k agrees, land in k and above.
  let agree = heights.length - wetAll;
  let best = agree;
  let bestAt = 0;
  for (let k = 1; k <= BINS; k++) {
    agree += wet[k - 1]! - dry[k - 1]!;
    if (agree > best) {
      best = agree;
      bestAt = k;
    }
  }
  return bestAt === 0 ? LOWEST_SEA : bestAt / BINS;
}

/**
 * The terrain in use as a small picture, one pixel a cell: light on slopes that face the top
 * left, dark on those that face away, a brown line at each contour; the sea left clear.
 */
export function reliefPicture(
  grid: Grid,
  heights: Float32Array,
  sea: Uint8Array,
): Uint8ClampedArray {
  const { w, h } = grid;
  const out = new Uint8ClampedArray(w * h * 4);
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < heights.length; i++) {
    if (sea[i]) continue;
    lo = Math.min(lo, heights[i]!);
    hi = Math.max(hi, heights[i]!);
  }
  const range = hi - lo;
  if (!(range > 0)) return out;
  const step = range / 12;
  const level = (i: number) => Math.floor((heights[i]! - lo) / step);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (sea[i]) continue;
      const shade =
        ((heights[i + 1]! - heights[i - 1]! + heights[i + w]! - heights[i - w]!) / range) * 9;
      const alpha = Math.min(0.55, Math.abs(shade));
      const edge = level(i) !== level(i + 1) || level(i) !== level(i + w);
      const [r, g, b, a] = edge
        ? [92, 62, 30, 150]
        : shade > 0
          ? [255, 250, 235, alpha * 255]
          : [40, 30, 20, alpha * 255];
      out[i * 4] = r;
      out[i * 4 + 1] = g;
      out[i * 4 + 2] = b;
      out[i * 4 + 3] = a;
    }
  }
  return out;
}
