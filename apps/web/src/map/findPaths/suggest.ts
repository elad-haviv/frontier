/**
 * Suggest biomes, in Find paths' worker: the height field in use (a height map, the guess from
 * the picture, or one inferred from it: whatever the engine reads), brought onto a working grid
 * small enough to answer every slider at once, its climate worked out and its regions outlined
 * as ghost zones, in the picture's pixels. The biome zones already on the map are left out.
 */
import type { BiomeKind, Wind } from "@frontier/schema";
import type { Px } from "../findAreas/contour.ts";
import { biomeCells, type TerrainBiome } from "./biomes.ts";
import { climateOf } from "./climate.ts";
import { flatGrid, type Grid } from "./grid.ts";
import { regionsOf } from "./regions.ts";

/** The working grid has at most this many cells. */
const MOST_CELLS = 160_000;
/** Without real heights, the highest ground is taken to be this many metres up. */
export const GUESSED_TOP = 2600;
/** Without a scale, the map spans this many degrees north to south unless told. */
export const UNSCALED_SPAN = 10;

export type ClimateView = "biomes" | "temp" | "rain";

export interface SuggestRequest {
  wind: Wind;
  lat: number;
  /** Null: what the map's scale gives. */
  span: number | null;
  temp: number;
  wet: number;
  /** km²; without a scale, in the grid's own cells' km as the span gives them. */
  minArea: number;
  /** The biome zones on the map: no suggestion covers them. */
  biomes: TerrainBiome[];
  /** The field to draw: none for the biomes. */
  view: ClimateView;
}

export interface Ghost {
  /** Its biome and first cell: the same ghost from one run to the next while nothing moves it. */
  key: string;
  kind: BiomeKind;
  /** Null without a scale. */
  km2: number | null;
  ring: Px[];
  /** A point well inside it. */
  at: Px;
}

export interface SuggestReply {
  ghosts: Ghost[];
  /** The span used, and the least the map's scale allows (null without a scale). */
  span: number;
  leastSpan: number | null;
  /** The temperature or the rain as a picture, one pixel a working cell, with its ends. */
  field: {
    w: number;
    h: number;
    /** Pixels of the picture's working copy a side of each of its cells. */
    cellPx: number;
    rgba: Uint8ClampedArray;
    low: number;
    high: number;
  } | null;
  guessed: boolean;
  ms: number;
}

export interface TerrainNow {
  grid: Grid;
  heights: Float32Array;
  sea: Uint8Array;
  acc: Float32Array;
  kmPerCell: number | null;
  top: number | null;
  seaLevel: number | null;
  guessed: boolean;
}

/** The colour ramps of the Temperature (°C) and Rainfall views, as the legend draws them too. */
export const TEMP_RAMP: [number, string][] = [
  [-15, "#3d5f9e"],
  [-5, "#8fb3d9"],
  [0, "#e6eef2"],
  [8, "#d8e3a6"],
  [16, "#f0cf73"],
  [24, "#e0874a"],
  [32, "#b2402a"],
];
export const RAIN_RAMP: [number, string][] = [
  [0, "#c9874a"],
  [30, "#e6c47a"],
  [60, "#e9e2b0"],
  [100, "#a9cf8a"],
  [180, "#4f9a78"],
  [300, "#2f6491"],
];

const rgbOf = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
function rampAt(ramp: [number, string][], v: number): number[] {
  if (v <= ramp[0]![0]) return rgbOf(ramp[0]![1]);
  for (let i = 1; i < ramp.length; i++) {
    if (v <= ramp[i]![0]) {
      const [a, ca] = ramp[i - 1]!;
      const [b, cb] = ramp[i]!;
      const t = (v - a) / (b - a);
      const p = rgbOf(ca);
      const q = rgbOf(cb);
      return p.map((x, j) => x + (q[j]! - x) * t);
    }
  }
  return rgbOf(ramp[ramp.length - 1]![1]);
}

export function suggestBiomes(t: TerrainNow, req: SuggestRequest): SuggestReply {
  const started = performance.now();
  const g = t.grid;
  const f = Math.max(1, Math.ceil(Math.sqrt((g.w * g.h) / MOST_CELLS)));
  const w = Math.max(1, Math.floor(g.w / f));
  const h = Math.max(1, Math.floor(g.h / f));
  const n = w * h;
  // The engine's cells shrunk by f: mean height, the sea where most of the block is sea, and the
  // most water any of its cells gathers.
  const height = new Float32Array(n);
  const sea = new Uint8Array(n);
  const acc = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      let wet = 0;
      let most = 0;
      for (let dy = 0; dy < f; dy++) {
        for (let dx = 0; dx < f; dx++) {
          const i = (y * f + dy) * g.w + x * f + dx;
          s += t.heights[i]!;
          wet += t.sea[i]!;
          most = Math.max(most, t.acc[i]!);
        }
      }
      const o = y * w + x;
      height[o] = s / (f * f);
      sea[o] = wet * 2 > f * f ? 1 : 0;
      acc[o] = most;
    }
  }
  // Heights in metres above the sea.
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i++) {
    if (sea[i]) continue;
    lo = Math.min(lo, height[i]!);
    hi = Math.max(hi, height[i]!);
  }
  const base = t.seaLevel ?? (Number.isFinite(lo) ? lo : 0);
  const scale = t.top !== null ? t.top : hi > base ? GUESSED_TOP / (hi - base) : GUESSED_TOP;
  const metres = new Float32Array(n);
  for (let i = 0; i < n; i++) metres[i] = Math.max(0, (height[i]! - base) * scale);

  const engineKm = t.kmPerCell;
  const leastSpan = engineKm !== null ? (h * f * engineKm) / 111 : null;
  const span =
    leastSpan !== null ? Math.max(req.span ?? leastSpan, leastSpan) : (req.span ?? UNSCALED_SPAN);
  const km = engineKm !== null ? engineKm * f : (span * 111) / h;
  const catchment = new Float32Array(n);
  const engineCellKm2 = (km / f) * (km / f);
  for (let i = 0; i < n; i++) catchment[i] = acc[i]! * engineCellKm2;

  const climate = climateOf({
    w,
    h,
    metres,
    sea,
    kmPerCell: km,
    catchment,
    lat: req.lat,
    span,
    wind: req.wind,
    temp: req.temp,
    wet: req.wet,
  });
  // What is drawn already is not suggested again.
  const work = flatGrid(w, h, g.cell * f);
  const drawn = biomeCells(work, req.biomes);
  const blocked = drawn ? Uint8Array.from(drawn.at, (v) => (v ? 1 : 0)) : null;
  const minCells = Math.max(4, req.minArea / (km * km));
  const cellPx = g.cell * f;
  const toPx = ([x, y]: Px): Px => [x * cellPx - 0.5, y * cellPx - 0.5];
  const ghosts: Ghost[] = regionsOf(climate.label, w, h, blocked, minCells).map((r) => ({
    key: `${r.kind}:${r.first}`,
    kind: r.kind,
    km2: engineKm !== null ? r.cells * km * km : null,
    ring: r.ring.map(toPx),
    at: toPx([(r.deepest % w) + 0.5, Math.floor(r.deepest / w) + 0.5]),
  }));

  let field: SuggestReply["field"] = null;
  if (req.view !== "biomes") {
    const values = req.view === "temp" ? climate.T : climate.P;
    const ramp = req.view === "temp" ? TEMP_RAMP : RAIN_RAMP;
    const rgba = new Uint8ClampedArray(n * 4);
    let low = Infinity;
    let high = -Infinity;
    for (let i = 0; i < n; i++) {
      if (sea[i]) continue;
      const v = values[i]!;
      low = Math.min(low, v);
      high = Math.max(high, v);
      const [r, gg, b] = rampAt(ramp, v);
      rgba[i * 4] = r!;
      rgba[i * 4 + 1] = gg!;
      rgba[i * 4 + 2] = b!;
      rgba[i * 4 + 3] = 190;
    }
    field = {
      w,
      h,
      cellPx,
      rgba,
      low: Number.isFinite(low) ? low : 0,
      high: Number.isFinite(high) ? high : 0,
    };
  }
  return { ghosts, span, leastSpan, field, guessed: t.guessed, ms: performance.now() - started };
}
