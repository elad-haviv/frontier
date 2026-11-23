/**
 * Draws the graph on a canvas: the edges as one faint path, the highlighted edges, the nodes in one
 * path per colour, the rings (selected, centre, unpublished), then the labels. While a node is
 * hovered or selected, everything else is drawn at 20% opacity.
 */
import type { LayoutNode } from "./layout.ts";
import type { GraphModel, Shown } from "./model.ts";
import { shownNeighbours } from "./model.ts";
import type { FlatView } from "./pointer.ts";

/** The page's colours, read from its CSS when drawing starts and when the theme changes. */
export interface Palette {
  ink: string;
  soft: string;
  faint: string;
  paper: string;
  accent: string;
}

export interface Scene {
  model: GraphModel;
  shown: Shown;
  /** The laid-out nodes, by model index. */
  at: Map<number, LayoutNode>;
  /** Each node's colour by model index; null is the faint ink. */
  colours: (string | null)[];
  palette: Palette;
  view: FlatView;
  width: number;
  height: number;
  hover: number | null;
  selected: number | null;
  centre: number | null;
}

/** Labels are shown for every node from this zoom on. */
export const LABELS_FROM = 1.4;
/** And at any zoom for this many of the nodes with most neighbours. */
const BUSIEST = 12;
const DIM = 0.2;
const FONT_PX = 12;

/** The radius a node is drawn at, in screen pixels: scaled with the zoom, never below 2. */
export const screenRadius = (r: number, k: number): number => Math.max(2, r * k);

export function drawGraph(ctx: CanvasRenderingContext2D, s: Scene, dpr: number): void {
  const { view, width, height, palette } = s;
  const sx = (x: number) => (x - view.x) * view.k + width / 2;
  const sy = (y: number) => (y - view.y) * view.k + height / 2;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const focus = s.hover ?? s.selected;
  const lit = new Set<number>();
  if (focus !== null && s.shown.has[focus]) {
    lit.add(focus);
    for (const j of shownNeighbours(s.model, s.shown, focus)) lit.add(j);
  }
  const dimmed = lit.size > 0;
  const isLit = (i: number) => !dimmed || lit.has(i);

  // Edges: the faint ones in one path, those touching the focus after them.
  ctx.lineWidth = 1;
  ctx.strokeStyle = palette.faint;
  ctx.globalAlpha = dimmed ? 0.45 * DIM : 0.45;
  ctx.beginPath();
  const strong: [LayoutNode, LayoutNode][] = [];
  for (const [a, b] of s.shown.edges) {
    const p = s.at.get(a);
    const q = s.at.get(b);
    if (!p || !q) continue;
    if (dimmed && (a === focus || b === focus)) {
      strong.push([p, q]);
      continue;
    }
    ctx.moveTo(sx(p.x!), sy(p.y!));
    ctx.lineTo(sx(q.x!), sy(q.y!));
  }
  ctx.stroke();
  if (strong.length > 0) {
    ctx.globalAlpha = 1;
    ctx.strokeStyle = palette.soft;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (const [p, q] of strong) {
      ctx.moveTo(sx(p.x!), sy(p.y!));
      ctx.lineTo(sx(q.x!), sy(q.y!));
    }
    ctx.stroke();
  }

  // Nodes: one path per colour and brightness.
  const groups = new Map<string, LayoutNode[]>();
  for (const i of s.shown.nodes) {
    const n = s.at.get(i);
    if (!n) continue;
    const key = `${isLit(i) ? 1 : 0}${s.colours[i] ?? palette.faint}`;
    const list = groups.get(key) ?? [];
    list.push(n);
    groups.set(key, list);
  }
  for (const [key, list] of groups) {
    ctx.globalAlpha = key[0] === "1" ? 1 : DIM;
    ctx.fillStyle = key.slice(1);
    ctx.beginPath();
    for (const n of list) {
      const r = screenRadius(n.r, view.k);
      ctx.moveTo(sx(n.x!) + r, sy(n.y!));
      ctx.arc(sx(n.x!), sy(n.y!), r, 0, 2 * Math.PI);
    }
    ctx.fill();
  }

  // Rings: the unpublished dashed, the centre and the selection solid.
  const ring = (n: LayoutNode, colour: string, width: number, gap: number, dash: number[]) => {
    ctx.globalAlpha = isLit(n.i) ? 1 : DIM;
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.arc(sx(n.x!), sy(n.y!), screenRadius(n.r, view.k) + gap, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.setLineDash([]);
  };
  for (const i of s.shown.nodes) {
    const n = s.at.get(i);
    if (n && s.model.nodes[i]!.unpublished) ring(n, palette.soft, 1.25, 2.5, [3, 2]);
  }
  const centre = s.centre !== null ? s.at.get(s.centre) : undefined;
  if (centre) ring(centre, palette.ink, 1.5, 3, []);
  const selected = s.selected !== null ? s.at.get(s.selected) : undefined;
  if (selected) ring(selected, palette.accent, 2.5, 3.5, []);

  drawLabels(ctx, s, lit, sx, sy);
  ctx.globalAlpha = 1;
}

/**
 * Labels below their nodes, with a halo in the page colour: the hovered and selected nodes and
 * their neighbours always, the busiest nodes at any zoom, every node once zoomed in. They are
 * placed largest node first; one that would overlap a placed label, or is off screen, is skipped.
 */
function drawLabels(
  ctx: CanvasRenderingContext2D,
  s: Scene,
  lit: Set<number>,
  sx: (x: number) => number,
  sy: (y: number) => number,
): void {
  const { view, width, height, palette } = s;
  const busiest = new Set(
    [...s.shown.nodes].sort((a, b) => s.shown.degree[b]! - s.shown.degree[a]!).slice(0, BUSIEST),
  );
  const always = new Set(lit);
  for (const i of [s.hover, s.selected]) {
    if (i === null || !s.shown.has[i]) continue;
    always.add(i);
    for (const j of shownNeighbours(s.model, s.shown, i)) always.add(j);
  }
  const wanted = s.shown.nodes.filter(
    (i) => always.has(i) || busiest.has(i) || view.k >= LABELS_FROM,
  );
  // Those the author is looking at first, then the largest.
  wanted.sort(
    (a, b) =>
      Number(always.has(b)) - Number(always.has(a)) || s.shown.degree[b]! - s.shown.degree[a]!,
  );
  ctx.font = `${FONT_PX}px ${getFontFamily()}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.lineJoin = "round";
  const cell = 24;
  const taken = new Map<string, { x0: number; y0: number; x1: number; y1: number }[]>();
  const cells = (b: { x0: number; y0: number; x1: number; y1: number }) => {
    const out: string[] = [];
    for (let cx = Math.floor(b.x0 / cell); cx <= Math.floor(b.x1 / cell); cx++) {
      for (let cy = Math.floor(b.y0 / cell); cy <= Math.floor(b.y1 / cell); cy++) {
        out.push(`${cx} ${cy}`);
      }
    }
    return out;
  };
  const dimmed = lit.size > 0;
  for (const i of wanted) {
    const n = s.at.get(i);
    if (!n) continue;
    const x = sx(n.x!);
    const y = sy(n.y!) + screenRadius(n.r, view.k) + 3;
    const text = s.model.nodes[i]!.title;
    const w = ctx.measureText(text).width;
    const box = { x0: x - w / 2 - 2, y0: y - 1, x1: x + w / 2 + 2, y1: y + FONT_PX + 2 };
    if (box.x1 < 0 || box.x0 > width || box.y1 < 0 || box.y0 > height) continue;
    const keys = cells(box);
    const overlaps = keys.some((k) =>
      (taken.get(k) ?? []).some(
        (o) => o.x0 < box.x1 && box.x0 < o.x1 && o.y0 < box.y1 && box.y0 < o.y1,
      ),
    );
    if (overlaps) continue;
    for (const k of keys) taken.set(k, [...(taken.get(k) ?? []), box]);
    ctx.globalAlpha = !dimmed || lit.has(i) ? 1 : DIM;
    ctx.lineWidth = 3;
    ctx.strokeStyle = palette.paper;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = lit.has(i) ? palette.ink : palette.soft;
    ctx.fillText(text, x, y);
  }
}

let family: string | null = null;
/** The page's UI font, read once. */
function getFontFamily(): string {
  family ??=
    typeof document === "undefined"
      ? "sans-serif"
      : getComputedStyle(document.body).fontFamily || "sans-serif";
  return family;
}

/** Reads the page's colours for drawing, from an element inside it. */
export function readPalette(el: Element): Palette {
  const css = getComputedStyle(el);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    ink: v("--ink", "#23201b"),
    soft: v("--ink-soft", "#5d564b"),
    faint: v("--ink-faint", "#6e665a"),
    paper: v("--paper", "#f7f3ea"),
    accent: v("--accent", "#9a3b1c"),
  };
}
