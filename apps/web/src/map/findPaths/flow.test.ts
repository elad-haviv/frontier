import { describe, expect, it } from "vitest";
import { flatGrid } from "./grid.ts";
import { courseFrom, flow, likelyRivers, upstream } from "./hydro.ts";

const field = (w: number, h: number, at: (x: number, y: number) => number) => {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = at(x, y);
  return out;
};

describe("where water runs", () => {
  it("drains a cone outwards on every side, off the map's edge", () => {
    const g = flatGrid(41, 41);
    const heights = field(41, 41, (x, y) => 30 - Math.hypot(x - 20, y - 20));
    const sea = new Uint8Array(41 * 41);
    const f = flow(g, heights, sea);
    for (const [x, y] of [
      [24, 20],
      [16, 20],
      [20, 25],
      [23, 17],
    ] as const) {
      const course = courseFrom(f, sea, y * 41 + x);
      expect(course.end).toBe("edge");
      let last = -1;
      for (const c of course.cells) {
        const d = Math.hypot((c % 41) - 20, ((c / 41) | 0) - 20);
        expect(d).toBeGreaterThan(last);
        last = d;
      }
    }
    expect(f.raisedShare).toBe(0);
  });

  it("fills a bowl and spills over its lowest rim", () => {
    const w = 21;
    const g = flatGrid(w, w);
    // An island in the sea with a hollow in the middle; the rim is lowest at (15, 10).
    const sea = new Uint8Array(w * w);
    const heights = field(w, w, (x, y) => {
      const d = Math.max(Math.abs(x - 10), Math.abs(y - 10));
      if (d >= 8) return -1;
      if (d === 5) return x === 15 && y === 10 ? 0.6 : 1;
      if (d < 5) return 0.2 + d * 0.01;
      return 0.5 - (d - 5) * 0.1;
    });
    for (let i = 0; i < w * w; i++) sea[i] = heights[i]! < 0 ? 1 : 0;
    const f = flow(g, heights, sea);
    const course = courseFrom(f, sea, 10 * w + 10);
    expect(course.end).toBe("sea");
    expect(course.cells).toContain(10 * w + 15);
    // The hollow was raised to its rim: the water in it has a way out.
    expect(f.filled[10 * w + 10]!).toBeGreaterThanOrEqual(0.6);
    expect(f.raised[10 * w + 10]).toBe(1);
    expect(f.raisedShare).toBeGreaterThan(0.2);
  });

  it("gathers a whole valley at its mouth, and never runs in a circle", () => {
    const w = 31;
    const h = 24;
    const g = flatGrid(w, h);
    // A valley that falls to the sea along the bottom row.
    const heights = field(w, h, (x, y) =>
      y === h - 1 ? -1 : Math.abs(x - 15) * 0.1 + (h - y) * 0.02,
    );
    const sea = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) sea[i] = heights[i]! < 0 ? 1 : 0;
    const f = flow(g, heights, sea);
    const land = w * (h - 1);
    let atMouths = 0;
    let stuck = 0;
    for (let i = 0; i < w * h; i++) {
      if (sea[i]) continue;
      if (f.dir[i]! < 0) stuck++;
      else if (sea[f.dir[i]!]) atMouths += f.acc[i]!;
      // Every cell reaches the sea in fewer steps than there are cells.
      let c = i;
      let steps = 0;
      while (c >= 0 && !sea[c] && steps <= w * h) {
        c = f.dir[c]!;
        steps++;
      }
      expect(steps).toBeLessThanOrEqual(w * h);
    }
    expect(stuck).toBe(0);
    expect(atMouths).toBe(land);
    // The valley's own mouth takes most of it.
    const mouth = (h - 2) * w + 15;
    expect(f.acc[mouth]!).toBeGreaterThan(land * 0.5);
    // Upstream from the mouth follows the valley floor.
    const up = upstream(g, f, mouth, 10);
    expect(up.length).toBeGreaterThan(15);
    for (const c of up.slice(0, 15)) expect(Math.abs((c % w) - 15)).toBeLessThanOrEqual(1);
  });

  it("offers the big streams as likely rivers, and ends a tributary on a river already made", () => {
    const w = 41;
    const h = 30;
    const g = flatGrid(w, h);
    const heights = field(w, h, (x, y) =>
      y === h - 1 ? -1 : Math.abs(x - 20) * 0.1 + (h - y) * 0.02,
    );
    const sea = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) sea[i] = heights[i]! < 0 ? 1 : 0;
    const f = flow(g, heights, sea);
    const likely = likelyRivers(f, sea, 40);
    expect(likely.length).toBeGreaterThanOrEqual(1);
    // The longest comes first and reaches the sea.
    expect(sea[likely[0]![likely[0]!.length - 1]!]).toBe(1);

    // A river made along the valley floor: a stream from the side stops on it.
    const rivers = new Int32Array(w * h);
    for (let y = 2; y < h - 1; y++) rivers[y * w + 20] = 1;
    const course = courseFrom(f, sea, 8 * w + 6, rivers);
    expect(course.end).toBe("river");
    expect(course.joined).toBe(1);
    expect(course.cells[course.cells.length - 1]! % w).toBe(20);
    // With it made, it is no longer offered.
    for (const cells of likelyRivers(f, sea, 40, rivers)) {
      expect(cells.slice(0, -1).every((c) => rivers[c] === 0)).toBe(true);
    }
  });
});
