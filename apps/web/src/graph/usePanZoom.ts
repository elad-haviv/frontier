/**
 * The pointer on the graph's stage: pan, pinch, wheel zoom, taps, double-clicks and mouse hover.
 * The state changes are in `pointer.ts`; this hook feeds them the browser's events and moves the
 * view. The view lives in a ref, so moving it redraws the canvas without rendering React again.
 */
import {
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
} from "react";
import {
  applyEffect,
  doubleClickOpens,
  type FlatView,
  idle,
  lose,
  move,
  type Point,
  press,
  release,
  zoomBy,
} from "./pointer.ts";

/** How long the view must rest before it counts as stopped, for keeping it. */
const SETTLE_MS = 400;

export interface PanZoomOptions {
  stage: RefObject<HTMLElement | null>;
  view: RefObject<FlatView>;
  size: RefObject<{ width: number; height: number }>;
  /** The view moved: draw again. */
  onView: () => void;
  /** The view stopped moving. */
  onSettle: (view: FlatView) => void;
  /** The view is about to move under the pointer, by a pan, a pinch or the wheel. */
  onMoveStart: () => void;
  onTap: (p: Point, touch: boolean) => void;
  onDouble: (p: Point) => void;
  /** A mouse over the stage, with no button down; null when it leaves or presses. */
  onHover: (p: Point | null) => void;
}

const pointIn = (el: HTMLElement, e: { clientX: number; clientY: number }): Point => {
  const box = el.getBoundingClientRect();
  return { x: e.clientX - box.left, y: e.clientY - box.top };
};

export function usePanZoom(options: PanZoomOptions) {
  const o = useRef(options);
  o.current = options;
  const gesture = useRef(idle());
  const timer = useRef<number | undefined>(undefined);

  const setView = useCallback((next: FlatView) => {
    o.current.view.current = next;
    o.current.onView();
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => o.current.onSettle(next), SETTLE_MS);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  // The wheel zooms around the pointer. It is heard directly, since React's is passive.
  useEffect(() => {
    const el = options.stage.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      o.current.onMoveStart();
      const p = pointIn(el, e);
      const lines = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const { width, height } = o.current.size.current;
      const factor = Math.exp(-e.deltaY * lines * 0.002);
      setView(zoomBy(o.current.view.current, width, height, p.x, p.y, factor));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [options.stage, setView]);

  const handlers = {
    onPointerDown(e: ReactPointerEvent<HTMLElement>) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      const p = pointIn(e.currentTarget, e);
      gesture.current = press(gesture.current, e.pointerId, p, e.pointerType !== "mouse");
    },
    onPointerMove(e: ReactPointerEvent<HTMLElement>) {
      const p = pointIn(e.currentTarget, e);
      if (!gesture.current.pointers.has(e.pointerId)) {
        if (e.pointerType === "mouse") o.current.onHover(p);
        return;
      }
      const { gesture: next, effect } = move(gesture.current, e.pointerId, p);
      gesture.current = next;
      if (effect.kind === "none") return;
      o.current.onMoveStart();
      o.current.onHover(null);
      const { width, height } = o.current.size.current;
      setView(applyEffect(o.current.view.current, effect, width, height));
    },
    onPointerUp(e: ReactPointerEvent<HTMLElement>) {
      const { gesture: next, effect } = release(gesture.current, e.pointerId);
      gesture.current = next;
      if (effect.kind === "tap") o.current.onTap({ x: effect.x, y: effect.y }, effect.touch);
      if (e.pointerType === "mouse") o.current.onHover(pointIn(e.currentTarget, e));
    },
    onPointerCancel(e: ReactPointerEvent<HTMLElement>) {
      gesture.current = lose(gesture.current, e.pointerId);
    },
    onPointerLeave(e: ReactPointerEvent<HTMLElement>) {
      if (e.pointerType === "mouse" && !gesture.current.pointers.has(e.pointerId)) {
        o.current.onHover(null);
      }
    },
    onDoubleClick(e: ReactMouseEvent<HTMLElement>) {
      if (!doubleClickOpens(gesture.current)) return;
      o.current.onDouble(pointIn(e.currentTarget, e));
    },
  };

  return { handlers, setView };
}
