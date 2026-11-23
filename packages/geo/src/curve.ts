/**
 * The line a path or zone is drawn along: its control points joined by straight lines on a flat
 * map or great circles on a globe, or, for a curved feature, by a centripetal Catmull-Rom spline
 * through them. Drawing, hit-testing, the fill, measuring and saved pictures all take their line
 * from `outline`, so they agree.
 */
import { geoDistance, geoInterpolate } from "d3-geo";
import { densify } from "./measure.js";
import { type Position, type Space, wrapLongitude } from "./space.js";

export interface Outline {
  /** The positions to draw, after `densify`; for a closed outline the first is repeated last. */
  line: Position[];
  /** One entry per stored segment (a path's n − 1, a zone's n): the index in `line` where it starts. */
  spans: number[];
}

type Vector = number[];

const RAD = Math.PI / 180;
/** On a globe, a segment longer than this is drawn as its great circle, not as part of the curve. */
export const LONGEST_CURVED = 90;

const same = (a: Position, b: Position) => a[0] === b[0] && a[1] === b[1];
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

function toVector([lon, lat]: Position): Vector {
  return [
    Math.cos(lat * RAD) * Math.cos(lon * RAD),
    Math.cos(lat * RAD) * Math.sin(lon * RAD),
    Math.sin(lat * RAD),
  ];
}

function toPosition(v: Vector): Position {
  return [Math.atan2(v[1]!, v[0]!) / RAD, Math.atan2(v[2]!, Math.hypot(v[0]!, v[1]!)) / RAD];
}

const sub = (a: Vector, b: Vector) => a.map((x, i) => x - b[i]!);
const length = (a: Vector) => Math.hypot(...a);
/** The weighted sum `a·(1 − s) + b·s`. */
const lerp = (a: Vector, b: Vector, s: number) => a.map((x, i) => x * (1 - s) + b[i]! * s);

/**
 * Samples of one segment of a centripetal Catmull-Rom spline from `p1` to `p2`, with `p0` before
 * and `p3` after: `count` points, the last of them `p2` itself.
 */
export function catmullRom(
  p0: Vector,
  p1: Vector,
  p2: Vector,
  p3: Vector,
  count: number,
): Vector[] {
  // The knots are spaced by the square root of each chord: the centripetal form, which makes no
  // cusp or loop within a segment. A tiny step stands in for a zero one.
  const knot = (a: Vector, b: Vector) => Math.max(Math.sqrt(length(sub(b, a))), 1e-9);
  const t1 = knot(p0, p1);
  const t2 = t1 + knot(p1, p2);
  const t3 = t2 + knot(p2, p3);
  const out: Vector[] = [];
  for (let k = 1; k <= count; k++) {
    if (k === count) {
      out.push([...p2]);
      break;
    }
    const t = t1 + ((t2 - t1) * k) / count;
    const a1 = lerp(p0, p1, t / t1);
    const a2 = lerp(p1, p2, (t - t1) / (t2 - t1));
    const a3 = lerp(p2, p3, (t - t2) / (t3 - t2));
    const b1 = lerp(a1, a2, t / t2);
    const b2 = lerp(a2, a3, (t - t1) / (t3 - t1));
    out.push(lerp(b1, b2, (t - t1) / (t2 - t1)));
  }
  return out;
}

/** The degrees between two positions on a sphere. */
const degreesBetween = (a: Position, b: Position) => geoDistance(a, b) / RAD;

/**
 * The positions after `a` up to and including `b` of one segment, given its neighbours `before`
 * and `after` (the points either side, or mirrored points at a path's ends).
 */
function segment(
  space: Space,
  before: Position | null,
  a: Position,
  b: Position,
  after: Position | null,
  curve: boolean,
): Position[] {
  if (space.kind === "flat") {
    if (!curve) return [b];
    const chord = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const count = clamp(Math.ceil(chord / 8), 8, 64);
    const p0 = before ?? [2 * a[0] - b[0], 2 * a[1] - b[1]];
    const p3 = after ?? [2 * b[0] - a[0], 2 * b[1] - a[1]];
    return catmullRom(p0, a, b, p3, count).map((v) => [v[0]!, v[1]!]);
  }
  const angle = degreesBetween(a, b);
  // Near opposite points the spline is not well defined: the great circle is drawn instead.
  if (!curve || angle > LONGEST_CURVED) return [b];
  const count = clamp(Math.ceil(angle), 8, 64);
  const va = toVector(a);
  const vb = toVector(b);
  const v0 = before
    ? toVector(before)
    : sub(
        va.map((x) => 2 * x),
        vb,
      );
  const v3 = after
    ? toVector(after)
    : sub(
        vb.map((x) => 2 * x),
        va,
      );
  return catmullRom(v0, va, vb, v3, count).map((v, k, all) =>
    // The end is the control point exactly, not the round trip through a vector.
    k === all.length - 1 ? [b[0], b[1]] : toPosition(v),
  );
}

/**
 * The line of a path (`closed: false`) or a zone (`closed: true`) through its control points.
 *
 * Points equal to the one before (and for a zone, the last equal to the first) are set aside and
 * come back as zero-length segments in `spans`. One distinct point gives that point alone; two
 * give the straight line between them (for a zone, there and back), curved or not.
 */
export function outline(
  space: Space,
  points: Position[],
  options: { curve: boolean; closed: boolean },
): Outline {
  const n = points.length;
  const stored = options.closed ? n : Math.max(0, n - 1);
  if (n === 0) return { line: [], spans: [] };

  // The distinct points, and for each stored point the distinct one it stands at.
  const distinct: Position[] = [];
  const at: number[] = [];
  for (const p of points) {
    if (distinct.length === 0 || !same(distinct[distinct.length - 1]!, p)) distinct.push(p);
    at.push(distinct.length - 1);
  }
  let m = distinct.length;
  if (options.closed && m > 1 && same(distinct[m - 1]!, distinct[0]!)) {
    distinct.pop();
    // The points at the end that repeat the first now stand at `m`: the loop's close.
    m--;
  }
  if (m === 1) {
    const only = distinct[0]!;
    return { line: [[only[0], only[1]]], spans: new Array<number>(stored).fill(0) };
  }

  const closed = options.closed;
  const curve = options.curve && m >= 3;
  const segments = closed ? m : m - 1;
  const line: Position[] = [[distinct[0]![0], distinct[0]![1]]];
  /** Where each distinct point falls in `line`; for a loop, `m` is its closing end. */
  const starts: number[] = [0];
  for (let j = 0; j < segments; j++) {
    const a = distinct[j]!;
    const b = distinct[(j + 1) % m]!;
    const before = closed ? distinct[(j - 1 + m) % m]! : (distinct[j - 1] ?? null);
    const after = closed ? distinct[(j + 2) % m]! : (distinct[j + 2] ?? null);
    const samples = [a, ...segment(space, before, a, b, after, curve)];
    const stepped = densify(space, samples);
    for (const p of stepped.slice(1)) {
      if (space.kind === "sphere") {
        // Longitudes run on from the line so far, so it can be drawn as one.
        const previous = line[line.length - 1]!;
        let lon = p[0];
        while (lon - previous[0] > 180) lon -= 360;
        while (lon - previous[0] < -180) lon += 360;
        line.push([lon, p[1]]);
      } else {
        line.push(p);
      }
    }
    starts.push(line.length - 1);
  }

  // A stored segment starts where its first point stands; one of no length ends there too.
  const spans = Array.from({ length: stored }, (_, i) => starts[at[i]!]!);
  return { line, spans };
}

/** Where stored segment `i` of an outline ends in its line. */
export function spanEnd(o: Outline, i: number): number {
  return i + 1 < o.spans.length ? o.spans[i + 1]! : o.line.length - 1;
}

/**
 * The middle of stored segment `i` along the line as drawn: halfway along its run between its two
 * `spans` indices. On a sphere the longitude is brought into range. Null for a segment of no length.
 */
export function midpointOn(space: Space, o: Outline, i: number): Position | null {
  const from = o.spans[i];
  if (from === undefined) return null;
  const to = spanEnd(o, i);
  if (to <= from) return null;
  const run = o.line.slice(from, to + 1);
  const step = (a: Position, b: Position) =>
    space.kind === "sphere" ? geoDistance(a, b) : Math.hypot(b[0] - a[0], b[1] - a[1]);
  const lengths = run.slice(1).map((p, k) => step(run[k]!, p));
  const total = lengths.reduce((s, x) => s + x, 0);
  if (total === 0) return null;
  let left = total / 2;
  for (let k = 0; k < lengths.length; k++) {
    const d = lengths[k]!;
    if (left <= d) {
      const a = run[k]!;
      const b = run[k + 1]!;
      const s = d === 0 ? 0 : left / d;
      if (space.kind === "sphere") {
        const p = geoInterpolate(a, b)(s);
        return [wrapLongitude(p[0]), p[1]];
      }
      return [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s];
    }
    left -= d;
  }
  /* c8 ignore next */
  return run[run.length - 1]!;
}
