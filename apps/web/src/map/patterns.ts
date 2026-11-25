/**
 * The patterns drawn over a biome zone's fill: sixteen small tiles of glyphs (dots, trees, reeds,
 * peaks), drawn by code in a darker shade of the zone's own colour. A tile is TILE pixels on the
 * screen whatever the zoom, as a line's width is, so the texture neither turns to mush zoomed
 * out nor blows up zoomed in. Every glyph keeps clear of the tile's edges, so the tiles meet
 * without a seam. The glyphs are drawn through a small pen, so the tests can measure them
 * without a canvas.
 */
import type { Pattern } from "@frontier/schema";

/** The side of a tile, in screen pixels. */
export const TILE = 32;
/** How far from the tile's edge every glyph's middle stays: the largest glyph reaches 4.6. */
const MARGIN = 5.5;

/** What a glyph is drawn with: a canvas, or something that measures. */
export interface Pen {
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, r: number, from: number, to: number): void;
  ellipse(
    x: number,
    y: number,
    rx: number,
    ry: number,
    turn: number,
    from: number,
    to: number,
  ): void;
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void;
  closePath(): void;
  stroke(): void;
  fill(): void;
}

/** The same random numbers for a pattern every time, so a tile never changes. */
function seeded(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** How wide a glyph's lines are, in screen pixels. */
export const GLYPH_LINE = 0.9;

/** Draws one tile of a pattern with `g`, in tile pixels (0 to TILE). */
export function drawGlyphs(g: Pen, pattern: Pattern, seed = 13): void {
  const R = seeded(pattern.length * 977 + pattern.charCodeAt(0) * 31 + seed);
  const lo = MARGIN;
  const hi = TILE - MARGIN;
  /** n × n glyphs, jittered and staggered, each kept clear of the edges. */
  const grid = (n: number, f: (x: number, y: number, r: () => number) => void) => {
    const s = TILE / n;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = (i + 0.5) * s + (R() - 0.5) * s * 0.45 + (j % 2) * s * 0.25;
        const y = (j + 0.5) * s + (R() - 0.5) * s * 0.45;
        f(Math.min(hi, Math.max(lo, x)), Math.min(hi, Math.max(lo, y)), R);
      }
    }
  };
  const B = () => g.beginPath();
  const T = Math.PI * 2;
  switch (pattern) {
    case "dots":
      grid(5, (x, y, r) => {
        B();
        g.arc(x, y, 0.75 + r() * 0.5, 0, T);
        g.fill();
      });
      break;
    case "stipple":
      grid(7, (x, y) => {
        B();
        g.arc(x, y, 0.5, 0, T);
        g.fill();
      });
      break;
    case "trees":
      grid(3, (x, y) => {
        B();
        g.arc(x, y - 1.5, 2.6, 0, T);
        g.stroke();
        B();
        g.moveTo(x, y + 1.1);
        g.lineTo(x, y + 3.6);
        g.stroke();
      });
      break;
    case "conifers":
      grid(3, (x, y) => {
        B();
        g.moveTo(x - 2.4, y + 2.6);
        g.lineTo(x, y - 3.4);
        g.lineTo(x + 2.4, y + 2.6);
        g.closePath();
        g.stroke();
        B();
        g.moveTo(x, y + 2.6);
        g.lineTo(x, y + 4.2);
        g.stroke();
      });
      break;
    case "canopy":
      grid(4, (x, y) => {
        B();
        g.arc(x - 1.6, y, 1.8, Math.PI, 0);
        g.moveTo(x - 0.2, y);
        g.arc(x + 1.6, y, 1.8, Math.PI, 0);
        g.stroke();
      });
      break;
    case "tufts":
      grid(3, (x, y) => {
        B();
        g.moveTo(x - 2, y - 2.6);
        g.lineTo(x - 0.6, y + 1);
        g.moveTo(x, y - 3.2);
        g.lineTo(x, y + 1);
        g.moveTo(x + 2, y - 2.6);
        g.lineTo(x + 0.6, y + 1);
        g.stroke();
      });
      break;
    case "savanna":
      grid(3, (x, y, r) => {
        if (r() < 0.25) {
          B();
          g.moveTo(x, y + 3);
          g.lineTo(x, y - 1);
          g.stroke();
          B();
          g.ellipse(x, y - 2, 3.2, 1.3, 0, 0, T);
          g.stroke();
        } else {
          B();
          g.moveTo(x - 1.6, y - 2);
          g.lineTo(x - 0.5, y + 1);
          g.moveTo(x + 1.6, y - 2);
          g.lineTo(x + 0.5, y + 1);
          g.stroke();
        }
      });
      break;
    case "bush":
      grid(4, (x, y) => {
        B();
        g.arc(x, y + 1, 2.1, Math.PI, 0);
        g.stroke();
      });
      break;
    case "reeds":
      grid(3, (x, y) => {
        B();
        g.moveTo(x - 3.5, y + 2);
        g.lineTo(x + 3.5, y + 2);
        g.moveTo(x - 1.5, y + 2);
        g.lineTo(x - 2, y - 2);
        g.moveTo(x, y + 2);
        g.lineTo(x, y - 3);
        g.moveTo(x + 1.5, y + 2);
        g.lineTo(x + 2, y - 2);
        g.stroke();
      });
      break;
    case "peaks":
      grid(3, (x, y) => {
        B();
        g.moveTo(x - 3.2, y + 2.2);
        g.lineTo(x, y - 2.4);
        g.lineTo(x + 3.2, y + 2.2);
        g.stroke();
        B();
        g.moveTo(x + 0.6, y - 1.2);
        g.lineTo(x + 1.8, y + 1.8);
        g.stroke();
      });
      break;
    case "crevasse":
      grid(3, (x, y) => {
        B();
        g.moveTo(x - 2.5, y - 1.5);
        g.lineTo(x - 0.5, y + 0.5);
        g.lineTo(x + 2.5, y + 1);
        g.stroke();
      });
      break;
    case "dashes":
      grid(4, (x, y) => {
        B();
        g.moveTo(x - 1.6, y);
        g.lineTo(x + 1.6, y);
        g.stroke();
      });
      break;
    case "pebbles":
      grid(4, (x, y, r) => {
        B();
        g.ellipse(x, y, 1.4 + r() * 0.6, 0.9, r() * 3, 0, T);
        g.stroke();
      });
      break;
    case "specks":
      grid(5, (x, y, r) => {
        if (r() < 0.5) {
          B();
          g.arc(x, y, 0.9, 0, T);
          g.fill();
        } else {
          B();
          g.moveTo(x - 1.2, y - 1.2);
          g.lineTo(x + 1.2, y + 1.2);
          g.stroke();
        }
      });
      break;
    case "thorns":
      grid(3, (x, y) => {
        B();
        g.moveTo(x - 2.2, y - 2.2);
        g.lineTo(x + 2.2, y + 2.2);
        g.moveTo(x + 2.2, y - 2.2);
        g.lineTo(x - 2.2, y + 2.2);
        g.stroke();
      });
      break;
    case "waves":
      grid(3, (x, y) => {
        B();
        g.moveTo(x - 3.5, y);
        g.quadraticCurveTo(x - 1.75, y - 2, x, y);
        g.quadraticCurveTo(x + 1.75, y + 2, x + 3.5, y);
        g.stroke();
      });
      break;
  }
}

/** A colour mixed towards another: `t` 0 is `a`, 1 is `b`. Both as #rrggbb. */
export function mix(a: string, b: string, t: number): string {
  const p = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const q = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `#${p
    .map((v, i) =>
      Math.round(v + (q[i]! - v) * t)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/** The ink of a pattern over a zone of this colour: a darker shade of it. */
export const inkOf = (colour: string): string =>
  /^#[0-9a-fA-F]{6}$/.test(colour) ? mix(colour.toLowerCase(), "#2a2218", 0.62) : "#4a4034";

const tiles = new Map<string, HTMLCanvasElement | OffscreenCanvas>();

/** A tile of a pattern in a zone's colour, at the screen's pixel ratio; kept once made. */
export function tileOf(
  pattern: Pattern,
  colour: string,
  ratio: number,
): HTMLCanvasElement | OffscreenCanvas | null {
  const key = `${pattern}|${colour}|${ratio}`;
  let tile = tiles.get(key);
  if (!tile) {
    const side = Math.round(TILE * ratio);
    if (typeof document !== "undefined") {
      const c = document.createElement("canvas");
      c.width = c.height = side;
      tile = c;
    } else if (typeof OffscreenCanvas !== "undefined") tile = new OffscreenCanvas(side, side);
    else return null;
    const g = tile.getContext("2d") as CanvasRenderingContext2D | null;
    if (!g) return null;
    g.scale(ratio, ratio);
    g.globalAlpha = 0.85;
    g.strokeStyle = g.fillStyle = inkOf(colour);
    g.lineWidth = GLYPH_LINE;
    g.lineCap = "round";
    g.lineJoin = "round";
    drawGlyphs(g, pattern);
    tiles.set(key, tile);
    if (tiles.size > 120) tiles.delete(tiles.keys().next().value!);
  }
  return tile;
}

/**
 * A pattern to fill a zone with on a canvas whose transform is the pixel ratio: one tile is TILE
 * screen pixels, and the tiles are anchored at `origin` (a point of the screen that moves with
 * the map), so the texture moves with the map as it is panned.
 */
export function patternFor(
  ctx: CanvasRenderingContext2D,
  pattern: Pattern,
  colour: string,
  ratio: number,
  origin: readonly [number, number] = [0, 0],
): CanvasPattern | null {
  const tile = tileOf(pattern, colour, ratio);
  if (!tile) return null;
  const p = ctx.createPattern(tile as CanvasImageSource, "repeat");
  if (!p) return null;
  if (typeof DOMMatrix !== "undefined") {
    p.setTransform(
      new DOMMatrix()
        .translate(((origin[0] % TILE) + TILE) % TILE, ((origin[1] % TILE) + TILE) % TILE)
        .scale(1 / ratio),
    );
  }
  return p;
}
