/**
 * Open lines as the tool finds them (a run of cells or pixels) made into a path's points: the
 * staircase smoothed away, evenly stepped, thinned. The app's curve passes through every stored
 * point, so thinning is the whole of the fit.
 */
import type { Px } from "../findAreas/contour.ts";
import { segmentDistance } from "../findAreas/simplify.ts";

/** Passes of 1-2-1 smoothing along an open line; both ends stay where they are. */
export function smoothOpen(p: readonly Px[], passes: number): Px[] {
  let a = [...p];
  for (let k = 0; k < passes; k++) {
    const n = a.length;
    const b = new Array<Px>(n);
    for (let i = 0; i < n; i++) {
      if (i === 0 || i === n - 1) b[i] = a[i]!;
      else {
        b[i] = [
          (a[i - 1]![0] + 2 * a[i]![0] + a[i + 1]![0]) / 4,
          (a[i - 1]![1] + 2 * a[i]![1] + a[i + 1]![1]) / 4,
        ];
      }
    }
    a = b;
  }
  return a;
}

/** The line stepped evenly, a point every `step`, with its two ends kept. */
export function resample(p: readonly Px[], step: number): Px[] {
  if (p.length === 0) return [];
  const out: Px[] = [p[0]!];
  let carry = 0;
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1]!;
    const b = p[i]!;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let t = step - carry;
    while (t <= l) {
      out.push([a[0] + ((b[0] - a[0]) * t) / l, a[1] + ((b[1] - a[1]) * t) / l]);
      t += step;
    }
    carry = l - (t - step);
  }
  const end = p[p.length - 1]!;
  const last = out[out.length - 1]!;
  if (Math.hypot(end[0] - last[0], end[1] - last[1]) > step * 0.15) out.push(end);
  else out[out.length - 1] = end;
  return out;
}

/** Douglas–Peucker on an open line: both ends are kept, and each point farther than `eps`. */
export function simplifyOpen(p: readonly Px[], eps: number): Px[] {
  const n = p.length;
  if (n < 3) return [...p];
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let far = -1;
    let most = eps;
    for (let i = a + 1; i < b; i++) {
      const d = segmentDistance(p[i]!, p[a]!, p[b]!);
      if (d > most) {
        most = d;
        far = i;
      }
    }
    if (far >= 0) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  const out: Px[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(p[i]!);
  return out;
}

export function lineLength(p: readonly Px[]): number {
  let s = 0;
  for (let i = 1; i < p.length; i++)
    s += Math.hypot(p[i]![0] - p[i - 1]![0], p[i]![1] - p[i - 1]![1]);
  return s;
}

/** The nearest point of a line to a point, and how far it is. */
export function nearestOn(p: Px, line: readonly Px[]): { at: Px; d: number } {
  let best: Px = line[0] ?? p;
  let bd = line.length ? Math.hypot(p[0] - best[0], p[1] - best[1]) : Infinity;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = dx * dx + dy * dy;
    const t = l ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l)) : 0;
    const q: Px = [a[0] + t * dx, a[1] + t * dy];
    const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (d < bd) {
      bd = d;
      best = q;
    }
  }
  return { at: best, d: bd };
}

/** A smooth wobble between -1 and 1 that is the same each time for the same place. */
function wobble(s: number, seed: number): number {
  return (
    0.6 * Math.sin(s / 9 + 2.1 * Math.sin(s / 41 + seed)) +
    0.4 * Math.sin(s / 4.3 + seed * 1.7 + 1.3 * Math.sin(s / 17 + seed * 0.6))
  );
}

/**
 * A river's winding: each point is moved sideways by a wobble of mixed wavelengths, more where
 * the ground is flat (`flatness` 0 to 1 at a point), tapering to nothing at both ends so the
 * source stays where it was clicked and the mouth where the water goes.
 */
export function meander(
  p: readonly Px[],
  amount: number,
  flatness: (at: Px) => number = () => 1,
): Px[] {
  const n = p.length;
  if (!amount || n < 5) return [...p];
  const total = lineLength(p);
  const seed = p[0]![0] * 0.13 + p[0]![1] * 0.07;
  const out = new Array<Px>(n);
  let s = 0;
  for (let i = 0; i < n; i++) {
    if (i) s += Math.hypot(p[i]![0] - p[i - 1]![0], p[i]![1] - p[i - 1]![1]);
    const a = p[Math.max(0, i - 2)]!;
    const b = p[Math.min(n - 1, i + 2)]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    const taper = Math.min(1, s / 14, (total - s) / 14);
    const off = amount * 0.8 * taper * (0.3 + 0.7 * flatness(p[i]!)) * wobble(s, seed);
    out[i] = [p[i]![0] - (dy / l) * off, p[i]![1] + (dx / l) * off];
  }
  return out;
}

/**
 * Two paths joined end to end, for "Add to": the added one is turned so that its nearer end
 * meets the nearer end of the first; where the two ends are the same place, it is kept once.
 */
export function joinLines(first: readonly Px[], added: readonly Px[]): Px[] {
  if (first.length === 0) return [...added];
  if (added.length === 0) return [...first];
  const d = (a: Px, b: Px) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const f0 = first[0]!;
  const f1 = first[first.length - 1]!;
  const a0 = added[0]!;
  const a1 = added[added.length - 1]!;
  const ways = [
    { d: d(f1, a0), line: () => [...first, ...added] },
    { d: d(f1, a1), line: () => [...first, ...[...added].reverse()] },
    { d: d(f0, a1), line: () => [...added, ...first] },
    { d: d(f0, a0), line: () => [...[...added].reverse(), ...first] },
  ];
  const best = ways.reduce((m, w) => (w.d < m.d ? w : m));
  const joined = best.line();
  return joined.filter((q, i) => i === 0 || d(q, joined[i - 1]!) > 1e-9);
}

/**
 * Whether a straight piece between two points may be part of the line: a route's grade along it
 * within its limit. What smoothing and thinning may not break.
 */
export type PieceOk = (a: Px, b: Px) => boolean;

/**
 * Smoothing that keeps a limit: as `smoothOpen`, but a point is moved only where both pieces it
 * then makes are still allowed; elsewhere it stays where it was found. A switchback's corners
 * are kept, since cutting them would make the climb steeper than the way can take.
 */
export function smoothWithin(p: readonly Px[], passes: number, ok: PieceOk): Px[] {
  let a = [...p];
  for (let k = 0; k < passes; k++) {
    const n = a.length;
    const b = new Array<Px>(n);
    for (let i = 0; i < n; i++) {
      if (i === 0 || i === n - 1) {
        b[i] = a[i]!;
        continue;
      }
      const moved: Px = [
        (a[i - 1]![0] + 2 * a[i]![0] + a[i + 1]![0]) / 4,
        (a[i - 1]![1] + 2 * a[i]![1] + a[i + 1]![1]) / 4,
      ];
      // The piece before is checked against where the last point ended up; the piece after
      // against the next point as it stands, which is checked again when that point moves.
      b[i] = ok(b[i - 1]!, moved) && ok(moved, a[i + 1]!) ? moved : a[i]!;
    }
    a = b;
  }
  return a;
}

/**
 * Douglas–Peucker that keeps a limit: a stretch is replaced by one straight piece only when that
 * piece is within `eps` of every point it stands for and is itself allowed. Otherwise the stretch
 * is split, at its farthest point, or at its middle when only the limit failed.
 */
export function simplifyWithin(p: readonly Px[], eps: number, ok: PieceOk): Px[] {
  const n = p.length;
  if (n < 3) return [...p];
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    if (b - a < 2) continue;
    let far = -1;
    let most = eps;
    for (let i = a + 1; i < b; i++) {
      const d = segmentDistance(p[i]!, p[a]!, p[b]!);
      if (d > most) {
        most = d;
        far = i;
      }
    }
    if (far < 0 && !ok(p[a]!, p[b]!)) far = (a + b) >> 1;
    if (far >= 0) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  const out: Px[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(p[i]!);
  return out;
}

/**
 * A way that branches from a line (a road), made to leave it smoothly: its first point stays on
 * the line, and the next follows the line's direction for `lead` before turning away, so the
 * branch does not stand out of the road as a hard spur. Points of the way within twice `lead` of
 * the branch point are let go for the lead-in.
 */
export function smoothBranch(way: readonly Px[], line: readonly Px[], lead: number): Px[] {
  if (way.length < 2 || line.length < 2 || lead <= 0) return [...way];
  const b = way[0]!;
  // The line's direction where the way leaves it.
  let best = 1;
  let bd = Infinity;
  for (let i = 1; i < line.length; i++) {
    const d = segmentDistance(b, line[i - 1]!, line[i]!);
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  const a0 = line[best - 1]!;
  const a1 = line[best]!;
  const l = Math.hypot(a1[0] - a0[0], a1[1] - a0[1]);
  if (!l) return [...way];
  let tx = (a1[0] - a0[0]) / l;
  let ty = (a1[1] - a0[1]) / l;
  const rest = way.findIndex((q) => Math.hypot(q[0] - b[0], q[1] - b[1]) >= 2 * lead);
  if (rest < 0) return [...way];
  const towards = way[rest]!;
  const ax = towards[0] - b[0];
  const ay = towards[1] - b[1];
  // Along the line the way it heads, and out to the side it leaves by.
  if (ax * tx + ay * ty < 0) {
    tx = -tx;
    ty = -ty;
  }
  const side = Math.sign(ax * -ty + ay * tx) || 1;
  const nx = -ty * side;
  const ny = tx * side;
  const lean: Px = [b[0] + tx * lead + nx * lead * 0.35, b[1] + ty * lead + ny * lead * 0.35];
  return [b, lean, ...way.slice(rest)];
}
