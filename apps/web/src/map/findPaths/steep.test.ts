import { describe, expect, it } from "vitest";
import type { Px } from "../findAreas/contour.ts";
import { MODES } from "./cost.ts";
import { Engine } from "./engine.ts";
import { simplifyWithin, smoothBranch, smoothOpen, smoothWithin } from "./lines.ts";
import type { RouteRequest } from "./protocol.ts";

/**
 * Steep ground (stage 20, decision 11): a ridge running north to south down the middle of a map
 * of heights alone, 100 m a pixel, with a pass at y = 50. White is 1000 m.
 */
const W = 160;
const H = 100;

function ridge(pass: number, high = 0.6): Float32Array {
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const top = high - (high - pass) * Math.exp(-(((y - 50) / 14) ** 2));
    for (let x = 0; x < W; x++) out[y * W + x] = 0.1 + top * Math.exp(-(((x - 80) / 12) ** 2));
  }
  return out;
}

function engineOn(heights: Float32Array): Engine {
  const e = new Engine(null, null, { w: W, h: H });
  e.setHeights(heights, { seaLevel: 0.01, top: 1000 });
  e.setTerrain({ useHeights: true, follow: false, features: [], kmPerPx: 0.1 });
  return e;
}

const across = (mode: RouteRequest["mode"], over: Partial<RouteRequest> = {}): RouteRequest => ({
  stops: [
    [20, 50],
    [140, 50],
  ],
  mode,
  variant: "fast",
  eps: 1,
  steepest: MODES[mode].steepest,
  steps: false,
  tunnelKm: null,
  startOn: null,
  endOn: null,
  ...over,
});

describe("steep ground", () => {
  it("climbs a pass steeper than a cart can take in switchbacks within its grade", () => {
    // The pass rises at about 25%: a cart's 12% is had only by winding across the slope.
    const e = engineOn(ridge(0.35));
    const cart = e.route(across("cart"));
    expect(cart.ok).toBe(true);
    if (!cart.ok) return;
    // Every piece of the line as made is within the limit, after smoothing and thinning.
    for (let i = 1; i < cart.points.length; i++) {
      expect(Math.abs(e.gradeAlong(cart.points[i - 1]!, cart.points[i]!))).toBeLessThan(
        0.12 * 1.16,
      );
    }
    expect(cart.profile.steepest).toBeLessThan(0.12 * 1.16);
    // It winds: far longer than straight over the top.
    const length = cart.profile.d[cart.profile.d.length - 1]!;
    expect(length).toBeGreaterThan(125);
    // On foot the same pass is climbed far more directly.
    const foot = e.route(across("foot"));
    expect(foot.ok && foot.profile.d[foot.profile.d.length - 1]!).toBeLessThan(length);
    expect(foot.ok && foot.profile.steepest).toBeGreaterThan(0.12);
  });

  it("says where a way is too steep, and finds one with a tunnel or, on foot, steps", () => {
    // Now the pass is too steep for a cart even winding (about 45%).
    const e = engineOn(ridge(0.62, 0.8));
    const cart = e.route(across("cart"));
    expect(cart.ok).toBe(false);
    if (cart.ok || cart.why !== "steep") throw new Error("Expected too steep");
    // The gentlest way a cart could take over is still steeper than its 12%.
    expect(cart.grade).toBeGreaterThan(0.12);
    expect(Math.abs(cart.at[0] - 80)).toBeLessThan(30);
    // A tunnel: straight through, its stretch kept as two points of the path.
    const tunnel = e.route(across("cart", { tunnelKm: 5 }));
    expect(tunnel.ok).toBe(true);
    if (!tunnel.ok) return;
    const bore = tunnel.stretches.find((s) => s.kind === "tunnel")!;
    expect(bore).toBeDefined();
    expect(bore.to - bore.from).toBe(1);
    const a = tunnel.points[bore.from]!;
    const b = tunnel.points[bore.to]!;
    const km = (Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.1).toFixed(1);
    expect(Number(km)).toBeLessThanOrEqual(5);
    expect(a[0]).toBeLessThan(80);
    expect(b[0]).toBeGreaterThan(80);
    // Too short a tunnel allowed: still no way.
    expect(e.route(across("cart", { tunnelKm: 0.3 })).ok).toBe(false);
  });

  it("climbs a short scarp on foot by steps, and only on foot", () => {
    // A scarp 150 m high over 300 m, all the way down the map: too steep at 30% even winding.
    const heights = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const t = Math.max(0, Math.min(1, (x - 79) / 3));
        heights[y * W + x] = 0.1 + 0.15 * t * t * (3 - 2 * t);
      }
    }
    const e = engineOn(heights);
    expect(e.route(across("foot", { steepest: 0.3 })).ok).toBe(false);
    const steps = e.route(across("foot", { steepest: 0.3, steps: true }));
    expect(steps.ok).toBe(true);
    if (!steps.ok) return;
    const flight = steps.stretches.find((s) => s.kind === "steps")!;
    expect(flight).toBeDefined();
    const a = steps.points[flight.from]!;
    const b = steps.points[flight.to]!;
    // Short: no more than about 300 m.
    expect(Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.1).toBeLessThan(0.45);
    expect(e.route(across("cart", { steps: true })).ok).toBe(false);
  });

  it("costs a tunnel far more than its length, so a way over the top is taken when there is one", () => {
    const e = engineOn(ridge(0.35));
    const over = e.route(across("cart"));
    const allowed = e.route(across("cart", { tunnelKm: 5 }));
    expect(over.ok && allowed.ok).toBe(true);
    if (!allowed.ok) return;
    expect(allowed.stretches.some((s) => s.kind === "tunnel")).toBe(false);
  });

  it("marks the climbs, pointing uphill, and gives the heights along the way", () => {
    const e = engineOn(ridge(0.35));
    const foot = e.route(across("foot"));
    expect(foot.ok).toBe(true);
    if (!foot.ok) return;
    const climbs = foot.stretches.filter((s) => s.kind === "climb");
    expect(climbs.length).toBeGreaterThanOrEqual(2);
    // Up the west side (rising as the route goes), down the east (falling).
    expect(climbs.some((c) => c.grade! > 0 && foot.points[c.from]![0] < 80)).toBe(true);
    expect(climbs.some((c) => c.grade! < 0 && foot.points[c.to]![0] > 80)).toBe(true);
    const p = foot.profile;
    expect(p.d.length).toBe(p.h.length);
    expect(p.grade.length).toBe(p.d.length - 1);
    expect(p.high).toBeGreaterThan(0.4);
    expect(p.climb).toBeGreaterThan(0.3);
  });

  it("goes sideways across a slope that is too steep to climb straight", () => {
    // A slope of about 20% rising north: by cart a way north must wind, a way east need not.
    const heights = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) heights[y * W + x] = 2.1 - y * 0.02;
    const e = engineOn(heights);
    const east = e.route(
      across("cart", {
        stops: [
          [20, 50],
          [140, 50],
        ],
      }),
    );
    expect(east.ok && east.profile.d[east.profile.d.length - 1]!).toBeLessThan(125);
    const north = e.route(
      across("cart", {
        stops: [
          [80, 90],
          [80, 10],
        ],
      }),
    );
    expect(north.ok).toBe(true);
    if (!north.ok) return;
    expect(north.profile.d[north.profile.d.length - 1]!).toBeGreaterThan(80 * 1.5);
  });
});

describe("smoothing that keeps a limit", () => {
  // A zigzag of switchbacks on a slope rising with y; a straight piece up it is too steep.
  const zigzag: Px[] = [];
  for (let k = 0; k <= 8; k++) zigzag.push([k % 2 ? 20 : 0, k * 4]);
  const ok = (a: Px, b: Px) =>
    Math.abs(b[1] - a[1]) / Math.max(1e-9, Math.hypot(b[0] - a[0], b[1] - a[1])) <= 0.25;

  it("keeps a switchback's corners where cutting them would be too steep", () => {
    // Plain smoothing cuts the corners into a steeper line; the kept one stays within it.
    const plain = smoothOpen(zigzag, 3);
    const steepest = (p: Px[]) =>
      Math.max(
        ...p
          .slice(1)
          .map((q, i) => Math.abs(q[1] - p[i]![1]) / Math.hypot(q[0] - p[i]![0], q[1] - p[i]![1])),
      );
    expect(steepest(plain)).toBeGreaterThan(0.25);
    const kept = smoothWithin(zigzag, 3, ok);
    expect(steepest(kept)).toBeLessThanOrEqual(0.25);
    // Thinned, it keeps every corner: no corner can go without a steep piece.
    const thin = simplifyWithin(kept, 3, ok);
    expect(thin.length).toBe(zigzag.length);
    // Without the limit Douglas–Peucker would have kept only the ends of a narrow zigzag.
    expect(simplifyWithin(zigzag, 25, () => true)).toHaveLength(2);
  });
});

describe("a branch from a road", () => {
  it("leaves the road along its direction before turning away", () => {
    const road: Px[] = [
      [0, 50],
      [100, 50],
    ];
    // A way straight out of the road at a right angle.
    const way: Px[] = [];
    for (let y = 50; y >= 0; y -= 2) way.push([40, y]);
    const smooth = smoothBranch(way, road, 6);
    expect(smooth[0]).toEqual([40, 50]);
    // The second point is along the road, a little off it to the side the way leaves by.
    const [x, y] = smooth[1]!;
    expect(Math.abs(x - 40)).toBeGreaterThan(4);
    expect(y).toBeLessThan(50);
    expect(50 - y).toBeLessThan(Math.abs(x - 40));
    expect(smooth[smooth.length - 1]).toEqual([40, 0]);
  });
});
