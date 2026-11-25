import type { Shape, Space, View } from "@frontier/geo";
import type { MapFeature } from "@frontier/schema";
import { describe, expect, it } from "vitest";
import {
  cursorFor,
  type Effect,
  type GestureContext,
  type GestureEvent,
  type GestureState,
  IDLE,
  kindOf,
  menuTargetOf,
  pick,
  type PickInput,
  type PointerKind,
  step,
  type Target,
} from "./gesture.ts";

const KINDS: PointerKind[] = ["mouse", "touch", "pen"];

/** Builds pointer events: `down(1, 10, 20)` presses pointer 1 at (10, 20). */
const event =
  (type: GestureEvent["type"]) =>
  (id: number, x: number, y: number, kind: PointerKind = "touch", button = 0): GestureEvent => ({
    type,
    id,
    kind,
    button,
    at: { x, y },
  });
const down = event("down");
const move = event("move");
const up = event("up");
const cancel = event("cancel");

const corner: Target = { kind: "corner", feature: "z1", vertex: 2 };
const markerBody: Target = { kind: "marker", feature: "m1" };
const plusHandle: Target = { kind: "insert", feature: "z1", segment: 0, at: [50, 0] };
const zoneBody: Target = { kind: "zone", feature: "z1" };
const feature: Target = { kind: "feature", feature: "p1" };

/** What the machine sees: nothing under the pointer unless a target is given. */
const context = (
  target: Target | null = null,
  focusing = false,
  spaceHeld = false,
): GestureContext => ({
  focusing,
  spaceHeld,
  pick: () => target,
});

/** Whether an effect is the hover's: what is under a mouse, and the cursor. */
const hovers = (e: Effect) => e.type === "hover" || e.type === "cursor";

/**
 * Runs events from a state, and gives the last state and every effect on the way. The hover's
 * effects are left out unless asked for, so the gestures read on their own.
 */
function run(
  events: GestureEvent[],
  ctx = context(),
  from: GestureState = IDLE,
  withHover = false,
) {
  let state = from;
  const effects: Effect[] = [];
  for (const e of events) {
    const next = step(state, e, ctx);
    state = next.state;
    effects.push(...next.effects.filter((x) => withHover || !hovers(x)));
  }
  return { state, effects };
}

const types = (effects: Effect[]) => effects.map((e) => e.type);

describe("idle", () => {
  it.each(KINDS)("a %s press becomes a press, remembering what is under it", (kind) => {
    const { state, effects } = run([down(1, 10, 20, kind)], context(corner));
    expect(state).toEqual({ name: "press", id: 1, kind, at: { x: 10, y: 20 }, target: corner });
    expect(effects).toEqual([]);
  });

  it("passes the pointer kind to pick", () => {
    const seen: PointerKind[] = [];
    step(IDLE, down(1, 0, 0, "pen"), {
      focusing: false,
      pick: (_, kind) => {
        seen.push(kind);
        return null;
      },
    });
    expect(seen).toEqual(["pen"]);
  });

  it("ignores moves and releases with nothing pressed", () => {
    for (const e of [move(1, 5, 5), up(1, 5, 5), cancel(1, 5, 5)]) {
      expect(step(IDLE, e, context())).toEqual({ state: IDLE, effects: [] });
    }
  });

  it("pans with the middle button over anything, and never taps", () => {
    const { state, effects } = run(
      [down(1, 10, 10, "mouse", 1), move(1, 60, 60, "mouse"), up(1, 60, 60, "mouse")],
      context(zoneBody),
    );
    expect(state).toBe(IDLE);
    expect(effects).toEqual([{ type: "pan", dx: 50, dy: 50 }]);
    // Let go without moving, it is no tap either.
    expect(run([down(1, 0, 0, "mouse", 1), up(1, 0, 0, "mouse")]).effects).toEqual([]);
  });

  it.each(KINDS)("pans with Space held, even on the selected zone (%s)", (kind) => {
    const { effects } = run(
      [down(1, 0, 0, kind), move(1, 3, 4, kind), up(1, 3, 4, kind)],
      context(zoneBody, false, true),
    );
    expect(effects).toEqual([{ type: "pan", dx: 3, dy: 4 }]);
  });

  it.each([2, 3, 4])("ignores a mouse press of button %i", (button) => {
    const { state, effects } = run(
      [down(1, 10, 10, "mouse", button), move(1, 60, 60, "mouse"), up(1, 60, 60, "mouse")],
      context(feature),
    );
    expect(state).toBe(IDLE);
    expect(effects).toEqual([]);
  });

  it("counts a touch or pen press whatever its button says", () => {
    for (const kind of ["touch", "pen"] as const) {
      expect(run([down(1, 0, 0, kind, 2)]).state.name).toBe("press");
    }
  });

  it("while focusing, a press starts a box instead", () => {
    const { state, effects } = run([down(1, 10, 20, "mouse")], context(corner, true));
    expect(state).toEqual({ name: "box", id: 1, from: { x: 10, y: 20 }, to: { x: 10, y: 20 } });
    expect(effects).toEqual([{ type: "box", rect: [10, 20, 10, 20] }]);
  });

  it("a non-primary mouse button marks no box either", () => {
    expect(run([down(1, 0, 0, "mouse", 2)], context(null, true)).state).toBe(IDLE);
  });
});

describe("press", () => {
  it.each([
    ["mouse", 5, 6],
    ["touch", 9, 10],
    ["pen", 9, 10],
  ] as const)("a %s press is a tap below %i px and a pan from %i px", (kind, still, moved) => {
    const tapped = run([
      down(1, 100, 100, kind),
      move(1, 100 + still, 100, kind),
      up(1, 0, 0, kind),
    ]);
    expect(tapped.state).toBe(IDLE);
    // The tap is where the press began.
    expect(tapped.effects).toEqual([{ type: "tap", at: { x: 100, y: 100 }, kind }]);

    const panned = run([
      down(1, 100, 100, kind),
      move(1, 100, 100 + moved, kind),
      up(1, 0, 0, kind),
    ]);
    expect(panned.effects).toEqual([{ type: "pan", dx: 0, dy: moved }]);
  });

  it("measures the threshold from where the press began, so none of the way is lost", () => {
    const { state, effects } = run([down(1, 0, 0), move(1, 6, 0), move(1, 0, 8), move(1, 8, 8)]);
    expect(state).toEqual({ name: "pan", id: 1, kind: "touch", at: { x: 8, y: 8 } });
    expect(effects).toEqual([{ type: "pan", dx: 8, dy: 8 }]);
  });

  it.each(KINDS)("a still %s press is a tap, however long it was held", (kind) => {
    const { effects } = run([down(1, 30, 40, kind), move(1, 31, 40, kind), up(1, 31, 40, kind)]);
    expect(effects).toEqual([{ type: "tap", at: { x: 30, y: 40 }, kind }]);
  });

  it.each(KINDS)("a cancelled %s press never taps", (kind) => {
    const { state, effects } = run([down(1, 30, 40, kind), cancel(1, 30, 40, kind)]);
    expect(state).toBe(IDLE);
    expect(effects).toEqual([]);
  });

  it("ignores another pointer's moves and releases", () => {
    const pressed = run([down(1, 0, 0)]).state;
    for (const e of [move(2, 50, 50), up(2, 50, 50), cancel(2, 50, 50)]) {
      expect(step(pressed, e, context()).state).toBe(pressed);
    }
  });

  it.each([corner, markerBody, plusHandle, zoneBody])(
    "moved on a $kind, it drags with one step to undo, from where the press began",
    (target) => {
      const { state, effects } = run(
        [down(1, 0, 0, "mouse"), move(1, 10, 0, "mouse"), move(1, 20, 5, "mouse"), up(1, 20, 5)],
        context(target),
      );
      expect(state).toBe(IDLE);
      const from = { x: 0, y: 0 };
      expect(effects).toEqual([
        { type: "beginStep" },
        { type: "dragTo", target, at: { x: 10, y: 0 }, from },
        { type: "dragTo", target, at: { x: 20, y: 5 }, from },
      ]);
    },
  );

  it('a press on a "+" that does not move is a tap there', () => {
    const { effects } = run([down(1, 5, 5, "touch"), up(1, 5, 5, "touch")], context(plusHandle));
    expect(effects).toEqual([{ type: "tap", at: { x: 5, y: 5 }, kind: "touch" }]);
  });

  it("moved on a feature that cannot be dragged, it pans", () => {
    const { effects } = run([down(1, 0, 0), move(1, 0, 12), move(1, 5, 20)], context(feature));
    expect(effects).toEqual([
      { type: "pan", dx: 0, dy: 12 },
      { type: "pan", dx: 5, dy: 8 },
    ]);
  });

  it.each(KINDS)("a second %s pointer makes a pinch, and the press never taps", (kind) => {
    const { state, effects } = run([
      down(1, 0, 0, kind),
      move(1, 3, 0, kind),
      down(2, 30, 40, kind),
      up(2, 30, 40, kind),
      up(1, 0, 0, kind),
    ]);
    expect(state).toBe(IDLE);
    expect(effects).toEqual([]);
  });

  it("a pinch from a press starts at where the press began", () => {
    const { state } = run([down(1, 0, 0), move(1, 3, 0), down(2, 30, 40)]);
    expect(state).toEqual({
      name: "pinch",
      fingers: [
        { id: 1, kind: "touch", at: { x: 0, y: 0 } },
        { id: 2, kind: "touch", at: { x: 30, y: 40 } },
      ],
      distance: 50,
    });
  });
});

describe("pan", () => {
  it.each(KINDS)("a %s pan moves by each step and ends on release", (kind) => {
    const { state, effects } = run([
      down(1, 0, 0, kind),
      move(1, 20, 0, kind),
      move(1, 25, 10, kind),
      up(1, 25, 10, kind),
    ]);
    expect(state).toBe(IDLE);
    expect(effects).toEqual([
      { type: "pan", dx: 20, dy: 0 },
      { type: "pan", dx: 5, dy: 10 },
    ]);
  });

  it("ends on a cancel without a tap", () => {
    const { state, effects } = run([down(1, 0, 0), move(1, 20, 0), cancel(1, 20, 0)]);
    expect(state).toBe(IDLE);
    expect(types(effects)).toEqual(["pan"]);
  });

  it("ignores another pointer's moves and releases", () => {
    const panning = run([down(1, 0, 0), move(1, 20, 0)]).state;
    for (const e of [move(2, 50, 50), up(2, 50, 50)]) {
      expect(step(panning, e, context()).state).toBe(panning);
    }
  });

  it("a second finger makes a pinch from where the first has got to", () => {
    const { state } = run([down(1, 0, 0), move(1, 20, 0), down(2, 20, 30)]);
    expect(state).toMatchObject({ name: "pinch", distance: 30 });
  });
});

describe("drag", () => {
  it("ends on release, and on a cancel without a tap", () => {
    for (const end of [up, cancel]) {
      const { state, effects } = run(
        [down(1, 0, 0), move(1, 20, 0), end(1, 20, 0)],
        context(corner),
      );
      expect(state).toBe(IDLE);
      expect(types(effects)).toEqual(["beginStep", "dragTo"]);
    }
  });

  it("ignores another pointer's moves", () => {
    const dragging = run([down(1, 0, 0), move(1, 20, 0)], context(corner)).state;
    expect(step(dragging, move(2, 50, 50), context()).state).toBe(dragging);
  });

  it("a second finger makes a pinch; the drag so far stays one step, and no more is dragged", () => {
    const { state, effects } = run(
      [
        down(1, 0, 0),
        move(1, 20, 0),
        down(2, 20, 30),
        move(1, 10, 0),
        move(2, 20, 60),
        up(2, 20, 60),
        up(1, 10, 0),
      ],
      context(markerBody),
    );
    expect(state).toBe(IDLE);
    expect(types(effects)).toEqual(["beginStep", "dragTo", "pan", "zoom", "pan", "zoom"]);
  });
});

describe("pinch", () => {
  const pinching = () => run([down(1, 0, 0), down(2, 100, 0)]).state;

  it("zooms about the fingers' middle by how far they spread, and pans as the middle moves", () => {
    const { state, effects } = run([move(2, 200, 0), move(1, -100, 100)], context(), pinching());
    expect(effects).toEqual([
      { type: "pan", dx: 50, dy: 0 },
      { type: "zoom", cx: 100, cy: 0, factor: 2 },
      { type: "pan", dx: -50, dy: 50 },
      { type: "zoom", cx: 50, cy: 50, factor: Math.hypot(300, 100) / 200 },
    ]);
    expect(state).toMatchObject({ name: "pinch", distance: Math.hypot(300, 100) });
  });

  it("two fingers moved together pan without zooming", () => {
    const { effects } = run([move(1, 0, 40), move(2, 100, 40)], context(), pinching());
    expect(effects).toEqual([
      { type: "pan", dx: 0, dy: 20 },
      { type: "zoom", cx: 50, cy: 20, factor: Math.hypot(100, 40) / 100 },
      { type: "pan", dx: 0, dy: 20 },
      { type: "zoom", cx: 50, cy: 40, factor: 100 / Math.hypot(100, 40) },
    ]);
  });

  it("does not zoom while the fingers meet", () => {
    const met = run([move(2, 0, 0)], context(), pinching());
    expect(types(met.effects)).toEqual(["pan"]);
    expect(met.state).toMatchObject({ name: "pinch", distance: 100 });
    // From fingers that started together, nothing zooms.
    const together = run([down(1, 0, 0), down(2, 0, 0), move(2, 50, 0)]);
    expect(types(together.effects)).toEqual(["pan"]);
  });

  it("one finger lifted pans with the other from where it is, and never taps", () => {
    const { state, effects } = run(
      [move(2, 150, 0), up(2, 150, 0), move(1, 0, 30), up(1, 0, 30)],
      context(feature),
      pinching(),
    );
    expect(state).toBe(IDLE);
    expect(effects).toEqual([
      { type: "pan", dx: 25, dy: 0 },
      { type: "zoom", cx: 75, cy: 0, factor: 1.5 },
      { type: "pan", dx: 0, dy: 30 },
    ]);
  });

  it("the finger left is the first or the second, lifted or cancelled", () => {
    expect(run([cancel(1, 0, 0)], context(), pinching()).state).toEqual({
      name: "pan",
      id: 2,
      kind: "touch",
      at: { x: 100, y: 0 },
    });
    expect(run([up(2, 0, 0)], context(), pinching()).state).toMatchObject({ name: "pan", id: 1 });
  });

  it("a finger left still and lifted is no tap", () => {
    const { effects } = run([up(2, 100, 0), up(1, 0, 0)], context(feature), pinching());
    expect(effects).toEqual([]);
  });

  it("ignores a third finger and pointers that are not down", () => {
    const state = pinching();
    for (const e of [down(3, 5, 5), move(3, 9, 9), up(3, 9, 9)]) {
      expect(step(state, e, context()).state).toBe(state);
    }
  });

  it("a second finger after one was lifted pinches again", () => {
    const { state } = run([up(2, 100, 0), down(3, 0, 40)], context(), pinching());
    expect(state).toMatchObject({ name: "pinch", distance: 40 });
  });
});

describe("box", () => {
  const focusing = context(null, true);

  it.each(KINDS)("a %s box of 12 px each way focuses, given left to right", (kind) => {
    const { state, effects } = run(
      [down(1, 50, 60, kind), move(1, 40, 70, kind), move(1, 38, 48, kind), up(1, 38, 48, kind)],
      focusing,
    );
    expect(state).toBe(IDLE);
    expect(effects).toEqual([
      { type: "box", rect: [50, 60, 50, 60] },
      { type: "box", rect: [50, 60, 40, 70] },
      { type: "box", rect: [50, 60, 38, 48] },
      { type: "box", rect: null },
      { type: "focus", rect: [38, 48, 50, 60] },
    ]);
  });

  it("a smaller box is ignored, and is no tap", () => {
    for (const [dx, dy] of [
      [11, 40],
      [40, 11],
      [0, 0],
    ] as const) {
      const { state, effects } = run([down(1, 0, 0), move(1, dx, dy), up(1, dx, dy)], focusing);
      expect(state).toBe(IDLE);
      expect(types(effects).filter((t) => t !== "box")).toEqual([]);
    }
  });

  it("a cancelled box ends as a release", () => {
    const { effects } = run([down(1, 0, 0), move(1, 30, 30), cancel(1, 30, 30)], focusing);
    expect(effects.at(-1)).toEqual({ type: "focus", rect: [0, 0, 30, 30] });
  });

  it("stops following, and does not focus, once focusing has been stopped", () => {
    const started = run([down(1, 0, 0)], focusing).state;
    const stopped = context(null, false);
    const { state, effects } = run([move(1, 30, 30), up(1, 30, 30)], stopped, started);
    expect(state).toBe(IDLE);
    expect(effects).toEqual([{ type: "box", rect: null }]);
  });

  it("ignores another pointer's moves and releases", () => {
    const boxing = run([down(1, 0, 0)], focusing).state;
    expect(step(boxing, move(2, 30, 30), focusing).state).toBe(boxing);
    expect(step(boxing, up(2, 30, 30), focusing).state).toBe(boxing);
  });

  it("a second finger cancels the box until the last finger is lifted; focusing stays on", () => {
    const { state, effects } = run(
      [
        down(1, 0, 0),
        move(1, 30, 30),
        down(2, 80, 80),
        move(1, 60, 60),
        move(2, 90, 90),
        down(3, 10, 10),
        up(2, 90, 90),
        cancel(3, 10, 10),
      ],
      focusing,
    );
    expect(state).toEqual({ name: "boxCancelled", ids: [1] });
    expect(effects.at(-1)).toEqual({ type: "box", rect: null });
    const ended = run([up(1, 60, 60)], focusing, state);
    expect(ended).toEqual({ state: IDLE, effects: [] });
    // The next press marks a box again.
    expect(run([down(4, 0, 0)], focusing, ended.state).state.name).toBe("box");
  });
});

describe("hover", () => {
  it("a mouse moving with nothing pressed hovers what is under it, with its cursor", () => {
    const { state, effects } = step(IDLE, move(1, 40, 50, "mouse"), context(feature));
    expect(state).toBe(IDLE);
    expect(effects).toEqual([
      { type: "hover", target: feature, at: { x: 40, y: 50 } },
      { type: "cursor", name: "pointer" },
    ]);
  });

  it.each(["touch", "pen"] as const)("a %s moving with nothing pressed hovers nothing", (kind) => {
    let asked = false;
    const ctx: GestureContext = {
      focusing: false,
      pick: () => {
        asked = true;
        return feature;
      },
    };
    expect(step(IDLE, move(1, 40, 50, kind), ctx)).toEqual({ state: IDLE, effects: [] });
    expect(asked).toBe(false);
  });

  it("the cursor says what a press would do", () => {
    const plain = { focusing: false };
    expect(cursorFor(null, plain)).toBe("grab");
    expect(cursorFor(feature, plain)).toBe("pointer");
    expect(cursorFor(corner, plain)).toBe("move");
    expect(cursorFor(markerBody, plain)).toBe("move");
    expect(cursorFor(zoneBody, plain)).toBe("move");
    expect(cursorFor(plusHandle, plain)).toBe("copy");
    for (const target of [null, feature, corner]) {
      expect(cursorFor(target, { focusing: true })).toBe("crosshair");
      expect(cursorFor(target, { focusing: false, placing: true })).toBe("crosshair");
    }
  });

  it("with a drawing tool or while focusing, nothing is hovered and the cursor is a crosshair", () => {
    for (const ctx of [
      { ...context(feature), placing: true },
      { ...context(feature), focusing: true },
    ]) {
      expect(step(IDLE, move(1, 1, 2, "mouse"), ctx).effects).toEqual([
        { type: "hover", target: null, at: { x: 1, y: 2 } },
        { type: "cursor", name: "crosshair" },
      ]);
    }
  });

  it("a mouse press ends the hover; a touch press has nothing to end", () => {
    expect(run([down(1, 5, 6, "mouse")], context(feature), IDLE, true).effects).toEqual([
      { type: "hover", target: null, at: { x: 5, y: 6 } },
    ]);
    expect(run([down(1, 5, 6, "touch")], context(feature), IDLE, true).effects).toEqual([]);
  });

  it("a mouse pan grabs, and once let go hovers again where it is", () => {
    const { effects } = run(
      [down(1, 0, 0, "mouse"), move(1, 20, 0, "mouse"), up(1, 20, 0, "mouse")],
      context(null),
      IDLE,
      true,
    );
    expect(effects).toEqual([
      { type: "hover", target: null, at: { x: 0, y: 0 } },
      { type: "cursor", name: "grabbing" },
      { type: "pan", dx: 20, dy: 0 },
      { type: "hover", target: null, at: { x: 20, y: 0 } },
      { type: "cursor", name: "grab" },
    ]);
  });

  it("a touch pan sets no cursor and hovers nothing once lifted", () => {
    const { effects } = run([down(1, 0, 0), move(1, 20, 0), up(1, 20, 0)], context(), IDLE, true);
    expect(effects).toEqual([{ type: "pan", dx: 20, dy: 0 }]);
  });

  it("a mouse drag of a corner keeps its cursor, and hovers the corner once let go", () => {
    const { effects } = run(
      [down(1, 0, 0, "mouse"), move(1, 20, 0, "mouse"), up(1, 20, 0, "mouse")],
      context(corner),
      IDLE,
      true,
    );
    expect(types(effects)).toEqual(["hover", "beginStep", "dragTo", "hover", "cursor"]);
    expect(effects.at(-1)).toEqual({ type: "cursor", name: "move" });
  });

  it("a mouse tap does not hover again: the next move does", () => {
    const { effects } = run(
      [down(1, 0, 0, "mouse"), up(1, 0, 0, "mouse")],
      context(feature),
      IDLE,
      true,
    );
    expect(types(effects)).toEqual(["hover", "tap"]);
  });
});

describe("menuTargetOf", () => {
  it("a corner stays a corner, the selected marker or any feature is a feature", () => {
    expect(menuTargetOf(corner)).toEqual(corner);
    expect(menuTargetOf(plusHandle)).toEqual(plusHandle);
    expect(menuTargetOf(zoneBody)).toEqual({ kind: "feature", feature: "z1" });
    expect(menuTargetOf(markerBody)).toEqual({ kind: "feature", feature: "m1" });
    expect(menuTargetOf(feature)).toEqual({ kind: "feature", feature: "p1" });
    expect(menuTargetOf(null)).toEqual({ kind: "nothing" });
  });
});

describe("kindOf", () => {
  it("names a browser's pointer types, and takes anything else for a mouse", () => {
    expect(["mouse", "touch", "pen", ""].map(kindOf)).toEqual(["mouse", "touch", "pen", "mouse"]);
  });
});

describe("pick", () => {
  /** A view whose screen is the map's own units; points past 1000 are off the screen. */
  const view = {
    project: (p: [number, number]) => (p[0] > 1000 ? null : p),
    projectClamped: (p: [number, number]) => ({ point: p }),
    unproject: (x: number, y: number) => [x, y],
  } as unknown as View;
  const base = { layer: "l1", entry: null, label: null, child: null };
  const zone = {
    id: "z1",
    kind: "zone",
    ...base,
    points: [
      [0, 0],
      [100, 0],
      [100, 100],
    ],
  } as MapFeature;
  const marker = { id: "m1", kind: "marker", ...base, at: [200, 200], icon: null } as MapFeature;
  const shapes: Shape[] = [
    { id: "z1", kind: "zone", points: zone.points as [number, number][] },
    { id: "m1", kind: "marker", at: [200, 200] },
  ];
  const input = (over: Partial<PickInput> = {}): PickInput => ({
    space: { kind: "flat", width: 1000, height: 1000, scale: null, unit: "" } as Space,
    view,
    editing: true,
    tool: "select",
    chosen: zone,
    shapes,
    ...over,
  });

  it("finds a corner of the selected path or zone first", () => {
    expect(pick(input(), { x: 98, y: 97 })).toEqual({ kind: "corner", feature: "z1", vertex: 2 });
  });

  it("drags the selected label from anywhere on its words, as a marker (16d)", () => {
    const words = { id: "w1", kind: "label", ...base, label: "Sea", at: [400, 400] } as MapFeature;
    const box: Shape = {
      id: "w1",
      kind: "zone",
      points: [
        [370, 390],
        [430, 390],
        [430, 410],
        [370, 410],
      ],
    };
    const over = { chosen: words, shapes: [...shapes, box] };
    expect(pick(input(over), { x: 425, y: 405 })).toEqual({ kind: "marker", feature: "w1" });
    expect(pick(input(over), { x: 500, y: 500 })).toBeNull();
  });

  it("drags a selected group by any piece, and its name to place it (stage 19)", () => {
    const name: Shape = {
      id: "g1",
      kind: "zone",
      points: [
        [40, 30],
        [80, 30],
        [80, 45],
        [40, 45],
      ],
    };
    const group = { id: "g1", members: new Set(["z1", "m1"]) };
    const over = { chosen: undefined, group, shapes: [...shapes, name] };
    expect(pick(input(over), { x: 60, y: 40 })).toEqual({ kind: "groupName", feature: "g1" });
    expect(pick(input(over), { x: 80, y: 60 })).toEqual({ kind: "group", feature: "g1" });
    expect(pick(input(over), { x: 205, y: 200 })).toEqual({ kind: "group", feature: "g1" });
    expect(pick(input(over), { x: 600, y: 600 })).toBeNull();
    // While viewing, a press finds the piece, to select.
    expect(pick(input({ ...over, editing: false }), { x: 80, y: 60 })).toEqual({
      kind: "feature",
      feature: "z1",
    });
  });

  it("then the selected marker, within 24 px", () => {
    const at = { x: 220, y: 210 };
    expect(pick(input({ chosen: marker }), at)).toEqual({ kind: "marker", feature: "m1" });
    expect(pick(input({ chosen: marker }), { x: 230, y: 230 })).toBeNull();
  });

  it("a selected marker off the screen is not found", () => {
    const far = { ...marker, at: [2000, 0] } as MapFeature;
    expect(pick(input({ chosen: far }), { x: 200, y: 200 })).toEqual({
      kind: "feature",
      feature: "m1",
    });
  });

  it('then a "+" at the middle of a segment, before the inside of the zone', () => {
    expect(pick(input(), { x: 52, y: 3 })).toEqual({
      kind: "insert",
      feature: "z1",
      segment: 0,
      at: [50, 0],
    });
    // The closing segment has its "+" too.
    expect(pick(input(), { x: 50, y: 50 })).toMatchObject({ kind: "insert", segment: 2 });
    expect(pick(input(), { x: 70, y: 30 })).toEqual({ kind: "zone", feature: "z1" });
  });

  it('shows a "+" only on a segment long enough for the pointer', () => {
    const small = {
      ...zone,
      points: [
        [0, 0],
        [40, 0],
        [40, 40],
      ],
    } as MapFeature;
    const at = { x: 20, y: 1 };
    // 40 px is room for a mouse's "+", not a finger's.
    expect(pick(input({ chosen: small }), at, "mouse")).toMatchObject({ kind: "insert" });
    expect(pick(input({ chosen: small }), at, "touch")).not.toMatchObject({ kind: "insert" });
  });

  it("the inside of another zone is only a feature", () => {
    const other = { ...zone, id: "z2" } as MapFeature;
    expect(pick(input({ chosen: other }), { x: 70, y: 30 })).toEqual({
      kind: "feature",
      feature: "z1",
    });
  });

  it("then any feature, then nothing", () => {
    expect(pick(input({ chosen: undefined }), { x: 70, y: 30 })).toEqual({
      kind: "feature",
      feature: "z1",
    });
    expect(pick(input({ chosen: undefined }), { x: 200, y: 200 })).toEqual({
      kind: "feature",
      feature: "m1",
    });
    expect(pick(input(), { x: 500, y: 500 })).toBeNull();
  });

  it("a corner on the far side of a globe cannot be picked", () => {
    const far = {
      ...zone,
      points: [
        [0, 0],
        [100, 0],
        [2000, 2000],
      ],
    } as MapFeature;
    // The clamped place of the far corner would be (2000, 2000); nothing is found near it.
    expect(pick(input({ chosen: far, shapes: [] }), { x: 2000, y: 2000 })).toBeNull();
    expect(pick(input({ chosen: far, shapes: [] }), { x: 99, y: 1 })).toEqual({
      kind: "corner",
      feature: "z1",
      vertex: 1,
    });
  });

  it("drags nothing while viewing or with another tool: a corner is only a feature", () => {
    for (const over of [{ editing: false }, { tool: "path" as const }]) {
      expect(pick(input(over), { x: 98, y: 97 })).toEqual({ kind: "feature", feature: "z1" });
    }
  });
});
