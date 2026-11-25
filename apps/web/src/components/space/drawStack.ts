/**
 * Draws the layered view: the globes of a stack as plates, one under the other, each with its
 * picture, zones and places, then passages between layers and the line straight down under the
 * pointer. The canvas is dark in both themes, so these colours are fixed.
 */
import type { MapFeature, MapFile } from "@frontier/schema";
import { imageUrl } from "../../api.ts";
import { type Camera, project } from "../../map/space3d.ts";
import { type Link, PLATE_H, PLATE_W, type Place, plateOf, type Spot } from "../../map/stack.ts";
import { SKY } from "./drawStars.ts";

const SERIF = '"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif';
const SANS = 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
const TAU = Math.PI * 2;

// Pictures of the maps, kept for the page's life; a picture that arrives asks for a new drawing.
const pictures = new Map<string, HTMLImageElement | "loading" | "failed">();
function picture(path: string, again: () => void): HTMLImageElement | null {
  const known = pictures.get(path);
  if (known && known !== "loading" && known !== "failed") return known;
  if (!known) {
    pictures.set(path, "loading");
    const img = new Image();
    img.onload = () => {
      pictures.set(path, img);
      again();
    };
    img.onerror = () => pictures.set(path, "failed");
    img.src = imageUrl(path, 1280);
  }
  return null;
}

export interface StackDraw {
  cam: Camera;
  width: number;
  height: number;
  order: string[];
  maps: Record<string, MapFile>;
  titles: Record<string, string>;
  spread: number;
  /** The layer being worked on, by its index in the stack. */
  active: number;
  nameOf: (f: MapFeature) => string;
  places: Place[];
  links: Link[];
  selected: string | null;
  hover: string | null;
  hidden: Set<string>;
  show: { names: boolean; passages: boolean; plumb: boolean };
  /** The spot straight down under the pointer, for the line through every layer. */
  plumb: Spot | null;
  /** A place about to be put down: where, and on which layer. */
  ghost: { layer: number; spot: Spot } | null;
  /** The place a passage is being drawn from. */
  from: string | null;
  pointer: { x: number; y: number } | null;
  phone: boolean;
  again: () => void;
}

export interface StackDrawn {
  places: { key: string; x: number; y: number; reach: number }[];
}

export const keyOf = (p: Place) => `${p.map}/${p.feature.id}`;

export function drawStack(ctx: CanvasRenderingContext2D, d: StackDraw): StackDrawn {
  const { cam, width: W, height: H } = d;
  const out: StackDrawn = { places: [] };
  const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7);
  g.addColorStop(0, SKY.centre);
  g.addColorStop(1, SKY.edge);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  const P = (spot: Spot, layer: number) => project(cam, plateOf(spot, layer, d.spread), W, H);
  const quad = (layer: number): { x: number; y: number }[] | null => {
    const pts = (
      [
        [-180, -90],
        [180, -90],
        [180, 90],
        [-180, 90],
      ] as Spot[]
    ).map((s) => P(s, layer));
    return pts.every((p) => p) ? (pts as { x: number; y: number }[]) : null;
  };

  // Passages go behind the plates they pass through: drawn first, from the lowest up.
  const passageLine = (l: Link) => {
    const a = P(l.from.feature.at as Spot, l.from.layer);
    const b = P(l.to.feature.at as Spot, l.to.layer);
    if (!a || !b) return;
    const on = d.selected === keyOf(l.from) || d.selected === keyOf(l.to);
    ctx.strokeStyle = on ? SKY.select : "#e3c58a";
    ctx.lineWidth = on ? 2.4 : 1.6;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
  };

  const boxes: [number, number, number, number][] = [];
  for (let i = d.order.length - 1; i >= 0; i--) {
    const id = d.order[i]!;
    const file = d.maps[id];
    if (!file || d.hidden.has(id)) continue;
    const active = i === d.active;
    const q = quad(i);
    if (!q) continue;
    if (d.show.passages)
      for (const l of d.links)
        if (
          Math.max(l.from.layer, l.to.layer) === i + 1 &&
          Math.min(l.from.layer, l.to.layer) === i
        )
          passageLine(l);
    ctx.globalAlpha = active ? 0.97 : 0.62;
    const path = () => {
      ctx.beginPath();
      q.forEach((p, k) => (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
    };
    ctx.fillStyle = "#2a2622";
    path();
    ctx.fill();
    for (const im of file.images) {
      if (!im.visible) continue;
      const img = picture(im.path, d.again);
      if (img) texturedPlate(ctx, img, im.extent, (s) => P(s, i));
    }
    // Zones and paths, as outlines on the plate.
    const colour = (f: MapFeature) => file.layers.find((l) => l.id === f.layer)?.color ?? "#c2410c";
    for (const f of file.features) {
      if (f.kind !== "zone" && f.kind !== "path") continue;
      const pts = f.points.map((s) => P(s as Spot, i));
      if (pts.some((p) => !p)) continue;
      ctx.beginPath();
      pts.forEach((p, k) => (k ? ctx.lineTo(p!.x, p!.y) : ctx.moveTo(p!.x, p!.y)));
      if (f.kind === "zone") {
        ctx.closePath();
        ctx.fillStyle = colour(f);
        ctx.globalAlpha = (active ? 0.97 : 0.62) * 0.18;
        ctx.fill();
        ctx.globalAlpha = active ? 0.97 : 0.62;
      }
      ctx.strokeStyle = colour(f);
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    ctx.strokeStyle = active ? SKY.paper : "rgba(235,228,214,.35)";
    ctx.lineWidth = active ? 1.8 : 1;
    path();
    ctx.stroke();
    ctx.globalAlpha = 1;
    // The layer's name at its right-hand corner.
    const right = q.reduce((a, p) => (p.x > a.x ? p : a), q[0]!);
    if (!d.phone)
      label(ctx, d.titles[id] ?? "", right.x + 10, right.y + 4, true, active ? 1 : 0.65);

    // Its places.
    for (const pl of d.places) {
      if (pl.layer !== i) continue;
      const p = P(pl.feature.at as Spot, i);
      if (!p) continue;
      const key = keyOf(pl);
      ctx.globalAlpha = active ? 1 : 0.75;
      ctx.fillStyle = SKY.paper;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "#c2410c";
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.8, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
      out.places.push({ key, x: p.x, y: p.y, reach: 10 });
      if (d.hover === key && d.selected !== key) {
        ctx.strokeStyle = SKY.select;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 10, 0, TAU);
        ctx.stroke();
      }
      if (d.selected === key || d.from === key) {
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = SKY.paper;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 8.5, 0, TAU);
        ctx.stroke();
        ctx.lineWidth = 2;
        ctx.strokeStyle = SKY.select;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 11, 0, TAU);
        ctx.stroke();
      }
      if (d.show.names && (active || d.selected === key || d.hover === key)) {
        const words = d.nameOf(pl.feature);
        ctx.font = `500 12px ${SANS}`;
        const w = ctx.measureText(words).width;
        const box: [number, number, number, number] = [p.x + 10, p.y - 7, p.x + 10 + w, p.y + 7];
        const clash = boxes.some(
          (o) => box[0] < o[2] && box[2] > o[0] && box[1] < o[3] && box[3] > o[1],
        );
        if (!clash || d.selected === key || d.hover === key) {
          boxes.push(box);
          label(ctx, words, p.x + 10, p.y + 4, false, 1);
        }
      }
    }
  }

  // A passage being drawn: a rubber line from its first place to the pointer.
  const from = d.from ? d.places.find((p) => keyOf(p) === d.from) : undefined;
  if (from && d.pointer) {
    const a = P(from.feature.at as Spot, from.layer);
    if (a) {
      const over = d.hover ? out.places.find((p) => p.key === d.hover) : undefined;
      ctx.strokeStyle = SKY.select;
      ctx.lineWidth = 1.6;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(over ? over.x : d.pointer.x, over ? over.y : d.pointer.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // The line straight down under the pointer, with a ring where it meets each layer.
  if (d.show.plumb && d.plumb) {
    ctx.strokeStyle = SKY.select;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([2, 4]);
    const top = P(d.plumb, 0);
    const bottom = P(d.plumb, d.order.length - 1);
    if (top && bottom) {
      ctx.beginPath();
      ctx.moveTo(top.x, top.y);
      ctx.lineTo(bottom.x, bottom.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    for (let i = 0; i < d.order.length; i++) {
      const p = P(d.plumb, i);
      if (!p) continue;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.2, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // Where a click would put a place.
  if (d.ghost) {
    const p = P(d.ghost.spot, d.ghost.layer);
    if (p) {
      ctx.strokeStyle = SKY.select;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 7, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  return out;
}

function label(
  ctx: CanvasRenderingContext2D,
  words: string,
  x: number,
  y: number,
  major: boolean,
  alpha: number,
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

const CELLS_X = 14;
const CELLS_Y = 7;

/**
 * Lays a picture over its extent on a plate. Canvas cannot bend a picture in perspective, so the
 * extent is cut into cells and each is drawn as two triangles, each stretched on its own.
 */
function texturedPlate(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  extent: [number, number, number, number],
  at: (spot: Spot) => { x: number; y: number } | null,
) {
  const [west, south, east, north] = extent;
  const grid: ({ x: number; y: number } | null)[][] = [];
  for (let j = 0; j <= CELLS_Y; j++) {
    const row: ({ x: number; y: number } | null)[] = [];
    for (let i = 0; i <= CELLS_X; i++) {
      row.push(at([west + ((east - west) * i) / CELLS_X, north - ((north - south) * j) / CELLS_Y]));
    }
    grid.push(row);
  }
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  for (let j = 0; j < CELLS_Y; j++) {
    for (let i = 0; i < CELLS_X; i++) {
      const c00 = grid[j]![i]!;
      const c10 = grid[j]![i + 1]!;
      const c01 = grid[j + 1]![i]!;
      const c11 = grid[j + 1]![i + 1]!;
      if (!c00 || !c10 || !c01 || !c11) continue;
      const u0 = (i / CELLS_X) * iw;
      const u1 = ((i + 1) / CELLS_X) * iw;
      const v0 = (j / CELLS_Y) * ih;
      const v1 = ((j + 1) / CELLS_Y) * ih;
      triangle(ctx, img, c00, c10, c01, [u0, v0], [u1, v0], [u0, v1]);
      triangle(ctx, img, c10, c11, c01, [u1, v0], [u1, v1], [u0, v1]);
    }
  }
}

type Pt = { x: number; y: number };
function triangle(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  s0: Pt,
  s1: Pt,
  s2: Pt,
  t0: [number, number],
  t1: [number, number],
  t2: [number, number],
) {
  const det = (t1[0] - t0[0]) * (t2[1] - t0[1]) - (t2[0] - t0[0]) * (t1[1] - t0[1]);
  if (!det) return;
  const a = ((s1.x - s0.x) * (t2[1] - t0[1]) - (s2.x - s0.x) * (t1[1] - t0[1])) / det;
  const b = ((s1.y - s0.y) * (t2[1] - t0[1]) - (s2.y - s0.y) * (t1[1] - t0[1])) / det;
  const c = ((s2.x - s0.x) * (t1[0] - t0[0]) - (s1.x - s0.x) * (t2[0] - t0[0])) / det;
  const dd = ((s2.y - s0.y) * (t1[0] - t0[0]) - (s1.y - s0.y) * (t2[0] - t0[0])) / det;
  const e = s0.x - a * t0[0] - c * t0[1];
  const f = s0.y - b * t0[0] - dd * t0[1];
  ctx.save();
  // A touch wider than the triangle, so no seam shows between neighbours.
  const cx = (s0.x + s1.x + s2.x) / 3;
  const cy = (s0.y + s1.y + s2.y) / 3;
  const grow = (p: Pt): Pt => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const len = Math.hypot(dx, dy) || 1;
    return { x: p.x + (dx / len) * 0.7, y: p.y + (dy / len) * 0.7 };
  };
  const [g0, g1, g2] = [grow(s0), grow(s1), grow(s2)];
  ctx.beginPath();
  ctx.moveTo(g0.x, g0.y);
  ctx.lineTo(g1.x, g1.y);
  ctx.lineTo(g2.x, g2.y);
  ctx.closePath();
  ctx.clip();
  ctx.transform(a, b, c, dd, e, f);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

export { PLATE_H, PLATE_W };
