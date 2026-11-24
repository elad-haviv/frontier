/**
 * What a painted map's picture says about the ground, for Find paths: where the water is, the
 * forest, the high ground; which thin lines are rivers and which are roads; and from those, a
 * guess at the heights. Nothing here knows a palette. The picture's own colours are sorted into a
 * handful of groups, and each group is judged against the others: water is the group that is
 * blue beside the rest, forest the green one, a river is ink bluer than the picture's ordinary
 * ink. A map in other colours is read the same way.
 */
import { boxMean, type Ink, morph } from "../findAreas/ink.ts";
import type { LabPicture } from "../findAreas/lab.ts";
import { type Grid, gridFor, pool, poolMean } from "./grid.ts";

/** How much darker than its neighbourhood a pixel of a faint line is. */
const FAINT = 5.5;
const DARK = 9;

export interface Colour {
  l: number;
  a: number;
  b: number;
}

export interface Looked {
  /** Faint and dark ink: what a trace follows (dashes of a road are often faint). */
  ink: Uint8Array;
  /** The middle the picture's colours are judged from. */
  ref: Colour;
}

export interface PictureGround {
  grid: Grid;
  water: Uint8Array;
  forest: Uint8Array;
  /** 0 to 1: how much the picture paints the cell as high ground. */
  upland: Float32Array;
  river: Uint8Array;
  road: Uint8Array;
  /** Heights guessed from the picture alone: below 0 is water. */
  guess: Float32Array;
}

/** A hue in degrees, 0 to 360, of a colour seen from a middle. */
const hueOf = (a: number, b: number) => ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
const BLUE: [number, number] = [185, 300];
const GREEN: [number, number] = [95, 185];
const inArc = (hue: number, [from, to]: [number, number]) => hue >= from && hue <= to;
/** Red, orange and brown: the arc that runs through 0. */
const isWarm = (hue: number) => hue >= 330 || hue <= 75;

/**
 * Whether ink of a colour is a river's: blue seen from the picture's middle, and blue in its own
 * right. The second matters on a map that is mostly yellow land, where plain dark ink (low in
 * colour) would otherwise read as "bluer than the rest".
 */
export function isRiverInk(c: Colour, ref: Colour): boolean {
  const ra = c.a - ref.a;
  const rb = c.b - ref.b;
  const own = hueOf(c.a, c.b);
  return (
    Math.hypot(ra, rb) >= 10 &&
    inArc(hueOf(ra, rb), BLUE) &&
    // A cool grey or black ink is not blue enough to be water.
    Math.hypot(c.a, c.b) >= 9 &&
    own >= 170 &&
    own <= 310
  );
}

/** Whether ink of a colour is a road's: red, orange or brown seen from the picture's middle. */
export function isRoadInk(c: Colour, ref: Colour): boolean {
  const ra = c.a - ref.a;
  const rb = c.b - ref.b;
  return Math.hypot(ra, rb) >= 14 && isWarm(hueOf(ra, rb));
}

interface Group extends Colour {
  share: number;
}

/**
 * The picture's colours as at most `k` groups (k-means on a sample of the smoothed colour, ink
 * left out). The start is the same each time: the sample nearest the mean, then each time the
 * sample farthest from the groups so far.
 */
export function colourGroups(
  L: Float32Array,
  A: Float32Array,
  B: Float32Array,
  skip: Uint8Array,
  k = 6,
): Group[] {
  const n = L.length;
  const stride = Math.max(1, Math.floor(n / 20_000));
  const sample: number[] = [];
  for (let i = (stride / 2) | 0; i < n; i += stride) if (!skip[i]) sample.push(i);
  if (sample.length === 0) return [];
  // Lightness counts for half: a shaded hillside is the same ground as a lit one.
  const d2 = (i: number, c: Colour) =>
    (0.5 * (L[i]! - c.l)) ** 2 + (A[i]! - c.a) ** 2 + (B[i]! - c.b) ** 2;
  const mean: Colour = { l: 0, a: 0, b: 0 };
  for (const i of sample) {
    mean.l += L[i]! / sample.length;
    mean.a += A[i]! / sample.length;
    mean.b += B[i]! / sample.length;
  }
  const at = (i: number): Colour => ({ l: L[i]!, a: A[i]!, b: B[i]! });
  const centres: Colour[] = [at(sample.reduce((m, i) => (d2(i, mean) < d2(m, mean) ? i : m)))];
  const nearest = new Float64Array(sample.length).fill(Infinity);
  while (centres.length < k) {
    const last = centres[centres.length - 1]!;
    let far = 0;
    for (let s = 0; s < sample.length; s++) {
      nearest[s] = Math.min(nearest[s]!, d2(sample[s]!, last));
      if (nearest[s]! > nearest[far]!) far = s;
    }
    // Colours closer than this are one ground: a plain picture has fewer groups than k.
    if (nearest[far]! < 36) break;
    centres.push(at(sample[far]!));
  }
  const counts = new Float64Array(centres.length);
  for (let pass = 0; pass < 10; pass++) {
    const sum = centres.map(() => ({ l: 0, a: 0, b: 0 }));
    counts.fill(0);
    for (const i of sample) {
      let best = 0;
      for (let c = 1; c < centres.length; c++) {
        if (d2(i, centres[c]!) < d2(i, centres[best]!)) best = c;
      }
      counts[best] = counts[best]! + 1;
      sum[best]!.l += L[i]!;
      sum[best]!.a += A[i]!;
      sum[best]!.b += B[i]!;
    }
    centres.forEach((c, j) => {
      if (!counts[j]) return;
      c.l = sum[j]!.l / counts[j]!;
      c.a = sum[j]!.a / counts[j]!;
      c.b = sum[j]!.b / counts[j]!;
    });
  }
  return centres.map((c, j) => ({ ...c, share: counts[j]! / sample.length }));
}

type Kind = "water" | "forest" | "upland" | "land";

/**
 * What each group of colours is. All of it is relative: the middle is the mean of the groups (each
 * counted once, so a wide sea does not pull it), and a group is water when it is blue seen from
 * there, forest when green and greener than the other land, upland when clearly paler than the
 * main land. A colour that is plainly yellow, orange or brown is never water, however the rest
 * of the picture lies.
 */
export function judgeGroups(groups: readonly Group[]): { kinds: Kind[]; ref: Colour } {
  const big = groups.filter((g) => g.share >= 0.015);
  const pool_ = big.length > 0 ? big : groups;
  const ref: Colour = { l: 0, a: 0, b: 0 };
  for (const g of pool_) {
    ref.l += g.l / pool_.length;
    ref.a += g.a / pool_.length;
    ref.b += g.b / pool_.length;
  }
  const kinds: Kind[] = groups.map((g) => {
    const ra = g.a - ref.a;
    const rb = g.b - ref.b;
    const chroma = Math.hypot(ra, rb);
    const own = Math.hypot(g.a, g.b);
    const ownHue = hueOf(g.a, g.b);
    // Plainly yellow, orange or brown in its own right.
    const warm = own >= 12 && (ownHue >= 330 || ownHue <= 110);
    if (chroma >= 6 && inArc(hueOf(ra, rb), BLUE) && !warm && g.b < ref.b - 4) return "water";
    return "land";
  });
  const land = groups.map((g, i) => ({ g, i })).filter(({ i }) => kinds[i] === "land");
  const leastGreen = Math.max(...land.filter(({ g }) => g.share >= 0.015).map(({ g }) => g.a));
  for (const { g, i } of land) {
    const ra = g.a - ref.a;
    const rb = g.b - ref.b;
    if (Math.hypot(ra, rb) >= 6 && inArc(hueOf(ra, rb), GREEN) && g.a < leastGreen - 7) {
      kinds[i] = "forest";
    }
  }
  const plain = land.filter(({ i }) => kinds[i] === "land");
  const main = plain.reduce<Group | null>((m, { g }) => (!m || g.share > m.share ? g : m), null);
  if (main && Math.hypot(main.a, main.b) >= 12) {
    for (const { g, i } of plain) {
      if (g !== main && Math.hypot(g.a, g.b) < 0.6 * Math.hypot(main.a, main.b)) {
        kinds[i] = "upland";
      }
    }
  }
  return { kinds, ref };
}

/** Faint and dark ink, by how much darker a pixel is than the mean round it. */
export function inkMasks(pic: LabPicture): { faint: Uint8Array; dark: Uint8Array } {
  const { w, h, L } = pic;
  const mean = boxMean(L, w, h, 6);
  const faint = new Uint8Array(w * h);
  const dark = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const d = mean[i]! - L[i]!;
    if (d > FAINT) faint[i] = 1;
    if (d > DARK) dark[i] = 1;
  }
  return { faint, dark };
}

/** Drops pieces of a mask of cells (four-connected) smaller than `least` cells. */
function dropSpecks(mask: Uint8Array, g: Grid, least: number): void {
  const { w, h } = g;
  const seen = new Uint8Array(mask.length);
  const stack = new Int32Array(mask.length);
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || seen[s]) continue;
    let sp = 0;
    let count = 0;
    stack[sp++] = s;
    seen[s] = 1;
    const members: number[] = [];
    while (sp) {
      const i = stack[--sp]!;
      count++;
      if (count <= least) members.push(i);
      const x = i % w;
      const y = (i / w) | 0;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (j < 0 || !mask[j] || seen[j]) continue;
        seen[j] = 1;
        stack[sp++] = j;
      }
    }
    if (count < least) for (const i of members) mask[i] = 0;
  }
}

/**
 * Heights guessed from what is known of the ground: rising gently with the distance from water
 * (from the map's edge when there is none), with a dome over the high ground.
 */
export function guessHeights(g: Grid, water: Uint8Array, upland: Float32Array): Float32Array {
  const n = g.w * g.h;
  const dist = new Float32Array(n).fill(Infinity);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < n; i++) {
    if (water[i]) {
      dist[i] = 0;
      queue[tail++] = i;
    }
  }
  if (tail === 0) {
    // No water in the picture: the land falls towards the map's edge.
    for (let i = 0; i < n; i++) {
      const x = i % g.w;
      const y = (i / g.w) | 0;
      if (x === 0 || y === 0 || x === g.w - 1 || y === g.h - 1) {
        dist[i] = 0;
        queue[tail++] = i;
      }
    }
  }
  while (head < tail) {
    const i = queue[head++]!;
    const x = i % g.w;
    const y = (i / g.w) | 0;
    const next = dist[i]! + 1;
    for (const j of [x > 0 ? i - 1 : -1, x < g.w - 1 ? i + 1 : -1, y > 0 ? i - g.w : -1, y < g.h - 1 ? i + g.w : -1]) {
      if (j < 0 || dist[j]! <= next) continue;
      dist[j] = next;
      queue[tail++] = j;
    }
  }
  // The rise never levels off: far inland there would be a plateau, and a river on a plateau
  // runs to the map's edge instead of to the sea.
  let far = 1;
  for (let i = 0; i < n; i++) if (dist[i]! !== Infinity && dist[i]! > far) far = dist[i]!;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = upland[i]!;
    out[i] = water[i]
      ? -0.1
      : 0.01 + 0.2 * (Math.min(far, dist[i]!) / far) ** 0.8 + 0.6 * u * u * (3 - 2 * u);
  }
  return out;
}

/**
 * Looks at a picture for Find paths: its ground on the cell grid, and the ink a trace follows.
 * `ink` is Find areas' own (lines and marks), which the marks of mountains are read from.
 */
export function lookAtGround(
  pic: LabPicture,
  ink: Ink,
  most?: number,
): {
  looked: Looked;
  ground: PictureGround;
} {
  const { w, h, L, A, B } = pic;
  const n = w * h;
  const grid = gridFor(w, h, most);
  const { faint, dark } = inkMasks(pic);
  // The ground's colour with the grain and the thin lines smoothed away.
  const LS = boxMean(L, w, h, 4);
  const AS = boxMean(A, w, h, 4);
  const BS = boxMean(B, w, h, 4);
  const groups = colourGroups(LS, AS, BS, faint);
  const { kinds, ref } = judgeGroups(groups);
  const water = new Uint8Array(n);
  const forest = new Uint8Array(n);
  const tint = new Float32Array(n);
  // Beside a drawn line the smoothed colour is the line's mixed with the ground's: often paler
  // and duller than the land, which must not read as a ridge of high ground along every coast.
  const byLine = morph(ink.line, w, h, 5, true);
  if (groups.length > 0) {
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bd = Infinity;
      for (let c = 0; c < groups.length; c++) {
        const g = groups[c]!;
        const d = (0.5 * (LS[i]! - g.l)) ** 2 + (AS[i]! - g.a) ** 2 + (BS[i]! - g.b) ** 2;
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      const kind = kinds[best];
      if (kind === "water") water[i] = 1;
      else if (kind === "forest") forest[i] = 1;
      else if (kind === "upland" && !byLine[i]) tint[i] = 1;
    }
  }

  // Line families: ink that is blue beside the picture's middle is a river; red or brown, a road.
  // When nearly all of the picture's long lines are of one family, and its letters and symbols
  // too, that is just the colour of its ink (a map drawn in sepia has no "roads" for coasts),
  // and the family is not used.
  const blue = new Uint8Array(n);
  const red = new Uint8Array(n);
  const tally = { lines: 0, blueLines: 0, redLines: 0, marks: 0, blueMarks: 0, redMarks: 0 };
  for (let i = 0; i < n; i++) {
    if (!faint[i]) continue;
    const own = { l: L[i]!, a: A[i]!, b: B[i]! };
    const isBlue = dark[i]! === 1 && isRiverInk(own, ref) && B[i]! < BS[i]! - 6;
    const isRed = isRoadInk(own, ref) && A[i]! > AS[i]! + 5;
    if (isBlue && !water[i]) blue[i] = 1;
    if (isRed) red[i] = 1;
    if (ink.line[i]) {
      tally.lines++;
      if (isBlue) tally.blueLines++;
      if (isRed) tally.redLines++;
    } else if (ink.mark[i]) {
      tally.marks++;
      if (isBlue) tally.blueMarks++;
      if (isRed) tally.redMarks++;
    }
  }
  const ordinary = (lines: number, marks: number) =>
    tally.lines > 0 &&
    lines / tally.lines >= 0.8 &&
    (tally.marks < 40 || marks / tally.marks >= 0.5);
  const useBlue = !ordinary(tally.blueLines, tally.blueMarks);
  const useRed = !ordinary(tally.redLines, tally.redMarks);
  // Grown a little, so the dashes of a road join up and a thin river is whole on the grid.
  const river = useBlue ? pool(morph(blue, w, h, 1, true), w, h, grid, 1) : new Uint8Array(grid.w * grid.h);
  const road = useRed ? pool(morph(red, w, h, 2, true), w, h, grid, 1) : new Uint8Array(grid.w * grid.h);

  const half = Math.max(1, Math.ceil((grid.cell * grid.cell) / 2));
  const waterG = pool(water, w, h, grid, Math.max(1, Math.ceil(grid.cell * grid.cell * 0.75)));
  dropSpecks(waterG, grid, Math.max(12, Math.round(grid.w * grid.h * 0.0004)));
  const forestG = pool(forest, w, h, grid, half);
  for (let i = 0; i < waterG.length; i++) {
    if (waterG[i]) {
      river[i] = 0;
      forestG[i] = 0;
    }
  }

  // High ground: where the picture is painted paler than the main land, and where small dark
  // marks that are not on a line crowd together (mountain symbols, hatching).
  const marks = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (ink.mark[i] && !forest[i] && !water[i] && !blue[i] && !red[i]) marks[i] = 1;
  }
  const r = Math.max(2, Math.round((0.03 * Math.max(w, h)) / grid.cell));
  const gw = grid.w;
  const gh = grid.h;
  const density = boxMean(boxMean(poolMean(marks, w, h, grid), gw, gh, r), gw, gh, r);
  const sorted = Float32Array.from(density).sort();
  const top = sorted[Math.floor(sorted.length * 0.97)] ?? 0;
  const tintSoft = boxMean(
    boxMean(poolMean(tint, w, h, grid), gw, gh, Math.max(1, r >> 1)),
    gw,
    gh,
    Math.max(1, r >> 1),
  );
  const upland = new Float32Array(gw * gh);
  for (let i = 0; i < upland.length; i++) {
    if (waterG[i]) continue;
    // Marks count once they are a real crowd: above a fifth of the densest part of the picture.
    const m = top > 0.02 ? Math.max(0, Math.min(1, (density[i]! / top - 0.2) / 0.6)) : 0;
    upland[i] = Math.max(m, tintSoft[i]!);
  }

  return {
    looked: { ink: faint, ref },
    ground: {
      grid,
      water: waterG,
      forest: forestG,
      upland,
      river,
      road,
      guess: guessHeights(grid, waterG, upland),
    },
  };
}
