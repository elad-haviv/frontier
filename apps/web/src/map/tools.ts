/**
 * What the map's tools do, as plain functions of the map and what was tapped or dragged. Each
 * returns the step to take; the page applies it, the map through the save queue.
 */
import { type Position, type Shape, shapeAt, vertexAt, type View } from "@frontier/geo";
import type { MapFeature, MapFile } from "@frontier/schema";
import { type MapTime, orbitAt, type Resolved, turnAbout, writeShape } from "./time.ts";
import { newItemId } from "./viewUrl.ts";

export type Tool = "select" | "marker" | "path" | "zone" | "measure";

/** What a tap changes: each part that is given is set on the page. */
export interface Step {
  /** The changed map, remembered as one step to undo. */
  map?: MapFile;
  selected?: string | null;
  /** The picked corner of the selected path or zone. */
  vertex?: number | null;
  sketch?: Position[];
  tool?: Tool;
}

/** A new marker at a place, selected; the tool goes back to Select. */
export function placeMarker(map: MapFile, layer: string, position: Position): Step {
  const feature: MapFeature = {
    id: newItemId(),
    kind: "marker",
    layer,
    at: position,
    entry: null,
    label: null,
    icon: null,
    child: null,
  };
  return {
    map: { ...map, features: [...map.features, feature] },
    selected: feature.id,
    tool: "select",
  };
}

/** Ends drawing: a path or zone with enough points is added and selected. Back to Select. */
export function finishSketch(map: MapFile, tool: Tool, sketch: Position[], layer: string): Step {
  const kind = tool === "zone" ? "zone" : "path";
  if (sketch.length >= (kind === "zone" ? 3 : 2)) {
    const feature = {
      id: newItemId(),
      kind,
      layer,
      points: sketch,
      entry: null,
      label: null,
      child: null,
    } as MapFeature;
    return {
      map: { ...map, features: [...map.features, feature] },
      selected: feature.id,
      sketch: [],
      tool: "select",
    };
  }
  return { sketch: [], tool: "select" };
}

/**
 * A tap while drawing a path, a zone or a measured line: a point is added, or a tap on the last
 * point finishes the path or zone. Null when nothing changes.
 */
export function addSketchPoint(
  map: MapFile,
  view: View,
  tool: Tool,
  sketch: Position[],
  layer: string,
  [x, y]: [number, number],
): Step | null {
  const position = view.unproject(x, y);
  if (!position) return null;
  const last = sketch[sketch.length - 1];
  const lastOnScreen = last ? view.project(last) : null;
  const onLast = lastOnScreen !== null && Math.hypot(lastOnScreen[0] - x, lastOnScreen[1] - y) < 16;
  if (onLast && tool !== "measure") return finishSketch(map, tool, sketch, layer);
  if (!onLast) return { sketch: [...sketch, position] };
  return null;
}

/**
 * A tap while reading, or with the select tool: a corner of the selected shape first, then any
 * feature. The shape on screen is what is tapped, whichever of the feature's shapes that is.
 */
export function tapSelect(
  view: View,
  editing: boolean,
  chosen: MapFeature | undefined,
  shapes: Shape[],
  [x, y]: [number, number],
): Step {
  if (editing && chosen && chosen.kind !== "marker") {
    // A corner on the far side of a globe is not drawn, so it cannot be picked.
    const corners = chosen.points.map(
      (p): [number, number] => view.project(p) ?? [Number.POSITIVE_INFINITY, 0],
    );
    const corner = vertexAt(corners, [x, y]);
    if (corner !== null) return { vertex: corner };
  }
  return { selected: shapeAt(shapes, [x, y]), vertex: null };
}

/**
 * The dragged feature with its marker or one corner moved to a place. The drag changes the shape on
 * screen: the feature's first shape or a later one. Null when the feature is gone.
 */
export function dragShape(
  map: MapFile,
  drawn: Resolved,
  vertex: number | null,
  position: Position,
  time: MapTime | null,
  year: number,
): MapFeature | null {
  const feature = map.features.find((f) => f.id === drawn.feature.id);
  if (!feature) return null;
  const shape =
    drawn.feature.kind === "marker"
      ? { at: position }
      : { points: drawn.feature.points.map((q, i) => (i === vertex ? position : q)) };
  // A revolving marker is dropped where the finger is at the year shown: its own place is
  // that point turned back by the orbit.
  const orbit = orbitAt(map, feature, time, year);
  const placed =
    orbit && "at" in shape ? { at: turnAbout(shape.at, orbit.centre, -orbit.degrees) } : shape;
  return writeShape(feature, drawn.shape, placed);
}

/** The fewest points the shape of a path or zone may have. */
export const FEWEST_POINTS = { path: 2, zone: 3 } as const;

/** Why a point cannot be taken from a shape on screen, or null when one can. */
export function removeReason(drawn: MapFeature): string | null {
  if (drawn.kind === "marker") return "A marker has no points";
  const fewest = FEWEST_POINTS[drawn.kind];
  return drawn.points.length > fewest ? null : `A ${drawn.kind} needs at least ${fewest} points`;
}

/**
 * The feature with one point taken from its shape on screen, whichever of its shapes that is; or
 * the reason it cannot be, when that shape has its fewest points. Null when the feature is gone.
 */
export function removePoint(
  map: MapFile,
  drawn: Resolved,
  vertex: number,
): { feature: MapFeature } | { reason: string } | null {
  const feature = map.features.find((f) => f.id === drawn.feature.id);
  if (!feature) return null;
  const reason = removeReason(drawn.feature);
  if (reason || drawn.feature.kind === "marker") return { reason: reason ?? "" };
  const points = drawn.feature.points.filter((_, i) => i !== vertex);
  return { feature: writeShape(feature, drawn.shape, { points }) };
}

/** The map without one of its features. */
export function deleteFeature(map: MapFile, id: string): MapFile {
  return { ...map, features: map.features.filter((f) => f.id !== id) };
}
