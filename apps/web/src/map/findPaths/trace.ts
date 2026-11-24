/**
 * Trace: a line already painted in the picture, followed as a path. From the ink nearest the
 * click, the ink of that colour is grown by a few pixels so that the gaps of a dashed line, a
 * bridge or a town's ring do not break it (closing with a square does not close a thin diagonal
 * dashed line: the eroding square never fits), and the longest way along it is found by two
 * breadth-first sweeps: from the click to the farthest pixel, and from there to the farthest
 * again. Side branches are what still lies far from that way. Each point is then moved to the
 * middle of the ink, measured across the line.
 */
import type { Px } from "../findAreas/contour.ts";
import { morph } from "../findAreas/ink.ts";
import { type Colour, isRiverInk, isRoadInk } from "./classes.ts";
import { nearestOn, smoothOpen } from "./lines.ts";

export interface TracePicture {
  w: number;
  h: number;
  L: Float32Array;
  A: Float32Array;
  B: Float32Array;
  /** Faint and dark ink. */
  ink: Uint8Array;
  /** The middle the picture's colours are judged from. */
  ref: Colour;
}

export type TraceKind = "river" | "road" | "line";

export type Traced =
  | {
      ok: true;
      /** The main line, in the picture's pixels; a closed one ends where it starts. */
      points: Px[];
      /** Side branches, each ending on the main line. */
      branches: Px[][];
      loop: boolean;
      /** What the line's colour suggests it is. */
      kind: TraceKind;
    }
  /** No ink near the click; a mark too short to be a path; or the second click is on another line. */
  | { ok: false; why: "none" | "short" | "other" };

/** How near the click the ink must be, in pixels. */
export const SEED_REACH = 6;
/** How alike in colour (ΔE, lightness counted for less) ink must be to be the same line. */
const ALIKE = 20;
/** How far the line's mask is grown: gaps of up to twice this are jumped. */
export const GROW = 3;
/** The shortest way along ink that is a line, and the shortest branch offered. */
export const SHORTEST = 24;
const SHORTEST_BRANCH = 26;
/** Looking for a closed line: how wide a strip is cut round the found half, and how much of each end is left. */
const CUT = 3 * GROW + 2;
const ENDS = CUT + 5;

const STEP_X = [1, 0, -1, 0, 1, -1, -1, 1];
const STEP_Y = [0, 1, 0, -1, 1, 1, -1, -1];

export class Tracer {
  private dist: Int32Array;
  private parent: Int32Array;
  private queue: Int32Array;
  /** The mask of the line last followed, kept while the pointer stays on it. */
  private kept: { colour: Colour; mask: Uint8Array } | null = null;

  constructor(private pic: TracePicture) {
    const n = pic.w * pic.h;
    this.dist = new Int32Array(n).fill(-1);
    this.parent = new Int32Array(n);
    this.queue = new Int32Array(n);
  }

  /** Breadth-first over the mask, eight ways, straight steps first; returns how many were reached. */
  private sweep(mask: Uint8Array, sources: readonly number[]): number {
    const { w, h } = this.pic;
    const { dist, parent, queue } = this;
    let head = 0;
    let tail = 0;
    for (const s of sources) {
      if (dist[s]! < 0) {
        dist[s] = 0;
        parent[s] = -1;
        queue[tail++] = s;
      }
    }
    while (head < tail) {
      const i = queue[head++]!;
      const x = i % w;
      const y = (i / w) | 0;
      for (let d = 0; d < 8; d++) {
        const xx = x + STEP_X[d]!;
        const yy = y + STEP_Y[d]!;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const v = yy * w + xx;
        if (!mask[v] || dist[v]! >= 0) continue;
        dist[v] = dist[i]! + 1;
        parent[v] = i;
        queue[tail++] = v;
      }
    }
    return tail;
  }

  private reset(reached: number): void {
    for (let k = 0; k < reached; k++) this.dist[this.queue[k]!] = -1;
  }

  private back(from: number): number[] {
    const out: number[] = [];
    for (let c = from; c >= 0; c = this.parent[c]!) out.push(c);
    return out;
  }

  /** The ink nearest a point, within reach; -1 when there is none. */
  inkNear(x: number, y: number, reach = SEED_REACH): number {
    const { w, h, ink } = this.pic;
    let best = -1;
    let bd = Infinity;
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const d = dx * dx + dy * dy;
        if (ink[yy * w + xx] && d < bd) {
          bd = d;
          best = yy * w + xx;
        }
      }
    }
    return best;
  }

  /** The mean colour of the ink at and beside a pixel. */
  private colourAt(seed: number): Colour {
    const { w, h, L, A, B, ink } = this.pic;
    const sx = seed % w;
    const sy = (seed / w) | 0;
    const c = { l: 0, a: 0, b: 0 };
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const xx = sx + dx;
        const yy = sy + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h || !ink[yy * w + xx]) continue;
        const i = yy * w + xx;
        c.l += L[i]!;
        c.a += A[i]!;
        c.b += B[i]!;
        n++;
      }
    }
    return { l: c.l / n, a: c.a / n, b: c.b / n };
  }

  private maskFor(seed: number): { mask: Uint8Array; colour: Colour } {
    const { w, h, L, A, B, ink } = this.pic;
    const colour = this.colourAt(seed);
    const kept = this.kept;
    if (
      kept &&
      kept.mask[seed] &&
      Math.hypot(kept.colour.l - colour.l, kept.colour.a - colour.a, kept.colour.b - colour.b) <= 5
    ) {
      return kept;
    }
    const alike = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      if (!ink[i]) continue;
      const dl = (L[i]! - colour.l) * 0.6;
      const da = A[i]! - colour.a;
      const db = B[i]! - colour.b;
      if (dl * dl + da * da + db * db < ALIKE * ALIKE) alike[i] = 1;
    }
    const mask = morph(alike, w, h, GROW, true);
    mask[seed] = 1;
    this.kept = { colour, mask };
    return this.kept;
  }

  /** What a line of this colour is likely to be, judged against the picture's own colours. */
  private kindOf(colour: Colour): TraceKind {
    if (isRiverInk(colour, this.pic.ref)) return "river";
    if (isRoadInk(colour, this.pic.ref)) return "road";
    return "line";
  }

  /**
   * The painted line under `at`: to both of its ends, or, with `end` (a second click on the same
   * line), the stretch between the two clicks.
   */
  trace(at: Px, end: Px | null, wantBranches: boolean): Traced {
    const { w, h } = this.pic;
    const seed = this.inkNear(Math.round(at[0]), Math.round(at[1]));
    if (seed < 0) return { ok: false, why: "none" };
    const { mask, colour } = this.maskFor(seed);
    const { dist, queue } = this;
    let path: number[];
    let loop = false;
    let reached = this.sweep(mask, [seed]);
    if (end) {
      // The pixel of this line nearest the second click.
      let e = -1;
      let bd = Infinity;
      const ex = Math.round(end[0]);
      const ey = Math.round(end[1]);
      for (let dy = -8; dy <= 8; dy++) {
        for (let dx = -8; dx <= 8; dx++) {
          const xx = ex + dx;
          const yy = ey + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const i = yy * w + xx;
          const d = dx * dx + dy * dy;
          if (dist[i]! >= 0 && d < bd) {
            bd = d;
            e = i;
          }
        }
      }
      if (e < 0) {
        this.reset(reached);
        return { ok: false, why: "other" };
      }
      path = this.back(e).reverse();
      this.reset(reached);
    } else {
      const a = queue[reached - 1]!;
      this.reset(reached);
      reached = this.sweep(mask, [a]);
      const b = queue[reached - 1]!;
      path = this.back(b);
      this.reset(reached);
      // A closed line (a coast, a lake's shore): with the found half cut out of the mask, is
      // there another way from one end to the other? Then that is the other half.
      if (path.length > 80) {
        const cut: number[] = [];
        // The cut is wide enough to take the whole grown band, whichever way the line runs.
        for (let k = ENDS; k < path.length - ENDS; k++) {
          const px = path[k]! % w;
          const py = (path[k]! / w) | 0;
          for (let dy = -CUT; dy <= CUT; dy++) {
            for (let dx = -CUT; dx <= CUT; dx++) {
              const xx = px + dx;
              const yy = py + dy;
              if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
              const i = yy * w + xx;
              if (mask[i]) {
                mask[i] = 0;
                cut.push(i);
              }
            }
          }
        }
        reached = this.sweep(mask, [a]);
        if (dist[b]! >= 0) {
          const other = this.back(b);
          if (other.length > path.length * 0.3) {
            path = path.concat(other.reverse().slice(1));
            loop = true;
          }
        }
        this.reset(reached);
        for (const i of cut) mask[i] = 1;
      }
    }
    if (path.length < SHORTEST) return { ok: false, why: "short" };

    const cells: number[][] = [];
    if (wantBranches && !end) {
      let sources = path.slice();
      for (let k = 0; k < 6; k++) {
        reached = this.sweep(mask, sources);
        const tip = queue[reached - 1]!;
        const far = dist[tip]!;
        if (far < SHORTEST_BRANCH) {
          this.reset(reached);
          break;
        }
        const branch = this.back(tip);
        this.reset(reached);
        cells.push(branch);
        sources = sources.concat(branch);
      }
    }
    const toPx = (run: number[]): Px[] => run.map((c) => [c % w, (c / w) | 0]);
    let points = this.centre(smoothOpen(toPx(path), 6), mask);
    if (loop) points[points.length - 1] = [...points[0]!];
    else points = this.trim(points, mask);
    const branches = cells.map((run) => {
      const b = this.centre(smoothOpen(toPx(run), 6), mask);
      const on = nearestOn(b[b.length - 1]!, points);
      if (on.d < 8) b[b.length - 1] = on.at;
      return b;
    });
    return { ok: true, points, branches, loop, kind: this.kindOf(colour) };
  }

  /**
   * The line without the bits at its ends that lie on no ink: the grown mask reaches a few pixels
   * past the last ink, and the farthest pixel of a sweep is out in that margin.
   */
  private trim(pts: Px[], mask: Uint8Array): Px[] {
    const { w, h, ink } = this.pic;
    const onInk = ([px, py]: Px) => {
      const x = Math.round(px);
      const y = Math.round(py);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          if (ink[yy * w + xx] && mask[yy * w + xx]) return true;
        }
      }
      return false;
    };
    let from = 0;
    let to = pts.length - 1;
    const most = 3 * GROW;
    while (from < to - 2 && from < most && !onInk(pts[from]!)) from++;
    while (to > from + 2 && pts.length - 1 - to < most && !onInk(pts[to]!)) to--;
    return pts.slice(from, to + 1);
  }

  /**
   * Moves each point to the middle of the line's ink, measured across it. In a gap (between two
   * dashes, under a bridge) there is no ink to measure: the point moves as its neighbours do.
   */
  private centre(pts: Px[], mask: Uint8Array): Px[] {
    const { w, h, ink } = this.pic;
    const n = pts.length;
    const normals: Px[] = [];
    const shift = new Float64Array(n).fill(NaN);
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 3)]!;
      const b = pts[Math.min(n - 1, i + 3)]!;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const l = Math.hypot(dx, dy) || 1;
      const nx = -dy / l;
      const ny = dx / l;
      normals.push([nx, ny]);
      let sum = 0;
      let count = 0;
      for (let t = -2 * GROW; t <= 2 * GROW; t += 0.5) {
        const xx = Math.round(pts[i]![0] + nx * t);
        const yy = Math.round(pts[i]![1] + ny * t);
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        if (mask[yy * w + xx] && ink[yy * w + xx]) {
          sum += t;
          count++;
        }
      }
      if (count) shift[i] = sum / count;
    }
    // Across each run with no ink, the shift goes evenly from the one before to the one after.
    let last = -1;
    for (let i = 0; i <= n; i++) {
      if (i < n && Number.isNaN(shift[i]!)) continue;
      for (let k = last + 1; k < i; k++) {
        const before = last >= 0 ? shift[last]! : i < n ? shift[i]! : 0;
        const after = i < n ? shift[i]! : before;
        shift[k] = before + ((after - before) * (k - last)) / (i - last);
      }
      last = i;
    }
    const out = pts.map((p, i): Px => [p[0] + normals[i]![0] * shift[i]!, p[1] + normals[i]![1] * shift[i]!]);
    return smoothOpen(out, 2);
  }
}
