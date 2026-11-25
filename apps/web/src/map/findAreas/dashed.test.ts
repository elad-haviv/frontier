import { describe, expect, it } from "vitest";
import { Painter, rgb } from "../findPaths/paint.ts";
import { DEFAULT_OPTIONS, findAreas } from "./segment.ts";

/**
 * A border drawn as a thin dashed line must stop an area whichever way it runs. Closing the ink's
 * gaps with a square (grow, then shrink) closes them on a line along the grid, but on a thin
 * diagonal the shrinking square never fits, and the gaps would open again.
 */
describe("a dashed border", () => {
  const LAND = rgb("#ded2a2");
  const INK = rgb("#3c2f21");
  const count = (p: Painter) => {
    const { pic, ink } = p.looked();
    const areas = findAreas(pic, ink, DEFAULT_OPTIONS);
    const at = (x: number, y: number) => areas.labels[y * areas.w + x]!;
    return { areas, at };
  };

  it("along the grid splits the land in two", () => {
    const { at } = count(
      new Painter(240, 200, LAND).line(
        [
          [0, 100],
          [239, 100],
        ],
        2,
        INK,
        [8, 5],
      ),
    );
    expect(at(120, 40)).toBeGreaterThanOrEqual(0);
    expect(at(120, 160)).toBeGreaterThanOrEqual(0);
    expect(at(120, 40)).not.toBe(at(120, 160));
  });

  it.each([
    ["at 45 degrees", [0, 0], [199, 199]],
    ["at a shallow slant", [0, 30], [239, 150]],
    ["at a steep slant", [80, 0], [150, 199]],
  ] as const)("%s splits it too", (_name, from, to) => {
    const { at } = count(new Painter(240, 200, LAND).line([[...from], [...to]], 2, INK, [8, 5]));
    // A point well to each side of the line.
    const mx = (from[0] + to[0]) / 2;
    const my = (from[1] + to[1]) / 2;
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const l = Math.hypot(dx, dy);
    const a: [number, number] = [Math.round(mx - (dy / l) * 40), Math.round(my + (dx / l) * 40)];
    const b: [number, number] = [Math.round(mx + (dy / l) * 40), Math.round(my - (dx / l) * 40)];
    expect(at(...a)).toBeGreaterThanOrEqual(0);
    expect(at(...b)).toBeGreaterThanOrEqual(0);
    expect(at(...a)).not.toBe(at(...b));
  });
});
