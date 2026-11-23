/**
 * The pointer on the map: binds the state machine of gesture.ts to the top canvas and carries out
 * its effects (taps, panning, pinching, dragging a marker or a corner, and the box marked to focus
 * on).
 */
import {
  focusOn,
  makeView,
  panBy,
  type Position,
  type Shape,
  type ViewState,
  zoomAt,
} from "@frontier/geo";
import type { MapFeature, MapFile } from "@frontier/schema";
import { type RefObject, useRef, useState } from "react";
import {
  type Effect,
  type GestureEvent,
  type GestureState,
  IDLE,
  kindOf,
  pick,
  type Rect,
  step,
} from "./gesture.ts";
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
  const [box, setBox] = useState<Rect | null>(null);
  const machine = useRef<GestureState>(IDLE);

  const viewNow = () => {
    const state = p.viewRef.current;
    return state ? makeView(state, size.width, size.height) : null;
  };
  const chosen = () => p.resolvedRef.current.find((r) => r.feature.id === selected)?.feature;

  function tap(x: number, y: number) {
    const v = viewNow();
    const now = p.mapRef.current;
    if (!v || !now) return;
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

    p.apply(tapSelect(v, editing, chosen(), p.shapes.current, [x, y]));
  }

  function carryOut(effect: Effect, e: GestureEvent) {
    const state = p.viewRef.current;
    switch (effect.type) {
      case "tap":
        tap(effect.at.x, effect.at.y);
        return;
      case "beginStep":
        p.beginStep();
        return;
      case "box":
        setBox(effect.rect);
        return;
      case "focus":
        if (!state) return;
        p.setView(focusOn(state, size.width, size.height, effect.rect));
        p.setFocusing(false);
        return;
      case "pan":
        if (!state) return;
        // A touch pan draws the picture coarsely until the finger is lifted.
        p.coarse.current = e.kind === "touch";
        p.setView(panBy(state, effect.dx, effect.dy));
        return;
      case "zoom":
        if (!state) return;
        p.setView(zoomAt(state, size.width, size.height, effect.cx, effect.cy, effect.factor));
        return;
      case "dragTo": {
        const position = viewNow()?.unproject(effect.at.x, effect.at.y);
        const now = p.mapRef.current;
        const drawn = p.resolvedRef.current.find((r) => r.feature.id === effect.target.feature);
        if (!position || !now || !drawn) return;
        const vertex = effect.target.kind === "corner" ? effect.target.vertex : null;
        const next = dragShape(
          now,
          drawn,
          vertex,
          position,
          p.seenRef.current,
          p.yearRef.current ?? 0,
        );
        if (next) p.setFeature(next, false);
        return;
      }
    }
  }

  function handle(e: React.PointerEvent, type: GestureEvent["type"]) {
    // A pointer moving over the map with nothing pressed is no part of a gesture.
    if (type === "move" && machine.current.name === "idle") return;
    const event: GestureEvent = {
      type,
      id: e.pointerId,
      kind: kindOf(e.pointerType),
      button: e.button,
      at: pointOn(p.topCanvas.current!, e),
    };
    const before = machine.current;
    const { state, effects } = step(before, event, {
      focusing,
      pick: (at) => {
        const view = viewNow();
        if (!view) return null;
        return pick({ view, editing, tool, chosen: chosen(), shapes: p.shapes.current }, at);
      },
    });
    machine.current = state;
    // Whatever was pressed keeps the pointer until it is lifted, even off the canvas.
    if (type === "down" && state !== before) {
      (e.target as Element).setPointerCapture(e.pointerId);
    }
    for (const effect of effects) carryOut(effect, event);
    if (state.name === "idle" && p.coarse.current) {
      p.coarse.current = false;
      p.redrawNow();
    }
  }

  return {
    box,
    setBox,
    handlers: {
      onPointerDown: (e: React.PointerEvent) => handle(e, "down"),
      onPointerMove: (e: React.PointerEvent) => handle(e, "move"),
      onPointerUp: (e: React.PointerEvent) => handle(e, "up"),
      onPointerCancel: (e: React.PointerEvent) => handle(e, "cancel"),
    },
  };
}
