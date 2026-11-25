import { describe, expect, it } from "vitest";
import type { Px } from "../findAreas/contour.ts";
import { MODES } from "./cost.ts";
import { Engine } from "./engine.ts";
import { nearestOn } from "./lines.ts";
import type { RouteRequest, TerrainFeature } from "./protocol.ts";

/**
 * Routes and the roads already there (stage 20, decisions 7 and 10): a flat land of 160 × 100
 * cells, a kilometre each, with a made road, King's Road, along y = 20 from x = 10 to x = 150.
 */
const road: Px[] = [
  [10, 20],
  [150, 20],
];
const kings: TerrainFeature = { id: "kingsrd1", counts: "road", line: road };

function engine(): Engine {
  const e = new Engine(null, null, { w: 160, h: 100 });
  e.setTerrain({ useHeights: false, follow: false, features: [kings], kmPerPx: 1 });
  return e;
}
const ask = (over: Partial<RouteRequest>): RouteRequest => ({
  stops: [],
  mode: "cart",
  variant: "fast",
  eps: 1,
  steepest: MODES.cart.steepest,
  steps: false,
  tunnelKm: null,
  startOn: null,
  endOn: null,
  ...over,
});

describe("a route along a road already there", () => {
  it("says which stretch runs along the road, with points where it joins and leaves", () => {
    const r = engine().route(
      ask({
        stops: [
          [12, 30],
          [148, 30],
        ],
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.along).toHaveLength(1);
    const run = r.along[0]!;
    expect(run.road).toBe("kingsrd1");
    // Most of the way is along the road; where it joins and leaves are points on it.
    const on = r.points[run.from]!;
    const off = r.points[run.to]!;
    expect(Math.abs(on[1] - 20)).toBeLessThan(1.5);
    expect(Math.abs(off[1] - 20)).toBeLessThan(1.5);
    expect(off[0] - on[0]).toBeGreaterThan(100);
    // The new stretches are the rest: before it joins and after it leaves.
    expect(run.from).toBeGreaterThan(0);
    expect(run.to).toBeLessThan(r.points.length - 1);
  });

  it("does not count crossing a road as going along it", () => {
    const r = engine().route(
      ask({
        stops: [
          [80, 5],
          [80, 60],
        ],
      }),
    );
    expect(r.ok && r.along).toEqual([]);
  });
});

describe("a route that branches from a road", () => {
  it("leaves the road wherever is best, at no cost for the way along it", () => {
    // The start is clicked on the road's west end; the end is far to the east, off the road.
    const r = engine().route(
      ask({
        stops: [
          [12, 20],
          [130, 80],
        ],
        startOn: road,
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [x, y] = r.points[0]!;
    // It leaves the road near where the way to the end is shortest, exactly on the road.
    expect(x).toBeGreaterThan(100);
    expect(nearestOn([x, y], road).d).toBeLessThan(1e-9);
    // And leaves it smoothly: its next point is ahead along the road, not straight out of it.
    const next = r.points[1]!;
    expect(Math.abs(next[0] - x)).toBeGreaterThan(Math.abs(next[1] - y));
    // The time is of the new way only.
    expect(r.hours!).toBeLessThan((60 * 1.3) / MODES.cart.open);
  });

  it("arrives on a road wherever is best", () => {
    const r = engine().route(
      ask({
        stops: [
          [40, 90],
          [148, 20],
        ],
        endOn: road,
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const end = r.points[r.points.length - 1]!;
    expect(end[0]).toBeLessThan(60);
    expect(nearestOn(end, road).d).toBeLessThan(1e-9);
  });
});
