/**
 * The World Wizard's view of the world (stage 34): one layer of it, as a globe that turns or laid
 * flat, with the plates' arrows or the winds' drawn over it. A drag paints with the brush when
 * painting is on, and otherwise turns the globe.
 */
import { type PointerEvent, useCallback, useEffect, useRef } from "react";
import {
  cellAt,
  cellDegrees,
  H,
  LAT,
  plateMiddles,
  velocityAt,
  W,
  windAt,
  type World,
} from "../../world/model.ts";
import { type Layer, paintLayer } from "../../world/picture.ts";
import type { River } from "../../world/rivers.ts";

const FLAT = { w: 1080, h: 540 };
const GLOBE = 480;
const RADIUS = GLOBE / 2 - 6;
const RAD = Math.PI / 180;

export interface Turn {
  lon: number;
  lat: number;
}

export function WorldCanvas({
  world,
  layer,
  globe,
  version,
  turn,
  painting,
  onStroke,
  onStrokeEnd,
  selectedPlate,
  winds,
  tilt,
  spinning,
  rivers,
  lakes,
  pins,
  hidden,
}: {
  world: World;
  layer: Layer;
  globe: boolean;
  /** Changes whenever the world does, so the view is drawn again. */
  version: number;
  /** Which way the globe faces; changed here as it is dragged. */
  turn: { current: Turn };
  /** A drag paints. Otherwise it turns the globe. */
  painting: boolean;
  /** The cell under the pointer as a stroke starts (`first`) and goes on. False refuses the stroke. */
  onStroke: (cell: number, first: boolean) => boolean;
  onStrokeEnd: () => void;
  /** In the plates layer: the plate whose arrow is drawn brightest. */
  selectedPlate?: number;
  winds?: boolean;
  /** Draws the globe leaning by this many degrees, for the Basics part. */
  tilt?: number;
  /** Drawn over the climate and the biomes. */
  rivers?: readonly River[];
  /** Which cells lie under a lake, drawn over the land. */
  lakes?: Uint8Array | null;
  /** Numbered places, drawn over the biomes. */
  pins?: readonly { cell: number; n: number }[] | undefined;
  /** Not shown, while another view (the star system) takes its place. */
  hidden?: boolean;
  /** Turns the globe slowly: 1 west to east, -1 the other way, 0 not at all. */
  spinning?: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const grid = useRef<{ canvas: HTMLCanvasElement; image: ImageData } | null>(null);
  const drag = useRef<{ paint: boolean; x: number; y: number } | null>(null);

  const draw = useCallback(() => {
    const cv = canvas.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    if (!grid.current) {
      const g = document.createElement("canvas");
      g.width = W;
      g.height = H;
      grid.current = { canvas: g, image: new ImageData(W, H) };
    }
    const { canvas: g, image } = grid.current;
    paintLayer(world, layer, image.data, lakes);
    const w = globe ? GLOBE : FLAT.w;
    const h = globe ? GLOBE : FLAT.h;
    if (cv.width !== w || cv.height !== h) {
      cv.width = w;
      cv.height = h;
    }
    ctx.clearRect(0, 0, w, h);
    const { lon, lat } = turn.current;
    const cl = Math.cos(lat);
    const sl = Math.sin(lat);
    if (!globe) {
      g.getContext("2d")?.putImageData(image, 0, 0);
      ctx.imageSmoothingEnabled = layer !== "plates" && layer !== "mask";
      ctx.drawImage(g, 0, 0, w, h);
    } else {
      const out = ctx.createImageData(GLOBE, GLOBE);
      const d = out.data;
      const src = image.data;
      for (let py = 0; py < GLOBE; py++) {
        const y = (GLOBE / 2 - py) / RADIUS;
        for (let px = 0; px < GLOBE; px++) {
          const x = (px - GLOBE / 2) / RADIUS;
          const rr = x * x + y * y;
          if (rr > 1) continue;
          const z = Math.sqrt(1 - rr);
          const la = Math.asin(Math.max(-1, Math.min(1, y * cl + z * sl)));
          const lo = lon + Math.atan2(x, z * cl - y * sl);
          const s = cellAt(la, lo) * 4;
          const o = (py * GLOBE + px) * 4;
          const lit = 0.5 + 0.5 * z;
          d[o] = src[s]! * lit;
          d[o + 1] = src[s + 1]! * lit;
          d[o + 2] = src[s + 2]! * lit;
          d[o + 3] = rr > 0.985 ? 150 : 255;
        }
      }
      ctx.putImageData(out, 0, 0);
    }
    /** Where a place is drawn; null when it is on the far side of the globe. */
    const place = (latDeg: number, lonDeg: number): [number, number] | null => {
      const la = latDeg * RAD;
      const lo = lonDeg * RAD;
      if (!globe) return [(lonDeg / 360 + 0.5) * w, (0.5 - latDeg / 180) * h];
      const dl = lo - lon;
      if (sl * Math.sin(la) + cl * Math.cos(la) * Math.cos(dl) < 0.1) return null;
      return [
        GLOBE / 2 + RADIUS * Math.cos(la) * Math.sin(dl),
        GLOBE / 2 - RADIUS * (cl * Math.sin(la) - sl * Math.cos(la) * Math.cos(dl)),
      ];
    };
    const arrow = (at: [number, number], dx: number, dy: number, len: number, colour: string) => {
      const n = Math.hypot(dx, dy) || 1;
      const ux = (dx / n) * len;
      const uy = (dy / n) * len;
      const a = Math.atan2(uy, ux);
      const tip: [number, number] = [at[0] + ux / 2, at[1] + uy / 2];
      ctx.strokeStyle = colour;
      ctx.fillStyle = colour;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(at[0] - ux / 2, at[1] - uy / 2);
      ctx.lineTo(tip[0], tip[1]);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(tip[0], tip[1]);
      ctx.lineTo(tip[0] - 9 * Math.cos(a - 0.5), tip[1] - 9 * Math.sin(a - 0.5));
      ctx.lineTo(tip[0] - 9 * Math.cos(a + 0.5), tip[1] - 9 * Math.sin(a + 0.5));
      ctx.fill();
    };
    if (rivers && (layer === "rain" || layer === "temp" || layer === "biome")) {
      ctx.strokeStyle = layer === "biome" ? "#1f5f8f" : "rgba(255,255,255,.85)";
      ctx.lineCap = "round";
      for (const river of rivers) {
        ctx.lineWidth = Math.max(1, Math.min(3.5, Math.sqrt(river.flow) * 0.35));
        ctx.beginPath();
        let before: [number, number] | null = null;
        for (const cell of river.cells) {
          const [la, lo] = cellDegrees(cell);
          const at = place(la, lo);
          // A course is cut where it leaves the near side of the globe or crosses the flat view's edge.
          if (!at || !before || Math.abs(at[0] - before[0]) > w / 4) {
            if (at) ctx.moveTo(at[0], at[1]);
          } else ctx.lineTo(at[0], at[1]);
          before = at;
        }
        ctx.stroke();
      }
    }
    for (const pin of pins ?? []) {
      const [la, lo] = cellDegrees(pin.cell);
      const at = place(la, lo);
      if (!at) continue;
      ctx.fillStyle = "#9a3b1c";
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(at[0], at[1], 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 13px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(pin.n), at[0], at[1] + 0.5);
    }
    if (layer === "plates") {
      plateMiddles(world).forEach((cell, p) => {
        if (cell < 0) return;
        const [la, lo] = cellDegrees(cell);
        const at = place(la, lo);
        const v = velocityAt(world, p, cell);
        if (!at || (v[0] === 0 && v[1] === 0)) return;
        arrow(
          at,
          v[0],
          v[1],
          18 + (world.drift[p]?.speed ?? 0) * 4,
          p === selectedPlate ? "#ffffff" : "rgba(255,255,255,.7)",
        );
      });
    }
    if (winds && (layer === "rain" || layer === "temp")) {
      for (let y = 7; y < H; y += 15) {
        for (let x = 10; x < W; x += 24) {
          const at = place((LAT[y]! * 180) / Math.PI, ((x + 0.5) / W - 0.5) * 360);
          if (at) arrow(at, windAt(world, y), 0, 20, "rgba(255,255,255,.8)");
        }
      }
    }
  }, [world, layer, globe, turn, selectedPlate, winds, rivers, lakes, pins]);

  useEffect(draw, [draw, version]);

  useEffect(() => {
    if (!spinning || !globe) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => {
      turn.current.lon -= spinning * 0.012;
      draw();
    }, 60);
    return () => window.clearInterval(timer);
  }, [spinning, globe, draw, turn]);

  /** The cell under the pointer, or -1 off the globe. */
  const cellUnder = (e: PointerEvent<HTMLCanvasElement>): number => {
    const r = e.currentTarget.getBoundingClientRect();
    const u = (e.clientX - r.left) / r.width;
    const v = (e.clientY - r.top) / r.height;
    if (!globe) {
      return Math.min(H - 1, Math.floor(v * H)) * W + Math.min(W - 1, Math.floor(u * W));
    }
    const x = (u * GLOBE - GLOBE / 2) / RADIUS;
    const y = (GLOBE / 2 - v * GLOBE) / RADIUS;
    const rr = x * x + y * y;
    if (rr > 1) return -1;
    const z = Math.sqrt(1 - rr);
    const { lon, lat } = turn.current;
    const cl = Math.cos(lat);
    const sl = Math.sin(lat);
    return cellAt(
      Math.asin(Math.max(-1, Math.min(1, y * cl + z * sl))),
      lon + Math.atan2(x, z * cl - y * sl),
    );
  };

  return (
    <canvas
      ref={canvas}
      hidden={hidden}
      className={`ww-canvas${globe ? " is-globe" : ""}${painting ? " is-painting" : ""}`}
      style={globe && tilt ? { transform: `rotate(${tilt}deg)` } : undefined}
      width={FLAT.w}
      height={FLAT.h}
      role="img"
      aria-label="The world being built"
      onPointerDown={(e) => {
        // A drag here paints or turns: it never selects the words of the page.
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        let paint = painting;
        if (paint) {
          const cell = cellUnder(e);
          paint = cell >= 0 && onStroke(cell, true);
          if (!paint && cell >= 0) return;
        }
        drag.current = { paint, x: e.clientX, y: e.clientY };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        if (d.paint) {
          const cell = cellUnder(e);
          if (cell >= 0) onStroke(cell, false);
          return;
        }
        if (!globe) return;
        turn.current.lon -= (e.clientX - d.x) * 0.008;
        turn.current.lat = Math.max(
          -1.4,
          Math.min(1.4, turn.current.lat + (e.clientY - d.y) * 0.008),
        );
        d.x = e.clientX;
        d.y = e.clientY;
        draw();
      }}
      onPointerUp={() => {
        if (drag.current?.paint) onStrokeEnd();
        drag.current = null;
      }}
      onPointerCancel={() => {
        if (drag.current?.paint) onStrokeEnd();
        drag.current = null;
      }}
    />
  );
}
