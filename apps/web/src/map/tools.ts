/**
 * What the map's tools do, as plain functions of the map and what was tapped or dragged. Each
 * returns the step to take; the page applies it, the map through the save queue.
 */
import {
  moveBy,
  type Position,
  type Shape,
  shapeAt,
  type Space,
  vertexAt,
  type View,
} from "@frontier/geo";
import { isLined, type MapFeature, type MapFile, orderFeature } from "@frontier/schema";
import { type MapTime, orbitAt, type Resolved, turnAbout, writeShape } from "./time.ts";
import { joinNewPath } from "./joins.ts";
import { newItemId } from "./viewUrl.ts";

/**
 * `label` writes words on the map; `place` marks a spot or an area to place features with AI;
 * `find` makes zones from areas found in the map's picture; `paths` makes paths (rivers, routes,
 * traced lines) from the picture and the map's heights.
 */
export type Tool =
  | "select"
  | "marker"
  | "path"
  | "zone"
  | "measure"
  | "label"
  | "place"
  | "find"
  | "paths";

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

/**
 * A new marker at a place, selected. The Marker tool stays on, so the next one can be placed
 * while this one is linked in its tab.
 */
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
  return { map: { ...map, features: [...map.features, feature] }, selected: feature.id };
}

/**
 * A new label at a place, selected, its words ready to be typed over. The Label tool stays on, as
 * the Marker tool does.
 */
export function placeLabel(map: MapFile, layer: string, position: Position): Step {
  const feature: MapFeature = {
    id: newItemId(),
    kind: "label",
    layer,
    at: position,
    entry: null,
    label: "Label",
    child: null,
  };
  return { map: { ...map, features: [...map.features, feature] }, selected: feature.id };
}

/** Whether a sketch has the points its feature needs: two for a path, three for a zone. */
export function canFinish(tool: Tool, sketch: Position[]): boolean {
  return tool === "path" || tool === "zone" ? sketch.length >= FEWEST_POINTS[tool] : false;
}

/**
 * Ends drawing: a path or zone with enough points is added, curved when `curve` is on, and
 * selected. Back to Select, so the new shape can be adjusted at once.
 */
export function finishSketch(
  map: MapFile,
  tool: Tool,
  sketch: Position[],
  layer: string,
  curve = false,
  /** A path that starts or ends on another path is joined to it (snapping to paths is on). */
  join = false,
): Step {
  const kind = tool === "zone" ? "zone" : "path";
  if (sketch.length >= FEWEST_POINTS[kind]) {
    const feature = orderFeature({
      id: newItemId(),
      kind,
      layer,
      points: sketch,
      ...(curve ? { curve: "smooth" } : {}),
      entry: null,
      label: null,
      child: null,
    } as MapFeature);
    const made = { ...map, features: [...map.features, feature] };
    return {
      map: join && kind === "path" ? joinNewPath(made, map.space as Space, feature.id) : made,
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
  curve = false,
  /** Where the point snapped to, which wins over the place under the pointer. */
  snapped?: Position,
  join = false,
): Step | null {
  const position = snapped ?? view.unproject(x, y);
  if (!position) return null;
  const last = sketch[sketch.length - 1];
  const lastOnScreen = last ? view.project(last) : null;
  const onLast = lastOnScreen !== null && Math.hypot(lastOnScreen[0] - x, lastOnScreen[1] - y) < 16;
  // A double-click finishes through this rule: its first click adds a point, its second lands
  // on that point. A measured line and an area to place in are not features: they go on.
  if (onLast && (tool === "path" || tool === "zone")) {
    return finishSketch(map, tool, sketch, layer, curve, join);
  }
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
  if (editing && chosen && isLined(chosen)) {
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
  const shape = !isLined(drawn.feature)
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

/** A sketch with its last point taken back: Delete or Backspace while drawing. */
export function takeBackPoint(sketch: Position[]): Position[] {
  return sketch.slice(0, -1);
}

/**
 * The feature with a point put into its shape on screen after point `segment`, at `position`:
 * a "+" clicked or dragged out. The new point is `vertex`. Null when the feature is gone.
 */
export function insertPoint(
  map: MapFile,
  drawn: Resolved,
  segment: number,
  position: Position,
): { feature: MapFeature; vertex: number } | null {
  const feature = map.features.find((f) => f.id === drawn.feature.id);
  if (!feature || !isLined(drawn.feature)) return null;
  const points = [...drawn.feature.points];
  points.splice(segment + 1, 0, position);
  return { feature: writeShape(feature, drawn.shape, { points }), vertex: segment + 1 };
}

/**
 * The zone with its shape on screen moved as the pointer went from `from` to `to`, starting from
 * `start`, the points it had when the drag began, so it does not drift. Null when it is gone.
 */
export function moveZone(
  map: MapFile,
  drawn: Resolved,
  start: Position[],
  from: Position,
  to: Position,
): MapFeature | null {
  const feature = map.features.find((f) => f.id === drawn.feature.id);
  if (!feature || feature.kind !== "zone") return null;
  return writeShape(feature, drawn.shape, { points: moveBy(map.space as Space, start, from, to) });
}

/**
 * The path or zone drawn curved or straight. The one edit that is not to the shape on screen: all
 * of a feature's shapes are curved or straight together.
 */
export function setCurve(feature: MapFeature, curved: boolean): MapFeature {
  if (!isLined(feature)) return feature;
  const next = { ...feature } as MapFeature & { curve?: string };
  delete next.curve;
  return orderFeature((curved ? { ...next, curve: "smooth" } : next) as MapFeature);
}

/** Why a point cannot be taken from a shape on screen, or null when one can. */
export function removeReason(drawn: MapFeature): string | null {
  if (!isLined(drawn)) return `A ${drawn.kind} has no points`;
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
  if (reason || !isLined(drawn.feature)) return { reason: reason ?? "" };
  const points = drawn.feature.points.filter((_, i) => i !== vertex);
  return { feature: writeShape(feature, drawn.shape, { points }) };
}

/** The map without one of its features. */
export function deleteFeature(map: MapFile, id: string): MapFile {
  return { ...map, features: map.features.filter((f) => f.id !== id) };
}
