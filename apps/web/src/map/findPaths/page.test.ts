import type { MapFile } from "@frontier/schema";
import { describe, expect, it } from "vitest";
import { makePaths, makeZone } from "./page.ts";

const map = { features: [], layers: [{ id: "l1" }] } as unknown as MapFile;

describe("what Make path makes", () => {
  it("keeps a tunnel and a climb by the coordinates of their corners, as written", () => {
    const made = makePaths(map, "l1", "strroad1", false, [
      {
        points: [
          [0.00049, 0],
          [10.1234567, 0],
          [20, 5.55555],
          [30, 5],
        ],
        exactStart: true,
        stretches: [
          { kind: "tunnel", from: 1, to: 2 },
          { kind: "climb", from: 2, to: 3, grade: 0.18333 },
          // Out of the line: dropped.
          { kind: "steps", from: 3, to: 9 },
        ],
        steepHidden: true,
      },
    ])!;
    const path = made.map.features[0] as unknown as {
      points: [number, number][];
      stretches: { kind: string; from: number[]; to: number[]; grade?: number }[];
      steepShown?: boolean;
    };
    // The first point stays exactly where it lies on the road it branches from; the rest round.
    expect(path.points[0]).toEqual([0.00049, 0]);
    expect(path.points[1]).toEqual([10.123, 0]);
    expect(path.stretches).toEqual([
      { kind: "tunnel", from: [10.123, 0], to: [20, 5.556] },
      { kind: "climb", from: [20, 5.556], to: [30, 5], grade: 0.183 },
    ]);
    expect(path.steepShown).toBe(false);
  });

  it("writes how a river ends inland, and no stretches or steepness when there are none", () => {
    const made = makePaths(map, "l1", null, true, [
      {
        points: [
          [0, 0],
          [5, 5],
        ],
        endAs: "dries",
        steepHidden: true,
      },
    ])!;
    const path = made.map.features[0] as unknown as Record<string, unknown>;
    expect(path.endAs).toBe("dries");
    expect("stretches" in path).toBe(false);
    expect("steepShown" in path).toBe(false);
  });

  it("makes a basin's lake as a zone in the layer and style asked", () => {
    const made = makeZone(map, "l1", "strwater", [
      [0, 0],
      [10, 0],
      [5, 8.88888],
    ])!;
    const zone = made.map.features[0] as unknown as Record<string, unknown>;
    expect(zone).toMatchObject({ kind: "zone", layer: "l1", style: "strwater" });
    expect(zone.points).toContainEqual([5, 8.889]);
    expect(makeZone(map, "l1", null, [[0, 0]])).toBeNull();
  });
});
