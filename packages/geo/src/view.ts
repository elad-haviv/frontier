/**
 * Views: the only place that knows how a position becomes a point on the screen. Every tool works
 * through `project` and `unproject`, and so behaves the same in every view.
 */
import { geoOrthographic } from "d3-geo";
import { clampLatitude, type Position, type Space, wrapLongitude } from "./space.js";

export type Point = [number, number];

/** What is kept in the address so a map reopens at the same place. */
export type ViewState =
  /** A flat map: the position at the centre of the screen, and screen pixels per map pixel. */
  | { kind: "flat"; x: number; y: number; k: number }
  /** A globe seen as a ball: the position facing the viewer, and the ball's radius in pixels. */
  | { kind: "globe"; lon: number; lat: number; k: number }
  /** A globe laid flat: the position at the centre, and screen pixels per degree. */
  | { kind: "plate"; lon: number; lat: number; k: number };

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
  return state.kind === "flat"
    ? { ...state, x: p[0], y: p[1] }
    : { ...state, lon: wrapLongitude(p[0]), lat: clampLatitude(p[1]) };
}
