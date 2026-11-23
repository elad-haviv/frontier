import { makeView, outline, type Space, type View } from "@frontier/geo";
import type { MapFeature } from "@frontier/schema";
import { describe, expect, it } from "vitest";
import { isCurved, outlineOf, plusHandles, SHORTEST } from "./handles.ts";

const FLAT: Space = { kind: "flat", width: 1000, height: 1000, scale: null, unit: "" };
const SPHERE: Space = { kind: "sphere", radius: null, unit: "km" };
/** A view whose screen is the map's own units. */
const view = {
  project: (p: [number, number]) => p,
  unproject: (x: number, y: number) => [x, y],
} as unknown as View;

const base = { layer: "l1", entry: null, label: null, child: null };
const path = (points: [number, number][], extra: Record<string, unknown> = {}) =>
  ({ id: "p", kind: "path", ...base, points, ...extra }) as MapFeature;
const zone = (points: [number, number][], extra: Record<string, unknown> = {}) =>
  ({ id: "z", kind: "zone", ...base, points, ...extra }) as MapFeature;

describe("the line of a feature", () => {
  it("is curved only for a path or zone that says so", () => {
    expect(
      isCurved(
        path(
          [
            [0, 0],
            [1, 1],
          ],
          { curve: "smooth" },
        ),
      ),
    ).toBe(true);
    expect(
      isCurved(
        path([
          [0, 0],
          [1, 1],
        ]),
      ),
    ).toBe(false);
    expect(
      isCurved({ id: "m", kind: "marker", ...base, at: [0, 0], icon: null } as MapFeature),
    ).toBe(false);
  });

  it("is the outline of its points, closed for a zone", () => {
    const z = zone(
      [
        [0, 0],
        [100, 0],
        [100, 100],
      ],
      { curve: "smooth" },
    );
    expect(outlineOf(FLAT, z as never)).toEqual(
      outline(
        FLAT,
        [
          [0, 0],
          [100, 0],
          [100, 100],
        ],
        { curve: true, closed: true },
      ),
    );
  });
});

describe('the "+" handles', () => {
  it("sit at the middle of each segment, the closing one of a zone too", () => {
    const handles = plusHandles(
      FLAT,
      view,
      zone([
        [0, 0],
        [100, 0],
        [100, 100],
      ]),
      "mouse",
    );
    expect(handles.map((h) => h.segment)).toEqual([0, 1, 2]);
    expect(handles[0]).toEqual({ segment: 0, at: [50, 0], screen: [50, 0] });
    expect(handles[2]!.at).toEqual([50, 50]);
    expect(
      plusHandles(
        FLAT,
        view,
        path([
          [0, 0],
          [100, 0],
          [100, 100],
        ]),
        "mouse",
      ),
    ).toHaveLength(2);
  });

  it("sit on the curve of a curved feature", () => {
    const curved = path(
      [
        [0, 0],
        [100, 0],
        [100, 100],
      ],
      { curve: "smooth" },
    );
    const [first] = plusHandles(FLAT, view, curved, "mouse");
    // Off the straight chord, toward the outside of the bend.
    expect(first!.at[1]).toBeLessThan(0);
  });

  it("leave out segments too short for the pointer, and those of no length", () => {
    const small = path([
      [0, 0],
      [30, 0],
      [30, 30],
      [30, 30],
    ]);
    expect(plusHandles(FLAT, view, small, "mouse").map((h) => h.segment)).toEqual([0, 1]);
    expect(plusHandles(FLAT, view, small, "touch")).toEqual([]);
    expect(SHORTEST.touch).toBe(2 * 18 + 14);
  });

  it("are not shown on the far side of a globe", () => {
    const globe = makeView({ kind: "globe", lon: 0, lat: 0, k: 300 }, 800, 600);
    const near = path([
      [-20, 0],
      [20, 0],
    ]);
    expect(plusHandles(SPHERE, globe, near, "mouse")).toHaveLength(1);
    const behind = path([
      [160, 0],
      [-160, 0],
    ]);
    expect(plusHandles(SPHERE, globe, behind, "mouse")).toEqual([]);
    // Half on the far side: the visible half is measured.
    const edge = path([
      [50, 0],
      [110, 0],
    ]);
    expect(plusHandles(SPHERE, globe, edge, "mouse")).toHaveLength(1);
  });

  it("a marker has none", () => {
    expect(
      plusHandles(
        FLAT,
        view,
        { id: "m", kind: "marker", ...base, at: [0, 0], icon: null } as MapFeature,
        "mouse",
      ),
    ).toEqual([]);
  });
});
