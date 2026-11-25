import type { Shape, View } from "@frontier/geo";
import type { MapFeature } from "@frontier/schema";
import { describe, expect, it } from "vitest";
import { ALL_TARGETS, SNAP_REACH, snapAt, type SnapTargets, targetsText } from "./snap.ts";

/** A view whose screen is the map's own units. */
const view = {
  project: (p: [number, number]) => p,
  unproject: (x: number, y: number) => [x, y],
  repeats: () => [0],
} as unknown as View;

const base = { layer: "l1", entry: null, label: null, child: null };
const zone = (id: string, points: [number, number][]) =>
  ({ id, kind: "zone", ...base, points }) as MapFeature;
const path = (id: string, points: [number, number][]) =>
  ({ id, kind: "path", ...base, points }) as MapFeature;
/** Where each was drawn: here the same as its points. */
const drawnOf = (features: MapFeature[]): Shape[] =>
  features.map((f) =>
    f.kind === "marker" || f.kind === "label"
      ? { id: f.id, kind: "marker", at: f.at }
      : f.kind === "route"
        ? { id: f.id, kind: "path", points: [] }
        : { id: f.id, kind: f.kind, points: f.points },
  );

const land = zone("land", [
  [100, 100],
  [300, 100],
  [300, 300],
  [100, 300],
]);
const road = path("road", [
  [0, 500],
  [400, 500],
]);
const features = [land, road];
const shapes = drawnOf(features);

describe("snapping a point to the paths and zones beside it", () => {
  it("takes a corner within reach, at the corner's own position", () => {
    expect(snapAt(view, features, shapes, [305, 96], null)).toEqual({
      at: [300, 100],
      screen: [300, 100],
      kind: "corner",
      feature: "land",
    });
  });

  it("prefers a corner to an edge that is nearer", () => {
    // 2 from the edge, 9 from the corner: the shared corner is what is wanted.
    expect(snapAt(view, features, shapes, [291, 102], null)?.kind).toBe("corner");
  });

  it("takes the nearest point of an edge, a zone's closing edge too", () => {
    expect(snapAt(view, features, shapes, [200, 507], null)).toMatchObject({
      at: [200, 500],
      kind: "edge",
      feature: "road",
    });
    // The side from the last corner back to the first.
    expect(snapAt(view, features, shapes, [95, 200], null)).toMatchObject({
      at: [100, 200],
      kind: "edge",
      feature: "land",
    });
  });

  it("does nothing out of reach", () => {
    expect(snapAt(view, features, shapes, [200, 200], null)).toBeNull();
    expect(snapAt(view, features, shapes, [200, 520], null)).toBeNull();
  });

  it("never snaps a feature to itself", () => {
    expect(snapAt(view, features, shapes, [305, 96], "land")).toBeNull();
  });

  it("leaves out what is not drawn, as a hidden layer is, and each target that is turned off", () => {
    const label = {
      id: "words",
      kind: "label",
      ...base,
      label: "Sea",
      at: [600, 600],
    } as MapFeature;
    const all = [...features, label];
    expect(snapAt(view, all, drawnOf([road, label]), [305, 96], null)).toBeNull();
    // Markers and labels are snapped to at their own place, unless that target is off.
    expect(snapAt(view, all, drawnOf(all), [602, 600], null)).toMatchObject({
      at: [600, 600],
      feature: "words",
    });
    const off = (t: Partial<SnapTargets>) => ({ ...ALL_TARGETS, ...t });
    expect(
      snapAt(view, all, drawnOf(all), [602, 600], null, SNAP_REACH, off({ markers: false })),
    ).toBeNull();
    // With Zones off the land is not snapped to; with Paths off as well, nothing is.
    const here = snapAt(view, all, drawnOf(all), [305, 96], null);
    expect(here?.feature).toBe("land");
    const noZones = snapAt(
      view,
      all,
      drawnOf(all),
      [305, 96],
      null,
      SNAP_REACH,
      off({ zones: false }),
    );
    expect(noZones?.feature ?? "road").toBe("road");
    expect(
      snapAt(
        view,
        all,
        drawnOf(all),
        [305, 96],
        null,
        SNAP_REACH,
        off({ zones: false, paths: false }),
      ),
    ).toBeNull();
    expect(targetsText(true, off({ markers: false }))).toBe("Snaps to paths and zones");
    expect(targetsText(true, off({ paths: false, zones: false, markers: false }))).toBe(
      "Snaps to nothing",
    );
    expect(targetsText(false, ALL_TARGETS)).toBe("Off");
  });
});
