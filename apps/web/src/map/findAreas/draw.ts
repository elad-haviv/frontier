/**
 * Draws found outlines over the map in any view: the area under the pointer, and the outline the
 * chosen areas would make. On a globe an edge is a great circle, as a zone's is, so what is shown
 * is what Make zone makes.
 */
import {
  hasInside,
  outline,
  type Point,
  type Position,
  type Space,
  type View,
  zoneOnPlate,
  zonePolygon,
} from "@frontier/geo";
import { geoOrthographic, geoPath } from "d3-geo";
import { screenLines } from "../overlay.ts";

export interface Look {
  /** The fill's colour and strength. */
  fill: string;
  fillAlpha: number;
  stroke: string;
  width: number;
  dash?: number[];
  /** A paper line under the stroke, so it reads over any picture. */
  casing?: boolean;
  /** Each corner as a dot. */
  dots?: boolean;
  /** Hatched in place of a plain fill: an area about to be removed. */
  hatch?: boolean;
}

const PAPER = "#fbf7f0";

function trace(ctx: CanvasRenderingContext2D, points: Point[]): void {
  points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
}

let hatching: CanvasPattern | null = null;
function hatchOf(ctx: CanvasRenderingContext2D, colour: string): CanvasPattern | string {
  if (typeof document === "undefined") return colour;
  if (!hatching) {
    const tile = document.createElement("canvas");
    tile.width = tile.height = 8;
    const t = tile.getContext("2d")!;
    t.strokeStyle = colour;
    t.lineWidth = 2;
    t.beginPath();
    t.moveTo(0, 8);
    t.lineTo(8, 0);
    t.stroke();
    hatching = ctx.createPattern(tile, "repeat");
  }
  return hatching ?? colour;
}

/**
 * Fills and strokes outer rings (and on a flat map cuts the holes out of the fill) in a look.
 * `space` is the map's; positions are as zones keep them.
 */
export function drawRings(
  ctx: CanvasRenderingContext2D,
  view: View,
  space: Space,
  outers: readonly Position[][],
  holes: readonly Position[][],
  look: Look,
): void {
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const fillStyle = look.hatch ? hatchOf(ctx, look.fill) : look.fill;
  const strokeAll = (lines: Point[][]) => {
    for (const line of lines) {
      ctx.beginPath();
      line.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      if (look.casing) {
        ctx.setLineDash([]);
        ctx.strokeStyle = PAPER;
        ctx.lineWidth = look.width + 2.5;
        ctx.stroke();
      }
      ctx.setLineDash(look.dash ?? []);
      ctx.strokeStyle = look.stroke;
      ctx.lineWidth = look.width;
      ctx.stroke();
    }
    ctx.setLineDash([]);
  };

  if (view.state.kind === "flat") {
    ctx.beginPath();
    for (const ring of [...outers, ...holes]) {
      trace(
        ctx,
        ring.map((p) => view.project(p)!),
      );
    }
    ctx.globalAlpha = look.fillAlpha;
    ctx.fillStyle = fillStyle;
    ctx.fill("evenodd");
    ctx.globalAlpha = 1;
    strokeAll([...outers, ...holes].map((r) => [...r, r[0]!].map((p) => view.project(p)!)));
  } else {
    // On a globe each ring is stepped along great circles first.
    const stepped = (ring: readonly Position[]) =>
      outline(space, [...ring], { curve: false, closed: true }).line;
    ctx.globalAlpha = look.fillAlpha;
    ctx.fillStyle = fillStyle;
    for (const ring of outers) {
      const line = stepped(ring);
      if (!hasInside(line)) continue;
      ctx.beginPath();
      if (view.state.kind === "globe") {
        const projection = geoOrthographic()
          .rotate([-view.state.lon, -view.state.lat])
          .scale(view.state.k)
          .translate([view.width / 2, view.height / 2])
          .clipAngle(90);
        geoPath(projection, ctx)(zonePolygon(line));
      } else if (view.state.kind === "plate") {
        const pieces = zoneOnPlate(line, view.state.lon).map((piece) =>
          piece.map((p) => view.projectClamped(p).point),
        );
        for (const shift of view.repeats()) {
          for (const piece of pieces)
            trace(
              ctx,
              piece.map(([x, y]): Point => [x + shift, y]),
            );
        }
      } else if (view.rings) {
        for (const piece of view.rings(line)) trace(ctx, piece);
      }
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (const ring of [...outers, ...holes]) strokeAll(screenLines(view, stepped(ring)));
  }

  if (look.dots) {
    for (const ring of outers) {
      for (const p of ring) {
        const s = view.project(p);
        if (!s) continue;
        for (const shift of view.repeats()) {
          ctx.beginPath();
          ctx.arc(s[0] + shift, s[1], 2.6, 0, Math.PI * 2);
          ctx.fillStyle = PAPER;
          ctx.fill();
          ctx.lineWidth = 1.2;
          ctx.strokeStyle = look.stroke;
          ctx.stroke();
        }
      }
    }
  }
  ctx.restore();
}
