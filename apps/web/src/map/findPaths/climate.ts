/**
 * Suggest biomes' climate: a rough one, worked out from the height field Find paths uses, the
 * latitude and the prevailing wind, then read as biomes on a Whittaker-style table. It is a
 * starting point, not a survey: no ocean currents, seasons, monsoons or soil.
 *
 * - Temperature: 27 − 0.0075·lat² °C at sea level (27 °C at the equator, 0 °C at 60°), 6.5 °C
 *   colder for each km of height, shifted by the owner's Temperature.
 * - Rain: the air crosses the map with the wind. It takes up water over the sea, loses a little
 *   for each km over land, and rains hard where the ground rises under it; what is left behind a
 *   range is dry (the rain shadow). Without a wind, rain falls by the distance to the sea. Coasts
 *   get a little sea-breeze rain; Wetness scales it all; the field is softened so it does not run
 *   in stripes along the wind.
 * - Wetland: low, flat ground where much water gathers, unless it is dry.
 * See docs/designs/stage-21-biome-zones.md.
 */
import { BIOME_KINDS, type BiomeKind, type Wind } from "@frontier/schema";
import { boxMean } from "../findAreas/ink.ts";

/** Where each wind blows towards, in cells: from the west, the air moves east (+x). */
export const WIND_STEP: Record<Wind, [number, number] | null> = {
  N: [0, 1],
  NE: [-1, 1],
  E: [-1, 0],
  SE: [-1, -1],
  S: [0, -1],
  SW: [1, -1],
  W: [1, 0],
  NW: [1, 1],
  none: null,
};

export interface ClimateInput {
  w: number;
  h: number;
  /** Metres above the sea of each cell; the sea's cells are not read. */
  metres: Float32Array;
  sea: Uint8Array;
  kmPerCell: number;
  /** The land that drains through each cell, in km². */
  catchment: Float32Array;
  /** The latitude of the map's middle and its north–south span, in degrees. */
  lat: number;
  span: number;
  wind: Wind;
  /** °C added to every temperature. */
  temp: number;
  /** Rain is multiplied by this. */
  wet: number;
}

export interface Climate {
  /** °C. */
  T: Float32Array;
  /** Rainfall, in the table's units (about cm a year). */
  P: Float32Array;
  /** Each cell's biome, as its index in BIOME_KINDS; SEA for the sea. */
  label: Uint8Array;
}

export const SEA = 255;
const index = new Map(BIOME_KINDS.map((k, i) => [k, i]));
const idx = (k: BiomeKind) => index.get(k)!;

/** The biome of a cell from its temperature (°C), rainfall and height (m): the table. */
export function classify(t: number, p: number, m: number): BiomeKind {
  if (t < -7) return "ice";
  if (t < 0) return m > 1100 ? "alpine" : "tundra";
  if (t < 5) return m > 1300 ? "alpine" : p < 35 ? "tundra" : "taiga";
  if (t < 19) {
    if (p < 30) return t >= 14 ? "desert-sand" : "desert-rock";
    if (p < 82) return t >= 12 ? "scrub" : "grassland";
    return "forest";
  }
  return p < 42 ? "desert-sand" : p < 135 ? "savanna" : "jungle";
}

/** The distance of each land cell to the sea, in km (two chamfer passes); far when there is none. */
export function seaDistance(
  w: number,
  h: number,
  sea: Uint8Array,
  kmPerCell: number,
): Float32Array {
  const n = w * h;
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) d[i] = sea[i] ? 0 : 1e9;
  const diag = Math.SQRT2 * kmPerCell;
  const pass = (forward: boolean) => {
    for (let k = 0; k < n; k++) {
      const i = forward ? k : n - 1 - k;
      const x = i % w;
      const y = (i / w) | 0;
      const s = forward ? -1 : 1;
      const look = (xx: number, yy: number, cost: number) => {
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) return;
        const v = d[yy * w + xx]! + cost;
        if (v < d[i]!) d[i] = v;
      };
      look(x + s, y, kmPerCell);
      look(x, y + s, kmPerCell);
      look(x + s, y + s, diag);
      look(x - s, y + s, diag);
    }
  };
  pass(true);
  pass(false);
  return d;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** The climate of a map, and the biome of each of its cells. */
export function climateOf(c: ClimateInput): Climate {
  const { w, h, metres, sea, kmPerCell: km } = c;
  const n = w * h;
  const T = new Float32Array(n);
  const M = new Float32Array(n);
  const rain = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    const lat = Math.abs(c.lat + c.span / 2 - ((y + 0.5) / h) * c.span);
    const level = 27 - 0.0075 * lat * lat + c.temp;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      T[i] = level - (6.5 * Math.max(0, metres[i]!)) / 1000;
    }
  }
  const seaKm = seaDistance(w, h, sea, km);
  const step = WIND_STEP[c.wind];
  if (step) {
    const [wx, wy] = step;
    const [px, py] = [-wy, wx];
    const stepKm = Math.hypot(wx, wy) * km;
    const get = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 1 : M[y * w + x]!);
    const cell = (x: number, y: number) => {
      const i = y * w + x;
      const ux = x - wx;
      const uy = y - wy;
      // Mixed a little sideways, so the moisture does not run in lines along the wind.
      const inflow = 0.5 * get(ux, uy) + 0.25 * (get(ux + px, uy + py) + get(ux - px, uy - py));
      if (sea[i]) {
        M[i] = Math.min(1, inflow + 0.06 * stepKm);
        return;
      }
      const upwind = ux < 0 || uy < 0 || ux >= w || uy >= h ? 0 : Math.max(0, metres[uy * w + ux]!);
      const rise = (Math.max(0, metres[i]!) - upwind) / stepKm;
      const share = Math.min(0.9, (0.0028 + 0.12 * clamp01(rise / 70)) * stepKm);
      const fell = inflow * share;
      rain[i] = fell / stepKm;
      M[i] = Math.min(1, inflow - 0.45 * fell + 0.001 * stepKm);
    };
    // Along the wind: every cell after the one upwind of it.
    const xs = wx >= 0 ? [0, w, 1] : [w - 1, -1, -1];
    const ys = wy >= 0 ? [0, h, 1] : [h - 1, -1, -1];
    if (wy === 0) {
      for (let x = xs[0]!; x !== xs[1]; x += xs[2]!) for (let y = 0; y < h; y++) cell(x, y);
    } else {
      for (let y = ys[0]!; y !== ys[1]; y += ys[2]!)
        for (let x = xs[0]!; x !== xs[1]; x += xs[2]!) cell(x, y);
    }
  } else {
    for (let i = 0; i < n; i++) M[i] = sea[i] ? 1 : Math.exp(-seaKm[i]! / 160);
  }
  const P0 = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    P0[i] = sea[i]
      ? 0
      : c.wet * (12 + 90 * M[i]! * M[i]! + 3800 * rain[i]! + 25 * Math.exp(-seaKm[i]! / 10));
  }
  const soft = boxMean(P0, w, h, 3);
  const P = new Float32Array(n);
  for (let i = 0; i < n; i++) P[i] = sea[i] ? 0 : soft[i]!;

  const label = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    label[i] = sea[i] ? SEA : idx(classify(T[i]!, P[i]!, metres[i]!));
  }
  wetlands(c, T, P, label);
  return { T, P, label: majority(majority(label, w, h), w, h) };
}

/**
 * Wetland on low, flat ground where much water gathers (a big river near its mouth), unless it
 * is dry or frozen: grown a few km out from where the most water gathers, along the flat.
 */
function wetlands(c: ClimateInput, T: Float32Array, P: Float32Array, label: Uint8Array): void {
  const { w, h, metres, sea, kmPerCell: km } = c;
  const n = w * h;
  const slope = (i: number) => {
    const x = i % w;
    const y = (i / w) | 0;
    if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) return 0;
    return Math.hypot(metres[i + 1]! - metres[i - 1]!, metres[i + w]! - metres[i - w]!) / (2 * km);
  };
  const flat = (i: number) =>
    !sea[i] && metres[i]! < 130 && slope(i) < 12 && T[i]! > 0 && P[i]! > 55;
  const reach = Math.max(1, Math.round(7 / km));
  const dist = new Int16Array(n).fill(-1);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < n; i++) {
    if (c.catchment[i]! > 140 && flat(i)) {
      dist[i] = 0;
      queue[tail++] = i;
    }
  }
  while (head < tail) {
    const i = queue[head++]!;
    if (dist[i]! >= reach) continue;
    const x = i % w;
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
      if (j < 0 || j >= n || dist[j]! >= 0 || !flat(j)) continue;
      dist[j] = dist[i]! + 1;
      queue[tail++] = j;
    }
  }
  const wet = idx("wetland");
  for (let i = 0; i < n; i++) if (dist[i]! >= 0) label[i] = wet;
}

/** One pass of a majority filter over the land, so that a biome is not a speckle. */
function majority(a: Uint8Array, w: number, h: number): Uint8Array {
  const out = Uint8Array.from(a);
  const count = new Uint16Array(BIOME_KINDS.length);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (a[i] === SEA) continue;
      count.fill(0);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const v = a[i + dy * w + dx]!;
          if (v !== SEA) count[v] = count[v]! + (dx || dy ? 1 : 2);
        }
      }
      let best = a[i]!;
      let most = 0;
      for (let k = 0; k < count.length; k++) {
        if (count[k]! > most) {
          most = count[k]!;
          best = k;
        }
      }
      out[i] = best;
    }
  }
  return out;
}
