/**
 * Measuring a height map against the map's picture, for the Terrain dialog: is it the right way
 * up, where is the sea, does its coast lie on the painted one, and is it good enough for rivers.
 * Everything is worked out on a small grid of cells (the dialog's preview grid) from two things:
 * the picture's water, and the height picture's greys. Pure, so the dialog can run it at every
 * move of a slider or a finger.
 */
import type { Grid } from "../findPaths/grid.ts";
import { boxMean } from "../findAreas/ink.ts";
import { type Extent, type HeightPicture, resampleHeights } from "../findPaths/terrain.ts";

/** How the height picture is read. */
export interface Reading {
  /** Black is high. */
  invert: boolean;
  /** 0 to 4. */
  smoothing: number;
}

/**
 * The height picture as its settings read it: turned over when black is high, and smoothed (two
 * box passes a step), which changes how it is read and never the picture.
 */
export function prepared(src: HeightPicture, r: Reading): HeightPicture {
  let data = src.data;
  if (r.invert) data = data.map((v) => 1 - v);
  if (r.smoothing > 0) {
    const radius = Math.max(1, Math.round((r.smoothing * Math.max(src.w, src.h)) / 500));
    data = boxMean(boxMean(data, src.w, src.h, radius), src.w, src.h, radius);
  }
  return { w: src.w, h: src.h, data };
}

/** The heights on the grid, through the two extents. */
export const placed = (
  src: HeightPicture,
  srcExtent: Extent,
  grid: Grid,
  gridExtent: Extent,
): Float32Array => resampleHeights(src, srcExtent, grid, gridExtent);

/**
 * The sea level that agrees with the picture's water in the most cells, and the share of cells
 * that agree at it. Without water in the picture there is nothing to match: level 0, share 0.
 */
export function bestSea(
  heights: Float32Array,
  water: Uint8Array | null,
): { level: number; agree: number } {
  if (!water) return { level: 0, agree: 0 };
  const BINS = 256;
  const wet = new Float64Array(BINS);
  const dry = new Float64Array(BINS);
  let wetAll = 0;
  for (let i = 0; i < heights.length; i++) {
    const bin = Math.max(0, Math.min(BINS - 1, Math.floor(heights[i]! * BINS)));
    if (water[i]) {
      wet[bin] = wet[bin]! + 1;
      wetAll++;
    } else dry[bin] = dry[bin]! + 1;
  }
  if (wetAll === 0) return { level: 0, agree: 0 };
  let agree = heights.length - wetAll;
  let best = agree;
  let at = 0;
  for (let k = 1; k <= BINS; k++) {
    agree += wet[k - 1]! - dry[k - 1]!;
    if (agree > best) {
      best = agree;
      at = k;
    }
  }
  return { level: at / BINS, agree: best / heights.length };
}

/** The cells below the sea level. */
export function seaOf(heights: Float32Array, level: number): Uint8Array {
  const out = new Uint8Array(heights.length);
  for (let i = 0; i < heights.length; i++) out[i] = heights[i]! < level ? 1 : 0;
  return out;
}

/** The cells of a mask that have a neighbour off it: its shore. */
function shoreOf(mask: Uint8Array, g: Grid): number[] {
  const out: number[] = [];
  for (let i = 0; i < mask.length; i++) {
    const x = i % g.w;
    const y = (i / g.w) | 0;
    const m = mask[i]!;
    if (
      (x > 0 && mask[i - 1] !== m) ||
      (x < g.w - 1 && mask[i + 1] !== m) ||
      (y > 0 && mask[i - g.w] !== m) ||
      (y < g.h - 1 && mask[i + g.w] !== m)
    ) {
      out.push(i);
    }
  }
  return out;
}

/** How far each cell is from the nearest of `from`, in four-way steps, up to `reach`. */
function distances(from: readonly number[], g: Grid, reach: number): Float32Array {
  const dist = new Float32Array(g.w * g.h).fill(reach);
  const queue = new Int32Array(g.w * g.h);
  let head = 0;
  let tail = 0;
  for (const i of from) {
    dist[i] = 0;
    queue[tail++] = i;
  }
  while (head < tail) {
    const i = queue[head++]!;
    const next = dist[i]! + 1;
    if (next >= reach) continue;
    const x = i % g.w;
    const y = (i / g.w) | 0;
    for (const j of [
      x > 0 ? i - 1 : -1,
      x < g.w - 1 ? i + 1 : -1,
      y > 0 ? i - g.w : -1,
      y < g.h - 1 ? i + g.w : -1,
    ]) {
      if (j < 0 || dist[j]! <= next) continue;
      dist[j] = next;
      queue[tail++] = j;
    }
  }
  return dist;
}

/**
 * The coast match, 0 to 1: the share of shoreline that agrees. For every cell of the picture's
 * coast, how near the height map's shore is, and the other way round, falling to nothing at 3% of
 * the map's width. Null when the picture has no coast to check against.
 */
export function coastMatch(sea: Uint8Array, water: Uint8Array | null, g: Grid): number | null {
  if (!water) return null;
  const painted = shoreOf(water, g);
  const ours = shoreOf(sea, g);
  if (painted.length === 0) return null;
  if (ours.length === 0) return 0;
  const reach = Math.max(3, 0.03 * g.w);
  const toOurs = distances(ours, g, reach);
  const toPainted = distances(painted, g, reach);
  let sum = 0;
  for (const i of painted) sum += 1 - toOurs[i]! / reach;
  for (const i of ours) sum += 1 - toPainted[i]! / reach;
  return sum / (painted.length + ours.length);
}

/** What the sea level floods of the picture's land and bares of its sea, as shares of the cells. */
export function flooding(
  sea: Uint8Array,
  water: Uint8Array | null,
): { floods: number; bares: number } {
  if (!water) return { floods: 0, bares: 0 };
  let floods = 0;
  let bares = 0;
  for (let i = 0; i < sea.length; i++) {
    if (sea[i] && !water[i]) floods++;
    else if (!sea[i] && water[i]) bares++;
  }
  return { floods: floods / sea.length, bares: bares / sea.length };
}

/**
 * How good the heights are for rivers: the share of the land on level steps (every neighbour
 * the same height: a banded or flat picture) and the share that is tiny hollows (lower than all
 * eight neighbours: a noisy one).
 */
export function detail(
  heights: Float32Array,
  sea: Uint8Array,
  g: Grid,
): { flat: number; noisy: number } {
  let land = 0;
  let flat = 0;
  let pits = 0;
  for (let y = 1; y < g.h - 1; y++) {
    for (let x = 1; x < g.w - 1; x++) {
      const i = y * g.w + x;
      if (sea[i]) continue;
      land++;
      const h = heights[i]!;
      let level = true;
      let lowest = true;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const v = heights[i + dy * g.w + dx]!;
          if (Math.abs(v - h) > 1e-4) level = false;
          if (v <= h) lowest = false;
        }
      }
      if (level) flat++;
      if (lowest) pits++;
    }
  }
  return land ? { flat: flat / land, noisy: pits / land } : { flat: 0, noisy: 0 };
}

/** The share of the grid the height picture covers, where it lies. */
export function cover(srcExtent: Extent, gridExtent: Extent): number {
  const w = Math.max(
    0,
    Math.min(srcExtent[2], gridExtent[2]) - Math.max(srcExtent[0], gridExtent[0]),
  );
  const h = Math.max(
    0,
    Math.min(srcExtent[3], gridExtent[3]) - Math.max(srcExtent[1], gridExtent[1]),
  );
  return (w * h) / ((gridExtent[2] - gridExtent[0]) * (gridExtent[3] - gridExtent[1]));
}

export interface Fit {
  heights: Float32Array;
  sea: Uint8Array;
  seaLevel: number;
  /** 0 to 1, or null when the picture has no coast. */
  match: number | null;
  floods: number;
  bares: number;
  flat: number;
  noisy: number;
  cover: number;
}

/** Everything the dialog shows of a height picture where it lies, at a sea level (null: the best). */
export function measure(
  src: HeightPicture,
  srcExtent: Extent,
  water: Uint8Array | null,
  g: Grid,
  gridExtent: Extent,
  seaLevel: number | null,
): Fit {
  const heights = placed(src, srcExtent, g, gridExtent);
  const level = seaLevel ?? bestSea(heights, water).level;
  const sea = seaOf(heights, level);
  return {
    heights,
    sea,
    seaLevel: level,
    match: coastMatch(sea, water, g),
    ...flooding(sea, water),
    ...detail(heights, sea, g),
    cover: cover(srcExtent, gridExtent),
  };
}

/**
 * Which way up the picture is: whether reading it with black high agrees with the picture's
 * water clearly better than with white high.
 */
export function looksInverted(
  raw: HeightPicture,
  srcExtent: Extent,
  water: Uint8Array | null,
  g: Grid,
  gridExtent: Extent,
): boolean {
  if (!water) return false;
  const up = bestSea(placed(raw, srcExtent, g, gridExtent), water).agree;
  const down = bestSea(
    placed(prepared(raw, { invert: true, smoothing: 0 }), srcExtent, g, gridExtent),
    water,
  ).agree;
  return down > up + 0.02;
}

/**
 * Line up for me: slides the height picture, and resizes it by up to a tenth, to where its sea
 * agrees best with the picture's water (coarse steps first, then finer), and gives its extent
 * there. The same extent comes back when nothing is better, or the picture has no water.
 */
export function lineUp(
  src: HeightPicture,
  start: Extent,
  water: Uint8Array | null,
  g: Grid,
  gridExtent: Extent,
): Extent {
  if (!water) return start;
  const cellW = (gridExtent[2] - gridExtent[0]) / g.w;
  const cellH = (gridExtent[3] - gridExtent[1]) / g.h;
  const score = (e: Extent) => bestSea(placed(src, e, g, gridExtent), water).agree;
  const at = (cx: number, cy: number, w: number, h: number): Extent => [
    cx - w / 2,
    cy - h / 2,
    cx + w / 2,
    cy + h / 2,
  ];
  let w = start[2] - start[0];
  let h = start[3] - start[1];
  let cx = (start[0] + start[2]) / 2;
  let cy = (start[1] + start[3]) / 2;
  let best = score(start);
  const first = best;
  for (const step of [8, 4, 2, 1, 0.5]) {
    let moved = true;
    for (let guard = 0; moved && guard < 12; guard++) {
      moved = false;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
        [1, 1],
        [-1, -1],
        [1, -1],
        [-1, 1],
      ] as const) {
        const nx = cx + dx * step * cellW;
        const ny = cy + dy * step * cellH;
        const s = score(at(nx, ny, w, h));
        if (s > best + 1e-6) {
          best = s;
          cx = nx;
          cy = ny;
          moved = true;
        }
      }
      // A size a little larger or smaller, kept within a tenth of where it started.
      for (const k of [1 + step * 0.004, 1 - step * 0.004]) {
        const nw = w * k;
        const ratio = nw / (start[2] - start[0]);
        if (ratio > 1.1 || ratio < 0.9) continue;
        const s = score(at(cx, cy, nw, h * k));
        if (s > best + 1e-6) {
          best = s;
          w = nw;
          h *= k;
          moved = true;
        }
      }
    }
  }
  // A gain too small to see is no reason to move it.
  return best > first + 0.002 ? at(cx, cy, w, h) : start;
}

/**
 * Match two points: the extent at which two places of the height picture (each as a position on
 * the map where it lies now) fall on two places of the map. Its proportions are kept; two pairs
 * fix its position and size. Null when the two places are too close together to tell.
 */
export function matchTwoPoints(
  extent: Extent,
  onHeights: [readonly [number, number], readonly [number, number]],
  onMap: [readonly [number, number], readonly [number, number]],
): Extent | null {
  const [h1, h2] = onHeights;
  const [m1, m2] = onMap;
  const dh = Math.hypot(h2[0] - h1[0], h2[1] - h1[1]);
  const dm = Math.hypot(m2[0] - m1[0], m2[1] - m1[1]);
  const size = Math.hypot(extent[2] - extent[0], extent[3] - extent[1]);
  if (dh < size * 0.05 || dm < size * 0.02) return null;
  const k = dm / dh;
  // The first place stays under the first point; everything else is scaled about it.
  const x0 = m1[0] - (h1[0] - extent[0]) * k;
  const y0 = m1[1] - (h1[1] - extent[1]) * k;
  return [x0, y0, x0 + (extent[2] - extent[0]) * k, y0 + (extent[3] - extent[1]) * k];
}

/** The dialog's verdict on the coast match: lined up, nearly, or not. */
export function verdict(match: number | null): "none" | "good" | "near" | "off" {
  if (match === null) return "none";
  return match >= 0.85 ? "good" : match >= 0.68 ? "near" : "off";
}
