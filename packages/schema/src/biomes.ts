/**
 * Biomes: what the ground of a zone is (a sand desert, a taiga, a marsh), as a field on the zone
 * that is independent of its style. The style gives the zone its colour and edge; the biome gives
 * it meaning (how fast each way of travelling crosses it, what rivers do in it, the words Explore
 * reads) and a pattern drawn over its fill. Fifteen kinds are built in; the owner's own biomes
 * (the Blightlands) are kept once for the library in `.frontier/biomes.json`, each behaving like
 * one of the built-in kinds with numbers and words of its own. Shared with the server, which
 * gives Explore the land a place lies in. See docs/designs/stage-21-biome-zones.md.
 */
import { z } from "zod";
import {
  type LibraryFileKind,
  mergeLibraryFile,
  type ParsedLibraryFile,
  parseLibraryFile,
  serialiseLibraryFile,
} from "./libraryFiles.js";
import { type CountsAs, countsAs, type MapStyle } from "./mapStyles.js";

/** The built-in kinds. No key is eight letters and digits, so none is taken for an owner's id. */
export const BIOME_KINDS = [
  "ocean",
  "coast",
  "ice",
  "tundra",
  "taiga",
  "forest",
  "jungle",
  "grassland",
  "savanna",
  "scrub",
  "desert-sand",
  "desert-rock",
  "wetland",
  "alpine",
  "wasteland",
] as const;
export type BiomeKind = (typeof BIOME_KINDS)[number];
export const isBiomeKind = (s: string): s is BiomeKind =>
  (BIOME_KINDS as readonly string[]).includes(s);

/** The patterns drawn over a biome zone's fill: small glyphs drawn by code, not pictures. */
export const PATTERNS = [
  "waves",
  "stipple",
  "crevasse",
  "dashes",
  "conifers",
  "trees",
  "canopy",
  "tufts",
  "savanna",
  "bush",
  "dots",
  "pebbles",
  "reeds",
  "peaks",
  "specks",
  "thorns",
] as const;
export type Pattern = (typeof PATTERNS)[number];

/**
 * What rivers do in a biome. Dry: water gathered there counts for little and a river loses
 * water as it crosses, so a small one ends in the sand. Marsh: a river that reaches it spreads
 * into it and ends there. Source: wetter, so more rivers rise in it.
 */
export const RIVER_RULES = ["normal", "dry", "marsh", "source"] as const;
export type RiverRule = (typeof RIVER_RULES)[number];

/** The ways of travelling a biome slows, as multipliers on open ground; 0 is "no way". */
export const BIOME_MODES = ["foot", "horse", "cart"] as const;
export type BiomeMode = (typeof BIOME_MODES)[number];
export type BiomeSpeeds = Record<BiomeMode, number>;

/** The groups of the biome picker. */
export const BIOME_GROUPS = ["water", "cold", "temperate", "warm", "high", "own"] as const;
export type BiomeGroup = (typeof BIOME_GROUPS)[number];
export const BIOME_GROUP_NAMES: Record<BiomeGroup, string> = {
  water: "Water",
  cold: "Cold",
  temperate: "Temperate",
  warm: "Warm",
  high: "High",
  own: "Made by you",
};

export interface BiomeKindInfo {
  name: string;
  group: Exclude<BiomeGroup, "own">;
  pattern: Pattern;
  speed: BiomeSpeeds;
  rivers: RiverRule;
  /** As in "The land here: in the sand desert". */
  explore: string;
  /** What a zone of this biome counts as to Find paths, whatever its style. */
  counts: CountsAs | null;
  /** The usual style a new zone of this biome is given: its id, colour and fill. */
  style: { id: string; color: string; fill: number };
}

/**
 * The built-in kinds. Speeds are from the approved Find paths defaults: the forest numbers match
 * Find paths' own forest (about 0.7 on foot, 0.45 on horseback, 0.4 by cart).
 */
export const BIOMES: Record<BiomeKind, BiomeKindInfo> = {
  ocean: {
    name: "Ocean / sea",
    group: "water",
    pattern: "waves",
    speed: { foot: 0, horse: 0, cart: 0 },
    rivers: "normal",
    explore: "at sea",
    counts: "water",
    style: { id: "bioocean", color: "#5f8fa6", fill: 0.34 },
  },
  coast: {
    name: "Coast / beach",
    group: "water",
    pattern: "stipple",
    speed: { foot: 0.9, horse: 0.8, cart: 0.6 },
    rivers: "normal",
    explore: "on the shore",
    counts: null,
    style: { id: "biocoast", color: "#e2cf97", fill: 0.45 },
  },
  ice: {
    name: "Ice / glacier",
    group: "cold",
    pattern: "crevasse",
    speed: { foot: 0.35, horse: 0, cart: 0 },
    rivers: "source",
    explore: "on the ice",
    counts: "mountains",
    style: { id: "bioicesh", color: "#dbe7ee", fill: 0.62 },
  },
  tundra: {
    name: "Tundra",
    group: "cold",
    pattern: "dashes",
    speed: { foot: 0.8, horse: 0.75, cart: 0.5 },
    rivers: "normal",
    explore: "on the open tundra",
    counts: null,
    style: { id: "biotundr", color: "#b5bea3", fill: 0.42 },
  },
  taiga: {
    name: "Taiga / boreal forest",
    group: "cold",
    pattern: "conifers",
    speed: { foot: 0.65, horse: 0.45, cart: 0.35 },
    rivers: "normal",
    explore: "in the taiga",
    counts: "forest",
    style: { id: "biotaiga", color: "#5e7d5c", fill: 0.4 },
  },
  forest: {
    name: "Temperate forest",
    group: "temperate",
    pattern: "trees",
    speed: { foot: 0.7, horse: 0.45, cart: 0.4 },
    rivers: "normal",
    explore: "in the forest",
    counts: "forest",
    style: { id: "bioforst", color: "#7a9c5c", fill: 0.38 },
  },
  jungle: {
    name: "Rainforest / jungle",
    group: "warm",
    pattern: "canopy",
    speed: { foot: 0.4, horse: 0.2, cart: 0 },
    rivers: "source",
    explore: "in the jungle",
    counts: "forest",
    style: { id: "biojungl", color: "#3f7046", fill: 0.45 },
  },
  grassland: {
    name: "Grassland / steppe",
    group: "temperate",
    pattern: "tufts",
    speed: { foot: 1, horse: 1.1, cart: 1 },
    rivers: "normal",
    explore: "on the grassland",
    counts: null,
    style: { id: "biograss", color: "#c2cb80", fill: 0.42 },
  },
  savanna: {
    name: "Savanna",
    group: "warm",
    pattern: "savanna",
    speed: { foot: 1, horse: 1.05, cart: 0.9 },
    rivers: "normal",
    explore: "on the savanna",
    counts: null,
    style: { id: "biosavan", color: "#d4b865", fill: 0.42 },
  },
  scrub: {
    name: "Scrubland",
    group: "temperate",
    pattern: "bush",
    speed: { foot: 0.85, horse: 0.8, cart: 0.7 },
    rivers: "normal",
    explore: "in the scrubland",
    counts: null,
    style: { id: "bioscrub", color: "#aaa36a", fill: 0.42 },
  },
  "desert-sand": {
    name: "Desert (sand)",
    group: "warm",
    pattern: "dots",
    speed: { foot: 0.6, horse: 0.55, cart: 0.35 },
    rivers: "dry",
    explore: "in the sand desert",
    counts: null,
    style: { id: "biodsand", color: "#e6c47a", fill: 0.52 },
  },
  "desert-rock": {
    name: "Desert (rock)",
    group: "warm",
    pattern: "pebbles",
    speed: { foot: 0.8, horse: 0.7, cart: 0.6 },
    rivers: "dry",
    explore: "in the stony desert",
    counts: null,
    style: { id: "biodrock", color: "#c4a27c", fill: 0.46 },
  },
  wetland: {
    name: "Wetland / marsh",
    group: "temperate",
    pattern: "reeds",
    speed: { foot: 0.45, horse: 0.3, cart: 0 },
    rivers: "marsh",
    explore: "in the marshes",
    counts: "marsh",
    style: { id: "biowetla", color: "#6a9078", fill: 0.45 },
  },
  alpine: {
    name: "Mountains / alpine",
    group: "high",
    pattern: "peaks",
    speed: { foot: 0.55, horse: 0.4, cart: 0.2 },
    rivers: "source",
    explore: "high in the mountains",
    counts: "mountains",
    style: { id: "bioalpin", color: "#9d958a", fill: 0.42 },
  },
  wasteland: {
    name: "Volcanic / wasteland",
    group: "high",
    pattern: "specks",
    speed: { foot: 0.6, horse: 0.5, cart: 0.4 },
    rivers: "normal",
    explore: "in the wasteland",
    counts: null,
    style: { id: "biowaste", color: "#6f6460", fill: 0.45 },
  },
};

/** What each rule says, for the hover tag, the biome editor and Explore. */
export const RIVER_WORDS: Record<RiverRule, string> = {
  normal: "rivers run as usual",
  dry: "rivers lose water and can dry out",
  marsh: "rivers spread into marsh",
  source: "plenty of water: rivers rise here",
};

// ---- The owner's own biomes: `.frontier/biomes.json` -----------------------------------------

export const BIOMES_FILE = ".frontier/biomes.json";

/** The id of an owner's biome: eight letters and digits, as a style's. */
export const CustomBiomeId = z
  .string()
  .regex(/^[a-z0-9]{8}$/, "A biome id is eight letters and digits.");

const Speed = z.number().min(0).max(3);

export const CustomBiome = z
  .object({
    id: CustomBiomeId,
    name: z.string().trim().min(1).max(60),
    /** The built-in kind it behaves like: its defaults for all that is left out. */
    like: z.enum(BIOME_KINDS),
    /** Its pattern; "none" for none; left out: the kind's. */
    pattern: z.enum([...PATTERNS, "none"]).optional(),
    /** Its own speeds; each left out is the kind's. */
    speed: z
      .object({ foot: Speed.optional(), horse: Speed.optional(), cart: Speed.optional() })
      .passthrough()
      .optional(),
    rivers: z.enum(RIVER_RULES).optional(),
    /** Explore's words, as in "in the Blightlands, where nothing grows". */
    explore: z.string().trim().min(1).max(120).optional(),
    /** The colour new zones of it are given, through a style of its own; left out: the kind's. */
    color: z
      .string()
      .regex(/^#[0-9a-f]{6}$/, "A colour is # and six digits.")
      .optional(),
  })
  .passthrough();
export type CustomBiome = z.infer<typeof CustomBiome>;

export const MAX_BIOMES = 100;

export const BiomesFile = z
  .object({ version: z.literal(1), biomes: z.array(CustomBiome).max(MAX_BIOMES) })
  .passthrough()
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    for (const b of file.biomes) {
      if (seen.has(b.id)) {
        ctx.addIssue({ code: "custom", message: `Two biomes share the id "${b.id}".` });
        return;
      }
      seen.add(b.id);
    }
  });
export type BiomesFile = z.infer<typeof BiomesFile>;

/** The biomes file's entry in the table of library files. */
export const BIOMES_LIBRARY: LibraryFileKind<BiomesFile> = {
  name: "biomes",
  path: BIOMES_FILE,
  label: "Biomes",
  noun: "biomes",
  schema: BiomesFile,
  list: "biomes",
  topKeys: ["version", "biomes"],
  itemKeys: ["id", "name", "like", "pattern", "speed", "rivers", "explore", "color"],
  key: (item) => (item as CustomBiome).id,
  conflict: "biomes_changed_on_both",
  empty: () => ({ version: 1, biomes: [] }),
};

export const parseBiomes = (text: string): ParsedLibraryFile<BiomesFile> =>
  parseLibraryFile(BIOMES_LIBRARY, text);
export const serialiseBiomes = (file: BiomesFile): string =>
  serialiseLibraryFile(BIOMES_LIBRARY, file);
export const mergeBiomes = (
  base: BiomesFile,
  mine: BiomesFile,
  theirs: BiomesFile,
): { file: BiomesFile; clashes: string[] } => mergeLibraryFile(BIOMES_LIBRARY, base, mine, theirs);

// ---- A biome as the tools read it --------------------------------------------------------------

/** A biome with every default filled in: a built-in kind, or an owner's own. */
export interface Biome {
  /** The zone's `biome`: a kind's key, or an owner's biome's id. */
  id: string;
  name: string;
  like: BiomeKind;
  group: BiomeGroup;
  pattern: Pattern | null;
  speed: BiomeSpeeds;
  rivers: RiverRule;
  explore: string;
  counts: CountsAs | null;
  /** The colour of its usual look. */
  color: string;
  custom: boolean;
}

function kindBiome(kind: BiomeKind): Biome {
  const k = BIOMES[kind];
  return {
    id: kind,
    name: k.name,
    like: kind,
    group: k.group,
    pattern: k.pattern,
    speed: { ...k.speed },
    rivers: k.rivers,
    explore: k.explore,
    counts: k.counts,
    color: k.style.color,
    custom: false,
  };
}

function ownBiome(b: CustomBiome): Biome {
  const base = kindBiome(b.like);
  return {
    ...base,
    id: b.id,
    name: b.name,
    group: "own",
    pattern: b.pattern === "none" ? null : (b.pattern ?? base.pattern),
    speed: {
      foot: b.speed?.foot ?? base.speed.foot,
      horse: b.speed?.horse ?? base.speed.horse,
      cart: b.speed?.cart ?? base.speed.cart,
    },
    rivers: b.rivers ?? base.rivers,
    explore: b.explore ?? `in the ${b.name}`,
    color: b.color ?? base.color,
    custom: true,
  };
}

/** The biome a zone's `biome` names, or null when it names none there is (one deleted, say). */
export function biomeById(
  id: string | null | undefined,
  custom: readonly CustomBiome[] = [],
): Biome | null {
  if (!id) return null;
  if (isBiomeKind(id)) return kindBiome(id);
  const own = custom.find((b) => b.id === id);
  return own ? ownBiome(own) : null;
}

/** Every biome there is: the built-in kinds in their order, then the owner's own. */
export function allBiomes(custom: readonly CustomBiome[] = []): Biome[] {
  return [...BIOME_KINDS.map(kindBiome), ...custom.map(ownBiome)];
}

/** The usual style of a biome, as "Add the usual biomes" adds it and a new biome zone gets it. */
export function biomeStyle(kind: BiomeKind): MapStyle {
  const k = BIOMES[kind];
  return {
    id: k.style.id,
    name: k.name,
    for: "zone",
    color: k.style.color,
    width: 1,
    dash: "solid",
    fill: k.style.fill,
  };
}

/** "Add the usual biomes": a zone style for each built-in kind. */
export const STARTER_BIOME_STYLES: MapStyle[] = BIOME_KINDS.map(biomeStyle);

/** The style a new zone of a biome is given: a kind's usual one; an owner's, its kind's. */
export function usualStyleOf(biome: Biome): MapStyle {
  return biomeStyle(biome.like);
}

/** How a multiplier reads: "0.6×", "no way". */
export function speedWords(v: number): string {
  return v === 0 ? "no way" : `${Math.round(v * 100) / 100}×`;
}

/** "On foot 0.6× · horse 0.55× · cart 0.35×". */
export function speedsText(speed: BiomeSpeeds): string {
  return `On foot ${speedWords(speed.foot)} · horse ${speedWords(speed.horse)} · cart ${speedWords(speed.cart)}`;
}

// ---- The climate Suggest biomes works with -------------------------------------------------------

export const WINDS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW", "none"] as const;
export type Wind = (typeof WINDS)[number];

/**
 * Suggest biomes' world settings, kept on the map once something is accepted: the prevailing
 * wind (where it blows from), the latitude of the map's middle and its north–south span in
 * degrees (null: what the map's scale gives), a shift of the temperature in °C, a scale of the
 * rain, and the smallest region suggested, in km².
 */
export const MapClimate = z
  .object({
    wind: z.enum(WINDS),
    lat: z.number().min(-90).max(90),
    span: z.number().min(0.1).max(180).nullable(),
    temp: z.number().min(-10).max(10),
    wet: z.number().min(0.4).max(2.5),
    minArea: z.number().min(1).max(1_000_000),
  })
  .passthrough();
export type MapClimate = z.infer<typeof MapClimate>;
export const CLIMATE_KEYS = ["wind", "lat", "span", "temp", "wet", "minArea"];
export const DEFAULT_CLIMATE: MapClimate = {
  wind: "W",
  lat: 40,
  span: null,
  temp: 0,
  wet: 1,
  minArea: 150,
};

// ---- What a zone counts as ---------------------------------------------------------------------

/**
 * What a path or zone counts as to Find paths: a zone with a biome there is, by its biome (a
 * taiga is a forest, a wetland a marsh, whatever its style); otherwise by its style.
 */
export function featureCountsAs(
  feature: { kind: string; style?: string | undefined; biome?: string | undefined },
  styles: readonly MapStyle[],
  custom: readonly CustomBiome[] = [],
): CountsAs | null {
  if (feature.kind === "zone") {
    const biome = biomeById(feature.biome, custom);
    if (biome) return biome.counts;
  }
  if (!feature.style) return null;
  return countsAs(styles.find((s) => s.id === feature.style && s.for === feature.kind));
}
