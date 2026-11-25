import type { MapFile } from "@frontier/schema";
import { type Ref, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  type Camera,
  clamp,
  fitCamera,
  heightText,
  makeCamera,
  MAX_PITCH,
  MAX_ZOOM,
  MIN_PITCH,
  MIN_ZOOM,
  numberText,
  pointOnPlane,
  project,
  nearest,
  toSegment,
} from "../../map/space3d.ts";
import { moveStar, placeOf, type Route, type Star, stars } from "../../map/starMap.ts";
import { type Drawn, drawStars } from "./drawStars.ts";

export type StarTool = "select" | "marker" | "route";

/** What the page can ask of the canvas. */
export interface StarCanvasApi {
  zoomBy: (factor: number) => void;
  whole: () => void;
  /** Looks straight down, or back to a tilted view. */
  toggleTop: () => void;
  flyTo: (id: string) => void;
  turn: (yaw: number, pitch: number) => void;
  isTop: () => boolean;
}

interface Props {
  map: MapFile;
  nameOf: (f: Star | Route) => string;
  hiddenLayers: Set<string>;
  show: { names: boolean; drops: boolean; rings: boolean };
  editing: boolean;
  tool: StarTool;
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** Remembers the map before a drag, so the drag undoes as one step. */
  onBegin: () => void;
  onChange: (next: MapFile, remember?: boolean) => void;
  /** A click with the Marker tool, on the plane. */
  onPlace: (x: number, y: number) => void;
  draft: string[] | null;
  onDraft: (stops: string[]) => void;
  onFinishRoute: () => void;
  onTop: (isTop: boolean) => void;
  phone: boolean;
  api: Ref<StarCanvasApi>;
}

type Drag =
  | { type: "orbit" | "pan"; x: number; y: number }
  | { type: "height"; id: string; y0: number; z0: number; began: boolean }
  | { type: "star"; id: string; began: boolean };

/**
 * The canvas of a star map: it draws, turns the view, and turns presses into the page's edits.
 * Dragging empty space turns the view (Shift, right button or two fingers slide it); dragging a
 * star while editing slides it level, and its handle lifts it.
 */
export function StarCanvas(p: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef(p);
  live.current = p;
  // The route being drawn, kept here too: two quick clicks can come before the page draws again.
  const draftNow = useRef<string[] | null>(p.draft);
  draftNow.current = p.draft;
  const cam = useRef<Camera>(makeCamera());
  const goal = useRef<Partial<Camera> | null>(null);
  const size = useRef({ width: 800, height: 600 });
  const drawn = useRef<Drawn>({ stars: [], handle: null, legs: [] });
  const hover = useRef<string | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const ghost = useRef<{ x: number; y: number; z: number } | null>(null);
  const dirty = useRef(true);
  const [tip, setTip] = useState<{ x: number; y: number; words: string } | null>(null);
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; x: number; y: number } | null>(null);
  const drag = useRef<Drag | null>(null);
  const down = useRef<{ x: number; y: number; moved: boolean; touch: boolean } | null>(null);
  const fitted = useRef(false);

  const redraw = () => {
    dirty.current = true;
  };

  const api: StarCanvasApi = {
    zoomBy: (f) => {
      cam.current = { ...cam.current, zoom: clamp(cam.current.zoom * f, MIN_ZOOM, MAX_ZOOM) };
      redraw();
    },
    whole: () => {
      const visible = stars(live.current.map).filter(
        (s) => !live.current.hiddenLayers.has(s.layer),
      );
      const fit = fitCamera(
        cam.current,
        visible.map(placeOf),
        size.current.width,
        size.current.height,
      );
      goal.current = { target: fit.target, zoom: fit.zoom, pitch: 0.6 };
      redraw();
    },
    toggleTop: () => {
      const top = cam.current.pitch > MAX_PITCH - 0.05;
      goal.current = { ...goal.current, pitch: top ? 0.6 : MAX_PITCH };
      redraw();
    },
    flyTo: (id) => {
      const s = stars(live.current.map).find((x) => x.id === id);
      if (!s) return;
      goal.current = { target: placeOf(s), zoom: Math.max(cam.current.zoom, 30) };
      redraw();
    },
    turn: (yaw, pitch) => {
      cam.current = {
        ...cam.current,
        yaw: cam.current.yaw + yaw,
        pitch: clamp(cam.current.pitch + pitch, MIN_PITCH, MAX_PITCH),
      };
      redraw();
      live.current.onTop(cam.current.pitch > MAX_PITCH - 0.05);
    },
    isTop: () => cam.current.pitch > MAX_PITCH - 0.05,
  };
  useImperativeHandle(p.api, () => api);

  // Size, and drawing whenever something changed.
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
      if (!fitted.current) {
        fitted.current = true;
        const visible = stars(live.current.map).map(placeOf);
        cam.current = fitCamera(cam.current, visible, size.current.width, size.current.height);
      }
      redraw();
    };
    const watch = new ResizeObserver(fit);
    watch.observe(el);
    fit();
    let frame = 0;
    const loop = () => {
      const g = goal.current;
      if (g) {
        let done = true;
        const c = cam.current;
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
          live.current.onTop(next.pitch > MAX_PITCH - 0.05);
        }
        dirty.current = true;
      }
      if (dirty.current) {
        dirty.current = false;
        const l = live.current;
        drawn.current = drawStars(ctx, {
          map: l.map,
          cam: cam.current,
          width: size.current.width,
          height: size.current.height,
          nameOf: l.nameOf,
          hover: hover.current,
          selected: l.selected,
          hiddenLayers: l.hiddenLayers,
          show: l.show,
          ghost: ghost.current,
          draft: l.draft,
          pointer: pointer.current,
          handle: l.editing && l.tool === "select",
          phone: l.phone,
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
  }, []);

  // Anything that changes what is drawn.
  useEffect(redraw, [
    p.map,
    p.hiddenLayers,
    p.show,
    p.selected,
    p.draft,
    p.editing,
    p.tool,
    p.phone,
    p.nameOf,
  ]);

  const at = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const planeAt = (x: number, y: number, h: number) =>
    pointOnPlane(cam.current, x, y, h, size.current.width, size.current.height);

  /** The star or route under a press, with a larger reach for a finger. */
  function pick(
    x: number,
    y: number,
    touch: boolean,
  ): { kind: "star" | "route"; id: string } | null {
    const hit = nearest(drawn.current.stars, x, y, touch ? 22 : 12);
    if (hit) return { kind: "star", id: hit.id };
    let best: { id: string; d: number } | null = null;
    for (const leg of drawn.current.legs) {
      const d = toSegment(x, y, leg.ax, leg.ay, leg.bx, leg.by);
      if (d < (touch ? 14 : 6) && (!best || d < best.d)) best = { id: leg.id, d };
    }
    return best ? { kind: "route", id: best.id } : null;
  }

  const showTip = (x: number, y: number, words: string) => setTip({ x: x + 14, y: y + 16, words });

  function onDown(e: React.PointerEvent<HTMLCanvasElement>) {
    canvas.current!.setPointerCapture(e.pointerId);
    canvas.current!.focus({ preventScroll: true });
    const q = at(e);
    pts.current.set(e.pointerId, q);
    setTip(null);
    if (pts.current.size === 2) {
      const [a, b] = [...pts.current.values()];
      pinch.current = {
        d: Math.hypot(a!.x - b!.x, a!.y - b!.y),
        x: (a!.x + b!.x) / 2,
        y: (a!.y + b!.y) / 2,
      };
      drag.current = null;
      down.current = null;
      return;
    }
    const touch = e.pointerType !== "mouse";
    down.current = { ...q, moved: false, touch };
    const l = live.current;
    if (l.editing && l.tool === "select") {
      const h = drawn.current.handle;
      if (h && l.selected && Math.hypot(q.x - h.x, q.y - h.y) < (touch ? 22 : 13)) {
        const s = stars(l.map).find((x) => x.id === l.selected);
        if (s) {
          drag.current = { type: "height", id: s.id, y0: q.y, z0: s.z ?? 0, began: false };
          return;
        }
      }
      const hit = pick(q.x, q.y, touch);
      if (hit?.kind === "star") {
        l.onSelect(hit.id);
        drag.current = { type: "star", id: hit.id, began: false };
        return;
      }
    }
    drag.current = { type: e.button === 2 || e.shiftKey ? "pan" : "orbit", x: q.x, y: q.y };
  }

  function slide(dx: number, dy: number, x: number, y: number) {
    const c = cam.current;
    const a = pointOnPlane(c, x - dx, y - dy, c.target.z, size.current.width, size.current.height);
    const b = pointOnPlane(c, x, y, c.target.z, size.current.width, size.current.height);
    if (a && b) {
      cam.current = {
        ...c,
        target: {
          ...c.target,
          x: clamp(c.target.x - (b.x - a.x), -60, 60),
          y: clamp(c.target.y - (b.y - a.y), -60, 60),
        },
      };
    }
  }

  function onMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const q = at(e);
    pointer.current = q;
    if (pts.current.has(e.pointerId)) pts.current.set(e.pointerId, q);
    const l = live.current;
    if (pinch.current && pts.current.size === 2) {
      const [a, b] = [...pts.current.values()];
      const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      const mx = (a!.x + b!.x) / 2;
      const my = (a!.y + b!.y) / 2;
      cam.current = {
        ...cam.current,
        zoom: clamp((cam.current.zoom * d) / pinch.current.d, MIN_ZOOM, MAX_ZOOM),
      };
      slide(mx - pinch.current.x, my - pinch.current.y, mx, my);
      pinch.current = { d, x: mx, y: my };
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
        dr.x = q.x;
        dr.y = q.y;
        l.onTop(cam.current.pitch > MAX_PITCH - 0.05);
      } else if (dr.type === "pan") {
        slide(q.x - dr.x, q.y - dr.y, q.x, q.y);
        dr.x = q.x;
        dr.y = q.y;
      } else if (dr.type === "height") {
        const s = stars(l.map).find((x) => x.id === dr.id);
        if (!s) return;
        if (!dr.began) {
          l.onBegin();
          dr.began = true;
        }
        const pr = project(cam.current, placeOf(s), size.current.width, size.current.height);
        const k = cam.current.zoom * Math.cos(cam.current.pitch) * (pr?.scale ?? 1);
        const z = dr.z0 - (q.y - dr.y0) / Math.max(k, 1);
        l.onChange(moveStar(l.map, dr.id, { z }), false);
        showTip(q.x, q.y, heightText(Math.round(z * 10) / 10, unitOf(l.map)));
      } else if (dr.type === "star") {
        const s = stars(l.map).find((x) => x.id === dr.id);
        if (!s) return;
        const spot = planeAt(q.x, q.y, s.z ?? 0);
        if (!spot) return;
        if (!dr.began) {
          l.onBegin();
          dr.began = true;
        }
        l.onChange(moveStar(l.map, dr.id, { x: spot.x, y: spot.y }), false);
        showTip(q.x, q.y, `X ${numberText(spot.x)} · Y ${numberText(spot.y)}`);
      }
      return;
    }
    if (!dr) hoverAt(q, e.pointerType !== "mouse");
  }

  const unitOf = (m: MapFile) => (m.space.kind === "stars" ? m.space.unit : "ly");

  function hoverAt(q: { x: number; y: number }, touch: boolean) {
    const l = live.current;
    const hit = pick(q.x, q.y, touch);
    const id = hit?.id ?? null;
    ghost.current = null;
    if (l.editing && l.tool === "marker" && !hit) {
      const spot = planeAt(q.x, q.y, 0);
      ghost.current = spot;
      if (spot)
        showTip(q.x, q.y, `X ${numberText(spot.x)} · Y ${numberText(spot.y)} · on the plane`);
      else setTip(null);
    } else if (hit) {
      const f = l.map.features.find((x) => x.id === hit.id);
      if (f && (f.kind === "marker" || f.kind === "route"))
        showTip(q.x, q.y, l.nameOf(f as Star | Route));
    } else {
      setTip(null);
    }
    if (hover.current !== id || ghost.current || l.draft) {
      hover.current = id;
      redraw();
    }
    canvas.current!.style.cursor = hit
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
    if (drag.current && (drag.current.type === "star" || drag.current.type === "height"))
      setTip(null);
    drag.current = null;
    down.current = null;
    redraw();
  }

  function click(q: { x: number; y: number }, touch: boolean) {
    const l = live.current;
    const hit = pick(q.x, q.y, touch);
    if (l.editing && l.tool === "marker" && !(hit?.kind === "star")) {
      const spot = planeAt(q.x, q.y, 0);
      if (spot) l.onPlace(spot.x, spot.y);
      else setTip({ x: q.x, y: q.y, words: "Click lower, on the plane" });
      return;
    }
    if (l.editing && l.tool === "route") {
      if (hit?.kind !== "star") return;
      const stops = draftNow.current ?? [];
      if (stops[stops.length - 1] === hit.id) {
        l.onFinishRoute();
        return;
      }
      const next = [...stops, hit.id];
      draftNow.current = next;
      l.onDraft(next);
      return;
    }
    l.onSelect(hit?.id ?? null);
    if (touch && hit?.kind === "star") {
      const f = l.map.features.find((x) => x.id === hit.id);
      if (f) showTip(q.x, q.y - 40, l.nameOf(f as Star));
    }
  }

  return (
    <>
      <canvas
        ref={canvas}
        className="map-canvas star-canvas"
        tabIndex={0}
        aria-label="The star map. Every star and route on it is also listed in the Layers tab."
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
            setTip(null);
            redraw();
          }
        }}
        onContextMenu={(e) => e.preventDefault()}
        onDoubleClick={(e) => {
          const l = live.current;
          if (l.editing && l.tool === "route" && l.draft) return l.onFinishRoute();
          const hit = pick(at(e).x, at(e).y, false);
          if (hit?.kind === "star") api.flyTo(hit.id);
        }}
      />
      {tip && (
        <div className="map-tooltip star-tip" role="tooltip" style={{ left: tip.x, top: tip.y }}>
          {tip.words}
        </div>
      )}
    </>
  );
}
