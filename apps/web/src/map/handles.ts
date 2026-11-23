/**
 * The line a feature is drawn along, and the "+" handles of the selected path or zone: one at the
 * middle of each segment, on the line as drawn. The overlay draws them and `pick` finds them from
 * this one place, so what is seen is what a press finds.
 */
import {
  midpointOn,
  type Outline,
  outline,
  type Point,
  type Position,
  type Space,
  type View,
} from "@frontier/geo";
import type { MapFeature } from "@frontier/schema";
import type { PointerKind } from "./gesture.ts";

type Lined = Extract<MapFeature, { kind: "path" | "zone" }>;

/** Whether a path or zone is drawn as a curve through its points. */
export const isCurved = (f: MapFeature): boolean =>
  f.kind !== "marker" && (f as { curve?: string }).curve === "smooth";

/** The outline of a path or a zone, with the shape it has in `points`. */
export function outlineOf(space: Space, f: Lined): Outline {
  return outline(space, f.points, { curve: isCurved(f), closed: f.kind === "zone" });
}

/** The size of a "+" on the screen, in pixels. */
export const PLUS_SIZE = 14;

/**
 * The shortest a segment may be on the screen and still show its "+": clear of the corners at
 * its ends. With a finger, two corners' reach plus the handle itself.
 */
export const SHORTEST: Record<PointerKind, number> = { mouse: 24, touch: 50, pen: 50 };

export interface Plus {
  /** The stored segment it splits: a new point goes in after point `segment`. */
  segment: number;
  /** Where the new point goes, in the map's space. */
  at: Position;
  /** Where the handle is on the screen. */
  screen: Point;
}

/**
 * The "+" handles of a path or zone: not on the far side of a globe, not on a segment of no
 * length, and not on one too short on the screen for the pointer that last pressed the map.
 */
export function plusHandles(space: Space, view: View, f: MapFeature, kind: PointerKind): Plus[] {
  if (f.kind === "marker") return [];
  const o = outlineOf(space, f);
  const n = f.points.length;
  const out: Plus[] = [];
  o.spans.forEach((_, i) => {
    const at = midpointOn(space, o, i);
    const screen = at ? view.project(at) : null;
    if (!at || !screen) return;
    const ends = [f.points[i]!, f.points[(i + 1) % n]!].map((p) => view.project(p));
    // An end on the far side is not drawn: the half of the segment that shows is measured.
    const [a, b] = ends;
    const long =
      a && b
        ? Math.hypot(a[0] - b[0], a[1] - b[1])
        : 2 * Math.hypot((a ?? b ?? screen)[0] - screen[0], (a ?? b ?? screen)[1] - screen[1]);
    if (long < SHORTEST[kind]) return;
    out.push({ segment: i, at, screen });
  });
  return out;
}
