import type { Space } from "@frontier/geo";
import {
  allBiomes,
  type ChronicleFile,
  type MapFeature,
  type MapFile,
  STARTER_STYLES,
} from "@frontier/schema";
import { describe, expect, it } from "vitest";
import {
  BIOMES_LAYER,
  biomeAt,
  biomeLegend,
  biomesLayer,
  biomeZones,
  ringArea,
  styleForBiome,
  withBiome,
  withPattern,
} from "./biomes.ts";
import { readTime, resolve } from "./time.ts";

const space: Space = { kind: "flat", width: 100, height: 100, scale: 1, unit: "km" };
const square = (x0: number, y0: number, s: number): [number, number][] => [
  [x0, y0],
  [x0 + s, y0],
  [x0 + s, y0 + s],
  [x0, y0 + s],
];
const zone = (id: string, points: [number, number][], extra: Record<string, unknown> = {}) =>
  ({
    id,
    kind: "zone",
    layer: "l1",
    points,
    entry: null,
    label: null,
    child: null,
    ...extra,
  }) as MapFeature;

describe("where a biome is", () => {
  const desert = zone("desert", square(0, 0, 60), { biome: "desert-sand" });
  const oasis = zone("oasis", square(20, 20, 10), { biome: "wetland" });
  const realm = zone("realm", square(0, 0, 100));
  const zones = biomeZones(space, [oasis, realm, desert], []);

  it("finds the biome zones, the largest first, leaving out zones without one", () => {
    expect(zones.map((z) => z.feature.id)).toEqual(["desert", "oasis"]);
    expect(ringArea(square(0, 0, 10))).toBe(100);
  });

  it("gives the smallest zone that holds the place: an oasis in a desert", () => {
    expect(biomeAt(zones, [25, 25])?.biome.id).toBe("wetland");
    expect(biomeAt(zones, [5, 5])?.biome.id).toBe("desert-sand");
    expect(biomeAt(zones, [90, 90])).toBeNull();
  });

  it("leaves out a biome that is not there, and reads the owner's own", () => {
    const own = zone("own", square(70, 70, 20), { biome: "blight01" });
    expect(biomeZones(space, [own], [])).toEqual([]);
    const found = biomeZones(
      space,
      [own],
      [{ id: "blight01", name: "Blightlands", like: "wasteland" }],
    );
    expect(biomeAt(found, [80, 80])?.biome.name).toBe("Blightlands");
  });

  it("follows a desert's later shape at the year shown", () => {
    const spreading = zone("d", square(0, 0, 20), {
      biome: "desert-sand",
      span: "s1",
      shapes: [{ id: "h1", from: "s2", points: square(0, 0, 50) }],
    });
    const chronicle = {
      version: 1,
      id: "c1234567",
      title: "Ages",
      main: true,
      spans: [
        { id: "s1", name: "Desert", start: { low: 0, high: 0 }, end: "open" },
        { id: "s2", name: "Long Drought", start: { low: 512, high: 512 }, end: "open" },
      ],
    } as unknown as ChronicleFile;
    const map = { features: [spreading], groups: [] } as unknown as MapFile;
    const at = (year: number) =>
      biomeAt(
        biomeZones(
          space,
          resolve(map, readTime(chronicle), year, {
            selected: null,
            pin: null,
            editing: false,
            showAll: false,
          }).map((r) => r.feature),
          [],
        ),
        [40, 40],
      )?.biome.id ?? null;
    expect(at(100)).toBeNull();
    expect(at(600)).toBe("desert-sand");
  });
});

describe("a zone's biome", () => {
  it("is set, cleared and its pattern switched off with the key left out for the default", () => {
    const z = zone("a", square(0, 0, 1));
    const set = withBiome(z, "taiga");
    expect((set as { biome?: string }).biome).toBe("taiga");
    expect("biome" in withBiome(set, null)).toBe(false);
    const off = withPattern(set, false);
    expect((off as { pattern?: boolean }).pattern).toBe(false);
    expect("pattern" in withPattern(off, true)).toBe(false);
  });

  it("gets its biome's usual style, which is added when the library has none", () => {
    const taiga = allBiomes().find((b) => b.id === "taiga")!;
    expect(styleForBiome(taiga, STARTER_STYLES, null)).toEqual({
      style: "biotaiga",
      missing: expect.objectContaining({
        id: "biotaiga",
        for: "zone",
        name: "Taiga / boreal forest",
      }),
    });
    expect(styleForBiome(taiga, STARTER_STYLES, "strrealm")).toEqual({
      style: "strrealm",
      missing: null,
    });
  });
});

describe("the Biomes layer", () => {
  const map = {
    layers: [{ id: "l1", name: "Places", visible: true, color: "#000000" }],
  } as unknown as MapFile;
  it("is made first, so it is drawn under the rest, and found after", () => {
    const made = biomesLayer(map);
    expect(made.made).toBe(true);
    expect(made.map.layers[0]!.name).toBe(BIOMES_LAYER);
    const again = biomesLayer(made.map);
    expect(again).toEqual({ map: made.map, layer: made.layer, made: false });
  });
});

describe("the legend's biomes", () => {
  it("lists the biomes drawn now in the biome list's order, each in its zones' usual colour", () => {
    const zones = biomeZones(
      space,
      [
        zone("a", square(0, 0, 10), { biome: "wetland" }),
        zone("b", square(0, 0, 20), { biome: "taiga", style: "red" }),
        zone("c", square(0, 0, 30), { biome: "taiga", style: "red" }),
        zone("d", square(0, 0, 40), { biome: "taiga", style: "blue" }),
      ],
      [],
    );
    const keys = biomeLegend(zones, (f) => (f as { style?: string }).style ?? "grey", allBiomes());
    expect(keys.map((k) => [k.biome.id, k.colour])).toEqual([
      ["taiga", "red"],
      ["wetland", "grey"],
    ]);
  });
});
