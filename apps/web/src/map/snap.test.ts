import type { Shape, View } from "@frontier/geo";
import type { MapFeature } from "@frontier/schema";
import { describe, expect, it } from "vitest";
import { snapAt } from "./snap.ts";

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

  it("leaves out what is not drawn, as a hidden layer is, and markers and labels", () => {
    const label = {
      id: "words",
      kind: "label",
      ...base,
      label: "Sea",
      at: [600, 600],
    } as MapFeature;
    const all = [...features, label];
    expect(snapAt(view, all, drawnOf([road, label]), [305, 96], null)).toBeNull();
    expect(snapAt(view, all, drawnOf(all), [602, 600], null)).toBeNull();
  });
});
