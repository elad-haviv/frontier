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

/**
 * How steep a way may be. A step steeper than `grade` (along the step: going across a slope is
 * gentle, so switchbacks form) is closed, unless steps or a tunnel are allowed.
 */
export interface Limits {
  /** The steepest grade a step may have, as a fraction (0.12 is 12%). */
  grade: number;
  /** Steps: steeper steps, up to `grade`, for at most `cells` in a row, each `factor` times slower. */
  steps: { grade: number; cells: number; factor: number } | null;
  /** Tunnels: straight through high ground, at most `cells` long, costing `hoursPerCell`. */
  tunnel: { cells: number; hoursPerCell: number; travelPerCell: number } | null;
}

/** No limit at all: every slope can be climbed, only slowly. */
export const NO_LIMIT: Limits = { grade: Infinity, steps: null, tunnel: null };

/** Steeper than this is a cliff: nothing climbs it, steps included. */
export const CLIFF = 1.2;

/** How each cell of a way was reached from the one before. */
export const PLAIN = 0;
export const STEPS = 1;
export const TUNNEL = 2;

export interface Found {
  cells: number[];
  hours: number;
  /** How each cell was reached (PLAIN, STEPS, TUNNEL); the first is PLAIN. */
  how: number[];
}

/** The search's arrays, kept between searches on one grid: a stamp says which search wrote a cell. */
interface Scratch {
  n: number;
  g: Float64Array;
  came: Int32Array;
  seen: Int32Array;
  closed: Int32Array;
  target: Int32Array;
  how: Int8Array;
  /** How many cells of steps in a row led here. */
  run: Float32Array;
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
      target: new Int32Array(n),
      how: new Int8Array(n),
      run: new Float32Array(n),
      stamp: 0,
    };
  }
  scratch.stamp++;
  return scratch;
}

/**
 * The sixteen ways out of a cell: the eight neighbours and the eight a knight's move away. The
 * knight's moves give a way gentler angles across a slope, so a climb winds up it in switchbacks
 * of shallow zigzags instead of the 45° of eight ways.
 */
export const MOVES: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
  [1, 2],
  [-1, 2],
  [1, -2],
  [-1, -2],
  [2, 1],
  [-2, 1],
  [2, -1],
  [-2, -1],
];

/** The two cells a knight's move passes between, or none for a plain step. */
function between(dx: number, dy: number): [number, number][] {
  if (Math.abs(dx) === 1 && Math.abs(dy) === 2) {
    return [
      [0, Math.sign(dy)],
      [dx, Math.sign(dy)],
    ];
  }
  if (Math.abs(dx) === 2 && Math.abs(dy) === 1) {
    return [
      [Math.sign(dx), 0],
      [Math.sign(dx), dy],
    ];
  }
  return [];
}
const BETWEEN = MOVES.map(([dx, dy]) => between(dx, dy));
const LENGTH = MOVES.map(([dx, dy]) => Math.hypot(dx, dy));

/** How long a step between two cells is, in cells. */
export function stepCells(w: number, u: number, v: number): number {
  return Math.hypot((v % w) - (u % w), ((v / w) | 0) - ((u / w) | 0));
}

/**
 * The grade of a step, as a fraction: the rise over the step's length. A knight's move is judged
 * by its two halves, through the height at its middle (between the two cells it passes), so a
 * ridge between its ends is not stepped over.
 */
export function stepGrade(t: Terrain, u: number, v: number): number {
  const { w } = t.grid;
  const h = t.heights;
  const length = stepCells(w, u, v);
  const grade = (Math.abs(h[v]! - h[u]!) * t.rise) / length;
  const via = between((v % w) - (u % w), ((v / w) | 0) - ((u / w) | 0));
  if (via.length === 0) return grade;
  let mid = 0;
  for (const [mx, my] of via) mid += h[u + my * w + mx]! / 2;
  const half = length / 2;
  return Math.max(
    grade,
    (Math.abs(mid - h[u]!) * t.rise) / half,
    (Math.abs(h[v]! - mid) * t.rise) / half,
  );
}

/** The hours one step takes as travelled, from cell `u` to cell `v`, reached `how`. */
export function stepHours(
  t: Terrain,
  s: Surface,
  u: number,
  v: number,
  how: number = PLAIN,
  limits: Limits = NO_LIMIT,
): number {
  const length = stepCells(t.grid.w, u, v);
  if (how === TUNNEL && limits.tunnel) return length * limits.tunnel.travelPerCell;
  const slope = ((t.heights[v]! - t.heights[u]!) * t.rise) / length;
  const base =
    length * t.kmPerCell * 0.5 * (s.inv[u]! + s.inv[v]!) * slopeFactor(s.k, s.off, slope);
  return how === STEPS && limits.steps ? base * limits.steps.factor : base;
}

/** The hours a run of cells takes, as travelled (Flattest's dislike of slopes is not time). */
export function hoursAlong(
  t: Terrain,
  s: Surface,
  cells: readonly number[],
  how: readonly number[] = [],
  limits: Limits = NO_LIMIT,
): number {
  let h = 0;
  for (let i = 1; i < cells.length; i++) {
    h += stepHours(t, s, cells[i - 1]!, cells[i]!, how[i] ?? PLAIN, limits);
  }
  return h;
}

/**
 * The quickest way from one cell (or any of several: a road a route branches from) to another
 * (or the nearest of several), or null when there is none within the limits.
 */
export function search(
  t: Terrain,
  s: Surface,
  from: number | readonly number[],
  to: number | readonly number[],
  limits: Limits = NO_LIMIT,
): Found | null {
  const { grid, heights } = t;
  const { w, h } = grid;
  const { inv } = s;
  const sources = (typeof from === "number" ? [from] : from).filter((c) => inv[c] !== Infinity);
  const targets = (typeof to === "number" ? [to] : to).filter((c) => inv[c] !== Infinity);
  if (sources.length === 0 || targets.length === 0) return null;
  const sc = scratchFor(w * h);
  const { g, came, seen, closed, target, how, run, stamp } = sc;
  const heap = new Heap(4096);
  // The estimate of what is left: straight to the box round the targets, at the fastest speed
  // there is on the best slope. Never more than the true time, so the way found is the quickest.
  let [tx0, ty0, tx1, ty1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const c of targets) {
    target[c] = stamp;
    const x = c % w;
    const y = (c / w) | 0;
    tx0 = Math.min(tx0, x);
    ty0 = Math.min(ty0, y);
    tx1 = Math.max(tx1, x);
    ty1 = Math.max(ty1, y);
  }
  const least = (t.kmPerCell / s.vmax) * bestSlopeFactor(s.k, s.off);
  const left = (c: number) => {
    const x = c % w;
    const y = (c / w) | 0;
    const dx = x < tx0 ? tx0 - x : x > tx1 ? x - tx1 : 0;
    const dy = y < ty0 ? ty0 - y : y > ty1 ? y - ty1 : 0;
    return Math.hypot(dx, dy) * least;
  };
  for (const c of sources) {
    g[c] = 0;
    seen[c] = stamp;
    came[c] = -1;
    how[c] = PLAIN;
    run[c] = 0;
    heap.push(left(c), c);
  }
  const relax = (u: number, v: number, cost: number, kind: number, steps: number) => {
    const ng = g[u]! + cost;
    if (seen[v] !== stamp || ng < g[v]!) {
      g[v] = ng;
      seen[v] = stamp;
      came[v] = u;
      how[v] = kind;
      run[v] = steps;
      heap.push(ng + left(v), v);
    }
  };
  let reached = -1;
  while (heap.size) {
    const u = heap.pop();
    if (closed[u] === stamp) continue;
    closed[u] = stamp;
    if (target[u] === stamp) {
      reached = u;
      break;
    }
    const hu = heights[u]!;
    const iu = inv[u]!;
    const ux = u % w;
    const uy = (u / w) | 0;
    let tooSteep = false;
    for (let j = 0; j < MOVES.length; j++) {
      const [dx, dy] = MOVES[j]!;
      const vx = ux + dx;
      const vy = uy + dy;
      if (vx < 0 || vy < 0 || vx >= w || vy >= h) continue;
      const v = vy * w + vx;
      const iv = inv[v]!;
      if (iv === Infinity || closed[v] === stamp) continue;
      let im = 0;
      let blocked = false;
      for (const [mx, my] of BETWEEN[j]!) {
        const m = (uy + my) * w + ux + mx;
        if (inv[m] === Infinity) blocked = true;
        im += inv[m]!;
      }
      if (blocked) continue;
      const length = LENGTH[j]!;
      const slope = ((heights[v]! - hu) * t.rise) / length;
      const grade = BETWEEN[j]!.length ? stepGrade(t, u, v) : Math.abs(slope);
      let kind = PLAIN;
      let steps = 0;
      if (grade > limits.grade) {
        tooSteep = true;
        const st = limits.steps;
        if (!st || grade > st.grade || grade > CLIFF || run[u]! + length > st.cells) continue;
        kind = STEPS;
        steps = run[u]! + length;
      }
      const mean = BETWEEN[j]!.length ? (iu + iv + im) / 4 : 0.5 * (iu + iv);
      let cost = length * t.kmPerCell * mean * slopeFactor(s.k, s.off, slope);
      if (s.flat) cost *= 1 + s.flat * Math.abs(slope);
      if (kind === STEPS) cost *= limits.steps!.factor;
      relax(u, v, cost, kind, steps);
    }
    // A tunnel starts where the ground ahead was too steep: straight on through the high ground,
    // coming out where the way on is within the limit again.
    const tn = limits.tunnel;
    if (tn && tooSteep) {
      for (let j = 0; j < MOVES.length; j++) {
        const [dx, dy] = MOVES[j]!;
        const length = LENGTH[j]!;
        let top = hu;
        for (let k = 2; k * length <= tn.cells; k++) {
          const vx = ux + dx * k;
          const vy = uy + dy * k;
          if (vx < 0 || vy < 0 || vx >= w || vy >= h) break;
          const v = vy * w + vx;
          // Never under the sea.
          if (s.sea?.[v]) break;
          const hv = heights[v]!;
          // Through the high ground, not up into it: both mouths well below what is above.
          const through = top - Math.max(hu, hv) >= 0.4 * (top - Math.min(hu, hv));
          if (inv[v] !== Infinity && closed[v] !== stamp && top > Math.max(hu, hv) && through) {
            const grade = (Math.abs(hv - hu) * t.rise) / (k * length);
            if (grade <= limits.grade) relax(u, v, k * length * tn.hoursPerCell, TUNNEL, 0);
          }
          top = Math.max(top, hv);
        }
      }
    }
  }
  if (reached < 0) return null;
  const cells: number[] = [];
  const kinds: number[] = [];
  for (let c = reached; c >= 0; c = came[c]!) {
    cells.push(c);
    kinds.push(how[c]!);
  }
  cells.reverse();
  kinds.reverse();
  kinds[0] = PLAIN;
  return { cells, how: kinds, hours: hoursAlong(t, s, cells, kinds, limits) };
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

export type Leg = Found;

/** Where a route's leg may start or end: one cell, or the cells of a road it branches from. */
export type Place = number | readonly number[];

const passable = (grid: Grid, s: Surface, place: Place): Place | null => {
  if (typeof place === "number") {
    const c = nearestPassable(grid, s, place);
    return c < 0 ? null : c;
  }
  const cells = place.filter((c) => s.inv[c] !== Infinity);
  return cells.length ? cells : null;
};

/**
 * A route through its stops, each leg searched by itself. Null when a stop has no way through
 * near it, or a leg has no way within the limits.
 */
export function routeThrough(
  t: Terrain,
  s: Surface,
  stops: readonly Place[],
  limits: Limits = NO_LIMIT,
): Leg[] | null {
  const legs: Leg[] = [];
  let from: Place | null = passable(t.grid, s, stops[0]!);
  for (let k = 0; k + 1 < stops.length; k++) {
    const to = passable(t.grid, s, stops[k + 1]!);
    if (from === null || to === null) return null;
    const found = search(t, s, from, to, limits);
    if (!found) return null;
    legs.push(found);
    // The next leg sets out from where this one arrived.
    from = found.cells[found.cells.length - 1]!;
  }
  return legs;
}

/**
 * The steepest step of a way and where it is: what the bar names when there is no way within a
 * travelling mode's limit.
 */
export function steepestStep(
  t: Terrain,
  cells: readonly number[],
): { cell: number; grade: number } {
  let best = { cell: cells[0] ?? 0, grade: 0 };
  for (let i = 1; i < cells.length; i++) {
    const grade = stepGrade(t, cells[i - 1]!, cells[i]!);
    if (grade > best.grade) best = { cell: cells[i]!, grade };
  }
  return best;
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
export function sameWay(
  a: Pick<Found, "cells" | "hours">,
  fastest: Pick<Found, "cells" | "hours">,
): boolean {
  if (Math.abs(a.hours - fastest.hours) < fastest.hours * 0.012) return true;
  const set = new Set(fastest.cells);
  let apart = 0;
  for (const c of a.cells) if (!set.has(c)) apart++;
  return apart < a.cells.length * 0.1;
}
