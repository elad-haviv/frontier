import type { MapFeature, MapFile } from "@frontier/schema";
import { describe, expect, it } from "vitest";
import { along, keepStretches, stretchSpan } from "./stretches.ts";

const path = (points: [number, number][], stretches: unknown[]): MapFeature =>
  ({
    id: "p1",
    kind: "path",
    layer: "l1",
    points,
    entry: null,
    label: null,
    child: null,
    stretches,
  }) as MapFeature;
const mapOf = (f: MapFeature): MapFile => ({ features: [f] }) as unknown as MapFile;
const tunnel = { kind: "tunnel", from: [10, 0], to: [20, 0] };

describe("a path's stretches", () => {
  const before = mapOf(
    path(
      [
        [0, 0],
        [10, 0],
        [20, 0],
        [30, 0],
      ],
      [tunnel],
    ),
  );

  it("lie between two of the path's corners, whichever way round", () => {
    const f = before.features[0] as Extract<MapFeature, { kind: "path" }>;
    expect(stretchSpan(f.points, f.stretches![0]!)).toEqual([1, 2]);
    expect(stretchSpan(f.points, { kind: "tunnel", from: [20, 0], to: [10, 0] })).toEqual([1, 2]);
    expect(stretchSpan(f.points, { kind: "tunnel", from: [11, 0], to: [20, 0] })).toBeNull();
  });

  it("follow a corner that is dragged, and stay when one is put in elsewhere", () => {
    const dragged = keepStretches(
      before,
      mapOf(
        path(
          [
            [0, 0],
            [10, 5],
            [20, 0],
            [30, 0],
          ],
          [tunnel],
        ),
      ),
    );
    expect((dragged.features[0] as { stretches: unknown[] }).stretches).toEqual([
      { kind: "tunnel", from: [10, 5], to: [20, 0] },
    ]);
    const more = mapOf(
      path(
        [
          [0, 0],
          [5, 1],
          [10, 0],
          [20, 0],
          [30, 0],
        ],
        [tunnel],
      ),
    );
    expect(keepStretches(before, more)).toBe(more);
  });

  it("go when a corner of theirs is taken away", () => {
    const fewer = keepStretches(
      before,
      mapOf(
        path(
          [
            [0, 0],
            [20, 0],
            [30, 0],
          ],
          [tunnel],
        ),
      ),
    );
    expect((fewer.features[0] as { stretches?: unknown[] }).stretches).toBeUndefined();
  });

  it("are drawn along the line as it is on the screen", () => {
    const at = along(
      [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
      15,
    );
    expect(at.p).toEqual([10, 5]);
    expect([at.dx, at.dy]).toEqual([0, 1]);
  });
});
