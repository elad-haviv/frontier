/**
 * The pointer on the map: taps, panning, pinching, dragging a marker or a corner, and the box
 * marked to focus on.
 */
import {
  focusOn,
  makeView,
  panBy,
  type Position,
  type Shape,
  vertexAt,
  type ViewState,
  zoomAt,
} from "@frontier/geo";
import type { MapFeature, MapFile } from "@frontier/schema";
import { type RefObject, useRef, useState } from "react";
import type { MapTime, Resolved } from "./time.ts";
import {
  addSketchPoint,
  dragShape,
  placeMarker,
  type Step,
  tapSelect,
  type Tool,
} from "./tools.ts";
import { pointOn } from "./useMapView.ts";

export function usePointer(p: {
  map: MapFile | null;
  mapRef: RefObject<MapFile | null>;
  view: ViewState | null;
  viewRef: RefObject<ViewState | null>;
  setView: (view: ViewState) => void;
  size: { width: number; height: number };
  topCanvas: RefObject<HTMLCanvasElement | null>;
  shapes: RefObject<Shape[]>;
  coarse: { current: boolean };
  redrawNow: () => void;
  resolvedRef: RefObject<Resolved[]>;
  seenRef: RefObject<MapTime | null>;
  yearRef: RefObject<number | null>;
  editing: boolean;
  tool: Tool;
  selected: string | null;
  sketch: Position[];
  activeLayer: string;
  focusing: boolean;
  setFocusing: (focusing: boolean) => void;
  exploring: boolean;
  explore: (position: Position | null) => void;
  setFeature: (next: MapFeature, remember?: boolean) => void;
  beginStep: () => void;
  apply: (step: Step) => void;
}) {
  const { size, editing, tool, selected, focusing } = p;
  const [box, setBox] = useState<[number, number, number, number] | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{
    startX: number;
    startY: number;
    moved: boolean;
    drag: { feature: string; vertex: number | null } | null;
    pinch: number | null;
    touch: boolean;
  } | null>(null);

  const at = (e: { clientX: number; clientY: number }) => pointOn(p.topCanvas.current!, e);

  function tap(x: number, y: number) {
    const state = p.viewRef.current;
    const now = p.mapRef.current;
    if (!state || !now) return;
    const v = makeView(state, size.width, size.height);
    const position = v.unproject(x, y);

    if (p.exploring && !editing) {
      p.explore(position);
      return;
    }

    if (editing && tool === "marker") {
      if (!position) return;
      p.apply(placeMarker(now, p.activeLayer, position));
      return;
    }
    if (editing && (tool === "path" || tool === "zone" || tool === "measure")) {
      if (!p.map) return;
      const step = addSketchPoint(p.map, v, tool, p.sketch, p.activeLayer, [x, y]);
      if (step) p.apply(step);
      return;
    }

    const chosen = p.resolvedRef.current.find((r) => r.feature.id === selected)?.feature;
    p.apply(tapSelect(v, editing, chosen, p.shapes.current, [x, y]));
  }

  function onPointerDown(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture(e.pointerId);
    const point = at(e);
    if (focusing) {
      // Marking a box to focus on comes before every other use of a drag. A second finger ends it.
      if (pointers.current.size > 0) {
        setBox(null);
        return;
      }
      pointers.current.set(e.pointerId, point);
      setBox([point.x, point.y, point.x, point.y]);
      return;
    }
    pointers.current.set(e.pointerId, point);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      if (gesture.current) {
        gesture.current.pinch = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        gesture.current.moved = true;
        gesture.current.drag = null;
      }
      return;
    }
    // While editing with the select tool, a press on the selected marker or corner drags it.
    let drag: { feature: string; vertex: number | null } | null = null;
    const now = p.mapRef.current;
    const state = p.viewRef.current;
    if (editing && tool === "select" && selected && now && state) {
      const v = makeView(state, size.width, size.height);
      const chosen = p.resolvedRef.current.find((r) => r.feature.id === selected)?.feature;
      if (chosen?.kind === "marker") {
        const s = v.project(chosen.at);
        if (s && Math.hypot(s[0] - point.x, s[1] - point.y) < 24)
          drag = { feature: chosen.id, vertex: null };
      } else if (chosen) {
        const corner = vertexAt(
          chosen.points.map((q) => v.projectClamped(q).point),
          [point.x, point.y],
        );
        if (corner !== null) drag = { feature: chosen.id, vertex: corner };
      }
    }
    gesture.current = {
      startX: point.x,
      startY: point.y,
      moved: false,
      drag,
      pinch: null,
      touch: e.pointerType === "touch",
    };
  }

  function onPointerMove(e: React.PointerEvent) {
    if (focusing) {
      if (!pointers.current.has(e.pointerId)) return;
      const point = at(e);
      setBox((b) => (b ? [b[0], b[1], point.x, point.y] : b));
      return;
    }
    const before = pointers.current.get(e.pointerId);
    const g = gesture.current;
    if (!before || !g) return;
    const point = at(e);
    pointers.current.set(e.pointerId, point);
    const state = p.viewRef.current;
    if (!state) return;

    if (pointers.current.size === 2 && g.pinch !== null) {
      const [a, b] = [...pointers.current.values()];
      const distance = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      if (distance > 0 && g.pinch > 0) {
        p.setView(
          zoomAt(
            state,
            size.width,
            size.height,
            (a!.x + b!.x) / 2,
            (a!.y + b!.y) / 2,
            distance / g.pinch,
          ),
        );
        g.pinch = distance;
      }
      return;
    }
    if (!g.moved) {
      if (Math.hypot(point.x - g.startX, point.y - g.startY) < (g.touch ? 10 : 6)) {
        // Not a drag yet: keep measuring from where the press began, so none of it is lost.
        pointers.current.set(e.pointerId, before);
        return;
      }
      g.moved = true;
      // One drag is one step to undo.
      if (g.drag) p.beginStep();
    }
    if (g.drag) {
      const position = makeView(state, size.width, size.height).unproject(point.x, point.y);
      const now = p.mapRef.current;
      const drawn = p.resolvedRef.current.find((r) => r.feature.id === g.drag!.feature);
      if (!position || !now || !drawn) return;
      const next = dragShape(
        now,
        drawn,
        g.drag.vertex,
        position,
        p.seenRef.current,
        p.yearRef.current ?? 0,
      );
      if (next) p.setFeature(next, false);
      return;
    }
    p.coarse.current = g.touch;
    p.setView(panBy(state, point.x - before.x, point.y - before.y));
  }

  function onPointerUp(e: React.PointerEvent) {
    const view = p.view;
    if (focusing) {
      pointers.current.delete(e.pointerId);
      const b = box;
      setBox(null);
      if (!b || !view) return;
      const [x0, x1] = [Math.min(b[0], b[2]), Math.max(b[0], b[2])];
      const [y0, y1] = [Math.min(b[1], b[3]), Math.max(b[1], b[3])];
      // Too small a box is a slip of the finger, not a place to focus on.
      if (x1 - x0 < 12 || y1 - y0 < 12) return;
      p.setView(focusOn(view, size.width, size.height, [x0, y0, x1, y1]));
      p.setFocusing(false);
      return;
    }
    const g = gesture.current;
    const point = pointers.current.get(e.pointerId);
    pointers.current.delete(e.pointerId);
    if (pointers.current.size > 0) {
      if (g) g.pinch = null;
      return;
    }
    gesture.current = null;
    if (p.coarse.current) {
      p.coarse.current = false;
      p.redrawNow();
    }
    if (g && point && !g.moved) tap(point.x, point.y);
  }

  return {
    box,
    setBox,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
    },
  };
}
