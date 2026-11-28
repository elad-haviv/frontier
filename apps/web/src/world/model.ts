/**
 * The World Wizard's world (stage 34): a globe as a grid of one-degree cells, built in stages that
 * each read the one before: land and sea, plates, their drift over time, heights, climate, biomes.
 * The models are believable and fast, not a survey (the approved decision): plates are rigid
 * pieces that slide over the grid and raise ground where they meet; wind blows in bands set by the
 * spin; rain falls where wet air meets rising land and is missing behind it. Everything here is
 * pure and seeded, so the same seed and choices rebuild the same world.
 * See docs/designs/stage-34-world-wizard.md.
 */
import { BIOME_KINDS, type BiomeKind } from "@frontier/schema";

export const W = 360;
export const H = 180;
export const N = W * H;
/** The height of the highest ground the model can make, in metres: a height of 1. */
export const METRES = 9000;
/** One step of drift, in millions of years. */
export const STEP_MY = 2;
/** A speed in cm a year, as cells in one step: a cell is about 111 km at the equator. */
const CELLS_PER_CM = (STEP_MY * 10) / 111;

export const STAGES = ["land", "plates", "sim", "height", "climate", "biome"] as const;
export type Stage = (typeof STAGES)[number];

export interface WorldSettings {
  seed: number;
  /** The tilt of the axis, in degrees. */
  tilt: number;
  /** The length of a day, in hours. */
  day: number;
  /** The radius, in Earth's. */
  size: number;
  /** 1: it spins west to east, as Earth does. -1: east to west. */
  spin: 1 | -1;
  /** How much of the surface the rolled land covers, in percent. */
  landPct: number;
  /** A few large lands, or many small ones. */
  few: boolean;
  plates: number;
  /** The sea level, as a height: above 0 drowns land. */
  sea: number;
  mountains: number;
  rough: number;
  /** Degrees warmer or colder than Earth, from where the world lies by its star. */
  sun: number;
  /** Degrees warmer or colder than that, by the author's choice. */
  warm: number;
  wet: number;
}

export const DEFAULT_SETTINGS: WorldSettings = {
  seed: 4127,
  tilt: 23,
  day: 24,
  size: 1,
  spin: 1,
  landPct: 32,
  few: true,
  plates: 9,
  sea: 0,
  mountains: 1,
  rough: 1,
  sun: 0,
  warm: 0,
  wet: 1,
};

/** The eight ways a plate drifts, as steps on the grid: north first, then clockwise. */
export const DIRECTIONS: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
];
export const DIRECTION_NAMES = [
  "north",
  "north-east",
  "east",
  "south-east",
  "south",
  "south-west",
  "west",
  "north-west",
] as const;

export interface Drift {
  /** An index into `DIRECTIONS`. */
  dir: number;
  /** In cm a year. */
  speed: number;
}

/** No biome painted here. */
export const UNPAINTED = 255;

export interface World {
  s: WorldSettings;
  /** The land as rolled or drawn: 1 land, 0 sea. */
  land: Uint8Array;
  /** The plate each cell is on, now. */
  plate: Uint8Array;
  drift: Drift[];
  /** How far each plate has drifted since it last moved a whole cell: x then y for each. */
  carry: Float32Array;
  /** 1: continental crust; 0: sea floor. */
  crust: Uint8Array;
  /** The crust's own height, before sea level and detail. */
  h: Float32Array;
  /** Millions of years of drift so far. */
  my: number;
  /** The height of each cell above the sea, -1 to 1; above 0 is land. */
  elev: Float32Array;
  /** °C, the mean of the year. */
  temp: Float32Array;
  /** 0 (none) to 1. */
  rain: Float32Array;
  /** An index into `BIOME_KINDS`. */
  biome: Uint8Array;
  /** The biome painted by hand, or `UNPAINTED`. */
  painted: Uint8Array;
  /** Which stages are built from what is before them. */
  ok: Record<Stage, boolean>;
}

// ---- The grid ------------------------------------------------------------------------------------

/** The latitude of each row's middle, in radians: north first. */
export const LAT = new Float32Array(H);
const CX = new Float32Array(N);
const CY = new Float32Array(N);
const CZ = new Float32Array(N);
for (let y = 0; y < H; y++) {
  LAT[y] = (0.5 - (y + 0.5) / H) * Math.PI;
  for (let x = 0; x < W; x++) {
    const lon = ((x + 0.5) / W - 0.5) * 2 * Math.PI;
    const i = y * W + x;
    CX[i] = Math.cos(LAT[y]!) * Math.sin(lon);
    CY[i] = Math.sin(LAT[y]!);
    CZ[i] = Math.cos(LAT[y]!) * Math.cos(lon);
  }
}

/** The cell at a latitude and longitude, in radians. */
export function cellAt(lat: number, lon: number): number {
  const y = Math.max(0, Math.min(H - 1, Math.floor((0.5 - lat / Math.PI) * H)));
  const u = (((lon / (2 * Math.PI) + 0.5) % 1) + 1) % 1;
  return y * W + (Math.floor(u * W) % W);
}

/** The latitude and longitude of a cell's middle, in degrees. */
export function cellDegrees(i: number): [number, number] {
  return [(LAT[Math.floor(i / W)]! * 180) / Math.PI, (((i % W) + 0.5) / W - 0.5) * 360];
}

// ---- Seeded numbers and noise --------------------------------------------------------------------

export function random(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(x: number, y: number, z: number, s: number): number {
  let n =
    Math.imul(x, 374761393) ^
    Math.imul(y, 668265263) ^
    Math.imul(z, 1440662683) ^
    Math.imul(s, 1274126177);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** Smooth noise at a point in space, 0 to 1. Sampled on the sphere it has no seam and no poles. */
export function noise(x: number, y: number, z: number, s: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = x - xi;
  const yf = y - yi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const w = zf * zf * (3 - 2 * zf);
  return mix(
    mix(
      mix(hash(xi, yi, zi, s), hash(xi + 1, yi, zi, s), u),
      mix(hash(xi, yi + 1, zi, s), hash(xi + 1, yi + 1, zi, s), u),
      v,
    ),
    mix(
      mix(hash(xi, yi, zi + 1, s), hash(xi + 1, yi, zi + 1, s), u),
      mix(hash(xi, yi + 1, zi + 1, s), hash(xi + 1, yi + 1, zi + 1, s), u),
      v,
    ),
    w,
  );
}

/** Noise of several sizes laid over each other, at a point on the unit sphere. */
export function layered(
  x: number,
  y: number,
  z: number,
  seed: number,
  freq: number,
  octaves: number,
): number {
  let sum = 0;
  let amp = 0.5;
  let f = freq;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(x * f + 9, y * f + 9, z * f + 9, seed + o * 17);
    amp *= 0.5;
    f *= 2;
  }
  return sum;
}

function field(seed: number, freq: number, octaves: number): Float32Array {
  const f = new Float32Array(N);
  for (let i = 0; i < N; i++) f[i] = layered(CX[i]!, CY[i]!, CZ[i]!, seed, freq, octaves);
  return f;
}

/** Softens a field in place, round the globe east to west. */
export function blur(a: Float32Array, passes: number): Float32Array {
  const b = new Float32Array(N);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < H; y++) {
      const up = y > 0 ? y - 1 : y;
      const down = y < H - 1 ? y + 1 : y;
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        b[i] =
          (a[i]! * 2 +
            a[y * W + ((x + 1) % W)]! +
            a[y * W + ((x + W - 1) % W)]! +
            a[up * W + x]! +
            a[down * W + x]!) /
          6;
      }
    }
    a.set(b);
  }
  return a;
}

// ---- The world and its stages --------------------------------------------------------------------

export function newWorld(settings: WorldSettings = DEFAULT_SETTINGS): World {
  return {
    s: { ...settings },
    land: new Uint8Array(N),
    plate: new Uint8Array(N),
    drift: [],
    carry: new Float32Array(0),
    crust: new Uint8Array(N),
    h: new Float32Array(N),
    my: 0,
    elev: new Float32Array(N),
    temp: new Float32Array(N),
    rain: new Float32Array(N),
    biome: new Uint8Array(N),
    painted: new Uint8Array(N).fill(UNPAINTED),
    ok: { land: false, plates: false, sim: false, height: false, climate: false, biome: false },
  };
}

/** Marks a stage, and every stage after it, as needing to be built again. */
export function dirty(world: World, from: Stage): void {
  for (let i = STAGES.indexOf(from); i < STAGES.length; i++) world.ok[STAGES[i]!] = false;
}

/** Builds every stage up to and including this one that is not built. */
export function ensure(world: World, upTo: Stage): void {
  for (let i = 0; i <= STAGES.indexOf(upTo); i++) {
    const stage = STAGES[i]!;
    if (world.ok[stage]) continue;
    BUILD[stage](world);
    world.ok[stage] = true;
  }
}

/** The broad shape of the lands: what the rolled land and the first heights are cut from. */
const shapeOf = (s: WorldSettings) => field(s.seed + 1, s.few ? 1.3 : 2.6, 5);

/** Rolls the land: the highest part of a noise field, as much of it as was asked for. */
export function rollLand(world: World): void {
  const shape = shapeOf(world.s);
  // By area, not by cells: a row near a pole covers little.
  const order = Array.from({ length: N }, (_, i) => i).sort((a, b) => shape[b]! - shape[a]!);
  let total = 0;
  for (let y = 0; y < H; y++) total += Math.cos(LAT[y]!) * W;
  const want = (total * world.s.landPct) / 100;
  world.land.fill(0);
  let got = 0;
  for (const i of order) {
    if (got >= want) break;
    world.land[i] = 1;
    got += Math.cos(LAT[Math.floor(i / W)]!);
  }
}

/** Rolls the plates: each cell joins the nearest of some points on the globe, with ragged edges. */
export function rollPlates(world: World): void {
  const { s } = world;
  const r = random(s.seed + 50);
  const warp = field(s.seed + 3, 3, 3);
  const points: [number, number, number][] = [];
  world.drift = [];
  for (let p = 0; p < s.plates; p++) {
    const z = r() * 2 - 1;
    const t = r() * 2 * Math.PI;
    const q = Math.sqrt(1 - z * z);
    points.push([q * Math.cos(t), z, q * Math.sin(t)]);
    world.drift.push({ dir: Math.floor(r() * 8), speed: 2 + Math.round(r() * 6) });
  }
  world.carry = new Float32Array(s.plates * 2);
  for (let i = 0; i < N; i++) {
    const w = (warp[i]! - 0.5) * 0.9;
    let best = -9;
    let at = 0;
    for (let p = 0; p < points.length; p++) {
      const pt = points[p]!;
      const dot = (CX[i]! + w) * pt[0] + (CY[i]! - w) * pt[1] + (CZ[i]! + w) * pt[2];
      if (dot > best) {
        best = dot;
        at = p;
      }
    }
    world.plate[i] = at;
  }
}

/** Puts the crust back to the start: the land as drawn, no time passed. */
export function resetDrift(world: World): void {
  const shape = shapeOf(world.s);
  for (let i = 0; i < N; i++) {
    world.crust[i] = world.land[i]!;
    world.h[i] = world.land[i] ? 0.12 + 0.12 * shape[i]! : -0.5;
  }
  world.my = 0;
  world.carry.fill(0);
}

/** A plate's drift in cells a step: x east, y south. */
export function velocity(world: World, plate: number): [number, number] {
  const d = world.drift[plate];
  if (!d) return [0, 0];
  const dir = DIRECTIONS[d.dir] ?? DIRECTIONS[0]!;
  const cells = d.speed * CELLS_PER_CM;
  return [dir[0]! * cells, dir[1]! * cells];
}

/**
 * One step of drift. Each plate moves by whole cells once its drift has added up to one. Where
 * two pieces of crust land on the same cell they have met: land on land folds into mountains,
 * sea floor under land raises a coastal range, sea floor on sea floor raises an island arc. Where
 * no crust lands, the plates have parted and new sea floor opens, high at first (a ridge) and
 * sinking as it ages.
 */
export function driftStep(world: World): void {
  const { plate, crust, h, carry } = world;
  const count = world.drift.length;
  const shift: [number, number][] = [];
  for (let p = 0; p < count; p++) {
    const v = velocity(world, p);
    carry[p * 2] = carry[p * 2]! + v[0];
    carry[p * 2 + 1] = carry[p * 2 + 1]! + v[1];
    const sx = Math.trunc(carry[p * 2]!);
    const sy = Math.trunc(carry[p * 2 + 1]!);
    carry[p * 2] = carry[p * 2]! - sx;
    carry[p * 2 + 1] = carry[p * 2 + 1]! - sy;
    shift.push([sx, sy]);
  }
  const NONE = 255;
  const np = new Uint8Array(N).fill(NONE);
  const nc = new Uint8Array(N);
  const nh = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const p = plate[i]!;
    const s = shift[p] ?? [0, 0];
    const y = Math.floor(i / W) + s[1];
    if (y < 0 || y >= H) continue;
    const j = y * W + (((i % W) + s[0] + W * 4) % W);
    if (np[j] === NONE) {
      np[j] = p;
      nc[j] = crust[i]!;
      nh[j] = h[i]!;
    } else if (np[j] === p) {
      // The same plate folded on itself at a pole: nothing met.
      if (h[i]! > nh[j]!) nh[j] = h[i]!;
      nc[j] = nc[j]! | crust[i]!;
    } else if (nc[j] && crust[i]) {
      // Folded ranges grow more slowly the higher they are.
      const top = Math.max(nh[j]!, h[i]!);
      nh[j] = top + 0.045 * Math.max(0, 1 - top / 0.8);
    } else if (nc[j] || crust[i]) {
      const land = nc[j] ? nh[j]! : h[i]!;
      if (!nc[j]) np[j] = p;
      nc[j] = 1;
      // A coastal range grows more slowly the higher it is, and stops short of the highest.
      nh[j] = land + 0.03 * Math.max(0, 1 - land / 0.55);
    } else {
      nh[j] = Math.min(0.1, Math.max(nh[j]!, h[i]!) + 0.045);
      if (nh[j]! > 0.03) nc[j] = 1;
    }
  }
  // New sea floor where nothing landed, joined to the plate beside it.
  for (let pass = 0, holes = 1; holes > 0 && pass < 200; pass++) {
    holes = 0;
    for (let j = 0; j < N; j++) {
      if (np[j] !== NONE) continue;
      const x = j % W;
      const y = Math.floor(j / W);
      const near = [
        y * W + ((x + 1) % W),
        y * W + ((x + W - 1) % W),
        y > 0 ? j - W : j,
        y < H - 1 ? j + W : j,
      ];
      let found = NONE;
      for (const k of near) {
        if (np[k] !== NONE) {
          found = np[k]!;
          break;
        }
      }
      if (found === NONE) holes++;
      else {
        np[j] = found;
        nc[j] = 0;
        nh[j] = -0.28;
      }
    }
  }
  for (let j = 0; j < N; j++) {
    if (np[j] === NONE) np[j] = 0;
    // Sea floor sinks as it ages; high mountains wear down.
    if (!nc[j]) nh[j] = nh[j]! + (-0.55 - nh[j]!) * 0.03;
    else if (nh[j]! > 0.3) nh[j] = nh[j]! * 0.996;
  }
  plate.set(np);
  crust.set(nc);
  h.set(nh);
  world.my += STEP_MY;
}

/**
 * The heights: the crust's own height softened into shelves and slopes, raised where plates are
 * closing on each other now and lowered where they part, with small detail on top, then measured
 * from the sea level.
 */
export function buildHeights(world: World): void {
  const { s, plate, h, elev } = world;
  const detail = field(s.seed + 2, 6, 4);
  const lift = new Float32Array(N);
  const meet = (i: number, j: number, along: 0 | 1) => {
    const p = plate[i]!;
    const q = plate[j]!;
    if (p === q) return;
    let closing = velocity(world, p)[along] - velocity(world, q)[along];
    if (closing < 0) closing *= 0.35;
    lift[i] = lift[i]! + closing;
    lift[j] = lift[j]! + closing;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      meet(i, y * W + ((x + 1) % W), 0);
      if (y < H - 1) meet(i, i + W, 1);
    }
  }
  blur(lift, 6);
  const base = blur(Float32Array.from(h), 2);
  for (let i = 0; i < N; i++) {
    const high = base[i]! > -0.08;
    const e =
      base[i]! +
      lift[i]! * s.mountains * (high ? 0.9 : 0.25) +
      (detail[i]! - 0.47) * s.rough * (high ? 0.3 : 0.1) -
      s.sea;
    elev[i] = Math.max(-1, Math.min(1, e));
  }
}

/** Which way the wind blows along a row: 1 to the east, -1 to the west. */
export function windAt(world: World, y: number): 1 | -1 {
  const deg = (Math.abs(LAT[y]!) * 180) / Math.PI;
  // Trade winds, westerlies, polar easterlies: all of them turn round with the spin.
  const band = deg < 30 ? -1 : deg < 60 ? 1 : -1;
  return (band * world.s.spin) as 1 | -1;
}

/**
 * The climate. Warmth falls from the equator to the poles (less so on a world that leans far
 * over) and with height. Air is carried round each band by its wind: it takes up water over the
 * sea and loses it over land, most where the ground rises under it, so the far side of a range is
 * dry. Bands of rising and sinking air make the equator and the mid-latitudes wetter.
 */
export function buildClimate(world: World): void {
  const { s, elev, temp, rain } = world;
  const detail = field(s.seed + 4, 5, 3);
  const equator = 27 + s.sun + s.warm;
  const fall = 46 * (1 - s.tilt / 150);
  const carried = new Float32Array(N);
  for (let y = 0; y < H; y++) {
    const sin = Math.sin(LAT[y]!);
    const deg = (Math.abs(LAT[y]!) * 180) / Math.PI;
    const d = windAt(world, y);
    const band =
      0.55 * Math.exp((-deg * deg) / 200) + 0.3 * Math.exp(-((deg - 52) * (deg - 52)) / 250) + 0.04;
    let wet = 0.5;
    let before = -1;
    // Twice round, so the air's wetness at the start does not matter.
    for (let n = 0; n < W * 2; n++) {
      const x = (((d > 0 ? n : -n) % W) + W) % W;
      const i = y * W + x;
      if (elev[i]! <= 0) {
        wet = Math.min(1, wet + 0.03);
        carried[i] = wet * 0.25;
      } else {
        const rise = before >= 0 ? Math.max(0, elev[i]! - Math.max(0, elev[before]!)) : 0;
        const falls = wet * Math.min(0.35, 0.015 + rise * 3);
        carried[i] = falls * 6.4 + wet * 0.15;
        wet -= falls;
      }
      before = i;
    }
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      temp[i] = equator - fall * sin * sin - Math.max(0, elev[i]!) * 42;
      const fell = band * 0.35 + carried[i]! * 1.6 + (detail[i]! - 0.5) * 0.15;
      rain[i] = Math.max(0, Math.min(1, fell * s.wet));
    }
  }
  blur(rain, 3);
}

const kind = (k: BiomeKind): number => BIOME_KINDS.indexOf(k);
export const OCEAN = kind("ocean");
export const COAST = kind("coast");
export const ICE = kind("ice");
const TUNDRA = kind("tundra");
const TAIGA = kind("taiga");
const FOREST = kind("forest");
const JUNGLE = kind("jungle");
const GRASSLAND = kind("grassland");
const SAVANNA = kind("savanna");
const SCRUB = kind("scrub");
const SAND = kind("desert-sand");
const ROCK = kind("desert-rock");
const WETLAND = kind("wetland");
const ALPINE = kind("alpine");

/** The biome of a place from its height, warmth and rain. */
export function classify(e: number, t: number, p: number): number {
  if (e <= 0) return t < -7 ? ICE : e > -0.12 ? COAST : OCEAN;
  if (t < -9) return ICE;
  if (e > 0.5 && t < 6) return ALPINE;
  if (t < 0) return TUNDRA;
  if (t < 7) return p > 0.22 ? TAIGA : TUNDRA;
  if (e < 0.05 && p > 0.5) return WETLAND;
  if (t < 20) return p < 0.1 ? ROCK : p < 0.17 ? SCRUB : p < 0.3 ? GRASSLAND : FOREST;
  return p < 0.09 ? SAND : p < 0.17 ? SCRUB : p < 0.36 ? SAVANNA : JUNGLE;
}

/** Whether a biome is one of water: painted water is kept only on the sea, and land only on land. */
export const isWater = (biome: number): boolean => biome === OCEAN || biome === COAST;

/** Whether a painted biome still fits the ground under it. Ice lies on both. */
export const fits = (painted: number, e: number): boolean =>
  painted === ICE || isWater(painted) === e <= 0;

/** The biomes: worked out from the climate, with what was painted by hand kept where it fits. */
export function buildBiomes(world: World): void {
  const { elev, temp, rain, biome, painted } = world;
  for (let i = 0; i < N; i++) {
    const p = painted[i]!;
    biome[i] = p !== UNPAINTED && fits(p, elev[i]!) ? p : classify(elev[i]!, temp[i]!, rain[i]!);
  }
}

const BUILD: Record<Stage, (world: World) => void> = {
  land: rollLand,
  plates: rollPlates,
  sim: resetDrift,
  height: buildHeights,
  climate: buildClimate,
  biome: buildBiomes,
};

// ---- Painting and reading ------------------------------------------------------------------------

/**
 * The cells under a round brush: a disc on the globe, so it is as wide near a pole as at the
 * equator. `radius` is in cells at the equator.
 */
export function brushCells(centre: number, radius: number): number[] {
  const cy = Math.floor(centre / W);
  const cx = centre % W;
  const cells: number[] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    const y = cy + dy;
    if (y < 0 || y >= H) continue;
    const wide = Math.min(W / 2, Math.round(radius / Math.max(0.06, Math.cos(LAT[y]!))));
    for (let dx = -wide; dx <= wide; dx++) {
      const fx = wide === 0 ? 0 : dx / wide;
      const fy = radius === 0 ? 0 : dy / radius;
      if (fx * fx + fy * fy > 1) continue;
      cells.push(y * W + ((cx + dx + W * 4) % W));
    }
  }
  return cells;
}

export interface WorldFacts {
  /** The share of the surface above the sea, in percent. */
  land: number;
  /** The highest ground, in metres. */
  peak: number;
  /** The share of the surface each biome covers, 0 to 1, by index into `BIOME_KINDS`. */
  shares: number[];
}

/** What the world is like now, by area. Builds the stages it reads. */
export function factsOf(world: World): WorldFacts {
  ensure(world, "biome");
  const shares = BIOME_KINDS.map(() => 0);
  let total = 0;
  let land = 0;
  let peak = 0;
  for (let i = 0; i < N; i++) {
    const area = Math.cos(LAT[Math.floor(i / W)]!);
    total += area;
    shares[world.biome[i]!] = shares[world.biome[i]!]! + area;
    if (world.elev[i]! > 0) {
      land += area;
      if (world.elev[i]! > peak) peak = world.elev[i]!;
    }
  }
  return {
    land: Math.round((100 * land) / total),
    peak: Math.round((peak * METRES) / 100) * 100,
    shares: shares.map((v) => v / total),
  };
}

/** The middle of each plate, as a cell, for drawing its arrow; -1 for a plate with no cells. */
export function plateMiddles(world: World): number[] {
  const sums = world.drift.map(() => [0, 0, 0] as [number, number, number]);
  for (let i = 0; i < N; i += 2) {
    const s = sums[world.plate[i]!];
    if (!s) continue;
    s[0] += CX[i]!;
    s[1] += CY[i]!;
    s[2] += CZ[i]!;
  }
  return sums.map(([x, y, z]) => {
    const n = Math.hypot(x, y, z);
    return n === 0 ? -1 : cellAt(Math.asin(y / n), Math.atan2(x, z));
  });
}
