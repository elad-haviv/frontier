/**
 * Suggest biomes' regions: the biome of each cell made into a few zones. Patches smaller than the
 * smallest zone join the neighbour they share most border with; each region left is outlined
 * (its holes filled: what lies inside is drawn on top of it) between the middles of its cells, so
 * that two neighbours, outlined from the same grid, meet on the same line. Cells already in a
 * biome zone on the map are left out: a suggestion never covers what is drawn.
 */
import { BIOME_KINDS, type BiomeKind } from "@frontier/schema";
import type { Px } from "../findAreas/contour.ts";
import { simplifyOpen } from "./lines.ts";
import { SEA } from "./climate.ts";

export interface Region {
  kind: BiomeKind;
  /** How many cells it covers. */
  cells: number;
  /** The first of its cells, which names it among runs with other settings. */
  first: number;
  /** Its outline, in cells: the middle of cell (x, y) is at (x + 0.5, y + 0.5). */
  ring: Px[];
  /** The cell deepest inside it, for its name. */
  deepest: number;
}

const near4 = (i: number, w: number, n: number): number[] => {
  const x = i % w;
  return [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w].filter((j) => j >= 0 && j < n);
};

/** The regions of a labelled grid, the largest first. */
export function regionsOf(
  labelIn: Uint8Array,
  w: number,
  h: number,
  blocked: Uint8Array | null,
  minCells: number,
): Region[] {
  const n = w * h;
  const L = Uint8Array.from(labelIn);
  const free = (i: number) => L[i] !== SEA && !(blocked && blocked[i]);
  const comp = new Int32Array(n);
  const stack = new Int32Array(n);
  let comps: { id: number; lab: number; cells: number[] }[] = [];
  const label = () => {
    comp.fill(-1);
    comps = [];
    for (let s = 0; s < n; s++) {
      if (comp[s]! >= 0 || !free(s)) continue;
      const id = comps.length;
      const lab = L[s]!;
      const cells: number[] = [];
      let sp = 0;
      stack[sp++] = s;
      comp[s] = id;
      while (sp) {
        const i = stack[--sp]!;
        cells.push(i);
        for (const j of near4(i, w, n)) {
          if (comp[j]! >= 0 || !free(j) || L[j] !== lab) continue;
          comp[j] = id;
          stack[sp++] = j;
        }
      }
      comps.push({ id, lab, cells });
    }
  };
  label();
  // Small patches join the neighbour they share most border with.
  for (let round = 0; round < 3; round++) {
    let changed = false;
    const small = comps
      .filter((c) => c.cells.length < minCells)
      .sort((a, b) => a.cells.length - b.cells.length);
    for (const c of small) {
      const tally = new Map<number, number>();
      for (const i of c.cells) {
        for (const j of near4(i, w, n)) {
          if (!free(j) || comp[j] === c.id) continue;
          tally.set(L[j]!, (tally.get(L[j]!) ?? 0) + 1);
        }
      }
      let best = -1;
      let most = 0;
      for (const [k, v] of tally) if (v > most) [best, most] = [k, v];
      if (best >= 0 && best !== c.lab) {
        for (const i of c.cells) L[i] = best;
        changed = true;
      }
    }
    if (!changed) break;
    label();
  }
  const kept = comps.filter((c) => c.cells.length >= Math.min(25, minCells));
  // How deep inside its region each cell lies, for the place of its name.
  const depth = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  for (const c of kept) {
    for (const i of c.cells) {
      const x = i % w;
      const y = (i / w) | 0;
      const edge =
        x === 0 ||
        y === 0 ||
        x === w - 1 ||
        y === h - 1 ||
        near4(i, w, n).some((j) => comp[j] !== c.id);
      if (edge) {
        depth[i] = 0;
        queue[tail++] = i;
      }
    }
  }
  while (head < tail) {
    const i = queue[head++]!;
    for (const j of near4(i, w, n)) {
      if (depth[j]! >= 0 || comp[j] !== comp[i]) continue;
      depth[j] = depth[i]! + 1;
      queue[tail++] = j;
    }
  }
  const out: Region[] = [];
  for (const c of kept) {
    const ring = outlineOf(comp, w, h, c.id, c.cells);
    if (ring.length < 3) continue;
    let deepest = c.cells[0]!;
    for (const i of c.cells) if (depth[i]! > depth[deepest]!) deepest = i;
    out.push({
      kind: BIOME_KINDS[c.lab]!,
      cells: c.cells.length,
      first: Math.min(...c.cells),
      ring,
      deepest,
    });
  }
  return out.sort((a, b) => b.cells - a.cells);
}

/**
 * The outer ring of one region, by marching squares between the middles of cells (so the line
 * between two regions is the same for both), its holes left out; smoothed a little and thinned.
 */
function outlineOf(comp: Int32Array, w: number, h: number, id: number, cells: number[]): Px[] {
  let x0 = w;
  let y0 = h;
  let x1 = 0;
  let y1 = 0;
  for (const i of cells) {
    const x = i % w;
    const y = (i / w) | 0;
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  x0 -= 1;
  y0 -= 1;
  const ins = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < w && y < h && comp[y * w + x] === id;
  // Points in half cells, shifted so none is negative: (2x + 2, 2y + 1) is between cells x and x + 1.
  const SH = 4;
  const K = (px: number, py: number) => (py + SH) * (2 * w + 16) + px + SH;
  const unK = (k: number): Px => [(k % (2 * w + 16)) - SH, Math.floor(k / (2 * w + 16)) - SH];
  const adj = new Map<number, number[]>();
  const link = (a: number, b: number) => {
    (adj.get(a) ?? adj.set(a, []).get(a)!).push(b);
    (adj.get(b) ?? adj.set(b, []).get(b)!).push(a);
  };
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const a = ins(x, y);
      const b = ins(x + 1, y);
      const c = ins(x + 1, y + 1);
      const d = ins(x, y + 1);
      if (a === b && b === c && c === d) continue;
      const T = K(2 * x + 2, 2 * y + 1);
      const R = K(2 * x + 3, 2 * y + 2);
      const B = K(2 * x + 2, 2 * y + 3);
      const Lf = K(2 * x + 1, 2 * y + 2);
      const e: number[] = [];
      if (a !== b) e.push(T);
      if (b !== c) e.push(R);
      if (c !== d) e.push(B);
      if (d !== a) e.push(Lf);
      if (e.length === 2) link(e[0]!, e[1]!);
      else if (e.length === 4) {
        if (a) {
          link(T, Lf);
          link(R, B);
        } else {
          link(T, R);
          link(B, Lf);
        }
      }
    }
  }
  const seen = new Set<number>();
  let best: Px[] | null = null;
  let bestArea = 0;
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const ring: number[] = [];
    let prev = -1;
    let cur: number | undefined = start;
    for (let guard = 0; guard < 4 * w * h + 8 && cur !== undefined; guard++) {
      seen.add(cur);
      ring.push(cur);
      const nb: number[] = adj.get(cur)!;
      const next: number | undefined = nb[0] !== prev ? nb[0] : nb[1];
      prev = cur;
      cur = next;
      if (cur === start) break;
    }
    const pts = ring.map(unK);
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!;
      const q = pts[(i + 1) % pts.length]!;
      area += p[0] * q[1] - q[0] * p[1];
    }
    if (Math.abs(area) > bestArea) {
      bestArea = Math.abs(area);
      best = pts;
    }
  }
  if (!best) return [];
  // Half cells to cells; smoothed twice, then thinned.
  let p: Px[] = best.map(([x, y]) => [x / 2, y / 2]);
  for (let k = 0; k < 2; k++) {
    const m = p.length;
    p = p.map((q, i) => {
      const a = p[(i - 1 + m) % m]!;
      const c = p[(i + 1) % m]!;
      return [(a[0] + 2 * q[0] + c[0]) / 4, (a[1] + 2 * q[1] + c[1]) / 4];
    });
  }
  return simplifyClosed(p, 0.55);
}

function simplifyClosed(p: Px[], eps: number): Px[] {
  if (p.length < 8) return p;
  let far = 0;
  let most = 0;
  for (let i = 1; i < p.length; i++) {
    const d = Math.hypot(p[i]![0] - p[0]![0], p[i]![1] - p[0]![1]);
    if (d > most) {
      most = d;
      far = i;
    }
  }
  const a = simplifyOpen(p.slice(0, far + 1), eps);
  const b = simplifyOpen([...p.slice(far), p[0]!], eps);
  return [...a, ...b.slice(1, -1)];
}
