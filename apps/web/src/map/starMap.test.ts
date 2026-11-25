import type { MapFile } from "@frontier/schema";
import { describe, expect, it } from "vitest";
import {
  addRoute,
  addStar,
  clearField,
  lookOf,
  moveStar,
  moveStop,
  nearestStars,
  patchFeature,
  placeOf,
  removeFeature,
  removeStop,
  routes,
  stars,
  stopsOf,
  toneOf,
} from "./starMap.ts";

const empty = (): MapFile => ({
  version: 1,
  id: "abcd1234",
  title: "The Near Stars",
  space: { kind: "stars", unit: "ly" },
  images: [],
  markerSets: [],
  layers: [
    { id: "stars", name: "Stars", visible: true, color: "#f2d28a", look: "dot" },
    { id: "ports", name: "Ports", visible: true, color: "#fbf7f0", look: "pin" },
  ],
  features: [],
});

function three(): { map: MapFile; a: string; b: string; c: string } {
  let map = empty();
  const a = addStar(map, "stars", 0, 0);
  const b = addStar(a.map, "stars", 3, 4, 12);
  const c = addStar(b.map, "ports", -2, 1, -1);
  map = c.map;
  return { map, a: a.id, b: b.id, c: c.id };
}

describe("stars", () => {
  it("puts a star on the plane, rounded to a tenth", () => {
    const { map, id } = addStar(empty(), "stars", 1.234, -5.67);
    const s = stars(map)[0]!;
    expect(s.id).toBe(id);
    expect(placeOf(s)).toEqual({ x: 1.2, y: -5.7, z: 0 });
  });

  it("moves one or more of the three numbers", () => {
    const { map, a } = three();
    const moved = moveStar(map, a, { z: 5.55 });
    expect(placeOf(stars(moved)[0]!)).toEqual({ x: 0, y: 0, z: 5.6 });
    expect(placeOf(stars(moveStar(moved, a, { x: 2 }))[0]!)).toEqual({ x: 2, y: 0, z: 5.6 });
  });

  it("draws as its own look, else its layer's, else a dot", () => {
    const { map, a, c } = three();
    expect(
      lookOf(
        map,
        stars(map).find((s) => s.id === a)!,
      ),
    ).toBe("dot");
    expect(
      lookOf(
        map,
        stars(map).find((s) => s.id === c)!,
      ),
    ).toBe("pin");
    const own = patchFeature(map, c, { look: "dot" });
    expect(
      lookOf(
        own,
        stars(own).find((s) => s.id === c)!,
      ),
    ).toBe("dot");
    const back = clearField(own, c, "look");
    expect(
      lookOf(
        back,
        stars(back).find((s) => s.id === c)!,
      ),
    ).toBe("pin");
  });

  it("takes its colour from itself, else its layer", () => {
    const { map, a } = three();
    expect(toneOf(map, stars(map)[0]!)).toBe("#f2d28a");
    const tinted = patchFeature(map, a, { tone: "#d9694a" });
    expect(toneOf(tinted, stars(tinted)[0]!)).toBe("#d9694a");
  });

  it("lists the nearest others", () => {
    const { map, a } = three();
    const near = nearestStars(
      map,
      stars(map).find((s) => s.id === a)!,
      1,
    );
    expect(near).toHaveLength(1);
    expect(near[0]!.far).toBeCloseTo(Math.hypot(2, 1, 1));
  });
});

describe("routes", () => {
  it("joins stars in order and skips a repeat", () => {
    const { map, a, b, c } = three();
    const made = addRoute(map, "stars", [a, a, b, c])!;
    const r = routes(made.map)[0]!;
    expect(r.stops).toEqual([a, b, c]);
    expect(stopsOf(made.map, r).map((s) => s.id)).toEqual([a, b, c]);
  });

  it("makes no route of fewer than two stars", () => {
    const { map, a } = three();
    expect(addRoute(map, "stars", [a])).toBeNull();
    expect(addRoute(map, "stars", [a, a])).toBeNull();
  });

  it("removes a star from its routes, and a route left with one stop", () => {
    const { map, a, b, c } = three();
    const withRoutes = addRoute(addRoute(map, "stars", [a, b, c])!.map, "stars", [a, b])!.map;
    const gone = removeFeature(withRoutes, c);
    expect(routes(gone).map((r) => r.stops)).toEqual([
      [a, b],
      [a, b],
    ]);
    const goneB = removeFeature(withRoutes, b);
    // [a, c] survives; [a] does not.
    expect(routes(goneB).map((r) => r.stops)).toEqual([[a, c]]);
  });

  it("removing a route leaves its stars", () => {
    const { map, a, b } = three();
    const made = addRoute(map, "stars", [a, b])!;
    expect(stars(removeFeature(made.map, made.id))).toHaveLength(3);
  });

  it("moves and removes stops, keeping at least two", () => {
    const { map, a, b, c } = three();
    const made = addRoute(map, "stars", [a, b, c])!;
    const swapped = moveStop(made.map, made.id, 0, 1);
    expect(routes(swapped)[0]!.stops).toEqual([b, a, c]);
    expect(routes(moveStop(swapped, made.id, 0, -1))[0]!.stops).toEqual([b, a, c]);
    const shorter = removeStop(made.map, made.id, 1);
    expect(routes(shorter)[0]!.stops).toEqual([a, c]);
    expect(routes(removeStop(shorter, made.id, 0))[0]!.stops).toEqual([a, c]);
  });
});
