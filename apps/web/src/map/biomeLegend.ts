/**
 * A biome drawn small: a swatch of its zones' colour with its pattern over it, for the legend,
 * the biome picker and the saved picture; and the legend card as the saved picture draws it.
 */
import type { Pattern } from "@frontier/schema";
import { patternFor } from "./patterns.ts";

const PAPER = "#fbf7f0";
const INK = "#2a2420";

/** Draws a swatch filling `w` × `h` at (x, y): paper, the colour, the pattern; dashed for a ghost. */
export function drawSwatch(
  ctx: CanvasRenderingContext2D,
  look: { colour: string; pattern: Pattern | null; ghost?: boolean },
  x: number,
  y: number,
  w: number,
  h: number,
  ratio: number,
): void {
  ctx.save();
  ctx.fillStyle = PAPER;
  ctx.fillRect(x, y, w, h);
  const colour = /^#[0-9a-fA-F]{6}$/.test(look.colour) ? look.colour : "#7d746b";
  ctx.fillStyle = `${colour}${look.ghost ? "55" : "88"}`;
  ctx.fillRect(x, y, w, h);
  if (look.pattern) {
    const p = patternFor(ctx, look.pattern, colour, ratio, [x - 4, y - 4]);
    if (p) {
      ctx.fillStyle = p;
      ctx.fillRect(x, y, w, h);
    }
  }
  ctx.strokeStyle = colour;
  ctx.lineWidth = 1;
  if (look.ghost) ctx.setLineDash([3, 2]);
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.restore();
}

/** One row of the legend card. */
export interface LegendRow {
  name: string;
  colour: string;
  pattern: Pattern | null;
  ghost?: boolean;
}

/**
 * The legend card at the bottom left of a picture of `width` × `height` screen pixels, drawn on
 * a canvas whose transform is the pixel ratio: a paper card, a heading and a row per biome.
 */
export function drawLegendCard(
  ctx: CanvasRenderingContext2D,
  rows: readonly LegendRow[],
  height: number,
  ratio: number,
): void {
  if (rows.length === 0) return;
  ctx.save();
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.font = "600 12px system-ui, sans-serif";
  const textW = Math.max(...rows.map((r) => ctx.measureText(r.name).width), 50);
  const row = 20;
  const w = 12 + 26 + 8 + textW + 12;
  const h = 28 + rows.length * row + 6;
  const x = 12;
  const y = height - h - 12;
  ctx.fillStyle = "rgba(251, 247, 240, 0.94)";
  ctx.strokeStyle = "rgba(42, 36, 32, 0.35)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 6);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.textBaseline = "middle";
  ctx.fillText("Biomes", x + 12, y + 15);
  ctx.font = "12px system-ui, sans-serif";
  rows.forEach((r, i) => {
    const top = y + 28 + i * row;
    drawSwatch(ctx, r, x + 12, top + 2, 26, 15, ratio);
    ctx.fillStyle = INK;
    ctx.fillText(r.name, x + 12 + 26 + 8, top + 10);
  });
  ctx.restore();
}
