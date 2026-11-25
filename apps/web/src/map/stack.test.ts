import type { MapFeature, MapFile } from "@frontier/schema";
import { describe, expect, it } from "vitest";
import {
  addPassage,
  leadsFrom,
  linksOf,
  neighbour,
  PLATE_H,
  PLATE_W,
  plateOf,
  placesOf,
  removePassage,
  removePlace,
  spotOf,
  stackOf,
} from "./stack.ts";

const globe = (id: string, title: string, under: string | null = null) => ({
  id,
  title,
  space: { kind: "sphere", radius: null, unit: "km" } as MapFile["space"],
  under,
});

const marker = (id: string, at: [number, number], extra: Record<string, unknown> = {}) =>
  ({
    id,
    kind: "marker",
    layer: "l",
    at,
    entry: null,
    label: id,
    icon: null,
    child: null,
    ...extra,
  }) as MapFeature;

const file = (id: string, features: MapFeature[]): MapFile =>
  ({
    version: 1,
    id,
    title: id,
    space: { kind: "sphere", radius: null, unit: "km" },
    images: [],
    markerSets: [],
    layers: [{ id: "l", name: "Places", visible: true, color: "#000000" }],
    features,
  }) as MapFile;

describe("which globes stack", () => {
  const maps = [
    globe("ezob", "Ezob"),
    globe("lab", "The Labyrinth", "ezob"),
    globe("two", "Layer 2", "lab"),
    globe("other", "Another world"),
    {
      id: "flat",
      title: "A town",
      space: { kind: "flat", width: 1, height: 1, scale: null, unit: "m" } as MapFile["space"],
      under: null,
    },
  ];
  it("lists the chain from the top, whichever layer is opened", () => {
    expect(stackOf("two", maps)).toEqual(["ezob", "lab", "two"]);
    expect(stackOf("ezob", maps)).toEqual(["ezob", "lab", "two"]);
    expect(stackOf("lab", maps)).toEqual(["ezob", "lab", "two"]);
  });
  it("gives a globe with nothing above or below only itself", () => {
    expect(stackOf("other", maps)).toEqual(["other"]);
  });
  it("survives a loop in the data", () => {
    const loop = [globe("a", "A", "b"), globe("b", "B", "a")];
    expect(stackOf("a", loop).length).toBeLessThanOrEqual(2);
  });
});

describe("plates", () => {
  it("put longitude across and latitude up, a layer further down for each step", () => {
    expect(plateOf([0, 0], 0, 5)).toEqual({ x: 0, y: 0, z: -0 });
    expect(plateOf([180, 90], 2, 5)).toEqual({ x: PLATE_W, y: PLATE_H, z: -10 });
  });
  it("go back from a place on a plate to a longitude and latitude, or none off the plate", () => {
    expect(spotOf(PLATE_W / 2, PLATE_H / 2)).toEqual([90, 45]);
    expect(spotOf(PLATE_W + 1, 0)).toBeNull();
  });
  it("keep the same spot straight under, at every layer", () => {
    const a = plateOf([30, 20], 0, 4);
    const b = plateOf([30, 20], 3, 4);
    expect([a.x, a.y]).toEqual([b.x, b.y]);
  });
});

describe("passages", () => {
  const order = ["ezob", "lab", "two"];
  const maps = () => ({
    ezob: file("ezob", [marker("dudai", [10, 10]), marker("gate", [40, -5])]),
    lab: file("lab", [marker("under", [10.5, 9.5]), marker("stair", [40, -5])]),
    two: file("two", [marker("well", [-60, 30])]),
  });

  it("is held by the upper place, and read from either end", () => {
    const all = maps();
    const places = placesOf(all, order);
    const dudai = places.find((p) => p.feature.id === "dudai")!;
    const under = places.find((p) => p.feature.id === "under")!;
    const made = addPassage(all, dudai, under)!;
    expect(made.map).toBe("ezob");
    const next = { ...all, [made.map]: made.next };
    const after = placesOf(next, order);
    const links = linksOf(after);
    expect(links).toHaveLength(1);
    const d = after.find((p) => p.feature.id === "dudai")!;
    const u = after.find((p) => p.feature.id === "under")!;
    expect(leadsFrom(d, links).map((p) => p.feature.id)).toEqual(["under"]);
    expect(leadsFrom(u, links).map((p) => p.feature.id)).toEqual(["dudai"]);
  });

  it("is held by the upper place even when drawn from the lower", () => {
    const all = maps();
    const places = placesOf(all, order);
    const made = addPassage(
      all,
      places.find((p) => p.feature.id === "stair")!,
      places.find((p) => p.feature.id === "gate")!,
    )!;
    expect(made.map).toBe("ezob");
  });

  it("joins no two places of one layer, and none twice", () => {
    const all = maps();
    const places = placesOf(all, order);
    const [a, b] = [
      places.find((p) => p.feature.id === "dudai")!,
      places.find((p) => p.feature.id === "gate")!,
    ];
    expect(addPassage(all, a, b)).toBeNull();
    const u = places.find((p) => p.feature.id === "under")!;
    const once = addPassage(all, a, u)!;
    const again = addPassage(
      { ...all, ezob: once.next },
      placesOf({ ...all, ezob: once.next }, order).find((p) => p.feature.id === "dudai")!,
      u,
    );
    expect(again).toBeNull();
  });

  it("is taken away from whichever place holds it", () => {
    const all = maps();
    const places = placesOf(all, order);
    const a = places.find((p) => p.feature.id === "dudai")!;
    const u = places.find((p) => p.feature.id === "under")!;
    const withPassage = { ...all, ezob: addPassage(all, a, u)!.next };
    const now = placesOf(withPassage, order);
    const changed = removePassage(
      withPassage,
      now.find((p) => p.feature.id === "under")!,
      now.find((p) => p.feature.id === "dudai")!,
    );
    expect(Object.keys(changed)).toEqual(["ezob"]);
    expect(linksOf(placesOf({ ...withPassage, ...changed }, order))).toHaveLength(0);
    expect("passages" in (changed.ezob!.features[0] as object)).toBe(false);
  });

  it("goes with a place that is removed, from the other layers too", () => {
    const all = maps();
    const places = placesOf(all, order);
    const a = places.find((p) => p.feature.id === "dudai")!;
    const u = places.find((p) => p.feature.id === "under")!;
    const withPassage = { ...all, ezob: addPassage(all, a, u)!.next };
    const now = placesOf(withPassage, order);
    const changed = removePlace(
      withPassage,
      now.find((p) => p.feature.id === "under")!,
    );
    expect(changed.lab!.features.map((f) => f.id)).toEqual(["stair"]);
    expect("passages" in (changed.ezob!.features[0] as object)).toBe(false);
  });
});

describe("straight above and below", () => {
  it("finds the nearest place on the next layer within a few degrees", () => {
    const all = {
      ezob: file("ezob", [marker("dudai", [10, 10])]),
      lab: file("lab", [marker("under", [10.5, 9.5]), marker("far", [60, 10])]),
    };
    const places = placesOf(all, ["ezob", "lab"]);
    const d = places.find((p) => p.feature.id === "dudai")!;
    expect(neighbour(d, places, 1)?.feature.id).toBe("under");
    expect(neighbour(d, places, -1)).toBeNull();
    const u = places.find((p) => p.feature.id === "under")!;
    expect(neighbour(u, places, -1)?.feature.id).toBe("dudai");
  });
});
