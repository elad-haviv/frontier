/**
 * Snapping: while a point of a path or zone is placed or dragged, it lands on a corner or an edge
 * of another path or zone close by on the screen, so that two borders can share their line. Land
 * is snapped to the same way, as a zone: a coastline traced once as a zone is snapped to after.
 * Outlines found in the map's picture snap to zones in findAreas/snapRings.ts.
 */
import type { Point, Position, Shape, View } from "@frontier/geo";
import { isLined, type MapFeature } from "@frontier/schema";
import { useState } from "react";

/** How near, in pixels of the screen, a point must come to be snapped. */
export const SNAP_REACH = 12;

export interface Snapped {
  /** Where the point goes. A corner's own position, so that the two features share it exactly. */
  at: Position;
  /** Where that is on the screen, for the mark that shows the snap. */
  screen: Point;
  /** A corner of the other feature, or a point on one of its edges. */
  kind: "corner" | "edge";
  feature: string;
}

/** The nearest point of a segment to a point, and how far it is. */
function nearestOnSegment(p: Point, a: Point, b: Point): { at: Point; d: number } {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const length = dx * dx + dy * dy;
  const t =
    length === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length));
  const at: Point = [a[0] + t * dx, a[1] + t * dy];
  return { at, d: Math.hypot(p[0] - at[0], p[1] - at[1]) };
}

/**
 * Where a point of the screen snaps to: the nearest corner of another path or zone within reach,
 * else the nearest point on one of their edges as drawn (curves included), else null. `drawn` are
 * the features as on screen now, `shapes` where they were drawn; `skip` is the feature whose
 * point is moved, which does not snap to itself.
 */
export function snapAt(
  view: View,
  drawn: readonly MapFeature[],
  shapes: readonly Shape[],
  at: Point,
  skip: string | null,
  reach = SNAP_REACH,
  targets: SnapTargets = ALL_TARGETS,
): Snapped | null {
  // Only what is drawn now: not a hidden layer, not the far side of a globe.
  const onScreen = new Set(shapes.map((s) => s.id));
  const lined = drawn.filter(
    (f) =>
      isLined(f) &&
      f.id !== skip &&
      onScreen.has(f.id) &&
      (f.kind === "path" ? targets.paths : targets.zones),
  );
  let best: Snapped | null = null;
  let bestD = reach;
  if (targets.markers) {
    // A marker or a label is snapped to at its own place.
    for (const f of drawn) {
      if (isLined(f) || f.id === skip || !onScreen.has(f.id)) continue;
      const s = view.project(f.at);
      if (!s) continue;
      const d = Math.hypot(s[0] - at[0], s[1] - at[1]);
      if (d <= bestD) {
        best = { at: f.at, screen: s, kind: "corner", feature: f.id };
        bestD = d;
      }
    }
  }
  for (const f of lined) {
    if (!isLined(f)) continue;
    for (const p of f.points) {
      const s = view.project(p);
      if (!s) continue;
      for (const shift of view.repeats()) {
        const screen: Point = [s[0] + shift, s[1]];
        const d = Math.hypot(screen[0] - at[0], screen[1] - at[1]);
        if (d <= bestD) {
          best = { at: p, screen, kind: "corner", feature: f.id };
          bestD = d;
        }
      }
    }
  }
  if (best) return best;

  // No corner near: the nearest point of an edge, as drawn.
  const ids = new Set(lined.map((f) => f.id));
  let edge: { at: Point; d: number; feature: string } | null = null;
  for (const s of shapes) {
    if ((s.kind !== "path" && s.kind !== "zone") || !ids.has(s.id)) continue;
    const pts = s.points;
    const closed = s.kind === "zone" && pts.length > 2;
    const n = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) {
      const found = nearestOnSegment(at, pts[i]!, pts[(i + 1) % pts.length]!);
      if (found.d <= reach && (!edge || found.d < edge.d)) edge = { ...found, feature: s.id };
    }
  }
  if (!edge) return null;
  const position = view.unproject(edge.at[0], edge.at[1]);
  return position ? { at: position, screen: edge.at, kind: "edge", feature: edge.feature } : null;
}

/** What a point snaps to. Each can be turned off by itself; S turns snapping off as a whole. */
export interface SnapTargets {
  paths: boolean;
  zones: boolean;
  /** Markers and labels. */
  markers: boolean;
}
export const ALL_TARGETS: SnapTargets = { paths: true, zones: true, markers: true };
export const SNAP_TARGETS_KEY = "frontier:map-snap-targets";
export const TARGET_LABELS: Record<keyof SnapTargets, string> = {
  paths: "Paths",
  zones: "Zones",
  markers: "Markers & labels",
};

/** The targets in words, for the magnet's tooltip: "Snaps to paths and zones". */
export function targetsText(on: boolean, t: SnapTargets): string {
  if (!on) return "Off";
  const names = (Object.keys(TARGET_LABELS) as (keyof SnapTargets)[])
    .filter((k) => t[k])
    .map((k) => TARGET_LABELS[k].toLowerCase());
  if (names.length === 0) return "Snaps to nothing";
  const last = names.pop()!;
  return `Snaps to ${names.length ? `${names.join(", ")} and ${last}` : last}`;
}

/** What snapping snaps to, remembered on this device; everything until one is turned off. */
export function useSnapTargets(): [SnapTargets, (next: SnapTargets) => void] {
  const [targets, setTargets] = useState<SnapTargets>(() => {
    try {
      const kept = JSON.parse(window.localStorage.getItem(SNAP_TARGETS_KEY) ?? "{}") as object;
      return { ...ALL_TARGETS, ...kept };
    } catch {
      return ALL_TARGETS;
    }
  });
  return [
    targets,
    (next: SnapTargets) => {
      setTargets(next);
      try {
        window.localStorage.setItem(SNAP_TARGETS_KEY, JSON.stringify(next));
      } catch {
        // Not remembered, as in a private window; it still holds for this visit.
      }
    },
  ];
}

export const SNAP_KEY = "frontier:map-snap";

/** Whether snapping is on, remembered on this device; on until turned off. */
export function useSnapSetting(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => {
    try {
      return window.localStorage.getItem(SNAP_KEY) !== "off";
    } catch {
      return true;
    }
  });
  return [
    on,
    (next: boolean) => {
      setOn(next);
      try {
        window.localStorage.setItem(SNAP_KEY, next ? "on" : "off");
      } catch {
        // Not remembered, as in a private window; it still holds for this visit.
      }
    },
  ];
}
