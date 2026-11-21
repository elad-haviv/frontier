/**
 * Views: the only place that knows how a position becomes a point on the screen. Every tool works
 * through `project` and `unproject`, and so behaves the same in every view.
 */
import { geoOrthographic } from "d3-geo";
import { zoneOnPlate } from "./zone.js";
import {
  clipRing,
  cutRun,
  type Projected,
  type ProjectionId,
  projectedAt,
  projectedFrame,
} from "./projections.js";
import { clampLatitude, type Position, type Space, wrapLongitude } from "./space.js";

export type Point = [number, number];

/** What is kept in the address so a map reopens at the same place. */
export type ViewState =
  /** A flat map: the position at the centre of the screen, and screen pixels per map pixel. */
  | { kind: "flat"; x: number; y: number; k: number }
  /** A globe seen as a ball: the position facing the viewer, and the ball's radius in pixels. */
  | { kind: "globe"; lon: number; lat: number; k: number }
  /** A globe laid flat: the position at the centre, and screen pixels per degree. */
  | { kind: "plate"; lon: number; lat: number; k: number }
  /** A globe turned and laid flat in one of the projections. */
  | Projected;

export interface View {
  readonly state: ViewState;
  readonly width: number;
  readonly height: number;
  /** Where a position falls on the screen, or null when it is on the far side of the globe. */
  project(p: Position): Point | null;
  /** Like `project`, but a far-side position is put on the globe's edge instead of dropped. */
  projectClamped(p: Position): { point: Point; visible: boolean };
  /** The position under a point of the screen, or null when there is none. */
  unproject(x: number, y: number): Position | null;
  /**
   * Horizontal offsets at which the whole picture repeats. A globe laid flat repeats every 360
   * degrees, so that panning never reaches an edge; other views have the single offset 0.
   */
  repeats(): number[];
  /**
   * In a projected view only: the screen lines of a run of positions, cut at the map's edges, and
   * the rings that fill a zone. Other views leave these out.
   */
  lines?(points: Position[]): Point[][];
  rings?(points: Position[]): Point[][];
}

export function makeView(state: ViewState, width: number, height: number): View {
  const cx = width / 2;
  const cy = height / 2;

  if (state.kind === "flat") {
    const project = (p: Position): Point => [
      (p[0] - state.x) * state.k + cx,
      (p[1] - state.y) * state.k + cy,
    ];
    return {
      state,
      width,
      height,
      project,
      projectClamped: (p) => ({ point: project(p), visible: true }),
      unproject: (x, y) => [(x - cx) / state.k + state.x, (y - cy) / state.k + state.y],
      repeats: () => [0],
    };
  }

  if (state.kind === "projected") {
    const frame = projectedFrame(state, width, height);
    const project = (p: Position): Point => frame.toScreen(frame.turn(p));
    return {
      state,
      width,
      height,
      project,
      projectClamped: (p) => ({ point: project(p), visible: true }),
      unproject(x, y) {
        const t = frame.fromScreen(x, y);
        if (!t) return null;
        const p = frame.unturn(t);
        return [wrapLongitude(p[0]), clampLatitude(p[1])];
      },
      repeats: () => [0],
      lines: (points) =>
        cutRun(points.map(frame.turn), frame.cuts).map((run) => run.map(frame.toScreen)),
      rings(points) {
        // The zone is cut at the map's edge in the turned frame, carried along a pole it holds,
        // and cut again at each cut between lobes.
        let rings = zoneOnPlate(points.map(frame.turn), 0);
        for (const c of frame.cuts) {
          rings = rings.flatMap((r) => [clipRing(r, c, "west"), clipRing(r, c, "east")]);
        }
        return rings.filter((r) => r.length > 2).map((r) => r.map(frame.toScreen));
      },
    };
  }

  if (state.kind === "plate") {
    // Not wrapped: the renderer draws the picture at each repeat. Wrapping here would tear a
    // line or an image cell that crosses the edge.
    const project = (p: Position): Point => [
      (p[0] - state.lon) * state.k + cx,
      (state.lat - p[1]) * state.k + cy,
    ];
    return {
      state,
      width,
      height,
      project,
      projectClamped: (p) => ({ point: project(p), visible: true }),
      unproject(x, y) {
        const lat = state.lat - (y - cy) / state.k;
        if (lat > 90 || lat < -90) return null;
        return [wrapLongitude((x - cx) / state.k + state.lon), lat];
      },
      repeats() {
        const span = 360 * state.k;
        const out = [0];
        // Enough copies to cover the screen on both sides of the centre one.
        for (let n = 1; (n - 1) * span - span / 2 < cx + span; n++) out.push(n * span, -n * span);
        return out;
      },
    };
  }

  const projection = geoOrthographic()
    .rotate([-state.lon, -state.lat])
    .scale(state.k)
    .translate([cx, cy])
    .clipAngle(null);
  const rad = Math.PI / 180;
  const sin0 = Math.sin(state.lat * rad);
  const cos0 = Math.cos(state.lat * rad);
  /** Whether a position is on the half of the globe that faces the viewer. */
  const faces = (p: Position): boolean => {
    const lat = p[1] * rad;
    const dLon = (p[0] - state.lon) * rad;
    return sin0 * Math.sin(lat) + cos0 * Math.cos(lat) * Math.cos(dLon) >= 0;
  };
  const raw = (p: Position): Point => projection(p) as Point;

  return {
    state,
    width,
    height,
    project: (p) => (faces(p) ? raw(p) : null),
    projectClamped(p) {
      const point = raw(p);
      if (faces(p)) return { point, visible: true };
      // A far-side position projects inside the disc, mirrored. Push it out to the edge along
      // the same direction, so an image cell that straddles the edge ends there cleanly.
      const dx = point[0] - cx;
      const dy = point[1] - cy;
      const d = Math.hypot(dx, dy) || 1;
      return { point: [cx + (dx / d) * state.k, cy + (dy / d) * state.k], visible: false };
    },
    unproject(x, y) {
      if (Math.hypot(x - cx, y - cy) > state.k) return null;
      const p = projection.invert?.([x, y]);
      if (!p || Number.isNaN(p[0]) || Number.isNaN(p[1])) return null;
      return [wrapLongitude(p[0]), clampLatitude(p[1])];
    },
    repeats: () => [0],
  };
}

/** The view a map opens with: the whole of it, fitted to the screen. */
export function initialView(space: Space, width: number, height: number): ViewState {
  if (space.kind === "flat") {
    const k = Math.min(width / space.width, height / space.height) * 0.95;
    return { kind: "flat", x: space.width / 2, y: space.height / 2, k };
  }
  return { kind: "globe", lon: 0, lat: 0, k: (Math.min(width, height) / 2) * 0.9 };
}

const MIN_GLOBE = 40;

/** Moves the view by a drag of `dx`, `dy` screen pixels. */
export function panBy(state: ViewState, dx: number, dy: number): ViewState {
  if (state.kind === "projected") {
    // Sideways the globe turns about its axis, so a world map runs on without end; up and down
    // the drawing moves, within about its own height.
    const [l, f, g] = state.rotate;
    const lambda = ((((l + (dx * 180) / Math.PI / state.k + 180) % 360) + 360) % 360) - 180;
    const reach = state.k * Math.PI;
    return {
      ...state,
      rotate: [lambda, f, g],
      y: Math.max(-reach, Math.min(reach, state.y + dy)),
    };
  }
  if (state.kind === "flat") {
    return { ...state, x: state.x - dx / state.k, y: state.y - dy / state.k };
  }
  if (state.kind === "plate") {
    return {
      ...state,
      lon: wrapLongitude(state.lon - dx / state.k),
      lat: clampLatitude(state.lat + dy / state.k),
    };
  }
  // On the ball, a drag across one radius turns the globe by one radian. At the centre of the
  // disc the surface then follows the finger exactly.
  const deg = 180 / Math.PI / state.k;
  return {
    ...state,
    lon: wrapLongitude(state.lon - dx * deg),
    lat: clampLatitude(state.lat + dy * deg),
  };
}

/** Zooms by `factor` so that the position under the screen point `(x, y)` stays under it. */
export function zoomAt(
  state: ViewState,
  width: number,
  height: number,
  x: number,
  y: number,
  factor: number,
): ViewState {
  const max = state.kind === "flat" ? 64 : state.kind === "plate" ? 2000 : 200_000;
  const min = state.kind === "flat" ? 0.01 : state.kind === "plate" ? 0.3 : MIN_GLOBE;
  const k = Math.max(min, Math.min(max, state.k * factor));
  if (k === state.k) return state;
  if (state.kind === "projected") {
    // The drawing scales about the pointer: exact, and it needs no place under the pointer.
    const f = k / state.k;
    const px = x - width / 2;
    const py = y - height / 2;
    return { ...state, k, x: px - (px - state.x) * f, y: py - (py - state.y) * f };
  }
  // The globe zooms about its centre: it stays in the middle of the screen at every size.
  if (state.kind === "globe") return { ...state, k };
  const anchor = makeView(state, width, height).unproject(x, y);
  const next = { ...state, k };
  if (!anchor) return next;
  const moved = makeView(next, width, height).project(anchor)!;
  return panBy(next, x - moved[0], y - moved[1]);
}

/** Changes a globe between the ball and the flat view, keeping the centre and the apparent size. */
export function switchGlobeView(state: ViewState, to: "globe" | "plate"): ViewState {
  if (state.kind === "projected") {
    const centre: Position = [wrapLongitude(-state.rotate[0]), clampLatitude(-state.rotate[1])];
    return to === "plate"
      ? { kind: "plate", lon: centre[0], lat: centre[1], k: (state.k * Math.PI) / 180 }
      : { kind: "globe", lon: centre[0], lat: centre[1], k: Math.max(MIN_GLOBE, state.k) };
  }
  if (state.kind === "flat" || state.kind === to) return state;
  // One radian of the ball's surface at the centre is `k` pixels; a degree is that over 57.3.
  const perDegree = Math.PI / 180;
  return to === "plate"
    ? { kind: "plate", lon: state.lon, lat: state.lat, k: state.k * perDegree }
    : {
        kind: "globe",
        lon: state.lon,
        lat: state.lat,
        k: Math.max(MIN_GLOBE, state.k / perDegree),
      };
}

/** A view centred on a position, as when opening a map at one of its features. */
export function centreOn(state: ViewState, p: Position): ViewState {
  if (state.kind === "projected") {
    const frame = projectedFrame({ ...state, x: 0, y: 0 }, 0, 0);
    const at = frame.toScreen(frame.turn(p));
    return { ...state, x: -at[0], y: -at[1] };
  }
  return state.kind === "flat"
    ? { ...state, x: p[0], y: p[1] }
    : { ...state, lon: wrapLongitude(p[0]), lat: clampLatitude(p[1]) };
}

/**
 * A view of a sphere map in another way: the ball, the plain flat view, or a projection. The
 * place in the middle of the screen stays in the middle, at about the same size.
 */
export function switchView(
  state: ViewState,
  to: "globe" | "plate" | ProjectionId,
  width: number,
  height: number,
): ViewState {
  if (state.kind === "flat") return state;
  if (to === "globe" || to === "plate") {
    if (state.kind !== "projected") return switchGlobeView(state, to);
    const middle = makeView(state, width, height).unproject(width / 2, height / 2);
    const lon = middle?.[0] ?? -state.rotate[0];
    const lat = middle?.[1] ?? -state.rotate[1];
    return to === "plate"
      ? { kind: "plate", lon, lat, k: (state.k * Math.PI) / 180 }
      : { kind: "globe", lon, lat, k: Math.max(MIN_GLOBE, state.k) };
  }
  if (state.kind === "projected") {
    if (state.projection === to) return state;
    // Keep the turn and the scale; bring the same turned place back to the middle.
    const frame = projectedFrame(state, width, height);
    const middle = frame.fromScreen(width / 2, height / 2);
    const next: Projected = { ...state, projection: to, x: 0, y: 0 };
    if (!middle) return next;
    const at = projectedFrame(next, 0, 0).toScreen(middle);
    return { ...next, x: -at[0], y: -at[1] };
  }
  const k = state.kind === "plate" ? (state.k * 180) / Math.PI : state.k;
  return projectedAt(to, [state.lon, state.lat], k);
}

/** Sets the three angles of a projected view's turn, keeping its scale and place. */
export function turnTo(state: ViewState, rotate: [number, number, number]): ViewState {
  return state.kind === "projected" ? { ...state, rotate } : state;
}

/**
 * Focuses a projected view on a box drawn on the screen: the globe is turned so the box's middle
 * is in the middle of the screen, upright, and zoomed until the box fills nine tenths of it.
 * As map-reprojector does: the middle is the centroid of points sampled inside the box.
 */
export function focusOn(
  state: ViewState,
  width: number,
  height: number,
  box: [number, number, number, number],
): ViewState {
  if (state.kind !== "projected") return state;
  const view = makeView(state, width, height);
  const [x0, y0, x1, y1] = box;
  const samples: Position[] = [];
  const n = 8;
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n; j++) {
      const p = view.unproject(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * j) / n);
      if (p) samples.push(p);
    }
  }
  if (samples.length === 0) return state;
  // The centroid on the sphere, by adding the samples as unit vectors.
  const rad = Math.PI / 180;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const [lon, lat] of samples) {
    cx += Math.cos(lat * rad) * Math.cos(lon * rad);
    cy += Math.cos(lat * rad) * Math.sin(lon * rad);
    cz += Math.sin(lat * rad);
  }
  const lon = Math.atan2(cy, cx) / rad;
  const lat = Math.atan2(cz, Math.hypot(cx, cy)) / rad;
  let next: Projected = { ...state, rotate: [-lon, -lat, 0], x: 0, y: 0 };
  const seen = makeView(next, width, height);
  const points = samples.map((p) => seen.project(p)!);
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const bw = Math.max(1, Math.max(...xs) - Math.min(...xs));
  const bh = Math.max(1, Math.max(...ys) - Math.min(...ys));
  const f = 0.9 * Math.min(width / bw, height / bh);
  const k = Math.max(MIN_GLOBE, Math.min(200_000, next.k * f));
  const g = k / next.k;
  // Scale about the middle of the screen, then put the middle of the box there.
  const mx = (Math.max(...xs) + Math.min(...xs)) / 2 - width / 2;
  const my = (Math.max(...ys) + Math.min(...ys)) / 2 - height / 2;
  next = { ...next, k, x: -mx * g, y: -my * g };
  return next;
}
