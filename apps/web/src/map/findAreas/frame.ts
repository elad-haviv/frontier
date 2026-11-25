/**
 * Where the pixels of an image lie on the map. On a flat map a position is a pixel of the map's
 * first image, so an image's pixels map to positions linearly through its extent. On a globe an
 * image is an equirectangular plate: its columns are longitudes and its rows latitudes, through
 * the extent `[west, south, east, north]`. The tool looks at the plate in its own projection and
 * turns each traced point into longitude and latitude here.
 */
import type { Position } from "@frontier/geo";
import type { Px } from "./contour.ts";
import { segmentDistance } from "./simplify.ts";

export interface ImageFrame {
  /** `[left, top, right, bottom]` on a flat map, `[west, south, east, north]` on a globe. */
  extent: [number, number, number, number];
  sphere: boolean;
  /** The size of the picture the tool looks at, in its pixels. */
  w: number;
  h: number;
}

/** Whether a globe's image goes all the way round, so its left and right edges meet. */
export const goesRound = (f: ImageFrame): boolean =>
  f.sphere && f.extent[2] - f.extent[0] >= 359.999;

/**
 * The position of a point of the picture. Pixel (x, y) has its middle at (x, y), so the picture's
 * edge is at -0.5 and w - 0.5. A longitude is not wrapped here: an outline that crosses the 180th
 * meridian stays continuous until it is written (see `wrapRing`).
 */
export function toPosition(f: ImageFrame, [x, y]: Px): Position {
  const [x0, y0, x1, y1] = f.extent;
  const u = (x + 0.5) / f.w;
  const v = (y + 0.5) / f.h;
  if (!f.sphere) return [x0 + u * (x1 - x0), y0 + v * (y1 - y0)];
  return [x0 + u * (x1 - x0), Math.max(-90, Math.min(90, y1 - v * (y1 - y0)))];
}

/** The point of the picture at a position; the inverse of `toPosition`. */
export function toPx(f: ImageFrame, [a, b]: Position): Px {
  const [x0, y0, x1, y1] = f.extent;
  if (!f.sphere) return [((a - x0) / (x1 - x0)) * f.w - 0.5, ((b - y0) / (y1 - y0)) * f.h - 0.5];
  return [((a - x0) / (x1 - x0)) * f.w - 0.5, ((y1 - b) / (y1 - y0)) * f.h - 0.5];
}

/** The pixel under a position, or null when it is off the picture. */
export function pixelAt(f: ImageFrame, p: Position): [number, number] | null {
  let lon = p[0];
  if (f.sphere) {
    // A longitude may be given in any turn of the globe.
    while (lon < f.extent[0]) lon += 360;
    while (lon >= f.extent[0] + 360) lon -= 360;
  }
  const [x, y] = toPx(f, [lon, p[1]]);
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= f.w || py >= f.h) return null;
  return [px, py];
}

/** Pixels per degree of longitude on the plate, which is also the period of a round picture. */
const perDegree = (f: ImageFrame) => f.w / (f.extent[2] - f.extent[0]);

/**
 * A run of positions in picture pixels with no jump at the 180th meridian: each longitude is
 * taken within half a turn of the one before. On a flat map the points are converted as they are.
 */
export function ringToPx(f: ImageFrame, ring: readonly Position[]): Px[] {
  if (!f.sphere) return ring.map((p) => toPx(f, p));
  const out: Px[] = [];
  let last: number | null = null;
  for (const [lon0, lat] of ring) {
    let lon = lon0;
    if (last !== null) {
      while (lon - last > 180) lon -= 360;
      while (lon - last < -180) lon += 360;
    }
    last = lon;
    out.push(toPx(f, [lon, lat]));
  }
  return out;
}

/**
 * Moves a run of picture points by whole turns of the globe so that its middle is within half a
 * turn of the column `near`. Nothing moves on a flat map or on a picture that does not go round.
 */
export function shiftNear(f: ImageFrame, ring: Px[], near: number): Px[] {
  if (!goesRound(f) || ring.length === 0) return ring;
  const turn = 360 * perDegree(f);
  const mid = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const k = Math.round((near - mid) / turn);
  return k === 0 ? ring : ring.map(([x, y]) => [x + k * turn, y]);
}

const RAD = Math.PI / 180;
type Vec = [number, number, number];
const toVec = ([lon, lat]: Position): Vec => [
  Math.cos(lat * RAD) * Math.cos(lon * RAD),
  Math.cos(lat * RAD) * Math.sin(lon * RAD),
  Math.sin(lat * RAD),
];

/**
 * Points along the great circle from `a` to `b` (positions), `steps` segments, each longitude
 * kept within half a turn of the one before so the run has no jump.
 */
export function greatCircle(a: Position, b: Position, steps: number): Position[] {
  const va = toVec(a);
  const vb = toVec(b);
  const dot = Math.max(-1, Math.min(1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]));
  const angle = Math.acos(dot);
  const out: Position[] = [a];
  let last = a[0];
  for (let s = 1; s < steps; s++) {
    const t = s / steps;
    let v: Vec;
    if (angle < 1e-9) v = va;
    else {
      const ka = Math.sin((1 - t) * angle) / Math.sin(angle);
      const kb = Math.sin(t * angle) / Math.sin(angle);
      v = [ka * va[0] + kb * vb[0], ka * va[1] + kb * vb[1], ka * va[2] + kb * vb[2]];
    }
    const lat = Math.atan2(v[2], Math.hypot(v[0], v[1])) / RAD;
    // At a pole the longitude means nothing: the last one is kept.
    let lon = Math.hypot(v[0], v[1]) < 1e-12 ? last : Math.atan2(v[1], v[0]) / RAD;
    while (lon - last > 180) lon -= 360;
    while (lon - last < -180) lon += 360;
    last = lon;
    out.push([lon, lat]);
  }
  let end = b[0];
  while (end - last > 180) end -= 360;
  while (end - last < -180) end += 360;
  out.push([end, b[1]]);
  return out;
}

/** The angle between two positions, in degrees. */
export function arcDegrees(a: Position, b: Position): number {
  const va = toVec(a);
  const vb = toVec(b);
  const dot = Math.max(-1, Math.min(1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]));
  return Math.acos(dot) / RAD;
}

/**
 * How far a point of the picture is from the edge between two others as a globe draws it: along
 * the great circle, which on the plate bends towards the pole. On a flat map, straight.
 */
export function edgeDistance(f: ImageFrame): (p: Px, a: Px, b: Px) => number {
  if (!f.sphere) return segmentDistance;
  return (p, a, b) => {
    const pa = toPosition(f, a);
    const pb = toPosition(f, b);
    const steps = Math.max(1, Math.min(24, Math.ceil(arcDegrees(pa, pb) / 0.5)));
    if (steps === 1) return segmentDistance(p, a, b);
    // The arc on the plate, kept beside `a` (both are in the same unwrapped run).
    const arc = greatCircle(pa, pb, steps).map((q) => toPx(f, q));
    let best = Number.POSITIVE_INFINITY;
    for (let i = 1; i < arc.length; i++)
      best = Math.min(best, segmentDistance(p, arc[i - 1]!, arc[i]!));
    return best;
  };
}

/**
 * A traced ring as the zone's positions. Longitudes are brought onto the globe; a run of points
 * on a pole is one point there, since they are all the same place.
 */
export function wrapRing(f: ImageFrame, ring: readonly Position[]): Position[] {
  if (!f.sphere) return [...ring];
  const out: Position[] = [];
  for (const [lon, lat] of ring) {
    const pole = Math.abs(lat) >= 90 - 1e-9;
    const last = out[out.length - 1];
    if (pole && last && Math.abs(last[1]) >= 90 - 1e-9 && Math.sign(last[1]) === Math.sign(lat)) {
      continue;
    }
    // A longitude already on the globe is kept as it is: a corner shared with a neighbour must
    // stay exactly the neighbour's.
    out.push([lon < -180 || lon > 180 ? ((((lon + 180) % 360) + 360) % 360) - 180 : lon, lat]);
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (out.length > 1 && first && last && Math.abs(first[1]) >= 90 - 1e-9 && first[1] === last[1]) {
    out.pop();
  }
  return out;
}
