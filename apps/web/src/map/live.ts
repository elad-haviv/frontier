/**
 * Draws the map's live canvas, `.map-live`, above the features: the halo of what the pointer is
 * over. It is redrawn on its own as the pointer moves, so hovering never redraws every feature.
 */
import type { Point } from "@frontier/geo";
import {
  CASING,
  type DrawnShape,
  markerRing,
  PATH_WIDTH,
  selectColour,
  ZONE_EDGE,
} from "./overlay.ts";

export interface LiveInput {
  width: number;
  height: number;
  /** The hovered feature's shapes as the overlay drew them (one per repeat), or none. */
  shapes: DrawnShape[];
  /** A hovered corner of the selected feature, on the screen. */
  corner?: Point | null;
}

function trace(ctx: CanvasRenderingContext2D, points: Point[]): void {
  ctx.beginPath();
  points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
}

/**
 * The hover halo: the selection's look at half strength. A path's halo is cut away where its line
 * and casing are, so it lies beside the line rather than over it.
 */
export function drawLive(ctx: CanvasRenderingContext2D, input: LiveInput): void {
  const ratio = window.devicePixelRatio || 1;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, input.width, input.height);
  if (input.shapes.length === 0 && !input.corner) return;
  const colour = selectColour();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.globalAlpha = 0.5;
  for (const s of input.shapes) {
    if (s.kind === "marker") {
      markerRing(ctx, s.at, s.radius ?? 7, colour);
    } else if (s.kind === "path") {
      trace(ctx, s.points);
      ctx.strokeStyle = colour;
      ctx.lineWidth = PATH_WIDTH + 6;
      ctx.stroke();
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "destination-out";
      ctx.lineWidth = CASING;
      ctx.stroke();
      ctx.restore();
    } else {
      trace(ctx, s.points);
      ctx.strokeStyle = colour;
      ctx.lineWidth = ZONE_EDGE + 2;
      ctx.stroke();
    }
  }
  if (input.corner) {
    ctx.beginPath();
    ctx.arc(input.corner[0], input.corner[1], 10, 0, Math.PI * 2);
    ctx.strokeStyle = colour;
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
