/**
 * The pointer on the map: binds the state machine of gesture.ts to the top canvas and carries out
 * its effects (taps, panning, pinching, dragging a marker, a corner, a "+" or the selected zone,
 * the box marked to focus on, and with a mouse, the hover: the cursor, the halo on the live
 * canvas, and while drawing, the line from the last point to the pointer).
 */
import {
  focusOn,
  makeView,
  moveBy,
  outline,
  panBy,
  type Position,
  type Shape,
  shapeAt,
  type Space,
  type ViewState,
  zoomAt,
} from "@frontier/geo";
import { isLined, type MapFeature, type MapFile } from "@frontier/schema";
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
  type PointerKind,
  type Rect,
  step,
  type Target,
} from "./gesture.ts";
import { drawLive, type LiveInput } from "./live.ts";
import { screenLines } from "./overlay.ts";
import { type MapTime, type Resolved, writeShape } from "./time.ts";
import {
  addSketchPoint,
  dragShape,
  insertPoint,
  moveZone,
  placeLabel,
  placeMarker,
  type Step,
  tapSelect,
  type Tool,
} from "./tools.ts";
import { focusIsFree } from "../keys.ts";
import { type Snapped, snapAt } from "./snap.ts";
import { pointOn } from "./useMapView.ts";

/** What Find areas and Find paths hear from the pointer: taps, and where a mouse is. */
export interface FindPointer {
  tap(at: Point, how: { alt: boolean; shift: boolean; kind: PointerKind }): void;
  /** Where a mouse is over the map, or null when it left or the hover ended. */
  hover(at: Point | null): void;
  /** Find paths: the stop of the proposed route under a press, which a drag then moves. */
  grab?(at: Point, kind: PointerKind): number | null;
  dragStop?(index: number, at: Point): void;
  dropStop?(): void;
}

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
  /** New paths and zones are curved: the rubber band shows the curve. */
  curve: boolean;
  /** Tells the page the kind of pointer that pressed the map, which sizes the "+" handles. */
  onPressKind: (kind: PointerKind) => void;
  /** Points of paths and zones snap to other paths and zones near them. */
  snap: boolean;
  /** The Find areas tool, while it is on: it takes the taps and the hover. */
  find?: RefObject<FindPointer | null>;
  /** Changes the whole map: a group moved by a drag, as one step with `beginStep`. */
  change: (next: MapFile, remember?: boolean) => void;
  /** The selected group, when one is selected and can be changed on the map. */
  group: { id: string; members: ReadonlySet<string> } | null;
  /**
   * What a tap on a feature (or a group's name), or on nothing, selects: the page decides, by the
   * groups and by whether Shift or Ctrl/⌘ was held to pick several.
   */
  pickTap: (
    hit: string | null,
    how: { add: boolean; kind: PointerKind; piece: string | null },
  ) => void;
  /** The features lit with a hovered one: its group's, unless the selection is inside it. */
  haloIds: (feature: string) => ReadonlySet<string>;
}) {
  /** Alt held with the last pointer event: points go exactly where they are put. */
  const altHeld = useRef(false);
  /** Shift, Ctrl or ⌘ held as the map was pressed: a tap adds to what is picked. */
  const addHeld = useRef(false);
  /** Where each piece of a dragged group was when the drag began. */
  const groupStart = useRef<{
    group: string;
    pieces: { resolved: Resolved; points: Position[] }[];
    at: Position | null;
  } | null>(null);
  /** Shift held with the last pointer event: Find areas adds whatever its mode. */
  const shiftHeld = useRef(false);
  /** Where the point being placed or dragged snaps to now, marked on the live canvas. */
  const snapMark = useRef<Snapped | null>(null);
  const { size, editing, tool, selected, focusing } = p;
  /** Space is held: a drag pans, even over the selected zone. */
  const spaceHeld = useRef(false);
  /** The shape on screen of what is dragged, as it was when the drag began. */
  const dragStart = useRef<{ feature: string; points: Position[] } | null>(null);
  /** The halo's target, and where the mouse is while drawing: the live canvas shows both. */
  const halo = useRef<Target | null>(null);
  const bandAt = useRef<Point | null>(null);
  const drawing = () =>
    editing &&
    (tool === "path" || tool === "zone" || tool === "measure" || tool === "place") &&
    p.sketch.length > 0;
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
  const space = () => p.map?.space as Space | undefined;
  /** Sets the view at once, so a pan and a zoom in one step build on each other. */
  const moveView = (next: ViewState) => {
    (p.viewRef as { current: ViewState | null }).current = next;
    p.setView(next);
  };

  /**
   * The rubber band at a point of the screen: the sketch's outline with the pointer as its next
   * point, drawn by the same function as a finished feature. None off the globe.
   */
  function bandFor(at: Point | null): NonNullable<LiveInput["band"]> | null {
    const view = viewNow();
    const s = space();
    const position = at && view ? (snapFor(at, null)?.at ?? view.unproject(at.x, at.y)) : null;
    if (!position || !view || !s || !drawing()) return null;
    const points = [...p.sketch, position];
    const curve = tool !== "measure" && tool !== "place" && p.curve;
    if (tool !== "zone" && tool !== "place") {
      return {
        line: screenLines(view, outline(s, points, { curve, closed: false }).line),
        closing: [],
      };
    }
    const o = outline(s, points, { curve, closed: true });
    const turn = o.spans[points.length - 1] ?? o.line.length - 1;
    return {
      line: screenLines(view, o.line.slice(0, turn + 1)),
      closing: screenLines(view, o.line.slice(turn)),
    };
  }

  /**
   * Where a point of the screen snaps to, while editing with snapping on and Alt not held; `skip`
   * is the feature whose point it is. Measuring does not snap.
   */
  function snapFor(at: Point, skip: string | null): Snapped | null {
    const view = viewNow();
    if (!view || !p.snap || altHeld.current || !editing || tool === "measure") return null;
    return snapAt(
      view,
      p.resolvedRef.current.map((r) => r.feature),
      p.shapes.current,
      [at.x, at.y],
      skip,
    );
  }

  /** Draws the hover halo of a target, or clears it. */
  function drawHalo(target: Target | null) {
    halo.current = target;
    paintLive();
  }

  /** Draws the live canvas: the halo, and the rubber band. */
  function paintLive() {
    const target = halo.current;
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
      const at = shape && isLined(shape) ? shape.points[target.vertex] : undefined;
      corner = at ? (viewNow()?.project(at) ?? null) : null;
    }
    // A "+" is ringed as a corner is.
    if (target?.kind === "insert") corner = viewNow()?.project(target.at) ?? null;
    drawLive(canvas.getContext("2d")!, {
      width: size.width,
      height: size.height,
      shapes:
        target && target.kind !== "corner" && target.kind !== "insert"
          ? p.shapes.current.filter((s) => p.haloIds(target.feature).has(s.id))
          : [],
      corner,
      band: bandFor(bandAt.current),
      snap: snapMark.current,
    });
  }
  // A point added, or taken back, moves the band with it.
  useEffect(() => paintLive(), [p.sketch, p.curve]);

  /** Sets what is hovered, when it changed: the halo and the name follow. */
  function hover(target: Target | null, at: Point) {
    const key = target
      ? `${target.kind}:${target.feature}:${"vertex" in target ? target.vertex : ""}:${"segment" in target ? target.segment : ""}`
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
    const point =
      target.kind !== "corner" && target.kind !== "insert" && marker
        ? { x: marker.at[0], y: marker.at[1] }
        : at;
    setHovered({ target, at: point });
  }

  /** Ends the hover: the halo, the name and the preview go. */
  function endHover() {
    if (waiting.current) cancelAnimationFrame(waiting.current.frame);
    waiting.current = null;
    bandAt.current = null;
    snapMark.current = null;
    hover(null, { x: 0, y: 0 });
    paintLive();
    p.find?.current?.hover(null);
  }

  // Space held pans, while the keys are the map's: not while typing in a field.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key !== " " || !focusIsFree(document.activeElement, p.frame.current)) return;
      spaceHeld.current = true;
      // The page does not scroll under the map.
      e.preventDefault();
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === " ") spaceHeld.current = false;
    };
    const lost = () => (spaceHeld.current = false);
    document.addEventListener("keydown", down);
    document.addEventListener("keyup", up);
    window.addEventListener("blur", lost);
    return () => {
      document.removeEventListener("keydown", down);
      document.removeEventListener("keyup", up);
      window.removeEventListener("blur", lost);
    };
  }, []);

  // A change of mode, tool or view ends the hover; the cursor comes back from the tool's class.
  useEffect(() => {
    endHover();
    const canvas = p.topCanvas.current;
    if (canvas) canvas.style.cursor = "";
  }, [editing, tool, p.exploring, focusing, p.paused, selected]);
  useEffect(() => endHover(), [p.viewRef.current, p.map, size]);

  function tap(x: number, y: number, kind: PointerKind) {
    const v = viewNow();
    const now = p.mapRef.current;
    if (!v || !now) return;
    const position = v.unproject(x, y);

    if (p.exploring && !editing) {
      p.explore(position);
      return;
    }

    if (editing && (tool === "find" || tool === "paths")) {
      const how = { alt: altHeld.current, shift: shiftHeld.current, kind };
      p.find?.current?.tap({ x, y }, how);
      return;
    }
    if (editing && (tool === "marker" || tool === "label")) {
      if (!position) return;
      const place = tool === "marker" ? placeMarker : placeLabel;
      p.apply(place(now, p.activeLayer, position));
      return;
    }
    if (editing && (tool === "path" || tool === "zone" || tool === "measure" || tool === "place")) {
      if (!p.map) return;
      const snapped = snapFor({ x, y }, null);
      const step = addSketchPoint(
        p.map,
        v,
        tool,
        p.sketch,
        p.activeLayer,
        snapped ? snapped.screen : [x, y],
        p.curve,
        snapped?.at,
      );
      if (step) p.apply(step);
      return;
    }

    // A "+" of the selected feature puts a point there, on the line, and picks it.
    const target = editing ? context().pick({ x, y }, kind) : null;
    const drawn = p.resolvedRef.current.find((r) => r.feature.id === selected);
    if (target?.kind === "insert" && drawn) {
      const done = insertPoint(now, drawn, target.segment, target.at);
      if (done) {
        p.setFeature(done.feature);
        p.apply({ vertex: done.vertex });
      }
      return;
    }

    const step = tapSelect(v, editing, chosen(), p.shapes.current, [x, y]);
    // A corner of the selected shape is picked here; what a tap selects, the page decides.
    if (step.selected === undefined) return p.apply(step);
    p.apply({ vertex: null });
    // The piece of a feature under the tap, past any group's name written over it.
    const ids = new Set(now.features.map((f) => f.id));
    const piece = shapeAt(
      p.shapes.current.filter((s) => ids.has(s.id)),
      [x, y],
    );
    p.pickTap(step.selected, { add: editing && addHeld.current, kind, piece });
  }

  function carryOut(effect: Effect, e: GestureEvent) {
    const state = p.viewRef.current;
    switch (effect.type) {
      case "hover":
        if (drawing() || bandAt.current || snapMark.current) {
          bandAt.current = drawing() ? effect.at : null;
          snapMark.current = drawing() ? snapFor(effect.at, null) : null;
          paintLive();
        }
        hover(effect.target, effect.at);
        if (editing && (tool === "find" || tool === "paths")) p.find?.current?.hover(effect.at);
        return;
      case "cursor":
        // Set on the canvas directly: the cursor follows every move without drawing the page.
        if (p.topCanvas.current) p.topCanvas.current.style.cursor = effect.name;
        return;
      case "tap":
        tap(effect.at.x, effect.at.y, effect.kind);
        return;
      case "beginStep":
        dragStart.current = null;
        groupStart.current = null;
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
        moveView(panBy(state, effect.dx, effect.dy));
        return;
      case "zoom":
        if (!state) return;
        moveView(zoomAt(state, size.width, size.height, effect.cx, effect.cy, effect.factor));
        return;
      case "dragTo": {
        const view = viewNow();
        const { target } = effect;
        if (target.kind === "stop") {
          p.find?.current?.dragStop?.(target.index, effect.at);
          return;
        }
        // A corner, or a point pulled out of a "+", snaps to the paths and zones beside it.
        const snapped =
          target.kind === "corner" || target.kind === "insert"
            ? snapFor(effect.at, target.feature)
            : null;
        if (snapped || snapMark.current) {
          snapMark.current = snapped;
          paintLive();
        }
        const position = snapped?.at ?? view?.unproject(effect.at.x, effect.at.y);
        const now = p.mapRef.current;
        const drawn = p.resolvedRef.current.find((r) => r.feature.id === effect.target.feature);
        // When the pointer leaves the globe, what is dragged stays where it last was.
        if (!view || !position || !now) return;
        if (!drawn && target.kind !== "group" && target.kind !== "groupName") return;
        if (target.kind === "groupName") {
          // Placed by hand: it stays where it is put, relative to the map.
          const group = now.groups?.find((g) => g.id === target.feature);
          if (!group) return;
          p.change(
            {
              ...now,
              groups: now.groups!.map((g) => (g.id === group.id ? { ...g, at: position } : g)),
            },
            false,
          );
          return;
        }
        if (target.kind === "group") {
          const from = view.unproject(effect.from.x, effect.from.y);
          if (from) moveGroup(now, target.feature, from, position);
          return;
        }
        if (!drawn) return;
        if (target.kind === "insert" || target.kind === "zone") {
          // Both start from the shape as it was at the press, so neither drifts.
          if (dragStart.current?.feature !== target.feature && isLined(drawn.feature)) {
            dragStart.current = { feature: target.feature, points: drawn.feature.points };
          }
          const start = dragStart.current;
          if (!start) return;
          const before: Resolved = {
            ...drawn,
            feature: { ...drawn.feature, points: start.points } as MapFeature,
          };
          if (target.kind === "insert") {
            const done = insertPoint(now, before, target.segment, position);
            if (!done) return;
            p.setFeature(done.feature, false);
            p.apply({ vertex: done.vertex });
          } else {
            const from = view.unproject(effect.from.x, effect.from.y);
            const next = from ? moveZone(now, before, start.points, from, position) : null;
            if (next) p.setFeature(next, false);
          }
          return;
        }
        const vertex = target.kind === "corner" ? target.vertex : null;
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

  /**
   * Moves every piece of a group, and its name placed by hand, as the pointer went from `from` to
   * `to`: each from where it was when the drag began, so nothing drifts. One change of the map.
   */
  function moveGroup(now: MapFile, id: string, from: Position, to: Position) {
    const s = space();
    if (!s) return;
    if (groupStart.current?.group !== id) {
      groupStart.current = {
        group: id,
        pieces: p.resolvedRef.current
          .filter((r) => r.feature.group === id)
          .map((r) => ({
            resolved: r,
            points: isLined(r.feature) ? r.feature.points : [r.feature.at],
          })),
        at: now.groups?.find((g) => g.id === id)?.at ?? null,
      };
    }
    const start = groupStart.current;
    const moved = new Map<string, MapFeature>();
    for (const { resolved, points } of start.pieces) {
      const feature = now.features.find((f) => f.id === resolved.feature.id);
      if (!feature) continue;
      const to2 = moveBy(s, points, from, to);
      const shape = isLined(resolved.feature) ? { points: to2 } : { at: to2[0]! };
      moved.set(feature.id, writeShape(feature, resolved.shape, shape));
    }
    const at = start.at ? moveBy(s, [start.at], from, to)[0]! : null;
    p.change(
      {
        ...now,
        features: now.features.map((f) => moved.get(f.id) ?? f),
        ...(at && now.groups
          ? { groups: now.groups.map((g) => (g.id === id ? { ...g, at } : g)) }
          : {}),
      },
      false,
    );
  }

  const context = (): GestureContext => ({
    focusing,
    spaceHeld: spaceHeld.current,
    placing: editing ? tool !== "select" : p.exploring,
    pick: (at, kind) => {
      const view = viewNow();
      const s = space();
      if (!view || !s) return null;
      if (editing && tool === "paths") {
        const stop = p.find?.current?.grab?.(at, kind) ?? null;
        return stop === null ? null : { kind: "stop", feature: String(stop), index: stop };
      }
      return pick(
        {
          space: s,
          view,
          editing,
          tool,
          chosen: chosen(),
          shapes: p.shapes.current,
          group: p.group,
        },
        at,
        kind,
      );
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
    altHeld.current = e.altKey;
    if (type === "down") addHeld.current = e.shiftKey || e.ctrlKey || e.metaKey;
    shiftHeld.current = e.shiftKey;
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
      p.onPressKind(event.kind);
      // Pressing the map gives its frame the focus, so the keys act again after a button.
      // No focus ring: the press itself shows where the focus went.
      p.frame.current?.focus({ preventScroll: true, focusVisible: false } as FocusOptions);
    }
    const { before, state } = run(event);
    if (before.name === "drag" && state.name !== "drag" && before.target.kind === "stop") {
      p.find?.current?.dropStop?.();
    }
    // Whatever was pressed keeps the pointer until it is lifted, even off the canvas.
    if (type === "down" && state !== before) {
      (e.target as Element).setPointerCapture(e.pointerId);
    }
    if (state.name === "idle" && p.coarse.current) {
      p.coarse.current = false;
      p.redrawNow();
    }
    // A drag that ended takes its snap mark with it; while drawing, the next move sets it again.
    if (state.name === "idle" && before.name !== "idle" && snapMark.current) {
      snapMark.current = null;
      paintLive();
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
      // The middle button pans the map; the browser's own scrolling would fight it.
      onMouseDown: (e: React.MouseEvent) => e.button === 1 && e.preventDefault(),
      // Leaving the frame ends the hover.
      onPointerLeave: (e: React.PointerEvent) => {
        if (machine.current.name === "idle" && e.pointerType === "mouse") endHover();
      },
    },
  };
}
