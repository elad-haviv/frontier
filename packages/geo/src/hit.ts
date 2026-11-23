/** Finding what lies under a point of the screen. All in screen pixels. */
import type { Point } from "./view.js";

export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length2 = dx * dx + dy * dy;
  const t =
    length2 === 0
      ? 0
      : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

export function pointInPolygon(p: Point, ring: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    ) {
      inside = !inside;
    }
  }
  return inside;
}

export type Shape =
  | { id: string; kind: "marker"; at: Point }
  | { id: string; kind: "path"; points: Point[] }
  | {
      id: string;
      kind: "zone";
      points: Point[];
      /**
       * Whether a point of the screen is inside, when that is not simply inside `points`: on a
       * globe, a zone is found by what is filled, which is cut at the edge of the disc.
       */
      inside?: (p: Point) => boolean;
    };

/**
 * The shape under a point. Markers win over paths, and paths over zones, because the smaller
 * target would otherwise be unreachable under the larger. Among equals the last drawn wins.
 */
export function shapeAt(shapes: Shape[], p: Point, reach = 22): string | null {
  let marker: { id: string; d: number } | null = null;
  let path: { id: string; d: number } | null = null;
  let zone: string | null = null;
  for (const s of shapes) {
    if (s.kind === "marker") {
      const d = Math.hypot(p[0] - s.at[0], p[1] - s.at[1]);
      if (d <= reach && (!marker || d <= marker.d)) marker = { id: s.id, d };
    } else if (s.kind === "path") {
      for (let i = 1; i < s.points.length; i++) {
        const d = distanceToSegment(p, s.points[i - 1]!, s.points[i]!);
        if (d <= reach / 2 && (!path || d <= path.d)) path = { id: s.id, d };
      }
    } else if (s.inside ? s.inside(p) : s.points.length >= 3 && pointInPolygon(p, s.points)) {
      zone = s.id;
    }
  }
  return marker?.id ?? path?.id ?? zone;
}

/** The nearest of some handles within reach of a point, or null: a corner, or a "+". */
export function handleAt(handles: Point[], p: Point, reach: number): number | null {
  let best: { i: number; d: number } | null = null;
  handles.forEach((q, i) => {
    const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (d <= reach && (!best || d < best.d)) best = { i, d };
  });
  return best === null ? null : (best as { i: number }).i;
}

/** How far from a corner, or a "+", a press still finds it. */
export const HANDLE_REACH = 18;

/** The corner of a shape within reach of a point, for dragging it. */
export function vertexAt(points: Point[], p: Point, reach = HANDLE_REACH): number | null {
  return handleAt(points, p, reach);
}
