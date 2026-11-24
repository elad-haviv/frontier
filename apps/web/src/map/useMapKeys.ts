/**
 * The map's keys, in the `map` scope of the keys registry. Each acts in viewing, in editing or in
 * both, as keys.ts says; an action that does not apply returns false, so the key passes on. Keys a
 * focused control also uses (the arrows, Delete, Backspace, undo and redo) act only when the focus
 * is on the map's frame or on nothing.
 */
import { type RefObject, useEffect, useRef } from "react";
import { focusIsFree, useScope, useShortcut } from "../keys.ts";
import type { Tool } from "./tools.ts";

/** How far an arrow moves the map, and Shift with an arrow, in pixels. */
export const PAN_STEP = 80;
export const PAN_FAR = 320;

export interface MapKeys {
  editing: boolean;
  /** The map's frame: while it, or nothing, has the focus, the frame's keys are free. */
  frame: RefObject<HTMLElement | null>;
  focusing: boolean;
  stopFocus: () => void;
  /** A path, zone or measured line is being drawn. */
  drawing: boolean;
  cancelDrawing: () => void;
  /** Takes back the last point of the drawing: Delete or Backspace while drawing. */
  takeBack: () => void;
  /** Finishes the path or zone being drawn; false when it has too few points. */
  finish: () => boolean | void;
  /**
   * Turns curves on or off: for the next path or zone while a drawing tool is on, else for the
   * selected path or zone; false when neither applies.
   */
  toggleCurve: () => boolean | void;
  tool: Tool;
  /** The tools this map has: a schematic map has no measuring. */
  tools: Tool[];
  setTool: (tool: Tool) => void;
  vertex: number | null;
  clearVertex: () => void;
  selected: string | null;
  clearSelection: () => void;
  edit: () => void;
  done: () => void;
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  /** Deletes the picked point, or else the selection. */
  remove: () => void;
  zoom: (factor: number) => void;
  fit: () => void;
  pan: (dx: number, dy: number) => void;
  toggleLayers: () => void;
  /** Turns time on or off; false when the map has no time to turn on. */
  toggleTime: () => boolean | void;
  /** Snapping on or off. */
  toggleSnap: () => void;
}

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [1, 0],
  ArrowRight: [-1, 0],
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
};

/**
 * Esc, one step at a time: the focus box, then the drawing in progress (the tool stays), then a
 * tool other than Select, then the picked point, then the selection. False when none applies.
 */
export function cancelStep(k: MapKeys): boolean {
  if (k.focusing) {
    k.stopFocus();
    return true;
  }
  if (k.editing && k.drawing) {
    k.cancelDrawing();
    return true;
  }
  if (k.editing && k.tool !== "select") {
    k.setTool("select");
    return true;
  }
  if (k.editing && k.vertex !== null) {
    k.clearVertex();
    return true;
  }
  if (k.selected !== null) {
    k.clearSelection();
    return true;
  }
  return false;
}

export function useMapKeys(k: MapKeys) {
  useScope("map");
  // The arrow pressed: the registry's actions are not handed the event, so it is heard first,
  // on the way down to the registry's own listener.
  const lastKey = useRef("");
  useEffect(() => {
    const hear = (e: KeyboardEvent) => (lastKey.current = e.key);
    document.addEventListener("keydown", hear, { capture: true });
    return () => document.removeEventListener("keydown", hear, { capture: true });
  }, []);
  const free = () => focusIsFree(document.activeElement, k.frame.current);
  const { editing } = k;

  useShortcut("map.edit", () => (editing ? false : k.edit()));
  useShortcut("map.done", () => (editing ? k.done() : false));
  const tool = (t: Tool) => () => (editing && k.tools.includes(t) ? k.setTool(t) : false);
  useShortcut("map.select", tool("select"));
  useShortcut("map.marker", tool("marker"));
  useShortcut("map.path", tool("path"));
  useShortcut("map.zone", tool("zone"));
  useShortcut("map.measure", tool("measure"));
  useShortcut("map.label", tool("label"));
  useShortcut("map.place", tool("place"));
  useShortcut("map.find", tool("find"));
  useShortcut("map.snap", () => (editing && free() ? k.toggleSnap() : false));
  useShortcut("map.undo", () => (editing && free() && k.canUndo ? k.undo() : false));
  useShortcut("map.redo", () => (editing && free() && k.canRedo ? k.redo() : false));
  useShortcut("map.delete", () => {
    if (!editing || !free()) return false;
    if (k.drawing) return k.takeBack();
    return k.vertex !== null || k.selected !== null ? k.remove() : false;
  });
  useShortcut("map.finish", () =>
    editing && free() && k.drawing && (k.tool === "path" || k.tool === "zone") ? k.finish() : false,
  );
  useShortcut("map.curve", () => (editing ? k.toggleCurve() : false));
  useShortcut("map.cancel", () => cancelStep(k));
  useShortcut("map.zoomIn", () => k.zoom(1.6));
  useShortcut("map.zoomOut", () => k.zoom(1 / 1.6));
  useShortcut("map.fit", () => k.fit());
  const pan = (by: number) => () => {
    const way = ARROWS[lastKey.current];
    if (!way || !free()) return false;
    k.pan(way[0] * by, way[1] * by);
  };
  useShortcut("map.pan", pan(PAN_STEP));
  useShortcut("map.panFar", pan(PAN_FAR));
  useShortcut("map.layers", () => k.toggleLayers());
  useShortcut("map.time", () => k.toggleTime());
}
