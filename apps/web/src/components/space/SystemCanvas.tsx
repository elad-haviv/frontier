import type { MapFile } from "@frontier/schema";
import { type Ref, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  type Body,
  type BodyType,
  daysWords,
  drawnPosition,
  isStar,
  makeBody,
  period,
  type Scale,
} from "../../map/orbits.ts";
import { clamp } from "../../map/space3d.ts";
import { dragBody, type Placement, placement } from "../../map/systemMap.ts";
import {
  drawSystem,
  fitZoom,
  fromScreen,
  type Look,
  type SystemCamera,
  type SystemDrawn,
} from "./drawSystem.ts";

export type SystemTool = "select" | "add";

export interface SystemCanvasApi {
  zoomBy: (factor: number) => void;
  whole: () => void;
  toggleTilt: () => void;
  /** Centres on a body and follows it as it moves, zoomed in so its moons show. */
  follow: (id: string | null) => void;
  isTilted: () => boolean;
}

interface Props {
  map: MapFile;
  bodies: Body[];
  looks: Map<string, Look>;
  /** The day shown, read every frame, so playing time does not draw the page again. */
  dayRef: { current: number };
  playing: boolean;
  scale: Scale;
  show: { names: boolean; orbits: boolean; zone: boolean };
  editing: boolean;
  tool: SystemTool;
  /** The kind being added, once the picker has chosen one. */
  adding: BodyType | null;
  selected: string | null;
  followed: string | null;
  onSelect: (id: string | null) => void;
  onBegin: () => void;
  onChange: (next: MapFile, remember?: boolean) => void;
  onPlace: (type: BodyType, at: Placement) => void;
  onFollow: (id: string | null) => void;
  onTilt: (tilted: boolean) => void;
  phone: boolean;
  api: Ref<SystemCanvasApi>;
}

type Drag = { type: "pan"; x: number; y: number } | { type: "body"; id: string; began: boolean };

/**
 * The canvas of a system model: it draws, zooms and slides the view, and while editing a body
 * dragged outward changes its distance and dragged round changes where it is.
 */
export function SystemCanvas(p: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef(p);
  live.current = p;
  const cam = useRef<SystemCamera>({ cx: 0, cy: 0, zoom: 1, tilt: true });
  const goalZoom = useRef<number | null>(null);
  const size = useRef({ width: 800, height: 600 });
  const drawn = useRef<SystemDrawn>({ bodies: [], zoomToFit: 1 });
  const hover = useRef<string | null>(null);
  const ghost = useRef<(Placement & { type: BodyType }) | null>(null);
  const dirty = useRef(true);
  const fitted = useRef(false);
  const [tip, setTip] = useState<{ x: number; y: number; words: string } | null>(null);
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number } | null>(null);
  const drag = useRef<Drag | null>(null);
  const down = useRef<{ x: number; y: number; moved: boolean; touch: boolean } | null>(null);

  const redraw = () => {
    dirty.current = true;
  };
  const refit = () => {
    const l = live.current;
    cam.current = { ...cam.current, cx: 0, cy: 0 };
    goalZoom.current = fitZoom(
      l.bodies,
      l.scale,
      size.current.width,
      size.current.height,
      cam.current.tilt,
    );
    redraw();
  };
  const api: SystemCanvasApi = {
    zoomBy: (f) => {
      const c = cam.current;
      const fit = drawn.current.zoomToFit;
      cam.current = { ...c, zoom: clamp(c.zoom * f, fit * 0.3, fit * 30) };
      goalZoom.current = null;
      redraw();
    },
    whole: () => {
      live.current.onFollow(null);
      refit();
    },
    toggleTilt: () => {
      cam.current = { ...cam.current, tilt: !cam.current.tilt };
      live.current.onTilt(cam.current.tilt);
      redraw();
    },
    follow: (id) => {
      live.current.onFollow(id);
      if (id) goalZoom.current = drawn.current.zoomToFit * 5;
      redraw();
    },
    isTilted: () => cam.current.tilt,
  };
  useImperativeHandle(p.api, () => api);

  useEffect(() => {
    const el = canvas.current!;
    const ctx = el.getContext("2d")!;
    const fit = () => {
      const r = el.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const was = size.current;
      size.current = { width: Math.max(50, r.width), height: Math.max(50, r.height) };
      if (fitted.current) {
        // The same framing in a new size: the side bar opening must not look like a zoom.
        const l = live.current;
        const before = fitZoom(l.bodies, l.scale, was.width, was.height, cam.current.tilt);
        const after = fitZoom(
          l.bodies,
          l.scale,
          size.current.width,
          size.current.height,
          cam.current.tilt,
        );
        cam.current = { ...cam.current, zoom: (cam.current.zoom * after) / before };
      }
      el.width = size.current.width * ratio;
      el.height = size.current.height * ratio;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      if (!fitted.current) {
        fitted.current = true;
        const l = live.current;
        cam.current = {
          ...cam.current,
          zoom: fitZoom(
            l.bodies,
            l.scale,
            size.current.width,
            size.current.height,
            cam.current.tilt,
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
      const c = cam.current;
      if (goalZoom.current !== null) {
        const z = c.zoom + (goalZoom.current - c.zoom) * 0.18;
        cam.current = { ...c, zoom: Math.abs(goalZoom.current - z) < 0.005 ? goalZoom.current : z };
        if (cam.current.zoom === goalZoom.current) goalZoom.current = null;
        dirty.current = true;
      }
      if (l.playing) dirty.current = true;
      const followed = l.followed ? l.bodies.find((b) => b.id === l.followed) : undefined;
      if (followed) {
        const target = drawnPosition(followed, l.dayRef.current, l.bodies, l.scale);
        const now = cam.current;
        cam.current = {
          ...now,
          cx: now.cx + (target.x - now.cx) * 0.25,
          cy: now.cy + (target.y - now.cy) * 0.25,
        };
        dirty.current = true;
      }
      if (dirty.current) {
        dirty.current = false;
        const g = ghost.current;
        drawn.current = drawSystem(ctx, {
          bodies: l.bodies,
          looks: l.looks,
          cam: cam.current,
          day: l.dayRef.current,
          scale: l.scale,
          width: size.current.width,
          height: size.current.height,
          selected: l.selected,
          hover: hover.current,
          show: l.show,
          ghost: g ? { type: g.type, parent: g.parent, px: g.px, angle: g.angle } : null,
          phone: l.phone,
          follow: l.followed,
        });
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      cancelAnimationFrame(frame);
      watch.disconnect();
      el.removeEventListener("wheel", wheel);
    };
  }, []);

  useEffect(redraw, [
    p.map,
    p.bodies,
    p.scale,
    p.show,
    p.selected,
    p.editing,
    p.tool,
    p.adding,
    p.followed,
    p.phone,
  ]);
  // A new scale or tilt asks for a new fit, so the system is not drawn off the screen.
  const lastScale = useRef(p.scale);
  useEffect(() => {
    if (lastScale.current !== p.scale) {
      lastScale.current = p.scale;
      refit();
    }
  }, [p.scale]);

  const at = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const system = (x: number, y: number) =>
    fromScreen(cam.current, x, y, size.current.width, size.current.height);

  function zoomAt(factor: number, x: number, y: number) {
    const c = cam.current;
    const before = system(x, y);
    const fit = drawn.current.zoomToFit;
    const zoom = clamp(c.zoom * factor, fit * 0.3, fit * 30);
    goalZoom.current = null;
    const next = { ...c, zoom };
    cam.current = next;
    if (!live.current.followed) {
      const after = system(x, y);
      cam.current = { ...next, cx: next.cx + before.x - after.x, cy: next.cy + before.y - after.y };
    }
    redraw();
  }

  const pick = (x: number, y: number, touch: boolean): string | null => {
    const reach = touch ? 22 : 12;
    let best: string | null = null;
    let bd = Infinity;
    for (const b of drawn.current.bodies) {
      const d = Math.hypot(b.x - x, b.y - y);
      if (d < Math.max(reach, b.reach) && d < bd) {
        bd = d;
        best = b.id;
      }
    }
    if (best) return best;
    // A belt is picked by being inside its band.
    const q = system(x, y);
    const r = Math.hypot(q.x, q.y);
    for (const b of live.current.bodies) {
      if (b.type !== "belt") continue;
      const lo = live.current.scale === "schematic" ? 86 * Math.sqrt(b.inner) : 30 * b.inner;
      const hi = live.current.scale === "schematic" ? 86 * Math.sqrt(b.outer) : 30 * b.outer;
      if (r > lo && r < hi) return b.id;
    }
    return null;
  };

  const showTip = (x: number, y: number, words: string) => setTip({ x: x + 14, y: y + 16, words });

  const ghostAt = (x: number, y: number): (Placement & { type: BodyType }) | null => {
    const l = live.current;
    if (!l.editing || l.tool !== "add" || !l.adding) return null;
    const pl = placement(l.map, l.adding, system(x, y), l.dayRef.current, l.scale);
    return pl ? { ...pl, type: l.adding } : null;
  };

  function wordsFor(g: Placement & { type: BodyType }): string {
    const l = live.current;
    const tmp = makeBody("new", g.type, { parent: g.parent, a: g.a });
    const days = period(tmp, [...l.bodies, tmp]);
    const parent = l.bodies.find((b) => b.id === g.parent);
    if (parent && !isStar(parent))
      return `${Math.round(g.a)} thousand km from ${l.looks.get(parent.id)?.name ?? "its planet"}`;
    return `${g.a.toFixed(2)} AU out · its year: ${daysWords(days, l.bodies)}`;
  }

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
    const touch = e.pointerType !== "mouse";
    down.current = { ...q, moved: false, touch };
    const l = live.current;
    if (l.editing && l.tool === "select") {
      const id = pick(q.x, q.y, touch);
      const b = l.bodies.find((x) => x.id === id);
      if (id && b && b.type !== "belt" && b.type !== "star") {
        l.onSelect(id);
        drag.current = { type: "body", id, began: false };
        return;
      }
    }
    drag.current = { type: "pan", x: q.x, y: q.y };
  }

  function onMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const q = at(e);
    if (pts.current.has(e.pointerId)) pts.current.set(e.pointerId, q);
    const l = live.current;
    if (pinch.current && pts.current.size === 2) {
      const [a, b] = [...pts.current.values()];
      const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      zoomAt(d / pinch.current.d, (a!.x + b!.x) / 2, (a!.y + b!.y) / 2);
      pinch.current = { d };
      return;
    }
    const dn = down.current;
    if (dn && Math.hypot(q.x - dn.x, q.y - dn.y) > (dn.touch ? 8 : 4)) dn.moved = true;
    const dr = drag.current;
    if (dr && dn?.moved) {
      redraw();
      if (dr.type === "pan") {
        const c = cam.current;
        l.onFollow(null);
        cam.current = {
          ...c,
          cx: c.cx - (q.x - dr.x) / c.zoom,
          cy: c.cy - (q.y - dr.y) / (c.zoom * (c.tilt ? 0.52 : 1)),
        };
        dr.x = q.x;
        dr.y = q.y;
      } else {
        if (!dr.began) {
          l.onBegin();
          dr.began = true;
        }
        const next = dragBody(l.map, dr.id, system(q.x, q.y), l.dayRef.current, l.scale);
        l.onChange(next, false);
        const b = l.bodies.find((x) => x.id === dr.id);
        if (b) showTip(q.x, q.y, "Drag outward for a longer year, round for a new place");
      }
      return;
    }
    if (!dr) {
      const g = ghostAt(q.x, q.y);
      ghost.current = g;
      const id = g ? null : pick(q.x, q.y, e.pointerType !== "mouse");
      if (g) showTip(q.x, q.y, wordsFor(g));
      else if (id) showTip(q.x, q.y, l.looks.get(id)?.name ?? "");
      else setTip(null);
      if (hover.current !== id || g) {
        hover.current = id;
        redraw();
      }
      canvas.current!.style.cursor = id
        ? l.editing && l.bodies.find((b) => b.id === id)?.type !== "belt"
          ? "move"
          : "pointer"
        : g || (l.editing && l.tool === "add")
          ? "crosshair"
          : "grab";
    }
  }

  function onUp(e: React.PointerEvent<HTMLCanvasElement>) {
    const q = at(e);
    pts.current.delete(e.pointerId);
    if (pts.current.size < 2) pinch.current = null;
    const dn = down.current;
    if (dn && !dn.moved && pts.current.size === 0) {
      const l = live.current;
      const g = ghostAt(q.x, q.y);
      if (g && l.adding) l.onPlace(l.adding, g);
      else l.onSelect(pick(q.x, q.y, dn.touch));
    }
    if (drag.current?.type === "body") setTip(null);
    drag.current = null;
    down.current = null;
    redraw();
  }

  return (
    <>
      <canvas
        ref={canvas}
        className="map-canvas star-canvas"
        tabIndex={0}
        aria-label="The system model. Every body on it is also listed in the Objects tab."
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
          if (!drag.current) {
            hover.current = null;
            ghost.current = null;
            setTip(null);
            redraw();
          }
        }}
        onContextMenu={(e) => e.preventDefault()}
        onDoubleClick={(e) => {
          const q = at(e);
          const id = pick(q.x, q.y, false);
          const b = p.bodies.find((x) => x.id === id);
          if (b && b.type !== "belt")
            api.follow(
              isStar(b) || !b.parent
                ? b.id
                : (p.bodies.find((x) => x.id === b.parent && !isStar(x))?.id ?? b.id),
            );
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
