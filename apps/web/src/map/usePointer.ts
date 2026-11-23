/**
 * The pointer on the map: binds the state machine of gesture.ts to the top canvas and carries out
 * its effects (taps, panning, pinching, dragging a marker or a corner, the box marked to focus on,
 * and with a mouse, the hover: the cursor, and the halo on the live canvas).
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
import { type RefObject, useEffect, useRef, useState } from "react";
import {
  type Effect,
  type GestureContext,
  type GestureEvent,
  type GestureState,
  IDLE,
  kindOf,
  pick,
  type Point,
  type Rect,
  step,
  type Target,
} from "./gesture.ts";
import { drawLive } from "./live.ts";
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
  /** The canvas above the features, for the hover halo. */
  liveCanvas: RefObject<HTMLCanvasElement | null>;
  /** The map's frame: a press gives it the focus, so the map's keys act. */
  frame: RefObject<HTMLElement | null>;
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
  /** While the context menu is open, nothing is hovered. */
  paused: boolean;
}) {
  const { size, editing, tool, selected, focusing } = p;
  const [box, setBox] = useState<Rect | null>(null);
  const machine = useRef<GestureState>(IDLE);
  /** What the mouse is over, and where it met it: kept until what it is over changes. */
  const [hovered, setHovered] = useState<{ target: Target; at: Point } | null>(null);
  const hoverKey = useRef("");
  /** The last mouse move with nothing pressed, waiting for the next frame. */
  const waiting = useRef<{ event: GestureEvent; frame: number } | null>(null);

  const viewNow = () => {
    const state = p.viewRef.current;
    return state ? makeView(state, size.width, size.height) : null;
  };
  const chosen = () => p.resolvedRef.current.find((r) => r.feature.id === selected)?.feature;

  /** Draws the hover halo of a target, or clears it. */
  function drawHalo(target: Target | null) {
    const canvas = p.liveCanvas.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(size.width * ratio))
      canvas.width = Math.round(size.width * ratio);
    if (canvas.height !== Math.round(size.height * ratio))
      canvas.height = Math.round(size.height * ratio);
    let corner: [number, number] | null = null;
    if (target?.kind === "corner") {
      const shape = chosen();
      const at = shape && shape.kind !== "marker" ? shape.points[target.vertex] : undefined;
      corner = at ? (viewNow()?.project(at) ?? null) : null;
    }
    drawLive(canvas.getContext("2d")!, {
      width: size.width,
      height: size.height,
      shapes:
        target && target.kind !== "corner"
          ? p.shapes.current.filter((s) => s.id === target.feature)
          : [],
      corner,
    });
  }

  /** Sets what is hovered, when it changed: the halo and the name follow. */
  function hover(target: Target | null, at: Point) {
    const key = target
      ? `${target.kind}:${target.feature}:${"vertex" in target ? target.vertex : ""}`
      : "";
    if (key === hoverKey.current) return;
    hoverKey.current = key;
    drawHalo(target);
    if (!target) {
      setHovered(null);
      return;
    }
    // A marker's name points at the marker; a path's or zone's at where the pointer met it.
    const marker = p.shapes.current.find((s) => s.id === target.feature && s.kind === "marker") as
      { at: [number, number] } | undefined;
    const point = target.kind !== "corner" && marker ? { x: marker.at[0], y: marker.at[1] } : at;
    setHovered({ target, at: point });
  }

  /** Ends the hover: the halo, the name and the preview go. */
  function endHover() {
    if (waiting.current) cancelAnimationFrame(waiting.current.frame);
    waiting.current = null;
    hover(null, { x: 0, y: 0 });
  }

  // A change of mode, tool or view ends the hover; the cursor comes back from the tool's class.
  useEffect(() => {
    endHover();
    const canvas = p.topCanvas.current;
    if (canvas) canvas.style.cursor = "";
  }, [editing, tool, p.exploring, focusing, p.paused, selected]);
  useEffect(() => endHover(), [p.viewRef.current, p.map, size]);

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
      case "hover":
        hover(effect.target, effect.at);
        return;
      case "cursor":
        // Set on the canvas directly: the cursor follows every move without drawing the page.
        if (p.topCanvas.current) p.topCanvas.current.style.cursor = effect.name;
        return;
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

  const context = (): GestureContext => ({
    focusing,
    placing: editing ? tool !== "select" : p.exploring,
    pick: (at) => {
      const view = viewNow();
      if (!view) return null;
      return pick({ view, editing, tool, chosen: chosen(), shapes: p.shapes.current }, at);
    },
  });

  /** Runs one event through the machine and carries out what it says. */
  function run(event: GestureEvent) {
    const before = machine.current;
    const { state, effects } = step(before, event, context());
    machine.current = state;
    for (const effect of effects) carryOut(effect, event);
    return { before, state };
  }

  function handle(e: React.PointerEvent, type: GestureEvent["type"]) {
    const event: GestureEvent = {
      type,
      id: e.pointerId,
      kind: kindOf(e.pointerType),
      button: e.button,
      at: pointOn(p.topCanvas.current!, e),
    };
    if (type === "move" && machine.current.name === "idle") {
      // A touch or pen moving with nothing pressed is no part of a gesture. A mouse hovers,
      // asked once a frame, and not while the context menu is open.
      if (event.kind !== "mouse" || p.paused) return;
      if (waiting.current) {
        waiting.current.event = event;
        return;
      }
      waiting.current = {
        event,
        frame: requestAnimationFrame(() => {
          const last = waiting.current?.event;
          waiting.current = null;
          if (last && machine.current.name === "idle") run(last);
        }),
      };
      return;
    }
    if (type === "down") {
      if (waiting.current) cancelAnimationFrame(waiting.current.frame);
      waiting.current = null;
      // Pressing the map gives its frame the focus, so the keys act again after a button.
      // No focus ring: the press itself shows where the focus went.
      p.frame.current?.focus({ preventScroll: true, focusVisible: false } as FocusOptions);
    }
    const { before, state } = run(event);
    // Whatever was pressed keeps the pointer until it is lifted, even off the canvas.
    if (type === "down" && state !== before) {
      (e.target as Element).setPointerCapture(e.pointerId);
    }
    if (state.name === "idle" && p.coarse.current) {
      p.coarse.current = false;
      p.redrawNow();
    }
  }

  return {
    box,
    setBox,
    hovered,
    endHover,
    /** What lies under a point of the canvas, as a press there would find it. */
    pickAt: (at: Point) => context().pick(at, "mouse"),
    handlers: {
      onPointerDown: (e: React.PointerEvent) => handle(e, "down"),
      onPointerMove: (e: React.PointerEvent) => handle(e, "move"),
      onPointerUp: (e: React.PointerEvent) => handle(e, "up"),
      onPointerCancel: (e: React.PointerEvent) => handle(e, "cancel"),
      // Leaving the frame ends the hover.
      onPointerLeave: (e: React.PointerEvent) => {
        if (machine.current.name === "idle" && e.pointerType === "mouse") endHover();
      },
    },
  };
}
