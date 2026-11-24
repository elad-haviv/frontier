import { describe, expect, it } from "vitest";
import type { Px } from "../findAreas/contour.ts";
import { Engine } from "./engine.ts";
import { lineLength, nearestOn } from "./lines.ts";
import { Painter, rgb } from "./paint.ts";
import type { TerrainFeature, TerrainRequest } from "./protocol.ts";

const W = 240;
const H = 160;

/** The sea on the left (x < 60), land to the east, a painted river along y = 80. */
function picture(): Painter {
  return new Painter(W, H, rgb("#ded2a2"))
    .where((x) => x < 60, rgb("#aac5c4"))
    .line(
      [
        [60, 0],
        [60, H - 1],
      ],
      2,
      rgb("#3c2f21"),
    )
    .line(
      [
        [230, 80],
        [60, 80],
      ],
      3,
      rgb("#4a7391"),
    );
}

/** Heights that match it: a valley along y = 80, falling west to the sea at x = 60. */
function heights(): Float32Array {
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      out[y * W + x] = x < 60 ? 0 : 0.1 + ((x - 60) / 180) * 0.4 + (Math.abs(y - 80) / 80) * 0.4;
    }
  }
  return out;
}

const terrain = (over: Partial<TerrainRequest> = {}): TerrainRequest => ({
  useHeights: true,
  follow: true,
  features: [],
  kmPerPx: 1,
  ...over,
});
const river = { from: "source" as const, exact: true, meander: 0, eps: 1, snap: true };

function engine(withHeights = true): Engine {
  const { pic, ink } = picture().looked();
  const e = new Engine(pic, ink);
  if (withHeights) e.setHeights(heights(), { seaLevel: null, top: 2000 });
  return e;
}

describe("the engine: rivers", () => {
  it("runs a river downhill to the sea from where it was clicked", () => {
    const e = engine();
    const info = e.setTerrain(terrain());
    expect(info.guessed).toBe(false);
    expect(info.hasSea).toBe(true);
    // The sea level is matched to the painted coast: between black and the lowest land.
    expect(info.seaLevel!).toBeGreaterThan(0);
    expect(info.seaLevel!).toBeLessThan(0.13);
    const r = e.river({ ...river, at: [200, 30] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.end).toBe("sea");
    expect(r.points[0]).toEqual([200, 30]);
    const last = r.points[r.points.length - 1]!;
    expect(last[0]).toBeLessThan(70);
    // It finds the valley and follows it.
    expect(Math.abs(last[1] - 80)).toBeLessThan(6);
    expect(r.fall!).toBeGreaterThan(500);
    // Thinned: far fewer points than cells passed.
    expect(r.points.length).toBeLessThan(20);
  });

  it("follows a river up from its mouth, by the branch with the most water", () => {
    const e = engine();
    e.setTerrain(terrain());
    const r = e.river({ ...river, from: "mouth", at: [63, 81] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const xs = r.points.map((p) => p[0]);
    // Up the valley as far as a stream gathers, and down to the sea.
    expect(Math.max(...xs)).toBeGreaterThan(120);
    expect(Math.min(...xs)).toBeLessThan(70);
    for (const p of r.points) expect(Math.abs(p[1] - 80)).toBeLessThan(4);
    // Written from the source down.
    expect(r.points[0]![0]).toBeGreaterThan(r.points[r.points.length - 1]![0]);
  });

  it("says why there is no river: a click in the sea, or too near it", () => {
    const e = engine();
    e.setTerrain(terrain());
    expect(e.river({ ...river, at: [20, 80] })).toEqual({ ok: false, why: "sea" });
    expect(e.river({ ...river, at: [62, 20] })).toEqual({ ok: false, why: "short" });
  });

  it("ends a tributary exactly on a river already made, and winds it only between its ends", () => {
    const e = engine();
    const made: TerrainFeature = {
      id: "main0001",
      counts: "river",
      line: [
        [228, 80],
        [150, 81],
        [61, 80],
      ],
    };
    e.setTerrain(terrain({ features: [made] }));
    const r = e.river({ ...river, at: [180, 20], meander: 5 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.end).toBe("river");
    expect(r.joined).toBe("main0001");
    expect(r.points[0]).toEqual([180, 20]);
    expect(nearestOn(r.points[r.points.length - 1]!, made.line).d).toBeLessThan(1e-9);
    // Without snapping it runs on to the sea beside the made river.
    const free = e.river({ ...river, at: [180, 20], snap: false });
    expect(free.ok && free.end).toBe("sea");
    // Likely rivers leave out the one that is made.
    const { rivers } = e.likely(60);
    for (const line of rivers) {
      const mid = line[Math.floor(line.length / 2)]!;
      expect(nearestOn(mid, made.line).d).toBeGreaterThan(1.5);
    }
  });

  it("guesses from the picture without heights, and says so", () => {
    const e = engine(false);
    const info = e.setTerrain(terrain());
    expect(info.guessed).toBe(true);
    expect(info.seaLevel).toBeNull();
    const far = e.river({ ...river, at: [200, 30] });
    expect(far.ok && far.end).toBe("sea");
    const r = e.river({ ...river, at: [200, 75] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fall).toBeNull();
    // Water is drawn to the painted river, which it then follows to the sea.
    expect(r.end).toBe("sea");
    const last = r.points[r.points.length - 1]!;
    expect(Math.abs(last[1] - 80)).toBeLessThan(5);
    // With the heights there but switched off, it is a guess as well.
    const both = engine();
    expect(both.setTerrain(terrain({ useHeights: false })).guessed).toBe(true);
  });

  it("offers likely rivers, more of them the smaller the land each must drain", () => {
    const e = engine();
    e.setTerrain(terrain());
    const few = e.likely(2000).rivers;
    const many = e.likely(20).rivers;
    expect(few.length).toBeGreaterThanOrEqual(1);
    expect(many.length).toBeGreaterThan(few.length);
  });
});

describe("the engine: routes", () => {
  const stops: Px[] = [
    [100, 40],
    [100, 120],
  ];
  const ask = { stops, eps: 1, variant: "fast" as const };

  it("fords the painted river on foot, and counts the ford", () => {
    const e = engine();
    e.setTerrain(terrain());
    const foot = e.route({ ...ask, mode: "foot" });
    expect(foot.ok).toBe(true);
    if (!foot.ok) return;
    expect(foot.points[0]).toEqual(stops[0]);
    expect(foot.points[foot.points.length - 1]).toEqual(stops[1]);
    expect(foot.fords).toBe(1);
    expect(foot.marks.map((m) => m.kind)).toEqual(["ford"]);
    expect(foot.hours!).toBeGreaterThan(80 / 4);
    // With "Follow drawn lines" off the painted river is not in the way.
    e.setTerrain(terrain({ follow: false }));
    const ignoring = e.route({ ...ask, mode: "foot" });
    expect(ignoring.ok && ignoring.fords).toBe(0);
    expect(ignoring.ok && ignoring.hours! < foot.hours!).toBe(true);
  });

  it("takes a made road, and its bridge, when that is quicker", () => {
    const e = engine();
    // A road that crosses the river far to the east.
    const road: TerrainFeature = {
      id: "road0001",
      counts: "road",
      line: [
        [100, 40],
        [200, 40],
        [200, 120],
        [100, 120],
      ],
    };
    e.setTerrain(terrain({ features: [road] }));
    const cart = e.route({ ...ask, mode: "cart" });
    expect(cart.ok).toBe(true);
    if (!cart.ok) return;
    expect(cart.bridges).toBe(1);
    expect(cart.fords).toBe(0);
    expect(Math.max(...cart.points.map((p) => p[0]))).toBeGreaterThan(190);
    expect(lineLength(cart.points)).toBeGreaterThan(250);
    // On foot the ford is still quicker than going round.
    const foot = e.route({ ...ask, mode: "foot" });
    expect(foot.ok && foot.fords).toBe(1);
    expect(foot.ok && Math.max(...foot.points.map((p) => p[0]))).toBeLessThan(130);
    // Avoid water takes the bridge on foot too, and is not "the same" as the fastest.
    const dry = e.route({ ...ask, mode: "foot", variant: "dry" });
    expect(dry.ok && dry.bridges).toBe(1);
    expect(dry.ok && dry.same).toBe(false);
  });

  it("has no way by land across a zone of water, and offers nothing but a ship", () => {
    const e = new Engine(null, null, { w: 120, h: 80 });
    const strait: TerrainFeature = {
      id: "wat00001",
      counts: "water",
      line: [
        [50, -5],
        [70, -5],
        [70, 85],
        [50, 85],
      ],
    };
    const info = e.setTerrain(terrain({ useHeights: false, features: [strait] }));
    expect(info.hasSea).toBe(true);
    const across: Px[] = [
      [10, 40],
      [110, 40],
    ];
    expect(e.route({ stops: across, eps: 1, mode: "foot", variant: "fast" })).toEqual({ ok: false });
    const ship = e.route({ stops: across, eps: 1, mode: "ship", variant: "fast" });
    expect(ship.ok).toBe(true);
    if (!ship.ok) return;
    expect(ship.marks.map((m) => m.kind)).toEqual(["sail", "land"]);
    expect(ship.seaShare).toBeGreaterThan(0.1);
  });

  it("gives no hours when the map has no scale, and goes through a stop exactly", () => {
    const e = new Engine(null, null, { w: 120, h: 80 });
    e.setTerrain(terrain({ useHeights: false, kmPerPx: null }));
    const r = e.route({
      stops: [
        [10, 10],
        [60, 70],
        [110, 10],
      ],
      eps: 1,
      mode: "horse",
      variant: "fast",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.hours).toBeNull();
    expect(r.points).toContainEqual([60, 70]);
  });

  it("slows a traveller in a forest, a marsh or mountains the owner has drawn as zones", () => {
    const square = (counts: TerrainFeature["counts"]): TerrainFeature => ({
      id: `zone${counts}`,
      counts,
      line: [
        [40, 20],
        [80, 20],
        [80, 60],
        [40, 60],
      ],
    });
    const hours = (features: TerrainFeature[]) => {
      const e = new Engine(null, null, { w: 120, h: 80 });
      e.setTerrain(terrain({ useHeights: false, features }));
      const r = e.route({
        stops: [
          [10, 40],
          [110, 40],
        ],
        eps: 1,
        mode: "foot",
        variant: "fast",
      });
      return r.ok ? r.hours! : 0;
    };
    const open = hours([]);
    expect(open).toBeCloseTo(100 / 4, 0);
    for (const counts of ["forest", "marsh", "mountains"] as const) {
      expect(hours([square(counts)])).toBeGreaterThan(open * 1.03);
    }
  });
});

describe("the engine: trace", () => {
  it("traces the painted river from its source to the water, and a branch ends on the curve", () => {
    const p = picture().line(
      [
        [150, 80],
        [190, 130],
      ],
      3,
      rgb("#4a7391"),
    );
    const { pic, ink } = p.looked();
    const e = new Engine(pic, ink);
    const t = e.trace({ at: [120, 80], end: null, eps: 1, curved: false, branches: true });
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.kind).toBe("river");
    // The end by the sea comes last.
    expect(t.points[0]![0]).toBeGreaterThan(200);
    expect(t.points[t.points.length - 1]![0]).toBeLessThan(70);
    expect(t.branches).toHaveLength(1);
    const end = t.branches[0]![t.branches[0]!.length - 1]!;
    expect(nearestOn(end, t.points).d).toBeLessThan(1e-9);
    // A coast is a line of no kind.
    const coast = e.trace({ at: [60, 30], end: null, eps: 1, curved: false, branches: false });
    expect(coast.ok && coast.kind).toBe("line");
    // Bare land is no line.
    expect(e.trace({ at: [120, 30], end: null, eps: 1, curved: false, branches: false })).toEqual({
      ok: false,
      why: "none",
    });
  });
});
