/**
 * Routes: the way that takes the least time over the cost surface, by A* over the cells. The time
 * of a step is its length times the mean of the two cells' hours per km, times what the slope
 * between them does, so the cost depends on the direction. The estimate of what is left is the
 * straight distance at the fastest speed on the best slope, which never overestimates: the way
 * found is the true quickest on the grid.
 */
import { bestSlopeFactor, type Ground, slopeFactor, type Surface } from "./cost.ts";
import type { Grid } from "./grid.ts";
import { Heap } from "./heap.ts";

export interface Terrain {
  grid: Grid;
  /** The height of each cell, in any unit. */
  heights: Float32Array;
  /** Kilometres along one side of a cell. */
  kmPerCell: number;
  /** A slope between two cells is (difference in height) × rise ÷ (their distance in cells). */
  rise: number;
}

export interface Found {
  cells: number[];
  hours: number;
}

/** The search's arrays, kept between searches on one grid: a stamp says which search wrote a cell. */
interface Scratch {
  n: number;
  g: Float64Array;
  came: Int32Array;
  seen: Int32Array;
  closed: Int32Array;
  stamp: number;
}
let scratch: Scratch | null = null;
function scratchFor(n: number): Scratch {
  if (!scratch || scratch.n !== n) {
    scratch = {
      n,
      g: new Float64Array(n),
      came: new Int32Array(n),
      seen: new Int32Array(n),
      closed: new Int32Array(n),
      stamp: 0,
    };
  }
  scratch.stamp++;
  return scratch;
}

/** The hours one step takes, from cell `u` to its neighbour `v`. */
export function stepHours(t: Terrain, s: Surface, u: number, v: number): number {
  const length = t.grid.stepLength(u, v);
  const slope = ((t.heights[v]! - t.heights[u]!) * t.rise) / length;
  return (
    length * t.kmPerCell * 0.5 * (s.inv[u]! + s.inv[v]!) * slopeFactor(s.k, s.off, slope)
  );
}

/** The hours a run of cells takes, as travelled (Flattest's dislike of slopes is not time). */
export function hoursAlong(t: Terrain, s: Surface, cells: readonly number[]): number {
  let h = 0;
  for (let i = 1; i < cells.length; i++) h += stepHours(t, s, cells[i - 1]!, cells[i]!);
  return h;
}

/** The quickest way from one cell to another, or null when there is none. */
export function search(t: Terrain, s: Surface, from: number, to: number): Found | null {
  const { grid, heights } = t;
  const { inv } = s;
  if (inv[from] === Infinity || inv[to] === Infinity) return null;
  const sc = scratchFor(grid.w * grid.h);
  const { g, came, seen, closed, stamp } = sc;
  const near = new Int32Array(8);
  const heap = new Heap(4096);
  const tx = to % grid.w;
  const ty = (to / grid.w) | 0;
  // Never more than the true time: straight there, at the fastest speed, on the best slope.
  const least = (t.kmPerCell / s.vmax) * bestSlopeFactor(s.k, s.off);
  g[from] = 0;
  seen[from] = stamp;
  came[from] = -1;
  heap.push(0, from);
  while (heap.size) {
    const u = heap.pop();
    if (closed[u] === stamp) continue;
    closed[u] = stamp;
    if (u === to) break;
    const gu = g[u]!;
    const hu = heights[u]!;
    const iu = inv[u]!;
    const k = grid.neighbours(u, near);
    for (let j = 0; j < k; j++) {
      const v = near[j]!;
      const iv = inv[v]!;
      if (iv === Infinity || closed[v] === stamp) continue;
      const length = grid.stepLength(u, v);
      const slope = ((heights[v]! - hu) * t.rise) / length;
      let cost = length * t.kmPerCell * 0.5 * (iu + iv) * slopeFactor(s.k, s.off, slope);
      if (s.flat) cost *= 1 + s.flat * Math.abs(slope);
      const ng = gu + cost;
      if (seen[v] !== stamp || ng < g[v]!) {
        g[v] = ng;
        seen[v] = stamp;
        came[v] = u;
        heap.push(ng + Math.hypot((v % grid.w) - tx, ((v / grid.w) | 0) - ty) * least, v);
      }
    }
  }
  if (closed[to] !== stamp) return null;
  const cells: number[] = [];
  for (let c = to; c >= 0; c = came[c]!) cells.push(c);
  cells.reverse();
  return { cells, hours: hoursAlong(t, s, cells) };
}

/** The nearest cell with a way through, within `reach` cells; -1 when there is none. */
export function nearestPassable(grid: Grid, s: Surface, cell: number, reach = 5): number {
  if (s.inv[cell] !== Infinity) return cell;
  const x = cell % grid.w;
  const y = (cell / grid.w) | 0;
  let best = -1;
  let bd = Infinity;
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= grid.w || yy >= grid.h) continue;
      const v = yy * grid.w + xx;
      const d = dx * dx + dy * dy;
      if (s.inv[v] !== Infinity && d < bd) {
        bd = d;
        best = v;
      }
    }
  }
  return best;
}

export interface Leg {
  cells: number[];
  hours: number;
}

/**
 * A route through its stops, each leg searched by itself. Null when a stop has no way through
 * near it, or a leg has no way at all.
 */
export function routeThrough(t: Terrain, s: Surface, stops: readonly number[]): Leg[] | null {
  const legs: Leg[] = [];
  for (let k = 0; k + 1 < stops.length; k++) {
    const a = nearestPassable(t.grid, s, stops[k]!);
    const b = nearestPassable(t.grid, s, stops[k + 1]!);
    if (a < 0 || b < 0) return null;
    const found = search(t, s, a, b);
    if (!found) return null;
    legs.push(found);
  }
  return legs;
}

/** A place along a route worth marking. */
export interface RouteMark {
  cell: number;
  kind: "ford" | "bridge" | "sail" | "land";
}

/** The fords, bridges and stretches by sea along a route's cells. */
export function marksAlong(
  ground: Ground,
  cells: readonly number[],
): { marks: RouteMark[]; fords: number; bridges: number; seaCells: number } {
  const marks: RouteMark[] = [];
  let fords = 0;
  let bridges = 0;
  let seaCells = 0;
  let inFord = false;
  let inBridge = false;
  cells.forEach((c, i) => {
    const sea = !!ground.sea[c];
    const ford = !sea && !!ground.riverWide[c] && !ground.road[c];
    const bridge = !sea && !!ground.river[c] && !!ground.road[c];
    if (ford && !inFord) {
      fords++;
      marks.push({ cell: c, kind: "ford" });
    }
    if (bridge && !inBridge) {
      bridges++;
      marks.push({ cell: c, kind: "bridge" });
    }
    inFord = ford;
    inBridge = bridge;
    if (i === 0) return;
    const was = !!ground.sea[cells[i - 1]!];
    if (sea) {
      seaCells++;
      if (!was) marks.push({ cell: c, kind: "sail" });
    } else if (was) marks.push({ cell: cells[i - 1]!, kind: "land" });
  });
  return { marks, fords, bridges, seaCells };
}

/**
 * Whether another way is the same as the fastest for the owner's purposes: about the same time,
 * or nearly the same cells. Such a way is not offered as a separate ghost.
 */
export function sameWay(a: Found, fastest: Found): boolean {
  if (Math.abs(a.hours - fastest.hours) < fastest.hours * 0.012) return true;
  const set = new Set(fastest.cells);
  let apart = 0;
  for (const c of a.cells) if (!set.has(c)) apart++;
  return apart < a.cells.length * 0.1;
}
