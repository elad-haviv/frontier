/**
 * Snapping a found outline to the zones beside it, so that two zones share one border point for
 * point: each corner within reach of another zone's corner lands on it (at that corner's own
 * position, exactly), else within reach of its edge, on the edge; and between two corners that
 * landed on the same zone, that zone's own corners are put in, when they lie along the way.
 */
import type { Position } from "@frontier/geo";
import type { Px } from "./contour.ts";
import { segmentDistance } from "./simplify.ts";

/** Another zone's outline: its positions, and the same in the picture's pixels. */
export interface SnapTarget {
  points: Position[];
  px: Px[];
}

/** A corner of the snapped outline; `at` is set when it is another zone's corner, exactly. */
export interface Corner {
  px: Px;
  at?: Position;
}

interface Hit {
  target: number;
  /** Where along the target's ring: corner index plus the fraction of the way to the next. */
  along: number;
  px: Px;
  at?: Position;
}

/** How near, in the picture's pixels, a corner must be to snap; an edge is snapped at 3/4 of it. */
export const SNAP_PX = 5;

export function snapRing(
  ring: readonly Px[],
  targets: readonly SnapTarget[],
  reach = SNAP_PX,
  eps = 1.5,
): Corner[] {
  if (ring.length === 0) return [];
  // Only targets near the ring's box are looked at.
  let [bx0, by0, bx1, by1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of ring) {
    bx0 = Math.min(bx0, x);
    by0 = Math.min(by0, y);
    bx1 = Math.max(bx1, x);
    by1 = Math.max(by1, y);
  }
  const near = targets.filter((t) =>
    t.px.some(
      ([x, y]) => x >= bx0 - reach && x <= bx1 + reach && y >= by0 - reach && y <= by1 + reach,
    ),
  );
  if (near.length === 0) return ring.map((px) => ({ px }));

  const hits: (Hit | null)[] = ring.map((p) => {
    let best: Hit | null = null;
    let bd = reach;
    for (let ti = 0; ti < near.length; ti++) {
      const t = near[ti]!;
      for (let qi = 0; qi < t.px.length; qi++) {
        const q = t.px[qi]!;
        const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (d < bd) {
          bd = d;
          best = { target: ti, along: qi, px: q, at: t.points[qi]! };
        }
      }
    }
    if (best) return best;
    bd = reach * 0.75;
    for (let ti = 0; ti < near.length; ti++) {
      const t = near[ti]!;
      for (let qi = 0; qi < t.px.length; qi++) {
        const q = t.px[qi]!;
        const r = t.px[(qi + 1) % t.px.length]!;
        const d = segmentDistance(p, q, r);
        if (d < bd) {
          const dx = r[0] - q[0];
          const dy = r[1] - q[1];
          const l = dx * dx + dy * dy || 1;
          const u = Math.max(0, Math.min(1, ((p[0] - q[0]) * dx + (p[1] - q[1]) * dy) / l));
          bd = d;
          best = { target: ti, along: qi + u, px: [q[0] + u * dx, q[1] + u * dy] };
        }
      }
    }
    return best;
  });

  const out: Corner[] = [];
  const n = ring.length;
  for (let k = 0; k < n; k++) {
    const a = hits[k];
    const b = hits[(k + 1) % n];
    const p = a ? a.px : ring[k]!;
    out.push(a?.at ? { px: p, at: a.at } : { px: p });
    if (!a || !b || a.target !== b.target || Math.abs(a.along - b.along) < 1e-6) continue;
    // The target's own corners between the two, the shorter way round.
    const t = near[a.target]!;
    const m = t.px.length;
    const fwdOf = (v: number) => (((v - a.along) % m) + m) % m;
    const bwdOf = (v: number) => (((a.along - v) % m) + m) % m;
    const fwd: number[] = [];
    const bwd: number[] = [];
    for (
      let j = Math.floor(a.along) + 1, c = 0;
      c < m && fwdOf(j) < fwdOf(b.along) - 1e-6;
      j++, c++
    ) {
      if (fwdOf(j) > 1e-6) fwd.push(((j % m) + m) % m);
    }
    for (
      let j = Math.ceil(a.along) - 1, c = 0;
      c < m && bwdOf(j) < bwdOf(b.along) - 1e-6;
      j--, c++
    ) {
      if (bwdOf(j) > 1e-6) bwd.push(((j % m) + m) % m);
    }
    const path = fwd.length <= bwd.length ? fwd : bwd;
    const q = b.px;
    const limit = Math.max(6, eps * 2 + reach);
    if (
      path.length &&
      path.length < m / 2 &&
      path.every((i) => segmentDistance(t.px[i]!, p, q) <= limit)
    ) {
      for (const i of path) out.push({ px: t.px[i]!, at: t.points[i]! });
    }
  }
  // Two corners on the same spot are one.
  return out.filter((c, i) => {
    const prev = out[(i - 1 + out.length) % out.length]!;
    return i === 0 || Math.hypot(c.px[0] - prev.px[0], c.px[1] - prev.px[1]) > 0.05;
  });
}
