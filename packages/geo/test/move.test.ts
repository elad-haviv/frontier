import { geoArea } from "d3-geo";
import { describe, expect, it } from "vitest";
import { handleAt, moveBy, outline, type Position, shapeAt, type Space } from "../src/index.js";

const SPHERE: Space = { kind: "sphere", radius: null, unit: "km" };
const FLAT: Space = { kind: "flat", width: 2000, height: 1000, scale: null, unit: "km" };

const KINGDOM: Position[] = [
  [10, 40],
  [30, 40],
  [30, 55],
  [10, 55],
];
const areaOf = (points: Position[]) =>
  geoArea({
    type: "Polygon",
    coordinates: [outline(SPHERE, points, { curve: false, closed: true }).line],
  });

describe("moving a zone", () => {
  it("translates it on a flat map", () => {
    expect(
      moveBy(
        FLAT,
        [
          [0, 0],
          [10, 5],
        ],
        [100, 100],
        [130, 90],
      ),
    ).toEqual([
      [30, -10],
      [40, -5],
    ]);
  });

  it("turns it about the poles on a sphere: the same area, still upright", () => {
    const moved = moveBy(SPHERE, KINGDOM, [20, 45], [80, 45]);
    expect(moved).toEqual([
      [70, 40],
      [90, 40],
      [90, 55],
      [70, 55],
    ]);
    expect(areaOf(moved)).toBeCloseTo(areaOf(KINGDOM), 12);
  });

  it("adds the change of latitude to every point, so north stays up", () => {
    const moved = moveBy(SPHERE, KINGDOM, [20, 45], [25, 35]);
    moved.forEach((p, i) => {
      expect(p[0]).toBeCloseTo(KINGDOM[i]![0] + 5, 9);
      expect(p[1]).toBeCloseTo(KINGDOM[i]![1] - 10, 9);
    });
  });

  it("stops at a pole instead of folding over it", () => {
    const north = moveBy(SPHERE, KINGDOM, [20, 45], [20, 89]);
    expect(Math.max(...north.map((p) => p[1]))).toBe(90);
    expect(north[0]![1]).toBe(75);
    const south = moveBy(SPHERE, KINGDOM, [20, 45], [20, -89]);
    expect(Math.min(...south.map((p) => p[1]))).toBe(-90);
  });

  it("keeps longitudes together across the 180th meridian", () => {
    // 195 degrees west is taken the short way round: 165 degrees east.
    const moved = moveBy(SPHERE, KINGDOM, [20, 45], [-175, 45]);
    expect(moved.map((p) => p[0])).toEqual([175, 195, 195, 175]);
    // When the first point passes 180 the whole zone is brought round together.
    const across = moveBy(SPHERE, KINGDOM, [20, 45], [190, 45]);
    expect(across.map((p) => p[0])).toEqual([-180, -160, -160, -180]);
    expect(areaOf(across)).toBeCloseTo(areaOf(KINGDOM), 12);
    expect(moveBy(SPHERE, [], [0, 0], [1, 1])).toEqual([]);
  });
});

describe("finding handles and zones", () => {
  it("finds the nearest handle within reach", () => {
    const handles: [number, number][] = [
      [0, 0],
      [30, 0],
    ];
    expect(handleAt(handles, [20, 2], 18)).toBe(1);
    expect(handleAt(handles, [15, 40], 18)).toBeNull();
  });

  it("asks a zone that says what its inside is", () => {
    const shapes = [
      {
        id: "z",
        kind: "zone" as const,
        points: [] as [number, number][],
        inside: (p: [number, number]) => p[0] > 100,
      },
    ];
    expect(shapeAt(shapes, [150, 0])).toBe("z");
    expect(shapeAt(shapes, [50, 0])).toBeNull();
  });
});
