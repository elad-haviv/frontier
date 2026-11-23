import { describe, expect, it } from "vitest";
import { makeView } from "@frontier/geo";
import { quadtree } from "d3-quadtree";
import {
  applyEffect,
  clampZoom,
  doubleClickOpens,
  type FlatView,
  type HitNode,
  hitTest,
  idle,
  move,
  press,
  release,
  tapAction,
  zoomBy,
} from "./pointer.ts";

const at = (x: number, y: number) => ({ x, y });

/** A press at (100, 100), a move by `d` to the right, and the release. */
function pressMoveRelease(touch: boolean, d: number) {
  let g = press(idle(), 1, at(100, 100), touch);
  const moved = move(g, 1, at(100 + d, 100));
  g = moved.gesture;
  return { moved: moved.effect, released: release(g, 1).effect };
}

describe("a press", () => {
  it("is a mouse click under 4 px of movement, and a pan from there", () => {
    expect(pressMoveRelease(false, 3).released).toEqual({
      kind: "tap",
      x: 103,
      y: 100,
      touch: false,
    });
    const pan = pressMoveRelease(false, 4);
    expect(pan.moved).toEqual({ kind: "pan", dx: 4, dy: 0 });
    expect(pan.released.kind).toBe("none");
  });

  it("is a tap under 10 px of movement on touch", () => {
    expect(pressMoveRelease(true, 9).released).toMatchObject({ kind: "tap", touch: true });
    expect(pressMoveRelease(true, 10).released.kind).toBe("none");
  });

  it("pans by each move once it is a pan", () => {
    let g = press(idle(), 1, at(0, 0), false);
    g = move(g, 1, at(10, 0)).gesture;
    expect(move(g, 1, at(15, 5)).effect).toEqual({ kind: "pan", dx: 5, dy: 5 });
  });

  it("ignores a pointer it never saw pressed", () => {
    const g = idle();
    expect(move(g, 7, at(1, 1)).effect.kind).toBe("none");
    expect(release(g, 7).effect.kind).toBe("none");
  });
});

describe("a tap", () => {
  it("selects with a mouse, and clears on empty space; a second tap on touch opens", () => {
    expect(tapAction(3, null, false)).toEqual({ select: 3 });
    expect(tapAction(3, 3, false)).toEqual({ select: 3 });
    expect(tapAction(null, 3, false)).toEqual({ select: null });
    expect(tapAction(3, null, true)).toEqual({ select: 3 });
    expect(tapAction(3, 3, true)).toEqual({ open: 3 });
    expect(tapAction(4, 3, true)).toEqual({ select: 4 });
    expect(tapAction(null, 3, true)).toEqual({ select: null });
  });

  it("is not followed by a double-click that opens, when it was a touch", () => {
    const touched = release(press(idle(), 1, at(0, 0), true), 1).gesture;
    expect(doubleClickOpens(touched)).toBe(false);
    const clicked = release(press(idle(), 1, at(0, 0), false), 1).gesture;
    expect(doubleClickOpens(clicked)).toBe(true);
  });
});

describe("a pinch", () => {
  it("zooms about the middle of the fingers and is never a tap", () => {
    const view: FlatView = { kind: "flat", x: 0, y: 0, k: 1 };
    let g = press(idle(), 1, at(100, 200), true);
    g = press(g, 2, at(300, 200), true);
    // The graph point under the fingers' middle.
    const under = makeView(view, 400, 400).unproject(200, 200)!;
    const pinched = move(g, 2, at(500, 200));
    expect(pinched.effect).toMatchObject({ kind: "pinch", x: 200, y: 200, factor: 2 });
    const next = applyEffect(view, pinched.effect, 400, 400);
    expect(next.k).toBe(2);
    // It stays under the new middle, at (300, 200).
    const now = makeView(next, 400, 400).project(under)!;
    expect(now[0]).toBeCloseTo(300);
    expect(now[1]).toBeCloseTo(200);
    g = release(pinched.gesture, 2).gesture;
    expect(release(g, 1).effect.kind).toBe("none");
  });
});

describe("the zoom", () => {
  it("stays between 0.2 and 6", () => {
    expect(clampZoom(0.01)).toBe(0.2);
    expect(clampZoom(10)).toBe(6);
    const view: FlatView = { kind: "flat", x: 0, y: 0, k: 5 };
    expect(zoomBy(view, 100, 100, 50, 50, 4).k).toBe(6);
    expect(zoomBy({ ...view, k: 0.3 }, 100, 100, 50, 50, 0.1).k).toBe(0.2);
  });
});

describe("hit-testing", () => {
  const nodes: HitNode[] = [
    { i: 0, x: 0, y: 0, r: 14 },
    { i: 1, x: 18, y: 0, r: 3 },
    { i: 2, x: 200, y: 200, r: 3 },
  ];
  const tree = quadtree<HitNode>()
    .x((n) => n.x)
    .y((n) => n.y)
    .addAll(nodes);

  it("picks a large node whose centre is farther than a small one's", () => {
    // 11 from the large node's centre (3 inside its edge), 7 from the small one's (4 outside).
    expect(hitTest(tree, 14, at(11, 0), 1, false)).toBe(0);
    expect(hitTest(tree, 14, at(18, 0), 1, false)).toBe(1);
  });

  it("reaches farther for a finger, and nowhere on empty space", () => {
    expect(hitTest(tree, 14, at(210, 200), 1, false)).toBeNull();
    expect(hitTest(tree, 14, at(210, 200), 1, true)).toBe(2);
    expect(hitTest(tree, 14, at(100, 100), 1, true)).toBeNull();
    // Zoomed out, the slop covers more of the graph.
    expect(hitTest(tree, 14, at(225, 200), 1, true)).toBeNull();
    expect(hitTest(tree, 14, at(225, 200), 0.5, true)).toBe(2);
  });
});
