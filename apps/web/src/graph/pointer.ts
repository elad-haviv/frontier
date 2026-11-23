/**
 * The pointer on the graph, as pure state changes: what a press, a move and a release mean (a tap,
 * a pan, a pinch), what a tap does, and which node is under a point. `usePanZoom.ts` feeds it the
 * browser's events.
 */
import { panBy, type ViewState, zoomAt } from "@frontier/geo";
import type { Quadtree } from "d3-quadtree";

export type FlatView = Extract<ViewState, { kind: "flat" }>;

export interface Point {
  x: number;
  y: number;
}

/** The graph's zoom stays between these. */
export const ZOOM_MIN = 0.2;
export const ZOOM_MAX = 6;
export const clampZoom = (k: number): number => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, k));

/** How far a press may move and still be a tap: a mouse is steadier than a finger. */
export const tapSlop = (touch: boolean): number => (touch ? 10 : 4);
/** How far outside a node a tap still hits it, in screen pixels. */
export const hitSlop = (touch: boolean): number => (touch ? 12 : 4);

export interface Gesture {
  /** The pressed pointers, where each was last. */
  pointers: Map<number, Point>;
  /** Where a single press began. */
  start: Point | null;
  /** Whether the press has become a pan or a pinch, so it is no longer a tap. */
  moved: boolean;
  touch: boolean;
  /** The two fingers' distance and middle, while pinching. */
  pinch: { distance: number; middle: Point } | null;
  /** Whether the last press was a touch, so a double tap does not also open as a double-click. */
  lastTouch: boolean;
}

export const idle = (): Gesture => ({
  pointers: new Map(),
  start: null,
  moved: false,
  touch: false,
  pinch: null,
  lastTouch: false,
});

export type Effect =
  | { kind: "none" }
  | { kind: "pan"; dx: number; dy: number }
  /** Zoom by `factor` about the old middle of two fingers, then pan by the move of the middle. */
  | { kind: "pinch"; x: number; y: number; factor: number; dx: number; dy: number }
  | { kind: "tap"; x: number; y: number; touch: boolean };

const NONE: Effect = { kind: "none" };

function twoFingers(pointers: Map<number, Point>) {
  const [a, b] = [...pointers.values()] as [Point, Point];
  return {
    distance: Math.hypot(a.x - b.x, a.y - b.y),
    middle: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
  };
}

/** A pointer goes down. A second one starts a pinch, which is never a tap. */
export function press(g: Gesture, id: number, p: Point, touch: boolean): Gesture {
  const pointers = new Map(g.pointers).set(id, p);
  if (pointers.size === 1) {
    return { pointers, start: p, moved: false, touch, pinch: null, lastTouch: touch };
  }
  return {
    ...g,
    pointers,
    moved: true,
    pinch: pointers.size === 2 ? twoFingers(pointers) : g.pinch,
  };
}

/** A pressed pointer moves: a pan once it has gone past the tap's slop, or a pinch. */
export function move(g: Gesture, id: number, p: Point): { gesture: Gesture; effect: Effect } {
  const last = g.pointers.get(id);
  if (!last) return { gesture: g, effect: NONE };
  const pointers = new Map(g.pointers).set(id, p);
  if (pointers.size >= 2 && g.pinch) {
    const now = twoFingers(pointers);
    const effect: Effect = {
      kind: "pinch",
      x: g.pinch.middle.x,
      y: g.pinch.middle.y,
      factor: g.pinch.distance > 0 ? now.distance / g.pinch.distance : 1,
      dx: now.middle.x - g.pinch.middle.x,
      dy: now.middle.y - g.pinch.middle.y,
    };
    return { gesture: { ...g, pointers, pinch: now }, effect };
  }
  if (!g.moved) {
    const start = g.start ?? last;
    if (Math.hypot(p.x - start.x, p.y - start.y) < tapSlop(g.touch)) {
      return { gesture: { ...g, pointers }, effect: NONE };
    }
    // Past the slop: the view catches up with the whole way from the press.
    return {
      gesture: { ...g, pointers, moved: true },
      effect: { kind: "pan", dx: p.x - start.x, dy: p.y - start.y },
    };
  }
  return {
    gesture: { ...g, pointers },
    effect: { kind: "pan", dx: p.x - last.x, dy: p.y - last.y },
  };
}

/** A pointer goes up: a tap when it was the only one and did not move. */
export function release(g: Gesture, id: number): { gesture: Gesture; effect: Effect } {
  const last = g.pointers.get(id);
  if (!last) return { gesture: g, effect: NONE };
  const pointers = new Map(g.pointers);
  pointers.delete(id);
  if (pointers.size > 0) {
    // One finger stays after a pinch: it pans on from where it is.
    return { gesture: { ...g, pointers, pinch: null, moved: true }, effect: NONE };
  }
  const effect: Effect = g.moved ? NONE : { kind: "tap", x: last.x, y: last.y, touch: g.touch };
  return { gesture: { ...idle(), lastTouch: g.lastTouch }, effect };
}

/** A pointer is lost, as when the browser takes over: nothing it did counts as a tap. */
export function lose(g: Gesture, id: number): Gesture {
  if (!g.pointers.has(id)) return g;
  const pointers = new Map(g.pointers);
  pointers.delete(id);
  return pointers.size === 0
    ? { ...idle(), lastTouch: g.lastTouch }
    : { ...g, pointers, pinch: null, moved: true };
}

/** Moves the view as an effect says, keeping the zoom within its bounds. */
export function applyEffect(
  view: FlatView,
  effect: Effect,
  width: number,
  height: number,
): FlatView {
  if (effect.kind === "pan") return panBy(view, effect.dx, effect.dy) as FlatView;
  if (effect.kind === "pinch") {
    const zoomed = zoomBy(view, width, height, effect.x, effect.y, effect.factor);
    return panBy(zoomed, effect.dx, effect.dy) as FlatView;
  }
  return view;
}

/** Zooms by a factor about a point of the screen, within the graph's bounds. */
export function zoomBy(
  view: FlatView,
  width: number,
  height: number,
  x: number,
  y: number,
  factor: number,
): FlatView {
  const k = clampZoom(view.k * factor);
  return zoomAt(view, width, height, x, y, k / view.k) as FlatView;
}

/**
 * What a tap does. A mouse click selects the node under it, or clears the selection on empty
 * space. A tap selects too, and a tap on the node already selected opens it.
 */
export function tapAction(
  hit: number | null,
  selected: number | null,
  touch: boolean,
): { open: number } | { select: number | null } {
  if (touch && hit !== null && hit === selected) return { open: hit };
  return { select: hit };
}

/** A double-click opens, unless the last press was a touch: a double tap has already done so. */
export const doubleClickOpens = (g: Gesture): boolean => !g.lastTouch;

export interface HitNode {
  i: number;
  x: number;
  y: number;
  /** The radius in graph units. */
  r: number;
}

/**
 * The node under a point of the graph. Nodes are searched within the largest radius plus the slop
 * (in screen pixels over the zoom); of those within their own radius plus the slop, the one whose
 * edge is nearest wins, so a large node is hit before a small one whose centre is nearer.
 */
export function hitTest(
  tree: Quadtree<HitNode>,
  maxR: number,
  p: Point,
  k: number,
  touch: boolean,
): number | null {
  const slop = hitSlop(touch) / k;
  // A node is never drawn smaller than 2 screen pixels.
  const own = (n: HitNode) => Math.max(n.r, 2 / k);
  const reach = Math.max(maxR, 2 / k) + slop;
  let best: { i: number; d: number } | null = null;
  tree.visit((node, x0, y0, x1, y1) => {
    if (!node.length) {
      for (let leaf: typeof node | undefined = node; leaf; leaf = leaf.next) {
        const n = leaf.data;
        const d = Math.hypot(n.x - p.x, n.y - p.y) - own(n);
        if (d <= slop && (!best || d < best.d)) best = { i: n.i, d };
      }
    }
    return x0 > p.x + reach || x1 < p.x - reach || y0 > p.y + reach || y1 < p.y - reach;
  });
  return (best as { i: number } | null)?.i ?? null;
}
