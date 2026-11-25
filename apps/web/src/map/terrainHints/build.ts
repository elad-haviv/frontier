/**
 * The builder: a height map that agrees with the hints, with natural detail between them.
 *
 * 1. Targets on a coarse grid: the sea pinned below 0 and deeper away from the shore, the coast
 *    pinned at 0, ridge crests and peaks pinned at their heights with a soft pull round them,
 *    zones as soft targets, and a faint pull that makes land rise away from the sea.
 * 2. A smooth fill between them (Laplace with soft targets, Gauss–Seidel over three grid sizes).
 * 3. Rivers and valleys: the heights read along each from source to mouth, made never to rise,
 *    lowered into a valley and pinned, and the fill solved again, so the land falls to them.
 * 4. Detail on the working grid: rolling fractal noise, ridged noise where the hints say
 *    mountains, little on plains and marsh, none at the coast.
 * 5. Erosion: stream power on Find paths' priority-flood and D8 flow, then slopes settle.
 * 6. Peaks lifted or lowered to their heights; 7. lakes made basins with flat water;
 * 8. rivers carved so they only ever fall to the mouth, with a valley either side;
 * 9. the checks: rivers drain, the coast, peaks, lakes.
 *
 * Deterministic for a seed. No DOM: it runs in the worker and under the tests.
 */
import type { Px } from "../findAreas/contour.ts";
import { boxMean } from "../findAreas/ink.ts";
import { flatGrid } from "../findPaths/grid.ts";
import { flow } from "../findPaths/hydro.ts";
import { resample } from "../findPaths/lines.ts";
import { coastMatch } from "../terrain/fit.ts";
import { cellsAlong, cellsNear, fillRing, pieces, resize, resizeMask, stepsFrom } from "./masks.ts";
import { Noise } from "./noise.ts";
import type { BuildSettings, Built, PxHint } from "./types.ts";

/** What the builder needs of the picture: its size and its water, on a grid of its own. */
export interface BuildPlace {
  /** The working copy's size: every hint's point is in its pixels. */
  w: number;
  h: number;
  /** The picture's water on a grid of `ww` × `wh` cells over the same picture; null for none. */
  water: Uint8Array | null;
  ww: number;
  wh: number;
}

/** The working grid's size for each detail: draft, normal, fine. */
const CELLS = [0, 80_000, 160_000, 320_000];

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** The heights a hint holds when it gives none. */
export const DEFAULT_HEIGHT: Partial<Record<PxHint["kind"], number>> = {
  peak: 0.85,
  ridge: 0.7,
  hollow: 0.06,
  lowland: 0.08,
  plain: 0.16,
  highland: 0.45,
  cliff: 0.12,
  marsh: 0.01,
};
const heightOf = (hint: PxHint) => hint.h ?? DEFAULT_HEIGHT[hint.kind] ?? 0.3;
const strengthOf = (hint: PxHint) => hint.strength ?? 0.7;
/** A river or valley's line from its source to its mouth. */
const flowLine = (hint: PxHint): Px[] =>
  hint.flip ? [...(hint.points ?? [])].reverse() : (hint.points ?? []);

/** Gauss–Seidel with over-relaxation: pinned cells hold, the rest lean to their targets. */
function relax(
  f: Float32Array,
  w: number,
  h: number,
  pin: Uint8Array,
  target: Float32Array,
  weight: Float32Array,
  iterations: number,
) {
  const omega = 1.75;
  for (let it = 0; it < iterations; it++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (pin[i]) continue;
        let s = 0;
        let n = 0;
        if (x > 0) {
          s += f[i - 1]!;
          n++;
        }
        if (x < w - 1) {
          s += f[i + 1]!;
          n++;
        }
        if (y > 0) {
          s += f[i - w]!;
          n++;
        }
        if (y < h - 1) {
          s += f[i + w]!;
          n++;
        }
        const v = (s + weight[i]! * target[i]!) / (n + weight[i]!);
        f[i] = f[i]! + omega * (v - f[i]!);
      }
    }
  }
}

interface Level {
  w: number;
  h: number;
  pin: Uint8Array;
  pinV: Float32Array;
  target: Float32Array;
  weight: Float32Array;
}

/** The smoothest field that holds the pins and leans to the targets, solved coarse to fine. */
function solve(top: Level, start: Float32Array | null): Float32Array {
  const levels = [top];
  for (let l = 0; l < 2; l++) {
    const a = levels[l]!;
    const w = Math.max(1, Math.ceil(a.w / 2));
    const h = Math.max(1, Math.ceil(a.h / 2));
    const b: Level = {
      w,
      h,
      pin: new Uint8Array(w * h),
      pinV: new Float32Array(w * h),
      target: new Float32Array(w * h),
      weight: new Float32Array(w * h),
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let pins = 0;
        let pv = 0;
        let tw = 0;
        let ww = 0;
        let cells = 0;
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const xx = x * 2 + dx;
            const yy = y * 2 + dy;
            if (xx >= a.w || yy >= a.h) continue;
            const i = yy * a.w + xx;
            cells++;
            if (a.pin[i]) {
              pins++;
              pv += a.pinV[i]!;
            }
            tw += a.target[i]! * a.weight[i]!;
            ww += a.weight[i]!;
          }
        }
        const j = y * w + x;
        if (pins) {
          b.pin[j] = 1;
          b.pinV[j] = pv / pins;
        }
        b.weight[j] = ww / cells;
        b.target[j] = ww ? tw / ww : 0;
      }
    }
    levels.push(b);
  }
  let f: Float32Array | null = null;
  let fw = 0;
  for (let l = levels.length - 1; l >= 0; l--) {
    const lv = levels[l]!;
    const cur = new Float32Array(lv.w * lv.h);
    if (!f) for (let i = 0; i < cur.length; i++) cur[i] = lv.target[i]!;
    else {
      for (let y = 0; y < lv.h; y++) {
        for (let x = 0; x < lv.w; x++) {
          cur[y * lv.w + x] =
            f[Math.min(((f.length / fw) | 0) - 1, y >> 1) * fw + Math.min(fw - 1, x >> 1)]!;
        }
      }
    }
    if (l === 0 && start) cur.set(start);
    for (let i = 0; i < cur.length; i++) if (lv.pin[i]) cur[i] = lv.pinV[i]!;
    relax(
      cur,
      lv.w,
      lv.h,
      lv.pin,
      lv.target,
      lv.weight,
      l === 2 ? 260 : l === 1 ? 120 : start ? 50 : 80,
    );
    f = cur;
    fw = lv.w;
  }
  return f!;
}

/** The working grid of a picture for a detail. */
export function workingGrid(
  w: number,
  h: number,
  detail: number,
  most = CELLS[detail]!,
): { w: number; h: number; cell: number } {
  // Never finer than the picture itself.
  const cell = Math.max(1, Math.sqrt((w * h) / most));
  return { w: Math.max(4, Math.round(w / cell)), h: Math.max(4, Math.round(h / cell)), cell };
}

/** Builds heights from the hints in use. `hints` are only those accepted. */
export function buildHeights(
  place: BuildPlace,
  hints: readonly PxHint[],
  s: BuildSettings,
  /** The working grid's cells, when not the detail's own (the tests build small). */
  most?: number,
): Built {
  const t0 = performance.now();
  const of = (k: PxHint["kind"]) => hints.filter((x) => x.kind === k);
  const grid = workingGrid(place.w, place.h, s.detail, most);
  const GW = grid.w;
  const GH = grid.h;
  const GN = GW * GH;
  // Cells are square on the picture only roughly; this is the pixel size of a cell's side.
  const gc = place.w / GW;
  const BW = Math.ceil(GW / 2);
  const BH = Math.ceil(GH / 2);
  const BN = BW * BH;
  const bc = gc * 2;
  /** Distances in the design were tuned on a picture 960 pixels across. */
  const S = Math.max(place.w, place.h) / 960;
  const noise = new Noise(s.seed);

  // ---- The water: the picture's sea (joined to the edge) when the sea is in use; lakes as drawn.
  const seaG = new Uint8Array(GN);
  const pictureSea = new Uint8Array(GN);
  if (place.water) {
    const water = resizeMask(place.water, place.ww, place.wh, GW, GH);
    for (const p of pieces(water, GW, GH).list) {
      if (!p.edge) continue;
      for (const i of p.cells) pictureSea[i] = 1;
    }
  }
  for (const sea of of("sea")) {
    if (sea.points && sea.points.length >= 3) fillRing(sea.points, GW, GH, gc, seaG);
    else seaG.set(pictureSea.map((v, i) => v | seaG[i]!));
  }
  const haveSea = seaG.some((v) => v === 1);
  const coastOn = of("coast").length > 0 && haveSea;
  const seaB = resizeMask(seaG, GW, GH, BW, BH);
  for (let i = 0; i < BN; i++) seaB[i] = seaB[i]! ? 1 : 0;

  // ---- 1. Coarse targets.
  const pin = new Uint8Array(BN);
  const pinV = new Float32Array(BN);
  const target = new Float32Array(BN);
  const weight = new Float32Array(BN);
  const landB = seaB.map((v) => 1 - v);
  const fromLand = stepsFrom(landB, BW, BH, 60);
  const fromSea = stepsFrom(seaB, BW, BH, 400);
  // Without a sea, land rises away from the map's edge.
  const fromEdge = (() => {
    const edge = new Uint8Array(BN);
    for (let i = 0; i < BN; i++) {
      const x = i % BW;
      const y = (i / BW) | 0;
      if (x === 0 || y === 0 || x === BW - 1 || y === BH - 1) edge[i] = 1;
    }
    return stepsFrom(edge, BW, BH, 400);
  })();
  const rise = 45 * (BW / 240);
  for (let i = 0; i < BN; i++) {
    if (seaB[i]) {
      pin[i] = 1;
      pinV[i] = -(0.02 + 0.13 * Math.min(1, fromLand[i]! / (22 * (BW / 240))));
      continue;
    }
    const d = haveSea ? fromSea[i]! : fromEdge[i]!;
    target[i] = 0.03 + 0.11 * Math.min(1, d / rise) ** 0.7;
    weight[i] = 0.004;
    if (coastOn && fromSea[i]! <= 1) {
      pin[i] = 1;
      pinV[i] = 0.003;
    }
  }
  // How mountainous and how flat each cell is, for the detail.
  const mountain = new Float32Array(BN);
  const flat = new Float32Array(BN);
  const zone = new Uint8Array(BN);
  for (const z of of("highland")) {
    if (!z.points) continue;
    zone.fill(0);
    fillRing(z.points, BW, BH, bc, zone);
    const lo = heightOf(z);
    const hi = z.h2 ?? Math.max(lo, 0.75);
    for (let i = 0; i < BN; i++) {
      if (!zone[i] || seaB[i]) continue;
      target[i] = lo + (hi - lo) * 0.15;
      weight[i] = 0.02 * (0.5 + strengthOf(z));
      mountain[i] = Math.max(mountain[i]!, 0.75);
    }
  }
  for (const k of ["lowland", "plain", "marsh"] as const) {
    for (const z of of(k)) {
      if (!z.points) continue;
      zone.fill(0);
      fillRing(z.points, BW, BH, bc, zone);
      for (let i = 0; i < BN; i++) {
        if (!zone[i] || seaB[i]) continue;
        target[i] = k === "marsh" ? 0.008 : heightOf(z);
        weight[i] = (k === "marsh" ? 1.5 : 0.25) * (0.4 + strengthOf(z));
        flat[i] = Math.max(flat[i]!, k === "lowland" ? 0.5 : 1);
        if (k !== "lowland") mountain[i] = 0;
      }
    }
  }
  for (const r of of("ridge")) {
    if (!r.points || r.points.length < 2) continue;
    const top = heightOf(r);
    for (const c of cellsNear(r.points, BW, BH, bc, 44 * S)) {
      if (seaB[c.i]) continue;
      const taper = 0.72 + 0.28 * Math.sin(Math.PI * clamp01(c.t));
      mountain[c.i] = Math.max(mountain[c.i]!, Math.exp(-((c.d / (30 * S)) ** 2)));
      if (c.d < Math.max(3.5 * S, bc * 0.75)) {
        const prior = pin[c.i] ? pinV[c.i]! : 0;
        pin[c.i] = 1;
        pinV[c.i] = Math.max(prior, top * taper);
      } else if (c.d < 20 * S) {
        const w2 = 0.3 * strengthOf(r) * (1 - c.d / (20 * S));
        if (w2 > weight[c.i]!) {
          weight[c.i] = w2;
          target[c.i] = top * taper * (1 - (0.4 * c.d) / (20 * S));
        }
      }
    }
  }
  for (const p of of("peak")) {
    if (!p.at) continue;
    const top = heightOf(p);
    for (const c of cellsNear([p.at], BW, BH, bc, 36 * S)) {
      if (seaB[c.i]) continue;
      mountain[c.i] = Math.max(mountain[c.i]!, Math.exp(-((c.d / (26 * S)) ** 2)));
      if (c.d < Math.max(5 * S, bc * 0.75)) {
        pin[c.i] = 1;
        pinV[c.i] = top;
      } else if (c.d < 24 * S) {
        const w2 = 0.5 * strengthOf(p) * (1 - c.d / (24 * S));
        if (w2 > weight[c.i]!) {
          weight[c.i] = w2;
          target[c.i] = top * (1 - (0.35 * c.d) / (24 * S));
        }
      }
    }
  }
  for (const p of of("hollow")) {
    if (!p.at) continue;
    for (const c of cellsNear([p.at], BW, BH, bc, 24 * S)) {
      if (seaB[c.i]) continue;
      if (c.d < Math.max(5 * S, bc * 0.75)) {
        pin[c.i] = 1;
        pinV[c.i] = heightOf(p);
      }
      mountain[c.i] = mountain[c.i]! * 0.5;
      flat[c.i] = Math.max(flat[c.i]!, 0.6);
    }
  }

  // ---- 2. The smooth fill.
  const level: Level = { w: BW, h: BH, pin, pinV, target, weight };
  let base = solve(level, null);

  // ---- 3. Rivers and valleys fall towards their mouths; cliffs are steps.
  const lakeB = new Uint8Array(BN);
  for (const z of of("lake")) if (z.points) fillRing(z.points, BW, BH, bc, lakeB);
  const falling = [...of("river"), ...of("valley")];
  const cliffs = of("cliff");
  if (falling.length || cliffs.length) {
    for (const r of falling) {
      const line = flowLine(r);
      if (line.length < 2) continue;
      const cells = cellsAlong(resample(line, bc / 2), BW, BH, bc);
      let low = Infinity;
      const n = cells.length;
      cells.forEach((c, k) => {
        if (seaB[c]) return;
        low = Math.min(low, base[c]!);
        const t = k / Math.max(1, n - 1);
        const depth = r.kind === "valley" ? 0.55 + 0.2 * strengthOf(r) : 0.62;
        let v = low * depth;
        if (r.kind === "river" && t > 0.97 && !lakeB[c]) v = Math.min(v, 0.004);
        if (!lakeB[c]) {
          pin[c] = 1;
          pinV[c] = Math.max(0.002, v);
        }
      });
    }
    for (const cl of cliffs) {
      if (!cl.points || cl.points.length < 2) continue;
      const step = heightOf(cl);
      for (const q of cellsNear(cl.points, BW, BH, bc, 14 * S)) {
        if (seaB[q.i] || q.d < 5 * S * 0.5) continue;
        // High on the left as drawn: the left of a line drawn on screen is side -1 (y is down).
        const high = cl.flip ? q.side > 0 : q.side < 0;
        pin[q.i] = 1;
        pinV[q.i] = Math.max(
          0.003,
          base[q.i]! + (high ? 0.5 : -0.5) * step * (0.5 + strengthOf(cl)),
        );
      }
    }
    base = solve(level, base);
  }

  // ---- 4. Detail on the working grid.
  const E = resize(base, BW, BH, GW, GH);
  const M = boxMean(resize(mountain, BW, BH, GW, GH), GW, GH, 3);
  const FL = boxMean(resize(flat, BW, BH, GW, GH), GW, GH, 4);
  const fromCoast = stepsFrom(seaG, GW, GH, 40);
  const roadNear = new Float32Array(GN);
  for (const r of of("road")) {
    if (!r.points) continue;
    for (const c of cellsNear(r.points, GW, GH, gc, 10 * S)) {
      roadNear[c.i] = Math.max(roadNear[c.i]!, 1 - c.d / (10 * S));
    }
  }
  const riverCells = new Uint8Array(GN);
  if (s.carve) {
    for (const r of of("river")) {
      for (const c of cellsAlong(resample(flowLine(r), gc / 2), GW, GH, gc)) riverCells[c] = 1;
    }
  }
  const fromRiver = stepsFrom(riverCells, GW, GH, 14);
  const octaves = 3 + s.detail;
  const k1 = 1 / (95 * S);
  const k2 = 1 / (28 * S);
  const k3 = 1 / (52 * S);
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      const i = y * GW + x;
      const px = x * gc;
      const py = y * gc;
      if (seaG[i]) {
        E[i] = E[i]! + 0.012 * noise.fbm(px / (60 * S), py / (60 * S), 3);
        continue;
      }
      const onLand = clamp01((fromCoast[i]! - 1) / 9);
      const fl = FL[i]!;
      const m = M[i]! * (1 - 0.5 * roadNear[i]!);
      const height = Math.max(0, E[i]!);
      const n1 = noise.fbm(px * k1 + 11, py * k1 + 23, octaves);
      const n2 = noise.fbm(px * k2 + 51, py * k2 + 63, Math.max(2, octaves - 1));
      let add = s.rough * (0.075 * n1 + 0.022 * n2) * (0.35 + height * 1.4) * (1 - 0.9 * fl);
      const ridged = noise.ridged(px * k3 + 88, py * k3 + 36, octaves, s.sharp);
      add += m * (0.06 + 0.24 * s.sharp) * (ridged - 0.32) * (0.5 + s.rough * 0.7);
      E[i] = E[i]! + add * onLand * (0.2 + 0.8 * clamp01(fromRiver[i]! / 12));
    }
  }

  // ---- 5. Erosion: water wears valleys by what drains through them, then slopes settle.
  const g = flatGrid(GW, GH);
  const passes = Math.round(s.erosion * 4);
  for (let it = 0; it < passes; it++) {
    const f = flow(g, E, seaG);
    const K = 0.0016 + 0.0012 * s.erosion;
    for (let i = 0; i < GN; i++) {
      if (seaG[i]) continue;
      const to = f.dir[i]!;
      if (to < 0) continue;
      const slope = (E[i]! - E[to]!) / g.stepLength(i, to);
      if (slope <= 0) continue;
      const cut = Math.min(slope * 0.6, K * Math.sqrt(f.acc[i]!) * slope * 6 * (1 - 0.7 * FL[i]!));
      E[i] = E[i]! - cut;
    }
    const next = E.slice();
    const talus = 0.03 - 0.012 * s.erosion;
    for (let y = 1; y < GH - 1; y++) {
      for (let x = 1; x < GW - 1; x++) {
        const i = y * GW + x;
        if (seaG[i]) continue;
        for (const j of [i + 1, i + GW]) {
          if (seaG[j]) continue;
          const d = E[i]! - E[j]!;
          if (Math.abs(d) > talus) {
            const mv = (Math.abs(d) - talus) * 0.25 * Math.sign(d);
            next[i] = next[i]! - mv;
            next[j] = next[j]! + mv;
          }
        }
      }
    }
    E.set(next);
  }

  // ---- 6. Peaks keep the height asked of them, as firmly as they hold.
  const cellOf = (p: Px) => {
    const x = Math.max(0, Math.min(GW - 1, Math.floor((p[0] + 0.5) / gc)));
    const y = Math.max(0, Math.min(GH - 1, Math.floor((p[1] + 0.5) / gc)));
    return y * GW + x;
  };
  const highestNear = (c0: number) => {
    const cx = c0 % GW;
    const cy = (c0 / GW) | 0;
    let most = -Infinity;
    for (let dy = -8; dy <= 8; dy++) {
      for (let dx = -8; dx <= 8; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && y >= 0 && x < GW && y < GH) most = Math.max(most, E[y * GW + x]!);
      }
    }
    return most;
  };
  for (const pk of of("peak")) {
    if (!pk.at) continue;
    const c0 = cellOf(pk.at);
    const cx = c0 % GW;
    const cy = (c0 / GW) | 0;
    for (let it = 0; it < 3; it++) {
      const delta = (heightOf(pk) - highestNear(c0)) * (it ? 1 : 0.4 + 0.6 * strengthOf(pk));
      if (Math.abs(delta) < 0.008) break;
      for (let dy = -24; dy <= 24; dy++) {
        for (let dx = -24; dx <= 24; dx++) {
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || y < 0 || x >= GW || y >= GH) continue;
          const v = y * GW + x;
          if (!seaG[v]) E[v] = E[v]! + delta * Math.exp(-(dx * dx + dy * dy) / 90);
        }
      }
    }
  }

  // ---- 7. Lakes: a basin whose water lies flat at the height of its lowest rim.
  const lakeG = new Uint8Array(GN);
  const lakeLevel = new Float32Array(GN);
  const lakeMasks: Uint8Array[] = [];
  if (s.lakes) {
    for (const z of of("lake")) {
      if (!z.points) continue;
      const m = fillRing(z.points, GW, GH, gc);
      let rim = Infinity;
      let any = false;
      for (let i = 0; i < GN; i++) {
        if (!m[i]) continue;
        any = true;
        const x = i % GW;
        for (const j of [x > 0 ? i - 1 : -1, x < GW - 1 ? i + 1 : -1, i - GW, i + GW]) {
          if (j >= 0 && j < GN && !m[j] && !seaG[j]) rim = Math.min(rim, E[j]!);
        }
      }
      if (!any) continue;
      lakeMasks.push(m);
      const lv = Math.max(0.004, rim === Infinity ? 0.01 : rim);
      const inside = stepsFrom(
        m.map((v) => 1 - v),
        GW,
        GH,
        12,
      );
      for (let i = 0; i < GN; i++) {
        if (!m[i]) continue;
        lakeG[i] = 1;
        lakeLevel[i] = lv;
        E[i] = lv - 0.002 - 0.014 * clamp01(inside[i]! / 5);
      }
    }
  }

  // ---- 8. Rivers carved: longest first; a tributary stops where it meets one already carved.
  const rivers = of("river")
    .map((r) => ({ r, cells: cellsAlong(resample(flowLine(r), gc / 2), GW, GH, gc) }))
    .filter((r) => r.cells.length >= 3)
    .sort((a, b) => b.cells.length - a.cells.length);
  if (s.carve) {
    const carved = new Uint8Array(GN);
    const side = new Float32Array(GN);
    for (const rv of rivers) {
      let surface = Infinity;
      let prev = Infinity;
      const n = rv.cells.length;
      const own: [number, number][] = [];
      let joinAt = -1;
      for (let k = 3; k < n; k++) {
        if (carved[rv.cells[k]!]) {
          joinAt = k;
          break;
        }
      }
      const joinHeight = joinAt >= 0 ? E[rv.cells[joinAt]!]! : -1;
      for (let k = 0; k < n; k++) {
        const c = rv.cells[k]!;
        if (seaG[c]) break;
        if (carved[c] && k > 2) break;
        if (lakeG[c]) {
          surface = Math.min(surface, lakeLevel[c]!);
          prev = Math.min(prev, lakeLevel[c]!);
          continue;
        }
        const t = k / Math.max(1, n - 1);
        surface = Math.min(surface, E[c]!);
        let v = Math.min(surface - (0.004 + 0.016 * t) * (0.6 + 0.8 * s.erosion), prev - 1e-5);
        v = Math.max(v, Math.min(prev - 1e-6, 0.0006));
        if (joinAt >= 0) v = Math.max(v, Math.min(prev - 1e-6, joinHeight + 1e-5 * (joinAt - k)));
        own.push([c, v]);
        prev = v;
      }
      own.forEach(([c, v], k) => {
        E[c] = v;
        carved[c] = 1;
        const a = own[Math.max(0, k - 3)]![1];
        const z = own[Math.min(own.length - 1, k + 3)]![1];
        const span = Math.max(1, Math.min(own.length - 1, k + 3) - Math.max(0, k - 3));
        side[c] = Math.max(0.002, (3 * (a - z)) / span);
      });
    }
    // A valley either side, wider with more erosion: its walls fall to the river faster than
    // the river falls, so water beside a river runs into it rather than alongside it.
    const queue = new Int32Array(GN);
    const dist = new Float32Array(GN).fill(99);
    const from = new Int32Array(GN).fill(-1);
    let head = 0;
    let tail = 0;
    for (let i = 0; i < GN; i++) {
      if (carved[i]) {
        dist[i] = 0;
        from[i] = i;
        queue[tail++] = i;
      }
    }
    const R = 5 + 4 * s.erosion;
    while (head < tail) {
      const i = queue[head++]!;
      const d = dist[i]! + 1;
      if (d > R) continue;
      const x = i % GW;
      for (const j of [x > 0 ? i - 1 : -1, x < GW - 1 ? i + 1 : -1, i - GW, i + GW]) {
        if (j < 0 || j >= GN || seaG[j] || lakeG[j] || dist[j]! <= d) continue;
        dist[j] = d;
        from[j] = from[i]!;
        queue[tail++] = j;
      }
    }
    for (let i = 0; i < GN; i++) {
      if (!(dist[i]! > 0 && dist[i]! <= R && from[i]! >= 0)) continue;
      const v = E[from[i]!]!;
      const t = (dist[i]! / R) ** 1.4;
      const wall = v + Math.min(0.06, side[from[i]!]! * dist[i]!);
      E[i] = E[i]! < wall ? wall : Math.min(E[i]!, wall + t * (E[i]! - wall));
    }
  }
  for (let i = 0; i < GN; i++) {
    if (!seaG[i] && !lakeG[i] && E[i]! < 0.0005) E[i] = 0.0005;
    if (seaG[i] && E[i]! > -0.004) E[i] = -0.004;
  }

  // ---- 9. The checks.
  const water = seaG.map((v, i) => v | lakeG[i]!);
  const f = flow(g, E, water);
  const allRivers = new Uint8Array(GN);
  for (const rv of rivers) for (const c of rv.cells) allRivers[c] = 1;
  const nearRiver = stepsFrom(allRivers, GW, GH, 6);
  let drain = 0;
  const badRivers: string[] = [];
  for (const rv of rivers) {
    let c = rv.cells[Math.floor(rv.cells.length * 0.05)]!;
    let steps = 0;
    let on = 0;
    while (c >= 0 && !water[c] && steps < GN) {
      if (nearRiver[c]! <= 4) on++;
      c = f.dir[c]!;
      steps++;
    }
    if ((c < 0 || water[c]) && on >= steps * 0.85) drain++;
    else badRivers.push(rv.r.id);
  }
  const builtSea = new Uint8Array(GN);
  for (let i = 0; i < GN; i++) builtSea[i] = E[i]! < 0 ? 1 : 0;
  const coast = haveSea
    ? coastMatch(builtSea, pictureSea.some((v) => v) ? pictureSea : seaG, g)
    : null;
  let peaks = 0;
  const askedPeaks = of("peak").filter((p) => p.at);
  for (const p of askedPeaks)
    if (Math.abs(highestNear(cellOf(p.at!)) - heightOf(p)) < 0.12) peaks++;
  let lakesHeld = 0;
  for (const m of lakeMasks) {
    let deepest = Infinity;
    let rim = Infinity;
    for (let i = 0; i < GN; i++) {
      if (m[i]) {
        deepest = Math.min(deepest, E[i]!);
        const x = i % GW;
        for (const j of [x > 0 ? i - 1 : -1, x < GW - 1 ? i + 1 : -1, i - GW, i + GW]) {
          if (j >= 0 && j < GN && !m[j] && !seaG[j]) rim = Math.min(rim, E[j]!);
        }
      }
    }
    if (deepest < rim) lakesHeld++;
  }
  return {
    w: GW,
    h: GH,
    cell: gc,
    heights: E,
    sea: builtSea,
    checks: {
      drain,
      rivers: rivers.length,
      badRivers,
      coast,
      peaks,
      peaksAsked: askedPeaks.length,
      lakes: lakeMasks.length,
      lakesHeld,
      ms: performance.now() - t0,
    },
  };
}

/**
 * The built heights at the size of the saved image, with one more octave of fine detail on the
 * land away from the coast, as greys 0 to 65535 (white is high). `seaLevel` is the grey of 0.
 */
export function fullSize(
  built: Built,
  outW: number,
  outH: number,
  s: BuildSettings,
): { grey: Uint16Array; seaLevel: number; low: number; high: number } {
  const big = resize(built.heights, built.w, built.h, outW, outH);
  const sea = resizeMask(built.sea, built.w, built.h, outW, outH);
  const noise = new Noise(s.seed + 7);
  const k = 1 / Math.max(2, (outW / built.w) * 3);
  let low = Infinity;
  let high = -Infinity;
  for (let i = 0; i < big.length; i++) {
    const v = big[i]!;
    if (!sea[i] && v > 0.002 && s.detail === 3) {
      const x = i % outW;
      const y = (i / outW) | 0;
      big[i] = v + 0.006 * s.rough * Math.min(1, v * 8) * noise.fbm(x * k + 5, y * k + 9, 2);
    }
    // A few greys between the lowest land and the shallowest sea, so an 8-bit reading of the
    // image keeps the coast where it is.
    big[i] = sea[i] ? Math.min(big[i]!, -0.008) : Math.max(big[i]!, 0.008);
    low = Math.min(low, big[i]!);
    high = Math.max(high, big[i]!);
  }
  const span = high - low || 1;
  const grey = new Uint16Array(big.length);
  for (let i = 0; i < big.length; i++) grey[i] = Math.round(((big[i]! - low) / span) * 65535);
  return { grey, seaLevel: (0 - low) / span, low, high };
}
