/**
 * Joins: a path that ends on another path (a tributary on a river, a side road on a road) stays
 * attached to it. The other path gets a corner at the meeting point, with exactly the joined
 * end's coordinates (on a curved path, on the curve as drawn), and the joined path remembers the
 * other's id on that end (`startOn`, `endOn`). After every change of the map `keepJoins` puts
 * each joined end back on its corner: moving the shared corner moves both paths, and reshaping or
 * moving the other path re-places the end. No path is ever split.
 *
 * A join is between the paths' first shapes (`points`); a later shape in time is left alone.
 */
import { outline, type Position, type Space } from "@frontier/geo";
import { type MapFeature, type MapFile, orderFeature } from "@frontier/schema";

export type PathFeature = Extract<MapFeature, { kind: "path" }>;
export type End = "start" | "end";
const KEY = { start: "startOn", end: "endOn" } as const;

const same = (a: Position, b: Position) => a[0] === b[0] && a[1] === b[1];
const far = (a: Position, b: Position) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const round = (p: Position): Position => [
  Math.round(p[0] * 1000) / 1000,
  Math.round(p[1] * 1000) / 1000,
];
const isPath = (f: MapFeature | undefined): f is PathFeature => f?.kind === "path";
const pathOf = (map: MapFile, id: string | null | undefined): PathFeature | undefined => {
  const f = id == null ? undefined : map.features.find((x) => x.id === id);
  return isPath(f) ? f : undefined;
};
export const endOf = (f: PathFeature, end: End): Position =>
  end === "start" ? f.points[0]! : f.points[f.points.length - 1]!;
const withEnd = (f: PathFeature, end: End, at: Position): PathFeature => ({
  ...f,
  points: f.points.map((p, i) => (i === (end === "start" ? 0 : f.points.length - 1) ? at : p)),
});
const withJoin = (f: PathFeature, end: End, on: string | null): PathFeature =>
  orderFeature({ ...f, [KEY[end]]: on }) as PathFeature;
const replace = (map: MapFile, next: readonly MapFeature[]): MapFile => {
  const by = new Map(next.map((f) => [f.id, f]));
  return { ...map, features: map.features.map((f) => by.get(f.id) ?? f) };
};

/** How near, in position units, counts as "on" a path: a fifty-thousandth of the map's size. */
export function joinReach(space: Space): number {
  return space.kind === "flat" ? Math.max(space.width, space.height) * 2e-5 : 2e-5;
}

/** The nearest point of a path as drawn, how far it is, and the stored segment it lies on. */
export function nearestOnPath(
  space: Space,
  path: PathFeature,
  at: Position,
): { at: Position; d: number; segment: number } {
  const o = outline(space, path.points, { curve: path.curve === "smooth", closed: false });
  let best: Position = o.line[0]!;
  let bd = Infinity;
  let bk = 0;
  for (let k = 1; k < o.line.length; k++) {
    const a = o.line[k - 1]!;
    const b = o.line[k]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = dx * dx + dy * dy;
    const t = l ? Math.max(0, Math.min(1, ((at[0] - a[0]) * dx + (at[1] - a[1]) * dy) / l)) : 0;
    const q: Position = [a[0] + t * dx, a[1] + t * dy];
    const d = far(at, q);
    if (d < bd) {
      bd = d;
      best = q;
      bk = k - 1;
    }
  }
  // The stored segment whose stretch of the drawn line holds that point.
  let segment = 0;
  for (let i = 0; i < o.spans.length; i++) if (o.spans[i]! <= bk) segment = i;
  return { at: best, d: bd, segment: Math.min(segment, path.points.length - 2) };
}

/**
 * A corner of `path` at the point of its drawn line nearest `at`: one that is already there
 * (within `reach`), or a new one put into the segment it lies on. The path is not split.
 */
export function cornerOn(
  space: Space,
  path: PathFeature,
  at: Position,
  reach: number,
): { path: PathFeature; at: Position } {
  const corner = path.points.find((p) => far(p, at) <= reach);
  if (corner) return { path, at: corner };
  const near = nearestOnPath(space, path, at);
  const there = path.points.find((p) => far(p, near.at) <= reach);
  if (there) return { path, at: there };
  const point = round(near.at);
  const points = [...path.points];
  points.splice(near.segment + 1, 0, point);
  return { path: { ...path, points }, at: point };
}

/**
 * Joins an end of a path onto another: the other gets a corner at the meeting point, the end is
 * put exactly on it, and the join is remembered. The same map comes back when either is missing.
 */
export function joinEnd(map: MapFile, space: Space, id: string, end: End, onto: string): MapFile {
  const path = pathOf(map, id);
  const other = pathOf(map, onto);
  if (!path || !other || id === onto) return map;
  const made = cornerOn(space, other, endOf(path, end), joinReach(space));
  return replace(map, [made.path, withJoin(withEnd(path, end, made.at), end, onto)]);
}

/**
 * A path just made: each of its ends that lies on another path (among `among`, when given) is
 * joined to it. An end that meets the very end of the other path is joined there as well: the two
 * then share that corner.
 */
export function joinNewPath(
  map: MapFile,
  space: Space,
  id: string,
  among?: ReadonlySet<string>,
): MapFile {
  let next = map;
  for (const end of ["start", "end"] as const) {
    const path = pathOf(next, id);
    if (!path || path[KEY[end]] != null) continue;
    const at = endOf(path, end);
    let best: { id: string; d: number } | null = null;
    for (const f of next.features) {
      if (!isPath(f) || f.id === id || (among && !among.has(f.id))) continue;
      const d = nearestOnPath(space, f, at).d;
      if (d <= joinReach(space) && (!best || d < best.d)) best = { id: f.id, d };
    }
    if (best) next = joinEnd(next, space, id, end, best.id);
  }
  return next;
}

/** The ends of other paths that are joined onto a path, each with the corner it shares. */
export function joinedTo(map: MapFile, id: string): { path: string; end: End; at: Position }[] {
  const out: { path: string; end: End; at: Position }[] = [];
  for (const f of map.features) {
    if (!isPath(f)) continue;
    for (const end of ["start", "end"] as const) {
      if (f[KEY[end]] === id) out.push({ path: f.id, end, at: endOf(f, end) });
    }
  }
  return out;
}

/**
 * Where two drawn lines cross, each crossing with the stored segment of each path it falls in.
 * Crossings at the very ends of `a` are left out: an end on the other path is a join.
 */
function crossings(
  space: Space,
  a: PathFeature,
  b: PathFeature,
): { at: Position; inA: number; inB: number }[] {
  const oa = outline(space, a.points, { curve: a.curve === "smooth", closed: false });
  const ob = outline(space, b.points, { curve: b.curve === "smooth", closed: false });
  const segmentOf = (spans: number[], k: number, most: number) => {
    let s = 0;
    for (let i = 0; i < spans.length; i++) if (spans[i]! <= k) s = i;
    return Math.min(s, most);
  };
  const out: { at: Position; inA: number; inB: number }[] = [];
  for (let i = 1; i < oa.line.length; i++) {
    const [p, p2] = [oa.line[i - 1]!, oa.line[i]!];
    for (let j = 1; j < ob.line.length; j++) {
      const [q, q2] = [ob.line[j - 1]!, ob.line[j]!];
      const rx = p2[0] - p[0];
      const ry = p2[1] - p[1];
      const sx = q2[0] - q[0];
      const sy = q2[1] - q[1];
      const cross = rx * sy - ry * sx;
      if (Math.abs(cross) < 1e-12) continue;
      const t = ((q[0] - p[0]) * sy - (q[1] - p[1]) * sx) / cross;
      const u = ((q[0] - p[0]) * ry - (q[1] - p[1]) * rx) / cross;
      if (t < 0 || t >= 1 || u < 0 || u >= 1) continue;
      out.push({
        at: [p[0] + t * rx, p[1] + t * ry],
        inA: segmentOf(oa.spans, i - 1, a.points.length - 2),
        inB: segmentOf(ob.spans, j - 1, b.points.length - 2),
      });
    }
  }
  const reach = joinReach(space) * 50;
  return out.filter((c) => far(c.at, a.points[0]!) > reach && far(c.at, endOf(a, "end")) > reach);
}

/**
 * Crossroads: where a path crosses others (among `among`) mid-way, both get a corner there with
 * the same coordinates. Neither is split. Returns the map and how many crossings were made.
 */
export function crossCorners(
  map: MapFile,
  space: Space,
  id: string,
  among: ReadonlySet<string>,
): { map: MapFile; count: number } {
  let next = map;
  let count = 0;
  for (const otherId of among) {
    if (otherId === id) continue;
    const a = pathOf(next, id);
    const b = pathOf(next, otherId);
    if (!a || !b) continue;
    // One at a time: a corner put in moves the segments' numbers.
    const found = crossings(space, a, b);
    let pa = a;
    let pb = b;
    for (const c of found) {
      const reach = joinReach(space) * 50;
      const inB = cornerOn(space, pb, c.at, reach);
      pb = inB.path;
      // The same coordinates in both.
      if (!pa.points.some((p) => same(p, inB.at))) {
        const near = nearestOnPath(space, pa, inB.at);
        const points = [...pa.points];
        points.splice(near.segment + 1, 0, inB.at);
        pa = { ...pa, points };
      }
      count++;
    }
    if (pa !== a || pb !== b) next = replace(next, [pa, pb]);
  }
  return { map: next, count };
}

/**
 * After a change: each joined end is put back on its corner. Where the corner moved, the end
 * follows; where the end moved, the corner follows (and with it any other end joined there);
 * where the other path was reshaped, the end is re-placed on it, at a corner. A join is let go
 * when its corner was deleted, when its own end point was deleted, or when the other path is gone.
 */
export function keepJoins(before: MapFile, after: MapFile, space: Space): MapFile {
  if (!after.features.some((f) => isPath(f) && (f.startOn != null || f.endOn != null))) {
    return after;
  }
  let next = after;
  // Twice: an end that moved its corner is followed, on the second pass, by the others on it.
  let from = before;
  for (let pass = 0; pass < 2; pass++) {
    const start = next;
    for (const listed of start.features) {
      for (const end of ["start", "end"] as const) {
        const a = pathOf(next, listed.id);
        const onto = a?.[KEY[end]];
        if (!a || onto == null) continue;
        const b = pathOf(next, onto);
        if (!b) {
          next = replace(next, [withJoin(a, end, null)]);
          continue;
        }
        const a0 = pathOf(from, a.id);
        const b0 = pathOf(from, b.id);
        const at = endOf(a, end);
        // A path that was just made, or just joined: its end is already where it belongs.
        if (!a0 || !b0 || a0[KEY[end]] !== onto) continue;
        const was = endOf(a0, end);
        const j = b0.points.findIndex((p) => same(p, was));
        if (a.points.length !== a0.points.length && !same(at, was)) {
          // Its own end point was taken away, or it was redrawn: no longer this join.
          next = replace(next, [withJoin(a, end, null)]);
          continue;
        }
        if (j >= 0 && b.points.length === b0.points.length) {
          const corner = b.points[j]!;
          if (same(corner, at)) continue;
          if (!same(corner, b0.points[j]!)) {
            next = replace(next, [withEnd(a, end, corner)]);
          } else {
            const points = b.points.map((p, i) => (i === j ? at : p));
            next = replace(next, [{ ...b, points }]);
          }
          continue;
        }
        if (b.points.some((p) => same(p, at))) continue;
        const deleted =
          j >= 0 &&
          b.points.length === b0.points.length - 1 &&
          b0.points.filter((_, i) => i !== j).every((p, i) => same(p, b.points[i]!));
        if (deleted) {
          next = replace(next, [withJoin(a, end, null)]);
          continue;
        }
        // The other path was reshaped: the end goes to the nearest place on it, at a corner.
        const made = cornerOn(space, b, at, joinReach(space));
        next = replace(next, [made.path, withEnd(a, end, made.at)]);
      }
    }
    if (next === start) break;
    from = start;
  }
  return next;
}
