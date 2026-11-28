/**
 * The World Wizard's rivers (stage 34, release 2): where the rain that falls on the land runs to
 * the sea. Every cell of land drains to its lowest way out (hollows are filled first, as lakes
 * fill, so no water is stuck inland), the rain is added up down each way, and the ways that carry
 * the most are rivers. Rain decides: a desert gathers little, so few rivers cross one.
 */
import { ensure, H, LAT, N, W, type World } from "./model.ts";

/** The warmth, in °C through the year, at or under which water does not run or stand open. */
export const FROZEN = -4;

export interface River {
  /** Its course from its source to the sea, or to the river it joins, as cells. */
  cells: number[];
  /** How much water it carries at its end: for drawing the largest widest, and for choosing. */
  flow: number;
}

/** The eight cells round a cell, east and west joined round the globe. */
function around(i: number, out: number[]): number {
  const x = i % W;
  const y = Math.floor(i / W);
  let n = 0;
  for (let dy = -1; dy <= 1; dy++) {
    const yy = y + dy;
    if (yy < 0 || yy >= H) continue;
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      out[n++] = yy * W + ((x + dx + W) % W);
    }
  }
  return n;
}

/** A heap of cells, the lowest first. */
class Lowest {
  private cells: number[] = [];
  constructor(private height: Float32Array) {}
  get size() {
    return this.cells.length;
  }
  push(cell: number) {
    const a = this.cells;
    let i = a.length;
    a.push(cell);
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (this.height[a[up]!]! <= this.height[a[i]!]!) break;
      [a[up], a[i]] = [a[i]!, a[up]!];
      i = up;
    }
  }
  pop(): number {
    const a = this.cells;
    const top = a[0]!;
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let low = i;
        if (l < a.length && this.height[a[l]!]! < this.height[a[low]!]!) low = l;
        if (r < a.length && this.height[a[r]!]! < this.height[a[low]!]!) low = r;
        if (low === i) break;
        [a[low], a[i]] = [a[i]!, a[low]!];
        i = low;
      }
    }
    return top;
  }
}

export interface Drainage {
  /** The cell each land cell drains to; -1 for the sea. */
  to: Int32Array;
  /** The rain gathered at each cell from all that drains through it, by area. */
  flow: Float32Array;
  /** How high water stands at each cell once every hollow is full: above the ground in a lake. */
  level: Float32Array;
}

/** Which way every cell of land drains, and how much water passes through it. */
export function drainageOf(world: World): Drainage {
  ensure(world, "climate");
  const { elev, rain } = world;
  const to = new Int32Array(N).fill(-1);
  const level = Float32Array.from(elev);
  const seen = new Uint8Array(N);
  const heap = new Lowest(level);
  const order: number[] = [];
  const near: number[] = new Array<number>(8);
  // From the shore inland, always the lowest cell reached so far: a hollow is entered over its
  // lowest rim and drains back out that way.
  for (let i = 0; i < N; i++) {
    if (elev[i]! > 0) continue;
    seen[i] = 1;
    const n = around(i, near);
    for (let k = 0; k < n; k++) {
      if (elev[near[k]!]! > 0) {
        heap.push(i);
        break;
      }
    }
  }
  while (heap.size > 0) {
    const i = heap.pop();
    const n = around(i, near);
    for (let k = 0; k < n; k++) {
      const j = near[k]!;
      if (seen[j]) continue;
      seen[j] = 1;
      to[j] = i;
      if (level[j]! < level[i]!) level[j] = level[i]!;
      order.push(j);
      heap.push(j);
    }
  }
  const flow = new Float32Array(N);
  for (const i of order) flow[i] = rain[i]! * Math.cos(LAT[Math.floor(i / W)]!);
  // Cells were reached from the sea inward, so the last reached are the furthest upstream.
  for (let k = order.length - 1; k >= 0; k--) {
    const i = order[k]!;
    const down = to[i]!;
    if (down >= 0 && elev[down]! > 0) flow[down] = flow[down]! + flow[i]!;
  }
  return { to, flow, level };
}

/**
 * The rivers: the courses that carry at least `least` water, the largest first, at most `most`
 * of them. Each runs from its source to the sea or to the larger river it joins, whose cell it
 * ends on. Courses of fewer than four cells are left out.
 */
export function riversOf(
  world: World,
  least = 6,
  most = 60,
  drainage = drainageOf(world),
): River[] {
  const { to, flow } = drainage;
  const { elev, temp } = world;
  // Where it is frozen the year round, water lies as ice and no river runs.
  const isRiver = (i: number) => elev[i]! > 0 && flow[i]! >= least && temp[i]! > FROZEN;
  // A source is a river cell that no river cell drains into.
  const fed = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (isRiver(i) && to[i]! >= 0 && isRiver(to[i]!)) fed[to[i]!] = 1;
  const whole: number[][] = [];
  for (let i = 0; i < N; i++) {
    if (!isRiver(i) || fed[i]) continue;
    const cells = [i];
    // Down to the sea, or to where it meets ground frozen the year round and ends in the ice.
    for (let at = to[i]!; at >= 0 && elev[at]! > 0; at = to[at]!) {
      cells.push(at);
      if (temp[at]! <= FROZEN) break;
    }
    whole.push(cells);
  }
  // The longest course is the river; a shorter one that reaches it is a branch that ends there.
  whole.sort((a, b) => b.length - a.length);
  const taken = new Uint8Array(N);
  const rivers: River[] = [];
  for (const course of whole) {
    const cells: number[] = [];
    for (const c of course) {
      cells.push(c);
      if (taken[c]) break;
    }
    for (const c of cells) taken[c] = 1;
    if (cells.length < 4) continue;
    rivers.push({ cells, flow: flow[cells[cells.length - 1]!]! });
  }
  return rivers.sort((a, b) => b.flow - a.flow).slice(0, most);
}

/**
 * A river's course as `[longitude, latitude]` in degrees, cut into pieces where it crosses the
 * edge of the picture (180° east and west), so no piece runs the long way round.
 */
export function riverLines(river: River): [number, number][][] {
  const lines: [number, number][][] = [];
  let line: [number, number][] = [];
  let before = -1;
  for (const c of river.cells) {
    const x = c % W;
    if (before >= 0 && Math.abs(x - before) > 1) {
      if (line.length >= 2) lines.push(line);
      line = [];
    }
    line.push([
      Math.round((((x + 0.5) / W) * 360 - 180) * 100) / 100,
      Math.round(((LAT[Math.floor(c / W)]! * 180) / Math.PI) * 100) / 100,
    ]);
    before = x;
  }
  if (line.length >= 2) lines.push(line);
  return lines;
}

export interface Lake {
  cells: number[];
  /** The deepest it is, as a height. */
  depth: number;
}

/** A hollow is a lake when it would stand at least this deep: about 30 m. */
const LAKE_DEPTH = 0.0035;

/**
 * The lakes: hollows in the land that the water passing through keeps full, the largest first,
 * at most `most` of them. A hollow that little water reaches stays dry; one of fewer than three
 * cells is left out.
 */
export function lakesOf(world: World, least = 2, most = 40, drainage = drainageOf(world)): Lake[] {
  const { flow, level } = drainage;
  const { elev } = world;
  const wet = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (elev[i]! > 0 && level[i]! - elev[i]! >= LAKE_DEPTH && world.temp[i]! > FROZEN) wet[i] = 1;
  }
  const seen = new Uint8Array(N);
  const lakes: Lake[] = [];
  const near: number[] = new Array<number>(8);
  for (let start = 0; start < N; start++) {
    if (!wet[start] || seen[start]) continue;
    const cells: number[] = [];
    const stack = [start];
    seen[start] = 1;
    let depth = 0;
    let water = 0;
    while (stack.length > 0) {
      const i = stack.pop()!;
      cells.push(i);
      depth = Math.max(depth, level[i]! - elev[i]!);
      water = Math.max(water, flow[i]!);
      const n = around(i, near);
      for (let k = 0; k < n; k++) {
        const j = near[k]!;
        if (wet[j] && !seen[j]) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    if (cells.length >= 3 && water >= least) lakes.push({ cells, depth });
  }
  return lakes.sort((a, b) => b.cells.length - a.cells.length).slice(0, most);
}

/** Which cells are under a lake: 1 where one is. */
export function lakeMask(lakes: readonly Lake[]): Uint8Array {
  const mask = new Uint8Array(N);
  for (const lake of lakes) for (const c of lake.cells) mask[c] = 1;
  return mask;
}
