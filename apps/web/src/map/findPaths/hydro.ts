/**
 * Where water runs. The surface is flooded from the sea and the map's edge, lowest cell first
 * (priority-flood, Barnes et al.): a cell lower than the one it was reached from lies in a hollow
 * and is raised to just above it, which fills every hollow to its lowest rim and gives the flat a
 * slope towards the way out. No river then stops in a hollow. Each land cell drains to its
 * steepest lower neighbour (D8), and walking the flood's order backwards adds each cell's water
 * to the cell it drains to, which gives the land upstream of every cell.
 */
import type { WaterWeights } from "./biomes.ts";
import type { Grid } from "./grid.ts";
import { Heap } from "./heap.ts";

export interface Flow {
  /** The surface with its hollows filled. */
  filled: Float32Array;
  /** The cell each land cell drains to; -1 for the sea and for a cell that runs off the map. */
  dir: Int32Array;
  /** How many land cells drain through each cell, itself counted. */
  acc: Float32Array;
  /** The cells in the order the flood reached them: lowest first. */
  order: Int32Array;
  /** Land cells that lay in a hollow and were raised. */
  raised: Uint8Array;
  /** The share of the land that was raised: high on a rough or flat height map. */
  raisedShare: number;
}

/** How much higher a cell reached in a hollow is than the one before it. */
const RISE = 1e-5;
/** The sea in the flood: below any land. */
const SEA = -1e6;

export function flow(
  g: Grid,
  heights: Float32Array,
  sea: Uint8Array,
  /** What biomes do to the water: what each cell gives and takes (see biomes.ts). */
  water?: WaterWeights,
): Flow {
  const n = g.w * g.h;
  const filled = new Float32Array(n);
  const dir = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const order = new Int32Array(n);
  const raised = new Uint8Array(n);
  const near = new Int32Array(8);
  const heap = new Heap(4096);
  let count = 0;
  let land = 0;
  let pits = 0;
  for (let i = 0; i < n; i++) {
    const k = g.neighbours(i, near);
    if (sea[i]) {
      filled[i] = SEA;
      done[i] = 1;
      // Only the shore need start the flood: open sea reaches nothing.
      for (let j = 0; j < k; j++) {
        if (!sea[near[j]!]) {
          heap.push(SEA, i);
          break;
        }
      }
    } else {
      land++;
      if (k < 8) {
        // The map's edge: water runs off it.
        filled[i] = heights[i]!;
        done[i] = 1;
        heap.push(filled[i]!, i);
      }
    }
  }
  while (heap.size) {
    const u = heap.pop();
    order[count++] = u;
    const k = g.neighbours(u, near);
    const floor = filled[u]! + RISE;
    for (let j = 0; j < k; j++) {
      const v = near[j]!;
      if (done[v]) continue;
      done[v] = 1;
      if (heights[v]! < floor) {
        filled[v] = floor;
        raised[v] = 1;
        pits++;
      } else filled[v] = heights[v]!;
      heap.push(filled[v]!, v);
    }
  }
  for (let q = 0; q < count; q++) {
    const u = order[q]!;
    if (sea[u]) continue;
    const k = g.neighbours(u, near);
    let best = -1;
    let steepest = 0;
    for (let j = 0; j < k; j++) {
      const v = near[j]!;
      const s = (filled[u]! - filled[v]!) / g.stepLength(u, v);
      if (s > steepest) {
        steepest = s;
        best = v;
      }
    }
    dir[u] = best;
  }
  const acc = new Float32Array(n);
  for (let i = 0; i < n; i++) acc[i] = sea[i] ? 0 : water ? water.runoff[i]! : 1;
  for (let q = count - 1; q >= 0; q--) {
    const u = order[q]!;
    const d = dir[u]!;
    if (!sea[u] && d >= 0 && !sea[d]) {
      acc[d] = acc[d]! + (water ? Math.max(0, acc[u]! - water.loss[u]!) : acc[u]!);
    }
  }
  return {
    filled,
    dir,
    acc,
    order: order.subarray(0, count),
    raised,
    raisedShare: land ? pits / land : 0,
  };
}

export interface Course {
  /** The cells from the start down to where it ends. */
  cells: number[];
  /**
   * The sea (or other water), a river already on the map, or the map's edge; or in a biome: dried
   * out in a desert, or spread into a marsh.
   */
  end: "sea" | "river" | "edge" | "dry" | "marsh";
  /** The river it joins, as `rivers` numbers it; 0 when it joins none. */
  joined: number;
}

/**
 * The course of a river from a cell: the drain directions followed down to the sea, to the map's
 * edge, or, when `rivers` is given (the number of the river on each cell, 0 for none), to the
 * first river already on the map.
 */
export function courseFrom(
  f: Flow,
  sea: Uint8Array,
  start: number,
  rivers: Int32Array | null = null,
  /** Where a biome ends the river on the step from one cell to the next (biomes.ts' `biomeEnd`). */
  stop?: (from: number, to: number) => "dry" | "marsh" | null,
): Course {
  const cells = [start];
  let c = start;
  // A cell is visited once at most, so the walk is no longer than the grid.
  for (let n = 0; n < sea.length; n++) {
    const d = f.dir[c]!;
    if (d < 0) return { cells, end: sea[c] ? "sea" : "edge", joined: 0 };
    cells.push(d);
    if (sea[d]) return { cells, end: "sea", joined: 0 };
    if (rivers && rivers[d]! > 0 && cells.length > 3) {
      return { cells, end: "river", joined: rivers[d]! };
    }
    const ended = stop && cells.length > 3 ? stop(c, d) : null;
    if (ended) return { cells, end: ended, joined: 0 };
    c = d;
  }
  return { cells, end: "edge", joined: 0 };
}

/**
 * From a cell upstream, always by the inflow that carries the most water, to where the stream
 * carries less than `least`. The first cell is `start`.
 */
export function upstream(g: Grid, f: Flow, start: number, least: number): number[] {
  const cells = [start];
  const near = new Int32Array(8);
  let c = start;
  for (let n = 0; n < f.dir.length; n++) {
    const k = g.neighbours(c, near);
    let best = -1;
    let most = least;
    for (let j = 0; j < k; j++) {
      const v = near[j]!;
      if (f.dir[v] === c && f.acc[v]! >= most) {
        most = f.acc[v]!;
        best = v;
      }
    }
    if (best < 0) break;
    cells.push(best);
    c = best;
  }
  return cells;
}

/**
 * The likely rivers: every stream that drains at least `above` cells, cut into stems and
 * tributaries, the longest first. A tributary ends on the cell where it meets a longer one; a
 * stream already on the map (`rivers`) is left out, and others end on it.
 */
export function likelyRivers(
  f: Flow,
  sea: Uint8Array,
  above: number,
  rivers: Int32Array | null = null,
): number[][] {
  const n = sea.length;
  const fed = new Uint8Array(n);
  const big = (i: number) => !sea[i] && f.acc[i]! >= above;
  for (let i = 0; i < n; i++) if (big(i) && f.dir[i]! >= 0) fed[f.dir[i]!] = 1;
  const heads: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    if (!big(i) || fed[i] || (rivers && rivers[i]! > 0)) continue;
    let length = 0;
    for (let c = i; c >= 0 && !sea[c] && length < n; c = f.dir[c]!) length++;
    heads.push([i, length]);
  }
  heads.sort((a, b) => b[1] - a[1]);
  const seen = new Uint8Array(n);
  const out: number[][] = [];
  for (const [head] of heads) {
    const cells: number[] = [];
    for (let c = head; c >= 0; c = f.dir[c]!) {
      cells.push(c);
      if (sea[c] || seen[c] || (rivers && rivers[c]! > 0)) break;
      seen[c] = 1;
    }
    if (cells.length >= 6) out.push(cells);
  }
  return out;
}

/** A hollow a river runs into that is large enough to be a lake: see `basinOn`. */
export interface Basin {
  /** The hollow's cells: those the flood filled, the hollow filled to where it spills. */
  cells: number[];
  /** The height it spills at: its lowest rim. */
  spill: number;
  /** Its lowest cell, where water that stays in it gathers. */
  deepest: number;
  /** How deep it is at its deepest, below the spill. */
  depth: number;
  /** The index in the course of its first cell in the hollow (its shore), and of its first cell out. */
  inlet: number;
  outlet: number;
}

/**
 * The first hollow along a river's course that is large enough to be a lake: at least `area`
 * cells, and at least `depth` deep below where it spills. Smaller hollows (the pits of a noisy
 * height map) are filled and crossed without a word, as the flood already does. `heights` are the
 * heights before rivers were drawn into them, so the trench of a painted river is no hollow.
 */
export function basinOn(
  g: Grid,
  f: Flow,
  heights: Float32Array,
  sea: Uint8Array,
  course: readonly number[],
  area: number,
  depth: number,
): Basin | null {
  const n = g.w * g.h;
  const tiny = depth * 0.1;
  const deep = (c: number) => !sea[c] && f.filled[c]! - heights[c]! > tiny;
  const seen = new Uint8Array(n);
  const near = new Int32Array(8);
  for (let i = 0; i < course.length; i++) {
    const start = course[i]!;
    if (seen[start] || !deep(start)) continue;
    const cells = [start];
    seen[start] = 1;
    let spill = -Infinity;
    let deepest = start;
    let most = 0;
    for (let q = 0; q < cells.length; q++) {
      const c = cells[q]!;
      spill = Math.max(spill, f.filled[c]!);
      const d = f.filled[c]! - heights[c]!;
      if (d > most) {
        most = d;
        deepest = c;
      }
      const k = g.neighbours(c, near);
      for (let j = 0; j < k; j++) {
        const v = near[j]!;
        if (!seen[v] && deep(v)) {
          seen[v] = 1;
          cells.push(v);
        }
      }
    }
    if (cells.length < area || most < depth) continue;
    const inside = new Set(cells);
    let outlet = i + 1;
    while (outlet < course.length && inside.has(course[outlet]!)) outlet++;
    return { cells, spill, deepest, depth: most, inlet: i, outlet };
  }
  return null;
}
