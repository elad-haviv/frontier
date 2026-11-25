import { describe, expect, it } from "vitest";
import { inRing, type Px } from "../findAreas/contour.ts";
import { Engine } from "./engine.ts";
import { Painter, rgb } from "./paint.ts";
import type { BasinEnd, RiverRequest } from "./protocol.ts";

/**
 * Rivers that end inland (stage 20, decision 12): a land of heights alone that falls west to
 * the sea (x < 10), with a bowl round (100, 50) that a river from the east runs into.
 */
const W = 200;
const H = 100;

function land(bowl: number, pits = false): Float32Array {
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const r = Math.hypot(x - 100, y - 50);
      let h = x < 10 ? 0 : 0.1 + x * 0.004 + Math.abs(y - 50) * 0.002;
      h -= bowl * Math.max(0, 1 - (r / 25) ** 2);
      out[y * W + x] = h;
    }
  }
  if (pits) {
    // A few pits of a noisy height map along the way, each two cells across.
    for (const px of [60, 130, 170]) {
      for (const [dx, dy] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ]) {
        out[(50 + dy!) * W + px + dx!] = out[(50 + dy!) * W + px + dx!]! - 0.03;
      }
    }
  }
  return out;
}

function engineOn(heights: Float32Array): Engine {
  const e = new Engine(null, null, { w: W, h: H });
  e.setHeights(heights, { seaLevel: 0.01, top: 1000 });
  e.setTerrain({ useHeights: true, follow: false, features: [], kmPerPx: 0.5 });
  return e;
}
const from = (basin: BasinEnd | "auto"): RiverRequest => ({
  at: [190, 50],
  from: "source",
  exact: true,
  meander: 0,
  eps: 1,
  snap: true,
  basin,
});

describe("a river that reaches a basin", () => {
  it("finds the basin, filled to where it spills, and by the rule keeps the water", () => {
    const e = engineOn(land(0.2));
    const r = e.river(from("auto"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.basin).not.toBeNull();
    const b = r.basin!;
    // The land draining into it is not twenty times its size: the lake keeps its water.
    expect(b.auto).toBe("keeps");
    expect(b.end).toBe("keeps");
    expect(r.end).toBe("basin");
    // The outline is round the bowl, and reaches the bowl's spill level: a little outside the
    // place where the bowl was carved deepest, and not as far as its rim on the high side.
    expect(inRing([100, 50], b.ring)).toBe(true);
    const xs = b.ring.map((p) => p[0]);
    expect(Math.min(...xs)).toBeGreaterThan(70);
    expect(Math.max(...xs)).toBeLessThan(130);
    expect(b.km2!).toBeGreaterThan(20 * 0.25 * 0.25 * 100);
    // The river ends at the shore, by the lake's outline.
    const last = r.points[r.points.length - 1]!;
    expect(last[0]).toBeGreaterThan(Math.max(...xs) - 8);
    expect(last[0]).toBeLessThan(Math.max(...xs) + 3);
  });

  it("ends as asked: drains to the sea, sinks at the lowest place, dries out, or makes a marsh", () => {
    const e = engineOn(land(0.2));
    const ending = (end: BasinEnd) => {
      const r = e.river(from(end));
      if (!r.ok) throw new Error("No river");
      return r;
    };
    const drains = ending("drains");
    expect(drains.end).toBe("sea");
    expect(Math.min(...drains.points.map((p) => p[0]))).toBeLessThan(12);
    const sinks = ending("sinks");
    const end = sinks.points[sinks.points.length - 1]!;
    // The bowl is deepest a little west of its middle, where the land's fall to the west takes it.
    expect(Math.hypot(end[0] - 94, end[1] - 50)).toBeLessThan(3);
    const dries = ending("dries");
    const dry = dries.points[dries.points.length - 1]!;
    expect(dry[0]).toBeGreaterThan(end[0] + 4);
    expect(dry[0]).toBeLessThan(ending("keeps").points.at(-1)![0]);
    const marsh = ending("marsh");
    expect(marsh.basin!.channels).toHaveLength(3);
    for (const c of marsh.basin!.channels) {
      expect(inRing(c[c.length - 1]!, marsh.basin!.ring)).toBe(true);
    }
    // Only a marsh has channels.
    expect(ending("keeps").basin!.channels).toHaveLength(0);
  });

  it("drains when the land draining into it is large beside it", () => {
    // A small bowl high up a long slope: everything east of it drains in.
    const heights = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const r = Math.hypot(x - 40, y - 50);
        heights[y * W + x] =
          x < 10
            ? 0
            : 0.1 + x * 0.004 + Math.abs(y - 50) * 0.002 - 0.06 * Math.max(0, 1 - (r / 9) ** 2);
      }
    }
    const r = engineOn(heights).river(from("auto"));
    expect(r.ok && r.basin?.auto).toBe("drains");
    expect(r.ok && r.end).toBe("sea");
  });

  it("fills the small pits of a noisy height map without a word", () => {
    const r = engineOn(land(0, true)).river(from("auto"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.basin).toBeNull();
    expect(r.end).toBe("sea");
  });
});

describe("a painted river that ends inland", () => {
  it("is carried on past its end by the terrain", () => {
    // A painted river from x = 220 to x = 140, which stops short of the sea at x < 60.
    const painter = new Painter(240, 160, rgb("#ded2a2"))
      .where((x) => x < 60, rgb("#aac5c4"))
      .line(
        [
          [60, 0],
          [60, 159],
        ],
        2,
        rgb("#3c2f21"),
      )
      .line(
        [
          [220, 80],
          [140, 80],
        ],
        3,
        rgb("#4a7391"),
      );
    const { pic, ink } = painter.looked();
    const e = new Engine(pic, ink);
    const heights = new Float32Array(240 * 160);
    for (let y = 0; y < 160; y++) {
      for (let x = 0; x < 240; x++) {
        heights[y * 240 + x] =
          x < 60 ? 0 : 0.1 + ((x - 60) / 180) * 0.4 + (Math.abs(y - 80) / 80) * 0.4;
      }
    }
    e.setHeights(heights, { seaLevel: null, top: 2000 });
    e.setTerrain({ useHeights: true, follow: true, features: [], kmPerPx: 1 });
    const r = e.river({ ...from("auto"), at: [230, 80] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.basin).toBeNull();
    expect(r.end).toBe("sea");
    expect(Math.min(...r.points.map((p: Px) => p[0]))).toBeLessThan(64);
  });
});
