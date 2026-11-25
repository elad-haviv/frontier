import { describe, expect, it } from "vitest";
import { type Ground, MODES, slopeFactor, surfaceFor } from "./cost.ts";
import { flatGrid, thicken } from "./grid.ts";
import {
  hoursAlong,
  marksAlong,
  nearestPassable,
  routeThrough,
  sameWay,
  search,
  type Terrain,
} from "./route.ts";
import { travelTime, unitKm } from "./travel.ts";

const W = 40;
const H = 30;
const at = (x: number, y: number) => y * W + x;

function ground(paint: (g: Ground) => void = () => {}): Ground {
  const n = W * H;
  const g: Ground = {
    sea: new Uint8Array(n),
    forest: new Uint8Array(n),
    marsh: new Uint8Array(n),
    upland: new Float32Array(n),
    road: new Uint8Array(n),
    river: new Uint8Array(n),
    riverWide: new Uint8Array(n),
  };
  paint(g);
  return g;
}
const flat = (heights = new Float32Array(W * H), rise = 1): Terrain => ({
  grid: flatGrid(W, H),
  heights,
  kmPerCell: 1,
  rise,
});

describe("the cost of ground", () => {
  it("is slower in forest and marsh, quicker on a road, and closed at sea except to a ship", () => {
    const g = ground((x) => {
      x.forest[1] = 1;
      x.marsh[2] = 1;
      x.road[3] = 1;
      x.sea[4] = 1;
      x.riverWide[5] = 1;
      x.river[6] = x.riverWide[6] = x.road[6] = 1;
      x.upland[7] = 1;
    });
    const foot = surfaceFor(g, "foot", "fast");
    expect(1 / foot.inv[0]!).toBeCloseTo(MODES.foot.open);
    expect(1 / foot.inv[1]!).toBeCloseTo(MODES.foot.forest);
    expect(1 / foot.inv[2]!).toBeCloseTo(MODES.foot.marsh);
    expect(1 / foot.inv[3]!).toBeCloseTo(MODES.foot.road);
    expect(foot.inv[4]).toBe(Infinity);
    expect(1 / foot.inv[5]!).toBeCloseTo(MODES.foot.ford);
    // A road on a river is a bridge: as quick as the road.
    expect(1 / foot.inv[6]!).toBeCloseTo(MODES.foot.road);
    expect(1 / foot.inv[7]!).toBeCloseTo(MODES.foot.open * MODES.foot.upland);
    expect(1 / surfaceFor(g, "ship", "fast").inv[4]!).toBeCloseTo(9);
    // Avoid water: no ford and no sea, but the bridge stays.
    const dry = surfaceFor(g, "ship", "dry");
    expect(dry.inv[4]).toBe(Infinity);
    expect(dry.inv[5]).toBe(Infinity);
    expect(dry.inv[6]).not.toBe(Infinity);
  });

  it("follows Tobler's rule on foot: quickest a little downhill, slower up", () => {
    const { k, off } = MODES.foot;
    expect(slopeFactor(k, off, 0)).toBeCloseTo(1);
    expect(slopeFactor(k, off, -0.05)).toBeCloseTo(Math.exp(-0.175));
    expect(slopeFactor(k, off, 0.1)).toBeCloseTo(Math.exp(0.35));
    // Steeply down is slow again.
    expect(slopeFactor(k, off, -0.3)).toBeGreaterThan(1.5);
    // A cart gains nothing downhill and loses far more uphill.
    expect(slopeFactor(MODES.cart.k, MODES.cart.off, -0.05)).toBeGreaterThan(1);
    expect(slopeFactor(MODES.cart.k, 0, 0.1)).toBeGreaterThan(slopeFactor(k, off, 0.1) * 2);
  });
});

describe("a route", () => {
  it("takes the time Tobler gives on a steady slope", () => {
    const heights = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) heights[at(x, y)] = 0.1 * x;
    const t = flat(heights);
    const foot = surfaceFor(ground(), "foot", "fast");
    const up = search(t, foot, at(5, 15), at(15, 15))!;
    // Ten km at 4 km an hour, up a 10% slope.
    expect(up.hours).toBeCloseTo((10 / 4) * Math.exp(0.35), 5);
    const down = search(t, foot, at(15, 15), at(5, 15))!;
    expect(down.hours).toBeLessThan(up.hours);
    expect(hoursAlong(t, foot, up.cells)).toBeCloseTo(up.hours);
  });

  it("passes a wall at its one gap", () => {
    const g = ground((x) => {
      for (let y = 0; y < H; y++) if (y !== 25) x.sea[at(20, y)] = 1;
    });
    const found = search(flat(), surfaceFor(g, "foot", "fast"), at(5, 5), at(35, 5))!;
    expect(found.cells).toContain(at(20, 25));
    // The least time, with sixteen ways out of a cell: five knight's moves and ten diagonal
    // steps each side of the gap (eight ways would take fifteen diagonal and five straight).
    expect(found.hours).toBeCloseTo((2 * (5 * Math.sqrt(5) + 10 * Math.SQRT2)) / 4, 5);
  });

  it("takes a road when the detour is small, and not when it is large", () => {
    const withRoad = (row: number) =>
      ground((x) => {
        for (let xx = 5; xx <= 35; xx++) x.road[at(xx, row)] = 1;
      });
    const onRoad = (row: number) => {
      const found = search(
        flat(),
        surfaceFor(withRoad(row), "foot", "fast"),
        at(5, 15),
        at(35, 15),
      )!;
      return found.cells.filter((c) => ((c / W) | 0) === row).length;
    };
    // Three cells aside: 5 km/h on the road beats 4 straight across.
    expect(onRoad(12)).toBeGreaterThan(15);
    // Twelve cells aside: the road is not worth it.
    expect(onRoad(3)).toBe(0);
  });

  it("finds no way across water on foot; a ship sails it", () => {
    const g = ground((x) => {
      for (let y = 0; y < H; y++) for (let xx = 18; xx <= 22; xx++) x.sea[at(xx, y)] = 1;
    });
    const t = flat();
    expect(search(t, surfaceFor(g, "foot", "fast"), at(5, 15), at(35, 15))).toBeNull();
    expect(routeThrough(t, surfaceFor(g, "foot", "fast"), [at(5, 15), at(35, 15)])).toBeNull();
    const legs = routeThrough(t, surfaceFor(g, "ship", "fast"), [at(5, 15), at(35, 15)])!;
    const marks = marksAlong(g, legs[0]!.cells);
    expect(marks.seaCells).toBe(5);
    expect(marks.marks.map((m) => m.kind)).toEqual(["sail", "land"]);
  });

  it("fords a river slowly, marks the ford, and goes round by the bridge when water is avoided", () => {
    const g = ground((x) => {
      for (let y = 0; y < H; y++) x.river[at(20, y)] = 1;
      x.riverWide.set(thicken(x.river, flatGrid(W, H)));
      // A bridge far to the south.
      for (let xx = 18; xx <= 22; xx++) x.road[at(xx, 27)] = 1;
    });
    const t = flat();
    const fast = search(t, surfaceFor(g, "foot", "fast"), at(16, 3), at(24, 3))!;
    const dry = search(t, surfaceFor(g, "foot", "dry"), at(16, 3), at(24, 3))!;
    expect(marksAlong(g, fast.cells).fords).toBe(1);
    expect(marksAlong(g, dry.cells)).toMatchObject({ fords: 0, bridges: 1 });
    expect(dry.cells).toContain(at(20, 27));
    expect(dry.hours).toBeGreaterThan(fast.hours);
    expect(sameWay(dry, fast)).toBe(false);
    expect(sameWay(fast, fast)).toBe(true);
    // A cart all but cannot ford: it takes the bridge even when asked for the fastest.
    const cart = search(t, surfaceFor(g, "cart", "fast"), at(16, 3), at(24, 3))!;
    expect(cart.cells).toContain(at(20, 27));
  });

  it("goes round a hill when asked for the flattest way", () => {
    const heights = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++)
        heights[at(x, y)] = 0.6 * Math.exp(-(((x - 20) / 6) ** 2 + ((y - 15) / 6) ** 2));
    }
    const t = flat(heights, 0.5);
    const g = ground();
    const fast = search(t, surfaceFor(g, "foot", "fast"), at(4, 15), at(36, 15))!;
    const level = search(t, surfaceFor(g, "foot", "flat"), at(4, 15), at(36, 15))!;
    const highest = (cells: number[]) => Math.max(...cells.map((c) => heights[c]!));
    expect(highest(level.cells)).toBeLessThan(highest(fast.cells));
    // The time told is the time travelled, not the search's dislike of slopes.
    expect(level.hours).toBeGreaterThanOrEqual(fast.hours - 1e-9);
  });

  it("starts from the nearest land when a stop is just in the water", () => {
    const g = ground((x) => {
      for (let y = 0; y < H; y++) for (let xx = 0; xx <= 3; xx++) x.sea[at(xx, y)] = 1;
    });
    const s = surfaceFor(g, "foot", "fast");
    expect(nearestPassable(flatGrid(W, H), s, at(2, 10))).toBe(at(4, 10));
    expect(nearestPassable(flatGrid(W, H), s, at(0, 10), 2)).toBe(-1);
  });
});

describe("travelling time in words", () => {
  it("says hours under a day, then days to the half", () => {
    expect(travelTime(0.2)).toBe("1 h");
    expect(travelTime(3.4)).toBe("3 h");
    expect(travelTime(8)).toBe("1 day");
    expect(travelTime(12)).toBe("1½ days");
    expect(travelTime(4)).toBe("4 h");
    expect(travelTime(216)).toBe("27 days");
    expect(travelTime(84)).toBe("10½ days");
  });

  it("knows the units a map is likely to be in, and not a world's own", () => {
    expect(unitKm("km")).toBe(1);
    expect(unitKm("Miles")).toBeCloseTo(1.609344);
    expect(unitKm("m")).toBe(0.001);
    expect(unitKm("leagues")).toBeCloseTo(4.828032);
    expect(unitKm("strides")).toBeNull();
  });
});
