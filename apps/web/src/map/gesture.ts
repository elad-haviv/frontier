/**
 * The pointer on the map as one state machine: pure, with no React and no DOM. `step` takes the
 * state, one pointer event and what the machine may look at, and returns the next state and the
 * effects for the page to carry out (usePointer.ts does that).
 *
 * | State          | Left on                                                                  |
 * | -------------- | ------------------------------------------------------------------------ |
 * | `idle`         | a press: `press`, or `box` while focusing                                 |
 * | `press`        | a move past the threshold: `drag` on a draggable target, else `pan`;     |
 * |                | release: a tap; a second finger: `pinch`                                 |
 * | `pan`, `drag`  | release: `idle`; a second finger: `pinch`                                |
 * | `pinch`        | one finger lifted: `pan` with the other, never a tap                     |
 * | `box`          | release: `focus` if big enough; a second finger: `boxCancelled`          |
 * | `boxCancelled` | the last finger lifted: `idle`                                           |
 *
 * A `cancel` ends any state as a release that never taps. The primary button of a mouse starts a
 * gesture; the middle one, or the primary with Space held, only pans; a touch or a pen always
 * starts one. Two fingers zoom about their midpoint and pan by its movement.
 *
 * A mouse moving over the map in `idle` hovers: the machine says what is under it and which
 * cursor to show. Touch and pen moves never hover, since a touch screen has no hover.
 */
import {
  HANDLE_REACH,
  handleAt,
  type Point as ScreenPoint,
  pointInPolygon,
  type Position,
  type Shape,
  shapeAt,
  type Space,
  vertexAt,
  type View,
} from "@frontier/geo";
import type { MapFeature } from "@frontier/schema";
import { plusHandles } from "./handles.ts";
import type { Tool } from "./tools.ts";

export type PointerKind = "mouse" | "touch" | "pen";

export interface Point {
  x: number;
  y: number;
}

/** A box on the screen: where it was started, then where it reaches. */
export type Rect = [number, number, number, number];

/**
 * What lies under a press. Only the selected feature's parts can be dragged: a corner, a "+" (which
 * adds a point there), the marker, or the inside of the zone (which moves the whole zone).
 */
export type Target =
  | { kind: "corner"; feature: string; vertex: number }
  | { kind: "insert"; feature: string; segment: number; at: Position }
  | { kind: "marker"; feature: string }
  | { kind: "zone"; feature: string }
  | { kind: "feature"; feature: string };
export type DragTarget = Exclude<Target, { kind: "feature" }>;

export interface GestureEvent {
  type: "down" | "move" | "up" | "cancel";
  id: number;
  kind: PointerKind;
  /** The button pressed, for a `down`: 0 is the primary one. */
  button: number;
  at: Point;
}

/** What the machine may look at. */
export interface GestureContext {
  /** A press marks a box to focus on. */
  focusing: boolean;
  /** Space is held: a press pans, whatever is under it. */
  spaceHeld?: boolean;
  /**
   * A tap places something rather than selects: a drawing tool while editing, or exploring.
   * Nothing is hovered then, and the cursor is a crosshair.
   */
  placing?: boolean;
  /** What lies under a point of the screen. */
  pick: (at: Point, kind: PointerKind) => Target | null;
}

/** The cursors the map shows, by what is under the pointer and what a press would do. */
export type Cursor = "pointer" | "grab" | "grabbing" | "crosshair" | "move" | "copy";

export type Effect =
  | { type: "pan"; dx: number; dy: number }
  | { type: "zoom"; cx: number; cy: number; factor: number }
  | { type: "tap"; at: Point; kind: PointerKind }
  /** Remembers the map once, before a drag first moves it, so the drag is one step to undo. */
  | { type: "beginStep" }
  /** Moves what is dragged to the pointer; `from` is where the press began. */
  | { type: "dragTo"; target: DragTarget; at: Point; from: Point }
  /** The box being marked, or null when there is none. */
  | { type: "box"; rect: Rect | null }
  /** Fits the view to a box, given as its left, top, right and bottom. */
  | { type: "focus"; rect: Rect }
  /** What a mouse is over, or null for nothing; `at` is where it is. */
  | { type: "hover"; target: Target | null; at: Point }
  | { type: "cursor"; name: Cursor };

interface Finger {
  id: number;
  kind: PointerKind;
  at: Point;
}

export type GestureState =
  | { name: "idle" }
  /** A press that has not moved past the threshold; `at` is where it began. */
  | ({ name: "press"; target: Target | null } & Finger)
  | ({ name: "pan" } & Finger)
  | ({ name: "drag"; target: DragTarget; from: Point } & Finger)
  | { name: "pinch"; fingers: [Finger, Finger]; distance: number }
  | { name: "box"; id: number; from: Point; to: Point }
  | { name: "boxCancelled"; ids: number[] };

export const IDLE: GestureState = { name: "idle" };

/** How far a press moves before it is a drag or a pan, by the kind of pointer. */
export const THRESHOLD: Record<PointerKind, number> = { mouse: 6, touch: 10, pen: 10 };

/** The smallest box, each way, that focuses: a smaller one is a slip of the finger. */
export const SMALLEST_BOX = 12;

export interface Stepped {
  state: GestureState;
  effects: Effect[];
}

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const stay = (state: GestureState): Stepped => ({ state, effects: [] });
const draggable = (t: Target | null): t is DragTarget => t !== null && t.kind !== "feature";

/** A pointer type as the browser names it, as one of the machine's kinds. */
export function kindOf(pointerType: string): PointerKind {
  return pointerType === "touch" || pointerType === "pen" ? pointerType : "mouse";
}

/** The cursor over a target: what a press there would do. */
export function cursorFor(
  target: Target | null,
  ctx: Pick<GestureContext, "focusing" | "placing">,
): Cursor {
  if (ctx.focusing || ctx.placing) return "crosshair";
  if (target?.kind === "insert") return "copy";
  if (draggable(target)) return "move";
  return target ? "pointer" : "grab";
}

/** What a mouse at a point hovers, and the cursor there. */
function hoverAt(at: Point, ctx: GestureContext): Effect[] {
  const target = ctx.focusing || ctx.placing ? null : ctx.pick(at, "mouse");
  return [
    { type: "hover", target, at },
    { type: "cursor", name: cursorFor(target, ctx) },
  ];
}

/** A second finger: the two pinch from where they are. */
function pinch({ id, kind, at }: Finger, second: Finger): Stepped {
  return stay({
    name: "pinch",
    fingers: [{ id, kind, at }, second],
    distance: distance(at, second.at),
  });
}

const MIDDLE = 1;

export function step(state: GestureState, e: GestureEvent, ctx: GestureContext): Stepped {
  // The primary button of a mouse starts a gesture and the middle one pans; the others are left
  // alone.
  if (e.type === "down" && e.kind === "mouse" && e.button !== 0 && e.button !== MIDDLE) {
    return stay(state);
  }
  const finger: Finger = { id: e.id, kind: e.kind, at: e.at };
  const lifted = e.type === "up" || e.type === "cancel";

  switch (state.name) {
    case "idle": {
      // A mouse moving with nothing pressed hovers; a touch or a pen never does.
      if (e.type === "move" && e.kind === "mouse") return { state, effects: hoverAt(e.at, ctx) };
      if (e.type !== "down") return stay(state);
      if (ctx.focusing) {
        // Marking a box to focus on comes before every other use of a drag.
        return {
          state: { name: "box", id: e.id, from: e.at, to: e.at },
          effects: [{ type: "box", rect: [e.at.x, e.at.y, e.at.x, e.at.y] }],
        };
      }
      // The middle button, or Space held, pans over anything, the selected zone too.
      const panOnly = (e.kind === "mouse" && e.button === MIDDLE) || ctx.spaceHeld === true;
      if (panOnly) {
        return {
          state: { name: "pan", ...finger },
          effects: e.kind === "mouse" ? [{ type: "hover", target: null, at: e.at }] : [],
        };
      }
      const pressed: GestureState = { name: "press", ...finger, target: ctx.pick(e.at, e.kind) };
      // A press ends the hover: the name and the preview close.
      if (e.kind === "mouse") {
        return { state: pressed, effects: [{ type: "hover", target: null, at: e.at }] };
      }
      return stay(pressed);
    }

    case "press": {
      if (e.type === "down") return pinch(state, finger);
      if (e.id !== state.id) return stay(state);
      if (e.type === "up") {
        // However long it was held, a press that did not move is a tap where it began.
        return { state: IDLE, effects: [{ type: "tap", at: state.at, kind: state.kind }] };
      }
      if (e.type === "cancel") return stay(IDLE);
      // Not a drag yet: measured from where the press began, so none of the way is lost.
      if (distance(e.at, state.at) < THRESHOLD[state.kind]) return stay(state);
      if (draggable(state.target)) {
        const from = state.at;
        return {
          state: { name: "drag", id: e.id, kind: state.kind, at: e.at, target: state.target, from },
          effects: [
            { type: "beginStep" },
            { type: "dragTo", target: state.target, at: e.at, from },
          ],
        };
      }
      const pan: Effect = { type: "pan", dx: e.at.x - state.at.x, dy: e.at.y - state.at.y };
      return {
        state: { name: "pan", id: e.id, kind: state.kind, at: e.at },
        effects: state.kind === "mouse" ? [{ type: "cursor", name: "grabbing" }, pan] : [pan],
      };
    }

    case "pan":
    case "drag": {
      if (e.type === "down") return pinch(state, finger);
      if (e.id !== state.id) return stay(state);
      // A mouse let go hovers again where it is, so the cursor says what is under it.
      if (lifted) return { state: IDLE, effects: state.kind === "mouse" ? hoverAt(e.at, ctx) : [] };
      const effect: Effect =
        state.name === "drag"
          ? { type: "dragTo", target: state.target, at: e.at, from: state.from }
          : { type: "pan", dx: e.at.x - state.at.x, dy: e.at.y - state.at.y };
      return { state: { ...state, at: e.at }, effects: [effect] };
    }

    case "pinch": {
      const i = state.fingers.findIndex((f) => f.id === e.id);
      // A third finger, or one that is not down, changes nothing.
      if (e.type === "down" || i < 0) return stay(state);
      const other = state.fingers[1 - i]!;
      // One finger lifted: the other pans from where it is, and never taps.
      if (lifted) return stay({ name: "pan", ...other });
      const fingers: [Finger, Finger] = i === 0 ? [finger, other] : [other, finger];
      const [a, b] = fingers;
      const now = distance(a.at, b.at);
      // The midpoint's movement pans; the change in spread zooms about the midpoint.
      const [was0, was1] = state.fingers;
      const cx = (a.at.x + b.at.x) / 2;
      const cy = (a.at.y + b.at.y) / 2;
      const dx = cx - (was0.at.x + was1.at.x) / 2;
      const dy = cy - (was0.at.y + was1.at.y) / 2;
      const effects: Effect[] = dx !== 0 || dy !== 0 ? [{ type: "pan", dx, dy }] : [];
      if (now > 0 && state.distance > 0) {
        effects.push({ type: "zoom", cx, cy, factor: now / state.distance });
      }
      return {
        state: { name: "pinch", fingers, distance: now > 0 ? now : state.distance },
        effects,
      };
    }

    case "box": {
      if (e.type === "down") {
        // A second finger cancels the box; focusing stays on.
        return {
          state: { name: "boxCancelled", ids: [state.id, e.id] },
          effects: [{ type: "box", rect: null }],
        };
      }
      if (e.id !== state.id) return stay(state);
      if (e.type === "move") {
        if (!ctx.focusing) return stay(state);
        const next = { ...state, to: e.at };
        return {
          state: next,
          effects: [{ type: "box", rect: [state.from.x, state.from.y, e.at.x, e.at.y] }],
        };
      }
      const effects: Effect[] = [{ type: "box", rect: null }];
      const [x0, x1] = [Math.min(state.from.x, state.to.x), Math.max(state.from.x, state.to.x)];
      const [y0, y1] = [Math.min(state.from.y, state.to.y), Math.max(state.from.y, state.to.y)];
      if (ctx.focusing && x1 - x0 >= SMALLEST_BOX && y1 - y0 >= SMALLEST_BOX) {
        effects.push({ type: "focus", rect: [x0, y0, x1, y1] });
      }
      return { state: IDLE, effects };
    }

    case "boxCancelled": {
      if (e.type === "down") return stay({ ...state, ids: [...state.ids, e.id] });
      if (!lifted) return stay(state);
      const ids = state.ids.filter((id) => id !== e.id);
      return stay(ids.length > 0 ? { ...state, ids } : IDLE);
    }
  }
}

/** What `pick` looks at: the view, the mode and tool, the selection as shown, and the shapes drawn. */
export interface PickInput {
  space: Space;
  view: View;
  editing: boolean;
  tool: Tool;
  /** The selected feature with its shape on screen. */
  chosen: MapFeature | undefined;
  /** The shapes on the screen, as the overlay drew them. */
  shapes: Shape[];
}

/** Stands in for a point that is not on the screen: never within reach. */
const FAR: ScreenPoint = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];

/**
 * What a press is on, in this order, the first three only while editing with Select: a corner of
 * the selected path or zone; one of its "+" handles (shown, and found, by the pointer's kind); the
 * selected marker, or the inside of the selected zone; then any feature; then nothing.
 */
export function pick(input: PickInput, at: Point, kind: PointerKind = "mouse"): Target | null {
  const { view, chosen } = input;
  const p: ScreenPoint = [at.x, at.y];
  if (input.editing && input.tool === "select" && chosen) {
    if (chosen.kind === "marker") {
      const s = view.project(chosen.at);
      if (s && Math.hypot(s[0] - at.x, s[1] - at.y) < 24) {
        return { kind: "marker", feature: chosen.id };
      }
    } else if (chosen.kind === "label") {
      // A label is dragged from anywhere on its words, as a marker is from its dot.
      if (insideDrawn(input.shapes, chosen.id, p)) return { kind: "marker", feature: chosen.id };
    } else {
      // A corner on the far side of a globe is not drawn, so it cannot be picked.
      const corner = vertexAt(
        chosen.points.map((q) => view.project(q) ?? FAR),
        p,
      );
      if (corner !== null) return { kind: "corner", feature: chosen.id, vertex: corner };
      const pluses = plusHandles(input.space, view, chosen, kind);
      const plus = handleAt(
        pluses.map((h) => h.screen),
        p,
        HANDLE_REACH,
      );
      if (plus !== null) {
        const { segment, at: position } = pluses[plus]!;
        return { kind: "insert", feature: chosen.id, segment, at: position };
      }
      if (chosen.kind === "zone" && insideDrawn(input.shapes, chosen.id, p)) {
        return { kind: "zone", feature: chosen.id };
      }
    }
  }
  const feature = shapeAt(input.shapes, p);
  return feature === null ? null : { kind: "feature", feature };
}

/** Whether a point of the screen is inside a zone as it was drawn, by any of its pieces. */
function insideDrawn(shapes: Shape[], id: string, p: ScreenPoint): boolean {
  return shapes.some(
    (s) =>
      s.id === id &&
      s.kind === "zone" &&
      (s.inside ? s.inside(p) : s.points.length >= 3 && pointInPolygon(p, s.points)),
  );
}

/**
 * What a right-click acts on: a corner or a "+" of the selected feature, a feature, or an empty
 * place.
 */
export type MenuTarget =
  | { kind: "corner"; feature: string; vertex: number }
  | { kind: "insert"; feature: string; segment: number; at: Position }
  | { kind: "feature"; feature: string }
  | { kind: "nothing" };

/** The context menu's target from what `pick` found: the selected marker or zone is a feature. */
export function menuTargetOf(target: Target | null): MenuTarget {
  if (!target) return { kind: "nothing" };
  if (target.kind === "corner" || target.kind === "insert") return target;
  return { kind: "feature", feature: target.feature };
}
