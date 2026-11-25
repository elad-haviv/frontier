/**
 * Plain geometry on a flat map's lines, for finding points of interest: where two lines cross,
 * the nearest place on a line, a point a given length along it, and whether a point is inside a
 * ring. Positions are the map's own units.
 */
import type { Position } from "@frontier/geo";

export interface OnLine {
  /** The nearest place on the line. */
  at: Position;
  /** How far from it the point is. */
  d: number;
  /** How far along the line that place is. */
  s: number;
}

/** The nearest place on a line to a point, how far that is, and how far along the line. */
export function project(p: Position, line: readonly Position[]): OnLine {
  let best: OnLine = { at: line[0]!, d: Infinity, s: 0 };
  let s = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    const l = Math.sqrt(l2);
    const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
    const q: Position = [a[0] + dx * t, a[1] + dy * t];
    const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (d < best.d) best = { at: q, d, s: s + l * t };
    s += l;
  }
  return best;
}

export function lengthOf(line: readonly Position[]): number {
  let s = 0;
  for (let i = 1; i < line.length; i++) {
    s += Math.hypot(line[i]![0] - line[i - 1]![0], line[i]![1] - line[i - 1]![1]);
  }
  return s;
}

/** The place a length along a line; its end when the line is shorter. */
export function pointAt(line: readonly Position[], s: number): Position {
  let acc = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (acc + l >= s) {
      const t = l ? Math.max(0, (s - acc) / l) : 0;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    acc += l;
  }
  const end = line[line.length - 1]!;
  return [end[0], end[1]];
}

/** The line as points about `step` apart, its ends kept. */
export function resample(line: readonly Position[], step: number): Position[] {
  if (line.length < 2 || step <= 0) return line.map((p) => [p[0], p[1]]);
  const out: Position[] = [[line[0]![0], line[0]![1]]];
  let carry = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let at = step - carry;
    while (at <= l) {
      const t = at / l;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      at += step;
    }
    carry = l - (at - step);
  }
  const last = line[line.length - 1]!;
  const end = out[out.length - 1]!;
  if (end[0] !== last[0] || end[1] !== last[1]) out.push([last[0], last[1]]);
  return out;
}

function segmentsCross(a: Position, b: Position, c: Position, d: Position): Position | null {
  const r = [b[0] - a[0], b[1] - a[1]];
  const s = [d[0] - c[0], d[1] - c[1]];
  const den = r[0]! * s[1]! - r[1]! * s[0]!;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((c[0] - a[0]) * s[1]! - (c[1] - a[1]) * s[0]!) / den;
  const u = ((c[0] - a[0]) * r[1]! - (c[1] - a[1]) * r[0]!) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [a[0] + r[0]! * t, a[1] + r[1]! * t] : null;
}

/**
 * Where two lines cross: one point for each crossing, with crossings closer than `apart` taken
 * as one (two lines that share a corner cross at it on both of its segments).
 */
export function crossings(A: readonly Position[], B: readonly Position[], apart: number): Position[] {
  const out: Position[] = [];
  for (let i = 1; i < A.length; i++) {
    const a = A[i - 1]!;
    const b = A[i]!;
    const [x0, x1] = a[0] < b[0] ? [a[0], b[0]] : [b[0], a[0]];
    const [y0, y1] = a[1] < b[1] ? [a[1], b[1]] : [b[1], a[1]];
    for (let j = 1; j < B.length; j++) {
      const c = B[j - 1]!;
      const d = B[j]!;
      if (Math.max(c[0], d[0]) < x0 || Math.min(c[0], d[0]) > x1) continue;
      if (Math.max(c[1], d[1]) < y0 || Math.min(c[1], d[1]) > y1) continue;
      const x = segmentsCross(a, b, c, d);
      if (x && !out.some((o) => Math.hypot(o[0] - x[0], o[1] - x[1]) < apart)) out.push(x);
    }
  }
  return out;
}

/** Whether a point is inside a ring, by counting crossings. */
export function inRing(p: Position, ring: readonly Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export const apartOf = (a: Position, b: Position): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** A compass word for the way from one place to another on a flat map, where y grows down. */
export function compass(from: Position, to: Position): string {
  const dx = to[0] - from[0];
  const north = from[1] - to[1];
  if (Math.hypot(dx, north) === 0) return "here";
  const words = [
    "east",
    "north-east",
    "north",
    "north-west",
    "west",
    "south-west",
    "south",
    "south-east",
  ];
  return words[Math.round((Math.atan2(north, dx) / Math.PI) * 4 + 8) % 8]!;
}
