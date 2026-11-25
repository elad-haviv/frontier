import { PATTERNS } from "@frontier/schema";
import { describe, expect, it } from "vitest";
import { drawGlyphs, GLYPH_LINE, inkOf, mix, type Pen, TILE } from "./patterns.ts";

/** A pen that keeps the box of all that is drawn, curves by their control points. */
function measuringPen() {
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, marks: 0 };
  const take = (x: number, y: number, r = 0) => {
    box.x0 = Math.min(box.x0, x - r);
    box.y0 = Math.min(box.y0, y - r);
    box.x1 = Math.max(box.x1, x + r);
    box.y1 = Math.max(box.y1, y + r);
  };
  const pen: Pen = {
    beginPath: () => {},
    moveTo: (x, y) => take(x, y),
    lineTo: (x, y) => take(x, y),
    arc: (x, y, r) => take(x, y, r),
    ellipse: (x, y, rx, ry) => take(x, y, Math.max(rx, ry)),
    quadraticCurveTo: (cx, cy, x, y) => {
      take(cx, cy);
      take(x, y);
    },
    closePath: () => {},
    stroke: () => void box.marks++,
    fill: () => void box.marks++,
  };
  return { pen, box };
}

describe("biome patterns", () => {
  it("has sixteen, each drawing something", () => {
    expect(PATTERNS).toHaveLength(16);
    for (const p of PATTERNS) {
      const { pen, box } = measuringPen();
      drawGlyphs(pen, p);
      expect(box.marks, p).toBeGreaterThan(3);
    }
  });

  it("keeps every glyph clear of the tile's edges, so tiles meet without a seam", () => {
    const half = GLYPH_LINE / 2;
    for (const p of PATTERNS) {
      const { pen, box } = measuringPen();
      drawGlyphs(pen, p);
      expect(box.x0 - half, p).toBeGreaterThan(0.5);
      expect(box.y0 - half, p).toBeGreaterThan(0.5);
      expect(box.x1 + half, p).toBeLessThan(TILE - 0.5);
      expect(box.y1 + half, p).toBeLessThan(TILE - 0.5);
    }
  });

  it("draws the same tile every time", () => {
    const a = measuringPen();
    const b = measuringPen();
    drawGlyphs(a.pen, "savanna");
    drawGlyphs(b.pen, "savanna");
    expect(a.box).toEqual(b.box);
  });

  it("inks a pattern in a darker shade of the zone's colour", () => {
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
    const ink = inkOf("#e6c47a");
    expect(ink).toMatch(/^#[0-9a-f]{6}$/);
    expect(parseInt(ink.slice(1, 3), 16)).toBeLessThan(0xe6);
    expect(inkOf("not a colour")).toBe("#4a4034");
  });
});
