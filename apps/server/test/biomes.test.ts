import type { MapFeature } from "@frontier/schema";
import { describe, expect, it } from "vitest";
import { landAt, placesText } from "../src/ai/discover.js";

const zone = (id: string, x0: number, x1: number, extra: Record<string, unknown> = {}) =>
  ({
    id,
    kind: "zone",
    layer: "l1",
    points: [
      [x0, x0],
      [x1, x0],
      [x1, x1],
      [x0, x1],
    ],
    entry: null,
    label: null,
    child: null,
    ...extra,
  }) as MapFeature;

describe("the land Explore is told of", () => {
  const desert = zone("d", 0, 100, { biome: "desert-sand", label: "Tharn Desert" });
  const oasis = zone("o", 40, 50, { biome: "wetland" });
  const realm = zone("r", 0, 200, { label: "Realm" });

  it("is the biome of the smallest biome zone that holds the place, named or not", () => {
    expect(landAt([10, 10], [realm, desert, oasis])).toBe(
      "The land here: in the sand desert (Tharn Desert); rivers lose water and can dry out.",
    );
    expect(landAt([45, 45], [realm, desert, oasis])).toBe(
      "The land here: in the marshes; rivers spread into marsh.",
    );
    expect(landAt([150, 150], [realm, desert, oasis])).toBeNull();
  });

  it("reads the owner's own biomes, and leaves out one that is not there", () => {
    const blight = zone("b", 0, 10, { biome: "blight01" });
    expect(landAt([5, 5], [blight])).toBeNull();
    expect(
      landAt(
        [5, 5],
        [blight],
        [{ id: "blight01", name: "Blightlands", like: "wasteland", explore: "in the Blightlands" }],
      ),
    ).toBe("The land here: in the Blightlands; rivers run as usual.");
  });
});

describe("the land of each place, when several are asked about", () => {
  it("goes in that place's own block", () => {
    const spot = (title: string) => ({
      at: [0, 0] as [number, number],
      kind: "ford" as const,
      title,
      lines: ["On the Old Road."],
      features: [],
    });
    const text = placesText(
      [spot("North ford"), spot("South ford")],
      [null, "The land here: in the marshes; rivers spread into marsh."],
    );
    const [first, second] = text.split("=== Place ").slice(1);
    expect(first).not.toContain("The land here");
    expect(second).toContain("On the Old Road.\nThe land here: in the marshes");
  });
});
