import type { Range, SpanPoints } from "@frontier/time";

/*
 * What is left of the stage 5 scale view: the years a chronicle covers and a round ruler step.
 * The timeline (stage 17) and the map's time bar both use them.
 */

const finite = (r: Range | null): r is Range =>
  r !== null && Number.isFinite(r.lo) && Number.isFinite(r.hi);

/** The earliest and latest year any placed point may be, or null when nothing is placed. */
export function scaleBounds(points: Iterable<SpanPoints>): Range | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of points) {
    for (const r of [p.start, p.end]) {
      if (!finite(r)) continue;
      lo = Math.min(lo, r.lo);
      hi = Math.max(hi, r.hi);
    }
  }
  return lo <= hi ? { lo, hi } : null;
}

/** A round step in years so that marks are at least `least` years apart: 1, 2 or 5 times ten. */
export function rulerStep(least: number): number {
  const power = 10 ** Math.floor(Math.log10(Math.max(least, 1e-9)));
  for (const m of [1, 2, 5, 10]) if (m * power >= least) return Math.max(1, m * power);
  return Math.max(1, 10 * power);
}
