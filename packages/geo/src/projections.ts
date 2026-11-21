/**
 * Ways of laying a globe flat, as in the author's map-reprojector: d3's projections, with the
 * globe turned about three axes first.
 *
 * Everything is worked in the **turned frame**: the globe after the turn, where the map's own
 * edge is the meridian ±180 and the cut between the hemispheres is the meridian 0. Lines, zones
 * and image cells are cut there before they are projected, so nothing is ever stretched across
 * the map; d3's own cutting is not relied on, since its interrupted projections do not cut at
 * their lobes.
 */
import {
  geoEquirectangular,
  geoMercator,
  geoNaturalEarth1,
  type GeoProjection,
  geoRotation,
} from "d3-geo";
import {
  geoFahey,
  geoInterruptedMollweideHemispheres,
  geoMollweide,
  geoRobinson,
  geoWinkel3,
} from "d3-geo-projection";
import type { Position } from "./space.js";

export const PROJECTIONS = [
  { id: "mercator", name: "Mercator", make: geoMercator, lat: 85.0511, cuts: [] },
  { id: "equirectangular", name: "Equirectangular", make: geoEquirectangular, lat: 90, cuts: [] },
  { id: "robinson", name: "Robinson", make: geoRobinson, lat: 90, cuts: [] },
  { id: "winkel3", name: "Winkel Tripel", make: geoWinkel3, lat: 90, cuts: [] },
  { id: "mollweide", name: "Mollweide", make: geoMollweide, lat: 90, cuts: [] },
  { id: "naturalEarth", name: "Natural Earth", make: geoNaturalEarth1, lat: 90, cuts: [] },
  { id: "fahey", name: "Fahey", make: geoFahey, lat: 90, cuts: [] },
  {
    id: "hemispheres",
    name: "Two hemispheres",
    make: geoInterruptedMollweideHemispheres,
    lat: 90,
    cuts: [0],
  },
] as const satisfies readonly {
  id: string;
  name: string;
  make: () => GeoProjection;
  lat: number;
  cuts: readonly number[];
}[];

export type ProjectionId = (typeof PROJECTIONS)[number]["id"];

export const isProjectionId = (id: string): id is ProjectionId =>
  PROJECTIONS.some((p) => p.id === id);

/** A globe laid flat: the projection, the turn, the scale and how far the drawing is moved. */
export interface Projected {
  kind: "projected";
  projection: ProjectionId;
  /** d3's `[λ, φ, γ]` in degrees. */
  rotate: [number, number, number];
  /** Pixels per radian, as d3's scale. */
  k: number;
  /** How far the drawing is moved from the middle of the screen, in pixels. */
  x: number;
  y: number;
}

const unitCache = new Map<ProjectionId, GeoProjection>();
/** The projection without a turn, at scale 1, centred on 0: turned positions to plain units. */
export function unitProjection(id: ProjectionId): GeoProjection {
  let p = unitCache.get(id);
  if (!p) {
    const info = PROJECTIONS.find((q) => q.id === id) ?? PROJECTIONS[0];
    p = info.make().rotate([0, 0, 0]).scale(1).translate([0, 0]);
    // Each projection's own default centre, such as the hemispheres' turn, is undone.
    p.center([0, 0]);
    unitCache.set(id, p);
  }
  return p;
}

/** The d3 projection for drawing: no turn, at the view's scale and place on the screen. */
export function drawingProjection(state: Projected, width: number, height: number): GeoProjection {
  const info = PROJECTIONS.find((q) => q.id === state.projection) ?? PROJECTIONS[0];
  return info
    .make()
    .rotate([0, 0, 0])
    .center([0, 0])
    .scale(state.k)
    .translate([width / 2 + state.x, height / 2 + state.y]);
}

const EPSILON = 1e-6;

/** Everything a view needs to draw and read positions in a projection. */
export interface Frame {
  readonly latLimit: number;
  /** Meridians of the turned frame where the map is cut, besides ±180. */
  readonly cuts: readonly number[];
  /** Original position to turned position. */
  turn(p: Position): Position;
  /** Turned position to original position. */
  unturn(t: Position): Position;
  /** A turned position on the screen. */
  toScreen(t: Position): [number, number];
  /** The turned position under a point of the screen, or null where the map is not. */
  fromScreen(x: number, y: number): Position | null;
}

export function projectedFrame(state: Projected, width: number, height: number): Frame {
  const info = PROJECTIONS.find((q) => q.id === state.projection) ?? PROJECTIONS[0];
  const unit = unitProjection(info.id);
  const rotation = geoRotation(state.rotate);
  const ox = width / 2 + state.x;
  const oy = height / 2 + state.y;
  const latLimit = info.lat;
  const clampLat = (t: Position): Position => [t[0], Math.max(-latLimit, Math.min(latLimit, t[1]))];
  const toScreen = (t: Position): [number, number] => {
    const u = unit(clampLat(t)) ?? [0, 0];
    return [ox + u[0] * state.k, oy + u[1] * state.k];
  };
  return {
    latLimit,
    cuts: info.cuts,
    turn: (p) => rotation(p) as Position,
    unturn: (t) => rotation.invert(t) as Position,
    toScreen,
    fromScreen(x, y) {
      const t = unit.invert?.([(x - ox) / state.k, (y - oy) / state.k]);
      if (!t || !Number.isFinite(t[0]) || !Number.isFinite(t[1])) return null;
      if (Math.abs(t[1]) > latLimit + EPSILON || Math.abs(t[0]) > 180 + EPSILON) return null;
      // Iterative inverses wander off near the edge, and some return a place for a point that is
      // off the map: what does not come back to the same pixel is not under it.
      const back = toScreen(t as Position);
      if (Math.hypot(back[0] - x, back[1] - y) > 1) return null;
      return t as Position;
    },
  };
}

/** Which piece of the turned frame a longitude is in: between ±180 and the cuts. */
function pieceOf(lon: number, cuts: readonly number[]): number {
  let n = 0;
  for (const c of cuts) if (lon >= c) n += 1;
  return n;
}

/**
 * A run of turned positions cut wherever it crosses the map's edge or a cut, with a point placed
 * on each side of the crossing so the pieces reach the edge.
 */
export function cutRun(turned: Position[], cuts: readonly number[]): Position[][] {
  const out: Position[][] = [];
  let run: Position[] = [];
  for (let i = 0; i < turned.length; i++) {
    const p = turned[i]!;
    const prev = turned[i - 1];
    if (prev) {
      let lon = p[0];
      // Crossing ±180: unwrap so the step is short, and cut at the edge.
      if (lon - prev[0] > 180) lon -= 360;
      else if (lon - prev[0] < -180) lon += 360;
      if (lon !== p[0]) {
        const edge = lon > prev[0] ? 180 : -180;
        const t = (edge - prev[0]) / (lon - prev[0]);
        const lat = prev[1] + (p[1] - prev[1]) * t;
        run.push([edge - Math.sign(edge) * EPSILON, lat]);
        out.push(run);
        run = [[-edge + Math.sign(edge) * EPSILON, lat]];
      } else if (pieceOf(prev[0], cuts) !== pieceOf(p[0], cuts)) {
        for (const c of cuts) {
          if (prev[0] < c === p[0] < c) continue;
          const t = (c - prev[0]) / (p[0] - prev[0]);
          const lat = prev[1] + (p[1] - prev[1]) * t;
          const before = prev[0] < c ? -EPSILON : EPSILON;
          run.push([c + before, lat]);
          out.push(run);
          run = [[c - before, lat]];
        }
      }
    }
    run.push(p);
  }
  if (run.length) out.push(run);
  return out.filter((r) => r.length > 1);
}

/** A ring cut to one side of a meridian: Sutherland and Hodgman on the plane of the turned frame. */
export function clipRing(ring: Position[], cut: number, keep: "west" | "east"): Position[] {
  const inside = (p: Position) => (keep === "west" ? p[0] <= cut : p[0] >= cut);
  const out: Position[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    if (inside(a)) out.push(a);
    if (inside(a) !== inside(b)) {
      const t = (cut - a[0]) / (b[0] - a[0]);
      const at = keep === "west" ? cut - EPSILON : cut + EPSILON;
      out.push([at, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

/** The view a globe opens with when laid flat in a projection, centred on a position. */
export function projectedAt(
  projection: ProjectionId,
  centre: Position,
  k: number,
  gamma = 0,
): Projected {
  const state: Projected = {
    kind: "projected",
    projection,
    rotate: [-centre[0], 0, gamma],
    k,
    x: 0,
    y: 0,
  };
  // The latitude asked for is brought to the middle by moving the drawing, not by tilting it.
  const info = PROJECTIONS.find((q) => q.id === projection) ?? PROJECTIONS[0];
  const lat = Math.max(-info.lat, Math.min(info.lat, centre[1]));
  const u = unitProjection(projection)([0, lat]) ?? [0, 0];
  return { ...state, x: -u[0] * k, y: -u[1] * k };
}
