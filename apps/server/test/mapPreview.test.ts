import type { MapFeature, MapFile } from "@frontier/schema";
import { describe, expect, it } from "vitest";
import { previewOf } from "../src/maps/preview.js";

const marker = (id: string, at: [number, number], extra: Record<string, unknown> = {}) =>
  ({
    id,
    kind: "marker",
    layer: "l1",
    at,
    entry: null,
    label: id,
    icon: null,
    child: null,
    ...extra,
  }) as MapFeature;

const base = (
  space: MapFile["space"],
  features: MapFeature[],
  images: MapFile["images"] = [],
): MapFile => ({
  version: 1,
  id: "abcd1234",
  title: "T",
  space,
  images,
  markerSets: [],
  layers: [{ id: "l1", name: "Stars", visible: true, color: "#f2d28a" }],
  features,
});

describe("a map's preview for the list", () => {
  it("is the first visible image of a globe or flat map, else the first image, else none", () => {
    const image = (id: string, path: string, visible: boolean) => ({
      id,
      name: id,
      path,
      extent: [0, 0, 1, 1] as [number, number, number, number],
      visible,
    });
    const flat = (images: MapFile["images"]) =>
      base({ kind: "flat", width: 1, height: 1, scale: null, unit: "km" }, [], images);
    expect(previewOf(flat([image("a", "x/a.png", false), image("b", "x/b.png", true)]))).toEqual({
      kind: "image",
      path: "x/b.png",
    });
    expect(previewOf(flat([image("a", "x/a.png", false)]))).toEqual({
      kind: "image",
      path: "x/a.png",
    });
    expect(previewOf(flat([]))).toBeNull();
  });

  it("is a star map's stars on a 0 to 1 square, with its routes as pairs of stars", () => {
    const map = base({ kind: "stars", unit: "ly" }, [
      marker("a", [0, 0], { tone: "#d9694a" }),
      marker("b", [10, 0]),
      marker("c", [10, 5]),
      {
        id: "r",
        kind: "route",
        layer: "l1",
        entry: null,
        label: null,
        child: null,
        stops: ["a", "b", "c"],
      } as MapFeature,
    ]);
    const p = previewOf(map);
    expect(p?.kind).toBe("stars");
    if (p?.kind !== "stars") return;
    expect(p.dots).toHaveLength(3);
    for (const d of p.dots) {
      expect(d.x).toBeGreaterThanOrEqual(0.1);
      expect(d.x).toBeLessThanOrEqual(0.9);
      expect(d.y).toBeGreaterThanOrEqual(0.1);
      expect(d.y).toBeLessThanOrEqual(0.9);
    }
    // One scale for both axes: the shape is the shape.
    const [a, b, c] = p.dots;
    expect((b!.x - a!.x) / (c!.y === b!.y ? 1 : Math.abs(c!.y - b!.y))).toBeCloseTo(2, 1);
    expect(a!.c).toBe("#d9694a");
    expect(p.lines).toEqual([
      [0, 1],
      [1, 2],
    ]);
  });

  it("is none for a star map with no stars, and keeps at most sixty stars", () => {
    expect(previewOf(base({ kind: "stars", unit: "ly" }, []))).toBeNull();
    const many = Array.from({ length: 80 }, (_, i) => marker(`s${i}`, [i, i % 7]));
    const p = previewOf(base({ kind: "stars", unit: "ly" }, many));
    expect(p?.kind === "stars" && p.dots.length).toBe(60);
  });

  it("is a system's star and its planets' orbits, narrowest first, as shares of the widest", () => {
    const map = base({ kind: "system", unit: "AU" }, [
      marker("sun", [0, 0], { body: { type: "star", a: 0, mass: 1 } }),
      marker("far", [0, 0], { body: { type: "gas", parent: "sun", a: 9, phase: 1 } }),
      marker("near", [0, 0], { body: { type: "rocky", parent: "sun", a: 1, phase: 2 } }),
      marker("moon", [0, 0], { body: { type: "moon", parent: "near", a: 384 } }),
    ]);
    const p = previewOf(map);
    expect(p?.kind).toBe("system");
    if (p?.kind !== "system") return;
    expect(p.rings).toHaveLength(2);
    expect(p.rings[0]!.r).toBeLessThan(p.rings[1]!.r);
    expect(p.rings[1]!.r).toBeCloseTo(1, 3);
    expect(p.rings[1]!.c).toBe("#d9b38c");
  });
});
