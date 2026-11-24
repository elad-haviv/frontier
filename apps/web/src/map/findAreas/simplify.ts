/** Fewer points for a traced outline: the pixel staircase smoothed, then Douglas–Peucker. */
import type { Px } from "./contour.ts";

/** One pass of 1-2-1 smoothing round a closed ring, which takes off the pixel staircase. */
export function smoothRing(p: readonly Px[]): Px[] {
  const n = p.length;
  return p.map((q, i) => {
    const a = p[(i - 1 + n) % n]!;
    const b = p[(i + 1) % n]!;
    return [(a[0] + 2 * q[0] + b[0]) / 4, (a[1] + 2 * q[1] + b[1]) / 4];
  });
}

/** How far a point is from the segment a–b. */
export function segmentDistance(p: Px, a: Px, b: Px): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/**
 * How far a point is from the edge between two kept points, as that edge is drawn. On a flat map
 * the edge is straight; on a globe it is a great circle, which `findAreas/frame.ts` measures.
 */
export type EdgeDistance = (p: Px, a: Px, b: Px) => number;

/**
 * Douglas–Peucker on a closed ring: it is split at the point farthest from the first, and each
 * half keeps the point farthest from its edge while that is more than `eps` away.
 */
export function simplifyRing(
  p: readonly Px[],
  eps: number,
  distance: EdgeDistance = segmentDistance,
): Px[] {
  const n = p.length;
  if (n < 5) return [...p];
  let far = 0;
  let farthest = -1;
  for (let i = 1; i < n; i++) {
    const d = Math.hypot(p[i]![0] - p[0]![0], p[i]![1] - p[0]![1]);
    if (d > farthest) {
      farthest = d;
      far = i;
    }
  }
  const keep = new Uint8Array(n + 1);
  keep[0] = keep[far] = keep[n] = 1;
  const at = (i: number) => p[i % n]!;
  const stack: [number, number][] = [
    [0, far],
    [far, n],
  ];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let most = -1;
    let at_ = -1;
    for (let i = a + 1; i < b; i++) {
      const d = distance(at(i), at(a), at(b));
      if (d > most) {
        most = d;
        at_ = i;
      }
    }
    if (most > eps) {
      keep[at_] = 1;
      stack.push([a, at_], [at_, b]);
    }
  }
  const out: Px[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(p[i]!);
  return out;
}

/** The Points slider's steps, fewer to more: how far, in pixels, an outline may stray. */
export const DETAIL_EPS = [7, 5, 3.8, 2.9, 2.2, 1.7, 1.3, 1, 0.75, 0.55] as const;
export const DEFAULT_DETAIL = 5;
