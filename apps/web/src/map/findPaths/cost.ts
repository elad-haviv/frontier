/**
 * How fast each way of travelling is over each kind of ground: the cost surface a route is
 * searched on. Speeds are in km an hour and built in (the owner's per-world speeds come later);
 * the tool's tooltip shows them.
 */
import { type BiomeCells, biomeFactor } from "./biomes.ts";

export type Mode = "foot" | "horse" | "cart" | "ship";
/** Fastest; Flattest (climbing counts for more); Avoid water (no fords, no sea). */
export type Variant = "fast" | "flat" | "dry";

export interface ModeSpeeds {
  /** As in "about 3 days ‹by cart›". */
  name: string;
  open: number;
  forest: number;
  marsh: number;
  road: number;
  /** Through a river with no bridge. */
  ford: number;
  /** Over the sea; 0 when it cannot be crossed. */
  sea: number;
  /** The share of the speed left on ground painted as mountains, where there are no heights. */
  upland: number;
  /** How hard a slope slows it: time is multiplied by exp(k·|slope + off|), 1 on the flat. */
  k: number;
  /** The slope it is quickest on, as a (negative) offset: walking is quickest a little downhill. */
  off: number;
  /** The steepest grade it can climb or go down at all, as a fraction; the owner can change it. */
  steepest: number;
}

/**
 * On foot is Tobler's hiking function (k 3.5, quickest at a 5% fall). A horse and a cart have the
 * same shape with a steeper constant and no gain from going downhill.
 */
export const MODES: Record<Mode, ModeSpeeds> = {
  foot: {
    name: "on foot",
    open: 4,
    forest: 2.8,
    marsh: 1.6,
    road: 5,
    ford: 0.33,
    sea: 0,
    upland: 0.55,
    k: 3.5,
    off: 0.05,
    steepest: 0.35,
  },
  horse: {
    name: "on horseback",
    open: 7.5,
    forest: 3.4,
    marsh: 2,
    road: 10,
    ford: 0.6,
    sea: 0,
    upland: 0.45,
    k: 6,
    off: 0,
    steepest: 0.2,
  },
  cart: {
    name: "by cart",
    open: 2.3,
    forest: 0.9,
    marsh: 0.4,
    road: 5,
    ford: 0.09,
    sea: 0,
    upland: 0.3,
    k: 11,
    off: 0,
    steepest: 0.12,
  },
  ship: {
    name: "by ship",
    open: 4,
    forest: 2.8,
    marsh: 1.6,
    road: 5,
    ford: 0.33,
    sea: 9,
    upland: 0.55,
    k: 3.5,
    off: 0.05,
    steepest: 0.35,
  },
};

/** What the ground is in each cell, from the picture, the heights and the map's own features. */
export interface Ground {
  sea: Uint8Array;
  forest: Uint8Array;
  marsh: Uint8Array;
  /** 0 to 1: how much the cell is mountains, where that slows by itself (see `uplandSlows`). */
  upland: Float32Array;
  road: Uint8Array;
  /** A river's own cells: with a road on the same cell, a bridge. */
  river: Uint8Array;
  /** The river made closed to four-way steps, so no diagonal step slips through it. */
  riverWide: Uint8Array;
  /** Cliffs: nothing passes. Left out: none. */
  cliff?: Uint8Array;
  /** The biome zones' cells: where set, a biome's speed replaces the picture's forest and marsh. */
  biomes?: BiomeCells;
}

export interface Surface {
  /** Hours per km in each cell; Infinity where there is no way through. */
  inv: Float32Array;
  k: number;
  off: number;
  /** The fastest speed there is, for the search's estimate of what is left. */
  vmax: number;
  /** Flattest: each step also costs (1 + flat·|slope|), in the search only. */
  flat: number;
  /** The sea, which no tunnel goes under. */
  sea?: Uint8Array;
}

/** How much Flattest dislikes a slope. */
export const FLAT_WEIGHT = 45;

export function surfaceFor(ground: Ground, mode: Mode, variant: Variant): Surface {
  const m = MODES[mode];
  const dry = variant === "dry";
  const n = ground.sea.length;
  const inv = new Float32Array(n);
  // A biome may be quicker than open ground (a custom one up to three times), so the estimate
  // of what is left takes the fastest cell there is.
  let vmax = Math.max(m.road, m.sea, m.open);
  for (let i = 0; i < n; i++) {
    let v: number;
    if (ground.cliff?.[i]) v = 0;
    else if (ground.sea[i]) v = dry ? 0 : m.sea;
    else if (ground.road[i]) v = m.road;
    else if (ground.riverWide[i]) v = dry ? 0 : m.ford;
    else {
      const biome = biomeFactor(ground.biomes, mode, i);
      if (biome >= 0) v = m.open * biome;
      else v = ground.marsh[i] ? m.marsh : ground.forest[i] ? m.forest : m.open;
      v *= 1 - (1 - m.upland) * ground.upland[i]!;
    }
    if (v > vmax) vmax = v;
    inv[i] = v > 0 ? 1 / v : Infinity;
  }
  return {
    inv,
    k: m.k,
    off: m.off,
    vmax,
    flat: variant === "flat" ? FLAT_WEIGHT : 0,
    sea: ground.sea,
  };
}

/**
 * What a slope multiplies the time of a step by: 1 on the flat, more uphill and steeply
 * downhill; on foot a little less than 1 on a gentle fall.
 */
export function slopeFactor(k: number, off: number, slope: number): number {
  return Math.exp(k * (Math.abs(slope + off) - Math.abs(off)));
}

/** The least a slope can multiply a step's time by: at the slope the mode is quickest on. */
export const bestSlopeFactor = (k: number, off: number): number => Math.exp(-k * Math.abs(off));
