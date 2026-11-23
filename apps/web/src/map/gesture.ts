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
 * A `cancel` ends any state as a release that never taps. Only the primary button of a mouse
 * starts a gesture; a touch or a pen always does.
 */
import { type Point as ScreenPoint, type Shape, shapeAt, vertexAt, type View } from "@frontier/geo";
import type { MapFeature } from "@frontier/schema";
import type { Tool } from "./tools.ts";

export type PointerKind = "mouse" | "touch" | "pen";

export interface Point {
  x: number;
  y: number;
}

/** A box on the screen: where it was started, then where it reaches. */
export type Rect = [number, number, number, number];

/** What lies under a press. Only a corner or the selected marker can be dragged. */
export type Target =
  | { kind: "corner"; feature: string; vertex: number }
  | { kind: "marker"; feature: string }
  | { kind: "feature"; feature: string };
export type DragTarget = Extract<Target, { kind: "corner" | "marker" }>;

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
  /** What lies under a point of the screen. */
  pick: (at: Point, kind: PointerKind) => Target | null;
}

export type Effect =
  | { type: "pan"; dx: number; dy: number }
  | { type: "zoom"; cx: number; cy: number; factor: number }
  | { type: "tap"; at: Point; kind: PointerKind }
  /** Remembers the map once, before a drag first moves it, so the drag is one step to undo. */
  | { type: "beginStep" }
  | { type: "dragTo"; target: DragTarget; at: Point }
  /** The box being marked, or null when there is none. */
  | { type: "box"; rect: Rect | null }
  /** Fits the view to a box, given as its left, top, right and bottom. */
  | { type: "focus"; rect: Rect };

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
  | ({ name: "drag"; target: DragTarget } & Finger)
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
const draggable = (t: Target | null): t is DragTarget =>
  t?.kind === "corner" || t?.kind === "marker";

/** A pointer type as the browser names it, as one of the machine's kinds. */
export function kindOf(pointerType: string): PointerKind {
  return pointerType === "touch" || pointerType === "pen" ? pointerType : "mouse";
}

/** A second finger: the two pinch from where they are. */
function pinch({ id, kind, at }: Finger, second: Finger): Stepped {
  return stay({
    name: "pinch",
    fingers: [{ id, kind, at }, second],
    distance: distance(at, second.at),
  });
}

export function step(state: GestureState, e: GestureEvent, ctx: GestureContext): Stepped {
  // Only the primary button of a mouse starts a gesture; the others are left alone.
  if (e.type === "down" && e.kind === "mouse" && e.button !== 0) return stay(state);
  const finger: Finger = { id: e.id, kind: e.kind, at: e.at };
  const lifted = e.type === "up" || e.type === "cancel";

  switch (state.name) {
    case "idle": {
      if (e.type !== "down") return stay(state);
      if (ctx.focusing) {
        // Marking a box to focus on comes before every other use of a drag.
        return {
          state: { name: "box", id: e.id, from: e.at, to: e.at },
          effects: [{ type: "box", rect: [e.at.x, e.at.y, e.at.x, e.at.y] }],
        };
      }
      return stay({ name: "press", ...finger, target: ctx.pick(e.at, e.kind) });
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
        return {
          state: { name: "drag", id: e.id, kind: state.kind, at: e.at, target: state.target },
          effects: [{ type: "beginStep" }, { type: "dragTo", target: state.target, at: e.at }],
        };
      }
      return {
        state: { name: "pan", id: e.id, kind: state.kind, at: e.at },
        effects: [{ type: "pan", dx: e.at.x - state.at.x, dy: e.at.y - state.at.y }],
      };
    }

    case "pan":
    case "drag": {
      if (e.type === "down") return pinch(state, finger);
      if (e.id !== state.id) return stay(state);
      if (lifted) return stay(IDLE);
      const effect: Effect =
        state.name === "drag"
          ? { type: "dragTo", target: state.target, at: e.at }
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
      if (now > 0 && state.distance > 0) {
        return {
          state: { name: "pinch", fingers, distance: now },
          effects: [
            {
              type: "zoom",
              cx: (a.at.x + b.at.x) / 2,
              cy: (a.at.y + b.at.y) / 2,
              factor: now / state.distance,
            },
          ],
        };
      }
      return stay({ ...state, fingers });
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
  view: View;
  editing: boolean;
  tool: Tool;
  /** The selected feature with its shape on screen. */
  chosen: MapFeature | undefined;
  /** The shapes on the screen, as the overlay drew them. */
  shapes: Shape[];
}

/**
 * What a press is on, in this order: a corner of the selected path or zone, the selected marker
 * (both only while editing with Select), then any feature, then nothing.
 */
export function pick(input: PickInput, at: Point): Target | null {
  const { view, chosen } = input;
  const p: ScreenPoint = [at.x, at.y];
  if (input.editing && input.tool === "select" && chosen) {
    if (chosen.kind === "marker") {
      const s = view.project(chosen.at);
      if (s && Math.hypot(s[0] - at.x, s[1] - at.y) < 24) {
        return { kind: "marker", feature: chosen.id };
      }
    } else {
      const corner = vertexAt(
        chosen.points.map((q) => view.projectClamped(q).point),
        p,
      );
      if (corner !== null) return { kind: "corner", feature: chosen.id, vertex: corner };
    }
  }
  const feature = shapeAt(input.shapes, p);
  return feature === null ? null : { kind: "feature", feature };
}
