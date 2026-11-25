import { describe, expect, it } from "vitest";
import {
  allBiomes,
  BIOME_KINDS,
  BIOMES,
  BIOMES_LIBRARY,
  biomeById,
  type BiomesFile,
  type CustomBiome,
  DEFAULT_CLIMATE,
  featureCountsAs,
  LIBRARY_FILE_NAMES,
  libraryFileNamed,
  type MapFeature,
  type MapFile,
  mergeBiomes,
  mergeMaps,
  parseBiomes,
  parseMap,
  serialiseBiomes,
  serialiseMap,
  STARTER_BIOME_STYLES,
  STARTER_STYLES,
} from "../src/index.js";

const zone = (id: string, extra: Record<string, unknown> = {}): MapFeature =>
  ({
    id,
    kind: "zone",
    layer: "l1",
    points: [
      [0, 0],
      [10, 0],
      [10, 10],
    ],
    entry: null,
    label: null,
    child: null,
    ...extra,
  }) as MapFeature;

const map = (features: MapFeature[], extra: Record<string, unknown> = {}): MapFile =>
  ({
    version: 1,
    id: "ab12cd34",
    title: "Greywater",
    space: { kind: "flat", width: 100, height: 50, scale: 1, unit: "km" },
    images: [],
    markerSets: [],
    layers: [{ id: "l1", name: "Places", visible: true, color: "#9a3b1c" }],
    features,
    ...extra,
  }) as unknown as MapFile;

const blight: CustomBiome = {
  id: "blight01",
  name: "Blightlands",
  like: "wasteland",
  pattern: "thorns",
  speed: { cart: 0.3 },
  rivers: "dry",
  explore: "in the Blightlands, where nothing grows",
};

describe("biome kinds", () => {
  it("has fifteen, none of which looks like an owner's id, each with its usual style", () => {
    expect(BIOME_KINDS).toHaveLength(15);
    for (const k of BIOME_KINDS) expect(/^[a-z0-9]{8}$/.test(k)).toBe(false);
    const ids = new Set([...STARTER_STYLES, ...STARTER_BIOME_STYLES].map((s) => s.id));
    expect(ids.size).toBe(STARTER_STYLES.length + STARTER_BIOME_STYLES.length);
    for (const s of STARTER_BIOME_STYLES) expect(s.id).toMatch(/^[a-z0-9]{8}$/);
  });

  it("keeps Find paths' forest numbers", () => {
    expect(BIOMES.forest.speed).toEqual({ foot: 0.7, horse: 0.45, cart: 0.4 });
  });

  it("fills an owner's biome from the kind it behaves like", () => {
    const b = biomeById("blight01", [blight])!;
    expect(b).toMatchObject({
      name: "Blightlands",
      like: "wasteland",
      pattern: "thorns",
      rivers: "dry",
      custom: true,
      group: "own",
    });
    expect(b.speed).toEqual({ foot: 0.6, horse: 0.5, cart: 0.3 });
    expect(biomeById("blight01", [])).toBeNull();
    expect(biomeById("nothing")).toBeNull();
    expect(allBiomes([blight]).map((x) => x.id)).toEqual([...BIOME_KINDS, "blight01"]);
  });
});

describe("what a zone counts as", () => {
  const styles = [...STARTER_STYLES];
  it("comes from its biome when it has one, else from its style", () => {
    const realm = { kind: "zone", style: "strrealm" };
    expect(featureCountsAs(realm, styles)).toBeNull();
    expect(featureCountsAs({ ...realm, biome: "taiga" }, styles)).toBe("forest");
    expect(featureCountsAs({ ...realm, biome: "wetland" }, styles)).toBe("marsh");
    expect(featureCountsAs({ kind: "zone", style: "strfores", biome: "desert-sand" }, styles)).toBe(
      null,
    );
    expect(featureCountsAs({ kind: "zone", style: "strfores" }, styles)).toBe("forest");
    // A biome that is not there counts as none: the style speaks.
    expect(featureCountsAs({ kind: "zone", style: "strfores", biome: "gone0000" }, styles)).toBe(
      "forest",
    );
    expect(featureCountsAs({ kind: "zone", biome: "blight01" }, styles, [blight])).toBeNull();
    expect(featureCountsAs({ kind: "path", style: "strriver" }, styles)).toBe("river");
  });
});

describe("a zone's biome in the map file", () => {
  it("keeps the bytes of a map without biomes", () => {
    const text = serialiseMap(map([zone("a", { style: "strrealm" })]));
    expect(text).not.toContain("biome");
    expect(text).not.toContain("climate");
    const read = parseMap(text);
    expect(read.ok && serialiseMap(read.map)).toBe(text);
  });

  it("writes the biome and the pattern last on the zone, and reads them back", () => {
    const text = serialiseMap(
      map([zone("a", { pattern: false, biome: "taiga", style: "x1234567" })]),
    );
    const line = text.split("\n").find((l) => l.includes('"id":"a"'))!;
    expect(line.indexOf('"style"')).toBeLessThan(line.indexOf('"biome"'));
    expect(line.indexOf('"biome"')).toBeLessThan(line.indexOf('"pattern"'));
    const read = parseMap(text);
    expect(read.ok && read.map.features[0]).toMatchObject({ biome: "taiga", pattern: false });
    expect(read.ok && serialiseMap(read.map)).toBe(text);
  });

  it("refuses what is not a biome, and a pattern turned on by hand", () => {
    expect(parseMap(serialiseMap(map([zone("a", { biome: "Not a biome!" })]))).ok).toBe(false);
    expect(parseMap(serialiseMap(map([zone("a", { pattern: true })]))).ok).toBe(false);
    // One of the owner's that is not in this library is kept.
    expect(parseMap(serialiseMap(map([zone("a", { biome: "zz99yy88" })]))).ok).toBe(true);
  });

  it("merges a biome set on one side with a change made on the other", () => {
    const base = map([zone("a"), zone("b")]);
    const mine = map([zone("a", { biome: "desert-sand" }), zone("b")]);
    const theirs = map([zone("a"), zone("b", { biome: "wetland", label: "Mire of Ost" })]);
    const merged = mergeMaps(base, mine, theirs);
    expect(merged.clashes).toEqual([]);
    expect(merged.map.features.map((f) => (f as { biome?: string }).biome)).toEqual([
      "desert-sand",
      "wetland",
    ]);
  });

  it("keeps the climate last in the file, merged as one value", () => {
    const climate = { ...DEFAULT_CLIMATE, wind: "E" as const };
    const text = serialiseMap(map([zone("a")], { climate }));
    expect(text.trimEnd().split("\n").at(-2)).toContain('"climate"');
    const read = parseMap(text);
    expect(read.ok && read.map.climate).toEqual(climate);
    const base = map([zone("a")]);
    const merged = mergeMaps(base, map([zone("a")], { climate }), map([zone("a", { label: "x" })]));
    expect(merged.map.climate).toEqual(climate);
    expect(merged.clashes).toEqual([]);
    const both = mergeMaps(
      base,
      map([zone("a")], { climate }),
      map([zone("a")], { climate: { ...climate, wind: "N" } }),
    );
    expect(both.clashes).toEqual(["climate"]);
  });
});

describe("the biomes file", () => {
  const file: BiomesFile = { version: 1, biomes: [blight] };
  it("is the third library file", () => {
    expect(LIBRARY_FILE_NAMES).toEqual(["folders", "map-styles", "biomes"]);
    expect(libraryFileNamed("biomes")).toBe(BIOMES_LIBRARY);
  });

  it("writes one biome a line and reads it back", () => {
    const text = serialiseBiomes(file);
    expect(text.split("\n").filter((l) => l.includes('"id"'))).toHaveLength(1);
    const read = parseBiomes(text);
    expect(read.ok && read.file).toEqual(file);
    expect(read.ok && serialiseBiomes(read.file)).toBe(text);
  });

  it("refuses a biome that behaves like no kind, and two with one id", () => {
    expect(
      parseBiomes(JSON.stringify({ version: 1, biomes: [{ ...blight, like: "moon" }] })).ok,
    ).toBe(false);
    expect(parseBiomes(JSON.stringify({ version: 1, biomes: [blight, blight] })).ok).toBe(false);
  });

  it("merges biome by biome", () => {
    const ash: CustomBiome = { id: "ashfield", name: "Ashfields", like: "wasteland" };
    const merged = mergeBiomes(
      file,
      { version: 1, biomes: [{ ...blight, rivers: "normal" }] },
      { version: 1, biomes: [blight, ash] },
    );
    expect(merged.clashes).toEqual([]);
    expect(merged.file.biomes.map((b) => [b.id, b.rivers])).toEqual([
      ["blight01", "normal"],
      ["ashfield", undefined],
    ]);
  });
});
