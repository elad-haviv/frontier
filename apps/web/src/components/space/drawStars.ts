/**
 * Draws a star map on a canvas: dark space, a plane with distance rings, routes, then the stars
 * from far to near. It returns where things were drawn, so the pointer can pick them. The
 * canvas is dark in both themes, as a map's image is, so these colours are fixed.
 */
import type { MapFile } from "@frontier/schema";
import {
  type Camera,
  dotRadius,
  fade,
  numberText,
  type Point3,
  project,
  routeLength,
} from "../../map/space3d.ts";
import {
  LANES,
  type Route,
  lookOf,
  placeOf,
  type Star,
  stopsOf,
  toneOf,
} from "../../map/starMap.ts";

export const SKY = {
  ink: "#ebe4d6",
  soft: "#9a917f",
  grid: "#2a2e3a",
  grid2: "#3a3f4e",
  select: "#fb923c",
  paper: "#fbf7f0",
  centre: "#1a1c26",
  edge: "#0f1017",
};
const SERIF = '"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif';
const SANS = 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
const MONO = "ui-monospace,Menlo,Consolas,monospace";
const TAU = Math.PI * 2;
/** Half the width of the plane drawn, in map units. */
export const PLANE = 14;

export interface StarDraw {
  map: MapFile;
  cam: Camera;
  width: number;
  height: number;
  /** The words a star goes by: its label, else its entry's name. */
  nameOf: (f: Star | Route) => string;
  hover: string | null;
  selected: string | null;
  hiddenLayers: Set<string>;
  show: { names: boolean; drops: boolean; rings: boolean };
  /** While editing with the Marker tool: where a click would put a star. */
  ghost: Point3 | null;
  /** The stops of the route being drawn, and the pointer, for its rubber line. */
  draft: string[] | null;
  pointer: { x: number; y: number } | null;
  /** Show the height handle on the selected star. */
  handle: boolean;
  phone: boolean;
}

export interface Drawn {
  /** Every star drawn, with the place it was drawn at and how far a press reaches it. */
  stars: { id: string; x: number; y: number; reach: number; pin: boolean }[];
  /** The screen place of the selected star's height handle. */
  handle: { x: number; y: number } | null;
  /** The screen segments of routes, for picking. */
  legs: { id: string; ax: number; ay: number; bx: number; by: number }[];
}

// A fixed scatter of dust, on a sphere, so it turns with the view but never changes.
const hash = (i: number) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const DUST = Array.from({ length: 260 }, (_, i) => {
  const u = hash(i) * 2 - 1;
  const a = hash(i + 999) * TAU;
  const s = Math.sqrt(1 - u * u);
  return { x: s * Math.cos(a), y: s * Math.sin(a), z: u, alpha: 0.06 + hash(i + 77) * 0.14 };
});

function text(
  ctx: CanvasRenderingContext2D,
  words: string,
  x: number,
  y: number,
  major: boolean,
  alpha = 1,
) {
  ctx.font = major ? `600 13px ${SERIF}` : `500 12px ${SANS}`;
  ctx.lineWidth = 3;
  ctx.lineJoin = "round";
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = SKY.edge;
  ctx.strokeText(words, x, y);
  ctx.fillStyle = SKY.ink;
  ctx.fillText(words, x, y);
  ctx.globalAlpha = 1;
}

function glowDot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  colour: string,
  a: number,
) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r * 3.2);
  g.addColorStop(0, colour);
  g.addColorStop(0.3, colour);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.globalAlpha = 0.38 * a;
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r * 3.2, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = a;
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function pin(ctx: CanvasRenderingContext2D, x: number, y: number, colour: string, a: number) {
  ctx.globalAlpha = a;
  ctx.fillStyle = SKY.paper;
  ctx.strokeStyle = "#23201b";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.bezierCurveTo(x - 11, y - 12, x - 9, y - 25, x, y - 25);
  ctx.bezierCurveTo(x + 9, y - 25, x + 11, y - 12, x, y);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = colour.toLowerCase() === SKY.paper ? "#9a3b1c" : colour;
  ctx.beginPath();
  ctx.arc(x, y - 16, 3.6, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function selectRing(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = SKY.paper;
  ctx.beginPath();
  ctx.arc(x, y, r + 3, 0, TAU);
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.strokeStyle = SKY.select;
  ctx.beginPath();
  ctx.arc(x, y, r + 5.5, 0, TAU);
  ctx.stroke();
}

function pill(ctx: CanvasRenderingContext2D, words: string, x: number, y: number) {
  ctx.font = `12px ${SANS}`;
  const w = ctx.measureText(words).width + 12;
  ctx.fillStyle = SKY.ink;
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - 10, w, 19, 4);
  ctx.fill();
  ctx.fillStyle = SKY.edge;
  ctx.fillText(words, x - w / 2 + 6, y + 4);
}

export function drawStars(ctx: CanvasRenderingContext2D, d: StarDraw): Drawn {
  const { map, cam, width: W, height: H } = d;
  const unit = map.space.kind === "stars" ? map.space.unit : "ly";
  const P = (p: Point3) => project(cam, p, W, H);
  const out: Drawn = { stars: [], handle: null, legs: [] };

  // Space.
  const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7);
  g.addColorStop(0, SKY.centre);
  g.addColorStop(1, SKY.edge);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const cy = Math.cos(cam.yaw);
  const sy = Math.sin(cam.yaw);
  const cp = Math.cos(cam.pitch);
  const sp = Math.sin(cam.pitch);
  const R = Math.max(W, H) * 0.75;
  ctx.fillStyle = SKY.ink;
  for (const s of DUST) {
    const x1 = s.x * cy - s.y * sy;
    const y1 = s.x * sy + s.y * cy;
    if (y1 * cp - s.z * sp < 0.05) continue;
    ctx.globalAlpha = s.alpha;
    ctx.fillRect(W / 2 + x1 * R, H / 2 - (y1 * sp + s.z * cp) * R, 1.2, 1.2);
  }
  ctx.globalAlpha = 1;

  const segment = (a: Point3, b: Point3): boolean => {
    const p = P(a);
    const q = P(b);
    if (!p || !q) return false;
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
    return true;
  };

  // The plane, with every fifth line stronger.
  ctx.lineWidth = 1;
  for (let pass = 0; pass < 2; pass++) {
    ctx.strokeStyle = pass ? SKY.grid2 : SKY.grid;
    ctx.beginPath();
    for (let i = -PLANE; i <= PLANE; i += 2) {
      if ((i % 10 === 0) !== (pass === 1)) continue;
      segment({ x: i, y: -PLANE, z: 0 }, { x: i, y: PLANE, z: 0 });
      segment({ x: -PLANE, y: i, z: 0 }, { x: PLANE, y: i, z: 0 });
    }
    ctx.stroke();
  }
  if (d.show.rings) {
    ctx.strokeStyle = SKY.grid2;
    ctx.setLineDash([3, 4]);
    for (const r of [5, 10]) {
      ctx.beginPath();
      let first = true;
      for (let i = 0; i <= 72; i++) {
        const p = P({ x: Math.cos((i / 72) * TAU) * r, y: Math.sin((i / 72) * TAU) * r, z: 0 });
        if (!p) {
          first = true;
          continue;
        }
        if (first) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
        first = false;
      }
      ctx.stroke();
      const p = P({ x: r, y: 0, z: 0 });
      if (p && !d.phone) {
        ctx.font = `10px ${MONO}`;
        ctx.fillStyle = SKY.soft;
        ctx.fillText(`${r} ${unit}`, p.x + 4, p.y - 3);
      }
    }
    ctx.setLineDash([]);
  }
  if (!d.phone) {
    ctx.font = `10px ${MONO}`;
    ctx.fillStyle = SKY.soft;
    const a = P({ x: PLANE, y: 0, z: 0 });
    if (a) ctx.fillText("coreward", a.x + 6, a.y + 3);
    const b = P({ x: 0, y: PLANE, z: 0 });
    if (b) ctx.fillText("spinward", b.x + 6, b.y + 3);
  }

  const shown = (f: { layer: string }) => !d.hiddenLayers.has(f.layer);
  const starsDrawn = map.features.filter((f): f is Star => f.kind === "marker" && shown(f));

  // Routes.
  for (const f of map.features) {
    if (f.kind !== "route" || !shown(f)) continue;
    const lane = LANES[f.lane ?? "jump"];
    const stops = stopsOf(map, f);
    const on = d.selected === f.id || d.hover === f.id;
    const path = () => {
      ctx.beginPath();
      for (let i = 1; i < stops.length; i++) segment(placeOf(stops[i - 1]!), placeOf(stops[i]!));
    };
    if (on) {
      ctx.strokeStyle = SKY.select;
      ctx.globalAlpha = d.selected === f.id ? 0.45 : 0.25;
      ctx.lineWidth = lane.width + 4;
      path();
      ctx.stroke();
    }
    ctx.globalAlpha = on ? 1 : 0.8;
    ctx.strokeStyle = lane.colour;
    ctx.lineWidth = lane.width;
    ctx.lineCap = "round";
    ctx.setLineDash(lane.dash);
    path();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    for (let i = 1; i < stops.length; i++) {
      const p = P(placeOf(stops[i - 1]!));
      const q = P(placeOf(stops[i]!));
      if (p && q) out.legs.push({ id: f.id, ax: p.x, ay: p.y, bx: q.x, by: q.y });
    }
    if (d.selected === f.id) {
      for (let i = 1; i < stops.length; i++) {
        const a = placeOf(stops[i - 1]!);
        const b = placeOf(stops[i]!);
        const m = P({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });
        if (m) pill(ctx, `${numberText(routeLength([a, b]))} ${unit}`, m.x, m.y);
      }
    }
  }

  // The route being drawn.
  const draft = d.draft
    ?.map((id) => starsDrawn.find((s) => s.id === id))
    .filter((s): s is Star => !!s);
  if (draft && draft.length > 0) {
    ctx.strokeStyle = SKY.select;
    ctx.lineWidth = 1.6;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    for (let i = 1; i < draft.length; i++) segment(placeOf(draft[i - 1]!), placeOf(draft[i]!));
    const last = P(placeOf(draft[draft.length - 1]!));
    if (last && d.pointer) {
      ctx.moveTo(last.x, last.y);
      const over = d.hover ? starsDrawn.find((s) => s.id === d.hover) : undefined;
      const at = over ? P(placeOf(over)) : null;
      ctx.lineTo(at ? at.x : d.pointer.x, at ? at.y : d.pointer.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Lines down to the plane, far to near.
  const placed = starsDrawn
    .map((s) => ({ s, p: P(placeOf(s)) }))
    .filter((o): o is { s: Star; p: NonNullable<ReturnType<typeof P>> } => o.p !== null)
    .sort((a, b) => b.p.depth - a.p.depth);
  for (const { s, p } of placed) {
    const on = d.selected === s.id || d.hover === s.id;
    const z = s.z ?? 0;
    if ((d.show.drops || on) && Math.abs(z) > 0.05) {
      const foot = P({ x: s.at[0], y: s.at[1], z: 0 });
      if (!foot) continue;
      ctx.strokeStyle = SKY.ink;
      ctx.globalAlpha = on ? 0.6 : 0.22;
      ctx.lineWidth = 1;
      ctx.setLineDash(z < 0 ? [2, 3] : []);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(foot.x, foot.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = SKY.ink;
      ctx.beginPath();
      ctx.arc(foot.x, foot.y, 1.8, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  // The stars.
  const boxes: [number, number, number, number][] = [];
  const drawn = new Map<string, { x: number; y: number; r: number; pin: boolean }>();
  for (const { s, p } of placed) {
    const size = s.size ?? 2;
    const r = dotRadius(size, p.scale);
    const pinned = lookOf(map, s) === "pin";
    const a = fade(p.scale);
    const colour = toneOf(map, s);
    if (pinned) pin(ctx, p.x, p.y, colour, a);
    else glowDot(ctx, p.x, p.y, r, colour, a);
    const cy2 = p.y - (pinned ? 14 : 0);
    if (d.hover === s.id && d.selected !== s.id) {
      ctx.strokeStyle = SKY.select;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(p.x, cy2, pinned ? 13 : r + 5, 0, TAU);
      ctx.stroke();
    }
    if (d.selected === s.id) selectRing(ctx, p.x, cy2, pinned ? 10 : r);
    drawn.set(s.id, { x: p.x, y: p.y, r: pinned ? 10 : r, pin: pinned });
    out.stars.push({
      id: s.id,
      x: p.x,
      y: pinned ? p.y - 14 : p.y,
      reach: Math.max(pinned ? 14 : r + 5, 0),
      pin: pinned,
    });
  }

  // Names, nearest first, so the nearer wins a clash.
  if (d.show.names) {
    for (const { s, p } of [...placed].reverse()) {
      const on = d.selected === s.id || d.hover === s.id;
      const size = s.size ?? 2;
      const major = size === 3;
      if (!(on || major || (size === 2 && cam.zoom > 17) || cam.zoom > 34)) continue;
      const q = drawn.get(s.id)!;
      const words = d.nameOf(s);
      ctx.font = major ? `600 13px ${SERIF}` : `500 12px ${SANS}`;
      const w = ctx.measureText(words).width;
      const x = p.x + (q.pin ? 13 : q.r + 7);
      const y = p.y + (q.pin ? -12 : 4);
      const box: [number, number, number, number] = [x, y - 11, x + w, y + 3];
      if (
        !on &&
        boxes.some((o) => box[0] < o[2] && box[2] > o[0] && box[1] < o[3] && box[3] > o[1])
      )
        continue;
      boxes.push(box);
      text(ctx, words, x, y, major, on ? 1 : Math.max(0.6, Math.min(1, p.scale + 0.1)));
    }
  }

  // The handle that lifts the selected star, while editing.
  const sel = d.selected ? drawn.get(d.selected) : undefined;
  if (d.handle && sel && cam.pitch < 1.4) {
    const x = sel.x;
    const y = sel.y - (sel.pin ? 44 : 30);
    out.handle = { x, y };
    ctx.strokeStyle = SKY.select;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, sel.y - (sel.pin ? 27 : sel.r + 6));
    ctx.lineTo(x, y + 9);
    ctx.stroke();
    ctx.fillStyle = SKY.paper;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = "#23201b";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(x, y - 5);
    ctx.lineTo(x, y + 5);
    ctx.moveTo(x - 3, y - 2);
    ctx.lineTo(x, y - 5);
    ctx.lineTo(x + 3, y - 2);
    ctx.moveTo(x - 3, y + 2);
    ctx.lineTo(x, y + 5);
    ctx.lineTo(x + 3, y + 2);
    ctx.stroke();
  }

  // Where a click would put a star.
  if (d.ghost) {
    const p = P(d.ghost);
    if (p) {
      ctx.strokeStyle = SKY.select;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 7, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = SKY.select;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2, 0, TAU);
      ctx.fill();
    }
  }
  return out;
}
