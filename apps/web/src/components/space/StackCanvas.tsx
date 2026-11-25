import { type Ref, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { MapFeature, MapFile } from "@frontier/schema";
import {
  type Camera,
  clamp,
  makeCamera,
  MAX_PITCH,
  MAX_ZOOM,
  MIN_PITCH,
  MIN_ZOOM,
  nearest,
  pointOnPlane,
} from "../../map/space3d.ts";
import { type Link, PLATE_H, PLATE_W, type Place, spotOf, type Spot } from "../../map/stack.ts";
import { drawStack, type StackDrawn, keyOf } from "./drawStack.ts";

export type StackTool = "select" | "marker" | "passage";

export interface StackCanvasApi {
  zoomBy: (factor: number) => void;
  whole: () => void;
  toggleTop: () => void;
  turn: (yaw: number, pitch: number) => void;
}

interface Props {
  order: string[];
  maps: Record<string, MapFile>;
  titles: Record<string, string>;
  spread: number;
  active: number;
  onActive: (layer: number) => void;
  nameOf: (f: MapFeature) => string;
  places: Place[];
  links: Link[];
  selected: string | null;
  onSelect: (key: string | null) => void;
  hidden: Set<string>;
  show: { names: boolean; passages: boolean; plumb: boolean };
  editing: boolean;
  tool: StackTool;
  /** A marker is put down on the active layer. */
  onPlace: (spot: Spot) => void;
  /** The place a passage starts from, and a place clicked while drawing one. */
  from: string | null;
  onPassage: (key: string) => void;
  onTop: (isTop: boolean) => void;
  phone: boolean;
  api: Ref<StackCanvasApi>;
}

/** The canvas of the layered view: it draws the stack and turns presses into the page's edits. */
export function StackCanvas(p: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef(p);
  live.current = p;
  const cam = useRef<Camera>({ ...makeCamera(), yaw: 0.5, pitch: 0.5, zoom: 20 });
  const goal = useRef<Partial<Camera> | null>(null);
  const size = useRef({ width: 800, height: 600 });
  const drawn = useRef<StackDrawn>({ places: [] });
  const hover = useRef<string | null>(null);
  const plumb = useRef<Spot | null>(null);
  const ghost = useRef<{ layer: number; spot: Spot } | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const dirty = useRef(true);
  const fitted = useRef(false);
  const [tip, setTip] = useState<{ x: number; y: number; words: string } | null>(null);
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number } | null>(null);
  const drag = useRef<{ type: "orbit" | "pan"; x: number; y: number } | null>(null);
  const down = useRef<{ x: number; y: number; moved: boolean; touch: boolean } | null>(null);
  const redraw = () => {
    dirty.current = true;
  };

  const middle = () => ({
    x: 0,
    y: 0,
    z: (-(live.current.order.length - 1) * live.current.spread) / 2,
  });
  const api: StackCanvasApi = {
    zoomBy: (f) => {
      cam.current = { ...cam.current, zoom: clamp(cam.current.zoom * f, MIN_ZOOM, MAX_ZOOM) };
      redraw();
    },
    whole: () => {
      goal.current = {
        target: middle(),
        zoom: clamp(
          Math.min(size.current.width / (PLATE_W * 2.6), size.current.height / (PLATE_H * 5)),
          7,
          40,
        ),
        pitch: 0.5,
      };
      redraw();
    },
    toggleTop: () => {
      goal.current = {
        ...goal.current,
        pitch: cam.current.pitch > MAX_PITCH - 0.05 ? 0.5 : MAX_PITCH,
      };
      redraw();
    },
    turn: (yaw, pitch) => {
      cam.current = {
        ...cam.current,
        yaw: cam.current.yaw + yaw,
        pitch: clamp(cam.current.pitch + pitch, MIN_PITCH, MAX_PITCH),
      };
      live.current.onTop(cam.current.pitch > MAX_PITCH - 0.05);
      redraw();
    },
  };
  useImperativeHandle(p.api, () => api);

  useEffect(() => {
    const el = canvas.current!;
    const ctx = el.getContext("2d")!;
    const fit = () => {
      const r = el.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      size.current = { width: Math.max(50, r.width), height: Math.max(50, r.height) };
      el.width = size.current.width * ratio;
      el.height = size.current.height * ratio;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      if (!fitted.current && live.current.order.length) {
        fitted.current = true;
        cam.current = {
          ...cam.current,
          target: middle(),
          zoom: clamp(
            Math.min(size.current.width / (PLATE_W * 2.6), size.current.height / (PLATE_H * 5)),
            7,
            40,
          ),
        };
      }
      redraw();
    };
    const watch = new ResizeObserver(fit);
    watch.observe(el);
    fit();
    let frame = 0;
    const loop = () => {
      const l = live.current;
      if (!fitted.current && l.order.length) fit();
      const g = goal.current;
      if (g) {
        const c = cam.current;
        let done = true;
        const next = { ...c };
        if (g.zoom !== undefined) {
          next.zoom += (g.zoom - c.zoom) * 0.2;
          if (Math.abs(g.zoom - next.zoom) > 0.05) done = false;
          else next.zoom = g.zoom;
        }
        if (g.pitch !== undefined) {
          next.pitch += (g.pitch - c.pitch) * 0.2;
          if (Math.abs(g.pitch - next.pitch) > 0.005) done = false;
          else next.pitch = g.pitch;
        }
        if (g.target) {
          next.target = {
            x: c.target.x + (g.target.x - c.target.x) * 0.2,
            y: c.target.y + (g.target.y - c.target.y) * 0.2,
            z: c.target.z + (g.target.z - c.target.z) * 0.2,
          };
          if (
            Math.hypot(
              g.target.x - next.target.x,
              g.target.y - next.target.y,
              g.target.z - next.target.z,
            ) > 0.01
          )
            done = false;
          else next.target = g.target;
        }
        cam.current = next;
        if (done) {
          goal.current = null;
          l.onTop(next.pitch > MAX_PITCH - 0.05);
        }
        dirty.current = true;
      }
      if (dirty.current) {
        dirty.current = false;
        drawn.current = drawStack(ctx, {
          cam: cam.current,
          width: size.current.width,
          height: size.current.height,
          order: l.order,
          maps: l.maps,
          titles: l.titles,
          spread: l.spread,
          active: l.active,
          nameOf: l.nameOf,
          places: l.places,
          links: l.links,
          selected: l.selected,
          hover: hover.current,
          hidden: l.hidden,
          show: l.show,
          plumb: plumb.current,
          ghost: ghost.current,
          from: l.from,
          pointer: pointer.current,
          phone: l.phone,
          again: redraw,
        });
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      cam.current = {
        ...cam.current,
        zoom: clamp(cam.current.zoom * Math.exp(-e.deltaY * 0.0015), MIN_ZOOM, MAX_ZOOM),
      };
      redraw();
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      cancelAnimationFrame(frame);
      watch.disconnect();
      el.removeEventListener("wheel", wheel);
    };
    // The loop reads what it needs from `live`.
  }, []);

  useEffect(redraw, [
    p.maps,
    p.order,
    p.spread,
    p.active,
    p.places,
    p.links,
    p.selected,
    p.hidden,
    p.show,
    p.editing,
    p.tool,
    p.from,
    p.phone,
    p.nameOf,
  ]);

  const at = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  /** The layer and spot under a screen point: the highest plate the point looks at. */
  function plateAt(x: number, y: number, only?: number): { layer: number; spot: Spot } | null {
    const l = live.current;
    for (let i = 0; i < l.order.length; i++) {
      if (only !== undefined && i !== only) continue;
      const q = pointOnPlane(
        cam.current,
        x,
        y,
        -i * l.spread,
        size.current.width,
        size.current.height,
      );
      const spot = q && spotOf(q.x, q.y);
      if (spot) return { layer: i, spot };
    }
    return null;
  }
  const pick = (x: number, y: number, touch: boolean) =>
    nearest(drawn.current.places, x, y, touch ? 22 : 12)?.key ?? null;
  const showTip = (x: number, y: number, words: string) => setTip({ x: x + 14, y: y + 16, words });
  const placeOf = (key: string) => live.current.places.find((q) => keyOf(q) === key);

  function onDown(e: React.PointerEvent<HTMLCanvasElement>) {
    canvas.current!.setPointerCapture(e.pointerId);
    canvas.current!.focus({ preventScroll: true });
    const q = at(e);
    pts.current.set(e.pointerId, q);
    setTip(null);
    if (pts.current.size === 2) {
      const [a, b] = [...pts.current.values()];
      pinch.current = { d: Math.hypot(a!.x - b!.x, a!.y - b!.y) };
      drag.current = null;
      down.current = null;
      return;
    }
    down.current = { ...q, moved: false, touch: e.pointerType !== "mouse" };
    drag.current = { type: e.button === 2 || e.shiftKey ? "pan" : "orbit", x: q.x, y: q.y };
  }

  function onMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const q = at(e);
    pointer.current = q;
    if (pts.current.has(e.pointerId)) pts.current.set(e.pointerId, q);
    if (pinch.current && pts.current.size === 2) {
      const [a, b] = [...pts.current.values()];
      const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      cam.current = {
        ...cam.current,
        zoom: clamp((cam.current.zoom * d) / pinch.current.d, MIN_ZOOM, MAX_ZOOM),
      };
      pinch.current = { d };
      redraw();
      return;
    }
    const dn = down.current;
    if (dn && Math.hypot(q.x - dn.x, q.y - dn.y) > (dn.touch ? 8 : 4)) dn.moved = true;
    const dr = drag.current;
    if (dr && dn?.moved) {
      redraw();
      if (dr.type === "orbit") {
        cam.current = {
          ...cam.current,
          yaw: cam.current.yaw + (q.x - dr.x) * 0.008,
          pitch: clamp(cam.current.pitch + (q.y - dr.y) * 0.006, MIN_PITCH, MAX_PITCH),
        };
        live.current.onTop(cam.current.pitch > MAX_PITCH - 0.05);
      } else {
        const c = cam.current;
        const a = pointOnPlane(c, dr.x, dr.y, c.target.z, size.current.width, size.current.height);
        const b = pointOnPlane(c, q.x, q.y, c.target.z, size.current.width, size.current.height);
        if (a && b)
          cam.current = {
            ...c,
            target: {
              ...c.target,
              x: clamp(c.target.x - (b.x - a.x), -30, 30),
              y: clamp(c.target.y - (b.y - a.y), -30, 30),
            },
          };
      }
      dr.x = q.x;
      dr.y = q.y;
      return;
    }
    if (!dr) hoverAt(q, e.pointerType !== "mouse");
  }

  function hoverAt(q: { x: number; y: number }, touch: boolean) {
    const l = live.current;
    const key = pick(q.x, q.y, touch);
    const found = key ? placeOf(key) : undefined;
    const onPlate = plateAt(q.x, q.y, l.active) ?? plateAt(q.x, q.y);
    ghost.current = null;
    plumb.current = found ? (found.feature.at as Spot) : (onPlate?.spot ?? null);
    if (found) {
      showTip(q.x, q.y, `${l.nameOf(found.feature)} · ${l.titles[found.map] ?? ""}`);
    } else if (l.editing && l.tool === "marker") {
      const on = plateAt(q.x, q.y, l.active);
      if (on) {
        ghost.current = on;
        showTip(q.x, q.y, `On ${l.titles[l.order[l.active]!] ?? "this layer"}`);
      } else setTip(null);
    } else setTip(null);
    hover.current = key;
    redraw();
    canvas.current!.style.cursor = key
      ? "pointer"
      : l.editing && l.tool !== "select"
        ? "crosshair"
        : "grab";
  }

  function onUp(e: React.PointerEvent<HTMLCanvasElement>) {
    const q = at(e);
    pts.current.delete(e.pointerId);
    if (pts.current.size < 2) pinch.current = null;
    const dn = down.current;
    if (dn && !dn.moved && pts.current.size === 0) click(q, dn.touch);
    drag.current = null;
    down.current = null;
    redraw();
  }

  function click(q: { x: number; y: number }, touch: boolean) {
    const l = live.current;
    const key = pick(q.x, q.y, touch);
    if (l.editing && l.tool === "passage") {
      if (key) l.onPassage(key);
      return;
    }
    if (l.editing && l.tool === "marker" && !key) {
      const on = plateAt(q.x, q.y, l.active);
      if (on) l.onPlace(on.spot);
      else {
        const other = plateAt(q.x, q.y);
        if (other) l.onActive(other.layer);
        setTip({ x: q.x, y: q.y, words: "Click the layer you are working on" });
      }
      return;
    }
    if (key) {
      const found = placeOf(key);
      if (found) l.onActive(found.layer);
      l.onSelect(key);
      return;
    }
    const on = plateAt(q.x, q.y);
    if (on) l.onActive(on.layer);
    l.onSelect(null);
  }

  return (
    <>
      <canvas
        ref={canvas}
        className="map-canvas star-canvas"
        tabIndex={0}
        aria-label="The layers stacked. Every place on them is also listed in the Layers tab."
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={(e) => {
          pts.current.delete(e.pointerId);
          drag.current = null;
          down.current = null;
          pinch.current = null;
        }}
        onPointerLeave={() => {
          pointer.current = null;
          if (!drag.current) {
            hover.current = null;
            ghost.current = null;
            plumb.current = null;
            setTip(null);
            redraw();
          }
        }}
        onContextMenu={(e) => e.preventDefault()}
      />
      {tip && (
        <div className="map-tooltip star-tip" role="tooltip" style={{ left: tip.x, top: tip.y }}>
          {tip.words}
        </div>
      )}
    </>
  );
}
