import type { MapFile } from "@frontier/schema";
import { describe, expect, it } from "vitest";
import {
  addBody,
  bodiesOf,
  dragBody,
  firstStar,
  hasPair,
  patchBody,
  placement,
  planetsOf,
  removeBody,
  setCircuit,
  setHome,
} from "./systemMap.ts";
import { apart, drawnPosition, period, truePosition } from "./orbits.ts";

const empty = (): MapFile => ({
  version: 1,
  id: "abcd1234",
  title: "Solen system",
  space: { kind: "system", unit: "AU" },
  images: [],
  markerSets: [],
  layers: [{ id: "l1", name: "Bodies", visible: true, color: "#f2d28a" }],
  features: [],
});

function system() {
  let map = firstStar(empty(), "l1", "Solen");
  const earth = addBody(map, "l1", "ocean", bodiesOf(map)[0]!.id, 1, 1.2, 0);
  map = earth.map;
  const moon = addBody(map, "l1", "moon", earth.id, 384.4, 0.3, 0);
  map = moon.map;
  return { map, star: bodiesOf(map)[0]!.id, earth: earth.id, moon: moon.id };
}

describe("a system model's file", () => {
  it("begins with its star at the centre", () => {
    const map = firstStar(empty(), "l1", "Solen");
    const [star] = bodiesOf(map);
    expect(star).toMatchObject({ type: "star", parent: null, mass: 1 });
  });

  it("puts a body where it was dropped, on the day it was dropped", () => {
    const { map, earth } = system();
    const bodies = bodiesOf(map);
    const b = bodies.find((x) => x.id === earth)!;
    const p = truePosition(b, 0, bodies);
    expect(Math.atan2(p.y, p.x)).toBeCloseTo(1.2, 2);
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(1, 2);
    // Dropped on day 100, it is there on day 100.
    const later = addBody(map, "l1", "rocky", bodies[0]!.id, 1.6, -0.7, 100);
    const all = bodiesOf(later.map);
    const rocky = all.find((x) => x.id === later.id)!;
    const q = truePosition(rocky, 100, all);
    expect(Math.atan2(q.y, q.x)).toBeCloseTo(-0.7, 2);
  });

  it("makes a comet's orbit long and stretched, reaching out to where it was dropped", () => {
    const { map, star } = system();
    const c = addBody(map, "l1", "comet", star, 9, 0.5, 0);
    const bodies = bodiesOf(c.map);
    const comet = bodies.find((b) => b.id === c.id)!;
    expect(comet.e).toBeGreaterThan(0.8);
    expect(comet.a * (1 + comet.e)).toBeGreaterThan(8);
  });

  it("makes a belt a band round the dropped distance", () => {
    const { map, star } = system();
    const belt = addBody(map, "l1", "belt", star, 2.7, 0, 0);
    const b = bodiesOf(belt.map).find((x) => x.id === belt.id)!;
    expect(b.inner).toBeCloseTo(2.7 * 0.88, 2);
    expect(b.outer).toBeCloseTo(2.7 * 1.12, 2);
  });

  it("makes a second star once, circling the first", () => {
    const { map, star } = system();
    expect(hasPair(map)).toBe(false);
    const pair = addBody(map, "l1", "companion", star, 0.3, 0.5, 0);
    expect(hasPair(pair.map)).toBe(true);
    const c = bodiesOf(pair.map).find((b) => b.id === pair.id)!;
    expect(c).toMatchObject({ type: "companion", parent: null });
    expect(c.mass).toBeGreaterThan(0);
  });
});

describe("changing a body", () => {
  it("keeps a world where it is when its distance changes, so it does not jump", () => {
    const { map, earth, star } = system();
    const before = bodiesOf(map);
    const was = truePosition(
      before.find((b) => b.id === earth)!,
      40,
      before,
    );
    const next = patchBody(map, earth, { a: 2 }, 40);
    const after = bodiesOf(next);
    const now = truePosition(
      after.find((b) => b.id === earth)!,
      40,
      after,
    );
    expect(Math.atan2(now.y, now.x)).toBeCloseTo(Math.atan2(was.y, was.x), 3);
    expect(Math.hypot(now.x, now.y)).toBeCloseTo(2, 3);
    expect(after.find((b) => b.id === star)!.mass).toBe(1);
  });

  it("sets a distance from a year in days, as nature does it", () => {
    const { map, earth } = system();
    const next = setCircuit(map, earth, 687, 0);
    const bodies = bodiesOf(next);
    const e = bodies.find((b) => b.id === earth)!;
    expect(period(e, bodies)).toBeCloseTo(687, 0);
    expect(e.a).toBeCloseTo(1.52, 1);
  });

  it("names one home world at a time", () => {
    const { map, earth } = system();
    const other = addBody(map, "l1", "rocky", bodiesOf(map)[0]!.id, 1.5, 0, 0);
    const a = setHome(other.map, earth);
    const b = setHome(a, other.id);
    expect(
      bodiesOf(a)
        .filter((x) => x.home)
        .map((x) => x.id),
    ).toEqual([earth]);
    expect(
      bodiesOf(b)
        .filter((x) => x.home)
        .map((x) => x.id),
    ).toEqual([other.id]);
  });

  it("lists the planets a moon may circle: not stars, belts, comets or moons", () => {
    const { map, star, earth } = system();
    const withBelt = addBody(map, "l1", "belt", star, 3, 0, 0).map;
    const all = addBody(withBelt, "l1", "comet", star, 9, 0, 0).map;
    expect(planetsOf(bodiesOf(all)).map((b) => b.id)).toEqual([earth]);
  });

  it("is a lone planet's distance from home when asked", () => {
    const { map, earth } = system();
    const mars = addBody(map, "l1", "rocky", bodiesOf(map)[0]!.id, 1.524, 0, 0);
    const bodies = bodiesOf(mars.map);
    const e = bodies.find((b) => b.id === earth)!;
    const m = bodies.find((b) => b.id === mars.id)!;
    expect(apart(e, m, 0, bodies)).toBeGreaterThan(0.4);
  });
});

describe("removing a body", () => {
  it("takes everything that circles it too", () => {
    const { map, earth, moon } = system();
    const next = removeBody(map, earth);
    const ids = bodiesOf(next).map((b) => b.id);
    expect(ids).not.toContain(earth);
    expect(ids).not.toContain(moon);
    expect(ids).toHaveLength(1);
  });

  it("keeps the first star", () => {
    const { map, star } = system();
    expect(bodiesOf(removeBody(map, star))).toHaveLength(3);
  });
});

describe("dragging a body", () => {
  it("moves it outward to a new distance, and round to a new place on that day", () => {
    const { map, earth } = system();
    const target = { x: 0, y: -2 * 86 * 1 };
    const bodies = bodiesOf(map);
    const day = 30;
    const next = dragBody(map, earth, target, day, "schematic");
    const after = bodiesOf(next);
    const e = after.find((b) => b.id === earth)!;
    const p = drawnPosition(e, day, after, "schematic");
    expect(p.x).toBeCloseTo(target.x, 0);
    expect(p.y).toBeCloseTo(target.y, 0);
    expect(e.a).toBeGreaterThan(bodies.find((b) => b.id === earth)!.a);
    expect(after.find((b) => b.id === earth)!.parent).toBe(bodies[0]!.id);
  });

  it("drags a moon on its planet's scale, with the planet in the way it was", () => {
    const { map, moon, earth } = system();
    const bodies = bodiesOf(map);
    const planet = drawnPosition(
      bodies.find((b) => b.id === earth)!,
      0,
      bodies,
      "schematic",
    );
    const next = dragBody(map, moon, { x: planet.x + 30, y: planet.y }, 0, "schematic");
    const after = bodiesOf(next);
    const m = after.find((b) => b.id === moon)!;
    const q = drawnPosition(m, 0, after, "schematic");
    expect(q.x - planet.x).toBeCloseTo(30, 0);
    expect(Math.abs(q.y - planet.y)).toBeLessThan(1);
  });

  it("changes how far apart a pair are, and leaves a belt and the first star alone", () => {
    const { map, star } = system();
    const pair = addBody(map, "l1", "companion", star, 0.3, 0, 0);
    const next = dragBody(pair.map, pair.id, { x: 120, y: 0 }, 0, "schematic");
    expect(bodiesOf(next).find((b) => b.id === pair.id)!.a).not.toBe(0.3);
    const belt = addBody(map, "l1", "belt", star, 2.7, 0, 0);
    expect(dragBody(belt.map, belt.id, { x: 500, y: 0 }, 0, "schematic")).toBe(belt.map);
    expect(dragBody(map, star, { x: 500, y: 0 }, 0, "schematic")).toBe(map);
  });
});

describe("where a new body would go", () => {
  it("is a distance from the star for a planet, from the nearest planet for a moon", () => {
    const { map, star, earth } = system();
    const bodies = bodiesOf(map);
    const planet = drawnPosition(
      bodies.find((b) => b.id === earth)!,
      0,
      bodies,
      "schematic",
    );
    const far = placement(map, "gas", { x: 0, y: 86 * Math.sqrt(5) }, 0, "schematic")!;
    expect(far.parent).toBe(star);
    expect(far.a).toBeCloseTo(5, 3);
    const near = placement(map, "moon", { x: planet.x + 20, y: planet.y }, 0, "schematic")!;
    expect(near.parent).toBe(earth);
  });

  it("has no place for a moon where there is no planet", () => {
    const map = firstStar(empty(), "l1");
    expect(placement(map, "moon", { x: 10, y: 10 }, 0, "schematic")).toBeNull();
  });
});
